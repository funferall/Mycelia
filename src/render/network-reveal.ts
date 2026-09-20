/**
 * The forest network reveal (`VIEW-07`).
 *
 * The cheap version first, exactly as the plan orders it: a **surface
 * projection** of the real XYZ strands, sampled onto the region's own terrain
 * with a small rendering offset. It is a projection and says so - the strands
 * keep their real horizontal positions and their real depth is carried in the
 * data, in the colour weight and in what picking returns. True-depth
 * transparency is a later switch, not a pretence made here.
 *
 * What it refuses to do:
 *
 * - It never invents a strand, a node or a stand. Edges come from the colony's
 *   own parent links, and toggling the reveal changes no simulation state.
 * - It never resolves a click by whichever mesh wins a raycast. Picking is a
 *   screen-space search over the projected polylines, and stacked strands are
 *   reported as alternatives with their own depths.
 * - It never drops a node to save detail. Distance lowers the number of samples
 *   along a drawn edge; the simulation's node list is untouched.
 */
import * as THREE from 'three';
import { GRID } from '../sim/content';
import type { Region } from '../sim/region';
import type { StandId, Vec3 } from '../sim/spatial';
import { sectionAnchor, type SectionSpec } from './sections';

/** How far above the terrain the projection floats, in region units. */
export const REVEAL_LIFT = 0.4;
/** Screen-space radius of a click, as a fraction of the viewport height. */
export const REVEAL_PICK_RADIUS = 0.018;
/** Two candidates closer than this in screen space count as stacked. */
const STACK_TOLERANCE = 0.25;

export interface RevealEdge {
  readonly key: string;
  readonly parent: number;
  readonly child: number;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly thickness: number;
  readonly reinforced: boolean;
  readonly connected: boolean;
  readonly standId: StandId;
  readonly parentStandId: StandId;
}

export interface ProjectedStrand {
  readonly key: string;
  readonly parent: number;
  readonly child: number;
  /** Terrain-hugging polyline in region coordinates, at the reveal's offset. */
  readonly points: Vec3[];
  /** Depth below the local ground at each sample, in centimetres. */
  readonly depthsCm: number[];
  /** The strand's own endpoints' true depths, for the readout and for picking. */
  readonly fromDepthCm: number;
  readonly toDepthCm: number;
  readonly thickness: number;
  readonly reinforced: boolean;
  readonly connected: boolean;
  readonly standId: StandId;
  readonly parentStandId: StandId;
}

export interface NdcPoint {
  x: number;
  y: number;
}

export interface RevealPick {
  readonly key: string;
  readonly child: number;
  readonly parent: number;
  /** Depth below the local ground at the picked point, in centimetres. */
  readonly depthCm: number;
  /** Screen distance in NDC units. */
  readonly distance: number;
  /** Other strands under the same click, nearest first. */
  readonly alternatives: number;
  readonly connected: boolean;
}

export const depthBelowGroundCm = (region: Region, point: Vec3): number =>
  (region.heightAt(point.x, point.y) - point.z) * GRID.cmPerRow;

/**
 * How many samples a strand is drawn with at this camera distance.
 *
 * Detail falls off with distance and never below a straight line; the strand's
 * own nodes are not affected.
 */
export function projectionSamples(distance: number): number {
  if (!Number.isFinite(distance)) return 8;
  // Two samples is a straight line: at the region overview the projection is a
  // set of those, and close up the same edges are followed properly.
  return Math.max(2, Math.min(24, 2 + Math.round(600 / Math.max(60, distance))));
}

/**
 * Project one strand onto the terrain.
 *
 * Horizontal positions are the simulation's own; the height is the region's
 * ground plus a small offset so the line is not swallowed by the floor. The
 * real depth is recorded per sample, which is what makes the projection honest
 * when it is used for colour weight and for picking.
 */
