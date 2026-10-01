import { ECON, GRID } from './content';
import { passableAt, type NetworkWorld, type Tree, type World } from './world';
import type { Rng } from './rng';
import { distanceCm } from './spatial';
import type { Vec3 } from './spatial';
import {
  CONNECTIVITY_TICKS, FOLDED, REBUILD_TICKS, buildStrands, compactStrands, countGroupSlice, drawHeld, economyOf,
  foldSettled, forEachJunction, heldBy, joinStrand, markStrandsStale, memberLoad, pipeRate, publishGroupCount,
  refreshShapes, releaseStrands, segmentIndexOf, syncMember, tendSlices, upkeepWeight, type Segment, type StrandEconomy,
} from './segments';

export type Owner = 'player' | 'rival';

/** One tree's demand against the junction that feeds it. */
export interface TreeSpeciesDemand {
  waterDemand: number;
  nutrientDemand: number;
  patience: number;
}

export interface HyphaNode {
  id: number;
  /** Index of the parent node, or -1 for the founding spore. */
  parent: number;
  children: number[];
  /** Grid cell this node currently occupies. */
  gx: number;
  gy: number;
  /**
   * Regional y after a stand binds its opening soil. Standalone transects
   * leave it at zero; spatial growth uses it as the second horizontal axis.
   */
  y: number;
  /** Smooth position across the spatial growth plane. */
  lateral: number;
  /** The across-plane coordinate the tip is reaching for. */
  targetLateral: number;
  /** Durable physical position, assigned when a match binds regional soil. */
  spatial?: Vec3;
  /** Stand this strand currently stands in, or -1 on the flat transect. */
  standId: number;
  /** Continuous position for rendering — tips glide between grid cells. */
  wx: number;
  wy: number;
  /** The cell a tip is currently reaching for. */
  targetGx: number;
  targetGy: number;
  isTip: boolean;
  alive: boolean;
  /** 0..1. Thick strands become cords: fast transport, expensive to keep. */
  thickness: number;
  reinforced: boolean;
  carbon: number;
  water: number;
  nitrogen: number;
  /** 0..1. Nodes severed from the root starve and rot. */
  health: number;
  /** Reachable from the root this tick. */
  connected: boolean;
  /** Tree id this node is bonded to, or -1. */
  bondedTree: number;
  /** Root-tip id this node bonded through, or -1. */
  bondedRootTip: number;
  /** Net carbon that moved through this node last tick; signs are flow direction. */
  flow: number;
  /**
   * 0..1, smoothed: how full this strand's carbon pipe ran. Near 1 the strand
   * is a bottleneck, the place a cord pays for itself. Derived, never hashed.
   */
  load?: number;
  /** 0..1 decaying highlight, so the renderer can flash recent activity. */
  pulse: number;
  /** Seconds this node has existed. Drives thickening and rendering taper. */
  age: number;
  /** A player waypoint this tip is honouring, if any. */
  ordered: boolean;
  /** Simulation time at which this tip next re-reads the soil around it. */
  retargetAt: number;
  /**
   * Whether this tip has already paid to enter the cell it is reaching for.
   * Crossing a cell takes many simulation ticks; the entry cost must be charged
   * once per cell, never once per tick.
   */
  paid: boolean;
  /**
   * The subcluster this strand belongs to (see `GrowthGroup`). Absent or 0 is
   * the colony at large; new tips inherit their parent's group.
   */
  group?: number;
  /**
   * Colony age (`evolution.age`) when this strand's slow bookkeeping was last
   * brought up to date. A strand inside a run is tended every few ticks with
   * the time since, so its ageing, health and uptake keep their rates.
   */
  tendedAt?: number;
}

/**
 * A subcluster the player has selected out of a large network and steers on
 * its own. It is only a set of orders: its strands stay part of the one
 * network, so while they are joined to the root they share carbon, water and
 * minerals with everything else, and the colony's tip allowance is shared too.
 * A group that is cut off starves like any other severed strand.
 *
 * Group 0 is the colony at large and keeps using `Network.waypoints` and
 * `Network.resting`, so a network nobody has split behaves exactly as before.
 */
export interface GrowthGroup {
  id: number;
  waypoints: Array<{ gx: number; gy: number; lateral?: number }>;
  resting: boolean;
  /** Network age at which this group may next sprout a tip from its strands. */
  sproutAt: number;
}

/** A colony must be at least this many living strands before it can be split. */
export const MIN_SPLIT_STRANDS = 60;
/** A selection must hold at least this many of the colony's living strands. */
export const MIN_GROUP_STRANDS = 6;
/** Subclusters beyond the colony at large. */
export const MAX_GROUPS = 6;
/** A group with an order grows from at least this many tips of its own. */
const GROUP_MIN_TIPS = 2;

export interface Fruiting {
  active: boolean;
  /** 0..1 eruption progress. */
  progress: number;
  /**
   * Energy committed when the body started, in carbon-equivalent. It is spent
   * as the body grows, so a bloom can never be both finished and unpaid for.
   */
  store: number;
  /** Strand the body rose from. Cut its supply and the eruption stalls. */
  nodeId: number;
  gx: number;
  gy: number;
  /** Physical fruit site after a network enters regional growth. */
  spatial?: Vec3;
}

/** A mushroom that finished erupting, kept so the sheet can show where it stood. */
export interface Bloom {
  gx: number;
  gy: number;
  spatial?: Vec3;
  /** Simulation time the spores left, in seconds. */
  at: number;
}

export interface Network {
  /**
   * What kind of fungus this colony is, as traits rather than sides, so any
   * owner (a person, an agent, a faction) can play any kind. A decomposer
   * speeds the decay of dead and burned wood its strands reach.
   */
  traits?: { decomposer?: boolean };
  evolution: { learned: string[]; age: number; active: Record<string, number>; cooldown: Record<string, number> };
  owner: Owner;
  /** Stable regional identity; separate spores must never inherit a parent's graph. */
  colonyId?: string;
  label: string;
  nodes: HyphaNode[];
  rootId: number;
  /** Living hyphal tips — the growth frontier. */
  tipCount: number;
  /**
   * How many tips this network is allowed. Growth capacity is bought with
   * symbiosis: an unbonded spore can barely extend, and every tree it feeds
   * widens the frontier. This is what stops a network from sprawling across the
   * whole sheet on its starting carbon, and it makes the first bond the
   * unlocking moment the design calls for.
   */
  tipCeiling: number;
  /** Total strand length in centimetres, for the label block. */
  lengthCm: number;
  /** Carbon standing in the network right now. */
  carbon: number;
  /**
   * The largest carbon hoard the founding spore will ever hold. It starts as
   * the reserve the match opens with; income above it is respired away rather
   * than banked, so a network cannot sit on a fortune and grow at leisure.
   */
  carbonCeiling: number;
  /** Living connected nodes below their working carbon reserve. */
  starving: number;
  water: number;
  nitrogen: number;
  /** Carbon absorbed from rival or parasite biomass — the "tech" currency. */
  genetic: number;
  fruit: Fruiting;
  /** Completed fruitings — victory progress. */
  fruited: number;
  /** Where each of those fruitings stood, in the order they happened. */
  blooms: Bloom[];
  /** Spores released and settled beyond the network's own soil. */
  spores: number;
  /** Highest carbon surplus banked toward the next fruiting. */
  surplus: number;
  resting: boolean;
  /** Set once nothing living remains. */
  extinct: boolean;
  /**
   * The growth plane this network may occupy, in columns and rows.
   *
   * A single stand's transect is `GRID.cols` wide. Regional growth keeps the
   * founder's columns unchanged and expands these bounds west and east of it.
   * `minCol` is negative only when the founder has soil to its west.
   */
  bounds: { cols: number; rows: number; minCol?: number };
  rng: Rng;
  /** Waypoints the player has queued, oldest first (the colony at large, group 0). */
  waypoints: Array<{ gx: number; gy: number; lateral?: number }>;
  /** Subclusters split out of the colony, each with its own orders. */
  groups?: GrowthGroup[];
  /** Sprouting state for the colony at large once it has been split. */
  colonySprout?: GrowthGroup;
}

/**
 * The growth frontier is capped so a match stays about expansion decisions.
 * There is no cap on strands: every strand pays upkeep for its length, so a
 * colony is as large as its trade can feed.
 */
export const MAX_TIPS = 90;

export function createNetwork(
  owner: Owner,
  label: string,
  gx: number,
  gy: number,
  rng: Rng,
  startingCarbon: number,
  endowment: { water?: number; nitrogen?: number } = {}
): Network {
  const root: HyphaNode = {
    id: 0,
    parent: -1,
    children: [],
    gx,
    gy,
    y: 0,
    lateral: 0,
    targetLateral: 0,
    standId: -1,
    wx: gx + 0.5,
    wy: gy + 0.5,
    targetGx: gx,
    targetGy: gy,
    isTip: false,
    alive: true,
    thickness: 0.85,
    reinforced: false,
    carbon: startingCarbon,
    water: endowment.water ?? 4,
    nitrogen: endowment.nitrogen ?? 2,
    health: 1,
    connected: true,
    bondedTree: -1,
    bondedRootTip: -1,
    flow: 0,
    pulse: 1,
    age: 0,
    ordered: false,
    retargetAt: 0,
    paid: false,
  };

  const net: Network = {
    evolution: { learned: [], age: 0, active: {}, cooldown: {} },
    owner,
    label,
    nodes: [root],
    rootId: 0,
    tipCount: 0,
    tipCeiling: 6,
    lengthCm: 0,
    starving: 0,
    carbon: startingCarbon,
    carbonCeiling: startingCarbon,
    water: 4,
    nitrogen: 2,
    genetic: 0,
    fruit: { active: false, progress: 0, store: 0, nodeId: root.id, gx, gy },
    fruited: 0,
    blooms: [],
    spores: 0,
    surplus: 0,
    resting: false,
    extinct: false,
    bounds: { cols: GRID.cols, rows: GRID.rows },
    rng,
    waypoints: [],
  };

  // A spore wakes with a few exploratory tips rather than a single thread, so
  // the opening seconds read as something already alive.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + rng() * 0.8;
    spawnTip(net, root, angle, rng);
  }
  return net;
}

/**
 * Grow a new tip out of an existing strand.
 *
 * The new branch is built out of the parent's own body: it takes carbon, water
 * and mineral from the strand that spawned it, and never more than that strand
 * can spare. Nothing is manufactured at birth, so a network can only widen as
 * fast as its economy actually supplies it, and a poor strand produces a lean,
 * slow branch rather than a free one.
 *
 * Exported so the conservation rules can be exercised directly by the test
 * harness; the game only reaches it through `commitTip`.
 */
