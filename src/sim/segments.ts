/**
 * Segments: the network's economy runs on runs of strands, not on every strand.
 *
 * Most of a colony is long unbranched runs: a strand with one living child,
 * no tree bond, no tip. Such a run carries whatever passes through it and
 * holds a little of each resource, and nothing about it differs from one
 * strand to the next. So during a step the stores of a run are pooled on one
 * `Segment`, and transport, respiration and upkeep run once per segment
 * instead of once per strand. Everything else, the founder, forks, tips, tree
 * junctions and dead ends, is a *junction* and trades as its own node, exactly
 * as before.
 *
 * Strands stay the truth for shape, position, thickness and health: fire,
 * drought, flood and rival contact still act one cell at a time. Slow
 * per-strand bookkeeping (ageing, thickening, health, soil uptake) is tended in
 * slices, each strand every `TEND_SLICES` ticks with the time since it was last
 * tended, so its cost falls by that factor without changing the rates.
 *
 * Pools exist only inside `stepNetwork`: `poolStrands` gathers each run's
 * stores from its strands at the start and `spreadStrands` shares them evenly
 * back at the end. Outside a step every strand's own `carbon`, `water` and
 * `nitrogen` are the truth, so the rest of the game reads and writes them as it
 * always has. Code that runs *inside* a step and touches one strand's stores
 * uses `heldBy` and `drawHeld`.
 *
 * The run structure itself persists between steps and is rebuilt when the
 * graph changes shape (`markStrandsStale`) and every `TEND_SLICES` ticks, so
 * strands that settle behind the frontier fold into their runs.
 */
import type { HyphaNode, Network } from './network';

/** Each member strand is tended once every this many ticks. */
export const TEND_SLICES = 8;

export type PooledKey = 'carbon' | 'water' | 'nitrogen';

export interface Segment {
  /** Member node ids, from the end nearest the founder outward. */
  members: number[];
  /** Pooled stores; meaningful only while the economy is pooled. */
  /** Members still alive; a death marks the economy stale for a rebuild. */
  alive: number;
  carbon: number;
  water: number;
  nitrogen: number;
  /** Net carbon that moved through the run, decayed like a strand's `flow`. */
  flow: number;
  /**
   * Smoothed fullness of the run's narrowest pipe, 0..1. It persists between
   * steps; each strand's own `load` is this scaled to its own pipe, so a cord
   * in a busy run reads as running less full than the strands around it.
   */
  load: number;
  /** Narrowest member pipe, per second. */
  pipeRate: number;
  /** Sum over members of the upkeep weight `0.5 + thickness * 1.6`. */
  upkeepWeight: number;
  /** Members that are cords (reinforced). */
  reinforced: number;
}

export interface StrandEconomy {
  /** Segment index of each node id at build time, or -1 for a junction. */
  segOf: Int32Array;
  segments: Segment[];
  /** Junction node ids at build time. Nodes appended since are junctions too. */
  junctions: number[];
  /** `net.nodes.length` when this was built. */
  built: number;
  /**
   * Economy entities in root-first order. An entity `e >= 0` is the junction
   * node `e`; `e < 0` is segment `-e - 1`. Tips spawned after the build are
   * appended, which keeps every parent ahead of its children.
   */
  order: number[];
  /** Position in `order` of each position's parent, or -1 for the founder. */
  parentAt: number[];
  /** Positions in `order` of each position's children, in the strands' child order. */
  childrenAt: number[][];
  /** Position in `order` of each junction node id. */
  positionOf: Map<number, number>;
  /** Living strands per subcluster id (0 for the colony at large) at build time. */
  groupStrands: Map<number, number>;
  /** A strand died or the graph changed shape: rebuild before the next step. */
  stale: boolean;
  /** Ticks since the last build; a periodic rebuild folds new struts into runs. */
  ticks: number;
  /**
   * Ticks this network has stepped, carried across rebuilds: it picks the
   * slice of strands tended each tick, so every slice is reached even when
   * something forces a rebuild every tick.
   */
  tick: number;
  /** Strands that settled into a cell this step (committed or retired tips). */
  settled: number[];
  /** Inside a step: runs hold the stores, not their strands. */
  pooled: boolean;
  /** Throughput multiplier of a cord, as the build sized pipes with. */
  cordThroughput: number;
}

const economies = new WeakMap<object, StrandEconomy>();

/**
 * The economy lives beside the network rather than on it, so hashes, fixtures
 * and projected views never see it. A projected view (`ProjectedNetwork`) is a
 * proxy whose `nodes` getter is intercepted; its `source` is not, so both
 * resolve to the same economy through `sourceOf`.
 */
function sourceOf(net: Network): object {
  return (net as unknown as { __source?: Network }).__source ?? net;
}

export function economyOf(net: Network): StrandEconomy | undefined {
  return economies.get(sourceOf(net));
}

/** The segment a node is pooled in, or -1 if it keeps its own stores. */
export function segmentIndexOf(economy: StrandEconomy | undefined, id: number): number {
  if (!economy || id >= economy.built) return -1;
  return economy.segOf[id]!;
}

