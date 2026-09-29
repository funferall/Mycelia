import { GRID } from './content';
import { STAND_SIZE, type Region } from './region';
import { burnNode, markConnectivity, payColonyFund, updateTotals, type Network } from './network';
import { ASH_FRUIT_SPEED, charRemains, treeHydration, type NetworkWorld, type Tree, type World } from './world';
import { hashString, mulberry32 } from './rng';
import { standFrameOf, treeSpatialPosition } from './spatial';
import type { CrossingMatch } from './crossing';
import type { StandState } from './match';

/**
 * Wildfire: the second region-scale ecological power (`TECH-06`).
 *
 * One straight fire front sweeps the region in the direction its kindler
 * chose. Everything is judged exactly once, at the moment the front reaches it,
 * from the fire's own seed: where anyone is looking never changes what burns.
 *
 * - Water is fire armour (wildfire v2, W1). Each tree meets the front with a
 *   fire intensity (dry ground, fuel from dead wood and litter, and weaker
 *   just past well-watered trees: a green belt is a firebreak) and its own
 *   hydration (mostly the water its mycorrhizal partners have been
 *   delivering). Species flammability sets the rest: hemlock torches, birch's
 *   paper bark catches, oak's thick bark resists. It is torched (dies as a
 *   charred snag, or falls as a charred log), scorched (a ground fire: it
 *   loses health but keeps its bonds), or spared. Stream banks and soaked
 *   soil remain refuges.
 * - Underground, heat only reaches the top of the soil. Shallow tips and thin
 *   strands die; thick or reinforced cords and every colony's root are singed
 *   and survive; anything deeper is untouched.
 * - Fruiting bodies above ground burn with the reserve committed to them.
 * - The burned topsoil turns to ash: organic matter is consumed and nitrogen
 *   released, and for the aftermath burned stands may fruit in any weather.
 *   That is the post-fire flush, and the reason to plan for the burn.
 *
 * The kindler's own colony is not spared. The power is a bet that you have
 * gone deeper than your rivals.
 */
export const FIRE = {
  warning: 45, burn: 70, aftermath: 120, cooldown: 150,
  /** Width of the flaming band behind the leading edge, region units. */
  band: 24,
  cost: { carbon: 90, water: 0, nitrogen: 8 },
  /** Strands shallower than this many centimetres can burn outright. */
  lethalCm: 6,
  /** Strands shallower than this are singed: health and half their carbon. */
  singeCm: 16,
  /** Soil at least this wet does not carry the fire (stream banks, soaked ground). */
  wetRefuge: 0.62,
  /** Soil this dry or drier gives the fire everything; between the two, odds scale. */
  dryBelow: 0.35,
  /** Soil rows the fire turns to ash as it passes. */
  ashRows: 5,
  /** Fruiting bodies on burned ground mature this much faster through the aftermath. */
  ashFruitSpeed: ASH_FRUIT_SPEED,
  /** How far behind the front well-watered trees still weaken it, region units. */
  breakReach: 20,
  /** A torched tree's chance never reaches certainty. */
  maxBurn: 0.97,
} as const;

/**
 * How readily each species' crown carries fire: hemlock's thin bark and low
 * branches torch, birch's paper bark catches, oak's thick bark resists.
 */
export const FLAMMABILITY: Record<string, number> = { hemlock: 1.25, birch: 1.1, oak: 0.7 };

/** One tree's odds when the front reaches it: the rule, without the roll. */
export interface TreeFireOdds {
  /** Chance the crown is torched and the tree dies. */
  burn: number;
  /** Chance, if not torched, that a ground fire scorches it. */
  scorch: number;
  intensity: number;
  hydration: number;
  /** True on stream banks and soaked soil: nothing happens there. */
  refuge: boolean;
}

/** 0 at or below dryBelow, 1 at the wet refuge: how much the soil's water resists the fire. */
function dampness(wet: number): number {
  return Math.max(0, Math.min(1, (wet - FIRE.dryBelow) / (FIRE.wetRefuge - FIRE.dryBelow)));
}