export function spawnTip(
  net: Network,
  from: HyphaNode,
  angle: number,
  rng: Rng
): HyphaNode {
  const step = 1;
  let tx = Math.round(from.gx + Math.cos(angle) * step);
  let ty = Math.round(from.gy + Math.sin(angle) * step);
  // Bias tips downward at first: the surface is bright and crowded, and the
  // interesting soil is below.
  if (rng() < 0.55) ty = Math.max(ty, from.gy);
  // Clamp to the colony's own growth plane, which is a region's worth of
  // columns once it has crossed a stand edge.
  const { cols, rows } = net.bounds;
  tx = Math.max(net.bounds.minCol ?? 0, Math.min(cols - 1, tx));
  ty = Math.max(0, Math.min(rows - 1, ty));

  // Draw the child's starting body out of the parent. Water and mineral are
  // taken proportionally and may be thin; carbon is what a strand really has to
  // give up, so the parent keeps a floor it cannot be pushed below.
  // A strand inside a run gives from its share of the run's pool.
  const carbonGive = Math.min(
    ECON.birthReserve,
    Math.max(0, heldBy(net, from, 'carbon') - ECON.parentReserveFloor)
  );
  const share = carbonGive / ECON.birthReserve;
  const waterGive = Math.min(0.6 * share, heldBy(net, from, 'water'));
  const nitrogenGive = Math.min(0.3 * share, heldBy(net, from, 'nitrogen'));
  drawHeld(net, from, 'carbon', carbonGive);
  drawHeld(net, from, 'water', waterGive);
  drawHeld(net, from, 'nitrogen', nitrogenGive);

  const node: HyphaNode = {
    id: net.nodes.length,
    parent: from.id,
    children: [],
    gx: from.gx,
    gy: from.gy,
    y: from.y,
    lateral: from.lateral,
    targetLateral: from.y,
    spatial: from.spatial ? { ...from.spatial } : undefined,
    standId: from.standId,
    wx: from.wx,
    wy: from.wy,
    targetGx: tx,
    targetGy: ty,
    isTip: true,
    alive: true,
    thickness: 0.18,
    reinforced: false,
    carbon: carbonGive,
    water: waterGive,
    nitrogen: nitrogenGive,
    health: 1,
    // What the founder reaches is marked each rebuild; until then a new tip
    // is reached exactly when the strand it grew from is.
    connected: from.connected,
    bondedTree: -1,
    bondedRootTip: -1,
    flow: 0,
    pulse: 0,
    age: 0,
    ordered: false,
    retargetAt: 0,
    paid: false,
    tendedAt: net.evolution.age,
  };
  if (from.group) node.group = from.group;
  net.nodes.push(node);
  from.children.push(node.id);
  net.tipCount++;
  joinStrand(net, node);
  return node;
}

/**
 * The flat transect's passability rule, kept as a named helper for the commands
 * and tests that speak in grid coordinates rather than in nodes.
 */
export function isPassable(world: World, gx: number, gy: number): boolean {
  return passableAt(world, gx, gy);
}

/**
 * Pick the next cell a tip should grow into.
 *
 * Ordered tips head straight for the player's waypoint. Unordered tips read the
 * soil: they prefer moisture, nitrogen and unexplored ground, keep some of
 * their previous heading so strands run rather than wander, and are nudged away
 * from cells the network already occupies.
 */
function chooseTarget(net: Network, world: NetworkWorld, tip: HyphaNode, rng: Rng): void {
  if (world.spatialGrowth || (net.groups?.length && waypointsOf(net, tip.group).length)) {
    chooseSpatialTarget(net, world, tip, rng);
    return;
  }
  const waypoints = waypointsOf(net, tip.group);
  const wantOrder = waypoints.length > 0;
  if (wantOrder) {
    const wp = waypoints[0] as { gx: number; gy: number };
    const dx = wp.gx - tip.wx;
    const dy = wp.gy - tip.wy;
    const dist = Math.hypot(dx, dy);
    if (dist < 2.5) {
      waypoints.shift();
    } else {
      const step = 1.6;
      let tx = Math.round(tip.gx + (dx / dist) * step);
      let ty = Math.round(tip.gy + (dy / dist) * step);
      if (!world.passableFrom(tip, tx - tip.gx, ty - tip.gy)) {
        // Deflect around the obstruction rather than stalling against it.
        const sign = rng() < 0.5 ? 1 : -1;
        tx = Math.round(tip.gx + (-dy / dist) * sign * step);
        ty = Math.round(tip.gy + (dx / dist) * sign * step);
      }
      if (world.passableFrom(tip, tx - tip.gx, ty - tip.gy)) {
        tip.targetGx = tx;
        tip.targetGy = ty;
        tip.ordered = true;
        tip.paid = false;
        return;
      }
      waypoints.shift();
    }
  }

  tip.ordered = false;
  const parent = tip.parent >= 0 ? net.nodes[tip.parent] : null;
  const headingX = parent ? tip.gx - parent.gx : 0;
  const headingY = parent ? tip.gy - parent.gy : 1;

  // Eight neighbours plus the current cell, scored.
  let bestScore = -Infinity;
  let bestX = tip.gx;
  let bestY = tip.gy;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const tx = tip.gx + ox;
      const ty = tip.gy + oy;
      const cell = world.cellFrom(tip, ox, oy);
      if (!cell) continue;
      if (!world.passableFrom(tip, ox, oy)) continue;

      // Nutrient and water sensing: the "read the soil" verb.
      let score =
        cell.nitrogen * 1.5 +
        cell.water * 1.1 +
        cell.organic * 0.55 -
        cell.hardness * 0.8 -
        cell.occupancy * 2.6;

      // Keep a heading, so hyphae run in strands instead of doubling back.
      const dot = (ox * headingX + oy * headingY) / (Math.hypot(ox, oy) * Math.hypot(headingX, headingY) || 1);
      score += dot * 0.7;

      // Explore: an unvisited cell is worth more than a retread.
      if (cell.occupancy === 0) score += 0.5;

      // Deep growth is the long game; shallow growth is the fast game.
      score += ty > tip.gy ? 0.18 : 0;

      score += rng() * 0.35;

      if (score > bestScore) {
        bestScore = score;
        bestX = tx;
        bestY = ty;
      }
    }
  }
  tip.targetGx = bestX;
  tip.targetGy = bestY;
  tip.paid = false;
}

/** Score actual neighbouring voxels in all three axes of a regional body. */
function chooseSpatialTarget(net: Network, world: NetworkWorld, tip: HyphaNode, rng: Rng): void {
  const waypoints = waypointsOf(net, tip.group);
  let waypoint = waypoints[0];
  // Destinations of a split body persist. One arrived or obstructed tip must
  // not release all the other tips from their group's objective.
  if (atGroupTarget(net, world, tip)) {
    tip.targetGx = tip.gx;
    tip.targetGy = tip.gy;
    tip.targetLateral = tip.y;
    tip.ordered = true;
    return;
  }
  if (!net.groups?.length && waypoint && Math.hypot(waypoint.gx + 0.5 - tip.wx, waypoint.gy + 0.5 - tip.wy,
    (waypoint.lateral ?? tip.y) - tip.lateral) < 2.2) {
    waypoints.shift();
    waypoint = waypoints[0];
  }
  const parent = tip.parent >= 0 ? net.nodes[tip.parent] : null;
  const headingX = parent ? tip.gx - parent.gx : 0;
  const headingDepth = parent ? tip.gy - parent.gy : 1;
  const headingLateral = parent ? tip.y - parent.y : 0;
  let best = { score: -Infinity, dx: 0, dy: 0, dl: 0 };
  const lateralReach = world.spatialGrowth ? 1 : 0;
  for (let dl = -lateralReach; dl <= lateralReach; dl++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0 && dl === 0) continue;
    const cell = world.cellFrom(tip, dx, dy, dl);
    if (!cell || !world.passableFrom(tip, dx, dy, dl)) continue;
    let score: number;
    if (waypoint) {
      const towardX = waypoint.gx + 0.5 - tip.wx;
      const towardDepth = waypoint.gy + 0.5 - tip.wy;
      const towardLateral = world.spatialGrowth ? (waypoint.lateral ?? tip.y) - tip.lateral : 0;
      const length = Math.hypot(towardX, towardDepth, towardLateral) || 1;
      score = (dx * towardX + dy * towardDepth + dl * towardLateral) /
        (Math.hypot(dx, dy, dl) * length) * 8;
      score += (cell.nitrogen + cell.water - cell.hardness) * 0.08;
    } else {
      score = cell.nitrogen * 1.5 + cell.water * 1.1 + cell.organic * 0.55 -
        cell.hardness * 0.8 - cell.occupancy * 2.6;
      const heading = Math.hypot(headingX, headingDepth, headingLateral) || 1;
      score += (dx * headingX + dy * headingDepth + dl * headingLateral) /
        (Math.hypot(dx, dy, dl) * heading) * 0.7;
      if (cell.occupancy === 0) score += 0.5;
      if (dy > 0) score += 0.18;
    }
    score += rng() * (waypoint ? 0.02 : 0.35);
    if (score > best.score) best = { score, dx, dy, dl };
  }
  if (best.score === -Infinity) {
    tip.targetGx = tip.gx;
    tip.targetGy = tip.gy;
    tip.targetLateral = tip.y;
    tip.ordered = false;
    tip.paid = false;
    return;
  }
  tip.targetGx = tip.gx + best.dx;
  tip.targetGy = tip.gy + best.dy;
  tip.targetLateral = tip.y + best.dl;
  tip.ordered = Boolean(waypoint);
  tip.paid = false;
}

export interface StepContext {
  /** A summoned warm rain front permits fruiting even during seasonal frost. */
  fruitingWeather?: boolean;
  /** Maturation pace for a fruiting body (the ash flush after a fire is faster). */
  fruitSpeed?: number;
  world: NetworkWorld;
  /** Photosynthesis multiplier for the current season. */
  light: number;
  /** Growth slowed by cold. */
  warmth: number;
  /** A rival network, if one is on the map. */
  rival: Network | null;
  /** Simulation time this step is being taken at, in seconds. */
  time: number;
  /** Records something the player should be told about. */
  log: (text: string) => void;
  dt: number;
}

/**
 * Advance one network by `dt` seconds: transport resources, extend tips, thicken
 * cords, starve severed strands, and progress any fruiting body.
 */
export function stepNetwork(net: Network, ctx: StepContext): void {
  const { world, dt } = ctx;
  if (net.extinct) return;

  // The economy runs on junctions and runs of strands (`segments.ts`). It is
  // kept up to date as tips settle, and rebuilt only after the graph changes
  // shape some other way.
  let economy = economyOf(net);
  if (!economy || economy.stale || economy.ticks >= REBUILD_TICKS) {
    economy = buildStrands(net, ECON.cordThroughput);
    markConnectivity(net);
  } else if (economy.ticks % CONNECTIVITY_TICKS === 0) {
    markConnectivity(net);
  }
  economy.ticks++;
  economy.tick++;
  economy.settled.length = 0;

  net.evolution.age += dt;
  const now = net.evolution.age;
  forEachJunction(net, economy, (n) => {
    // A strand that has just left a run catches up on the time it was untended.
    const since = n.tendedAt === undefined ? dt : Math.max(dt, now - n.tendedAt);
    n.age += since;
    n.pulse = Math.max(0, n.pulse - since * 0.9);
    n.flow *= 0.86;
    n.tendedAt = now;
  });
  for (const segment of economy.segments) segment.flow *= 0.86;

  for (const key of Object.keys(net.evolution.active)) net.evolution.active[key] = Math.max(0, net.evolution.active[key]! - dt);
  for (const key of Object.keys(net.evolution.cooldown)) net.evolution.cooldown[key] = Math.max(0, net.evolution.cooldown[key]! - dt);
  if (net.evolution.active.mend) forEachJunction(net, economy, (node) => {
    if (!node.connected || node.health >= 1) return;
    const repair = Math.min(1 - node.health, dt * 0.08, node.carbon / 2);
    node.health += repair;
    node.carbon -= repair * 2;
    node.pulse = 1;
  });
  updateTipCeiling(net, economy);
  harvest(net, economy, world, ctx);
  transport(net, economy, dt * (net.evolution.learned.includes('cord-memory') ? 1.25 : 1) * (net.evolution.active.pulse ? 2 : 1));
  respire(net, economy);
  // Each subcluster rests or grows on its own orders. Without any, this is the
  // colony-wide rest it always was.
  if (net.groups?.length) {
    sproutGroups(net, economy, ctx);
    extendTips(net, economy, ctx);
  } else if (!net.resting) {
    extendTips(net, economy, ctx);
  }
  thicken(net, economy, world, dt);
  decay(net, economy, world, dt);
  tendRuns(net, economy, world, now);
  progressFruiting(net, ctx);
  foldSettled(net, economy);
  compactStrands(net, economy);
  updateTotals(net);
}

