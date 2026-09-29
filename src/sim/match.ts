import { ECON, GRID, SEASONS } from './content';
import { STAND_SIZE, createRegion, downwindStands, type Region, type StandSite, type StartRule } from './region';
import { Simulation, type MatchOutcome } from './sim';
import { payColonyFund, markConnectivity, startFruiting, createNetwork, type Owner } from './network';
import { CrossingMatch, chooseCrossing, type CrossingCorridor, type CrossingDirection } from './crossing';
import { SoilVolume, seasonalWaterTableOffsetCm } from './soil-volume';
import { hashString, mulberry32 } from './rng';
import { bindStandToSharedSoil } from './shared-soil';
import { elevationAtDepthCm, standFrameOf, standIdAt } from './spatial';
import { FIRE, Wildfire } from './wildfire';
import { Drought } from './drought';
import { Flood } from './flood';
import { ContactWar } from './contact';

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
  /** The bloom whose unaffordable release was last announced, so it is said once. */
  sporeNotice?: number;
  /**
   * Set when this stand's own colony fused into another of the player's
   * colonies: the stand whose regional body now carries its strands.
   */
  fusedInto?: number;
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

/**
 * The regional victory (`CORE-05`, decided 28 September): hold this many
 * stands at once, then keep at least that many until the season turns. A
 * stand is held by whoever dominates it: strictly more bonded trees there.
 */
export const HOLD_TILES = 5;

/** Where each side stands against the regional victory. */
export interface RegionHold {
  /** Stands this side dominates right now. */
  tiles: number;
  /** Season index when the current hold began, or null when not holding. */
  since: number | null;
  /** Simulation time the current hold began. */
  sinceTime: number | null;
}

export type RegionalVictory = 'playing' | 'won' | 'lost';

/** Two of the player's colonies met and became one network. */
export interface Fusion {
  at: number;
  /** Origin stand of the surviving (older) colony. */
  into: number;
  /** Origin stand of the colony that joined it. */
  from: number;
  /** Stand where the strands touched. */
  stand: number;
  nodes: number;
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

/**
 * A mature fruiting body holds its spores until the player releases them or a
 * gust takes them (`MAP-10`). A gust is a short swell in a seeded wind signal:
 * at this threshold one comes about every 77 seconds on average and lasts a
 * few seconds, so waiting for the right wind is a real choice, not a stall.
 */
export const SPORE_GUST = 0.65;

/** What happened to one bloom's spores when the wind was offered them. */
export type SporeRelease = 'released' | 'unaffordable' | 'nowhere' | 'lost';

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
  /** Networks of different owners fight where they touch (contact-war plan). */
  readonly contact: ContactWar;
  /** Seeded per storm, so a replay throws down the same trees. */
  private windRng: () => number = () => 1;
  /**
   * Regional play is the game: there is no two-bloom win, and every colony
   * keeps growing and fruiting until the regional victory or extinction.
   */
  regionalPlay = true;
  readonly hold: { player: RegionHold; rival: RegionHold } = {
    player: { tiles: 0, since: null, sinceTime: null },
    rival: { tiles: 0, since: null, sinceTime: null },
  };
  victory: RegionalVictory = 'playing';
  private holdClock = 0;
  readonly region: Region;
  readonly stands: StandState[];
  readonly colonization: Colonization[] = [];
  readonly growthCrossings: GrowthCrossing[] = [];
  readonly fusions: Fusion[] = [];
  /**
   * Every cloud of spores that left a body, whether or not it took hold, for
   * drawing: `to` is the stand it founded, or null when the wind carried it
   * somewhere nothing of this owner could grow. Presentation-facing record.
   */
  readonly sporeReleases: Array<{ at: number; from: number; to: number | null; owner: Owner; direction: number }> = [];
  private fusionClock = 0;
  readonly soil: SoilVolume;
  /**
   * What each side has learned (`TECH-01`). Adaptations belong to the player,
   * not to one colony: every colony's `evolution.learned` is this same array,
   * so learning in one teaches all of them, including daughters founded later.
   * Ages, active powers and cooldowns stay per colony.
   */
  readonly lineage: { readonly player: string[]; readonly rival: string[] } = { player: [], rival: [] };
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

