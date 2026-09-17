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
  gx: number;
  gy: number;
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
  /** Living connected nodes below their working carbon reserve. */
  starving: number;
  water: number;
  nitrogen: number;
  /** Carbon absorbed from rival or parasite biomass — the "tech" currency. */
  genetic: number;
  fruit: Fruiting;
  /** Completed fruitings — victory progress. */
  fruited: number;
  /** Spores released and settled beyond the network's own soil. */
  spores: number;
  /** Highest carbon surplus banked toward the next fruiting. */
  surplus: number;
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
  startingCarbon: number
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
    carbon: startingCarbon,
    water: 4,
    nitrogen: 2,
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
    water: 4,
    nitrogen: 2,
    genetic: 0,
    fruit: { active: false, progress: 0, gx, gy },
    fruited: 0,
    spores: 0,
    surplus: 0,
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

function spawnTip(
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
    carbon: 1.5,
    water: 0.4,
    nitrogen: 0.2,
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
  return Boolean(cell) && cell.stratum !== 'bedrock';
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
  extendTips(net, ctx);
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
    if (node.alive && node.bondedTree >= 0) bonded++;
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
  if (root) root.connected = true;
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

    // Nitrogen and phosphorus: mined from the cell and depleted over time.
    const uptake = Math.min(cell.nitrogen, 0.09 * dt * (0.6 + node.thickness));
    cell.nitrogen = Math.max(0, cell.nitrogen - uptake * 0.05);
    node.nitrogen = Math.min(ECON.nodeNitrogenCap, node.nitrogen + uptake);

    // Decomposition: hyphae metabolise the organic matter they are sitting in.
    // The rate scales with how rich the material is, so the litter layer is a
    // real income stream and barren clay is somewhere you pass through.
    if (cell.organic > 0.15) {
      const bite = Math.min(cell.organic, 0.02 * dt) * (0.35 + cell.organic);
      cell.organic -= bite * 0.05;
      // Held resources are capped: the excess is simply lost, which is what
      // forces the player to keep investing rather than banking.
      node.carbon = Math.min(ECON.nodeCarbonCap, node.carbon + bite * 3.2);
    }
  }

  // Symbiosis: bonded trees pay in sugar, and only while they are healthy.
  const world_trees = ctx.world.trees;
  for (const node of net.nodes) {
    if (!node.alive || node.bondedTree < 0) continue;
    const tree = world_trees[node.bondedTree];
    if (!tree || tree.dead) {
      node.bondedTree = -1;
      node.bondedRootTip = -1;
      continue;
    }
    const spec = (ctx.world.trees[node.bondedTree] as { species: string }).species;
    const rate = tree.health * ctx.light * (0.6 + tree.maturity * 0.6);
    node.carbon = Math.min(
      ECON.nodeCarbonCap * 1.6,
      node.carbon + rate * carbonPerSecond(spec) * dt
    );
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

  const carbonReserve = (node: HyphaNode): number =>
    (node.isTip ? 2.2 : 0.9) + (node.bondedTree >= 0 ? 1 : 0);

  // Carbon travels up from strands holding more than they need, and back down
  // to any node below its working reserve. A growing tip needs real fuel, so
  // the frontier is topped up rather than merely rescued; only what nobody
  // needs reaches the root, and only what the root cannot use becomes surplus.
  moveResource(nodes, order, 'carbon', carbonReserve, carbonReserve, dt);

  // Water and minerals: these are pulled to the junctions that need them, so
  // the highest fill level wins, and a bonded tree's junction is served first.
  const waterTarget = (node: HyphaNode): number =>
    node.bondedTree >= 0 ? ECON.nodeWaterCap : ECON.nodeWaterCap * 0.45;
  const nitrogenTarget = (node: HyphaNode): number =>
    node.bondedTree >= 0 ? ECON.nodeNitrogenCap : ECON.nodeNitrogenCap * 0.45;
  moveResource(nodes, order, 'water', waterTarget, () => ECON.nodeWaterCap * 0.85, dt);
  moveResource(nodes, order, 'nitrogen', nitrogenTarget, () => ECON.nodeNitrogenCap * 0.85, dt);
}

type ResourceKey = 'carbon' | 'water' | 'nitrogen';