export function projectEdge(region: Region, edge: RevealEdge, samples = 8): ProjectedStrand {
  const count = Math.max(2, Math.min(64, Math.round(samples)));
  const points: Vec3[] = [];
  const depthsCm: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = edge.from.x + (edge.to.x - edge.from.x) * t;
    const y = edge.from.y + (edge.to.y - edge.from.y) * t;
    const realZ = edge.from.z + (edge.to.z - edge.from.z) * t;
    points.push({ x, y, z: region.heightAt(x, y) + REVEAL_LIFT });
    // The recorded depth is the strand's own, not the drawn offset's: the
    // projection may float above the ground, the data may not lie about it.
    depthsCm.push((region.heightAt(x, y) - realZ) * GRID.cmPerRow);
  }
  return {
    key: edge.key,
    parent: edge.parent,
    child: edge.child,
    points,
    depthsCm,
    fromDepthCm: depthBelowGroundCm(region, edge.from),
    toDepthCm: depthBelowGroundCm(region, edge.to),
    thickness: edge.thickness,
    reinforced: edge.reinforced,
    connected: edge.connected,
    standId: edge.standId,
    parentStandId: edge.parentStandId,
  };
}

export function projectEdges(region: Region, edges: readonly RevealEdge[], distance = Infinity): ProjectedStrand[] {
  const samples = projectionSamples(distance);
  return edges.map((edge) => projectEdge(region, edge, samples));
}

/**
 * Where a click lands among the projected strands.
 *
 * Candidates are ranked by screen distance. When more than one strand is under
 * the same click, the shallowest is returned and the count of alternatives is
 * reported, so a stacked pair is a fact the player can see rather than a coin
 * toss between two meshes.
 */
