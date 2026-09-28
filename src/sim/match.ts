import { ECON, GRID, SEASONS } from './content';
import { STAND_SIZE, createRegion, downwindStands, type Region, type StandSite } from './region';
import { Simulation, type MatchOutcome } from './sim';
import { payColonyFund, markConnectivity, startFruiting, createNetwork, type Owner } from './network';
import { CrossingMatch, chooseCrossing, type CrossingCorridor, type CrossingDirection } from './crossing';
import { SoilVolume, seasonalWaterTableOffsetCm } from './soil-volume';
import { hashString, mulberry32 } from './rng';
import { bindStandToSharedSoil } from './shared-soil';
import { elevationAtDepthCm, standFrameOf } from './spatial';
import { Wildfire } from './wildfire';
import { Drought } from './drought';
import { Flood } from './flood';

/**
 * A match is a region, not a stand.
 *
 * Each stand keeps its ecology and legacy transect. When the player directs a
 * physical crossing, this match hands the existing player graph to one spatial
 * coordinator while local rivals and trees continue their fixed-step work.
 * Spores can still found separate daughter colonies on the wind.
 *
 * Two rules keep it honest:
 *
 * - **The camera is not part of the simulation.** `activeStandId` decides which
 *   stand the player is looking at for local orders; spatial orders name their
 *   section explicitly. It is never read while stepping, and held stands
 *   advance every tick, so no result depends on where anyone was looking.
 * - **Nothing is minted.** A colony that founds a daughter stand pays carbon,
 *   water and mineral out of its own body, and the daughter starts with exactly
 *   that. A spore that nobody can afford does not land.
 */

export interface StandState {
  rivalPresent: boolean;
  rivalReleased: number;
  readonly site: StandSite;
  /**
   * The stand's own simulation: its soil, its trees and its rival, generated
   * once from the stand site. Re-entering a stand shows everything that
   * happened in it while nobody was looking. Ground with no colony in it is not
   * *stepped*, which is what keeps nine stands affordable, but it still exists
   * and can be looked at.
   */
  sim: Simulation;
  /** Blooms already released as spores, so each one is credited once. */
  released: number;
  /** Every spore that has landed here, oldest first. */
  arrivals: Array<{ at: number; from: number; spores: number }>;
}

export interface Colonization {
  owner?: Owner;
  at: number;
  from: number;
  to: number;
  /** Wind strength that carried it: above 1 is a storm, which carries further. */
  wind: number;
  /** What the parent paid, in carbon, water and mineral. */
  cost: { carbon: number; water: number; nitrogen: number };
}

/** A physical arrival of the same body, distinct from a spore-founded colony. */
export interface GrowthCrossing {
  at: number;
  from: number;
  to: number;
}

/** How often spore release is considered, in seconds. */
const SPORE_BEAT = 1;
/** Wind at or above this is a storm, and spores ride it to a further stand. */
const STORM_STRENGTH = 1.1;

export const STORM = {
  warning: 60, duration: 45, recovery: 180, reach: 4.25, daughtersPerBloom: 3,
  cost: { carbon: 80, water: 12, nitrogen: 6 },
  /** Per second of active storm, for a mature, healthy tree; see `stepWindfalls`. */
  fallRate: 0.0012,
  /** No stand loses more than this many trees to one storm. */
  fallsPerStand: 2,
} as const;
/** A tree the storm threw down, and what its bonded junction lost with it. */
export interface Windfall {
  at: number;
  stand: number;
  tree: number;
  direction: number;
  severed: Array<{ colonyId: string | null; node: number; lost: { carbon: number; water: number; nitrogen: number } }>;
}
export interface StormState {
  phase: 'idle' | 'warning' | 'active' | 'recovery';
  direction: number;
  initiator: number | null;
  announcedAt: number;
  activeAt: number;
  endsAt: number;
  readyAt: number;
  sequence: number;
}
interface HeldRelease { from: number; owner: Owner; bloomIndex: number; }

