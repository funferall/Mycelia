import { GRID, SPECIES } from './content';
import { markConnectivity, payColonyFund, updateTotals, witherNode, type Network } from './network';
import { updateMoisture, type Tree } from './world';
import { regionNetworks, type FireHost } from './wildfire';
import type { StandState } from './match';

/**
 * Drought: the third region-scale ecological power (`TECH-06`).
 *
 * The rain stops everywhere at once. There is no direction and no roll: the
 * damage is decided by water, so it is the same every time from the same state.
 *
 * - **Soil dries.** The region's rainfall falls to almost nothing, which drops
 *   the water table through the ordinary moisture model; an explicit drying
 *   pass also parches ground nobody is stepping. The stream keeps its banks
 *   damp, so land cracks away from water and stays soft beside it.
 * - **Trees decline unless fed.** A tree whose roots are at the stream holds.
 *   A tree bonded to a mycelium drinks from its junction and holds for as long
 *   as the network keeps that junction supplied. Every other tree loses health,
 *   faster on drier ground, and the weak die standing.
 * - **Shallow strands dry out.** Strands in parched topsoil lose their water;
 *   one left dry withers unless the network moves water to it. Deep strands in
 *   soil the water table still reaches, and strands on the banks, are safe.
 * - **Fruiting stops** for want of rain, for every colony.
 *
 * Counterplay is everything a mycorrhizal network is for: bank water, reach
 * down or to the stream, and keep your trees supplied. A decomposer that lives
 * in the dry topsoil and feeds no trees has no such answer.
 */
export const DROUGHT = {
  warning: 40, active: 90, recovery: 60, cooldown: 150,
  cost: { carbon: 70, water: 0, nitrogen: 6 },
  /** Seconds for the drought to reach full severity once it breaks. */
  onset: 25,
  /** Rainfall at full severity; a season's rain is roughly 0.3-1. */
  rainfall: 0.03,
  /** Topsoil rows the explicit drying pass reaches. */
  dryRows: 34,
  /** A cell drier than this is parched: strands in it lose their water. */
  parched: 0.15,
  /** Strands shallower than this can dry out. */
  shallowCm: 20,
  /** Drought is worked on this beat, like the soil volume, not every fixed step. */
  beat: 0.25,
  /** Stream proximity at which roots stand in water. */
  bank: 0.4,
} as const;

export type DroughtPhase = 'idle' | 'warning' | 'active' | 'recovery';

export interface DroughtState {
  phase: DroughtPhase;
  initiator: number | null;
  sequence: number;
  announcedAt: number;
  activeAt: number;
  endsAt: number;
  clearAt: number;
  readyAt: number;
}

export interface DroughtLosses {
  /** Strands that withered. */
  strands: number;
  /** Strand-seconds spent dry, a measure of stress short of death. */
  dryStrands: number;
}

export class Drought {
  readonly state: DroughtState = { phase: 'idle', initiator: null, sequence: 0, announcedAt: 0, activeAt: 0, endsAt: 0, clearAt: 0, readyAt: 0 };
  readonly parchedTrees: Array<{ at: number; stand: number; tree: number }> = [];
  /** Trees that drank from a mycelium during this drought, as `stand:tree`. */
  readonly fedTrees = new Set<string>();
  readonly losses: Record<'player' | 'rival', DroughtLosses> = {
    player: { strands: 0, dryStrands: 0 },
    rival: { strands: 0, dryStrands: 0 },
  };
  /** Water trees drew from mycelium junctions during this drought. */
  waterGiven = 0;
  private clock = 0;
  private readonly host: FireHost;
  private readonly broadcast: (text: string) => void;

  // Plain fields, not parameter properties: the headless tests strip types only.
  constructor(host: FireHost, broadcast: (text: string) => void) {
    this.host = host;
    this.broadcast = broadcast;
  }

  get phase(): DroughtPhase { return this.state.phase; }

  get remaining(): number {
    const s = this.state;
    const end = s.phase === 'warning' ? s.activeAt : s.phase === 'active' ? s.endsAt : s.phase === 'recovery' ? s.clearAt : this.host.time;
    return Math.max(0, end - this.host.time);
  }

  get cooldown(): number {
    return this.state.phase === 'idle' ? Math.max(0, this.state.readyAt - this.host.time) : 0;
  }

  /** 0..1: how hard the drought is biting now. Rises through onset, eases out in recovery. */
  get severity(): number {
    const s = this.state;
    const t = this.host.time;
    if (s.phase === 'active') return Math.min(1, 0.3 + 0.7 * (t - s.activeAt) / DROUGHT.onset);
    if (s.phase === 'recovery') return Math.max(0, 1 - (t - s.endsAt) / (DROUGHT.recovery * 0.6));
    return 0;
  }

  /** 0..1 for presentation: heat haze through the warning, then severity. */
  get intensity(): number {
    if (this.state.phase === 'warning') return 0.15 * (1 - this.remaining / DROUGHT.warning);
    return this.severity;
  }

