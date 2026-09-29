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
import type { Vec3 } from './spatial';

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
  /**
   * True in the open channel of a stream: from the surface down to the bed this
   * is water and air rather than soil, and hyphae cannot grow into it. The bank
   * beside it is wet, reachable ground. Soil beneath the bed is only passable
   * once the water table recedes below it.
   */
  stream: boolean;
  /** 0..1 dampness from the stream: 1 in the channel, fading over the bank. */
  streamNear: number;
  /** Under floodwater (see `flood.ts`): waterlogged, and closed to growth. */
  flooded?: boolean;
}

export interface RootTip {
  id: number;
  /** Grid coordinates of the root tip. */
  gx: number;
  gy: number;
  /** Node id once a hypha has bonded here, otherwise null. */
  bondedTo: number | null;
  /** Which independent colony owns `bondedTo`; null for a standalone match. */
  bondedColonyId?: string | null;
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
  /** Set when a storm threw the tree down: which way it fell and when. */
  fallen?: { direction: number; at: number };
  /**
   * Set when a wildfire killed the tree (or burned its snag). `remains` says
   * what it left: a charred snag standing, or a charred log where it fell.
   * `biomass` is what the remains hold for the soil (wildfire v2, W2).
   */
  burned?: { at: number; remains?: 'snag' | 'log'; biomass?: number };
  /** Set when a ground fire passed without killing the tree: a scarred trunk. */
  scorched?: { at: number };
  /**
   * 0..1, how well watered the tree has been lately: mostly the water its
   * mycorrhizal partners deliver, partly the soil at its roots. Smoothed over
   * about 40 s, so a last-second watering is not armour. Fire reads it
   * (wildfire v2): a well-fed tree resists, an unfed one is kindling.
   * Absent until the tree's stand is first stepped; `treeHydration` falls
   * back to the soil alone.
   */
  hydration?: number;
  /** Set when a drought killed the tree: it stands dead, bleached and leafless. */
  parched?: { at: number };
  /** Set when floodwater drowned the tree's roots. */
  drowned?: { at: number };
  seed: number;
}

/** A 3D position in simulation space. See `src/sim/spatial.ts` for the rules. */
export interface NodePosition {
  x: number;
  y: number;
  z: number;
}

/**
 * The part of a node a world lookup needs to know.
 *
 * `gx`/`gy` are a founder-relative column and a depth row. Once bound to a
 * region, `y` is the second horizontal coordinate and `lateral` is its smooth
 * moving position; a standalone transect leaves both at zero.
 */
export interface PositionedNode {
  gx: number;
  gy: number;
  /** Stand this strand stands in, or -1 on a single-stand world. */
  standId: number;
  /** Continuous position within the growth plane; tips glide between cells. */
  wx: number;
  wy: number;
  y: number;
  lateral?: number;
}

/**
 * What a fungal network needs from the ground it grows in.
 *
 * There are two implementations and one economy. `createStandWorld` below is
 * the flat two-dimensional transect the prototype has always used; the region's
 * shared soil volume implements the same interface for a colony that crosses
 * stand boundaries. Growth, harvest, decay and bonding all go through these
 * calls, so a regional strand is not a second species with its own rules.
 */
export interface NetworkWorld {
  /** Every tree this colony can reach, in one stable table. */
  readonly trees: Tree[];
  /** Current rainfall multiplier, read by fruiting. */
  readonly rainfall: number;
  /** Read-only material `dx`/`dy` steps from a node's own cell. */
  cellFrom(node: PositionedNode, dx: number, dy: number, lateral?: number): SoilCell | null;
  /** Material at a node's own committed cell; writing to it records a change. */
  cellOf(node: PositionedNode): SoilCell | null;
  /** Whether a hypha may occupy a neighbouring cell. */
  passableFrom(node: PositionedNode, dx: number, dy: number, lateral?: number): boolean;
  /** Resistance and material of a neighbouring cell. */
  costFrom(node: PositionedNode, dx: number, dy: number, lateral?: number): { cost: number; stratum: Stratum };
  /** Regional worlds can choose real neighbours in the third spatial axis. */
  readonly spatialGrowth?: boolean;
  /** A node's own position, in simulation space. */
  nodePosition(node: PositionedNode): NodePosition;
  /** Where a root tip actually is, in simulation space. */
  rootTipPosition(tree: Tree, tip: RootTip): NodePosition;
  /** Called once when a tip arrives, so a spatial world can re-bucket it. */
  commit(node: PositionedNode): void;
}