/** Recompute how wide the growth frontier may be. */
function updateTipCeiling(net: Network, economy: StrandEconomy): void {
  let bonded = 0;
  // Tree junctions are never pooled into a run.
  forEachJunction(net, economy, (node) => {
    // A cut-off junction is no longer feeding a tree, so it no longer widens
    // the frontier either. Growth capacity has to be paid for with live trade.
    if (node.connected && node.bondedTree >= 0) bonded++;
  });
  net.tipCeiling = Math.min(MAX_TIPS, 6 + bonded * 13);
}

/**
 * Flood from the root and mark everything reachable. Severed strands stay alive
 * for a while and starve — cutting a cord must be felt in real time, not
 * immediately deletes the strand.
 */
export function markConnectivity(net: Network): void {
  const nodes = net.nodes;
  for (const n of nodes) n.connected = false;
  const stack: number[] = [net.rootId];
  const root = nodes[net.rootId];
  // The founding spore is the only place the network is joined to itself. If it
  // is dead, nothing is connected, however much of the colony is still standing:
  // a severed network must read as severed rather than staying quietly alive.
  if (!root || !root.alive) return;
  root.connected = true;
  while (stack.length > 0) {
    const id = stack.pop() as number;
    const node = nodes[id];
    if (!node) continue;
    for (const childId of node.children) {
      const child = nodes[childId];
      if (!child || !child.alive || child.connected) continue;
      child.connected = true;
      stack.push(childId);
    }
  }
}

/**
 * Take in what the network is standing in. Two sources: bonded tree roots ship
 * carbon down, and every node draws a little water and nitrogen from its cell.
 */
function harvest(net: Network, economy: StrandEconomy, world: NetworkWorld, ctx: StepContext): void {
  const { dt } = ctx;
  // Adaptations are per network, not per node: look them up once per step.
  const deepDrink = net.evolution.learned.includes('deep-drink') ? 1.2 : 1;
  const mineralWeave = net.evolution.learned.includes('mineral-weave') ? 1.2 : 1;
  // Junctions drink every tick; strands inside a run drink when tended (`tendRuns`).
  forEachJunction(net, economy, (node) => {
    if (!node.connected) return;
    const cell = world.cellOf(node);
    if (cell) takeFromSoil(node, cell, dt, node, 1, deepDrink, mineralWeave);
  });

  // Symbiosis: bonded trees pay in sugar, and only while they are healthy.
  const world_trees = ctx.world.trees;
  forEachJunction(net, economy, (node) => {
    // Only a strand still joined to the root can trade on the network's behalf.
    // A junction that has been cut off is not delivering anything to the tree,
    // and must not keep paying the player for a bond the tree cannot feel.
    if (!node.connected || node.bondedTree < 0) return;
    const tree = world_trees[node.bondedTree];
    if (!tree || tree.dead) {
      node.bondedTree = -1;
      node.bondedRootTip = -1;
      return;
    }
    const spec = (ctx.world.trees[node.bondedTree] as { species: string }).species;
    const rate = tree.health * ctx.light * (0.6 + tree.maturity * 0.6);
    const income = rate * carbonPerSecond(spec) * dt;
    // Rest directs a measured share of current photosynthesis into reproduction.
    // Starting reserves cannot masquerade as an earned fruiting surplus.
    const saved = net.resting && tree.waterReceived > 0.65 && tree.nutrientReceived > 0.65
      ? income * (net.evolution.learned.includes('fruit-memory') ? 0.65 : 0.55) : 0;
    net.surplus = Math.min(ECON.fruitThreshold, net.surplus + saved);
    node.carbon += Math.min(income - saved, Math.max(0, ECON.nodeCarbonCap * 1.6 - node.carbon));
    node.pulse = Math.min(1, node.pulse + dt * 0.6);
  });
}

/** Stores a strand draws into: its own, or the pool of the run it belongs to. */
type Store = { carbon: number; water: number; nitrogen: number };

/**
 * Take in what one strand is standing in over `dt`: water, mineral, and the
 * carbon of decomposing organic matter. `strands` is how many strands share
 * `store`, so a run's pool is capped at what its strands could each hold.
 */
function takeFromSoil(
  node: HyphaNode, cell: NonNullable<ReturnType<NetworkWorld['cellOf']>>, dt: number,
  store: Store, strands: number, deepDrink: number, mineralWeave: number
): void {
  // Water: drawn from the soil, replenished by rain and the water table.
  const draw = ECON.waterDrawPerNode * dt * (1 + node.thickness * 2) * deepDrink;
  const got = Math.min(draw, cell.water);
  cell.water -= got * 0.06;
  store.water = Math.min(ECON.nodeWaterCap * strands, store.water + got);

  // Nitrogen and phosphorus: mined from the cell the node stands in. The
  // horizon holds a finite standing stock and rebuilds it slowly, so a pocket
  // that has been worked over goes quiet until either the network grows on or
  // the soil has had time to mineralise again.
  const uptake = Math.min(cell.nitrogen, 0.09 * dt * (0.6 + node.thickness) * mineralWeave);
  cell.nitrogen = Math.max(0, cell.nitrogen - uptake * ECON.nitrogenSoilCost);
  store.nitrogen = Math.min(ECON.nodeNitrogenCap * strands, store.nitrogen + uptake);

  // Decomposition: hyphae metabolise the organic matter they are sitting in.
  // The rate scales with how rich the material is, so the litter layer is a
  // real income stream and barren clay is somewhere you pass through.
  if (cell.organic > 0.15) {
    const bite = Math.min(cell.organic, 0.02 * dt) * (0.35 + cell.organic);
    cell.organic -= bite * 0.05;
    // Held resources are capped: the excess is simply lost, which is what
    // forces the player to keep investing rather than banking.
    store.carbon += Math.min(bite * 3.2, Math.max(0, ECON.nodeCarbonCap * strands - store.carbon));
  }
}

function carbonPerSecond(species: string): number {
  switch (species) {
    case 'oak':
      return 3.4;
    case 'birch':
      return 1.9;
    default:
      return 2.4;
  }
}

/**
 * Move resources along the network.
 *
 * Two sweeps over the tree: surplus flows inward toward the root, then the root
 * pushes what it has back out to whoever is short. Each edge has a throughput
 * ceiling set by its thickness, so a thin strand is a bottleneck and a cord is
 * a highway. This is what makes the shape of the network a real decision.
 */
function transport(net: Network, economy: StrandEconomy, dt: number): void {
  const nodes = net.nodes;
  const { order, segments } = economy;
  const count = order.length;
  const buffers = transportBuffers(count);
  const { pipe, reserve, fill, keep, live } = buffers;

  // Each entity is a junction strand or a run (`segments.ts`). A run is one
  // pipe as wide as its narrowest strand, holding what its strands would each
  // hold. Nothing a sweep reads about shape changes during transport, so each
  // edge's throughput is worked out once rather than once per resource.
  for (let at = 0; at < count; at++) {
    const entity = order[at]!;
    if (entity === FOLDED) {
      live[at] = 0;
      pipe[at] = 0;
    } else if (entity >= 0) {
      const node = nodes[entity]!;
      live[at] = node.alive ? 1 : 0;
      pipe[at] = pipeRate(node, ECON.cordThroughput) * dt;
    } else {
      const segment = segments[-entity - 1]!;
      live[at] = segment.alive > 0 ? 1 : 0;
      pipe[at] = segment.pipeRate * dt;
    }
  }

  // Carbon travels up from strands holding more than they need, and back down
  // to any node below its working reserve. A growing tip needs real fuel, so
  // the frontier is topped up rather than merely rescued; only what nobody
  // needs reaches the root, and only what the root cannot use becomes surplus.
  for (let at = 0; at < count; at++) {
    const entity = order[at]!;
    if (entity === FOLDED) {
      reserve[at] = fill[at] = keep[at] = 0;
    } else if (entity >= 0) {
      const node = nodes[entity]!;
      const r = carbonReserve(node);
      reserve[at] = r;
      fill[at] = r;
      keep[at] = r * (node.parent < 0 ? 3 : 0.35);
    } else {
      const r = segments[-entity - 1]!.members.length * STRUT_CARBON_RESERVE;
      reserve[at] = r;
      fill[at] = r;
      keep[at] = r * 0.35;
    }
  }
  moveResource(net, economy, 'carbon', buffers);

  // Mark the strands that stand between the root and a tree. A partner is an
  // obligation rather than an option, so these are the routes that get fed.
  const supply = buffers.supply;
  for (let at = 0; at < count; at++) supply[at] = 0;
  for (let at = count - 1; at >= 0; at--) {
    const entity = order[at]!;
    if ((entity >= 0 && nodes[entity]!.bondedTree >= 0) || supply[at]) {
      if (entity === FOLDED) continue;
      supply[at] = 1;
      const parentAt = economy.parentAt[at]!;
      if (parentAt >= 0) supply[parentAt] = 1;
    }
  }

  // Water and minerals are drawn from the soil each node stands in, so a strand
  // holds very little of them: the standing stock belongs to whoever needs it.
  // A node on the way to a tree therefore gives everything it holds rather than
  // keeping a reserve back, which is what makes a partner's supply depend on a
  // real route through the network instead of on one lucky junction.

  // A partner that is short mobilises the whole network. Without this, a scarce
  // resource pools in a thousand small reserves and a tree dies of thirst inside
  // a network holding enough to save it: every strand sits exactly on its own
  // keeping level, nothing is in transit, and demand has nothing to pull from.
  const thirsty = wantsSupply(net, economy);

  for (const key of ['water', 'nitrogen'] as const) {
    const cap = key === 'water' ? ECON.nodeWaterCap : ECON.nodeNitrogenCap;
    for (let at = 0; at < count; at++) {
      const entity = order[at]!;
      if (entity === FOLDED) {
        reserve[at] = fill[at] = keep[at] = 0;
      } else if (entity >= 0) {
        const node = nodes[entity]!;
        const r = standingReserve(node, key, thirsty);
        reserve[at] = r;
        // A junction is filled to its whole capacity, and so is every strand on
        // the route to it: a strut is a pipe, not a cistern, and it passes what it
        // receives straight on to the tree.
        fill[at] = node.bondedTree >= 0 || supply[at] ? cap : r;
        // A strand carrying a partner's supply keeps nothing back for itself.
        keep[at] = supply[at] ? 0 : r * 0.35;
      } else {
        const strands = segments[-entity - 1]!.members.length;
        const r = strands * strutReserve(key, thirsty);
        reserve[at] = r;
        fill[at] = supply[at] ? strands * cap : r;
        keep[at] = supply[at] ? 0 : r * 0.35;
      }
    }
    moveResource(net, economy, key, buffers);
  }
}

