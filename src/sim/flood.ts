import { GRID } from './content';
import { STAND_SIZE, type Region } from './region';
import { markConnectivity, updateTotals, witherNode } from './network';
import type { Tree } from './world';
import { regionNetworks, type FireHost } from './wildfire';
import type { StandState, StormState } from './match';
import { standFrameOf } from './spatial';

/**
 * Flood: the water half of the summoned storm (`TECH-03`/`TECH-06`).
 *
 * The storm's rain swells the stream until it leaves its channel. The flood is
 * not a separate power: it rises through the active storm, peaks, and recedes
 * through the storm's recovery. It is decided by water alone, no rolls.
 *
 * - **The stream overflows.** In every stand the stream runs through, ground
 *   within the flood's reach of the channel is inundated. Stands with no
 *   stream are high ground and stay dry.
 * - **Saturated ground is impassable** to growth, and its soil is waterlogged.
 * - **Strands drown.** Thin strands near the surface are washed away outright;
 *   others in the waterlogged soil lose health until they drown. Reinforced or
 *   thick cords hold, and the root holds longest.
 * - **Trees suffer by species.** Waterlogged roots hurt oak most and hemlock
 *   less; birch, a wet-ground tree, barely notices. (The drought's mirror.)
 * - **Silt.** As the water recedes it leaves the flooded ground richer.
 *
 * Counterplay: hold high ground away from the stream, reinforce cords you
 * cannot move, and settle the silt afterwards.
 */
export const FLOOD = {
  /** Seconds of active storm to reach the peak. */
  rise: 30,
  /** Seconds of recovery for the water to drain away. */
  recede: 40,
  /** Columns beyond the channel's edge that the peak flood covers. */
  reach: 18,
  /** Soil this shallow is waterlogged under flood water; strands in it drown. */
  drownCm: 40,
  /** Thin strands this shallow are washed away outright. */
  washCm: 8,
  beat: 0.25,
} as const;

export interface FloodLosses { washed: number; drowned: number }

const TOLERANCE: Record<string, number> = { birch: 0.25, hemlock: 0.8, oak: 1.3 };

export class Flood {
  readonly drownedTrees: Array<{ at: number; stand: number; tree: number }> = [];
  readonly losses: Record<'player' | 'rival', FloodLosses> = {
    player: { washed: 0, drowned: 0 },
    rival: { washed: 0, drowned: 0 },
  };
  /** Columns that were under water at the flood's peak, by stand; silted on recession. */
  private readonly peak = new Map<number, Set<number>>();
  private wet = false;
  private clock = 0;
  private readonly host: FireHost;
  private readonly storm: () => StormState;

  // Plain fields, not parameter properties: the headless tests strip types only.
  constructor(host: FireHost, storm: () => StormState) {
    this.host = host;
    this.storm = storm;
  }

  /** 0..1 flood level: rises through the storm, drains through recovery. */
  get level(): number {
    const s = this.storm();
    const t = this.host.time;
    if (s.phase === 'active') return Math.min(1, (t - s.activeAt) / FLOOD.rise);
    if (s.phase === 'recovery') return Math.max(0, 1 - (t - s.endsAt) / FLOOD.recede);
    return 0;
  }

  /** Columns beyond the channel edge the water reaches now. */
  get reachColumns(): number {
    return FLOOD.reach * this.level;
  }

  /** How far a stand's column lies beyond the edge of its channel, or null with no stream. */
  static distance(site: StandState['site'], gx: number): number | null {
    if (!site.stream) return null;
    return Math.abs(gx + 0.5 - site.stream.centreGx) - site.stream.widthGx / 2;
  }

  /** Standing water over a column, in centimetres (0 when dry). */
  depthAt(site: StandState['site'], gx: number): number {
    const d = Flood.distance(site, gx);
    const reach = this.reachColumns;
    if (d === null || reach <= 0 || d >= reach) return 0;
    return 30 * this.level * (1 - Math.max(0, d) / reach);
  }

  /** Stands the flood is touching now, and how many columns of each. */
  get extent(): Array<{ stand: number; columns: number }> {
    return this.host.stands
      .map((stand) => ({ stand: stand.site.id, columns: this.columns(stand).length }))
      .filter((e) => e.columns > 0);
  }