/**
 * One resource, one sweep each way.
 *
 * Inward, anything a node holds above `surplusAbove` flows toward its parent;
 * outward, a parent brings any child below `fillTo` back up. Each edge has a
 * throughput ceiling set by its thickness, so a hair-fine strand is a
 * bottleneck and a cord is a highway — which is what makes the shape of the
 * network a real decision rather than decoration.
 */
function moveResource(
  nodes: HyphaNode[],
  order: number[],
  key: ResourceKey,
  surplusAbove: (node: HyphaNode) => number,
  fillTo: (node: HyphaNode) => number,
  dt: number
): void {
  const pipe = (node: HyphaNode): number => (1.2 + node.thickness * 9) * dt;
  const isCarbon = key === 'carbon';

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
      const keep = isCarbon
        ? surplusAbove(node) * (node.parent < 0 ? 3 : 0.35)
        : surplusAbove(node) * 0.6;
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
    const target = Math.min(1, 0.08 + traffic * 0.22 + node.age * 0.004);
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
 * Move what the root cannot hold into the fruiting surplus.
 *
 * Storage is deliberately small. Carbon above the surplus threshold is lost —
 * fungi invest, they do not hoard — so a player who stops making decisions
 * watches their economy evaporate rather than sitting on it.
 */
function bankSurplus(net: Network): void {
  const root = net.nodes[net.rootId];
  if (!root || !root.alive) return;
  // A network that cannot feed its own frontier is not running a surplus, it is
  // failing. Banking while any strand is starving would starve it faster.
  if (net.starving > 0) return;
  // The root keeps a working reserve before anything is banked, so a network
  // that is merely healthy does not starve its own branches to fill a surplus.
  const cap = ECON.nodeCarbonCap * 5;
  if (root.carbon <= cap) return;
  const excess = root.carbon - cap;
  root.carbon = cap;
  net.surplus = Math.min(ECON.fruitThreshold, net.surplus + excess);
  // Anything past the threshold is wasted outright.
}

/** Progress a fruiting body, and erupt when it completes. */
function progressFruiting(net: Network, ctx: StepContext): void {
  const fruit = net.fruit;
  if (!fruit.active) {
    bankSurplus(net);
    return;
  }

  // Drought and frost halt an eruption. The sky has a veto.
  const kindSky = ctx.warmth > 0.3 && ctx.world.rainfall > 0.45;
  if (kindSky) {
    fruit.progress = Math.min(1, fruit.progress + ctx.dt / ECON.fruitSeconds);
  }
  if (fruit.progress >= 1) {
    fruit.active = false;
    fruit.progress = 0;
    net.fruited++;
    net.spores += ECON.sporesPerFruit;
    net.genetic += 4;
    // Fruiting is expensive: it spends the surplus that paid for it.
    net.surplus = 0;
    const root = net.nodes[net.rootId];
    if (root) root.carbon *= 0.35;
  }
}

function updateTotals(net: Network): void {
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

// ---------------------------------------------------------------------------
// Player orders
// ---------------------------------------------------------------------------

/** Send the growth frontier toward a point. Ordered tips break off first. */
export function orderWaypoint(net: Network, gx: number, gy: number): void {
  if (!inBounds(gx, gy)) return;
  net.waypoints.push({ gx, gy });
  if (net.waypoints.length > 6) net.waypoints.shift();
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
  if (node.thickness >= 0.9) return false;
  if (node.carbon < ECON.cordCharge) return false;
  node.carbon -= ECON.cordCharge;
  node.thickness = Math.min(1, node.thickness + 0.35);
  node.pulse = 1;
  return true;
}

/** Begin a fruiting body at the given cell, if the network can pay for it. */
export function startFruiting(net: Network, world: World, gx: number, gy: number): boolean {
  if (net.fruit.active) return false;
  if (net.surplus < ECON.fruitThreshold * 0.98) return false;
  if (!isPassable(world, gx, gy)) return false;
  // Fruiting bodies erupt above ground, so they need a strand near the surface.
  let near = false;
  for (const node of net.nodes) {
    if (!node.alive || !node.connected) continue;
    if (Math.abs(node.gx - gx) <= 2 && Math.abs(node.gy - gy) <= 2) {
      near = true;
      break;
    }
  }
  if (!near) return false;
  net.fruit.active = true;
  net.fruit.progress = 0;
  net.fruit.gx = gx;
  net.fruit.gy = gy;
  return true;
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
