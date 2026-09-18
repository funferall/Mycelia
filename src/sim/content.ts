/**
 * Tuning constants and the small amount of authored content the prototype
 * needs. One biome, two tree species, one rival. Numbers here are the game's
 * balance surface: keep them in one place so the sim stays readable.
 */

export const GRID = {
  /**
   * Columns across the soil transect. The mount is deliberately near-square:
   * a wide sheet leaves the specimen room to sit in the middle of the paper
   * instead of running off both edges of the screen.
   */
  cols: 136,
  /** Rows of soil, surface at row 0. */
  rows: 112,
  /** Depth represented by one row, in centimetres. Drives the depth ruler. */
  cmPerRow: 1,
} as const;

export const MAX_DEPTH_CM = GRID.rows * GRID.cmPerRow;

export type StratumId =
  | 'litter'
  | 'humus'
  | 'loam'
  | 'clay'
  | 'sand'
  | 'stone'
  | 'bedrock';

export interface Stratum {
  id: StratumId;
  /** Printed on the depth ruler, in the notation a soil survey actually uses. */
  horizon: string;
  label: string;
  /** Multiplier on hyphal growth cost. Bedrock is impassable. */
  growthCost: number;
  /** Decomposable matter available to saprotrophs and decomposer blooms. */
  organic: number;
  /** Base nitrogen/phosphorus availability. */
  nitrogen: number;
  /** How much water this material holds against drainage. */
  waterHolding: number;
  /** Visual grit: how much stone and aggregate sits in the material. */
  hardness: number;
}

export const STRATA: Record<StratumId, Stratum> = {
  litter: {
    id: 'litter',
    horizon: 'Oi',
    label: 'Leaf litter',
    growthCost: 0.75,
    organic: 0.95,
    nitrogen: 0.35,
    waterHolding: 0.55,
    hardness: 0.05,
  },
  humus: {
    id: 'humus',
    horizon: 'Oa',
    label: 'Humus',
    growthCost: 0.85,
    organic: 0.8,
    nitrogen: 0.6,
    waterHolding: 0.75,
    hardness: 0.1,
  },
  loam: {
    id: 'loam',
    horizon: 'A',
    label: 'Loam',
    growthCost: 1.05,
    organic: 0.35,
    nitrogen: 0.55,
    waterHolding: 0.8,
    hardness: 0.3,
  },
  clay: {
    id: 'clay',
    horizon: 'B',
    label: 'Clay',
    growthCost: 1.9,
    organic: 0.12,
    nitrogen: 0.4,
    waterHolding: 0.95,
    hardness: 0.45,
  },
  sand: {
    id: 'sand',
    horizon: 'BC',
    label: 'Sand and gravel',
    growthCost: 1.35,
    organic: 0.06,
    nitrogen: 0.22,
    waterHolding: 0.25,
    hardness: 0.5,
  },
  stone: {
    id: 'stone',
    horizon: 'C',
    label: 'Weathered stone',
    growthCost: 4.2,
    organic: 0.02,
    nitrogen: 0.5,
    waterHolding: 0.15,
    hardness: 0.95,
  },
  bedrock: {
    id: 'bedrock',
    horizon: 'R',
    label: 'Bedrock',
    growthCost: Number.POSITIVE_INFINITY,
    organic: 0,
    nitrogen: 0.1,
    waterHolding: 0.05,
    hardness: 1,
  },
};

/**
 * Layered horizon profile: the fraction of a column that is each stratum,
 * before noise warps the boundaries. Reading top to bottom.
 */
export const HORIZON_PROFILE: ReadonlyArray<{ id: StratumId; depthCm: number }> = [
  { id: 'litter', depthCm: 4 },
  { id: 'humus', depthCm: 9 },
  { id: 'loam', depthCm: 30 },
  { id: 'clay', depthCm: 62 },
  { id: 'sand', depthCm: 91 },
  { id: 'stone', depthCm: MAX_DEPTH_CM },
];

export type TreeSpeciesId = 'oak' | 'birch' | 'hemlock';

export interface TreeSpecies {
  id: TreeSpeciesId;
  common: string;
  latin: string;
  /** Carbon shipped to a bonded network, before health and season. */
  carbonRate: number;
  /** Water the tree demands from the network per second. */
  waterDemand: number;
  /** Nitrogen and phosphorus the tree demands per second. */
  nutrientDemand: number;
  /** How long the bond survives unmet demand, in seconds. */
  patience: number;
  /** Resistance to rot, pests and drought. */
  toughness: number;
  /** How deep the root system reaches, in centimetres. */
  rootDepthCm: number;
  /** Carbon cost to bond a hypha to one of its root tips. */
  bondCost: number;
}

export const SPECIES: Record<TreeSpeciesId, TreeSpecies> = {
  oak: {
    id: 'oak',
    common: 'Northern red oak',
    latin: 'Quercus rubra',
    carbonRate: 3.4,
    waterDemand: 0.5,
    nutrientDemand: 0.28,
    patience: 26,
    toughness: 0.85,
    rootDepthCm: 88,
    bondCost: 22,
  },
  birch: {
    id: 'birch',
    common: 'Yellow birch',
    latin: 'Betula alleghaniensis',
    carbonRate: 1.9,
    waterDemand: 0.3,
    nutrientDemand: 0.16,
    patience: 60,
    toughness: 0.5,
    rootDepthCm: 42,
    bondCost: 12,
  },
  hemlock: {
    id: 'hemlock',
    common: 'Eastern hemlock',
    latin: 'Tsuga canadensis',
    carbonRate: 2.4,
    waterDemand: 0.34,
    nutrientDemand: 0.34,
    patience: 40,
    toughness: 0.7,
    rootDepthCm: 30,
    bondCost: 16,
  },
};

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Season {
  id: SeasonId;
  label: string;
  /** Multiplier on photosynthesis — the canopy's carbon output. */
  light: number;
  /** Multiplier on rainfall, which drives soil moisture and the water table. */
  rain: number;
  /** 0 = frozen, 1 = high summer. Gates fruiting and slows growth. */
  warmth: number;
  /**
   * Leaf fall, 0..1. The forest's own gift back to the soil: organic matter is
   * rebuilt each autumn, so the litter layer recovers the nitrogen a network
   * has been mining out of it.
   */
  litterfall: number;
  /** Real seconds this season lasts. */
  seconds: number;
}