export class RegionalMatch {
  readonly storm: StormState = { phase: 'idle', direction: 0, initiator: null, announcedAt: 0, activeAt: 0, endsAt: 0, readyAt: 0, sequence: 0 };
  readonly heldSpores: HeldRelease[] = [];
  readonly windfalls: Windfall[] = [];
  /** The second ecological power. See `wildfire.ts`. */
  readonly fire: Wildfire;
  /** The third ecological power. See `drought.ts`. */
  readonly drought: Drought;
  /** The storm's water half: the stream overflows. See `flood.ts`. */
  readonly flood: Flood;
  /** Seeded per storm, so a replay throws down the same trees. */
  private windRng: () => number = () => 1;
  regionalPlay = false;
  readonly region: Region;
  readonly stands: StandState[];
  readonly colonization: Colonization[] = [];
  readonly growthCrossings: GrowthCrossing[] = [];
  readonly soil: SoilVolume;
  /** A spore daughter has its own graph and stores, even when it shares soil. */
  readonly spatialColonies = new Map<number, CrossingMatch>();
  /** The promoted founding body, if the player has directed it through a seam. */
  spatial: CrossingMatch | null = null;
  /** Stand the player is looking at. Presentation only; see the class note. */
  activeStandId: number;
  private sporeClock = 0;
  private elapsed = 0;
  private seasonIndex = 0;
  private seasonClock = 0;
  private soilClock = 0;
  private readonly corridors = new Map<number, CrossingCorridor>();
  private readonly sharedStands = new Set<number>();
  private readonly seedText: string;

  constructor(seedText = 'raven-wood', foundingSimulation?: Simulation) {
    this.seedText = seedText;
    this.region = createRegion(seedText);
    this.soil = new SoilVolume(this.region, hashString(`${seedText}:soil`));
    this.stands = this.region.stands.map((site) => ({
      site,
      sim: new Simulation(`${seedText}:${site.id}`, site),
      released: 0,
      rivalReleased: 0,
      rivalPresent: false,
      arrivals: [],
    }));
    this.activeStandId = this.region.foundingStand;
    // The browser retains its established opening while the remaining stands
    // use the region's site conditions. Headless regional callers use all sites.
    if (foundingSimulation) this.require(this.activeStandId).sim = foundingSimulation;
    // Only the founding stand starts with a colony in it.
    for (const stand of this.stands) { stand.sim.hasColony = false; stand.sim.rivalEnabled = false; }
    this.require(this.activeStandId).sim.hasColony = true;
    this.require(this.activeStandId).rivalPresent = true;
    this.require(this.activeStandId).sim.rivalEnabled = true;
    this.require(this.activeStandId).sim.player.colonyId = `player@${seedText}:stand-${this.activeStandId}`;
    this.ensureSharedSoil(this.activeStandId);
    this.fire = new Wildfire(this, seedText, (text) => this.broadcast(text));
    this.drought = new Drought(this, (text) => this.broadcast(text));
    this.flood = new Flood(this, () => this.storm);
  }

  /** Call the drought from a colony. It has no direction: water decides. */
  callDrought(from: number): string {
    const result = this.drought.call(from, this.storm.phase, this.fire.phase);
    if (result === 'Drought called') this.continueGrowing();
    return result;
  }

  droughtStatus(from: number): string {
    return this.drought.status(from, this.storm.phase, this.fire.phase);
  }

  /** Kindle the wildfire from a colony, running toward `direction` (regional radians). */
  kindleFire(from: number, direction: number): string {
    const result = this.fire.kindle(from, direction, this.storm.phase);
    // Burning to the end, like the storm, belongs to regional play.
    if (result === 'Fire kindled') this.continueGrowing();
    return result;
  }

  fireStatus(from: number): string {
    return this.fire.status(from, this.storm.phase);
  }