export type FirePhase = 'idle' | 'warning' | 'burning' | 'aftermath';

export interface FireState {
  phase: FirePhase;
  /** Regional radians the front travels toward; 0 = +x, pi/2 = +y. */
  direction: number;
  initiator: number | null;
  sequence: number;
  announcedAt: number;
  igniteAt: number;
  endsAt: number;
  clearAt: number;
  readyAt: number;
  /** Front position, as a projection on the direction, at ignition and at the end. */
  start: number;
  end: number;
}

export interface FireLosses {
  strands: number;
  singed: number;
  bodies: number;
}

export interface BurnedTree { at: number; stand: number; tree: number }

/** What the fire needs from the match; kept narrow so the dependency is plain. */
export interface FireHost {
  readonly time: number;
  readonly region: Region;
  readonly stands: StandState[];
  readonly spatialColonies: Map<number, CrossingMatch>;
}

/** A living network and the world its nodes live in; `local` when it is a stand's own transect graph. */
export interface RegionNetwork {
  net: Network;
  world: NetworkWorld;
  rival: boolean;
  local: StandState | null;
}
type Burnable = RegionNetwork;

/**
 * Every living network in the region, once each, in a stable order: spatial
 * colonies by origin stand, then each stand's own player and rival graphs.
 * Shared by the ecological powers, which all act on everything alive.
 */
export function regionNetworks(host: FireHost): RegionNetwork[] {
  const seen = new Set<Network>();
  const out: RegionNetwork[] = [];
  for (const spatial of [...host.spatialColonies.values()].sort((a, b) => a.originStandId - b.originStandId)) {
    for (const view of spatial.colonies) {
      if (seen.has(view.net) || view.net.extinct) continue;
      seen.add(view.net);
      out.push({ net: view.net, world: view.view, rival: false, local: null });
    }
  }
  for (const stand of host.stands) {
    if (stand.sim.hasColony && !seen.has(stand.sim.player) && !stand.sim.player.extinct) {
      seen.add(stand.sim.player);
      out.push({ net: stand.sim.player, world: stand.sim.world, rival: false, local: stand });
    }
    if (stand.rivalPresent && !seen.has(stand.sim.rival) && !stand.sim.rival.extinct) {
      seen.add(stand.sim.rival);
      out.push({ net: stand.sim.rival, world: stand.sim.world, rival: true, local: stand });
    }
  }
  return out;
}

export class Wildfire {
  readonly state: FireState = {
    phase: 'idle', direction: 0, initiator: null, sequence: 0,
    announcedAt: 0, igniteAt: 0, endsAt: 0, clearAt: 0, readyAt: 0, start: 0, end: 0,
  };
  readonly burnedTrees: BurnedTree[] = [];
  /** Living trees the front scorched but did not kill, and those it left untouched. */
  treesScorched = 0;
  treesSpared = 0;
  /** Recently crossed living trees, for the firebreak: projection and hydration. */
  private recentTrees: Array<{ p: number; hydration: number }> = [];
  readonly burnedStands = new Set<number>();
  readonly losses: Record<'player' | 'rival', FireLosses> = {
    player: { strands: 0, singed: 0, bodies: 0 },
    rival: { strands: 0, singed: 0, bodies: 0 },
  };
  /** Living trees the fire has killed, region-wide, across every fire. */
  livingTreesBurned = 0;
  private rng: () => number = () => 1;

  private readonly host: FireHost;
  private readonly seedText: string;
  private readonly broadcast: (text: string) => void;

  // Plain fields, not parameter properties: the headless tests strip types only.
  constructor(host: FireHost, seedText: string, broadcast: (text: string) => void) {
    this.host = host;
    this.seedText = seedText;
    this.broadcast = broadcast;
  }

  get phase(): FirePhase { return this.state.phase; }

