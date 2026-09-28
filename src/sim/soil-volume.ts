/**
 * The region's soil as one queryable volume (`MAP-14` stage 2).
 *
 * Two things live here and nothing else:
 *
 * 1. **An analytic material field.** Strata, organic matter, minerals and
 *    hardness are pure functions of a voxel's *global* coordinates. There is no
 *    per-stand table, so a query on a shared boundary returns the same material
 *    whichever square the caller thought it was standing in, and the same noise
 *    cannot be sampled twice under two names.
 * 2. **A sparse map of what has changed.** Nine dense `136 x 136 x 112`
 *    volumes are never allocated. A voxel earns a record the first time the
 *    simulation touches it, and `step` advances only those records, in stable
 *    key order, on the soil's own cadence.
 *
 * Reading is free and changes nothing: `sample` never materialises a record, so
 * looking at a section cannot alter the state hash. Writing goes through
 * `materialAt`, which is the explicit mutation path.
 *
 * Water is the exception worth stating plainly. Groundwater is a continuous
 * regional surface derived from the generator's own water field, not nine
 * stand averages: `groundwaterElevationAt` is one function over the whole map,
 * and the seasonal offset moves it everywhere at once, including ground nobody
 * has looked at yet.
 */
import { ECON, MAX_DEPTH_CM, STRATA } from './content';
import type { Region } from './region';
import { makeNoise2D, type Rng2D } from './rng';
import {
  VOXEL_SIZE,
  depthCmAt,
  elevationAtDepthCm,
  hashParts,
  standIdAt,
  traverseSegment,
  voxelKeyOf,
  voxelKeyText,
  type Vec3,
  type VoxelKey,
} from './spatial';
import { WATER_FRINGE_CM, stratumAtDepth, type SoilCell } from './world';

/**
 * Bumped when a stored material record would mean something different. Nothing
 * is serialised yet; this exists so a save format can be written without
 * guessing what an old file held.
 */
export const SOIL_VOLUME_VERSION = 1;

/** The regional clock's contribution to soil. Set once per tick by the match. */
export interface SoilEnvironment {
  rainfall: number;
  litterfall: number;
  /** Seasonal shift of the water table in centimetres; positive is deeper. */
  waterTableOffsetCm: number;
}

export const CALM_ENVIRONMENT: SoilEnvironment = {
  rainfall: 1,
  litterfall: 0.25,
  waterTableOffsetCm: 0,
};

/**
 * The season's own contribution to the water table, matching `Simulation`'s
 * arithmetic exactly so the flat transect and the volume cannot drift apart.
 */
export const seasonalWaterTableOffsetCm = (rain: number): number =>
  (1 - rain) * 22 - (rain - 1) * 8;

export interface SoilSample {
  position: Vec3;
  key: VoxelKey;
  keyText: string;
  standId: number | null;
  depthCm: number;
  /** 0 far above the table, 1 at or below it. The fringe is the smooth part. */
  saturation: number;
  groundwaterZ: number;
  waterTableDepthCm: number;
  /** A copy of the material at this voxel; safe to keep. */
  material: SoilCell;
  /** True when the voxel holds simulation-owned state rather than the baseline. */
  changed: boolean;
}

export type SoilBlockReason = 'outside' | 'bedrock' | 'stream' | 'groundwater';

export interface SoilBlock {
  blocked: boolean;
  reason: SoilBlockReason | null;
  /** The first voxel that refused, or the endpoint when nothing did. */
  at: VoxelKey | null;
  depthCm: number;
}

/** A vertical section: a plane at one horizontal `y`, sampled on a grid. */
export interface SectionSpec {
  id: string;
  /** The plane's fixed horizontal coordinate. */
  y: number;
  xFrom: number;
  xTo: number;
  /** Depth below the local ground. */
  depthFromCm: number;
  depthToCm: number;
  across: number;
  down: number;
}