  /** Bind a stand's flat display and local ecology to the canonical volume. */
  private ensureSharedSoil(id: number): CrossingCorridor {
    const known = this.corridors.get(id);
    if (known && this.sharedStands.has(id)) return known;
    // Every flat transect reads west-to-east, so its unchanged local column is
    // always regional x minus this stand's origin, regardless of which edge a
    // later spatial order chooses to cross.
    const preferred = id % this.region.cols === this.region.cols - 1 ? 'west' : 'east';
    let corridor: CrossingCorridor | null = known ?? null;
    if (!corridor) try {
      corridor = chooseCrossing(this.region, this.soil, id, preferred);
    } catch {
      // A local transect needs passable soil beneath its founder, not a whole
      // passable route into a neighbour. Search for that slice below.
    }
    if (!corridor?.alongIsX) {
      const frame = standFrameOf(this.region, id);
      if (!frame) throw new Error(`match: no stand ${id}`);
      const root = this.require(id).sim.player.nodes[this.require(id).sim.player.rootId];
      const x = frame.originX + root.gx + 0.5;
      const depthCm = (root.gy + 0.5) * GRID.cmPerRow;
      let fixed: number | null = null;
      for (let step = 0; step < STAND_SIZE / 2 && fixed === null; step++) {
        for (const candidate of [frame.originY + STAND_SIZE / 2 + step + 0.5,
          frame.originY + STAND_SIZE / 2 - step - 0.5]) {
          if (candidate <= frame.originY || candidate >= frame.originY + STAND_SIZE) continue;
          if (this.soil.passableAt(x, candidate, elevationAtDepthCm(this.region, x, candidate, depthCm))) {
            fixed = candidate;
            break;
          }
        }
      }
      if (fixed === null) throw new Error(`match: no passable east-west founding slice in stand ${id}`);
      const sign = preferred === 'east' ? 1 : -1;
      corridor = {
        originStandId: id,
        destinationStandId: id + sign,
        direction: preferred,
        alongIsX: true,
        sign,
        fixed,
        seam: frame.originX + (sign > 0 ? STAND_SIZE : 0),
        depthCm,
      };
    }
    this.corridors.set(id, corridor);
    if (!this.sharedStands.has(id)) {
      bindStandToSharedSoil(this.require(id).sim.world, this.region, id, corridor, this.soil);
      this.require(id).sim.syncRegionalPositions();
      this.sharedStands.add(id);
    }
    return corridor;
  }

  spatialForStand(id: number): CrossingMatch | null {
    const own = this.spatialColonies.get(id);
    if (own) return own;
    // A reached tile may also hold an older independent local colony. Do not
    // let the visiting graph replace that colony in the stand controls.
    if (id === this.region.foundingStand || this.stands[id]?.arrivals.length) return null;
    return [...this.spatialColonies.values()].find((colony) => colony.stand(id) !== null) ?? null;
  }

  private require(id: number): StandState {
    const stand = this.stands[id];
    if (!stand) throw new Error(`match: no stand ${id}`);
    return stand;
  }

  /** The stand the player is looking at. */
  get active(): StandState {
    return this.require(this.activeStandId);
  }

  /** The live simulation the interface and the renderer read. */
  get sim(): Simulation {
    return this.active.sim;
  }

  get time(): number {
    return this.elapsed;
  }

  get colonizedStands(): number {
    return this.stands.reduce((count, stand) => count + (stand.sim.hasColony ? 1 : 0), 0);
  }

  /** Blooms anywhere in the region: the lineage, not one colony, reproduces. */
  get fruited(): number {
    return this.stands.reduce((count, stand) => count + (stand.sim.hasColony && !this.spatialOnly(stand) ? stand.sim.player.fruited : 0), 0);
  }

  /** Spores carried off the sheet by every colony. */
  get spores(): number {
    return this.stands.reduce((count, stand) => count + (stand.sim.hasColony && !this.spatialOnly(stand) ? stand.sim.player.spores : 0), 0);
  }

  get outcome(): MatchOutcome {
    if (this.fruited >= 2 && !this.regionalPlay) return 'fruited';
    const colonies = this.stands.filter((stand) => stand.sim.hasColony);
    return colonies.length > 0 && colonies.every((stand) =>
      this.spatialOnly(stand) ||
      (this.spatialColonies.has(stand.site.id)
        ? this.spatialColonies.get(stand.site.id)!.colony.extinct
        : stand.sim.outcome === 'extinct')
    ) ? 'extinct' : 'playing';
  }

  private spatialOnly(stand: StandState): boolean {
    return stand.site.id !== this.region.foundingStand &&
      !this.spatialColonies.has(stand.site.id) && stand.arrivals.length === 0 &&
      [...this.spatialColonies.values()].some((colony) => colony.stand(stand.site.id) !== null);
  }

