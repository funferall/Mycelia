import { ECON, GRID, STRATA, type Stratum } from './content';
import { inBounds, idx, type World } from './world';
import type { Rng } from './rng';

export type Owner = 'player' | 'rival';

export interface HyphaNode {
  id: number;
  /** Index of the parent node, or -1 for the founding spore. */
  parent: number;
  children: number[];
  /** Grid cell this node currently occupies. */
  gx: number;
  gy: number;
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
}

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
}

/** A mushroom that finished erupting, kept so the sheet can show where it stood. */
export interface Bloom {
  gx: number;
  gy: number;
  /** Simulation time the spores left, in seconds. */
  at: number;
}

export interface Network {
  owner: Owner;
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
  rng: Rng;
  /** Waypoints the player has queued, oldest first. */
  waypoints: Array<{ gx: number; gy: number }>;
}

/** The growth frontier is capped so a match stays about expansion decisions. */
export const MAX_TIPS = 90;
/** Hard ceiling on living nodes, to bound draw cost and match length. */
export const MAX_NODES = 5200;

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
  rng: Rng,
  force = false
): HyphaNode | null {
  // A tip's continuation is never refused: a network whose last tip died could
  // never grow again, which is a dead end rather than a strategy. Only new
  // forks compete for the node budget.
  if (!force && net.nodes.length >= MAX_NODES) return null;
  if (net.nodes.length >= MAX_NODES * 1.25) return null;
  const step = 1;
  let tx = Math.round(from.gx + Math.cos(angle) * step);
  let ty = Math.round(from.gy + Math.sin(angle) * step);
  // Bias tips downward at first: the surface is bright and crowded, and the
  // interesting soil is below.
  if (rng() < 0.55) ty = Math.max(ty, from.gy);
  if (!inBounds(tx, ty)) {
    tx = Math.max(0, Math.min(GRID.cols - 1, tx));
    ty = Math.max(0, Math.min(GRID.rows - 1, ty));
  }

  // Draw the child's starting body out of the parent. Water and mineral are
  // taken proportionally and may be thin; carbon is what a strand really has to
  // give up, so the parent keeps a floor it cannot be pushed below.
  const carbonGive = Math.min(
    ECON.birthReserve,
    Math.max(0, from.carbon - ECON.parentReserveFloor)
  );
  const share = carbonGive / ECON.birthReserve;
  const waterGive = Math.min(0.6 * share, from.water);
  const nitrogenGive = Math.min(0.3 * share, from.nitrogen);
  from.carbon -= carbonGive;
  from.water -= waterGive;
  from.nitrogen -= nitrogenGive;

  const node: HyphaNode = {
    id: net.nodes.length,
    parent: from.id,
    children: [],
    gx: from.gx,
    gy: from.gy,
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
    connected: true,
    bondedTree: -1,
    bondedRootTip: -1,
    flow: 0,
    pulse: 0,
    age: 0,
    ordered: false,
    retargetAt: 0,
    paid: false,
  };
  net.nodes.push(node);
  from.children.push(node.id);
  net.tipCount++;
  return node;
}

/** Resistance of the cell a tip is about to enter, and what it costs to enter. */
function entryCost(world: World, gx: number, gy: number): { cost: number; stratum: Stratum } {
  const cell = world.cells[idx(gx, gy)];
  const stratum = STRATA[cell ? cell.stratum : 'bedrock'];
  // Hard, dense soil costs more; loose organic litter costs less.
  const hardness = cell ? cell.hardness : 1;
  const cost = stratum.growthCost * (0.75 + hardness * 0.7) * GRID.cmPerRow;
  return { cost, stratum };
}

export function isPassable(world: World, gx: number, gy: number): boolean {
  if (!inBounds(gx, gy)) return false;
  const cell = world.cells[idx(gx, gy)];
  // Bedrock and open water both refuse hyphae, but for different reasons: rock
  // is impassable ground and the stream is not ground at all. The channel is a
  // threshold rather than a boundary because its bed is passable and its bank
  // is the wettest soil in the stand.
  return Boolean(cell) && cell.stratum !== 'bedrock' && !cell.stream;
}