export interface World extends NetworkWorld {
  /** Canonical regional soil slice when this transect belongs to a match. */
  regionalSoil?: {
    standId: number;
    blockAt(gx: number, gy: number): 'outside' | 'bedrock' | 'stream' | 'groundwater' | null;
    pointAt(gx: number, gy: number): Vec3 | null;
  };
  seed: number;
  cols: number;
  rows: number;
  /** Row-major: index = gy * cols + gx. */
  cells: SoilCell[];
  /** Depth of the water table in centimetres. Larger means deeper. */
  waterTableCm: number;
  /**
   * The depth this stand's water table settles to in an ordinary season.
   * Regional: a stream corridor sits above a shallow one, a ridge above a deep
   * one, and the weather moves it from there.
   */
  waterTableBaseCm: number;
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

/** Moist capillary fringe above the oxygen-poor, saturated ground. */
export const WATER_FRINGE_CM = 8;

/** Shared by soil colour and growth: the upper fringe is reachable. */
/** Seconds over which a tree's hydration follows its supply. */
export const HYDRATION_SECONDS = 40;

/** Soil water where a tree actually roots, with the stream's dampness. */
export function rootSoilWater(world: World, tree: Tree): number {
  const spec = SPECIES[tree.species];
  const row = Math.min(GRID.rows - 1, rowAtDepthCm(spec.rootDepthCm * 0.5));
  const cell = world.cells[idx(tree.gx, row)];
  if (!cell) return 0;
  return Math.max(0, Math.min(1, cell.water + cell.streamNear * 0.5));
}

/** What a tree's hydration is heading toward: its partners' water first, then the soil. */
export function hydrationTarget(world: World, tree: Tree): number {
  if (tree.dead || tree.parched) return 0;
  const bonded = tree.rootTips.some((tip) => tip.bondedTo !== null);
  const bondWater = bonded ? Math.max(0, Math.min(1, tree.waterReceived)) : 0;
  return 0.6 * bondWater + 0.4 * rootSoilWater(world, tree);
}

/** Move a tree's hydration toward its target over one step. */
export function stepHydration(world: World, tree: Tree, dt: number): void {
  const target = hydrationTarget(world, tree);
  const current = tree.hydration ?? target;
  tree.hydration = current + (target - current) * (1 - Math.exp(-dt / HYDRATION_SECONDS));
}

/** A tree's hydration now, falling back to the soil alone before it is first stepped. */
export function treeHydration(world: World, tree: Tree): number {
  return tree.hydration ?? hydrationTarget(world, tree);
}

export function groundwaterSaturation(world: World, depthCm: number): number {
  const t = Math.max(0, Math.min(1, (depthCm - world.waterTableCm + WATER_FRINGE_CM) / WATER_FRINGE_CM));
  return t * t * (3 - 2 * t);
}

export const belowWaterTable = (world: World, gy: number): boolean =>
  rowDepthCm(gy) > world.waterTableCm;

/**
 * The shared growth rule.
 *
 * Bedrock and open water both refuse hyphae, but for different reasons: rock is
 * impassable ground and the stream is not ground at all. Saturated ground also
 * stops extension, while the upper fringe stays reachable for water.
 */
export function passableAt(world: World, gx: number, gy: number): boolean {
  if (!inBounds(gx, gy)) return false;
  const cell = world.cells[idx(gx, gy)];
  // Floodwater closes the ground for as long as it stands, whichever soil backs it.
  if (cell?.flooded) return false;
  if (world.regionalSoil) return world.regionalSoil.blockAt(gx, gy) === null;
  return Boolean(cell) && cell.stratum !== 'bedrock' && !cell.stream && !belowWaterTable(world, gy);
}

/** Resistance of a cell and what entering it costs. One formula, every world. */
export function entryCostFor(cell: SoilCell | null | undefined): { cost: number; stratum: Stratum } {
  const stratum = STRATA[cell ? cell.stratum : 'bedrock'];
  // Hard, dense soil costs more; loose organic litter costs less.
  const hardness = cell ? cell.hardness : 1;
  const cost = stratum.growthCost * (0.75 + hardness * 0.7) * GRID.cmPerRow;
  return { cost, stratum };
}

export function entryCostAt(world: World, gx: number, gy: number): { cost: number; stratum: Stratum } {
  return entryCostFor(inBounds(gx, gy) ? world.cells[idx(gx, gy)] : undefined);
}

/** Which horizon a depth falls in, before the local warp is applied. */
export function stratumAtDepth(cm: number): StratumId {
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
  return createStandWorld(seed);
}

/** What a stand's site contributes to the soil beneath it. */
export interface StandConditions {
  /** Depth to the water table in an ordinary season, in centimetres. */
  waterTableCm?: number;
  /**
   * The region's stream where it crosses this stand, in local grid columns.
   * Omitted on dry ground, and on the standalone prototype stand, which has
   * never had a region to put a stream in it.
   */
  stream?: { centreGx: number; widthGx: number } | null;
  /**
   * Species mix as cumulative thresholds: rolls below the first are oak, below
   * the second are birch, the rest hemlock. The default is the mixed stand the
   * prototype has always drawn.
   */
  mix?: [number, number];
}

/**
 * Generate one stand's soil.
 *
 * The local noise is the stand's own: which horizons undulate where, where the
 * organic pockets and mineral veins sit. What comes from the region is where
 * the water stands and what the canopy is made of, because neither is a
 * property of a square of ground on its own.
 */
export function createStandWorld(seed: number, conditions: StandConditions = {}): World {
  const rng: Rng = mulberry32(seed);
  const warp = makeNoise2D(seed ^ 0x9e3779b9, 4, 0.035);
  const pocket = makeNoise2D(seed ^ 0x51ed270b, 5, 0.11);
  const vein = makeNoise2D(seed ^ 0x1b873593, 3, 0.19);
  const baseCm = Math.max(14, Math.min(MAX_DEPTH_CM - 4, conditions.waterTableCm ?? MAX_DEPTH_CM * 0.66));
  const mix: [number, number] = conditions.mix ?? [0.45, 0.8];

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
        stream: false,
        streamNear: 0,
      };
    }
  }

  if (conditions.stream) carveStream(cells, conditions.stream.centreGx, conditions.stream.widthGx, baseCm);

  const world: World = {
    seed,
    cols: GRID.cols,
    rows: GRID.rows,
    cells,
    waterTableCm: baseCm,
    waterTableBaseCm: baseCm,
    rainfall: 1,
    litterfall: 0.25,
    trees: [],
    forestBiomass: 0,

    // The flat transect as a `NetworkWorld`. Its growth plane is (column,
    // depth); across-plane `y` is zero, and every node is in the same stand the
    // world already is, so arriving somewhere changes no bucket.
    cellFrom: (node, dx, dy) => cellAt(world, node.gx + dx, node.gy + dy),
    cellOf: (node) => cellAt(world, node.gx, node.gy),
    passableFrom: (node, dx, dy) => passableAt(world, node.gx + dx, node.gy + dy),
    costFrom: (node, dx, dy) => entryCostAt(world, node.gx + dx, node.gy + dy),
    nodePosition: (node) => ({ x: node.wx, y: node.wy, z: 0 }),
    rootTipPosition: (_tree, tip) => ({ x: tip.gx + 0.5, y: tip.gy + 0.5, z: 0 }),
    commit: () => {},
  };

  seedForest(world, rng, mix);
  updateMoisture(world, 0);
  return world;
}