  /** Promote the selected stand's existing network into its own regional graph. */
  growAcross(direction?: CrossingDirection): { ok: boolean; message: string } {
    const origin = this.activeStandId;
    const sim = this.active.sim;
    if (this.spatialOnly(this.active)) {
      const body = this.spatialForStand(origin);
      if (!body) return { ok: false, message: 'No connected colony reaches this stand.' };
      this.spatial = body;
      return body.orderAcross();
    }
    if (!sim.hasColony || sim.outcome !== 'playing') {
      return { ok: false, message: 'A living local colony is needed to cross this stand edge.' };
    }
    const spatial = this.ensureSpatialColony(origin, direction);
    this.spatial = spatial;
    return spatial.orderAcross();
  }

  private ensureSpatialColony(origin: number, direction?: CrossingDirection): CrossingMatch {
    const existing = this.spatialColonies.get(origin);
    if (existing) return existing;
    const openingCorridor = this.ensureSharedSoil(origin);
    const corridor = direction
      ? chooseCrossing(this.region, this.soil, origin, direction)
      : openingCorridor;
    const spatial = new CrossingMatch({
        seedText: this.seedText,
        colonyId: `player@${this.seedText}:stand-${origin}`,
        region: this.region,
        soil: this.soil,
        corridor,
        regionalCoordinates: true,
        colony: this.require(origin).sim.player,
        worldForStand: (standId) => {
          this.ensureSharedSoil(standId);
          return this.require(standId).sim.world;
        },
        onActivate: (standId, fromStandId) => {
          this.require(standId).sim.hasColony = true;
          if (fromStandId !== null && standId !== origin) {
            this.growthCrossings.push({ at: this.time, from: fromStandId, to: standId });
          }
        },
        originStandId: origin,
        direction,
        initialTime: this.time,
        initialSeasonIndex: this.seasonIndex,
        initialSeasonClock: this.seasonClock,
    });
    this.spatialColonies.set(origin, spatial);
    return spatial;
  }

  /**
   * Move the player's attention to a stand. Ground with no colony in it can be
   * entered and looked at — its soil, its roots and its rival are all there —
   * but there is no network to give orders to until a spore lands.
   */
  selectStand(id: number): boolean {
    if (!this.stands[id]) return false;
    this.activeStandId = id;
    return true;
  }

  /** True when the stand in view holds a colony. */
  get activeColonized(): boolean {
    return this.active.sim.hasColony;
  }

