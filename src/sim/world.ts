import {
  ECON,
  GRID,
  HORIZON_PROFILE,
  MAX_DEPTH_CM,
  SPECIES,
  STRATA,
  type Stratum,
  type StratumId,
  type TreeSpeciesId,
} from './content';
import { makeNoise2D, mulberry32, range, type Rng } from './rng';

export interface SoilCell {
  stratum: StratumId;
  /** Decomposable matter, 0..1. Feeds saprotrophs and decomposer blooms. */
  organic: number;
  /** Nitrogen and phosphorus available for uptake, 0..1. */
  nitrogen: number;
  /**
   * What this horizon can rebuild its nitrogen up to. A function of the parent
   * material and the organic matter standing in it, so stripped soil recovers
   * only where the forest is still dropping litter on it.
   */
  nitrogenBase: number;
  /** Soil moisture, 0..1, recomputed each tick from depth and rainfall. */
  water: number;
  /** Stone and aggregate fraction, 0..1. Visual grit and growth friction. */
  hardness: number;
  /** How much hypha is packed into this cell, 0..1. Drives rendering density. */
  occupancy: number;
}

export interface RootTip {
  id: number;
  /** Grid coordinates of the root tip. */
  gx: number;
  gy: number;
  /** Node id once a hypha has bonded here, otherwise null. */
  bondedTo: number | null;
}

export interface Tree {
  id: number;
  species: TreeSpeciesId;
  /** Horizontal position in grid columns. */
  gx: number;
  /** Trunk height above the soil surface, in grid rows (for the canopy view). */
  height: number;
  /** 0..1. Falls under drought, rot, and unmet trade. */
  health: number;
  /** 0..1. Saplings grow into full trees and add root tips. */
  maturity: number;
  /** Seconds remaining before an unsatisfied tree severs its bond. */
  patience: number;
  waterReceived: number;
  nutrientReceived: number;
  rootTips: RootTip[];
  /** Set when the tree has died and become decomposable matter. */
  dead: boolean;
  seed: number;
}

export interface World {
  seed: number;
  cols: number;
  rows: number;
  /** Row-major: index = gy * cols + gx. */
  cells: SoilCell[];
  /** Depth of the water table in centimetres. Lower means deeper. */
  waterTableCm: number;
  /** Rainfall multiplier for the current tick, set by the season. */
  rainfall: number;
  /** Leaf fall for the current tick, 0..1, set by the season. */
  litterfall: number;
  trees: Tree[];
  /** Carbon-equivalent in living tree biomass — the forest's own scoreboard. */
  forestBiomass: number;
}

export const idx = (gx: number, gy: number): number => gy * GRID.cols + gx;

export const inBounds = (gx: number, gy: number): boolean =>
  gx >= 0 && gy >= 0 && gx < GRID.cols && gy < GRID.rows;

export const cellAt = (world: World, gx: number, gy: number): SoilCell | null =>
  inBounds(gx, gy) ? (world.cells[idx(gx, gy)] as SoilCell) : null;

export const stratumOf = (world: World, gx: number, gy: number): Stratum => {
  const cell = cellAt(world, gx, gy);
  return STRATA[cell ? cell.stratum : 'bedrock'];
};

/** Depth of the top of a row, in centimetres below the surface. */
export const rowDepthCm = (gy: number): number => (gy + 0.5) * GRID.cmPerRow;

/** Grid row nearest a given depth in centimetres. */
export const rowAtDepthCm = (cm: number): number =>
  Math.max(0, Math.min(GRID.rows - 1, Math.round(cm / GRID.cmPerRow - 0.5)));

function stratumAtDepth(cm: number): StratumId {
  for (const band of HORIZON_PROFILE) {
    if (cm <= band.depthCm) return band.id;
  }
  return 'bedrock';
}

/**
 * Generate one map: a soil transect with warped horizon boundaries, organic
 * pockets in the litter, mineral veins in the stone, and a water table.
 */
export function createWorld(seed: number): World {
  const rng: Rng = mulberry32(seed);
  const warp = makeNoise2D(seed ^ 0x9e3779b9, 4, 0.035);
  const pocket = makeNoise2D(seed ^ 0x51ed270b, 5, 0.11);
  const vein = makeNoise2D(seed ^ 0x1b873593, 3, 0.19);

  const cells: SoilCell[] = new Array(GRID.cols * GRID.rows);
  for (let gy = 0; gy < GRID.rows; gy++) {
    for (let gx = 0; gx < GRID.cols; gx++) {
      // Warp the horizon boundary so strata undulate like real soil rather than
      // reading as painted stripes. Deeper bands warp more than surface ones.
      const depthCm = rowDepthCm(gy);
      const warpAmount = (warp(gx, gy * 0.6) - 0.5) * (6 + depthCm * 0.22);
      const stratum = stratumAtDepth(Math.max(0, depthCm + warpAmount));
      const base = STRATA[stratum];

      const organicNoise = pocket(gx, gy);
      const veinNoise = vein(gx, gy);

      cells[idx(gx, gy)] = {
        stratum,
        organic: Math.max(0, base.organic * (0.55 + organicNoise * 0.9)),
        nitrogen: Math.max(0, base.nitrogen * (0.6 + organicNoise * 0.8)),
        nitrogenBase: Math.max(0, base.nitrogen * (0.6 + organicNoise * 0.8)),
        water: 0,
        hardness: Math.max(0, Math.min(1, base.hardness * (0.7 + veinNoise * 0.6))),
        occupancy: 0,
      };
    }
  }

  const world: World = {
    seed,
    cols: GRID.cols,
    rows: GRID.rows,
    cells,
    waterTableCm: MAX_DEPTH_CM * 0.66,
    rainfall: 1,
    litterfall: 0.25,
    trees: [],
    forestBiomass: 0,
  };

  seedForest(world, rng);
  updateMoisture(world, 0);
  return world;
}