/**
 * Cut a stream into a stand's transect.
 *
 * The channel is open ground from the surface down to its bed, which sits a
 * little below the local water table: a cross-section through a stream shows
 * air above the water line and water beneath it, so `stream` cells are water or
 * air rather than soil and the network cannot grow into them. Everything under
 * the bed is still soil; it becomes passable only when the water table recedes
 * beneath it. The capillary fringe remains reachable along the banks.
 *
 * The bank either side carries `streamNear`, so the soil beside the channel
 * holds more water than the same depth further away. That is the whole point of
 * the feature: hyphae cannot enter the stream, and do not need to, because the
 * ground next to it is the best water in the stand.
 */
function carveStream(cells: SoilCell[], centreGx: number, widthGx: number, waterTableCm: number): void {
  const half = widthGx / 2;
  const bedRow = rowAtDepthCm(Math.min(MAX_DEPTH_CM - 4, waterTableCm + 6));
  for (let gx = 0; gx < GRID.cols; gx++) {
    const distance = Math.abs(gx + 0.5 - centreGx) - half;
    const near = distance <= 0 ? 1 : Math.max(0, 1 - distance / 7);
    for (let gy = 0; gy < GRID.rows; gy++) {
      const cell = cells[idx(gx, gy)];
      if (!cell) continue;
      cell.streamNear = Math.max(cell.streamNear, near);
      if (distance > 0 || gy > bedRow) continue;
      cell.stream = true;
      // Channel material is loose bedload, not compacted ground.
      cell.hardness = Math.min(cell.hardness, 0.35);
      cell.nitrogen *= 0.4;
      cell.nitrogenBase *= 0.4;
      cell.organic *= 0.4;
    }
  }
}

/**
 * Place a stand of trees. Species mix leans on depth-to-water: birch tolerates
 * the wet hollows, oak wants the well-drained rises, hemlock fills the shade.
 */
function seedForest(world: World, rng: Rng, mix: [number, number]): void {
  const count = 7 + Math.floor(rng() * 4);
  const spacing = world.cols / count;

  for (let i = 0; i < count; i++) {
    const gx = Math.round(spacing * (i + 0.5) + range(rng, -spacing * 0.22, spacing * 0.22));
    if (gx < 4 || gx >= world.cols - 4) continue;
    if (world.trees.some((t) => Math.abs(t.gx - gx) < spacing * 0.55)) continue;

    const roll = rng();
    const species: TreeSpeciesId = roll < mix[0] ? 'oak' : roll < mix[1] ? 'birch' : 'hemlock';
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
      // The stream keeps its own bank wet at every depth: the channel is a
      // trench cut down to the water, so the ground beside it is fed sideways.
      const streamDamp = cell.streamNear * 0.35 * base.waterHolding;
      const target = Math.min(
        1,
        proximity * 1.05 * base.waterHolding + surfaceBias * base.waterHolding + streamDamp
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