  step(stepDt: number): void {
    const level = this.level;
    if (level <= 0) {
      if (this.wet) this.drain();
      this.clock = 0;
      return;
    }
    this.clock += stepDt;
    if (this.clock < FLOOD.beat - 1e-9) return;
    const dt = this.clock;
    this.clock = 0;
    this.wet = true;
    const drownRows = Math.ceil(FLOOD.drownCm / GRID.cmPerRow);
    const flooded = new Map<number, Set<number>>();
    for (const stand of this.host.stands) {
      const cols = new Set(this.columns(stand));
      flooded.set(stand.site.id, cols);
      if (level >= 0.95) this.peak.set(stand.site.id, new Set([...(this.peak.get(stand.site.id) ?? []), ...cols]));
      const cells = stand.sim.world.cells;
      for (let gx = 0; gx < GRID.cols; gx++) {
        const under = cols.has(gx);
        for (let gy = 0; gy < drownRows; gy++) {
          const cell = cells[gy * GRID.cols + gx];
          if (!cell || cell.stream) continue;
          cell.flooded = under;
          if (under) cell.water = 1;
        }
      }
      for (const tree of stand.sim.world.trees) if (cols.has(tree.gx)) this.waterlog(stand, tree, level, dt);
    }
    const region = this.host.region;
    for (const { net, world, rival, local } of regionNetworks(this.host)) {
      const tally = this.losses[rival ? 'rival' : 'player'];
      let lost = false;
      for (const node of net.nodes) {
        if (!node.alive) continue;
        const where = locate(region, node, local);
        if (!where || !flooded.get(where.stand)?.has(where.gx)) continue;
        const depthCm = node.gy * GRID.cmPerRow;
        if (depthCm >= FLOOD.drownCm) continue;
        const root = node.id === net.rootId;
        const cord = node.reinforced || node.thickness >= 0.45;
        if (!root && !cord && depthCm < FLOOD.washCm && level >= 0.5) {
          witherNode(net, world, node);
          tally.washed++;
          lost = true;
          continue;
        }
        if (cord) continue;
        node.health -= dt * 0.05 * level * (root ? 0.3 : 1);
        if (node.health > 0) continue;
        if (root) { node.health = 0.02; continue; }
        witherNode(net, world, node);
        tally.drowned++;
        lost = true;
      }
      if (lost) { markConnectivity(net); updateTotals(net); }
    }
  }

  private columns(stand: StandState): number[] {
    const reach = this.reachColumns;
    if (!stand.site.stream || reach <= 0) return [];
    const out: number[] = [];
    for (let gx = 0; gx < GRID.cols; gx++) {
      const d = Flood.distance(stand.site, gx)!;
      if (d > 0 && d < reach) out.push(gx);
    }
    return out;
  }

  private waterlog(stand: StandState, tree: Tree, level: number, dt: number): void {
    if (tree.dead) return;
    const constitution = 0.6 + 0.8 * (((tree.seed >>> 0) % 997) / 997);
    tree.health -= dt * 0.025 * level * (TOLERANCE[tree.species] ?? 1) * constitution;
    if (tree.health > 0.06) return;
    tree.health = 0;
    tree.dead = true;
    tree.drowned = { at: this.host.time };
    this.drownedTrees.push({ at: this.host.time, stand: stand.site.id, tree: tree.id });
    stand.sim.events.unshift({ at: this.host.time, text: 'Floodwater drowned a tree. Its roots could not breathe.' });
  }

  /** The water has gone: ground reopens, and the peak's reach is left silted. */
  private drain(): void {
    this.wet = false;
    for (const stand of this.host.stands) {
      const cells = stand.sim.world.cells;
      for (const cell of cells) cell.flooded = false;
      for (const gx of this.peak.get(stand.site.id) ?? []) {
        for (let gy = 0; gy < 4; gy++) {
          const cell = cells[gy * GRID.cols + gx];
          if (!cell || cell.stream) continue;
          cell.organic = Math.min(1, cell.organic + 0.2);
          cell.nitrogen = Math.min(1, cell.nitrogen + 0.25);
        }
      }
    }
    this.peak.clear();
  }

  /** Reset per-storm tallies when a new storm is announced. */
  reset(): void {
    this.drownedTrees.length = 0;
    for (const side of ['player', 'rival'] as const) this.losses[side] = { washed: 0, drowned: 0 };
  }
}

/** Which stand and transect column a node stands over. */
function locate(region: Region, node: { gx: number; spatial?: { x: number; y: number } }, local: StandState | null): { stand: number; gx: number } | null {
  if (local) return { stand: local.site.id, gx: node.gx };
  if (!node.spatial) return null;
  const sx = Math.floor(node.spatial.x / STAND_SIZE);
  const sy = Math.floor(node.spatial.y / STAND_SIZE);
  if (sx < 0 || sy < 0 || sx >= region.cols || sy >= region.rows) return null;
  const id = sy * region.cols + sx;
  const frame = standFrameOf(region, id);
  return frame ? { stand: id, gx: Math.floor(node.spatial.x - frame.originX) } : null;
}