  /** The region's rainfall under the drought, or null when it is not in force. */
  rainfall(seasonRain: number): number | null {
    const s = this.state;
    if (s.phase === 'active') return seasonRain + (DROUGHT.rainfall - seasonRain) * this.severity;
    if (s.phase === 'recovery') {
      // The drought breaks with relief rain, then weather returns to normal.
      const k = (this.host.time - s.endsAt) / DROUGHT.recovery;
      return k < 0.6 ? seasonRain + (DROUGHT.rainfall - seasonRain) * this.severity : Math.max(seasonRain, 0.9 * (1 - k) / 0.4);
    }
    return null;
  }

  status(from: number, stormPhase: string, firePhase: string): string {
    const s = this.state;
    if (s.phase !== 'idle') {
      const label = s.phase === 'warning' ? 'Heat building' : s.phase === 'active' ? 'Drought' : 'Rain returning';
      return `${label} · ${Math.ceil(this.remaining)}s`;
    }
    if (this.cooldown > 0) return `The land is still recovering · ${Math.ceil(this.cooldown)}s`;
    if (stormPhase === 'warning' || stormPhase === 'active') return 'No drought can hold under a storm.';
    if (firePhase === 'warning' || firePhase === 'burning') return 'A wildfire is running; wait for it to pass.';
    const stand = this.host.stands[from];
    if (!stand?.sim.hasColony) return 'Choose an established colony.';
    const net = stand.sim.player;
    if (net.extinct || !net.nodes[net.rootId]?.alive) return 'A living colony is needed.';
    if (!net.evolution.learned.includes('parch-crown')) return 'Learn Parch crown in the tech tree.';
    markConnectivity(net);
    for (const [key, cost] of Object.entries(DROUGHT.cost) as Array<['carbon' | 'water' | 'nitrogen', number]>) {
      if (net.nodes.reduce((v, n) => v + (n.alive && n.connected ? n[key] : 0), 0) < cost) {
        return `Bank ${DROUGHT.cost.carbon} carbon and ${DROUGHT.cost.nitrogen} nitrogen in connected strands.`;
      }
    }
    return 'Ready to call';
  }

  call(from: number, stormPhase: string, firePhase: string): string {
    const status = this.status(from, stormPhase, firePhase);
    if (status !== 'Ready to call') return status;
    const net = this.host.stands[from]!.sim.player;
    if (!payColonyFund(net, DROUGHT.cost)) return 'The connected reserve changed; bank the drought cost.';
    updateTotals(net);
    const t = this.host.time;
    Object.assign(this.state, {
      phase: 'warning', initiator: from, sequence: this.state.sequence + 1,
      announcedAt: t, activeAt: t + DROUGHT.warning, endsAt: t + DROUGHT.warning + DROUGHT.active,
      clearAt: t + DROUGHT.warning + DROUGHT.active + DROUGHT.recovery,
      readyAt: t + DROUGHT.warning + DROUGHT.active + DROUGHT.recovery + DROUGHT.cooldown,
    } satisfies Partial<DroughtState>);
    this.parchedTrees.length = 0;
    this.fedTrees.clear();
    this.waterGiven = 0;
    for (const side of ['player', 'rival'] as const) this.losses[side] = { strands: 0, dryStrands: 0 };
    this.broadcast(`Heat is building. In ${DROUGHT.warning} seconds the rain stops across the region. Bank water, reach deep or to the stream, and keep your trees supplied.`);
    return 'Drought called';
  }

  boundary(): number {
    const s = this.state;
    return s.phase === 'warning' ? s.activeAt : s.phase === 'active' ? s.endsAt : s.phase === 'recovery' ? s.clearAt : Infinity;
  }

  advance(): void {
    const s = this.state;
    const t = this.host.time;
    if (s.phase === 'warning' && t >= s.activeAt - 1e-8) {
      s.phase = 'active';
      this.broadcast('The rain has stopped. Ground away from the stream is drying; trees without a partner are failing.');
    }
    if (s.phase === 'active' && t >= s.endsAt - 1e-8) {
      s.phase = 'recovery';
      this.broadcast('The drought is breaking. Rain will return.');
    }
    if (s.phase === 'recovery' && t >= s.clearAt - 1e-8) s.phase = 'idle';
  }