export const SEASONS: readonly Season[] = [
  { id: 'spring', label: 'Spring flush', light: 1.15, rain: 1.35, warmth: 0.55, litterfall: 0.25, seconds: 150 },
  { id: 'summer', label: 'Summer drought', light: 1.3, rain: 0.35, warmth: 1.0, litterfall: 0.1, seconds: 170 },
  { id: 'autumn', label: 'Autumn litterfall', light: 0.85, rain: 1.1, warmth: 0.5, litterfall: 1, seconds: 150 },
  { id: 'winter', label: 'Winter dormancy', light: 0.3, rain: 0.9, warmth: 0.08, litterfall: 0.15, seconds: 160 },
];

/** Economy constants. Everything the player does is priced here. */
export const ECON = {
  /** Carbon per centimetre of new hypha, before stratum resistance. */
  growthPerCm: 0.42,
  /** How much of that cost is charged on entering a new cell. */
  entryCharge: 0.9,
  /**
   * What a new branch takes from the strand that spawned it, in carbon. Nothing
   * is created at birth: a fork is paid for out of the parent's own body, and a
   * parent that cannot afford one produces a leaner, slower branch.
   */
  birthReserve: 1.2,
  /**
   * A parent never gives its last carbon to a child. Below this floor it is the
   * parent that would starve, and a strand with no carbon rots.
   */
  parentReserveFloor: 0.35,
  /**
   * Carbon per second spent maintaining each living node. Deliberately steep:
   * a sprawling network is expensive to keep alive, so going wide has a price.
   */
  upkeepPerNode: 0.004,
  /**
   * Per-node holding capacity. Fungi invest rather than hoard, so anything a
   * node cannot use is lost — which is what keeps the player spending.
   */
  nodeCarbonCap: 2.4,
  nodeWaterCap: 6.0,
  nodeNitrogenCap: 3.0,
  /**
   * Carbon a junction must be holding to form a symbiosis, and to thicken into
   * a cord. Both are charges on a single node, so they must stay within what
   * one node can actually hold.
   */
  bondCharge: 1.1,
  cordCharge: 1.2,
  /** Water drawn from the local soil by each node, per second. */
  waterDrawPerNode: 0.05,
  /**
   * How much of the mineral a node takes out of the cell it stands in. The soil
   * is the source, so a network crowded into one pocket empties it and has to
   * grow outward, or wait for the horizon to rebuild, to keep eating.
   */
  nitrogenSoilCost: 1,
  /** Nitrogen consumed per centimetre of growth. */
  nitrogenPerCm: 0.05,
  /** Water consumed per centimetre of growth. Hyphae are mostly water. */
  waterPerCm: 0.07,
  /**
   * Mineralisation: how fast a horizon rebuilds the nitrogen standing in it,
   * toward a ceiling set by its organic content. Fast enough that a working
   * pocket keeps feeding the strands in it, which is what makes a partner's
   * supply depend on how much living soil the network actually stands on.
   */
  soilMineralisation: 0.5,
  /**
   * How fast leaf litter and root debris rebuild a horizon's organic matter.
   * Autumn litterfall runs this at full speed; winter nearly stops it.
   */
  organicRegrowth: 0.004,
  /**
   * A fruiting body commits its whole reserve when it starts, then spends that
   * store as it grows. Progress pauses if the strand beneath it is cut off, and
   * a body that loses its supply recedes rather than hanging in the air.
   */
  fruitRecessionPerSecond: 0.06,
  /**
   * What a fruiting body drinks through the strand beneath it, per second. A
   * strand joined to a working network is refilled every tick, so a supplied
   * mushroom is never short; a cut or starved one runs dry within seconds and
   * the eruption stalls.
   */
  fruitWaterDraw: 0.06,
  fruitNitrogenDraw: 0.015,
  /** Carbon cost to thicken a strand into a cord. */
  cordCost: 14,
  /** Multiplier on transport throughput once a strand is a cord. */
  cordThroughput: 5,
  /** Fraction of stored nitrogen lost per second when nothing is connected. */
  decayRate: 0.02,
  /** Carbon held at one node before it is wasted. Storage is deliberately tiny. */
  storagePerNode: 9,
  /** Growth rate of a hyphal tip, in centimetres per second. */
  tipSpeedCm: 1.9,
  /** Carbon surplus required before a fruiting body can be started. */
  fruitThreshold: 190,
  /** Seconds a fruiting body takes to erupt, if the sky stays kind. */
  fruitSeconds: 34,
  /** Spores released per successful fruiting. */
  sporesPerFruit: 240,
} as const;

/** The player's own colony identity — warm amber, per the art direction. */
export const PLAYER_PALETTE = {
  id: 'player',
  label: 'Mycelium lucidus',
  /** Linear-ish sRGB used by the renderer. */
  core: [1.0, 0.72, 0.28] as const,
  glow: [1.0, 0.55, 0.12] as const,
};

export const RIVAL_PALETTE = {
  id: 'rival',
  label: 'Saprotroph colony',
  core: [0.78, 0.92, 0.72] as const,
  glow: [0.55, 0.8, 0.5] as const,
};
