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
 * A run's pool is the only live record of its stores. A strand's own `carbon`,
 * `water` and `nitrogen` are a copy for display, written with its share each
 * time it is tended, so at most `TEND_SLICES` ticks old; its `flow` and `load`
 * likewise. Anything that changes a strand's own fields directly (a test, a
 * debugging hand) is noticed at its next tending: the difference from what was
 * last written is taken into the pool, so nothing is lost. Code that needs a
 * strand's exact stores, or changes them, uses `heldBy` and `drawHeld`; code
 * that moves stores strand by strand in bulk (paying a founding kit, a bond's
 * charge, fusing two colonies) calls `releaseStrands` first, which writes every
 * strand's exact share and hands the stores back to the strands until the
 * next step.
 *
 * The run structure persists between steps and is maintained incrementally: a
 * tip that settles behind the frontier is folded into the run behind it at the
 * end of the step (`foldSettled`), new tips join the trading order as they
 * sprout, and dead or folded entries are compacted away now and then. A full
 * rebuild happens only after the graph changes shape some other way
 * (`markStrandsStale`: a strand dies inside a run or with strands beyond it, a
 * bond, a cord, a subcluster, a fusion) and every `REBUILD_TICKS` as a safety
 * net, so a long colony costs per tick roughly its junctions and runs, plus one
 * slice of its strands.
 */
import type { HyphaNode, Network } from './network';

/** Each member strand is tended at least once every this many ticks. */
export const TEND_SLICES = 8;
/**
 * A tick tends about this many run strands at most: a very large colony's
 * strands are tended less often, with the time since, so the cost of a tick
 * stays bounded however far the colony grows.
 */
export const TEND_PER_TICK = 1500;
/** Strands per tick never stretch one strand's turn beyond this many ticks. */
export const MAX_TEND_SLICES = 64;

/** How many ticks one turn of tending takes for this many run strands. */
export function tendSlices(strands: number): number {
  return Math.min(MAX_TEND_SLICES, Math.max(TEND_SLICES, Math.ceil(strands / TEND_PER_TICK)));
}
/** Ticks between safety-net rebuilds of the run structure. */
export const REBUILD_TICKS = 600;
/**
 * Ticks between safety-net passes marking what the founder reaches. A cut made
 * through the game's own functions marks the economy stale and is seen on the
 * next tick; code that edits links directly should call `markStrandsStale`.
 */
export const CONNECTIVITY_TICKS = 60;
/** An entry in `order` that no longer trades: a junction folded into a run, or a dead tip. */
export const FOLDED = -0x7fffffff;

export type PooledKey = 'carbon' | 'water' | 'nitrogen';

export interface Segment {
  /** Member node ids, from the end nearest the founder outward. */
  members: number[];
  /** Members still alive; a death marks the economy stale for a rebuild. */
  alive: number;
  /** Pooled stores; meaningful only while the economy is pooled. */
  carbon: number;
  water: number;
  nitrogen: number;
  /** Net carbon that moved through the run, decayed like a strand's `flow`. Persists between steps. */
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
  /** Segment index of each node id, or -1 for a junction. Ids past its end are junctions. */
  segOf: Int32Array;
  segments: Segment[];
  /** Junction node ids, living or recently dead; compacted now and then. */
  junctions: number[];
  /**
   * Economy entities in root-first order. An entity `e >= 0` is the junction
   * node `e`; `e < 0` is segment `-e - 1`; `FOLDED` is a junction since folded
   * into a run. Tips spawned after the build are appended, which keeps every
   * parent ahead of its children.
   */
  order: number[];
  /** Position in `order` of each position's parent, or -1 for the founder. */
  parentAt: number[];
  /** Positions in `order` of each position's children, in the strands' child order. */
  childrenAt: number[][];
  /** Position in `order` of each junction node id. */
  positionOf: Map<number, number>;
  /** Living strands per subcluster id (0 for the colony at large), counted over one turn of slices. */
  groupStrands: Map<number, number>;
  /** The count in progress for the turn of slices under way. */
  groupCounting: Map<number, number>;
  /** A strand died or the graph changed shape: rebuild before the next step. */
  stale: boolean;
  /** Ticks since the last build. */
  ticks: number;
  /** Order entries that no longer trade (dead tips, folded junctions), for compaction. */
  retired: number;
  /** Strands held in runs, for sizing the tending slices. */
  members: number;
  /**
   * Ticks this network has stepped, carried across rebuilds: it picks the
   * slice of strands tended each tick, so every slice is reached even when
   * something forces a rebuild every tick.
   */
  tick: number;
  /** Strands that settled into a cell this step (committed or retired tips). */
  settled: number[];
  /**
   * What was last written to each run strand's own fields (three per node id:
   * carbon, water, nitrogen), so a change made to them directly is noticed.
   */
  seen: Float64Array;
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
  if (!economy || id >= economy.segOf.length) return -1;
  return economy.segOf[id]!;
}