interface ChangedCell {
  key: VoxelKey;
  cell: SoilCell;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

export class SoilVolume {
  readonly region: Region;
  readonly seed: number;
  /** Simulation time the sparse records have been advanced to, in seconds. */
  time = 0;
  environment: SoilEnvironment = { ...CALM_ENVIRONMENT };

  private readonly warp: Rng2D;
  private readonly pocket: Rng2D;
  private readonly vein: Rng2D;
  private readonly changes = new Map<string, ChangedCell>();

  constructor(region: Region, seed = region.seed) {
    this.region = region;
    this.seed = seed >>> 0;
    this.warp = makeNoise2D(this.seed ^ 0x9e3779b9, 4, 0.035);
    this.pocket = makeNoise2D(this.seed ^ 0x51ed270b, 5, 0.11);
    this.vein = makeNoise2D(this.seed ^ 0x1b873593, 3, 0.19);
  }

  get materializedCount(): number {
    return this.changes.size;
  }

  /** Voxels the simulation has changed, in canonical key order. */
  changedKeys(): string[] {
    return [...this.changes.keys()].sort();
  }

  setEnvironment(env: Partial<SoilEnvironment>): void {
    if (env.rainfall !== undefined) this.environment.rainfall = env.rainfall;
    if (env.litterfall !== undefined) this.environment.litterfall = env.litterfall;
    if (env.waterTableOffsetCm !== undefined) {
      this.environment.waterTableOffsetCm = env.waterTableOffsetCm;
    }
  }

  // -------------------------------------------------------------------------
  // Water and the stream course
  // -------------------------------------------------------------------------

  /**
   * Depth to the live water table below the local ground, in centimetres.
   *
   * The generator's field is the shape; the season shifts it everywhere at
   * once. Clamped to the volume's own depth so ground cannot be asked for water
   * below its bedrock.
   */
  waterTableDepthCm(x: number, y: number): number {
    const base = this.region.waterTableAt(x, y) + this.environment.waterTableOffsetCm;
    return clamp(base, 16, MAX_DEPTH_CM - 4);
  }

  /** Absolute elevation of the water table. One continuous regional surface. */
  groundwaterElevationAt(x: number, y: number): number {
    return elevationAtDepthCm(this.region, x, y, this.waterTableDepthCm(x, y));
  }