interface TransportBuffers {
  pipe: Float64Array;
  /** Fraction of each edge's pipe that carbon used this step. */
  load: Float64Array;
  reserve: Float64Array;
  fill: Float64Array;
  keep: Float64Array;
  /** The resource being moved, and carbon's flow, during one `moveResource`. */
  value: Float64Array;
  flow: Float64Array;
  supply: Uint8Array;
  /** Whether each entity is still standing (a junction may have died since the build). */
  live: Uint8Array;
}

let sharedBuffers: TransportBuffers | null = null;

/** Scratch arrays indexed by node id, reused across networks and steps. */
function transportBuffers(size: number): TransportBuffers {
  if (!sharedBuffers || sharedBuffers.pipe.length < size) {
    const capacity = Math.max(size, (sharedBuffers?.pipe.length ?? 0) * 2, 1024);
    sharedBuffers = {
      pipe: new Float64Array(capacity),
      load: new Float64Array(capacity),
      reserve: new Float64Array(capacity),
      fill: new Float64Array(capacity),
      keep: new Float64Array(capacity),
      value: new Float64Array(capacity),
      flow: new Float64Array(capacity),
      supply: new Uint8Array(capacity),
      live: new Uint8Array(capacity),
    };
  }
  return sharedBuffers;
}

type ResourceKey = 'carbon' | 'water' | 'nitrogen';

/** Carbon a strand refuses to give up: fuel for a tip, and a junction's float. */
function carbonReserve(node: HyphaNode): number {
  return (node.isTip ? 2.2 : STRUT_CARBON_RESERVE) + (node.bondedTree >= 0 ? 1 : 0);
}

/** A plain strut's carbon reserve; every strand in a run is one. */
const STRUT_CARBON_RESERVE = 0.9;

/**
 * Respiration: carbon a strand cannot use is lost rather than banked.
 *
 * Storage is deliberately tiny. A node holds about one centimetre of growth
 * plus its working float, and the founding spore holds the reserve the match
 * opened with and not a gram more. A player who stops making decisions watches
 * their income evaporate instead of sitting on a fortune, which is what keeps
 * every match a series of investments rather than a slow accumulation.
 */
function respire(net: Network, economy: StrandEconomy): void {
  forEachJunction(net, economy, (node) => {
    const cap = node.id === net.rootId
      ? Math.max(ECON.nodeCarbonCap, net.carbonCeiling)
      : ECON.nodeCarbonCap * (node.bondedTree >= 0 ? 1.6 : 1);
    if (node.carbon > cap) node.carbon = cap;
  });
  for (const segment of economy.segments) {
    const cap = ECON.nodeCarbonCap * segment.members.length;
    if (segment.carbon > cap) segment.carbon = cap;
  }
}

/**
 * What a node keeps for itself before it will ship anything further inward.
 *
 * Carbon is the body, so everyone holds a working reserve. Water and mineral
 * are what the network is *for*: a strut keeps just enough to stay alive, a tip
 * keeps enough to pay for the next centimetre, and a bonded junction keeps its
 * whole store because that is a debt to a tree rather than a surplus.
 *
 * The frontier's reserves are deliberately small. A tip needs about a fiftieth
 * of a unit of mineral per centimetre, so a generous tip reserve is not fuel,
 * it is a reservoir the network cannot spend: a hungry partner can only be fed
 * out of what is actually in transit.
 *
 * While a partner is short, everyone gives up almost all of it. A tree's unmet
 * demand outranks the comfort of every strand in the network.
 */
function standingReserve(node: HyphaNode, key: ResourceKey, thirsty = false): number {
  if (key === 'carbon') return carbonReserve(node);
  if (node.bondedTree >= 0) return key === 'water' ? ECON.nodeWaterCap : ECON.nodeNitrogenCap;
  // The founding spore is the colony's core, not a bare pipe: it keeps a little
  // of everything even while a partner is draining the network, so the ground
  // the match began in never becomes the one place nothing will grow.
  if (node.parent < 0) return key === 'water' ? 0.6 : 0.2;
  if (node.isTip) {
    if (thirsty) return key === 'water' ? 0.15 : 0.05;
    return key === 'water' ? 0.6 : 0.15;
  }
  return strutReserve(key, thirsty);
}

/** What a plain strut keeps of water or mineral; every strand in a run is one. */
function strutReserve(key: 'water' | 'nitrogen', thirsty: boolean): number {
  if (thirsty) return 0;
  return key === 'water' ? 0.1 : 0.04;
}

/**
 * Is a bonded tree short of what it was promised?
 *
 * A junction that is not holding its full store is a tree that is not being
 * fully served, which is the signal the rest of the network answers.
 */
function wantsSupply(net: Network, economy: StrandEconomy): boolean {
  let short = false;
  // Tree junctions are never pooled into a run.
  forEachJunction(net, economy, (node) => {
    if (short || !node.connected || node.bondedTree < 0) return;
    if (node.water < ECON.nodeWaterCap * 0.9 || node.nitrogen < ECON.nodeNitrogenCap * 0.9) short = true;
  });
  return short;
}

/**
 * One resource, one sweep each way.
 *
 * Inward, anything a node holds above `surplusAbove` flows toward its parent;
 * outward, a parent brings any child below `fillTo` back up. Each edge has a
 * throughput ceiling set by its thickness, so a hair-fine strand is a
 * bottleneck and a cord is a highway — which is what makes the shape of the
 * network a real decision rather than decoration.
 *
 * `holdsBack` decides whether a node on the outward sweep keeps its own reserve
 * before filling a child. Strands carrying a partner's supply do not: a tree
 * waiting at the end of the route outranks the reserve of every strand on it.
 */
function moveResource(
  net: Network,
  economy: StrandEconomy,
  key: ResourceKey,
  buffers: TransportBuffers
): void {
  // Per-entity inputs, precomputed by `transport`: edge throughput, the reserve
  // an entity holds before shipping inward, the level it fills a child to, and
  // what it keeps back on the outward sweep.
  const { pipe, reserve, fill, keep, value, flow, load, live } = buffers;
  const nodes = net.nodes;
  const { order, segments, parentAt, childrenAt } = economy;
  const isCarbon = key === 'carbon';
  const count = order.length;

  // The amounts live in typed arrays for the two sweeps: a keyed property
  // (`node[key]`) is the slow path in the hottest loop of the simulation. Each
  // amount is read once and written back once.
  for (let at = 0; at < count; at++) {
    const entity = order[at]!;
    if (entity === FOLDED) {
      value[at] = 0;
      if (isCarbon) flow[at] = load[at] = 0;
      continue;
    }
    const holder: Store & { flow: number } = entity >= 0 ? nodes[entity]! : segments[-entity - 1]!;
    value[at] = holder[key];
    if (isCarbon) {
      flow[at] = holder.flow;
      load[at] = 0;
    }
  }

  for (let at = count - 1; at >= 0; at--) {
    const up = parentAt[at]!;
    if (up < 0 || !live[at] || !live[up]) continue;
    const surplus = value[at]! - reserve[at]!;
    if (surplus <= 0) continue;
    const moved = Math.min(surplus, pipe[at]!);
    value[at] = value[at]! - moved;
    value[up] = value[up]! + moved;
    if (isCarbon) {
      if (pipe[at]! > 0) load[at] = Math.max(load[at]!, moved / pipe[at]!);
      flow[at] = flow[at]! - moved;
      flow[up] = flow[up]! + moved;
    }
  }

  for (let at = 0; at < count; at++) {
    const children = childrenAt[at]!;
    if (children.length === 0 || !live[at]) continue;
    // A parent must keep strictly less than the level it fills its children
    // to, or a node sitting exactly at its reserve could never be topped up
    // and would slowly die of upkeep. The root keeps more than everyone else,
    // so supply flows outward down a gradient instead of pooling at the base.
    const kept = keep[at]!;
    const edge = pipe[at]!;
    for (let c = 0; c < children.length; c++) {
      const child = children[c]!;
      if (!live[child]) continue;
      const deficit = fill[child]! - value[child]!;
      if (deficit <= 0) continue;
      const movable = Math.max(0, value[at]! - kept);
      const moved = Math.min(deficit, movable, edge);
      if (moved <= 0) continue;
      value[at] = value[at]! - moved;
      value[child] = value[child]! + moved;
      if (isCarbon) {
        // Outward, the parent's pipe is the limit, so the parent's strand is
        // the one running full.
        if (edge > 0) load[at] = Math.max(load[at]!, moved / edge);
        flow[at] = flow[at]! - moved;
        flow[child] = flow[child]! + moved;
      }
    }
  }

  for (let at = 0; at < count; at++) {
    const entity = order[at]!;
    if (entity === FOLDED) continue;
    const holder: Store & { flow: number; load?: number } = entity >= 0 ? nodes[entity]! : segments[-entity - 1]!;
    holder[key] = value[at]!;
    if (isCarbon) {
      holder.flow = flow[at]!;
      holder.load = (holder.load ?? 0) + (load[at]! - (holder.load ?? 0)) * 0.08;
    }
  }
}

/**
 * Extend every tip toward its target cell. A tip pays carbon and nitrogen when
 * it commits to entering new soil; until it can afford the entry it waits,
 * which is what makes nutrient supply the real limit on expansion speed.
 */
function extendTips(net: Network, economy: StrandEconomy, ctx: StepContext): void {
  const { world } = ctx;
  if (net.tipCount <= 0) return;

  const speed = ECON.tipSpeedCm * (0.45 + ctx.warmth * 0.75);

  const grouped = Boolean(net.groups?.length);
  // Tips are always junctions; a tip grown this tick is visited too.
  forEachJunction(net, economy, (node) => {
    if (!node.isTip) return;
    if (grouped && restingOf(net, node.group)) return;
    // Arrived tips hold the objective; the rest keep growing toward it.
    if (atGroupTarget(net, world, node)) return;
    growTip(net, world, node, ctx, speed);
  });
}