/** A run holding this strand's stores right now, or -1 when the strand holds its own. */
function poolIndexOf(economy: StrandEconomy | undefined, id: number): number {
  return economy?.pooled ? segmentIndexOf(economy, id) : -1;
}

/** What a strand holds: its own store, or inside a step its share of its run's pool. */
export function heldBy(net: Network, node: HyphaNode, key: PooledKey): number {
  const economy = economyOf(net);
  const s = poolIndexOf(economy, node.id);
  if (s < 0) return node[key];
  const segment = economy!.segments[s]!;
  return segment[key] / segment.members.length;
}

/** Add to (or, negative, take from) what a strand holds. */
export function drawHeld(net: Network, node: HyphaNode, key: PooledKey, amount: number): void {
  const economy = economyOf(net);
  const s = poolIndexOf(economy, node.id);
  if (s < 0) node[key] -= amount;
  else economy!.segments[s]![key] -= amount;
}

/**
 * Whether the economy built at the last step still describes the graph, so
 * its connectivity marks still hold: nothing has cut the network since.
 */
export function strandsCurrent(net: Network): boolean {
  const economy = economyOf(net);
  return Boolean(economy && !economy.stale);
}

/** The graph changed shape or a member died: rebuild before the next step. */
export function markStrandsStale(net: Network): void {
  const economy = economyOf(net);
  if (economy) economy.stale = true;
}

/** Gather each run's stores from its strands: the start of a step. */
export function poolStrands(net: Network, economy: StrandEconomy): void {
  const nodes = net.nodes;
  for (const segment of economy.segments) {
    let carbon = 0, water = 0, nitrogen = 0, flow = 0;
    for (const id of segment.members) {
      const node = nodes[id]!;
      carbon += node.carbon;
      water += node.water;
      nitrogen += node.nitrogen;
      flow += node.flow;
    }
    segment.carbon = carbon;
    segment.water = water;
    segment.nitrogen = nitrogen;
    segment.flow = flow;
  }
  economy.pooled = true;
}

/**
 * Share each run's stores evenly back onto its strands: the end of a step.
 * Everything that passes through a run passes through each of its strands, so
 * each carries an equal part of its flow too.
 */
export function spreadStrands(net: Network, economy: StrandEconomy): void {
  const nodes = net.nodes;
  for (const segment of economy.segments) {
    const k = segment.members.length;
    const carbon = segment.carbon / k;
    const water = segment.water / k;
    const nitrogen = segment.nitrogen / k;
    const flow = segment.flow / k;
    for (const id of segment.members) {
      const node = nodes[id]!;
      node.carbon = carbon;
      node.water = water;
      node.nitrogen = nitrogen;
      node.flow = flow;
      node.load = memberLoad(segment, node, economy.cordThroughput);
    }
  }
  economy.pooled = false;
}

/** How full one strand's own pipe runs, given how full its run's narrowest runs. */
export function memberLoad(segment: Segment, node: HyphaNode, cordThroughput: number): number {
  // A strand that has thinned since the run's narrowest pipe was measured
  // still runs at most full.
  return Math.min(1, segment.load * segment.pipeRate / pipeRate(node, cordThroughput));
}

/** Upkeep weight of one strand, as `decay` charges it. */
export function upkeepWeight(node: HyphaNode): number {
  return 0.5 + node.thickness * 1.6;
}

/** Pipe rate of one strand per second, as `transport` sizes it. */
export function pipeRate(node: HyphaNode, cordThroughput: number): number {
  return (1.2 + node.thickness * 9) * (node.reinforced ? cordThroughput : 1);
}

/**
 * Refresh each segment's thinnest pipe and upkeep weight from its members'
 * current thickness. Thickness moves slowly, so this runs once per build.
 */
export function refreshSegmentShape(net: Network, economy: StrandEconomy, cordThroughput: number): void {
  const nodes = net.nodes;
  for (const segment of economy.segments) {
    let pipe = Infinity;
    let weight = 0;
    let cords = 0;
    for (const id of segment.members) {
      const node = nodes[id]!;
      const rate = pipeRate(node, cordThroughput);
      if (rate < pipe) pipe = rate;
      weight += upkeepWeight(node);
      if (node.reinforced) cords++;
    }
    segment.pipeRate = pipe;
    segment.upkeepWeight = weight;
    segment.reinforced = cords;
  }
}

/** Whether a strand can be pooled into a run rather than stand as a junction. */
function isRunStrand(net: Network, node: HyphaNode): boolean {
  if (!node.alive || node.isTip || node.parent < 0 || node.id === net.rootId || node.bondedTree >= 0) return false;
  let living = 0;
  for (const childId of node.children) {
    if (net.nodes[childId]?.alive) living++;
    if (living > 1) return false;
  }
  return living === 1;
}

function onlyLivingChild(net: Network, node: HyphaNode): number {
  for (const childId of node.children) if (net.nodes[childId]?.alive) return childId;
  return -1;
}