  constructor(seedText = 'raven-wood', foundingSimulation?: Simulation, options: { starts?: StartRule } = {}) {
    this.seedText = seedText;
    this.region = createRegion(seedText, undefined, undefined, options.starts ?? 'drawn');
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
    // The rival begins in a stand of its own, away from the player (`MAP-16`).
    const rivalHome = this.require(this.region.rivalStand);
    rivalHome.rivalPresent = true;
    rivalHome.sim.rivalEnabled = true;
    this.require(this.activeStandId).sim.player.colonyId = `player@${seedText}:stand-${this.activeStandId}`;
    this.ensureSharedSoil(this.activeStandId);
    if (rivalHome.site.id !== this.activeStandId) {
      this.ensureSharedSoil(rivalHome.site.id);
      rivalHome.sim.rival.colonyId = `rival@${seedText}:stand-${rivalHome.site.id}`;
      rivalHome.sim.syncRegionalPositions(false);
    }
    this.fire = new Wildfire(this, seedText, (text) => this.broadcast(text));
    this.drought = new Drought(this, (text) => this.broadcast(text));
    this.flood = new Flood(this, () => this.storm);
    this.contact = new ContactWar(this, seedText, (text) => this.broadcast(text));
    for (const stand of this.stands) {
      this.shareLineage(stand);
      // No stand stops at two blooms: the region decides the match.
      stand.sim.regionalContinuation = true;
    }
  }

  /**
   * Bonded trees per stand for each side. A bond belongs to the player unless
   * the root tip records a rival colony. The rival is a saprotroph and does
   * not bond trees today, so its count is zero until it gains a measure of
   * its own (an open question in the regional plan).
   */
  standDominance(): Array<{ standId: number; player: number; rival: number; holder: 'player' | 'rival' | null }> {
    return this.stands.map((stand) => {
      let player = 0;
      let rival = 0;
      for (const tree of stand.sim.world.trees) {
        if (tree.dead) continue;
        let mine = false;
        let theirs = false;
        for (const tip of tree.rootTips) {
          if (tip.bondedTo === null) continue;
          if (tip.bondedColonyId?.startsWith('rival')) theirs = true;
          else mine = true;
        }
        if (mine) player++;
        if (theirs) rival++;
      }
      const holder = player > rival ? 'player' : rival > player ? 'rival' : null;
      return { standId: stand.site.id, player, rival, holder };
    });
  }

  /** Track each side's hold on the region, once a second, and decide the match. */
  private stepVictory(dt: number): void {
    if (this.victory !== 'playing') return;
    this.holdClock += dt;
    if (this.holdClock < 1) return;
    this.holdClock = 0;
    const dominance = this.standDominance();
    for (const side of ['player', 'rival'] as const) {
      const hold = this.hold[side];
      hold.tiles = dominance.filter((entry) => entry.holder === side).length;
      if (hold.tiles >= HOLD_TILES) {
        if (hold.since === null) {
          hold.since = this.seasonIndex;
          hold.sinceTime = this.time;
          this.broadcast(side === 'player'
            ? `You hold ${hold.tiles} stands. Keep at least ${HOLD_TILES} until the season turns to take the region.`
            : `The rival holds ${hold.tiles} stands. Break its hold before the season turns.`);
        } else if (this.seasonIndex > hold.since) {
          this.victory = side === 'player' ? 'won' : 'lost';
          this.broadcast(side === 'player'
            ? `The region is yours: ${hold.tiles} stands held through the turn of the season.`
            : 'The rival held the region through the turn of the season.');
          return;
        }
      } else if (hold.since !== null) {
        hold.since = null;
        hold.sinceTime = null;
        this.broadcast(side === 'player'
          ? `Your hold on the region broke: ${hold.tiles} of ${HOLD_TILES} stands.`
          : `The rival's hold broke: ${hold.tiles} of ${HOLD_TILES} stands.`);
      }
    }
  }

  /** Short status line for the instrument: stands held and the hold's progress. */
  holdStatus(): string {
    const hold = this.hold.player;
    if (this.victory === 'won') return `Region taken: ${hold.tiles} stands held.`;
    if (this.victory === 'lost') return 'The rival took the region.';
    if (hold.since === null) return `Stands held ${hold.tiles} of ${HOLD_TILES}.`;
    const season = SEASONS[this.seasonIndex % SEASONS.length]!;
    const left = Math.max(0, Math.ceil(season.seconds - this.seasonClock));
    return `Holding ${hold.tiles} stands: keep ${HOLD_TILES} for ${left}s, until the season turns.`;
  }