/** One tip's step toward its target cell. */
function growTip(net: Network, world: NetworkWorld, node: HyphaNode, ctx: StepContext, speed: number): void {
  const { dt } = ctx;

  // Recheck before committing as well as moving: a rising table may have
  // flooded a target since this tip paid for it. Existing strands persist,
  // but flooded tips cannot extend until the water recedes.
  if (!world.passableFrom(node, 0, 0)) return;
  const toTargetX = node.targetGx - node.gx;
  const toTargetY = node.targetGy - node.gy;
  const toTargetLateral = world.spatialGrowth ? node.targetLateral - node.y : 0;
  if (!world.passableFrom(node, toTargetX, toTargetY, toTargetLateral)) {
    node.wx = node.gx + 0.5;
    node.wy = node.gy + 0.5;
    node.lateral = node.y;
    chooseTarget(net, world, node, net.rng);
    return;
  }

  const tx = node.targetGx + 0.5;
  const ty = node.targetGy + 0.5;
  const dx = tx - node.wx;
  const dy = ty - node.wy;
  const dl = world.spatialGrowth ? node.targetLateral - node.lateral : 0;
  const dist = Math.hypot(dx, dy, dl);

  if (dist < 0.04) {
    commitTip(net, world, node, ctx);
    return;
  }

  // Entering a new cell has a one-time cost; moving within the current cell
  // is cheap. Pay on the frame the tip crosses the boundary.
  const entering = toTargetX !== 0 || toTargetY !== 0 || toTargetLateral !== 0;
  const { cost, stratum } = world.costFrom(node, toTargetX, toTargetY, toTargetLateral);
  if (!Number.isFinite(cost) || !world.passableFrom(node, toTargetX, toTargetY, toTargetLateral)) {
    // Impassable target: pick again rather than stalling against stone.
    chooseTarget(net, world, node, net.rng);
    node.retargetAt = nextRetarget(net);
    return;
  }

  if (entering) {
    if (!node.paid) {
      const total = cost * ECON.growthPerCm * ECON.entryCharge;
      if (
        node.carbon < total ||
        node.nitrogen < total * ECON.nitrogenPerCm ||
        node.water < total * ECON.waterPerCm
      ) {
        return; // Starved of carbon or nitrogen: sit and wait.
      }
      node.carbon -= total;
      node.nitrogen -= total * ECON.nitrogenPerCm;
      node.water -= total * ECON.waterPerCm;
      node.paid = true;
      node.pulse = Math.min(1, node.pulse + 0.35);
    }
    // Hard strata also slow the tip down as it works through them.
    node.wx += (dx / dist) * Math.min(dist, speed * dt * (1 / (1 + stratum.hardness * 0.8)));
    node.wy += (dy / dist) * Math.min(dist, speed * dt * (1 / (1 + stratum.hardness * 0.8)));
    node.lateral += (dl / dist) * Math.min(dist, speed * dt * (1 / (1 + stratum.hardness * 0.8)));
    return;
  }

  const stepLen = Math.min(dist, speed * dt);
  node.wx += (dx / dist) * stepLen;
  node.wy += (dy / dist) * stepLen;
  node.lateral += (dl / dist) * stepLen;

  // Re-read the soil on a timer, so growth tracks depletion and a rival's
  // arrival without rescanning the whole network every time a tip commits.
  if (net.lengthCm > 0 && node.age > node.retargetAt) {
    chooseTarget(net, world, node, net.rng);
    node.retargetAt = nextRetarget(net);
  }
}

/** Staggered so the whole frontier never re-reads the soil on the same tick. */
function nextRetarget(net: Network): number {
  return net.nodes[net.rootId] ? 6 + net.rng() * 10 : 6;
}

/** A tip has arrived: it becomes a strut, and sprouts the next generation. */
function commitTip(net: Network, world: NetworkWorld, node: HyphaNode, ctx: StepContext): void {
  node.wx = node.targetGx + 0.5;
  node.wy = node.targetGy + 0.5;
  node.gx = node.targetGx;
  node.gy = node.targetGy;
  if (world.spatialGrowth) node.y = node.targetLateral;
  node.lateral = node.y;
  node.isTip = false;
  net.tipCount--;
  economyOf(net)?.settled.push(node.id);

  const cell = world.cellOf(node);
  if (cell) cell.occupancy = Math.min(1, cell.occupancy + 0.34);
  net.lengthCm += GRID.cmPerRow;
  // A regional world re-files the strand into the stand it just crossed into.
  world.commit(node);

  const rng = net.rng;
  // A strand that has run a while tends to keep running; occasionally it forks.
  const parent = node.parent >= 0 ? net.nodes[node.parent] : null;
  const baseAngle = parent ? Math.atan2(node.gy - parent.gy, node.gx - parent.gx) : Math.PI / 2;

  // The strand continues: a tip always hands its heading on to exactly one
  // successor, so the growth frontier can never be accidentally extinguished.
  const successor = spawnTip(net, node, baseAngle + (rng() - 0.5) * 0.5, rng);
  chooseTarget(net, world, successor, rng);
  successor.retargetAt = nextRetarget(net);

  // Forking is what the tip budget actually limits, so a wide network and a
  // long one are competing uses of the same soil.
  const forkChance = 0.1 + (cell && cell.nitrogen > 0.5 ? 0.12 : 0);
  if (net.tipCount < net.tipCeiling && rng() < forkChance) {
    const side = rng() < 0.5 ? 1 : -1;
    const fork = spawnTip(net, node, baseAngle + side * (0.7 + rng() * 0.6), rng);
    chooseTarget(net, world, fork, rng);
    fork.retargetAt = nextRetarget(net);
  }
  void ctx;
}

/**
 * Thicken strands that carry the most traffic. This is where a network's shape
 * starts to matter: the cords that emerge follow the routes the economy
 * actually uses, so the picture of the network is a picture of the decisions.
 */
function thicken(net: Network, economy: StrandEconomy, world: NetworkWorld, dt: number): void {
  // Strands inside a run thicken when tended (`tendRuns`).
  forEachJunction(net, economy, (node) => {
    if (!node.isTip) thickenStrand(node, world, dt);
  });
}

function thickenStrand(node: HyphaNode, world: NetworkWorld, dt: number, cell?: ReturnType<NetworkWorld['cellOf']>): void {
  const traffic = Math.abs(node.flow);
  const target = Math.max(node.reinforced ? 0.9 : 0, Math.min(1, 0.08 + traffic * 0.22 + node.age * 0.004));
  if (target > node.thickness) {
    node.thickness += (target - node.thickness) * Math.min(1, dt * 0.5);
  } else {
    node.thickness += (target - node.thickness) * Math.min(1, dt * 0.08);
  }
  if (node.thickness > 0.62 && Math.abs(node.flow) > 0.05) {
    const at = cell === undefined ? world.cellOf(node) : cell;
    if (at) at.occupancy = Math.min(1, at.occupancy + 0.02 * dt);
  }
}

/**
 * Universal decay. Anything cut off from the root starves; dead strands stop
 * being nodes and become the soil's problem — decomposable matter for whoever
 * gets there first.
 */
function decay(net: Network, economy: StrandEconomy, world: NetworkWorld, dt: number): void {
  feedFounder(net, economy, dt);
  const healing = net.evolution.learned.includes('living-sheath') ? 0.025 : 0.015;
  forEachJunction(net, economy, (node) => {
    if (!node.connected) {
      node.health -= dt * 0.055 * (1 + (1 - node.thickness));
      if (node.health <= 0) killNode(net, world, node, 0);
      return;
    }
    // Upkeep. Nodes in poor soil with no supply bleed out slowly.
    const drain = ECON.upkeepPerNode * dt * upkeepWeight(node);
    node.carbon = Math.max(0, node.carbon - drain);
    // A node with nothing left starts to die. This is what makes an
    // unprofitable network — one that grew into barren soil with no tree to
    // feed it — visibly recede rather than sitting there at zero.
    if (node.carbon <= 0.02) {
      // The founding node holds on longest: it is the colony, not a strand.
      node.health -= dt * 0.03 * (node.id === net.rootId ? 0.3 : 1);
      if (node.health <= 0) killNode(net, world, node, 0.5);
    } else {
      node.health = Math.min(1, node.health + dt * healing);
    }
    // Very old tips that never found anything are pruned back.
    if (node.alive && node.isTip && node.age > 140 && Math.hypot(node.wx - node.gx, node.wy - node.gy) < 0.2) {
      killNode(net, world, node, 0.3);
    }
  });
  // A run pays the same upkeep its strands would, out of its pool; each
  // strand's health answers to its share when it is tended.
  for (const segment of economy.segments) {
    if (segment.alive <= 0 || !net.nodes[segment.members[0]!]!.connected) continue;
    segment.carbon = Math.max(0, segment.carbon - ECON.upkeepPerNode * dt * segment.upkeepWeight);
  }
}

/**
 * Bring one slice of the strands inside runs up to date: every strand is
 * tended once in `TEND_SLICES` ticks, with the time since it last was. This is
 * each strand's own slow life: ageing, its pulse fading, soil uptake into its
 * run's pool, thickening, and health, which answers to its share of the pool.
 */
function tendRuns(net: Network, economy: StrandEconomy, world: NetworkWorld, now: number): void {
  const nodes = net.nodes;
  const deepDrink = net.evolution.learned.includes('deep-drink') ? 1.2 : 1;
  const mineralWeave = net.evolution.learned.includes('mineral-weave') ? 1.2 : 1;
  const healing = net.evolution.learned.includes('living-sheath') ? 0.025 : 0.015;
  const mending = Boolean(net.evolution.active.mend);
  const slices = tendSlices(economy.members);
  const phase = economy.tick % slices;
  const counting = Boolean(net.groups?.length);
  const rates = { deepDrink, mineralWeave, healing, mending };
  // Each run's strands are tended by their place in the run, so neither
  // junctions nor the strands that have died are visited at all.
  for (const segment of economy.segments) {
    const members = segment.members;
    for (let i = phase; i < members.length; i += slices) {
      const node = nodes[members[i]!]!;
      if (!node.alive) continue;
      if (counting) countGroupSlice(net, economy, node);
      tendStrand(net, economy, segment, node, world, now, economy.cordThroughput, rates);
    }
  }
  // Junctions are counted once per turn of slices.
  if (counting && phase === 0) forEachJunction(net, economy, (node) => countGroupSlice(net, economy, node));
  refreshShapes(net, economy);
  if (phase === slices - 1) publishGroupCount(economy);
}

function tendStrand(
  net: Network, economy: StrandEconomy, segment: Segment, node: HyphaNode, world: NetworkWorld, now: number, cordThroughput: number,
  rates: { deepDrink: number; mineralWeave: number; healing: number; mending: boolean }
): void {
  // Take in anything written to the strand directly, and show it its share.
  syncMember(economy, segment, node);
  const since = now - (node.tendedAt ?? now);
  node.tendedAt = now;
  if (since <= 0) return;
  const strands = segment.members.length;
  node.age += since;
  node.pulse = Math.max(0, node.pulse - since * 0.9);
  // Everything that passes through a run passes through each of its strands.
  node.flow = segment.flow / strands;
  node.load = memberLoad(segment, node, cordThroughput);

  if (rates.mending && node.connected && node.health < 1) {
    const repair = Math.min(1 - node.health, since * 0.08, segment.carbon / strands / 2);
    node.health += repair;
    segment.carbon -= repair * 2;
    node.pulse = 1;
  }
  // One soil lookup serves uptake and the occupancy a thick cord leaves.
  const cell = world.cellOf(node);
  if (node.connected && cell) takeFromSoil(node, cell, since, segment, strands, rates.deepDrink, rates.mineralWeave);
  thickenStrand(node, world, since, cell);

  if (!node.connected) {
    node.health -= since * 0.055 * (1 + (1 - node.thickness));
    if (node.health <= 0) killNode(net, world, node, 0);
    return;
  }
  if (segment.carbon / strands <= 0.02) {
    node.health -= since * 0.03;
    if (node.health <= 0) killNode(net, world, node, 0.5);
  } else {
    node.health = Math.min(1, node.health + since * rates.healing);
  }
}

/** Carbon a founding node keeps for its own upkeep before it draws on the body. */
export const FOUNDER_FLOOR = 0.9;
/** Most carbon a founding node may draw from the body each second. */
const FOUNDER_DRAW = 3;