  /** Advance the whole region by one fixed step. */
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Split long caller steps at event boundaries; no warning release can be
    // silently processed after the entire active window has elapsed.
    let remaining = dt;
    while (remaining > 1e-9) {
      this.advanceStorm();
      this.fire.advance();
      this.drought.advance();
      const storm = this.storm.phase === 'warning' ? this.storm.activeAt : this.storm.phase === 'active' ? this.storm.endsAt : this.storm.phase === 'recovery' ? this.storm.readyAt : Infinity;
      const boundary = Math.min(storm, this.fire.boundary(), this.drought.boundary());
      const step = Math.min(remaining, Math.max(1e-9, boundary - this.time));
      this.stepRegion(step);
      remaining -= step;
    }
  }

  private stepRegion(dt: number): void {
    // A match that has been won does not stop the region. A colony that has
    // fruited twice stops growing on its own, the way it always has, but its
    // daughters carry on and can send spores further still — until every colony
    // is gone, which is the only end this class enforces. What a *regional*
    // victory should be is still an open design question (MAP-10).
    if (this.outcome === 'extinct') return;
    // Every stand, every tick, in stand order. A stand's own season clock runs
    // from the same start and the same steps, so the region shares one weather
    // without any of them having to be told about the others.
    const season = SEASONS[this.seasonIndex % SEASONS.length];
    const window = this.storm.phase === 'warning' || this.storm.phase === 'active';
    // A drought withholds the rain (storm and drought never overlap).
    const droughtRain = window ? null : this.drought.rainfall(season.rain);
    const rainfall = window ? Math.max(season.rain, this.storm.phase === 'active' ? 2 : 1) : droughtRain ?? season.rain;
    this.soil.setEnvironment({
      rainfall,
      litterfall: season.litterfall,
      waterTableOffsetCm: seasonalWaterTableOffsetCm(rainfall),
    });
    this.soilClock += dt;
    if (this.soilClock >= 0.25) {
      this.soil.step(this.soilClock);
      this.soilClock = 0;
    }
    for (const stand of this.stands) {
      // Storm rain, drought, or the ash flush on ground the fire has just burned.
      stand.sim.regionalWeather = window
        ? { rainfall, fruiting: true }
        : droughtRain !== null ? { rainfall, fruiting: false }
          : this.fire.ashFlush(stand.site.id) ? { rainfall: season.rain, fruiting: true } : null;
      if (stand.sim.hasColony || stand.rivalPresent) {
        const managed = this.spatialColonies.has(stand.site.id) || this.spatialOnly(stand);
        stand.sim.step(dt, managed || !stand.sim.hasColony, this.sharedStands.has(stand.site.id));
        if (window && stand.rivalPresent) this.prepareRival(stand, dt);
      }
    }
    for (const spatial of [...this.spatialColonies.values()].sort((a, b) => a.originStandId - b.originStandId)) {
      spatial.step(dt, false, window ? rainfall : undefined);
      const origin = this.require(spatial.originStandId).sim;
      origin.outcome = spatial.colony.fruited >= origin.fruitGoal && !this.regionalPlay
        ? 'fruited'
        : spatial.colony.extinct ? 'extinct' : 'playing';
    }
    this.elapsed += dt;
    this.seasonClock += dt;
    while (this.seasonClock >= SEASONS[this.seasonIndex % SEASONS.length].seconds) {
      this.seasonClock -= SEASONS[this.seasonIndex % SEASONS.length].seconds;
      this.seasonIndex++;
    }
    // Weather belongs to the region, including ground awaiting a spore and
    // colonies whose local outcome has stopped growth. No dormant soil is run.
    for (const stand of this.stands) {
      stand.sim.seasonIndex = this.seasonIndex;
      stand.sim.seasonClock = this.seasonClock;
      stand.sim.world.rainfall = window || droughtRain !== null ? rainfall : stand.sim.season.rain;
    }
    if (this.storm.phase === 'active') this.stepWindfalls(dt);
    this.fire.burn(this.elapsed - dt, this.elapsed);
    this.drought.step(dt);
    this.flood.step(dt);
    this.stepSpores(dt);
    this.advanceStorm();
    this.fire.advance();
    this.drought.advance();
  }

  /**
   * The storm throws trees down. Old, tall and weakened trees go first; every
   * stand is rolled in order from the storm's own seed, so where anyone is
   * looking never changes which trees fall.
   *
   * A felled tree is dead and falls downwind. Its root plate tears out of the
   * soil: every bond it held is severed, and the junction that held it loses
   * what it had stored and is left damaged (mendable, not killed).
   */
  private stepWindfalls(dt: number): void {
    for (const stand of this.stands) {
      let fallen = this.windfalls.filter(w => w.stand === stand.site.id && w.at >= this.storm.activeAt - 1e-8).length;
      for (const tree of stand.sim.world.trees) {
        if (tree.dead || tree.maturity < 0.5) continue;
        const chance = STORM.fallRate * dt * (0.4 + tree.maturity) * (1.4 - 0.6 * tree.health);
        const roll = this.windRng();
        const lean = this.windRng();
        if (fallen >= STORM.fallsPerStand || roll >= chance) continue;
        this.fellTree(stand, tree, this.storm.direction + (lean - 0.5) * 0.7);
        fallen++;
      }
    }
  }

  private fellTree(stand: StandState, tree: StandState['sim']['world']['trees'][number], direction: number): void {
    tree.dead = true;
    tree.health = 0;
    tree.fallen = { direction, at: this.time };
    const world = stand.sim.world;
    const cell = world.cells[Math.min(GRID.rows - 1, Math.floor(GRID.rows * 0.1)) * GRID.cols + tree.gx];
    if (cell) {
      cell.organic = Math.min(1, cell.organic + 0.5);
      cell.nitrogen = Math.min(1, cell.nitrogen + 0.3);
    }
    const networks = [
      ...this.stands.map(s => s.sim.player),
      ...[...this.spatialColonies.values()].flatMap(spatial => spatial.colonies.map(view => view.net)),
    ];
    const severed: Windfall['severed'] = [];
    for (const tip of tree.rootTips) {
      if (tip.bondedTo === null) continue;
      const id = tip.bondedColonyId ?? null;
      const net = id === null ? stand.sim.player : networks.find(n => (n.colonyId ?? null) === id);
      const node = net?.nodes[tip.bondedTo];
      if (node) {
        const lost = { carbon: node.carbon, water: node.water, nitrogen: node.nitrogen };
        node.carbon = node.water = node.nitrogen = 0;
        node.bondedTree = -1;
        node.bondedRootTip = -1;
        node.health = Math.min(node.health, 0.35);
        node.pulse = 1;
        severed.push({ colonyId: id, node: node.id, lost });
      }
      tip.bondedTo = null;
      tip.bondedColonyId = null;
    }
    this.windfalls.push({ at: this.time, stand: stand.site.id, tree: tree.id, direction, severed });
    const text = severed.length
      ? 'The storm threw down a bonded tree. Its root plate tore out the junction and everything stored there.'
      : 'The storm threw down a tree.';
    stand.sim.events.unshift({ at: this.time, text });
  }

  /**
   * Release spores from colonies that have fruited, and let the wind carry them
   * to a neighbouring stand. Adjacent stands are always in reach; only a storm
   * carries a spore past them.
   */
  private stepSpores(dt: number): void {
    this.sporeClock += dt;
    if (this.sporeClock < SPORE_BEAT) return;
    this.sporeClock = 0;

    for (const stand of this.stands) {
      for (const owner of ['player', 'rival'] as const) {
        if (owner === 'player' ? !stand.sim.hasColony || this.spatialOnly(stand) : !stand.rivalPresent) continue;
        const key = owner === 'player' ? 'released' : 'rivalReleased';
        while (stand[key] < stand.sim[owner].fruited) {
          const bloomIndex = stand[key]++;
          if (this.storm.phase === 'warning') this.heldSpores.push({ from: stand.site.id, owner, bloomIndex });
          else this.release(stand, owner, bloomIndex);
        }
      }
    }
  }

  private release(from: StandState, owner: Owner = 'player', bloomIndex = 0): void {
    const parent = from.sim[owner];
    markConnectivity(parent);
    if (parent.extinct || !parent.nodes[parent.rootId]?.alive) return;
    const bloom = parent.blooms[bloomIndex];
    // A held body needs a surviving supplied strand at release. No resurrection,
    // refund, or replay if the site has been severed during the countdown.
    if (this.storm.phase === 'active' && bloom && !parent.nodes.some(n => n.alive && n.connected && n.water >= ECON.fruitWaterDraw && n.nitrogen >= ECON.fruitNitrogenDraw && (bloom.spatial && n.spatial ? Math.hypot(n.spatial.x-bloom.spatial.x,n.spatial.y-bloom.spatial.y,n.spatial.z-bloom.spatial.z) : Math.hypot(n.gx-bloom.gx,n.gy-bloom.gy)) <= 3)) return;
    const wind = this.wind;
    let budget = this.storm.phase === 'active' ? STORM.daughtersPerBloom : 1;
    for (const targetId of this.sporeTargets(from.site.id, wind.direction, this.storm.phase === 'active', owner)) {
      const target = this.require(targetId);
      // A rejected landing cannot spend a kit. Bind/validate the real soil
      // before transferring resources; preview viability is only a forecast.
      try { this.ensureSharedSoil(targetId); } catch { continue; }
      const cost = ECON.colonyFund;
      // A colony pays for its daughter out of what it is holding. A parent that
      // cannot afford the journey does not send anyone, and the spore is only
      // ever a score.
      if (!payColonyFund(parent, cost)) return;
      if (owner === 'player') this.found(target, from, cost, wind.strength);
      else this.foundRival(target, from, cost, wind.strength);
      if (--budget <= 0) return;
    }
  }

  private found(target: StandState, from: StandState, cost: { carbon: number; water: number; nitrogen: number }, wind: number): void {
    // The stand's own ground is left exactly as it is: the colony arrives in
    // the soil that was already under it.
    this.ensureSharedSoil(target.site.id);
    target.sim.foundColony(cost);
    target.sim.regionalContinuation = this.regionalPlay;
    target.sim.player.colonyId = `player@${this.seedText}:stand-${target.site.id}`;
    this.ensureSpatialColony(target.site.id);
    target.sim.time = this.time;
    target.released = 0;
    const at = this.time;
    target.arrivals.push({ at, from: from.site.id, spores: cost.carbon });
    this.colonization.push({ at, from: from.site.id, to: target.site.id, wind, cost: { ...cost } });
    target.sim.events.unshift({
      at,
      text: `A spore from the ${from.site.community.replace(/-/g, ' ')} founds a colony in the ${target.site.community.replace(/-/g, ' ')}.`,
    });
  }

  get wind() {
    return this.storm.phase === 'active' ? { direction: this.storm.direction, strength: 2.6 } : this.region.windAt(this.time);
  }

  get stormRemaining(): number {
    const end = this.storm.phase === 'warning' ? this.storm.activeAt : this.storm.phase === 'active' ? this.storm.endsAt : this.storm.phase === 'recovery' ? this.storm.readyAt : this.time;
    return Math.max(0, end - this.time);
  }

  get stormIntensity(): number {
    if (this.storm.phase === 'active') return 1;
    if (this.storm.phase === 'warning') return .12 + .28 * (1 - this.stormRemaining / STORM.warning);
    if (this.storm.phase === 'recovery') return Math.max(0, 1 - (this.time - this.storm.endsAt) / 12);
    return 0;
  }

  continueGrowing(): void {
    this.regionalPlay = true;
    for (const stand of this.stands) {
      stand.sim.regionalContinuation = true;
      if (stand.sim.outcome === 'fruited') stand.sim.outcome = 'playing';
    }
  }

  stormStatus(from: number): string {
    if (this.storm.phase !== 'idle') return `${this.storm.phase === 'warning' ? 'Storm approaching' : this.storm.phase === 'active' ? 'Storm active' : 'Recovering'} · ${Math.ceil(this.stormRemaining)}s`;
    if (this.fire.phase === 'warning' || this.fire.phase === 'burning') return 'A wildfire is running; the storm must wait for it to pass.';
    if (this.drought.phase === 'warning' || this.drought.phase === 'active') return 'A drought holds the region; no storm can form until it breaks.';
    const stand = this.stands[from];
    if (!stand?.sim.hasColony || this.spatialOnly(stand)) return 'Choose an established colony.';
    const net = stand.sim.player;
    if (net.extinct || !net.nodes[net.rootId]?.alive) return 'A living colony is needed.';
    if (!net.evolution.learned.includes('storm-crown')) return 'Learn Storm crown in the tech tree.';
    const bonds = new Set(net.nodes.filter(n => n.alive && n.connected && n.bondedTree >= 0).map(n => n.bondedTree));
    if (bonds.size < 2) return 'Keep two living root bonds.';
    if (Object.entries(STORM.cost).some(([key,cost]) => net.nodes.reduce((v,n) => v + (n.alive && n.connected ? n[key as 'carbon' | 'water' | 'nitrogen'] : 0),0) < cost)) return 'Bank 80 carbon, 12 water and 6 nitrogen in connected strands.';
    return 'Ready to summon';
  }

  summonStorm(from: number, direction: number): string {
    if (!Number.isFinite(direction)) return 'Choose a wind direction.';
    const net = this.stands[from]?.sim.player;
    if (net) markConnectivity(net);
    const status = this.stormStatus(from);
    if (status !== 'Ready to summon') return status;
    if (!payColonyFund(net!, STORM.cost)) return 'The connected reserve changed; bank the storm cost.';
    // Previous completed blooms belong to the old weather, never this warning.
    this.stepSpores(SPORE_BEAT);
    this.continueGrowing();
    Object.assign(this.storm, {
      phase: 'warning', direction: ((direction % (Math.PI*2)) + Math.PI*2) % (Math.PI*2),
      initiator: from, announcedAt: this.time, activeAt: this.time + STORM.warning,
      endsAt: this.time + STORM.warning + STORM.duration,
      readyAt: this.time + STORM.warning + STORM.duration + STORM.recovery,
      sequence: this.storm.sequence + 1,
    });
    this.flood.reset();
    this.broadcast('Storm announced. Raise fruiting bodies before the wind arrives in 60 seconds. Rivals share this wind. Its rain will flood the stream: move off low ground by the water.');
    return 'Storm announced';
  }

  /** Same deterministic destinations drive the preview and actual release. */
  sporeTargets(from: number, direction: number, storm = true, owner: Owner = 'player'): number[] {
    const wind = storm ? { direction, strength: 2.6 } : this.wind;
    const reach = storm ? STORM.reach : wind.strength >= STORM_STRENGTH ? 2.01 : 1.01;
    return downwindStands(this.region, from, wind, reach).filter(id => {
      const target = this.stands[id];
      if (owner === 'player' ? target.sim.hasColony : target.rivalPresent && !target.sim.rival.extinct) return false;
      const root = target.sim[owner].nodes[target.sim[owner].rootId];
      if (!root) return false;
      const corridor = this.corridors.get(id);
      if (corridor) {
        const p = target.sim.world.regionalSoil?.pointAt(root.gx,root.gy);
        return !!p && this.soil.passableAt(p.x,p.y,p.z);
      }
      const cell = target.sim.world.cells[root.gy * GRID.cols + root.gx];
      return !!cell && cell.stratum !== 'bedrock';
    });
  }

  private advanceStorm(): void {
    if (this.storm.phase === 'warning' && this.time >= this.storm.activeAt - 1e-8) {
      this.stepSpores(SPORE_BEAT);
      this.storm.phase = 'active';
      this.windRng = mulberry32(hashString(`${this.seedText}:windfall:${this.storm.sequence}`));
      for (const held of this.heldSpores.splice(0)) this.release(this.require(held.from),held.owner,held.bloomIndex);
      this.broadcast('The storm has arrived. Fresh spores ride the chosen wind across the region. The stream is rising.');
    }
    if (this.storm.phase === 'active' && this.time >= this.storm.endsAt - 1e-8) {
      this.stepSpores(SPORE_BEAT);
      this.storm.phase = 'recovery';
      this.broadcast('The storm is passing. Ordinary dispersal resumes.');
    }
    if (this.storm.phase === 'recovery' && this.time >= this.storm.readyAt - 1e-8) this.storm.phase = 'idle';
  }

  private broadcast(text: string): void {
    for (const stand of this.stands) stand.sim.events.unshift({at:this.time,text});
  }

  private prepareRival(stand: StandState, dt: number): void {
    const net = stand.sim.rival;
    if (net.extinct || net.fruit.active) return;
    markConnectivity(net);
    // Move real carbon into reproduction, leaving a founding kit in the body.
    const saved = Math.min(4 * dt, Math.max(0,ECON.fruitThreshold-net.surplus));
    if (saved > 0 && net.carbon > ECON.colonyFund.carbon + saved && payColonyFund(net,{carbon:saved,water:0,nitrogen:0})) net.surplus += saved;
    const node = net.nodes.find(n => n.alive && n.connected && n.gy <= 12 && n.water > ECON.fruitWaterDraw && n.nitrogen > ECON.fruitNitrogenDraw);
    if (node && net.surplus >= ECON.fruitThreshold) startFruiting(net,stand.sim.world,node.gx,node.gy);
  }

  private foundRival(target: StandState, from: StandState, cost: {carbon:number;water:number;nitrogen:number}, wind: number): void {
    const old = target.sim.rival.nodes[target.sim.rival.rootId];
    this.ensureSharedSoil(target.site.id);
    target.sim.rival = createNetwork('rival','Storm-born decomposer',old.gx,old.gy,mulberry32(hashString(`${this.seedText}:rival:${target.site.id}:${this.storm.sequence}`)),cost.carbon,{water:cost.water,nitrogen:cost.nitrogen});
    target.sim.rival.colonyId = `rival@${this.seedText}:stand-${target.site.id}`;
    target.rivalPresent = true;
    target.sim.rivalEnabled = true;
    target.sim.regionalContinuation = this.regionalPlay;
    target.sim.syncRegionalPositions(false);
    target.rivalReleased = 0;
    this.colonization.push({at:this.time,from:from.site.id,to:target.site.id,wind,cost:{...cost},owner:'rival'});
    this.broadcast(`Rival spores take hold in stand ${target.site.id + 1}.`);
  }
}