  /**
   * Point a stand's colonies at the shared lineage. Anything a network had
   * already learned on its own joins the lineage first, so nothing is lost.
   */
  private shareLineage(stand: StandState): void {
    for (const owner of ['player', 'rival'] as const) {
      const shared = this.lineage[owner];
      const net = stand.sim[owner];
      if (net.evolution.learned === shared) continue;
      for (const id of net.evolution.learned) if (!shared.includes(id)) shared.push(id);
      net.evolution.learned = shared;
    }
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
    // No two-bloom win in a regional match: see `victory` and `stepVictory`.
    const colonies = this.stands.filter((stand) => stand.sim.hasColony);
    return colonies.length > 0 && colonies.every((stand) =>
      this.spatialOnly(stand) ||
      (this.spatialColonies.has(stand.site.id)
        ? this.spatialColonies.get(stand.site.id)!.colony.extinct
        : stand.sim.outcome === 'extinct')
    ) ? 'extinct' : 'playing';
  }

  private spatialOnly(stand: StandState): boolean {
    // A colony that fused into another is carried by that body now.
    if (stand.fusedInto !== undefined) return true;
    return stand.site.id !== this.region.foundingStand &&
      !this.spatialColonies.has(stand.site.id) && stand.arrivals.length === 0 &&
      [...this.spatialColonies.values()].some((colony) => colony.stand(stand.site.id) !== null);
  }

  /**
   * Where a stand's flat underground transect lies in the region: it always
   * reads west to east along the plane y = `fixedY`, and its local column c is
   * regional x = `originX` + c. Null before the stand has shared soil.
   */
  transectPlane(standId: number): { originX: number; fixedY: number } | null {
    const corridor = this.corridors.get(standId);
    const frame = standFrameOf(this.region, standId);
    if (!corridor || !frame || !corridor.alongIsX) return null;
    return { originX: frame.originX, fixedY: corridor.fixed };
  }