/** Find the runs and the order they trade in. Stores stay on the strands until pooled. */
export function buildStrands(net: Network, cordThroughput: number): StrandEconomy {
  const tick = economyOf(net)?.tick ?? 0;
  const nodes = net.nodes;
  const count = nodes.length;
  const segOf = new Int32Array(count).fill(-1);
  const run = new Uint8Array(count);
  for (let id = 0; id < count; id++) if (isRunStrand(net, nodes[id]!)) run[id] = 1;

  const segments: Segment[] = [];
  const junctions: number[] = [];
  const groupStrands = new Map<number, number>();
  const groupIds = new Set((net.groups ?? []).map((g) => g.id));
  for (let id = 0; id < count; id++) {
    const node = nodes[id]!;
    if (node.alive) {
      const group = node.group && groupIds.has(node.group) ? node.group : 0;
      groupStrands.set(group, (groupStrands.get(group) ?? 0) + 1);
    }
    if (!run[id]) {
      if (node.alive) junctions.push(id);
      continue;
    }
    // Start a run only at its top: a run strand whose parent is not one.
    if (run[node.parent]) continue;
    const members: number[] = [];
    for (let at = id; at >= 0 && run[at]; at = onlyLivingChild(net, nodes[at]!)) {
      segOf[at] = segments.length;
      members.push(at);
      if (members.length > count) break;
    }
    segments.push({
      members, alive: members.length, carbon: 0, water: 0, nitrogen: 0, flow: 0, load: 0,
      pipeRate: 0, upkeepWeight: 0, reinforced: 0,
    });
  }

  const economy: StrandEconomy = {
    segOf, segments, junctions, built: count, order: [], parentAt: [], childrenAt: [], positionOf: new Map(),
    groupStrands, stale: false, ticks: 0, tick, settled: [], pooled: false, cordThroughput,
  };
  refreshSegmentShape(net, economy, cordThroughput);
  // A run is as full as its fullest strand, measured against the narrowest pipe.
  for (const segment of segments) {
    let load = 0;
    for (const id of segment.members) {
      const node = nodes[id]!;
      load = Math.max(load, (node.load ?? 0) * pipeRate(node, cordThroughput) / segment.pipeRate);
    }
    segment.load = Math.min(1, load);
  }

  // Root-first entity order over what the founder can reach, as
  // `traversalOrder` walked strands.
  const root = nodes[net.rootId];
  if (root?.alive) {
    const stack: Array<[number, number]> = [[net.rootId, -1]];
    while (stack.length > 0) {
      const [entity, parentAt] = stack.pop()!;
      const at = addEntity(economy, entity, parentAt);
      // The strand whose children continue the walk: a junction itself, or a run's last member.
      const tail = entity >= 0 ? nodes[entity]! : nodes[segments[-entity - 1]!.members.at(-1)!]!;
      const next: number[] = [];
      for (const childId of tail.children) {
        const child = nodes[childId];
        if (!child || !child.alive) continue;
        const s = segOf[childId]!;
        next.push(s >= 0 ? -s - 1 : childId);
      }
      for (let i = next.length - 1; i >= 0; i--) stack.push([next[i]!, at]);
    }
  }
  economies.set(sourceOf(net), economy);
  return economy;
}

/**
 * A tip grown from a junction after the build joins the order at the end,
 * behind its parent, so it trades from its first tick without a rebuild.
 */
export function joinStrand(net: Network, node: HyphaNode): void {
  const economy = economyOf(net);
  if (!economy) return;
  const parentSeg = segmentIndexOf(economy, node.parent);
  if (parentSeg >= 0) {
    // Grown out of the middle of a run: that run is no longer one.
    economy.stale = true;
    return;
  }
  const parentAt = economy.positionOf.get(node.parent);
  // A parent the founder cannot reach does not trade, and nor does its new tip.
  if (parentAt === undefined) return;
  addEntity(economy, node.id, parentAt);
}

function addEntity(economy: StrandEconomy, entity: number, parentAt: number): number {
  const at = economy.order.length;
  economy.order.push(entity);
  economy.parentAt.push(parentAt);
  economy.childrenAt.push([]);
  if (parentAt >= 0) economy.childrenAt[parentAt]!.push(at);
  if (entity >= 0) economy.positionOf.set(entity, at);
  return at;
}

/** Visit every living junction: those at build time, then any node added since. */
export function forEachJunction(net: Network, economy: StrandEconomy, visit: (node: HyphaNode) => void): void {
  const nodes = net.nodes;
  for (const id of economy.junctions) {
    const node = nodes[id]!;
    if (node.alive) visit(node);
  }
  for (let id = economy.built; id < nodes.length; id++) {
    const node = nodes[id]!;
    if (node.alive) visit(node);
  }
}

/**
 * Strands that moved this step and so need their regional position again:
 * every living tip, and every strand that settled into a cell.
 */
export function forEachMovedStrand(net: Network, visit: (node: HyphaNode) => void): boolean {
  const economy = economyOf(net);
  if (!economy) return false;
  const nodes = net.nodes;
  forEachJunction(net, economy, (node) => {
    if (node.isTip) visit(node);
  });
  for (const id of economy.settled) {
    const node = nodes[id];
    if (node?.alive && !node.isTip) visit(node);
  }
  return true;
}