/**
 * Pick the next cell a tip should grow into.
 *
 * Ordered tips head straight for the player's waypoint. Unordered tips read the
 * soil: they prefer moisture, nitrogen and unexplored ground, keep some of
 * their previous heading so strands run rather than wander, and are nudged away
 * from cells the network already occupies.
 */
function chooseTarget(net: Network, world: World, tip: HyphaNode, rng: Rng): void {
  const wantOrder = net.waypoints.length > 0;
  if (wantOrder) {
    const wp = net.waypoints[0] as { gx: number; gy: number };
    const dx = wp.gx - tip.wx;
    const dy = wp.gy - tip.wy;
    const dist = Math.hypot(dx, dy);
    if (dist < 2.5) {
      net.waypoints.shift();
    } else {
      const step = 1.6;
      let tx = Math.round(tip.gx + (dx / dist) * step);
      let ty = Math.round(tip.gy + (dy / dist) * step);
      if (!isPassable(world, tx, ty)) {
        // Deflect around the obstruction rather than stalling against it.
        const sign = rng() < 0.5 ? 1 : -1;
        tx = Math.round(tip.gx + (-dy / dist) * sign * step);
        ty = Math.round(tip.gy + (dx / dist) * sign * step);
      }
      if (isPassable(world, tx, ty)) {
        tip.targetGx = tx;
        tip.targetGy = ty;
        tip.ordered = true;
        tip.paid = false;
        return;
      }
      net.waypoints.shift();
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
      if (!isPassable(world, tx, ty)) continue;
      const cell = world.cells[idx(tx, ty)];
      if (!cell) continue;

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

export interface StepContext {
  world: World;
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

  const nodes = net.nodes;
  for (const n of nodes) {
    if (!n.alive) continue;
    n.age += dt;
    n.pulse = Math.max(0, n.pulse - dt * 0.9);
    n.flow *= 0.86;
  }

  markConnectivity(net);
  updateTipCeiling(net);
  harvest(net, world, ctx);
  transport(net, dt);
  respire(net);
  if (!net.resting) extendTips(net, ctx);
  thicken(net, world, dt);
  decay(net, world, dt);
  progressFruiting(net, ctx);
  updateTotals(net);
}

/** Recompute how wide the growth frontier may be. */
function updateTipCeiling(net: Network): void {
  if (net.owner === 'rival') {
    // A saprotroph does not court trees, so it is not gated on symbiosis.
    net.tipCeiling = 34;
    return;
  }
  let bonded = 0;
  for (const node of net.nodes) {
    // A cut-off junction is no longer feeding a tree, so it no longer widens
    // the frontier either. Growth capacity has to be paid for with live trade.
    if (node.alive && node.connected && node.bondedTree >= 0) bonded++;
  }
  net.tipCeiling = Math.min(MAX_TIPS, 6 + bonded * 13);
}

/**
 * Flood from the root and mark everything reachable. Severed strands stay alive
 * for a while and starve — cutting a cord must be felt in real time, not
 * immediately deletes the strand.
 */
function markConnectivity(net: Network): void {
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
function harvest(net: Network, world: World, ctx: StepContext): void {
  const { dt } = ctx;
  for (const node of net.nodes) {
    if (!node.alive || !node.connected) continue;
    const cell = world.cells[idx(node.gx, node.gy)];
    if (!cell) continue;

    // Water: drawn from the soil, replenished by rain and the water table.
    const draw = ECON.waterDrawPerNode * dt * (1 + node.thickness * 2);
    const got = Math.min(draw, cell.water);
    cell.water -= got * 0.06;
    node.water = Math.min(ECON.nodeWaterCap, node.water + got);

    // Nitrogen and phosphorus: mined from the cell the node stands in. The
    // horizon holds a finite standing stock and rebuilds it slowly, so a pocket
    // that has been worked over goes quiet until either the network grows on or
    // the soil has had time to mineralise again.
    const uptake = Math.min(cell.nitrogen, 0.09 * dt * (0.6 + node.thickness));
    cell.nitrogen = Math.max(0, cell.nitrogen - uptake * ECON.nitrogenSoilCost);
    node.nitrogen = Math.min(ECON.nodeNitrogenCap, node.nitrogen + uptake);

    // Decomposition: hyphae metabolise the organic matter they are sitting in.
    // The rate scales with how rich the material is, so the litter layer is a
    // real income stream and barren clay is somewhere you pass through.
    if (cell.organic > 0.15) {
      const bite = Math.min(cell.organic, 0.02 * dt) * (0.35 + cell.organic);
      cell.organic -= bite * 0.05;
      // Held resources are capped: the excess is simply lost, which is what
      // forces the player to keep investing rather than banking.
      node.carbon += Math.min(bite * 3.2, Math.max(0, ECON.nodeCarbonCap - node.carbon));
    }
  }

  // Symbiosis: bonded trees pay in sugar, and only while they are healthy.
  const world_trees = ctx.world.trees;
  for (const node of net.nodes) {
    // Only a strand still joined to the root can trade on the network's behalf.
    // A junction that has been cut off is not delivering anything to the tree,
    // and must not keep paying the player for a bond the tree cannot feel.
    if (!node.alive || !node.connected || node.bondedTree < 0) continue;
    const tree = world_trees[node.bondedTree];
    if (!tree || tree.dead) {
      node.bondedTree = -1;
      node.bondedRootTip = -1;
      continue;
    }
    const spec = (ctx.world.trees[node.bondedTree] as { species: string }).species;
    const rate = tree.health * ctx.light * (0.6 + tree.maturity * 0.6);
    const income = rate * carbonPerSecond(spec) * dt;
    // Rest directs a measured share of current photosynthesis into reproduction.
    // Starting reserves cannot masquerade as an earned fruiting surplus.
    const saved = net.resting && tree.waterReceived > 0.65 && tree.nutrientReceived > 0.65
      ? income * 0.55 : 0;
    net.surplus = Math.min(ECON.fruitThreshold, net.surplus + saved);
    node.carbon += Math.min(income - saved, Math.max(0, ECON.nodeCarbonCap * 1.6 - node.carbon));
    node.pulse = Math.min(1, node.pulse + dt * 0.6);
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
function transport(net: Network, dt: number): void {
  const nodes = net.nodes;
  const order = traversalOrder(net);

  // Carbon travels up from strands holding more than they need, and back down
  // to any node below its working reserve. A growing tip needs real fuel, so
  // the frontier is topped up rather than merely rescued; only what nobody
  // needs reaches the root, and only what the root cannot use becomes surplus.
  moveResource(nodes, order, 'carbon',
    node => carbonReserve(node),
    node => carbonReserve(node),
    dt,
    true);

  // Mark the strands that stand between the root and a tree. A partner is an
  // obligation rather than an option, so these are the routes that get fed.
  const supplyPath = new Set<number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const node = nodes[order[i] as number];
    if (node.bondedTree >= 0 || supplyPath.has(node.id)) {
      supplyPath.add(node.id);
      if (node.parent >= 0) supplyPath.add(node.parent);
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
  const thirsty = wantsSupply(nodes);

  for (const key of ['water', 'nitrogen'] as const) {
    const cap = key === 'water' ? ECON.nodeWaterCap : ECON.nodeNitrogenCap;
    moveResource(nodes, order, key,
      node => standingReserve(node, key, thirsty),
      // A junction is filled to its whole capacity, and so is every strand on
      // the route to it: a strut is a pipe, not a cistern, and it passes what it
      // receives straight on to the tree.
      node => (node.bondedTree >= 0 || supplyPath.has(node.id) ? cap : standingReserve(node, key, thirsty)),
      dt,
      node => !supplyPath.has(node.id));
  }
}

type ResourceKey = 'carbon' | 'water' | 'nitrogen';

/** Carbon a strand refuses to give up: fuel for a tip, and a junction's float. */
function carbonReserve(node: HyphaNode): number {
  return (node.isTip ? 2.2 : 0.9) + (node.bondedTree >= 0 ? 1 : 0);
}

/**
 * Respiration: carbon a strand cannot use is lost rather than banked.
 *
 * Storage is deliberately tiny. A node holds about one centimetre of growth
 * plus its working float, and the founding spore holds the reserve the match
 * opened with and not a gram more. A player who stops making decisions watches
 * their income evaporate instead of sitting on a fortune, which is what keeps
 * every match a series of investments rather than a slow accumulation.
 */
function respire(net: Network): void {
  for (const node of net.nodes) {
    if (!node.alive) continue;
    const cap = node.id === net.rootId
      ? Math.max(ECON.nodeCarbonCap, net.carbonCeiling)
      : ECON.nodeCarbonCap * (node.bondedTree >= 0 ? 1.6 : 1);
    if (node.carbon > cap) node.carbon = cap;
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
  if (thirsty) return 0;
  return key === 'water' ? 0.1 : 0.04;
}

/**
 * Is a bonded tree short of what it was promised?
 *
 * A junction that is not holding its full store is a tree that is not being
 * fully served, which is the signal the rest of the network answers.
 */
function wantsSupply(nodes: HyphaNode[]): boolean {
  for (const node of nodes) {
    if (!node.alive || !node.connected || node.bondedTree < 0) continue;
    if (node.water < ECON.nodeWaterCap * 0.9 || node.nitrogen < ECON.nodeNitrogenCap * 0.9) return true;
  }
  return false;
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
  nodes: HyphaNode[],
  order: number[],
  key: ResourceKey,
  surplusAbove: (node: HyphaNode) => number,
  fillTo: (node: HyphaNode) => number,
  dt: number,
  holdsBack: boolean | ((node: HyphaNode) => boolean)
): void {
  const pipe = (node: HyphaNode): number => (1.2 + node.thickness * 9) * (node.reinforced ? ECON.cordThroughput : 1) * dt;
  const isCarbon = key === 'carbon';
  const holds = typeof holdsBack === 'function' ? holdsBack : () => holdsBack;

  for (let i = order.length - 1; i >= 0; i--) {
    const node = nodes[order[i] as number];
    if (!node || !node.alive || node.parent < 0) continue;
    const surplus = node[key] - surplusAbove(node);
    if (surplus <= 0) continue;
    const parent = nodes[node.parent];
    if (!parent || !parent.alive) continue;
    const moved = Math.min(surplus, pipe(node));
    node[key] -= moved;
    parent[key] += moved;
    if (isCarbon) {
      node.flow -= moved;
      parent.flow += moved;
    }
  }

  for (const id of order) {
    const node = nodes[id];
    if (!node || !node.alive || node.children.length === 0) continue;
    for (const childId of node.children) {
      const child = nodes[childId];
      if (!child || !child.alive) continue;
      const deficit = fillTo(child) - child[key];
      if (deficit <= 0) continue;
      // A parent must keep strictly less than the level it fills its children
      // to, or a node sitting exactly at its reserve could never be topped up
      // and would slowly die of upkeep. The root keeps more than everyone else,
      // so supply flows outward down a gradient instead of pooling at the base.
      const keep = holds(node) ? surplusAbove(node) * (isCarbon && node.parent < 0 ? 3 : 0.35) : 0;
      const movable = Math.max(0, node[key] - keep);
      const moved = Math.min(deficit, movable, pipe(node));
      if (moved <= 0) continue;
      node[key] -= moved;
      child[key] += moved;
      if (isCarbon) {
        node.flow -= moved;
        child.flow += moved;
      }
    }
  }
}

/** Root-first order over living nodes. */
function traversalOrder(net: Network): number[] {
  const order: number[] = [];
  const stack: number[] = [net.rootId];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    const node = net.nodes[id];
    if (!node || !node.alive) continue;
    order.push(id);
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i] as number);
    }
  }
  return order;
}

/**
 * Extend every tip toward its target cell. A tip pays carbon and nitrogen when
 * it commits to entering new soil; until it can afford the entry it waits,
 * which is what makes nutrient supply the real limit on expansion speed.
 */
function extendTips(net: Network, ctx: StepContext): void {
  const { world, dt } = ctx;
  if (net.tipCount <= 0) return;

  const speed = ECON.tipSpeedCm * (0.45 + ctx.warmth * 0.75);

  for (const node of net.nodes) {
    if (!node.alive || !node.isTip) continue;

    const tx = node.targetGx + 0.5;
    const ty = node.targetGy + 0.5;
    const dx = tx - node.wx;
    const dy = ty - node.wy;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.04) {
      commitTip(net, world, node, ctx);
      continue;
    }

    // Entering a new cell has a one-time cost; moving within the current cell
    // is cheap. Pay on the frame the tip crosses the boundary.
    const entering = node.targetGx !== node.gx || node.targetGy !== node.gy;
    const { cost, stratum } = entryCost(world, node.targetGx, node.targetGy);
    if (!Number.isFinite(cost) || !isPassable(world, node.targetGx, node.targetGy)) {
      // Impassable target: pick again rather than stalling against stone.
      chooseTarget(net, world, node, net.rng);
      node.retargetAt = nextRetarget(net);
      continue;
    }

    if (entering) {
      if (!node.paid) {
        // Cost rises sharply as the network approaches its ceiling, so growth
        // stalls out rather than stopping dead. Tips stay alive and can still
        // creep, but widening the network stops being free.
        const crowding = net.nodes.length / MAX_NODES;
        const pressure = 1 + Math.pow(Math.max(0, crowding), 4) * 14;
        const total = cost * ECON.growthPerCm * ECON.entryCharge * pressure;
        if (
          node.carbon < total ||
          node.nitrogen < total * ECON.nitrogenPerCm ||
          node.water < total * ECON.waterPerCm
        ) {
          continue; // Starved of carbon or nitrogen: sit and wait.
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
      continue;
    }

    const stepLen = Math.min(dist, speed * dt);
    node.wx += (dx / dist) * stepLen;
    node.wy += (dy / dist) * stepLen;

    // Re-read the soil on a timer, so growth tracks depletion and a rival's
    // arrival without rescanning the whole network every time a tip commits.
    if (net.lengthCm > 0 && node.age > node.retargetAt) {
      chooseTarget(net, world, node, net.rng);
      node.retargetAt = nextRetarget(net);
    }
  }
}

/** Staggered so the whole frontier never re-reads the soil on the same tick. */
function nextRetarget(net: Network): number {
  return net.nodes[net.rootId] ? 6 + net.rng() * 10 : 6;
}

/** A tip has arrived: it becomes a strut, and sprouts the next generation. */
function commitTip(net: Network, world: World, node: HyphaNode, ctx: StepContext): void {
  node.wx = node.targetGx + 0.5;
  node.wy = node.targetGy + 0.5;
  node.gx = node.targetGx;
  node.gy = node.targetGy;
  node.isTip = false;
  net.tipCount--;

  const cell = world.cells[idx(node.gx, node.gy)];
  if (cell) cell.occupancy = Math.min(1, cell.occupancy + 0.34);
  net.lengthCm += GRID.cmPerRow;

  const rng = net.rng;
  // A strand that has run a while tends to keep running; occasionally it forks.
  const parent = node.parent >= 0 ? net.nodes[node.parent] : null;
  const baseAngle = parent ? Math.atan2(node.gy - parent.gy, node.gx - parent.gx) : Math.PI / 2;

  // The strand continues: a tip always hands its heading on to exactly one
  // successor, so the growth frontier can never be accidentally extinguished.
  const successor = spawnTip(net, node, baseAngle + (rng() - 0.5) * 0.5, rng, true);
  if (successor) {
    chooseTarget(net, world, successor, rng);
    successor.retargetAt = nextRetarget(net);
  }

  // Forking is what the tip budget actually limits, so a wide network and a
  // long one are competing uses of the same soil.
  const forkChance = 0.1 + (cell && cell.nitrogen > 0.5 ? 0.12 : 0);
  if (net.tipCount < net.tipCeiling && net.nodes.length < MAX_NODES && rng() < forkChance) {
    const side = rng() < 0.5 ? 1 : -1;
    const fork = spawnTip(net, node, baseAngle + side * (0.7 + rng() * 0.6), rng);
    if (fork) {
      chooseTarget(net, world, fork, rng);
      fork.retargetAt = nextRetarget(net);
    }
  }
  void ctx;
}

/**
 * Thicken strands that carry the most traffic. This is where a network's shape
 * starts to matter: the cords that emerge follow the routes the economy
 * actually uses, so the picture of the network is a picture of the decisions.
 */
function thicken(net: Network, world: World, dt: number): void {
  for (const node of net.nodes) {
    if (!node.alive || node.isTip) continue;
    const traffic = Math.abs(node.flow);
    const target = Math.max(node.reinforced ? 0.9 : 0, Math.min(1, 0.08 + traffic * 0.22 + node.age * 0.004));
    if (target > node.thickness) {
      node.thickness += (target - node.thickness) * Math.min(1, dt * 0.5);
    } else {
      node.thickness += (target - node.thickness) * Math.min(1, dt * 0.08);
    }
    if (node.thickness > 0.62 && Math.abs(node.flow) > 0.05) {
      const cell = world.cells[idx(node.gx, node.gy)];
      if (cell) cell.occupancy = Math.min(1, cell.occupancy + 0.02 * dt);
    }
  }
}

/**
 * Universal decay. Anything cut off from the root starves; dead strands stop
 * being nodes and become the soil's problem — decomposable matter for whoever
 * gets there first.
 */
function decay(net: Network, world: World, dt: number): void {
  for (const node of net.nodes) {
    if (!node.alive) continue;
    if (!node.connected) {
      node.health -= dt * 0.055 * (1 + (1 - node.thickness));
      if (node.health <= 0) killNode(net, world, node, 0);
      continue;
    }
    // Upkeep. Nodes in poor soil with no supply bleed out slowly.
    const drain = ECON.upkeepPerNode * dt * (0.5 + node.thickness * 1.6);
    node.carbon = Math.max(0, node.carbon - drain);
    // A node with nothing left starts to die. This is what makes an
    // unprofitable network — one that grew into barren soil with no tree to
    // feed it — visibly recede rather than sitting there at zero.
    if (node.carbon <= 0.02) {
      node.health -= dt * 0.03;
      if (node.health <= 0) killNode(net, world, node, 0.5);
    } else {
      node.health = Math.min(1, node.health + dt * 0.015);
    }
    // Very old tips that never found anything are pruned back.
    if (node.isTip && node.age > 140 && Math.hypot(node.wx - node.gx, node.wy - node.gy) < 0.2) {
      killNode(net, world, node, 0.3);
    }
  }
}

/** Remove a node, converting its body into soil organic matter. */
function killNode(net: Network, world: World, node: HyphaNode, organicReturn: number): void {
  node.alive = false;
  if (node.isTip) net.tipCount = Math.max(0, net.tipCount - 1);
  const cell = world.cells[idx(node.gx, node.gy)];
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
    if (tip) tip.bondedTo = null;
  }
}

/**
 * The nearest living strand joined to the root within a patch, or null if the
 * network has been cut away from that ground entirely.
 */
function feederAt(net: Network, gx: number, gy: number, wantWater: number, wantNitrogen: number): HyphaNode | null {
  let best: HyphaNode | null = null;
  let bestDist = Infinity;
  let nearest: HyphaNode | null = null;
  let nearestDist = Infinity;
  for (const node of net.nodes) {
    if (!node.alive || !node.connected) continue;
    const d = Math.hypot(node.gx - gx, node.gy - gy);
    if (d > 2) continue;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = node;
    }
    // Prefer a strand in this patch that can actually pay for the day's growth.
    // Any strand will do when none can, so that a starving patch drains visibly
    // rather than the body simply refusing to notice it.
    if (node.water >= wantWater && node.nitrogen >= wantNitrogen && d < bestDist) {
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
  const feeder = feederAt(net, fruit.gx, fruit.gy, wantWater, wantNitrogen);
  const fed = Boolean(
    feeder && feeder.water >= wantWater && feeder.nitrogen >= wantNitrogen
  );
  if (fed && feeder) {
    feeder.water -= wantWater;
    feeder.nitrogen -= wantNitrogen;
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
  const kindSky = ctx.warmth > 0.3 && ctx.world.rainfall > 0.45;
  if (!kindSky) return;

  const step = ctx.dt / ECON.fruitSeconds;
  const spend = Math.min(fruit.store, ECON.fruitThreshold * step);
  setFruitStore(net, fruit.store - spend);

  if (fruit.store <= 0) {
    fruit.active = false;
    fruit.progress = 0;
    fruit.store = 0;
    net.fruited++;
    net.blooms.push({ gx: fruit.gx, gy: fruit.gy, at: ctx.time });
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
  for (const node of net.nodes) {
    if (!node.alive) continue;
    living++;
    if (!node.connected) continue;
    carbon += Math.max(0, node.carbon);
    water += Math.max(0, node.water);
    nitrogen += Math.max(0, node.nitrogen);
    // "Starving" means below working reserve, not merely nearly empty: the
    // point of the gate is that a network under-supplied anywhere is not
    // running a surplus worth banking.
    if (node.carbon < 0.7) starving++;
  }
  net.carbon = carbon;
  net.water = water;
  net.nitrogen = nitrogen;
  net.starving = starving;
  if (living === 0) net.extinct = true;
}

/** Transfer a founding kit out of connected stores, atomically and in node order. */
export function payColonyFund(net: Network, cost: { carbon: number; water: number; nitrogen: number }): boolean {
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

/** Send the growth frontier toward a point. Ordered tips break off first. */
export function orderWaypoint(net: Network, gx: number, gy: number, world?: World): void {
  if (!inBounds(gx, gy)) return;
  net.resting = false;
  net.waypoints.length = 0;
  net.waypoints.push({ gx, gy });
  if (net.waypoints.length > 6) net.waypoints.shift();
  if (world) {
    // Retarget now, not after each strand has finished its previous journey.
    for (const node of net.nodes) if (node.alive && node.isTip) chooseTarget(net, world, node, net.rng);
  }
}

/**
 * Attempt a symbiosis. The nearest tip within reach bonds to the root tip and
 * the tree starts trading. Costs carbon, and the tree expects to be supplied.
 */
export function tryBond(
  net: Network,
  world: World,
  treeId: number,
  rootTipId: number,
  reach = 3.5
): boolean {
  const tree = world.trees[treeId];
  const tip = tree?.rootTips[rootTipId];
  if (!tree || !tip || tip.bondedTo !== null || tree.dead) return false;

  let best: HyphaNode | null = null;
  let bestDist = Infinity;
  for (const node of net.nodes) {
    if (!node.alive || !node.connected || node.bondedTree >= 0) continue;
    const d = Math.hypot(node.wx - (tip.gx + 0.5), node.wy - (tip.gy + 0.5));
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  if (!best || bestDist > reach) return false;
  if (best.carbon < ECON.bondCharge) return false;

  best.carbon -= ECON.bondCharge;
  best.bondedTree = treeId;
  best.bondedRootTip = rootTipId;
  best.thickness = Math.max(best.thickness, 0.55);
  best.pulse = 1;
  tip.bondedTo = best.id;
  net.genetic += 1;
  return true;
}

/** Spend carbon to turn a strand into a cord: fast transport, higher upkeep. */
export function makeCord(net: Network, nodeId: number): boolean {
  const node = net.nodes[nodeId];
  if (!node || !node.alive) return false;
  if (node.reinforced) return false;
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
export function startFruiting(net: Network, world: World, gx: number, gy: number): HyphaNode | null {
  if (gy < 0 || gy > 12) return null;
  if (net.fruit.active) return null;
  if (net.surplus < ECON.fruitThreshold) return null;
  if (!isPassable(world, gx, gy)) return null;
  // Fruiting bodies erupt above ground, so they need a strand near the surface.
  let near: HyphaNode | null = null;
  let bestDist = Infinity;
  for (const node of net.nodes) {
    if (!node.alive || !node.connected) continue;
    const d = Math.hypot(node.gx - gx, node.gy - gy);
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
