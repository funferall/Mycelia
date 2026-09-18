import { ECON } from './content';
import { createRegion, downwindStands, type Region, type StandSite } from './region';
import { Simulation, type MatchOutcome } from './sim';

/**
 * A match is a region, not a stand.
 *
 * One `Simulation` still owns one stand's soil, trees and networks — that is
 * the local unit, and the deterministic regression and the browser journey
 * checks still exercise it on its own. This class is what makes nine of them a
 * place: it holds the region, steps every stand in a fixed order, and carries
 * spores between neighbours on the wind.
 *
 * Two rules keep it honest:
 *
 * - **The camera is not part of the simulation.** `activeStandId` decides which
 *   stand the *player is looking at* and which one their orders apply to. It is
 *   never read while stepping, and every stand is stepped every tick, so no
 *   result can depend on where anyone was looking.
 * - **Nothing is minted.** A colony that founds a daughter stand pays carbon,
 *   water and mineral out of its own body, and the daughter starts with exactly
 *   that. A spore that nobody can afford does not land.
 */

export interface StandState {
  readonly site: StandSite;
  /**
   * The stand's own simulation, built the moment a spore lands here and kept
   * from then on: re-entering a stand shows everything that happened in it
   * while nobody was looking. Ground with no colony in it is not simulated at
   * all, which is what keeps nine stands affordable.
   */
  sim: Simulation | null;
  /** Blooms already released as spores, so each one is credited once. */
  released: number;
  /** Every spore that has landed here, oldest first. */
  arrivals: Array<{ at: number; from: number; spores: number }>;
}

export interface Colonization {
  at: number;
  from: number;
  to: number;
  /** Wind strength that carried it: above 1 is a storm, which carries further. */
  wind: number;
  /** What the parent paid, in carbon, water and mineral. */
  cost: { carbon: number; water: number; nitrogen: number };
}

/** How often spore release is considered, in seconds. */
const SPORE_BEAT = 1;
/** Wind at or above this is a storm, and spores ride it to a further stand. */
const STORM_STRENGTH = 1.1;

export class RegionalMatch {
  readonly region: Region;
  readonly stands: StandState[];
  readonly colonization: Colonization[] = [];
  /** Stand the player is looking at. Presentation only; see the class note. */
  activeStandId: number;
  private sporeClock = 0;

  constructor(seedText = 'raven-wood') {
    this.region = createRegion(seedText);
    this.stands = this.region.stands.map((site) => ({
      site,
      sim: null,
      released: 0,
      arrivals: [],
    }));
    this.activeStandId = this.region.foundingStand;
    this.require(this.activeStandId).sim = new Simulation(seedText, this.require(this.activeStandId).site);
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
    const sim = this.active.sim;
    if (!sim) throw new Error(`match: stand ${this.activeStandId} has no colony`);
    return sim;
  }

  get time(): number {
    return this.sim.time;
  }

  get colonizedStands(): number {
    return this.stands.reduce((count, stand) => count + (stand.sim ? 1 : 0), 0);
  }

  /** Blooms anywhere in the region: the lineage, not one colony, reproduces. */
  get fruited(): number {
    return this.stands.reduce((count, stand) => count + (stand.sim?.player.fruited ?? 0), 0);
  }

  /** Spores carried off the sheet by every colony. */
  get spores(): number {
    return this.stands.reduce((count, stand) => count + (stand.sim?.player.spores ?? 0), 0);
  }

  get outcome(): MatchOutcome {
    if (this.fruited >= 2) return 'fruited';
    const colonies = this.stands.filter((stand) => stand.sim !== null);
    return colonies.length > 0 && colonies.every((stand) => stand.sim?.outcome === 'extinct') ? 'extinct' : 'playing';
  }

  /**
   * Move the player's attention to a stand that has a colony in it. Only
   * colonized ground can be entered: there has to be a network to look at.
   */
  selectStand(id: number): boolean {
    if (!this.stands[id]?.sim) return false;
    this.activeStandId = id;
    return true;
  }

  /** Advance the whole region by one fixed step. */
  step(dt: number): void {
    // A match that has been won does not stop the region. A colony that has
    // fruited twice stops growing on its own, the way it always has, but its
    // daughters carry on and can send spores further still — until every colony
    // is gone, which is the only end this class enforces. What a *regional*
    // victory should be is still an open design question (MAP-10).
    if (this.outcome === 'extinct') return;
    // Every stand, every tick, in stand order. A stand's own season clock runs
    // from the same start and the same steps, so the region shares one weather
    // without any of them having to be told about the others.
    for (const stand of this.stands) stand.sim?.step(dt);
    this.stepSpores(dt);
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
      if (!stand.sim) continue;
      while (stand.released < stand.sim.player.fruited) {
        stand.released++;
        this.release(stand);
      }
    }
  }

  private release(from: StandState): void {
    const parent = from.sim?.player;
    if (!parent) return;
    const wind = this.region.windAt(from.sim?.time ?? 0);
    const reach = wind.strength >= STORM_STRENGTH ? 2.01 : 1.01;
    for (const targetId of downwindStands(this.region, from.site.id, wind, reach)) {
      const target = this.require(targetId);
      if (target.sim) continue;
      const cost = ECON.colonyFund;
      // A colony pays for its daughter out of what it is holding. A parent that
      // cannot afford the journey does not send anyone, and the spore is only
      // ever a score.
      if (parent.carbon < cost.carbon) return;
      parent.carbon -= cost.carbon;
      this.found(target, from, cost, wind.strength);
      return;
    }
  }

  private found(target: StandState, from: StandState, cost: { carbon: number; water: number; nitrogen: number }, wind: number): void {
    const seed = `${this.region.seedText}:${target.site.id}`;
    target.sim = new Simulation(seed, target.site, cost);
    // A spore arrives as reserves, not as a body: the colony's whole holding is
    // exactly what its parent paid, and the germinating strand starts empty.
    const colony = target.sim.player;
    colony.carbon = cost.carbon;
    colony.carbonCeiling = cost.carbon;
    colony.water = cost.water;
    colony.nitrogen = cost.nitrogen;
    for (const node of colony.nodes) {
      node.carbon = 0;
      node.water = 0;
      node.nitrogen = 0;
    }
    target.released = 0;
    const at = from.sim?.time ?? 0;
    target.arrivals.push({ at, from: from.site.id, spores: cost.carbon });
    this.colonization.push({ at, from: from.site.id, to: target.site.id, wind, cost: { ...cost } });
    target.sim.events.unshift({
      at,
      text: `A spore from the ${from.site.community.replace(/-/g, ' ')} founds a colony in the ${target.site.community.replace(/-/g, ' ')}.`,
    });
  }
}