  /** One step of drought. Deterministic: no rolls, only water. */
  step(stepDt: number): void {
    if (this.state.phase === 'idle' || this.state.phase === 'warning' || stepDt <= 0) { this.clock = 0; return; }
    this.clock += stepDt;
    if (this.clock < DROUGHT.beat - 1e-9) return;
    const dt = this.clock;
    this.clock = 0;
    this.rewet(dt);
    const severity = this.severity;
    if (severity <= 0) return;
    const networks = regionNetworks(this.host);
    const byColony = new Map(networks.filter((r) => r.net.colonyId).map((r) => [r.net.colonyId!, r.net]));
    for (const stand of this.host.stands) {
      this.drySoil(stand, severity, dt);
      for (const tree of stand.sim.world.trees) this.thirst(stand, tree, severity, dt, byColony);
    }
    for (const { net, world, rival } of networks) {
      const tally = this.losses[rival ? 'rival' : 'player'];
      let withered = false;
      for (const node of net.nodes) {
        if (!node.alive || node.gy * GRID.cmPerRow >= DROUGHT.shallowCm) continue;
        const cell = world.cellOf(node);
        if (!cell || cell.water >= DROUGHT.parched || cell.streamNear >= DROUGHT.bank) continue;
        node.water = Math.max(0, node.water - dt * 0.25 * severity);
        if (node.water > 0.01) continue;
        tally.dryStrands += dt;
        // The root holds on longest; it is the colony, not a strand.
        node.health -= dt * 0.03 * severity * (node.id === net.rootId ? 0.3 : 1);
        if (node.health <= 0 && node.id !== net.rootId) {
          witherNode(net, world, node);
          tally.strands++;
          withered = true;
        } else if (node.health <= 0) {
          node.health = 0.02;
        }
      }
      if (withered) {
        markConnectivity(net);
        updateTotals(net);
      }
    }
  }

  /**
   * As the relief rain comes, ground nobody is stepping recovers too: its
   * moisture relaxes toward the ordinary target under the returning rain.
   */
  private rewet(dt: number): void {
    if (this.state.phase !== 'recovery' || this.host.time - this.state.endsAt < DROUGHT.recovery * 0.6) return;
    for (const stand of this.host.stands) {
      if (stand.sim.hasColony || stand.rivalPresent) continue;
      updateMoisture(stand.sim.world, dt);
    }
  }

  /** Topsoil away from the stream loses water; the banks stay damp. */
  private drySoil(stand: StandState, severity: number, dt: number): void {
    const cells = stand.sim.world.cells;
    for (let gy = 0; gy < DROUGHT.dryRows; gy++) {
      // Shallow soil dries fastest; the drying fades toward the deeper rows.
      const depth = 1 - gy / DROUGHT.dryRows;
      for (let gx = 0; gx < GRID.cols; gx++) {
        const cell = cells[gy * GRID.cols + gx];
        if (!cell || cell.stream) continue;
        const shelter = Math.min(1, cell.streamNear / DROUGHT.bank);
        const next = Math.max(0.03, cell.water - dt * 0.014 * severity * depth * (1 - shelter));
        // Guarded: on shared soil a write materializes a voxel.
        if (next < cell.water) cell.water = next;
      }
    }
  }

  private thirst(stand: StandState, tree: Tree, severity: number, dt: number, byColony: Map<string, Network>): void {
    if (tree.dead) return;
    const cells = stand.sim.world.cells;
    const root = cells[8 * GRID.cols + tree.gx];
    if (!root || root.streamNear >= DROUGHT.bank) return;
    const junction = this.junctionOf(stand, tree, byColony);
    if (junction && junction.water > 0.05) {
      // Fed: the mycelium carries water the soil no longer has.
      const draw = Math.min(junction.water, dt * 0.5 * severity);
      junction.water -= draw;
      this.waterGiven += draw;
      this.fedTrees.add(`${stand.site.id}:${tree.id}`);
      tree.health = Math.min(1, tree.health + dt * 0.003 * severity);
      return;
    }
    const dryness = 1 - Math.min(1, root.water / 0.5);
    // Deep roots reach water the topsoil has lost: oak tolerates drought,
    // birch less, shallow-rooted hemlock least.
    const reach = Math.min(1, SPECIES[tree.species].rootDepthCm / 100);
    // Each tree's own seed and age spread the outcome, so a drought thins a
    // stand rather than killing every tree of a species at the same moment.
    const constitution = 0.6 + 0.8 * (((tree.seed >>> 0) % 1000) / 1000);
    const youth = 1.25 - 0.5 * tree.maturity;
    tree.health -= dt * 0.013 * severity * (0.3 + dryness) * (1.25 - reach) * constitution * youth;
    if (tree.health <= 0.06) {
      tree.health = 0;
      tree.dead = true;
      tree.parched = { at: this.host.time };
      this.parchedTrees.push({ at: this.host.time, stand: stand.site.id, tree: tree.id });
      stand.sim.events.unshift({ at: this.host.time, text: 'A tree died of thirst. It stands dead and leafless.' });
    }
  }

  private junctionOf(stand: StandState, tree: Tree, byColony: Map<string, Network>) {
    for (const tip of tree.rootTips) {
      if (tip.bondedTo === null) continue;
      const id = tip.bondedColonyId ?? null;
      const target = id === null
        ? stand.sim.player
        : byColony.get(id) ?? (stand.sim.player.colonyId === id ? stand.sim.player : undefined);
      const node = target?.nodes[tip.bondedTo];
      if (node?.alive && node.connected) return node;
    }
    return null;
  }
}