/**
 * Place a stand of trees. Species mix leans on depth-to-water: birch tolerates
 * the wet hollows, oak wants the well-drained rises, hemlock fills the shade.
 */
function seedForest(world: World, rng: Rng): void {
  const count = 7 + Math.floor(rng() * 4);
  const spacing = world.cols / count;

  for (let i = 0; i < count; i++) {
    const gx = Math.round(spacing * (i + 0.5) + range(rng, -spacing * 0.22, spacing * 0.22));
    if (gx < 4 || gx >= world.cols - 4) continue;
    if (world.trees.some((t) => Math.abs(t.gx - gx) < spacing * 0.55)) continue;

    const roll = rng();
    const species: TreeSpeciesId = roll < 0.45 ? 'oak' : roll < 0.8 ? 'birch' : 'hemlock';
    const spec = SPECIES[species];
    const height = Math.round(range(rng, 14, 26) * (species === 'oak' ? 1.15 : 1));
    const maturity = range(rng, 0.55, 1);

    world.trees.push({
      id: world.trees.length,
      species,
      gx,
      height,
      health: range(rng, 0.82, 1),
      maturity,
      patience: spec.patience,
      waterReceived: 0,
      nutrientReceived: 0,
      rootTips: makeRootTips(world, gx, spec.rootDepthCm, rng),
      dead: false,
      seed: Math.floor(rng() * 0xffffffff),
    });
  }
}

/**
 * A root system is a handful of tips scattered through the soil beneath the
 * trunk — these are the only places a hypha can form a symbiosis.
 */
function makeRootTips(world: World, gx: number, depthCm: number, rng: Rng): RootTip[] {
  const count = 3 + Math.floor(rng() * 3);
  const tips: RootTip[] = [];
  for (let i = 0; i < count; i++) {
    const spread = 3 + i * 2.6;
    const tipGx = Math.round(gx + range(rng, -spread, spread));
    const tipGy = Math.round(
      rowAtDepthCm(range(rng, depthCm * 0.35, depthCm)) + range(rng, -3, 3)
    );
    if (!inBounds(tipGx, tipGy)) continue;
    if (world.cells[idx(tipGx, tipGy)]?.stratum === 'bedrock') continue;
    tips.push({ id: tips.length, gx: tipGx, gy: tipGy, bondedTo: null });
  }
  return tips;
}

/**
 * Recompute soil moisture from depth, material, the water table and rainfall.
 * Sand drains, clay holds, and everything below the water table is saturated.
 */
export function updateMoisture(world: World, dtSeconds: number): void {
  const tableRow = rowAtDepthCm(world.waterTableCm);
  // Rainfall soaks downward slowly; model it as a bias rather than a full
  // percolation solve, which the prototype does not need.
  const rain = Math.max(0, Math.min(2.2, world.rainfall));

  for (let gy = 0; gy < world.rows; gy++) {
    const depthCm = rowDepthCm(gy);
    // Proximity to the water table, 0 far above it to 1 at or below it.
    const belowTable = gy >= tableRow;
    const proximity = belowTable ? 1 : Math.max(0, 1 - (tableRow - gy) / 34);
    for (let gx = 0; gx < world.cols; gx++) {
      const cell = world.cells[idx(gx, gy)] as SoilCell;
      const base = STRATA[cell.stratum];
      // Surface layers get the rain directly; deep layers only reach the table.
      const surfaceBias = rain * Math.exp(-depthCm / 26) * 0.85;
      const target = Math.min(
        1,
        proximity * 1.05 * base.waterHolding + surfaceBias * base.waterHolding
      );
      // Move toward the target rather than snapping, so a drought reads as a
      // gradual drying rather than a step change.
      const rate = dtSeconds <= 0 ? 1 : Math.min(1, dtSeconds * 0.35);
      cell.water += (target - cell.water) * rate;
    }
  }
}

/**
 * The soil's own slow metabolism.
 *
 * Two things happen on this beat. Organic matter is rebuilt, heavily in
 * autumn litterfall and barely in winter, and nitrogen is mineralised back into
 * the horizon up to a ceiling its organic content supports. Without this, a
 * network sitting still strips its own address of every mineral within a few
 * minutes and then starves next to soil that still looks rich.
 *
 * @param litterfall the current season's leaf fall, 0..1
 */
export function updateSoil(world: World, dtSeconds: number, litterfall: number): void {
  const organicRate = Math.min(1, dtSeconds * ECON.organicRegrowth * (0.3 + litterfall * 1.7));
  const mineralRate = Math.min(1, dtSeconds * ECON.soilMineralisation);
  for (const cell of world.cells) {
    if (cell.stratum === 'bedrock') continue;
    const base = STRATA[cell.stratum];
    if (cell.organic < base.organic) {
      cell.organic += (base.organic - cell.organic) * organicRate;
    }
    const ceiling = cell.nitrogenBase * (0.35 + cell.organic * 0.85);
    if (cell.nitrogen < ceiling) {
      cell.nitrogen += (ceiling - cell.nitrogen) * mineralRate;
    }
  }
}

/** Total nitrogen standing in the soil — used by the label block readout. */
export function soilNitrogen(world: World): number {
  let total = 0;
  for (const cell of world.cells) total += cell.nitrogen;
  return total;
}