/**
 * The founding node sits at the end of every inward route, so it is the last
 * strand anything reaches: a colony whose frontier eats every surplus would
 * starve its own founder while thousands of strands still hold their working
 * float, and its death severs everything at once. Instead the founder draws on
 * what connected strands hold above a thin keep, in node order, a little each
 * second. Carbon is moved, never made. A colony that is
 * truly spent has nothing spare, and dies back from its edges instead.
 */
function feedFounder(net: Network, economy: StrandEconomy, dt: number): void {
  const root = net.nodes[net.rootId];
  if (!root?.alive || root.carbon >= FOUNDER_FLOOR) return;
  let need = Math.min(FOUNDER_FLOOR - root.carbon, FOUNDER_DRAW * dt);
  // Nearest the founder first: the body's entities in root-first order.
  for (const entity of economy.order) {
    if (need <= 0) break;
    if (entity === FOLDED) continue;
    let take: number;
    if (entity >= 0) {
      const node = net.nodes[entity]!;
      if (!node.alive || !node.connected || node === root) continue;
      const spare = node.carbon - (node.isTip ? 0.6 : 0.3);
      if (spare <= 0) continue;
      take = Math.min(spare, need);
      node.carbon -= take;
    } else {
      const segment = economy.segments[-entity - 1]!;
      if (segment.alive <= 0) continue;
      const spare = segment.carbon - 0.3 * segment.members.length;
      if (spare <= 0) continue;
      take = Math.min(spare, need);
      segment.carbon -= take;
    }
    root.carbon += take;
    need -= take;
  }
}

/** Drought withers a strand that has dried out completely. */
export function witherNode(net: Network, world: NetworkWorld, node: HyphaNode): void {
  killNode(net, world, node, 0.4);
}

/** Fire kills a strand outright; its body becomes ash-rich organic matter. */
export function burnNode(net: Network, world: NetworkWorld, node: HyphaNode): void {
  killNode(net, world, node, 1);
}

/** A strand lysed in a fight with another network; see `src/sim/contact.ts`. */
export function lyseNode(net: Network, world: NetworkWorld, node: HyphaNode): void {
  killNode(net, world, node, 0.5);
}

/** Remove a node, converting its body into soil organic matter. */
function killNode(net: Network, world: NetworkWorld, node: HyphaNode, organicReturn: number): void {
  node.alive = false;
  if (node.isTip) net.tipCount = Math.max(0, net.tipCount - 1);
  // A strand inside a run takes its share of the pool with it. A junction
  // with strands beyond it cuts them off. Either way the graph must be
  // rebuilt; a dead end or a tip simply stops trading.
  const economy = economyOf(net);
  const s = segmentIndexOf(economy, node.id);
  if (s >= 0) {
    economy!.segments[s]!.alive--;
    economy!.stale = true;
  } else if (node.children.some((id) => net.nodes[id]?.alive)) {
    markStrandsStale(net);
  }
  const cell = world.cellOf(node);
  if (cell) {
    cell.occupancy = Math.max(0, cell.occupancy - 0.3);
    // Death feeds the forest. This is deliberate: losses are not just losses.
    cell.organic = Math.min(1, cell.organic + 0.05 + organicReturn * 0.08);
    cell.nitrogen = Math.min(1, cell.nitrogen + 0.02);
  }
  const parent = node.parent >= 0 ? net.nodes[node.parent] : null;
  if (parent) parent.children = parent.children.filter((id) => id !== node.id);
  node.children = [];
  if (node.bondedTree >= 0 && node.bondedRootTip >= 0) {
    const tree = world.trees[node.bondedTree];
    const tip = tree?.rootTips[node.bondedRootTip];
    if (tip && (tip.bondedColonyId ?? null) === (net.colonyId ?? null)) {
      tip.bondedTo = null;
      tip.bondedColonyId = null;
    }
  }
}

/**
 * The nearest living strand joined to the root within a patch, or null if the
 * network has been cut away from that ground entirely.
 */