  /** Promote the selected stand's existing network into its own regional graph. */
  growAcross(direction?: CrossingDirection, group = 0): { ok: boolean; message: string } {
    const origin = this.activeStandId;
    const sim = this.active.sim;
    if (this.spatialOnly(this.active)) {
      const body = this.spatialForStand(origin);
      if (!body) return { ok: false, message: 'No connected colony reaches this stand.' };
      this.spatial = body;
      return body.orderAcross(group);
    }
    if (!sim.hasColony || sim.outcome !== 'playing') {
      return { ok: false, message: 'A living local colony is needed to cross this stand edge.' };
    }
    const spatial = this.ensureSpatialColony(origin, direction);
    this.spatial = spatial;
    return spatial.orderAcross(group);
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
    // Burned ground fruits in any weather, and faster, for every colony.
    spatial.ashFlush = (standId) => this.fire.ashFlush(standId);
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
          : this.fire.ashFlush(stand.site.id) ? { rainfall: season.rain, fruiting: true, fruitSpeed: FIRE.ashFruitSpeed } : null;
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
    this.contact.step(dt);
    this.stepSpores(dt);
    this.stepFusion(dt);
    this.stepVictory(dt);
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
  private stepSpores(dt: number, force = false): void {
    this.sporeClock += dt;
    if (this.sporeClock < SPORE_BEAT) return;
    this.sporeClock = 0;
    // Mature bodies wait on the wind. A storm's own path (its warning hold and
    // its arrival) still takes everything, exactly as before.
    const gust = force || this.storm.phase === 'warning' || this.gusting();

    for (const stand of this.stands) {
      for (const owner of ['player', 'rival'] as const) {
        if (owner === 'player' ? !stand.sim.hasColony || this.spatialOnly(stand) : !stand.rivalPresent) continue;
        if (!gust) continue;
        const key = owner === 'player' ? 'released' : 'rivalReleased';
        while (stand[key] < stand.sim[owner].fruited) {
          const bloomIndex = stand[key];
          if (this.storm.phase === 'warning') {
            stand[key]++;
            this.heldSpores.push({ from: stand.site.id, owner, bloomIndex });
            continue;
          }
          const outcome = this.release(stand, owner, bloomIndex);
          // A gust cannot lift spores the colony cannot pay to send: they stay
          // on the stalk for a richer moment. A forced release (the storm's own
          // flush) spends them as it always has.
          if (outcome === 'unaffordable' && !force) {
            if (owner === 'player' && stand.sporeNotice !== bloomIndex) {
              stand.sporeNotice = bloomIndex;
              stand.sim.events.unshift({ at: this.time, text: `A gust passed, but the colony is too poor to send spores: ${this.sporeCostText()}` });
            }
            break;
          }
          stand[key]++;
          if (owner === 'player' && outcome === 'released') {
            stand.sim.events.unshift({ at: this.time, text: 'A gust lifted the spores off the fruiting body.' });
          }
        }
      }
    }
  }

  /**
   * Fuse any two of the player's colonies whose living strands touch
   * (26-neighbour voxels in the shared soil). Checked once a second, in
   * stable stand order; the older colony survives and the younger joins it.
   */
  private stepFusion(dt: number): void {
    this.fusionClock += dt;
    if (this.fusionClock < 1) return;
    this.fusionClock = 0;
    const bodies = this.playerBodies();
    if (bodies.length < 2) return;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const older = bodies[i]!;
        const younger = bodies[j]!;
        const contact = this.contactBetween(older.positions, younger.positions, younger.standId);
        if (!contact) continue;
        this.fuse(older, younger, contact.a, contact.b, contact.stand);
        return; // One fusion per check: the body list has changed.
      }
    }
  }

  /**
   * The player's living colonies, oldest first: the founding colony, then
   * daughters in the order their spores landed. A colony that has not been
   * given its regional body yet is included by its recorded positions.
   */
  private playerBodies(): Array<{ standId: number; positions: Array<{ id: number; position: { x: number; y: number; z: number } }> }> {
    const order = (standId: number) => {
      if (standId === this.region.foundingStand) return -1;
      return this.require(standId).arrivals[0]?.at ?? Infinity;
    };
    const out: Array<{ standId: number; positions: Array<{ id: number; position: { x: number; y: number; z: number } }> }> = [];
    for (const stand of this.stands) {
      if (!stand.sim.hasColony || stand.fusedInto !== undefined) continue;
      const body = this.spatialColonies.get(stand.site.id);
      if (body) {
        if (body.colony.extinct) continue;
        out.push({ standId: stand.site.id, positions: body.livingPositions() });
      } else if (!this.spatialOnly(stand) && !stand.sim.player.extinct) {
        const positions: Array<{ id: number; position: { x: number; y: number; z: number } }> = [];
        for (const node of stand.sim.player.nodes) if (node.alive && node.spatial) positions.push({ id: node.id, position: node.spatial });
        out.push({ standId: stand.site.id, positions });
      }
    }
    out.sort((p, q) => (order(p.standId) - order(q.standId)) || (p.standId - q.standId));
    return out;
  }

  /** The first pair of living nodes in neighbouring voxels, scanning in id order. */
  private contactBetween(
    a: Array<{ id: number; position: { x: number; y: number; z: number } }>,
    b: Array<{ id: number; position: { x: number; y: number; z: number } }>,
    younger: number
  ): { a: number; b: number; stand: number } | null {
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const voxels = new Map<string, number>();
    for (const entry of a) {
      const k = key(Math.floor(entry.position.x), Math.floor(entry.position.y), Math.floor(entry.position.z));
      if (!voxels.has(k)) voxels.set(k, entry.id);
    }
    for (const entry of b) {
      const x = Math.floor(entry.position.x), y = Math.floor(entry.position.y), z = Math.floor(entry.position.z);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const hit = voxels.get(key(x + dx, y + dy, z + dz));
        if (hit === undefined) continue;
        return { a: hit, b: entry.id, stand: standIdAt(this.region, entry.position.x, entry.position.y) ?? younger };
      }
    }
    return null;
  }

  private fuse(
    older: { standId: number },
    younger: { standId: number },
    mine: number,
    theirs: number,
    stand: number
  ): void {
    const into = this.ensureSpatialColony(older.standId);
    const from = this.ensureSpatialColony(younger.standId);
    const result = into.absorb(from, mine, theirs);
    if (result.nodes === 0) return;
    this.spatialColonies.delete(younger.standId);
    if (this.spatial === from) this.spatial = into;
    const joined = this.require(younger.standId);
    const survivor = this.require(older.standId);
    joined.fusedInto = older.standId;
    // Spores already on the stalk travel with the network that now carries them.
    survivor.released += joined.released;
    this.fusions.push({ at: this.time, into: older.standId, from: younger.standId, stand, nodes: result.nodes });
    this.broadcast(`Two of your colonies met in stand ${stand + 1} and fused into one network (${result.nodes} strands joined).`);
  }

  /** The seeded gust signal, 0..1-ish; a gust is `gustAt(t) >= SPORE_GUST`. */
  gustAt(time = this.time): number {
    const seed = this.region.seed >>> 0;
    const phase = (shift: number) => (((seed >>> shift) & 1023) / 1023) * Math.PI * 2;
    return (Math.sin(time * 0.21 + phase(0)) + Math.sin(time * 0.29 + phase(10)) + Math.sin(time * 0.13 + phase(20))) / 3;
  }

  /** True while a gust (or a storm-strength wind) would lift waiting spores. */
  gusting(time = this.time): boolean {
    return this.storm.phase === 'active' || this.wind.strength >= STORM_STRENGTH || this.gustAt(time) >= SPORE_GUST;
  }

  /** Blooms whose spores are still on the stalk in this stand. */
  sporesReady(standId: number, owner: Owner = 'player'): number {
    const stand = this.stands[standId];
    if (!stand) return 0;
    if (owner === 'player' && (!stand.sim.hasColony || this.spatialOnly(stand))) return 0;
    return Math.max(0, stand.sim[owner].fruited - (owner === 'player' ? stand.released : stand.rivalReleased));
  }

  private sporeCostText(): string {
    const c = ECON.colonyFund;
    return `a spore needs ${c.carbon} carbon, ${c.water} water and ${c.nitrogen} nitrogen in connected strands.`;
  }

  /**
   * The player's order: release the oldest waiting bloom's spores now, on
   * whatever wind is blowing. The wind still decides where they land.
   */
  releaseSpores(standId: number): { ok: boolean; message: string } {
    const stand = this.stands[standId];
    if (!stand || !stand.sim.hasColony || this.spatialOnly(stand)) {
      return { ok: false, message: 'No colony of yours holds spores here.' };
    }
    if (stand.released >= stand.sim.player.fruited) {
      return { ok: false, message: 'No fruiting body is holding spores. Fruit first.' };
    }
    if (this.storm.phase === 'warning') {
      return { ok: false, message: 'The storm is gathering: these spores will ride it when it arrives.' };
    }
    const bloomIndex = stand.released;
    const outcome = this.release(stand, 'player', bloomIndex);
    if (outcome === 'unaffordable') return { ok: false, message: `Too poor to release: ${this.sporeCostText()}` };
    stand.released++;
    if (outcome === 'released') {
      const landed = this.colonization[this.colonization.length - 1];
      const site = landed ? this.region.stands[landed.to] : null;
      return { ok: true, message: site ? `Spores released on the wind. They are carried toward stand ${site.id + 1}.` : 'Spores released on the wind.' };
    }
    if (outcome === 'nowhere') return { ok: true, message: 'Spores released, but the wind carried them where nothing of yours could take hold.' };
    return { ok: true, message: 'The body was lost before it could release; its spores are gone.' };
  }

  private release(from: StandState, owner: Owner = 'player', bloomIndex = 0): SporeRelease {
    const parent = from.sim[owner];
    markConnectivity(parent);
    if (parent.extinct || !parent.nodes[parent.rootId]?.alive) return 'lost';
    const bloom = parent.blooms[bloomIndex];
    // A held body needs a surviving supplied strand at release. No resurrection,
    // refund, or replay if the site has been severed during the countdown.
    if (this.storm.phase === 'active' && bloom && !parent.nodes.some(n => n.alive && n.connected && n.water >= ECON.fruitWaterDraw && n.nitrogen >= ECON.fruitNitrogenDraw && (bloom.spatial && n.spatial ? Math.hypot(n.spatial.x-bloom.spatial.x,n.spatial.y-bloom.spatial.y,n.spatial.z-bloom.spatial.z) : Math.hypot(n.gx-bloom.gx,n.gy-bloom.gy)) <= 3)) return 'lost';
    const wind = this.wind;
    let budget = this.storm.phase === 'active' ? STORM.daughtersPerBloom : 1;
    let founded = 0;
    for (const targetId of this.sporeTargets(from.site.id, wind.direction, this.storm.phase === 'active', owner)) {
      const target = this.require(targetId);
      // A rejected landing cannot spend a kit. Bind/validate the real soil
      // before transferring resources; preview viability is only a forecast.
      try { this.ensureSharedSoil(targetId); } catch { continue; }
      const cost = ECON.colonyFund;
      // A colony pays for its daughter out of what it is holding. A parent that
      // cannot afford the journey does not send anyone and is never put in debt.
      if (!payColonyFund(parent, cost)) return founded > 0 ? 'released' : 'unaffordable';
      if (owner === 'player') this.found(target, from, cost, wind.strength);
      else this.foundRival(target, from, cost, wind.strength);
      this.sporeReleases.push({ at: this.time, from: from.site.id, to: targetId, owner, direction: wind.direction });
      founded++;
      if (--budget <= 0) break;
    }
    if (founded === 0) this.sporeReleases.push({ at: this.time, from: from.site.id, to: null, owner, direction: wind.direction });
    return founded > 0 ? 'released' : 'nowhere';
  }

  private found(target: StandState, from: StandState, cost: { carbon: number; water: number; nitrogen: number }, wind: number): void {
    // The stand's own ground is left exactly as it is: the colony arrives in
    // the soil that was already under it.
    this.ensureSharedSoil(target.site.id);
    target.sim.foundColony(cost);
    // The daughter is born knowing everything the player has learned.
    this.shareLineage(target);
    target.sim.regionalContinuation = this.regionalPlay;
    target.sim.player.colonyId = `player@${this.seedText}:stand-${target.site.id}`;
    this.ensureSpatialColony(target.site.id);
    target.sim.time = this.time;
    target.released = 0;
    const at = this.time;
    target.arrivals.push({ at, from: from.site.id, spores: cost.carbon });
    this.colonization.push({ at, from: from.site.id, to: target.site.id, wind, cost: { ...cost } });
    this.broadcast(`Spores from stand ${from.site.id + 1} (${from.site.community.replace(/-/g, ' ')}) found a colony in stand ${target.site.id + 1} (${target.site.community.replace(/-/g, ' ')}).`);
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
    this.stepSpores(SPORE_BEAT, true);
    this.continueGrowing();
    Object.assign(this.storm, {
      phase: 'warning', direction: ((direction % (Math.PI*2)) + Math.PI*2) % (Math.PI*2),
      initiator: from, announcedAt: this.time, activeAt: this.time + STORM.warning,
      endsAt: this.time + STORM.warning + STORM.duration,
      readyAt: this.time + STORM.warning + STORM.duration + STORM.recovery,
      sequence: this.storm.sequence + 1,
    });
    this.flood.reset();
    this.broadcast(this.fire.phase === 'warning' || this.fire.phase === 'burning'
      ? 'Storm announced over the wildfire. The hurricane will carry embers across the forest; move off flooded ground and prepare for fire.'
      : 'Storm announced. Raise fruiting bodies before the wind arrives in 60 seconds. Rivals share this wind. Its rain will flood the stream: move off low ground by the water.');
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
      this.stepSpores(SPORE_BEAT, true);
      this.storm.phase = 'active';
      this.windRng = mulberry32(hashString(`${this.seedText}:windfall:${this.storm.sequence}`));
      for (const held of this.heldSpores.splice(0)) this.release(this.require(held.from),held.owner,held.bloomIndex);
      this.broadcast('The storm has arrived. Fresh spores ride the chosen wind across the region. The stream is rising.');
    }
    if (this.storm.phase === 'active' && this.time >= this.storm.endsAt - 1e-8) {
      this.stepSpores(SPORE_BEAT, true);
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
    target.sim.rival.traits = { decomposer: true };
    this.shareLineage(target);
    target.rivalPresent = true;
    target.sim.rivalEnabled = true;
    target.sim.regionalContinuation = this.regionalPlay;
    target.sim.syncRegionalPositions(false);
    target.rivalReleased = 0;
    this.colonization.push({at:this.time,from:from.site.id,to:target.site.id,wind,cost:{...cost},owner:'rival'});
    this.broadcast(`Rival spores take hold in stand ${target.site.id + 1}.`);
  }
}