export function pickStrand(
  strands: readonly ProjectedStrand[],
  project: (point: Vec3) => NdcPoint | null,
  target: NdcPoint,
  radius = REVEAL_PICK_RADIUS
): RevealPick | null {
  const hits: Array<RevealPick & { depthKey: number }> = [];
  for (const strand of strands) {
    let best: { distance: number; depthCm: number } | null = null;
    for (let i = 0; i < strand.points.length; i++) {
      const ndc = project(strand.points[i] as Vec3);
      if (!ndc) continue;
      const distance = Math.hypot(ndc.x - target.x, ndc.y - target.y);
      if (distance > radius) continue;
      const depthCm = strand.depthsCm[i] ?? 0;
      if (!best || distance < best.distance) best = { distance, depthCm };
    }
    if (!best) continue;
    hits.push({
      key: strand.key,
      child: strand.child,
      parent: strand.parent,
      depthCm: best.depthCm,
      distance: best.distance,
      alternatives: 0,
      connected: strand.connected,
      depthKey: best.depthCm,
    });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const nearest = hits[0] as RevealPick & { depthKey: number };
  // Everything within a small band of the nearest hit is "under the same click".
  const stacked = hits.filter((hit) => hit.distance <= nearest.distance + radius * STACK_TOLERANCE);
  // Of those, the shallowest wins: the strand closest to the surface is the one
  // a player pointing at the ground is most likely asking about.
  stacked.sort((a, b) => a.depthCm - b.depthCm || a.distance - b.distance);
  const chosen = stacked[0] as RevealPick & { depthKey: number };
  return {
    key: chosen.key,
    child: chosen.child,
    parent: chosen.parent,
    depthCm: chosen.depthCm,
    distance: chosen.distance,
    alternatives: Math.max(0, stacked.length - 1),
    connected: chosen.connected,
  };
}

interface RevealBatch {
  readonly mesh: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

/**
 * The drawn projection.
 *
 * One `LineSegments` buffer for the whole region: colour weight carries depth
 * and connectedness, and a disconnected remnant is drawn as a *double* line so
 * it reads without relying on hue. The slice marker is a second, smaller
 * buffer that shows where the last inspected section cuts the terrain.
 */
export class NetworkReveal {
  readonly group = new THREE.Group();
  private readonly region: Region;
  private strands: ProjectedStrand[] = [];
  private strandsBatch: RevealBatch | null = null;
  private sliceBatch: RevealBatch | null = null;
  private shown = false;
  private dirty = true;
  private samples = 8;
  private sliceSpec: SectionSpec | null = null;

  constructor(region: Region) {
    this.region = region;
    this.group.visible = false;
    this.group.renderOrder = 4;
  }

  setEdges(edges: readonly RevealEdge[], cameraDistance = Infinity): void {
    this.samples = projectionSamples(cameraDistance);
    this.strands = projectEdges(this.region, edges, cameraDistance);
    this.dirty = true;
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.group.visible = visible;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** The section whose cut through the terrain is marked, or null. */
  setSlice(spec: SectionSpec | null): void {
    if (this.sliceSpec?.id === spec?.id) return;
    this.sliceSpec = spec;
    this.buildSlice();
  }

  /** Distance-driven detail only: the strand list itself never thins. */
  update(cameraDistance: number, blend: number, reduced: boolean): void {
    const samples = projectionSamples(cameraDistance);
    if (samples !== this.samples) {
      this.samples = samples;
      this.strands = this.strands.map((strand) => ({
        ...strand,
        points: resample(strand, samples),
      }));
      this.dirty = true;
    }
    if (this.dirty || !this.strandsBatch) this.buildStrands();
    const visible = this.shown && blend > 0.55;
    if (this.strandsBatch) this.strandsBatch.mesh.visible = visible;
    if (this.sliceBatch) this.sliceBatch.mesh.visible = visible && !reduced;
  }

  report(): { visible: boolean; strands: number; samples: number; draws: number; slice: string | null } {
    let draws = 0;
    if (this.strandsBatch?.mesh.visible) draws++;
    if (this.sliceBatch?.mesh.visible) draws++;
    return {
      visible: this.shown,
      strands: this.strands.length,
      samples: this.samples,
      draws,
      slice: this.sliceSpec?.id ?? null,
    };
  }

  /** What a click selects, or null when the click is not on a strand. */
  pick(
    project: (point: Vec3) => NdcPoint | null,
    target: NdcPoint,
    radius = REVEAL_PICK_RADIUS
  ): RevealPick | null {
    if (!this.shown) return null;
    return pickStrand(this.strands, project, target, radius);
  }

  strandFor(key: string): ProjectedStrand | null {
    return this.strands.find((strand) => strand.key === key) ?? null;
  }

  dispose(): void {
    for (const batch of [this.strandsBatch, this.sliceBatch]) {
      if (!batch) continue;
      this.group.remove(batch.mesh);
      batch.mesh.geometry.dispose();
      batch.mesh.material.dispose();
    }
    this.strandsBatch = null;
    this.sliceBatch = null;
  }

  // -------------------------------------------------------------------------

  private buildStrands(): void {
    this.dirty = false;
    const positions: number[] = [];
    const colours: number[] = [];
    for (const strand of this.strands) {
      // Connected strands are one line; a severed remnant is a double line, so
      // "this piece is cut off" is legible without depending on colour.
      const offsets = strand.connected ? [0] : [-0.5, 0.5];
      for (const offset of offsets) {
        for (let i = 1; i < strand.points.length; i++) {
          const a = strand.points[i - 1] as Vec3;
          const b = strand.points[i] as Vec3;
          pushPoint(positions, colours, a, offset, strand, i - 1);
          pushPoint(positions, colours, b, offset, strand, i);
        }
      }
    }
    this.strandsBatch = this.replaceBatch(
      this.strandsBatch,
      new Float32Array(positions),
      new Float32Array(colours)
    );
  }

  /**
   * The slice marker: the line where the inspected section meets the ground,
   * and a short tick down its plane. It says where the last section cut the
   * forest without drawing a floating dashboard.
   */
  private buildSlice(): void {
    if (!this.sliceSpec) {
      if (this.sliceBatch) {
        this.group.remove(this.sliceBatch.mesh);
        this.sliceBatch.mesh.geometry.dispose();
        this.sliceBatch.mesh.material.dispose();
        this.sliceBatch = null;
      }
      return;
    }
    const spec = this.sliceSpec;
    const positions: number[] = [];
    const colours: number[] = [];
    const step = Math.max(2, (spec.alongTo - spec.alongFrom) / 24);
    const at = (along: number): Vec3 => {
      const pointX = spec.plane.along === 'x' ? along : spec.plane.fixed;
      const pointY = spec.plane.along === 'x' ? spec.plane.fixed : along;
      return { x: pointX, y: pointY, z: this.region.heightAt(pointX, pointY) + REVEAL_LIFT * 1.6 };
    };
    for (let along = spec.alongFrom; along < spec.alongTo; along += step) {
      const a = at(along);
      const b = at(Math.min(spec.alongTo, along + step));
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      for (let i = 0; i < 2; i++) colours.push(1, 0.86, 0.62);
    }
    const anchor = sectionAnchor(this.region, spec);
    const top = { x: anchor.x, y: anchor.y, z: this.region.heightAt(anchor.x, anchor.y) + REVEAL_LIFT * 1.6 };
    const bottom = { x: anchor.x, y: anchor.y, z: anchor.z };
    positions.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z);
    colours.push(1, 0.72, 0.36, 0.85, 0.5, 0.2);
    this.sliceBatch = this.replaceBatch(this.sliceBatch, new Float32Array(positions), new Float32Array(colours));
  }

  private replaceBatch(existing: RevealBatch | null, positions: Float32Array, colours: Float32Array): RevealBatch {
    if (existing) {
      this.group.remove(existing.mesh);
      existing.mesh.geometry.dispose();
      existing.mesh.material.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = true;
    mesh.visible = this.shown;
    this.group.add(mesh);
    return { mesh };
  }
}

/** Resample a strand's polyline without touching its nodes or its depth data. */
function resample(strand: ProjectedStrand, samples: number): Vec3[] {
  const points: Vec3[] = [];
  const count = Math.max(2, samples);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const source = t * (strand.points.length - 1);
    const low = Math.floor(source);
    const high = Math.min(strand.points.length - 1, low + 1);
    const f = source - low;
    const a = strand.points[low] as Vec3;
    const b = strand.points[high] as Vec3;
    points.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
  }
  return points;
}

/**
 * How bright one sample of the projection is drawn.
 *
 * Exported so the rule can be checked without a renderer: deeper is dimmer,
 * and a severed or hair-fine strand is dimmer again.
 */
export function strandWeight(depthCm: number, connected: boolean, reinforced: boolean): number {
  const depthWeight = 1 - Math.min(0.55, Math.max(0, depthCm) / 140);
  return (connected ? 1 : 0.55) * depthWeight * (reinforced ? 1 : 0.82);
}

/**
 * One vertex of the projection.
 *
 * Depth drives brightness (a deep strand is dimmer than a shallow one),
 * thickness and reinforcement drive it again, and a severed strand is dimmed
 * further - never alone, because it is also drawn as a double line.
 */
function pushPoint(
  positions: number[],
  colours: number[],
  point: Vec3,
  offset: number,
  strand: ProjectedStrand,
  index: number
): void {
  const depthCm = Math.max(0, strand.depthsCm[Math.min(index, strand.depthsCm.length - 1)] ?? 0);
  const weight = strandWeight(depthCm, strand.connected, strand.reinforced);
  const perpendicular = offset / Math.max(1, strand.points.length);
  positions.push(point.x, point.y, point.z + perpendicular * 0.9);
  // Amber, restrained: the reveal is a reading of the ground, not a light show.
  colours.push(1 * weight, 0.62 * weight, 0.28 * weight);
}