  /** Seconds left in the current phase. */
  get remaining(): number {
    const s = this.state;
    const end = s.phase === 'warning' ? s.igniteAt : s.phase === 'burning' ? s.endsAt : s.phase === 'aftermath' ? s.clearAt : this.host.time;
    return Math.max(0, end - this.host.time);
  }

  /** Cooldown left once the aftermath has cleared. */
  get cooldown(): number {
    return this.state.phase === 'idle' ? Math.max(0, this.state.readyAt - this.host.time) : 0;
  }

  /** Where the leading edge is at time t, as a projection on the direction. */
  frontAt(t: number): number {
    const s = this.state;
    const k = Math.max(0, Math.min(1, (t - s.igniteAt) / FIRE.burn));
    return s.start + (s.end - s.start) * k;
  }

  /** 0..1: smoke on the horizon through the warning, full while burning, ash after. */
  get intensity(): number {
    const s = this.state;
    if (s.phase === 'warning') return 0.1 + 0.3 * (1 - this.remaining / FIRE.warning);
    if (s.phase === 'burning') return 1;
    if (s.phase === 'aftermath') return Math.max(0, 1 - (this.host.time - s.endsAt) / 20);
    return 0;
  }

  project(x: number, y: number, direction = this.state.direction): number {
    return x * Math.cos(direction) + y * Math.sin(direction);
  }

  /** Stands in burn order for a given direction: seconds after ignition the front reaches each centre. */
  schedule(direction: number): Array<{ stand: number; at: number }> {
    const [start, end] = this.extent(direction);
    return this.host.region.stands.map((site) => ({
      stand: site.id,
      at: ((this.project(site.centreX, site.centreY, direction) - start) / (end - start)) * FIRE.burn,
    }));
  }

  status(from: number, stormPhase: string): string {
    const s = this.state;
    if (s.phase !== 'idle') {
      const label = s.phase === 'warning' ? 'Fire kindling' : s.phase === 'burning' ? 'Fire running' : 'Ash settling';
      return `${label} · ${Math.ceil(this.remaining)}s`;
    }
    if (this.cooldown > 0) return `The land is still recovering · ${Math.ceil(this.cooldown)}s`;
    if (stormPhase === 'warning' || stormPhase === 'active') return 'Nothing will burn while the storm is overhead.';
    const stand = this.host.stands[from];
    if (!stand?.sim.hasColony) return 'Choose an established colony.';
    const net = stand.sim.player;
    if (net.extinct || !net.nodes[net.rootId]?.alive) return 'A living colony is needed.';
    if (!net.evolution.learned.includes('ember-crown')) return 'Learn Ember crown in the tech tree.';
    markConnectivity(net);
    for (const [key, cost] of Object.entries(FIRE.cost) as Array<['carbon' | 'water' | 'nitrogen', number]>) {
      if (net.nodes.reduce((v, n) => v + (n.alive && n.connected ? n[key] : 0), 0) < cost) {
        return `Bank ${FIRE.cost.carbon} carbon and ${FIRE.cost.nitrogen} nitrogen in connected strands.`;
      }
    }
    return 'Ready to kindle';
  }