function feederAt(net: Network, gx: number, gy: number, wantWater: number, wantNitrogen: number, spatial?: Vec3): HyphaNode | null {
  let best: HyphaNode | null = null;
  let bestDist = Infinity;
  let nearest: HyphaNode | null = null;
  let nearestDist = Infinity;
  for (const node of net.nodes) {
    if (!node.alive || !node.connected) continue;
    const d = spatial && node.spatial
      ? Math.hypot(node.spatial.x - spatial.x, node.spatial.y - spatial.y, node.spatial.z - spatial.z)
      : Math.hypot(node.gx - gx, node.gy - gy);
    if (d > 2) continue;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = node;
    }
    // Prefer a strand in this patch that can actually pay for the day's growth.
    // Any strand will do when none can, so that a starving patch drains visibly
    // rather than the body simply refusing to notice it.
    if (heldBy(net, node, 'water') >= wantWater && heldBy(net, node, 'nitrogen') >= wantNitrogen && d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best ?? nearest;
}

/**
 * Progress is *what the body has spent*, never a second number that can drift
 * away from the reserve. A mushroom that has spent its whole commitment is
 * exactly the mushroom that has finished rising.
 */
function setFruitStore(net: Network, store: number): void {
  net.fruit.store = Math.max(0, Math.min(ECON.fruitThreshold, store));
  net.fruit.progress = 1 - net.fruit.store / ECON.fruitThreshold;
}

/**
 * Progress a fruiting body, erupt when it completes, and let one die back when
 * the strand beneath it loses its supply.
 *
 * The energy for the body was committed in `startFruiting` and is spent here as
 * the mushroom grows, so what the player sees in the record is what the body is
 * actually living on. Weather can pause an eruption without wasting it, but a
 * severed or starving network loses the bloom outright.
 */
function progressFruiting(net: Network, ctx: StepContext): void {
  const fruit = net.fruit;
  if (!fruit.active) return;

  // The body drinks from whichever strand of the network is in the patch it
  // rose from. Reading the patch rather than pinning one node id means a strand
  // being replaced by its successor does not kill a mushroom, while a genuine
  // cut between the site and the root still does.
  const wantWater = ECON.fruitWaterDraw * ctx.dt;
  const wantNitrogen = ECON.fruitNitrogenDraw * ctx.dt;
  const feeder = feederAt(net, fruit.gx, fruit.gy, wantWater, wantNitrogen, fruit.spatial);
  const fed = Boolean(
    feeder && heldBy(net, feeder, 'water') >= wantWater && heldBy(net, feeder, 'nitrogen') >= wantNitrogen
  );
  if (fed && feeder) {
    drawHeld(net, feeder, 'water', wantWater);
    drawHeld(net, feeder, 'nitrogen', wantNitrogen);
  }

  if (!fed) {
    // Nothing rises out of a patch that has been cut off. The body withdraws
    // the investment it has made so far, at a walking pace: a brief interruption
    // costs time, a real cut loses the bloom and whatever it had spent.
    const returned = ECON.fruitThreshold * ctx.dt * ECON.fruitRecessionPerSecond;
    setFruitStore(net, Math.min(ECON.fruitThreshold, fruit.store + returned));
    if (fruit.progress <= 0) {
      net.fruit.active = false;
      fruit.store = 0;
      fruit.progress = 0;
      ctx.log(`The fruiting body failed: ${feeder ? 'its strand ran dry' : 'the strand beneath it was cut off'}.`);
    }
    return;
  }

  // Drought and frost halt an eruption. The sky has a veto, but it only ever
  // costs time: the committed store waits with the body.
  const kindSky = ctx.fruitingWeather || (ctx.warmth > 0.3 && ctx.world.rainfall > 0.45);
  if (!kindSky) return;

  const step = ctx.dt / ECON.fruitSeconds * (net.evolution.learned.includes('spore-memory') ? 1.15 : 1) * (net.evolution.active.bloom ? 2 : 1) * (ctx.fruitSpeed ?? 1);
  const spend = Math.min(fruit.store, ECON.fruitThreshold * step);
  setFruitStore(net, fruit.store - spend);

  if (fruit.store <= 0) {
    fruit.active = false;
    fruit.progress = 0;
    fruit.store = 0;
    net.fruited++;
    net.blooms.push({ gx: fruit.gx, gy: fruit.gy, spatial: fruit.spatial ? { ...fruit.spatial } : undefined, at: ctx.time });
    net.spores += ECON.sporesPerFruit;
    net.genetic += 4;
    ctx.log('Spores are away. The lineage travels.');
  }
}

export function updateTotals(net: Network): void {
  let carbon = 0;
  let water = 0;
  let nitrogen = 0;
  let living = 0;
  let starving = 0;
  // "Starving" means below working reserve, not merely nearly empty: the
  // point of the gate is that a network under-supplied anywhere is not
  // running a surplus worth banking.
  const count = (node: HyphaNode, c: number, w: number, n: number, strands: number): void => {
    living += strands;
    if (!node.connected) return;
    carbon += Math.max(0, c);
    water += Math.max(0, w);
    nitrogen += Math.max(0, n);
    if (c / strands < 0.7) starving += strands;
  };
  const economy = economyOf(net);
  if (economy) {
    forEachJunction(net, economy, (node) => count(node, node.carbon, node.water, node.nitrogen, 1));
    for (const segment of economy.segments) {
      if (segment.alive <= 0) continue;
      // Pools are shared by all members, the dead ones' shares included until the rebuild.
      const k = segment.members.length;
      const scale = segment.alive / k;
      count(net.nodes[segment.members[0]!]!, segment.carbon * scale, segment.water * scale, segment.nitrogen * scale, segment.alive);
    }
  } else {
    for (const node of net.nodes) if (node.alive) count(node, node.carbon, node.water, node.nitrogen, 1);
  }
  net.carbon = carbon;
  net.water = water;
  net.nitrogen = nitrogen;
  net.starving = starving;
  if (living === 0) net.extinct = true;
}

// ---------------------------------------------------------------------------
// Tree trade
//
// A tree's side of the partnership used to be written out inside `Simulation`.
// It lives here now because a colony that crosses a stand boundary trades with
// the destination stand's trees through exactly the same rules, and one copy of
// "what a partner costs and how it reacts" is the whole point of the migration.
// ---------------------------------------------------------------------------

/**
 * The junction currently feeding a tree, if any.
 *
 * A junction that has been severed from the root is not supplying anything,
 * however much of it is still standing: the tree feels the cut as an unmet
 * demand and counts down to leaving.
 */
export function bondedJunction(net: Network, tree: Tree): HyphaNode | null {
  for (const tip of tree.rootTips) {
    if (tip.bondedTo === null) continue;
    if ((tip.bondedColonyId ?? null) !== (net.colonyId ?? null)) continue;
    const node = net.nodes[tip.bondedTo];
    if (node && node.alive && node.connected) return node;
  }
  return null;
}

/** True when a tree still believes it is bonded to something. */
export function holdsAnyBond(tree: Tree, colonyId?: string): boolean {
  return tree.rootTips.some((tip) => tip.bondedTo !== null &&
    (colonyId === undefined || (tip.bondedColonyId ?? null) === colonyId));
}

/**
 * One tree drinks what it needs out of the junction that feeds it, and the tree
 * answers: a partner that is satisfied recovers, a short one loses patience,
 * and a partner that has gone without long enough gives the bond up.
 *
 * @returns true when the bond should be severed.
 */
export function drawTreeDemand(
  tree: Tree,
  junction: HyphaNode,
  spec: TreeSpeciesDemand,
  dt: number
): boolean {
  const wantWater = spec.waterDemand * dt * (0.5 + tree.maturity * 0.8);
  const wantNutrient = spec.nutrientDemand * dt * (0.5 + tree.maturity * 0.8);
  const gotWater = Math.min(junction.water, wantWater);
  const gotNutrient = Math.min(junction.nitrogen, wantNutrient);
  junction.water -= gotWater;
  junction.nitrogen -= gotNutrient;
  tree.waterReceived = gotWater / Math.max(1e-6, wantWater);
  tree.nutrientReceived = gotNutrient / Math.max(1e-6, wantNutrient);

  const satisfaction = Math.min(tree.waterReceived, tree.nutrientReceived);
  if (satisfaction > 0.85) {
    tree.patience = Math.min(spec.patience, tree.patience + dt * 2);
    tree.health = Math.min(1, tree.health + dt * 0.02 * satisfaction);
    return false;
  }
  tree.patience -= dt * (1.6 - satisfaction);
  tree.health = Math.max(0.05, tree.health - dt * 0.012 * (1 - satisfaction));
  return tree.patience <= 0;
}

/**
 * A tree still holding a bond whose strand is dead or cut off from the root.
 *
 * @returns true when the tree gives the bond up.
 */
export function starveBondedTree(tree: Tree, dt: number): boolean {
  tree.waterReceived = 0;
  tree.nutrientReceived = 0;
  tree.patience -= dt * 1.6;
  tree.health = Math.max(0.05, tree.health - dt * 0.012);
  return tree.patience <= 0;
}

/** Transfer a founding kit out of connected stores, atomically and in node order. */
export function payColonyFund(net: Network, cost: { carbon: number; water: number; nitrogen: number }): boolean {
  // Paid strand by strand: every strand holds its exact share first.
  releaseStrands(net);
  markConnectivity(net);
  updateTotals(net);
  const resources = ['carbon', 'water', 'nitrogen'] as const;
  if (resources.some(resource => !Number.isFinite(cost[resource]) || cost[resource] < 0 || net[resource] < cost[resource])) return false;
  for (const resource of resources) {
    let remaining = cost[resource];
    for (const node of net.nodes) {
      if (!node.alive || !node.connected) continue;
      const paid = Math.min(Math.max(0, node[resource]), remaining);
      node[resource] -= paid;
      remaining -= paid;
      if (remaining <= 0) break;
    }
  }
  updateTotals(net);
  return true;
}

// ---------------------------------------------------------------------------
// Player orders
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Subclusters
// ---------------------------------------------------------------------------

function groupById(net: Network, id: number | undefined): GrowthGroup | null {
  if (!id) return null;
  return net.groups?.find((g) => g.id === id) ?? null;
}

/** The waypoint queue a strand of this group follows. */
function waypointsOf(net: Network, id: number | undefined): Network['waypoints'] {
  return groupById(net, id)?.waypoints ?? net.waypoints;
}

/** A directed part of a split body holds within one cell of its destination. */
function atGroupTarget(net: Network, world: NetworkWorld, node: HyphaNode): boolean {
  if (!net.groups?.length) return false;
  const target = waypointsOf(net, node.group)[0];
  return Boolean(target && Math.hypot(target.gx + 0.5 - node.wx, target.gy + 0.5 - node.wy,
    world.spatialGrowth ? (target.lateral ?? node.y) - node.lateral : 0) <= 1.25);
}

/** Whether the group this strand belongs to is resting. */
function restingOf(net: Network, id: number | undefined): boolean {
  const group = groupById(net, id);
  return group ? group.resting : net.resting;
}

/**
 * A group with somewhere to go grows out of its own strands. If it has fewer
 * than a couple of tips (a region picked out of the network's interior has
 * none), it sprouts one from the strand of its own nearest the destination,
 * paid for like any fork, from the colony's shared tip allowance.
 */
function sproutGroups(net: Network, economy: StrandEconomy, ctx: StepContext): void {
  const groups = net.groups!;
  // The colony at large (id 0) is steered like any subcluster: a circle that
  // took all its tips must not leave it unable to grow.
  net.colonySprout ??= { id: 0, waypoints: net.waypoints, resting: net.resting, sproutAt: 0 };
  const colony = net.colonySprout;
  colony.waypoints = net.waypoints;
  colony.resting = net.resting;
  for (let i = groups.length; i >= 0; i--) {
    const group = i === groups.length ? colony : groups[i]!;
    const member = (node: HyphaNode) => (group.id === 0 ? !groupById(net, node.group) : node.group === group.id);
    // Strands are counted when the economy is built; tips are always junctions.
    let strands = economy.groupStrands.get(group.id) ?? 0, tips = 0;
    forEachJunction(net, economy, (node) => {
      if (node.isTip && member(node)) tips++;
    });
    if (tips > strands) strands = tips;
    // A group whose strands have all died has nothing left to steer.
    if (strands === 0) { if (group.id !== 0) groups.splice(i, 1); continue; }
    const target = group.waypoints[0];
    if (!target || group.resting || tips >= GROUP_MIN_TIPS || net.evolution.age < group.sproutAt) continue;
    let best: HyphaNode | null = null, bestDistance = Infinity;
    for (const node of net.nodes) {
      if (!node.alive || !node.connected || node.isTip || !member(node)) continue;
      if (heldBy(net, node, 'carbon') < ECON.parentReserveFloor + 0.5 || !ctx.world.passableFrom(node, 0, 0)) continue;
      const distance = Math.hypot(target.gx - node.gx, target.gy - node.gy,
        ctx.world.spatialGrowth ? (target.lateral ?? node.y) - node.y : 0);
      if (distance < bestDistance) { best = node; bestDistance = distance; }
    }
    if (!best || bestDistance <= 1.25) continue;
    group.sproutAt = net.evolution.age + 1.5;
    // Find a viable parent before borrowing a tip. Otherwise an ordered but
    // resource-starved group can repeatedly prune a different group's frontier.
    // The allowance is shared, not multiplied: when it is spent, the group with
    // the most tips gives one up so the ordered subcluster can grow.
    if (net.tipCount >= net.tipCeiling && !retireTipFor(net, group.id)) continue;
    const tip = spawnTip(net, best, Math.atan2(target.gy - best.gy, target.gx - best.gx), net.rng);
    chooseTarget(net, ctx.world, tip, net.rng);
    tip.retargetAt = nextRetarget(net);
    best.pulse = 1;
  }
}

/**
 * Free one tip from the shared allowance for `forGroup`: the group (or the
 * colony at large) with the most tips, keeping at least one, stops its
 * youngest tip where it stands. Deterministic: ties go to the lower group id
 * and the higher node id.
 */
function retireTipFor(net: Network, forGroup: number): boolean {
  const counts = new Map<number, number>();
  for (const node of net.nodes) {
    if (!node.alive || !node.isTip) continue;
    const id = groupById(net, node.group) ? node.group! : 0;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let donor = -1, most = 1;
  for (const [id, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (id !== forGroup && count > most) { donor = id; most = count; }
  }
  if (donor < 0) return false;
  let youngest: HyphaNode | null = null;
  for (const node of net.nodes) {
    if (!node.alive || !node.isTip || (groupById(net, node.group) ? node.group! : 0) !== donor) continue;
    if (!youngest || node.age <= youngest.age) youngest = node;
  }
  if (!youngest) return false;
  // The strand ends here: it settles into the cell it stands in.
  youngest.isTip = false;
  youngest.wx = youngest.gx + 0.5;
  youngest.wy = youngest.gy + 0.5;
  youngest.targetGx = youngest.gx;
  youngest.targetGy = youngest.gy;
  youngest.ordered = false;
  net.tipCount = Math.max(0, net.tipCount - 1);
  economyOf(net)?.settled.push(youngest.id);
  return true;
}

export interface GroupSummary { id: number; strands: number; tips: number; resting: boolean; ordered: boolean }

/** Every subcluster, and the colony at large as id 0, with its living strands and tips. */
export function groupSummary(net: Network): GroupSummary[] {
  const counts = new Map<number, { strands: number; tips: number }>();
  for (const node of net.nodes) {
    if (!node.alive) continue;
    const id = groupById(net, node.group) ? node.group! : 0;
    const c = counts.get(id) ?? { strands: 0, tips: 0 };
    c.strands++;
    if (node.isTip) c.tips++;
    counts.set(id, c);
  }
  const colony = counts.get(0) ?? { strands: 0, tips: 0 };
  return [
    { id: 0, ...colony, resting: net.resting, ordered: net.waypoints.length > 0 },
    ...(net.groups ?? []).map((g) => ({ id: g.id, ...(counts.get(g.id) ?? { strands: 0, tips: 0 }), resting: g.resting, ordered: g.waypoints.length > 0 })),
  ];
}

/**
 * Split a subcluster out of the colony: every living strand within `radius`
 * of the point (grid cells) joins a new group with orders of its own. Strands
 * already in another group move to the new one.
 */
export function createGroup(
  net: Network, world: NetworkWorld, gx: number, gy: number, radius: number
): { ok: boolean; message: string; id?: number; strands?: number; tips?: number } {
  return createGroupWhere(net, world, (n) => Math.hypot(n.gx + 0.5 - gx, n.gy + 0.5 - gy) <= radius);
}

/**
 * Split the living strands a rule picks into a new subcluster. The transect
 * circles by grid cell; a regional section circles in physical XYZ.
 */
export function createGroupWhere(
  net: Network, world: NetworkWorld, pick: (node: HyphaNode) => boolean
): { ok: boolean; message: string; id?: number; strands?: number; tips?: number } {
  let living = 0;
  for (const node of net.nodes) if (node.alive && node.connected) living++;
  if (living < MIN_SPLIT_STRANDS) {
    return { ok: false, message: `Grow the colony to ${MIN_SPLIT_STRANDS} strands before splitting it (${living} now).` };
  }
  net.groups ??= [];
  const selected = net.nodes.filter((n) => n.alive && pick(n));
  if (selected.length < MIN_GROUP_STRANDS) {
    return { ok: false, message: `Circle at least ${MIN_GROUP_STRANDS} of your strands to make a subcluster.` };
  }
  // Emptied groups make room before the cap is checked.
  const kept = new Set(net.nodes.filter((n) => n.alive && n.group && !selected.includes(n)).map((n) => n.group));
  net.groups = net.groups.filter((g) => kept.has(g.id));
  if (net.groups.length >= MAX_GROUPS) {
    return { ok: false, message: `At most ${MAX_GROUPS} subclusters. Merge one back into the colony first.` };
  }
  const id = Math.max(0, ...net.groups.map((g) => g.id)) + 1;
  net.groups.push({ id, waypoints: [], resting: false, sproutAt: 0 });
  // Subcluster strand counts are taken when the economy is built.
  markStrandsStale(net);
  let tips = 0;
  for (const node of selected) {
    node.group = id;
    if (node.isTip) {
      tips++;
      // Released from the colony's orders: read the soil until told otherwise.
      chooseTarget(net, world, node, net.rng);
    }
  }
  return { ok: true, message: `Subcluster ${id}: ${selected.length} strands, ${tips} growing tips. Click the soil to steer it.`, id, strands: selected.length, tips };
}

/** Return a subcluster's strands to the colony at large, and its tips to the colony's orders. */
export function dissolveGroup(net: Network, world: NetworkWorld, id: number): boolean {
  if (!groupById(net, id)) return false;
  net.groups = net.groups!.filter((g) => g.id !== id);
  markStrandsStale(net);
  for (const node of net.nodes) {
    if (node.group !== id) continue;
    delete node.group;
    if (node.alive && node.isTip) chooseTarget(net, world, node, net.rng);
  }
  return true;
}

/** Rest or wake one subcluster (0 is the colony at large). */
export function setGroupResting(net: Network, id: number, resting: boolean): void {
  const group = groupById(net, id);
  if (group) group.resting = resting;
  else net.resting = resting;
}

/** Whether a subcluster (0 is the colony at large) is resting. */
export function groupResting(net: Network, id: number): boolean {
  return restingOf(net, id);
}

/** Send the growth frontier toward a point. Ordered tips break off first. */
export function orderWaypoint(net: Network, gx: number, gy: number, world?: NetworkWorld, lateral?: number, groupId = 0): void {
  // The order has to land on the colony's own growth plane, not on one stand's
  // width: a strand that has crossed a boundary can be sent further into the
  // neighbouring square.
  if (
    !Number.isFinite(gx) ||
    !Number.isFinite(gy) ||
    gx < (net.bounds.minCol ?? 0) ||
    gy < 0 ||
    gx >= net.bounds.cols ||
    gy >= net.bounds.rows
  ) {
    return;
  }
  // An order goes to one subcluster, or to the colony at large (group 0).
  const group = groupById(net, groupId);
  const queue = group ? group.waypoints : net.waypoints;
  if (group) {
    group.resting = false;
    group.sproutAt = 0;
  } else {
    net.resting = false;
    if (net.colonySprout) net.colonySprout.sproutAt = 0;
  }
  queue.length = 0;
  queue.push({ gx, gy, lateral });
  if (queue.length > 6) queue.shift();
  if (world) {
    // Retarget now, not after each strand has finished its previous journey.
    const id = group ? group.id : 0;
    for (const node of net.nodes) {
      if (!node.alive || !node.isTip) continue;
      if ((groupById(net, node.group) ? node.group : 0) !== id) continue;
      chooseTarget(net, world, node, net.rng);
    }
  }
}

export const BOND_REACH_CM = 3.5 * GRID.cmPerRow;

/** The nearest unbonded junction and the carbon on its connected route home. */
export function bondCandidate(
  net: Network,
  world: NetworkWorld,
  tree: Tree,
  tip: Tree['rootTips'][number]
): { node: HyphaNode; distanceCm: number; availableCarbon: number } | null {
  let best: HyphaNode | null = null;
  let bestDist = Infinity;
  const tipPosition = world.rootTipPosition(tree, tip);
  for (const node of net.nodes) {
    if (!node.alive || !node.connected || node.bondedTree >= 0) continue;
    const distance = distanceCm(world.nodePosition(node), tipPosition);
    if (distance < bestDist) {
      bestDist = distance;
      best = node;
    }
  }
  if (!best) return null;
  let availableCarbon = 0;
  for (let source: HyphaNode | undefined = best; source; source = source.parent >= 0 ? net.nodes[source.parent] : undefined) {
    if (!source.alive || !source.connected) break;
    availableCarbon += Math.max(0, heldBy(net, source, 'carbon'));
  }
  return { node: best, distanceCm: bestDist, availableCarbon };
}

/**
 * Attempt a symbiosis. The closest free strand within reach makes the junction.
 * Its connected ancestors can fund the small bond charge, so a lean tip beside
 * a root is not stranded while the founding spore still holds ample carbon.
 */
export function tryBond(
  net: Network,
  world: NetworkWorld,
  treeId: number,
  rootTipId: number,
  // Reach is a real 3D distance now, so the flat transect's old 3.5 grid cells
  // becomes the same number of centimetres rather than a different scale.
  reach = BOND_REACH_CM
): boolean {
  const tree = world.trees[treeId];
  const tip = tree?.rootTips[rootTipId];
  if (!tree || !tip || tip.bondedTo !== null || tree.dead) return false;

  const candidate = bondCandidate(net, world, tree, tip);
  if (!candidate || candidate.distanceCm > reach || candidate.availableCarbon < ECON.bondCharge) return false;
  // The new junction leaves its run, and the charge is paid strand by strand.
  releaseStrands(net);
  const best = candidate.node;
  const path: HyphaNode[] = [];
  for (let source: HyphaNode | undefined = best; source; source = source.parent >= 0 ? net.nodes[source.parent] : undefined) path.push(source);
  let remaining = ECON.bondCharge;
  // The founder pays first when it can; a junction keeps its own working float.
  for (const source of path.reverse()) {
    const paid = Math.min(Math.max(0, source.carbon), remaining);
    source.carbon -= paid;
    remaining -= paid;
    if (remaining <= 0) break;
  }
  best.bondedTree = treeId;
  best.bondedRootTip = rootTipId;
  best.thickness = Math.max(best.thickness, 0.55);
  best.pulse = 1;
  tip.bondedTo = best.id;
  tip.bondedColonyId = net.colonyId ?? null;
  net.genetic += 1;
  return true;
}

/**
 * Carbon a colony keeps back when it lays cords, so one long drag cannot spend
 * the working reserve its frontier and partners live on.
 */
export const CORD_RESERVE = 6;
/** Longest route one cord order may lay. */
export const CORD_ROUTE_MAX = 160;

/**
 * The strands between two nodes along the colony's own graph, in order from
 * `fromId` toward `toId`. Each id stands for the strand joining that node to its
 * parent, which is what a cord thickens. The founding node (`toId` by default)
 * has no strand of its own, so a route home ends one short of it.
 */
export function cordRoute(net: Network, fromId: number, toId = net.rootId): number[] {
  const nodes = net.nodes;
  const from = nodes[fromId];
  const to = nodes[toId];
  if (!from?.alive || !to?.alive || fromId === toId) return [];
  const up = (start: HyphaNode): number[] => {
    const chain: number[] = [];
    for (let node: HyphaNode | undefined = start; node; node = node.parent >= 0 ? nodes[node.parent] : undefined) {
      if (!node.alive) break;
      chain.push(node.id);
      if (chain.length > nodes.length) break;
    }
    return chain;
  };
  const a = up(from);
  const index = new Map(a.map((id, i) => [id, i]));
  const b: number[] = [];
  for (const id of up(to)) {
    const at = index.get(id);
    if (at !== undefined) return [...a.slice(0, at), ...b.reverse()].slice(0, CORD_ROUTE_MAX);
    b.push(id);
  }
  // No shared ancestor: one end is on a severed piece.
  return [];
}

/** Carbon a connected colony can put into cords right now. */
export function cordBudget(net: Network): number {
  let carbon = 0;
  for (const node of net.nodes) if (node.alive && node.connected) carbon += heldBy(net, node, 'carbon');
  return Math.max(0, carbon - CORD_RESERVE);
}

/**
 * What a cord order along `route` would do: how many of its strands (from the
 * start) the colony can afford, and what that costs. Strands that are already
 * cords are free to pass along.
 */
export function planCord(net: Network, route: readonly number[], budget = cordBudget(net)): { affordable: number; cost: number; fresh: number } {
  let cost = 0;
  let fresh = 0;
  let affordable = 0;
  for (const id of route) {
    const node = net.nodes[id];
    if (!node?.alive || node.parent < 0) break;
    if (!node.reinforced) {
      if (cost + ECON.cordCharge > budget) break;
      cost += ECON.cordCharge;
      fresh++;
    }
    affordable++;
  }
  return { affordable, cost, fresh };
}

/**
 * Lay a cord along a route: as far as the colony can afford, paid from its
 * connected strands, and never through its last working reserve. Returns the
 * number of strands newly thickened.
 */
export function layCord(net: Network, route: readonly number[]): number {
  markConnectivity(net);
  const plan = planCord(net, route);
  if (plan.fresh === 0) return 0;
  if (!payColonyFund(net, { carbon: plan.cost, water: 0, nitrogen: 0 })) return 0;
  // Cords widen their runs' narrowest pipes.
  markStrandsStale(net);
  for (const id of route.slice(0, plan.affordable)) {
    const node = net.nodes[id]!;
    node.pulse = 1;
    if (node.reinforced) continue;
    node.reinforced = true;
    node.thickness = Math.max(node.thickness, 0.9);
  }
  return plan.fresh;
}

/** Spend carbon to turn a strand into a cord: fast transport, higher upkeep. */
export function makeCord(net: Network, nodeId: number): boolean {
  const node = net.nodes[nodeId];
  if (!node || !node.alive) return false;
  if (node.reinforced) return false;
  // The strand pays from its exact share, and the cord widens its run's narrowest pipe.
  releaseStrands(net);
  if (node.carbon < ECON.cordCharge) return false;
  node.carbon -= ECON.cordCharge;
  node.thickness = 0.9;
  node.reinforced = true;
  node.pulse = 1;
  return true;
}

/**
 * Begin a fruiting body at the given cell.
 *
 * The whole reserve is committed here and now, and the body spends it as it
 * grows. Paying up front is what makes the record honest: there is no second,
 * invisible reserve collected while a mushroom is rising, and nothing is
 * quietly erased when it finishes.
 *
 * @returns the strand the body rose from, or null if the order was refused.
 */
export function startFruiting(net: Network, world: World | (() => boolean), gx: number, gy: number,
  placement?: { nodeId: number; spatial: Vec3 }): HyphaNode | null {
  if (gy < 0 || gy > 12) return null;
  if (net.fruit.active) return null;
  if (net.surplus < ECON.fruitThreshold) return null;
  if (!(typeof world === 'function' ? world() : isPassable(world, gx, gy))) return null;
  // Fruiting bodies erupt above ground, so they need a strand near the surface.
  let near: HyphaNode | null = null;
  let bestDist = Infinity;
  for (const node of net.nodes) {
    if (!node.alive || !node.connected) continue;
    if (placement && node.id !== placement.nodeId) continue;
    const d = placement && node.spatial
      ? Math.hypot(node.spatial.x - placement.spatial.x, node.spatial.y - placement.spatial.y,
        node.spatial.z - placement.spatial.z)
      : Math.hypot(node.gx - gx, node.gy - gy);
    if (d <= 2 && d < bestDist) {
      bestDist = d;
      near = node;
    }
  }
  if (!near) return null;
  net.fruit.active = true;
  setFruitStore(net, ECON.fruitThreshold);
  net.surplus = Math.max(0, net.surplus - ECON.fruitThreshold);
  net.fruit.nodeId = near.id;
  net.fruit.gx = gx;
  net.fruit.gy = gy;
  // The body stands where its own strand physically stands, so a bloom can be
  // found again above ground. A caller naming its own site (a regional order
  // that has already chosen a voxel) still wins over the strand's address.
  net.fruit.spatial = placement
    ? { ...placement.spatial }
    : near.spatial
      ? { ...near.spatial }
      : undefined;
  return near;
}

/** The single node nearest a grid point, for click-to-select interactions. */
export function nearestNode(net: Network, gx: number, gy: number, maxDist = 2.5): HyphaNode | null {
  let best: HyphaNode | null = null;
  let bestDist = maxDist;
  for (const node of net.nodes) {
    if (!node.alive) continue;
    const d = Math.hypot(node.wx - (gx + 0.5), node.wy - (gy + 0.5));
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}