const KEY_OFFSET: Record<PooledKey, number> = { carbon: 0, water: 1, nitrogen: 2 };

/** What a strand holds: its own store, or its share of its run's pool. */
export function heldBy(net: Network, node: HyphaNode, key: PooledKey): number {
  const economy = economyOf(net);
  const s = segmentIndexOf(economy, node.id);
  if (s < 0) return node[key];
  const segment = economy!.segments[s]!;
  // A direct change to the strand's own field not yet taken in still counts.
  const pending = node[key] - economy!.seen[node.id * 3 + KEY_OFFSET[key]]!;
  return segment[key] / segment.members.length + pending;
}

/** Take from (or, negative, add to) what a strand holds. */
export function drawHeld(net: Network, node: HyphaNode, key: PooledKey, amount: number): void {
  const economy = economyOf(net);
  const s = segmentIndexOf(economy, node.id);
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

/**
 * Bring one run strand up to date: take in any direct change to its own fields
 * since they were last written, then write its share of the pool.
 */
export function syncMember(economy: StrandEconomy, segment: Segment, node: HyphaNode): void {
  const seen = economy.seen;
  const at = node.id * 3;
  segment.carbon += node.carbon - seen[at]!;
  segment.water += node.water - seen[at + 1]!;
  segment.nitrogen += node.nitrogen - seen[at + 2]!;
  const k = segment.members.length;
  seen[at] = node.carbon = segment.carbon / k;
  seen[at + 1] = node.water = segment.water / k;
  seen[at + 2] = node.nitrogen = segment.nitrogen / k;
}

/**
 * Write every strand's exact share and hand the stores back to the strands:
 * until the next step their own fields are the truth again. For code that moves
 * stores strand by strand, and before a rebuild.
 */
export function releaseStrands(net: Network): void {
  const key = sourceOf(net);
  const economy = economies.get(key);
  if (!economy) return;
  const nodes = (key as Network).nodes;
  const seen = economy.seen;
  for (const segment of economy.segments) {
    // Take in every direct change first, so each strand's share includes them.
    for (const id of segment.members) {
      const node = nodes[id]!;
      const at = id * 3;
      segment.carbon += node.carbon - seen[at]!;
      segment.water += node.water - seen[at + 1]!;
      segment.nitrogen += node.nitrogen - seen[at + 2]!;
    }
    const k = segment.members.length;
    for (const id of segment.members) {
      const node = nodes[id]!;
      node.carbon = segment.carbon / k;
      node.water = segment.water / k;
      node.nitrogen = segment.nitrogen / k;
      node.flow = segment.flow / k;
    }
  }
  economies.delete(key);
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
 * Refresh a run's thinnest pipe and upkeep weight from its members' current
 * thickness. Thickness moves slowly, so each run is refreshed once per turn of
 * slices (`refreshShapes`) and when it is built.
 */
export function refreshSegmentShape(net: Network, segment: Segment, cordThroughput: number): void {
  const nodes = net.nodes;
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

/** Refresh the shape of this tick's slice of runs. */
export function refreshShapes(net: Network, economy: StrandEconomy): void {
  const segments = economy.segments;
  for (let s = economy.tick % TEND_SLICES; s < segments.length; s += TEND_SLICES) {
    refreshSegmentShape(net, segments[s]!, economy.cordThroughput);
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
  const previous = economyOf(net);
  const tick = previous?.tick ?? 0;
  const nodes = net.nodes;
  const count = nodes.length;
  // A previous economy's pools go back to the strands first, exactly.
  releaseStrands(net);
  const segOf = new Int32Array(Math.max(1024, count * 2)).fill(-1);
  const seen = new Float64Array(segOf.length * 3);
  const run = new Uint8Array(count);
  for (let id = 0; id < count; id++) if (isRunStrand(net, nodes[id]!)) run[id] = 1;

  const segments: Segment[] = [];
  const junctions: number[] = [];
  for (let id = 0; id < count; id++) {
    const node = nodes[id]!;
    if (!run[id]) {
      if (node.alive) junctions.push(id);
      continue;
    }
    // Start a run only at its top: a run strand whose parent is not one.
    if (run[node.parent]) continue;
    const members: number[] = [];
    let carbon = 0, water = 0, nitrogen = 0, flow = 0;
    for (let at = id; at >= 0 && run[at]; at = onlyLivingChild(net, nodes[at]!)) {
      const member = nodes[at]!;
      segOf[at] = segments.length;
      members.push(at);
      seen[at * 3] = member.carbon;
      seen[at * 3 + 1] = member.water;
      seen[at * 3 + 2] = member.nitrogen;
      carbon += member.carbon;
      water += member.water;
      nitrogen += member.nitrogen;
      flow += member.flow;
      if (members.length > count) break;
    }
    segments.push({
      members, alive: members.length, carbon, water, nitrogen, flow, load: 0,
      pipeRate: 0, upkeepWeight: 0, reinforced: 0,
    });
  }

  const economy: StrandEconomy = {
    segOf, segments, junctions, order: [], parentAt: [], childrenAt: [], positionOf: new Map(),
    groupStrands: countGroups(net), groupCounting: new Map(),
    stale: false, ticks: 0, retired: 0, members: segments.reduce((v, s) => v + s.members.length, 0),
    tick, settled: [], seen, cordThroughput,
  };
  for (const segment of segments) {
    refreshSegmentShape(net, segment, cordThroughput);
    // A run is as full as its fullest strand, measured against the narrowest pipe.
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
    const entities: number[] = [net.rootId];
    const parents: number[] = [-1];
    while (entities.length > 0) {
      const entity = entities.pop()!;
      const at = addEntity(economy, entity, parents.pop()!);
      // The strand whose children continue the walk: a junction itself, or a run's last member.
      const tail = entity >= 0 ? nodes[entity]! : nodes[segments[-entity - 1]!.members.at(-1)!]!;
      const children = tail.children;
      for (let i = children.length - 1; i >= 0; i--) {
        const childId = children[i]!;
        const child = nodes[childId];
        if (!child || !child.alive) continue;
        const s = segOf[childId]!;
        entities.push(s >= 0 ? -s - 1 : childId);
        parents.push(at);
      }
    }
  }
  economies.set(sourceOf(net), economy);
  return economy;
}

/** Living strands per subcluster, the colony at large as 0. */
function countGroups(net: Network): Map<number, number> {
  const ids = new Set((net.groups ?? []).map((g) => g.id));
  const counts = new Map<number, number>();
  for (const node of net.nodes) {
    if (!node.alive) continue;
    const group = node.group && ids.has(node.group) ? node.group : 0;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return counts;
}

/**
 * Count one slice of strands toward the subcluster tally; the tally in use is
 * replaced each time a full turn of slices completes.
 */
export function countGroupSlice(net: Network, economy: StrandEconomy, node: HyphaNode): void {
  if (!node.alive) return;
  const group = node.group && net.groups?.some((g) => g.id === node.group) ? node.group : 0;
  economy.groupCounting.set(group, (economy.groupCounting.get(group) ?? 0) + 1);
}

/** A turn of slices is complete: its subcluster tally becomes the one in use. */
export function publishGroupCount(economy: StrandEconomy): void {
  economy.groupStrands = economy.groupCounting;
  economy.groupCounting = new Map();
}

/**
 * A tip grown from a junction joins the junctions and the trading order at the
 * end, behind its parent, so it trades from its first tick without a rebuild.
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
  economy.junctions.push(node.id);
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

/**
 * Fold strands that settled this step into the run behind them, so a colony
 * growing outward keeps one run per unbranched stretch without a rebuild. A
 * folded strand's own stores join its run's pool.
 */
export function foldSettled(net: Network, economy: StrandEconomy): void {
  const nodes = net.nodes;
  for (const id of economy.settled) {
    const node = nodes[id]!;
    if (!isRunStrand(net, node) || segmentIndexOf(economy, id) >= 0) continue;
    const at = economy.positionOf.get(id);
    // A strand the founder cannot reach waits for the next rebuild.
    if (at === undefined) continue;
    const parentSeg = segmentIndexOf(economy, node.parent);
    let segment: Segment;
    if (parentSeg >= 0) {
      // Behind it is a run ending at its parent: the run grows by one, and
      // this strand's children now trade with the run.
      segment = economy.segments[parentSeg]!;
      if (segment.members.at(-1) !== node.parent) continue;
      const runAt = economy.parentAt[at]!;
      const siblings = economy.childrenAt[runAt]!;
      siblings.splice(siblings.indexOf(at), 1);
      for (const child of economy.childrenAt[at]!) {
        economy.parentAt[child] = runAt;
        siblings.push(child);
      }
      economy.childrenAt[at] = [];
      economy.order[at] = FOLDED;
      economy.retired++;
      growSegOf(economy, id);
      economy.segOf[id] = parentSeg;
      segment.members.push(id);
      economy.members++;
      segment.alive++;
      segment.pipeRate = Math.min(segment.pipeRate, pipeRate(node, economy.cordThroughput));
      segment.upkeepWeight += upkeepWeight(node);
      if (node.reinforced) segment.reinforced++;
    } else {
      // Behind it is a junction: it starts a run of its own, in its own place in the order.
      segment = {
        members: [id], alive: 1, carbon: 0, water: 0, nitrogen: 0, flow: 0, load: node.load ?? 0,
        pipeRate: pipeRate(node, economy.cordThroughput), upkeepWeight: upkeepWeight(node), reinforced: node.reinforced ? 1 : 0,
      };
      growSegOf(economy, id);
      economy.segOf[id] = economy.segments.length;
      economy.order[at] = -economy.segments.length - 1;
      economy.segments.push(segment);
      economy.members++;
    }
    economy.positionOf.delete(id);
    economy.seen[id * 3] = node.carbon;
    economy.seen[id * 3 + 1] = node.water;
    economy.seen[id * 3 + 2] = node.nitrogen;
    segment.carbon += node.carbon;
    segment.water += node.water;
    segment.nitrogen += node.nitrogen;
    segment.flow += node.flow;
  }
}

function growSegOf(economy: StrandEconomy, id: number): void {
  if (id < economy.segOf.length) return;
  const grown = new Int32Array(Math.max(id + 1, economy.segOf.length * 2)).fill(-1);
  grown.set(economy.segOf);
  economy.segOf = grown;
  const seen = new Float64Array(grown.length * 3);
  seen.set(economy.seen);
  economy.seen = seen;
}

/**
 * Drop junctions that died or were folded, and trading entries that no longer
 * trade, once they make up a fair share of the lists. Only entries without
 * children are ever dropped: a death with strands beyond it forces a rebuild.
 */
export function compactStrands(net: Network, economy: StrandEconomy): void {
  const nodes = net.nodes;
  if (economy.junctions.length > 64 && economy.ticks % TEND_SLICES === 0) {
    economy.junctions = economy.junctions.filter((id) => nodes[id]!.alive && segmentIndexOf(economy, id) < 0);
  }
  const { order } = economy;
  if (economy.ticks % TEND_SLICES !== 0) return;
  for (let at = 0; at < order.length; at++) {
    const entity = order[at]!;
    if (entity >= 0 && !nodes[entity]!.alive && economy.childrenAt[at]!.length === 0) {
      order[at] = FOLDED;
      economy.positionOf.delete(entity);
      economy.retired++;
    }
  }
  if (economy.retired * 2 < order.length) return;
  const moved = new Int32Array(order.length).fill(-1);
  const keep: number[] = [];
  for (let at = 0; at < order.length; at++) if (order[at] !== FOLDED) { moved[at] = keep.length; keep.push(at); }
  const parentAt: number[] = [];
  const childrenAt: number[][] = [];
  const nextOrder: number[] = [];
  for (const at of keep) {
    nextOrder.push(order[at]!);
    const up = economy.parentAt[at]!;
    parentAt.push(up < 0 ? -1 : moved[up]!);
    childrenAt.push(economy.childrenAt[at]!.filter((c) => moved[c]! >= 0).map((c) => moved[c]!));
  }
  economy.order = nextOrder;
  economy.parentAt = parentAt;
  economy.childrenAt = childrenAt;
  economy.positionOf.clear();
  nextOrder.forEach((entity, at) => { if (entity >= 0) economy.positionOf.set(entity, at); });
  economy.retired = 0;
}

/** Visit every living junction, including tips sprouted while visiting. */
export function forEachJunction(net: Network, economy: StrandEconomy, visit: (node: HyphaNode) => void): void {
  const nodes = net.nodes;
  const junctions = economy.junctions;
  for (let i = 0; i < junctions.length; i++) {
    const id = junctions[i]!;
    const node = nodes[id]!;
    if (node.alive && segmentIndexOf(economy, id) < 0) visit(node);
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