  kindle(from: number, direction: number, stormPhase: string): string {
    if (!Number.isFinite(direction)) return 'Choose where the fire runs.';
    const status = this.status(from, stormPhase);
    if (status !== 'Ready to kindle') return status;
    const net = this.host.stands[from].sim.player;
    if (!payColonyFund(net, FIRE.cost)) return 'The connected reserve changed; bank the fire cost.';
    updateTotals(net);
    const t = this.host.time;
    const dir = ((direction % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const [start, end] = this.extent(dir);
    Object.assign(this.state, {
      phase: 'warning', direction: dir, initiator: from, sequence: this.state.sequence + 1,
      announcedAt: t, igniteAt: t + FIRE.warning, endsAt: t + FIRE.warning + FIRE.burn,
      clearAt: t + FIRE.warning + FIRE.burn + FIRE.aftermath,
      readyAt: t + FIRE.warning + FIRE.burn + FIRE.aftermath + FIRE.cooldown,
      start, end,
    } satisfies Partial<FireState>);
    this.burnedStands.clear();
    this.recentTrees = [];
    // The watch reports this fire's trees.
    this.livingTreesBurned = 0;
    this.treesScorched = 0;
    this.treesSpared = 0;
    this.broadcast(`Smoke on the horizon. A wildfire will run across the region in ${FIRE.warning} seconds. Water your partner trees, grow deep, reinforce cords, and hold wet ground.`);
    return 'Fire kindled';
  }

  /** The next phase change, for the match to split long steps at. */
  boundary(): number {
    const s = this.state;
    return s.phase === 'warning' ? s.igniteAt : s.phase === 'burning' ? s.endsAt : s.phase === 'aftermath' ? s.clearAt : Infinity;
  }

  advance(): void {
    const s = this.state;
    const t = this.host.time;
    if (s.phase === 'warning' && t >= s.igniteAt - 1e-8) {
      s.phase = 'burning';
      this.rng = mulberry32(hashString(`${this.seedText}:wildfire:${s.sequence}`));
      this.broadcast('The fire is running. Crowns, shallow strands and fruiting bodies in its path will burn.');
    }
    if (s.phase === 'burning' && t >= s.endsAt - 1e-8) {
      s.phase = 'aftermath';
      this.broadcast('The fire has passed. Ash feeds the burned ground: it will fruit in any weather while it lasts.');
    }
    if (s.phase === 'aftermath' && t >= s.clearAt - 1e-8) {
      s.phase = 'idle';
      this.burnedStands.clear();
    }
  }

  /** Burned stands may fruit in any weather through the aftermath. */
  ashFlush(standId: number): boolean {
    return this.state.phase === 'aftermath' && this.burnedStands.has(standId);
  }

  /** Judge everything the front reached between t0 and t1. */
  burn(t0: number, t1: number): void {
    if (this.state.phase !== 'burning') return;
    const a = this.frontAt(t0);
    const b = this.frontAt(t1);
    if (b <= a) return;
    const crossed = (x: number, y: number) => {
      const p = this.project(x, y);
      return p > a && p <= b;
    };
    const { region } = this.host;
    const reached: Array<{ stand: StandState; tree: Tree; p: number }> = [];
    for (const stand of this.host.stands) {
      const frame = standFrameOf(region, stand.site.id);
      if (!frame) continue;
      const world = stand.sim.world;
      const midY = frame.originY + STAND_SIZE / 2;
      // Topsoil along the stand's transect turns to ash.
      for (let gx = 0; gx < GRID.cols; gx++) {
        if (!crossed(frame.originX + gx, midY)) continue;
        this.burnedStands.add(stand.site.id);
        for (let gy = 0; gy < FIRE.ashRows; gy++) {
          const cell = world.cells[gy * GRID.cols + gx];
          if (!cell || cell.stream || cell.water >= FIRE.wetRefuge) continue;
          cell.organic *= 0.35;
          cell.nitrogen = Math.min(1, cell.nitrogen + 0.3 * (1 - gy / FIRE.ashRows));
        }
      }
      for (const tree of world.trees) {
        if (tree.burned) continue;
        const at = treeSpatialPosition(tree, region, frame);
        if (crossed(at.x, at.y)) reached.push({ stand, tree, p: this.project(at.x, at.y) });
      }
    }
    // Judged in the order the front meets them, so a green belt behind it
    // really does weaken what comes next. Ties break by stand and tree id.
    reached.sort((u, v) => (u.p - v.p) || (u.stand.site.id - v.stand.site.id) || (u.tree.id - v.tree.id));
    for (const { stand, tree, p } of reached) this.burnTree(stand, tree, this.reachedAt(p), p);
    for (const target of this.burnables()) {
      const { net, local } = target;
      const frame = local ? standFrameOf(region, local.site.id) : null;
      let changed = false;
      for (const node of net.nodes) {
        if (!node.alive) continue;
        const x = node.spatial ? node.spatial.x : frame ? frame.originX + node.gx : NaN;
        const y = node.spatial ? node.spatial.y : frame ? frame.originY + STAND_SIZE / 2 : NaN;
        if (!crossed(x, y)) continue;
        changed = this.burnNode(target, node) || changed;
      }
      if (changed) {
        markConnectivity(net);
        updateTotals(net);
        if (!net.nodes.some((n) => n.alive)) net.extinct = true;
      }
    }
  }

  /** When the leading edge reached projection p: exact, whatever the step size. */
  private reachedAt(p: number): number {
    const s = this.state;
    return s.igniteAt + ((p - s.start) / (s.end - s.start)) * FIRE.burn;
  }

  /**
   * One tree's odds when the front reaches it (no roll), from the fire's own
   * state: intensity (dry ground, dead wood and litter as fuel, weakened just
   * past well-watered trees), the tree's hydration and its species. Also the
   * basis of the warning's risk overlay.
   */
  treeOdds(world: World, tree: Tree, p = Number.NaN): TreeFireOdds {
    const cell = world.cells[6 * GRID.cols + tree.gx];
    const wet = cell ? Math.min(1, cell.water + cell.streamNear * 0.5) : 0;
    const refuge = wet >= FIRE.wetRefuge || (cell?.streamNear ?? 0) > 0.35;
    const hydration = treeHydration(world, tree);
    // Dry ground carries the fire: 0.55 when damp, 1.2 when parched.
    const dryness = 0.55 + 0.65 * (1 - dampness(wet));
    // Fuel: dead wood near the tree, and litter and organic matter in the topsoil.
    let dead = 0;
    for (const other of world.trees) {
      if (other !== tree && other.dead && Math.abs(other.gx - tree.gx) <= 12) dead++;
    }
    let organic = 0;
    for (let gy = 0; gy < FIRE.ashRows; gy++) organic += world.cells[gy * GRID.cols + tree.gx]?.organic ?? 0;
    const fuel = 0.8 + Math.min(0.45, dead * 0.15) + 0.3 * (organic / FIRE.ashRows);
    // A firebreak: the front just crossed well-watered trees.
    let firebreak = 1;
    if (Number.isFinite(p)) {
      const behind = this.recentTrees.filter((r) => r.p < p && r.p >= p - FIRE.breakReach);
      if (behind.length > 0) {
        const mean = behind.reduce((v, r) => v + r.hydration, 0) / behind.length;
        firebreak = 1 - 0.5 * mean * Math.min(1, behind.length / 3);
      }
    }
    const intensity = dryness * fuel * firebreak;
    const flammable = (FLAMMABILITY[tree.species] ?? 1) * (1.1 - 0.25 * tree.maturity) * (1 + 0.4 * (1 - tree.health));
    const burn = refuge ? 0 : Math.max(0, Math.min(FIRE.maxBurn, flammable * intensity * Math.pow(1 - hydration, 1.6)));
    const scorch = refuge ? 0 : Math.max(0, Math.min(0.9, 0.6 * intensity * (1 - 0.5 * hydration)));
    return { burn, scorch, intensity, hydration, refuge };
  }

  private burnTree(stand: StandState, tree: Tree, at: number, p: number): void {
    const world = stand.sim.world;
    const cell = world.cells[6 * GRID.cols + tree.gx];
    const wet = cell ? Math.min(1, cell.water + cell.streamNear * 0.5) : 0;
    const ash = world.cells[2 * GRID.cols + tree.gx];
    let remains: 'snag' | 'log' = tree.fallen ? 'log' : 'snag';
    if (tree.dead) {
      // Standing snags and fallen logs are fuel: they always go unless soaked.
      if (wet >= FIRE.wetRefuge) return;
    } else {
      const odds = this.treeOdds(world, tree, p);
      this.recentTrees.push({ p, hydration: odds.refuge ? 1 : odds.hydration });
      if (this.recentTrees.length > 64) this.recentTrees.shift();
      const roll = this.rng();
      if (roll >= odds.burn) {
        if (roll < odds.burn + (1 - odds.burn) * odds.scorch) {
          // A ground fire: scarred bark and lost health, but the tree lives
          // and keeps its bonds; a supplied partner recovers.
          tree.health = Math.max(0.05, tree.health - (0.15 + 0.25 * Math.min(1, odds.intensity)) * (1 - 0.5 * odds.hydration));
          tree.scorched = { at };
          this.treesScorched++;
        } else {
          this.treesSpared++;
        }
        return;
      }
      // Torched. A fierce fire through a dry tree brings it down.
      const fell = Math.max(0, Math.min(0.75, (odds.intensity - 0.8) * 1.5 * (1 - odds.hydration)));
      if (this.rng() < fell) {
        remains = 'log';
        tree.fallen = { direction: this.state.direction, at };
      }
    }
    const living = !tree.dead;
    tree.dead = true;
    tree.health = 0;
    tree.burned = { at, remains, biomass: tree.height * (0.5 + tree.maturity) };
    // What it holds for the soil, released as it decays (W2).
    charRemains(tree);
    for (const tip of tree.rootTips) {
      if (tip.bondedTo === null) continue;
      const id = tip.bondedColonyId ?? null;
      const net = id === null ? stand.sim.player : this.networks().find((n) => (n.colonyId ?? null) === id);
      const node = net?.nodes[tip.bondedTo];
      if (node) {
        node.bondedTree = -1;
        node.bondedRootTip = -1;
        node.pulse = 1;
      }
      tip.bondedTo = null;
      tip.bondedColonyId = null;
    }
    if (ash) {
      ash.organic = Math.min(1, ash.organic + 0.3);
      ash.nitrogen = Math.min(1, ash.nitrogen + 0.4);
    }
    this.burnedTrees.push({ at, stand: stand.site.id, tree: tree.id });
    if (living) this.livingTreesBurned++;
    this.burnedStands.add(stand.site.id);
  }

  /** Returns true when the node died. */
  private burnNode(target: Burnable, node: Network['nodes'][number]): boolean {
    const { net, world, rival } = target;
    const tally = this.losses[rival ? 'rival' : 'player'];
    const cell = world.cellOf(node);
    const wet = cell ? Math.min(1, cell.water + cell.streamNear * 0.5) : 0;
    const depthCm = node.gy * GRID.cmPerRow;
    const roll = this.rng();
    if (net.fruit.active && net.fruit.nodeId === node.id) {
      net.fruit.active = false;
      net.fruit.progress = 0;
      net.fruit.store = 0;
      tally.bodies++;
    }
    if (depthCm >= FIRE.singeCm || wet >= FIRE.wetRefuge) return false;
    const cord = node.reinforced || node.thickness >= 0.45 || node.id === net.rootId;
    if (depthCm < FIRE.lethalCm && !cord && roll >= dampness(wet) * 0.8) {
      burnNode(net, world, node);
      tally.strands++;
      return true;
    }
    node.health = Math.max(0.05, node.health - 0.55 * (1 - wet));
    node.carbon *= 0.5;
    node.pulse = 1;
    tally.singed++;
    return false;
  }

  private networks(): Network[] {
    return this.burnables().map((b) => b.net);
  }

  private burnables(): RegionNetwork[] {
    return regionNetworks(this.host);
  }

  /** Front positions that put the leading edge just outside the region at both ends. */
  private extent(direction: number): [number, number] {
    const w = this.host.region.cols * STAND_SIZE;
    const h = this.host.region.rows * STAND_SIZE;
    const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => this.project(x!, y!, direction));
    return [Math.min(...corners) - 2, Math.max(...corners) + FIRE.band];
  }
}