  /** Distance from a horizontal point to the region's actual stream course. */
  streamDistanceAt(x: number, y: number): number {
    const path = this.region.streamPath;
    let best = Infinity;
    for (let i = 0; i < path.length; i++) {
      const a = path[i] as { x: number; y: number };
      const b = path[Math.min(path.length - 1, i + 1)] as { x: number; y: number };
      const d = pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    return best;
  }

  /** Half-width of the open channel, wider downstream where the flow gathers. */
  channelHalfWidthAt(x: number, y: number): number {
    const flow = this.region.flowAt(x, y);
    return 1.5 + clamp(flow, 0, 1) * 4;
  }

  /**
   * Depth of the channel's bed below the local ground.
   *
   * The bed sits a little below the water table, which is why the open channel
   * is water and air rather than soil and why the ground beneath it is wet
   * enough to refuse a hypha until the table recedes.
   */
  streamBedDepthCm(x: number, y: number): number {
    return clamp(this.waterTableDepthCm(x, y) + 6, 0, MAX_DEPTH_CM - 4);
  }

  streamBedElevationAt(x: number, y: number): number {
    return elevationAtDepthCm(this.region, x, y, this.streamBedDepthCm(x, y));
  }

  /** True inside the open channel: over the course and above the bed. */
  inChannel(x: number, y: number, z: number): boolean {
    if (this.streamDistanceAt(x, y) > this.channelHalfWidthAt(x, y)) return false;
    return z >= this.streamBedElevationAt(x, y) && z <= this.region.heightAt(x, y);
  }

  /** 0..1 dampness from the stream, mirroring the transect's bank wetness. */
  private streamNearness(x: number, y: number): number {
    const beyond = Math.max(0, this.streamDistanceAt(x, y) - this.channelHalfWidthAt(x, y));
    return beyond <= 0 ? 1 : Math.max(0, 1 - beyond / 7);
  }

  // -------------------------------------------------------------------------
  // Material
  // -------------------------------------------------------------------------

  /**
   * The analytic material of a voxel.
   *
   * Every input is a global coordinate, so this function has no idea which
   * stand a caller came from and cannot return two answers for one place.
   */
  private initialMaterial(x: number, y: number, z: number): SoilCell {
    const depthCm = depthCmAt(this.region, x, y, z);
    const warpAmount = (this.warp(x, y * 0.6) - 0.5) * (6 + Math.max(0, depthCm) * 0.22);
    const stratum = stratumAtDepth(Math.max(0, depthCm + warpAmount));
    const base = STRATA[stratum];
    const organicNoise = this.pocket(x, y);
    const veinNoise = this.vein(x, y);
    const nitrogenBase = Math.max(0, base.nitrogen * (0.6 + organicNoise * 0.8));
    const cell: SoilCell = {
      stratum,
      organic: Math.max(0, base.organic * (0.55 + organicNoise * 0.9)),
      nitrogen: nitrogenBase,
      nitrogenBase,
      water: 0,
      hardness: clamp(base.hardness * (0.7 + veinNoise * 0.6), 0, 1),
      occupancy: 0,
      stream: false,
      streamNear: this.streamNearness(x, y),
    };
    // The open channel and the ground under its bed are the stream's own
    // material: loose bedload rather than compacted ground.
    if (this.inChannel(x, y, z)) {
      cell.stream = true;
      cell.hardness = Math.min(cell.hardness, 0.35);
      cell.nitrogen *= 0.4;
      cell.nitrogenBase *= 0.4;
      cell.organic *= 0.4;
    } else if (this.streamDistanceAt(x, y) <= this.channelHalfWidthAt(x, y)) {
      cell.hardness = Math.min(cell.hardness, 0.35);
      cell.nitrogen *= 0.4;
      cell.nitrogenBase *= 0.4;
      cell.organic *= 0.4;
    }
    cell.water = this.waterTarget(x, y, z, cell);
    return cell;
  }

  /** What a voxel's stored water relaxes toward: depth, material and rain. */
  private waterTarget(x: number, y: number, z: number, cell: SoilCell): number {
    const base = STRATA[cell.stratum];
    const depthCm = Math.max(0, depthCmAt(this.region, x, y, z));
    const tableDepth = this.waterTableDepthCm(x, y);
    const belowTable = depthCm >= tableDepth;
    const proximity = belowTable ? 1 : Math.max(0, 1 - (tableDepth - depthCm) / 34);
    const rain = clamp(this.environment.rainfall, 0, 2.2);
    const surfaceBias = rain * Math.exp(-depthCm / 26) * 0.85;
    const streamDamp = cell.streamNear * 0.35 * base.waterHolding;
    return Math.min(1, proximity * 1.05 * base.waterHolding + surfaceBias * base.waterHolding + streamDamp);
  }

  /**
   * The explicit mutation path: a live, canonical record for this voxel.
   *
   * Two callers asking for the same voxel get the same object, so depleting it
   * once depletes it for everyone. Materialising is itself a state change, which
   * is why reads use `sample` instead.
   */
  materialAt(x: number, y: number, z: number): SoilCell {
    const key = voxelKeyOf({ x, y, z });
    const text = voxelKeyText(key);
    const existing = this.changes.get(text);
    if (existing) return existing.cell;
    const cell = this.initialMaterial(
      (key.ix + 0.5) * VOXEL_SIZE,
      (key.iy + 0.5) * VOXEL_SIZE,
      (key.iz + 0.5) * VOXEL_SIZE
    );
    this.changes.set(text, { key, cell });
    return cell;
  }

  /** Fast lookup for a local soil view that has already resolved its voxel. */
  changedMaterialForKey(key: string): SoilCell | null {
    return this.changes.get(key)?.cell ?? null;
  }

  /** Apply a change through the mutation path. */
  mutate(x: number, y: number, z: number, patch: Partial<SoilCell>): SoilCell {
    const cell = this.materialAt(x, y, z);
    Object.assign(cell, patch);
    return cell;
  }

  /** Read-only material at a position. Never creates state. */
  readMaterialAt(x: number, y: number, z: number): SoilCell {
    const key = voxelKeyOf({ x, y, z });
    const existing = this.changes.get(voxelKeyText(key));
    if (existing) return existing.cell;
    return this.initialMaterial(
      (key.ix + 0.5) * VOXEL_SIZE,
      (key.iy + 0.5) * VOXEL_SIZE,
      (key.iz + 0.5) * VOXEL_SIZE
    );
  }

  sample(x: number, y: number, z: number): SoilSample {
    const key = voxelKeyOf({ x, y, z });
    const text = voxelKeyText(key);
    const existing = this.changes.get(text);
    const material = existing
      ? { ...existing.cell }
      : this.initialMaterial(
          (key.ix + 0.5) * VOXEL_SIZE,
          (key.iy + 0.5) * VOXEL_SIZE,
          (key.iz + 0.5) * VOXEL_SIZE
        );
    const tableDepth = this.waterTableDepthCm(x, y);
    const depthCm = depthCmAt(this.region, x, y, z);
    const t = clamp((depthCm - tableDepth + WATER_FRINGE_CM) / WATER_FRINGE_CM, 0, 1);
    return {
      position: { x, y, z },
      key,
      keyText: text,
      standId: standIdOf(this.region, x, y),
      depthCm,
      saturation: smoothstep(t),
      groundwaterZ: this.groundwaterElevationAt(x, y),
      waterTableDepthCm: tableDepth,
      material,
      changed: Boolean(existing),
    };
  }

  /**
   * The same physical voxel seen from a named stand.
   *
   * The stand id is accepted and then deliberately ignored: it is carried so a
   * caller can prove the point, not so the volume can vary its answer.
   */
  sampleIn(_standId: number, x: number, y: number, z: number): SoilSample {
    return this.sample(x, y, z);
  }

  // -------------------------------------------------------------------------
  // Passability and traversal
  // -------------------------------------------------------------------------

  /** Why a single voxel refuses a hypha, or null when it does not. */
  blockAt(x: number, y: number, z: number): SoilBlock {
    const key = voxelKeyOf({ x, y, z });
    const depthCm = depthCmAt(this.region, x, y, z);
    if (standIdOf(this.region, x, y) === null) {
      return { blocked: true, reason: 'outside', at: key, depthCm };
    }
    const material = this.readMaterialAt(x, y, z);
    if (material.stratum === 'bedrock') return { blocked: true, reason: 'bedrock', at: key, depthCm };
    if (this.inChannel(x, y, z)) return { blocked: true, reason: 'stream', at: key, depthCm };
    if (depthCm > this.waterTableDepthCm(x, y)) {
      return { blocked: true, reason: 'groundwater', at: key, depthCm };
    }
    return { blocked: false, reason: null, at: key, depthCm };
  }

  passableAt(x: number, y: number, z: number): boolean {
    return !this.blockAt(x, y, z).blocked;
  }

  /**
   * Whether a whole segment is passable.
   *
   * Every voxel the segment crosses is tested, not the endpoint: a strand that
   * runs diagonally through a stand corner, a thin bed of stone or the stream
   * cannot tunnel past it by landing on the far side.
   */
  segment(from: Vec3, to: Vec3): SoilBlock {
    let last: SoilBlock | null = null;
    for (const key of traverseSegment(from, to)) {
      const x = (key.ix + 0.5) * VOXEL_SIZE;
      const y = (key.iy + 0.5) * VOXEL_SIZE;
      const z = (key.iz + 0.5) * VOXEL_SIZE;
      const block = this.blockAt(x, y, z);
      if (block.blocked) return block;
      last = block;
    }
    return last ?? { blocked: false, reason: null, at: null, depthCm: 0 };
  }

  // -------------------------------------------------------------------------
  // The simulation's own cadence
  // -------------------------------------------------------------------------

  /**
   * Advance the changed cells on the soil's own beat.
   *
   * Work is bounded by what has been disturbed, never by the volume's size, and
   * the order is the canonical key order so two runs of the same seed with the
   * same history produce the same numbers. Returns how many cells were visited,
   * which is the number the performance gate wants to record.
   */
  step(dt: number, env: Partial<SoilEnvironment> = {}): number {
    this.setEnvironment(env);
    this.time += dt;
    const organicRate = Math.min(1, dt * ECON.organicRegrowth * (0.3 + this.environment.litterfall * 1.7));
    const mineralRate = Math.min(1, dt * ECON.soilMineralisation);
    const waterRate = Math.min(1, dt * 0.35);
    let visits = 0;
    for (const { key, cell } of this.sortedChanges()) {
      visits++;
      if (cell.stratum !== 'bedrock') {
        const base = STRATA[cell.stratum];
        if (cell.organic < base.organic) {
          cell.organic += (base.organic - cell.organic) * organicRate;
        }
        const ceiling = cell.nitrogenBase * (0.35 + cell.organic * 0.85);
        if (cell.nitrogen < ceiling) {
          cell.nitrogen += (ceiling - cell.nitrogen) * mineralRate;
        }
      }
      const x = (key.ix + 0.5) * VOXEL_SIZE;
      const y = (key.iy + 0.5) * VOXEL_SIZE;
      const z = (key.iz + 0.5) * VOXEL_SIZE;
      const target = this.waterTarget(x, y, z, cell);
      cell.water += (target - cell.water) * waterRate;
    }
    return visits;
  }

  private sortedChanges(): ChangedCell[] {
    const entries = [...this.changes.values()];
    entries.sort(
      (a, b) =>
        a.key.ix - b.key.ix || a.key.iy - b.key.iy || a.key.iz - b.key.iz
    );
    return entries;
  }

  /** A stable digest of everything the simulation has changed. */
  hash(): string {
    const parts: Array<string | number> = [];
    for (const { key, cell } of this.sortedChanges()) {
      parts.push(
        voxelKeyText(key),
        cell.stratum,
        cell.organic,
        cell.nitrogen,
        cell.water,
        cell.occupancy
      );
    }
    return `${SOIL_VOLUME_VERSION}:${hashParts(parts)}`;
  }

  // -------------------------------------------------------------------------
  // Slices
  // -------------------------------------------------------------------------

  /**
   * Sample a vertical section.
   *
   * This is a view over the one volume, not a copy of it: two sections that both
   * cross a depleted voxel report the same depletion, and taking a slice does
   * not add anything to the state hash.
   */
  sampleSection(spec: SectionSpec): SoilSample[] {
    const samples: SoilSample[] = [];
    const across = Math.max(1, Math.floor(spec.across));
    const down = Math.max(1, Math.floor(spec.down));
    for (let column = 0; column < across; column++) {
      const t = across === 1 ? 0 : column / (across - 1);
      const x = spec.xFrom + (spec.xTo - spec.xFrom) * t;
      for (let row = 0; row < down; row++) {
        const s = down === 1 ? 0 : row / (down - 1);
        const depthCm = spec.depthFromCm + (spec.depthToCm - spec.depthFromCm) * s;
        const z = elevationAtDepthCm(this.region, x, spec.y, depthCm);
        samples.push(this.sample(x, spec.y, z));
      }
    }
    return samples;
  }
}

function standIdOf(region: Region, x: number, y: number): number | null {
  return standIdAt(region, x, y);
}

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
