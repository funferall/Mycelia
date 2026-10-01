import {
  ECON,
  GRID,
  PLAYER_PALETTE,
  RIVAL_PALETTE,
  SEASONS,
  SPECIES,
  type Season,
} from './content';
import {
  BOND_REACH_CM,
  bondCandidate,
  bondedJunction,
  createNetwork,
  drawTreeDemand,
  holdsAnyBond,
  isPassable,
  orderWaypoint,
  createGroup,
  dissolveGroup,
  nearestNode,
  makeCord,
  cordRoute,
  layCord,
  planCord,
  startFruiting,
  starveBondedTree,
  stepNetwork,
  updateTotals,
  tryBond,
  type HyphaNode,
  type Network,
  steeringClaimed,
} from './network';
import { forEachMovedStrand, heldBy } from './segments';
import { hashString, mulberry32, type Rng } from './rng';
import { communityThresholds, type StandSite } from './region';
import { REMAINS, belowWaterTable, cellAt, createStandWorld, createWorld, idx, rowAtDepthCm, stepHydration, stepRemains, updateMoisture, updateSoil, type Tree, type World } from './world';

/** What a founding spore brings with it when it starts a colony. */
export interface FoundingKit {
  carbon: number;
  water: number;
  nitrogen: number;
}

export interface SimEvent {
  /** Simulation time the event was logged at, in seconds. */
  at: number;
  text: string;
}

export type MatchOutcome = 'playing' | 'fruited' | 'extinct';

/**
 * The whole game, headless.
 *
 * Nothing in this class knows that a renderer exists. It advances a fixed
 * timestep, reads no globals, and draws no randomness except from its own
 * seeded stream, so a match is reproducible from its seed and the orders the
 * player gave — which is what makes replays and lockstep multiplayer possible
 * later without redesigning the simulation.
 */
export class Simulation {
  readonly world: World;
  /** The colony in this stand. Replaced only when a spore founds one. */
  player: Network;
  rival: Network;
  rivalEnabled = true;
  /** Explicit continuation beyond the introductory two-bloom victory. */
  regionalContinuation = false;
  regionalWeather: { rainfall: number; fruiting: boolean; fruitSpeed?: number } | null = null;
  /** Where each node was last projected into the regional volume (wx, wy, stand). */
  private readonly synced = new WeakMap<object, [number, number, number]>();
  /** The stand each network was last fully synced in. */
  private readonly syncedStand = new WeakMap<object, number>();
  readonly seed: number;
  readonly events: SimEvent[] = [];
  readonly runStartedAt = Date.now();
  /**
   * Whether a colony is actually growing here. Ground with no colony has a
   * world and can be looked at, but has no network, pays no upkeep and is not
   * stepped: the stand's history begins when a spore lands.
   */
  hasColony = true;

  /** Seconds of simulated time elapsed. */
  time = 0;
  seasonIndex = 0;
  seasonClock = 0;
  outcome: MatchOutcome = 'playing';
  /** Player-chosen match goal; Phase 0 ships the fruiting victory only. */
  readonly fruitGoal = 2;

  private readonly rng: Rng;
  private rivalThinkClock = 0;
  private moistureClock = 0;

  /**
   * @param site the stand this colony lives in. Without one the simulation
   * builds the single stand the prototype has always opened on, which is what
   * the deterministic regression and the standalone match still use.
   * @param kit what the founding spore carried. The reserve it replaces is the
   * colony's own: a spore that crossed a stand border starts with what its
   * parent paid, not with a standing endowment.
   */
  constructor(seedText = 'raven-wood', site?: StandSite, kit?: FoundingKit) {
    const seed = site ? site.seed >>> 0 : hashString(seedText);
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x1d872b41);
    this.site = site ?? null;
    this.world = site
      ? createStandWorld(seed, {
          waterTableCm: site.waterTableCm,
          mix: communityThresholds(site.community),
          stream: site.stream,
        })
      : createWorld(seed);

    // The player wakes in the soil beside a tree's root system, close enough
    // that the first bond is a short, legible act rather than a long march.
    const anchor = startingGround(this.world);
    this.player = createNetwork(
      'player',
      PLAYER_PALETTE.label,
      anchor.gx,
      anchor.gy,
      mulberry32(seed ^ 0xabc123),
      kit?.carbon ?? 220,
      kit ? { water: kit.water, nitrogen: kit.nitrogen } : {}
    );
    // In a regional match the rival starts in another stand, beside roots just
    // as the player does. Standalone fixtures keep the two founders apart.
    const rivalStart = site ? startingGround(this.world) : passableNear(this.world, Math.floor(GRID.cols * 0.14), 3);
    this.rival = createNetwork(
      'rival',
      RIVAL_PALETTE.label,
      rivalStart.gx,
      rivalStart.gy,
      mulberry32(seed ^ 0x55aa77),
      220
    );

    this.log(
      site
        ? `Colony founded in the ${site.community.replace(/-/g, ' ')} with ${this.player.carbon.toFixed(0)} carbon.`
        : `Match opened on seed "${seedText}".`
    );
    this.log(`${this.world.trees.length} trees standing in the stand.`);
  }

  /** The stand this simulation is, when it is one of a region's stands. */
  readonly site: StandSite | null = null;

  /**
   * Start a colony in this stand from a spore.
   *
   * The world is left exactly as it is — the soil, the trees and the rival in
   * this ground are the ones that were already here — and a network is added to
   * it, holding what the spore carried and nothing more.
   */
  foundColony(kit: FoundingKit): void {
    // Spores landing where the rival already lives found away from its
    // founder: two colonies starting on one cell would open at war.
    const rivalRoot = this.rivalEnabled && !this.rival.extinct ? this.rival.nodes[this.rival.rootId] : undefined;
    const anchor = startingGround(this.world, rivalRoot?.alive ? { gx: rivalRoot.gx, gy: rivalRoot.gy } : undefined);
    const colony = createNetwork(
      'player',
      PLAYER_PALETTE.label,
      anchor.gx,
      anchor.gy,
      mulberry32(this.seed ^ 0xabc123),
      kit.carbon,
      { water: kit.water, nitrogen: kit.nitrogen }
    );
    // createNetwork distributes the kit between founder and exploratory tips.
    // Totals are a readout of those stores, never a second resource pool.
    updateTotals(colony);
    this.player = colony;
    this.hasColony = true;
    this.syncRegionalPositions();
    this.log(`A spore takes hold here with ${kit.carbon.toFixed(0)} carbon.`);
  }

  /** Keep the opening body's real XYZ positions while its flat UI stays local. */
  syncRegionalPositions(includePlayer = true, includeRival = true, movedOnly = false): void {
    const projection = this.world.regionalSoil;
    if (!projection) return;
    const nets = [includePlayer ? this.player : null, includeRival ? this.rival : null];
    const sync = (node: HyphaNode): void => {
      // Only growing tips move. A node already synced where it stands keeps its
      // point: the projection is pure, so recomputing it would change nothing.
      const last = this.synced.get(node);
      if (last && last[0] === node.wx && last[1] === node.wy && last[2] === projection.standId) return;
      this.synced.set(node, [node.wx, node.wy, projection.standId]);
      const point = projection.pointAt(node.wx - 0.5, node.wy - 0.5);
      if (point) {
        node.spatial = point;
        node.standId = projection.standId;
        node.y = point.y;
        node.lateral = point.y;
        node.targetLateral = point.y;
      }
    };
    for (const net of nets) {
      if (!net) continue;
      // After a step, only tips and strands that just settled can have moved,
      // once the whole network has been synced in this stand.
      if (movedOnly && this.syncedStand.get(net) === projection.standId && forEachMovedStrand(net, sync)) continue;
      for (const node of net.nodes) sync(node);
      this.syncedStand.set(net, projection.standId);
    }
  }

  get season(): Season {
    return SEASONS[this.seasonIndex % SEASONS.length] as Season;
  }

  /** Advance by exactly one fixed step. */
  step(dt: number, playerManagedByRegion = false, soilManagedByRegion = false, rivalManagedByRegion = false): void {
    if (this.outcome !== 'playing' && !playerManagedByRegion && !this.regionalContinuation) return;

    this.time += dt;
    this.advanceSeason(dt);

    const season = this.season;
    this.world.rainfall = this.regionalWeather?.rainfall ?? season.rain;
    this.world.litterfall = season.litterfall;
    // Drought pulls the water table down; wet seasons raise it.
    // The stand's own depth is the reference; the weather moves it from there.
    const tableTarget = this.world.waterTableBaseCm + (1 - season.rain) * 22 - (season.rain - 1) * 8;
    this.world.waterTableCm += (tableTarget - this.world.waterTableCm) * Math.min(1, dt * 0.08);

    // Soil moisture and mineralisation touch every cell, which is far more
    // often than soil actually changes, so they run on a beat rather than every
    // single step.
    this.moistureClock += dt;
    if (this.moistureClock >= 0.25) {
      if (!soilManagedByRegion) {
        updateMoisture(this.world, this.moistureClock);
        updateSoil(this.world, this.moistureClock, season.litterfall);
      }
      this.moistureClock = 0;
    }

    const ctx = {
      world: this.world,
      light: season.light,
      warmth: season.warmth,
      fruitingWeather: this.regionalWeather?.fruiting ?? false,
      fruitSpeed: this.regionalWeather?.fruitSpeed ?? 1,
      rival: this.rival,
      time: this.time,
      log: (text: string) => this.log(text),
      dt,
    };
    // A spatial colony is stepped once by RegionalMatch over the shared soil
    // volume. This stand still advances its weather and trees.
    if (!playerManagedByRegion) stepNetwork(this.player, ctx);
    if (this.rivalEnabled && !rivalManagedByRegion) stepNetwork(this.rival, ctx);
    this.syncRegionalPositions(!playerManagedByRegion, !rivalManagedByRegion, true);

    this.stepTrees(dt, playerManagedByRegion, rivalManagedByRegion);
    // Charred remains decay into the soil; a decomposer's strands nearby double the pace.
    stepRemains(this.world, dt, (tree) => (this.decomposerNear(tree) ? REMAINS.decomposerSpeed : 1));
    if (this.rivalEnabled && !rivalManagedByRegion) this.stepRivalDrama(dt);
    if (!playerManagedByRegion) this.checkOutcome();
  }

  /** True when a living strand of a decomposer colony here reaches this tree's remains. */
  private decomposerNear(tree: Tree): boolean {
    for (const net of [this.player, this.rival]) {
      if (!net.traits?.decomposer || net.extinct) continue;
      for (const node of net.nodes) {
        if (node.alive && node.gy < REMAINS.rows && Math.abs(node.gx - tree.gx) <= REMAINS.reachCols) return true;
      }
    }
    return false;
  }

  private advanceSeason(dt: number): void {
    this.seasonClock += dt;
    const current = this.season;
    if (this.seasonClock < current.seconds) return;
    this.seasonClock -= current.seconds;
    this.seasonIndex++;
    this.log(`${this.season.label} begins.`);
  }

  /**
   * Trees as agents. A bonded tree pays in carbon and expects water and
   * minerals in return; a tree that goes without long enough severs the bond,
   * which is the economy's ability to strike back at the player.
   */
  private stepTrees(dt: number, playerManagedByRegion = false, rivalManagedByRegion = false): void {
    for (const tree of this.world.trees) {
      if (tree.dead) continue;
      // How well watered the tree has been lately. Read before this step's
      // trade, so it follows what the partners actually delivered.
      stepHydration(this.world, tree, dt);
      const spec = SPECIES[tree.species];
      const rootRow = rowAtDepthCm(spec.rootDepthCm * 0.5);
      const soilCell = this.world.cells[idx(tree.gx, Math.min(GRID.rows - 1, rootRow))];
      const soilWater = soilCell ? soilCell.water : 0;

      // Which of my nodes is bonded to this tree? The rules for what the tree
      // does about it live in `network.ts`, because a colony that crosses a
      // stand boundary trades with its partners by exactly the same ones.
      const playerBond = !playerManagedByRegion ? bondedJunction(this.player, tree) : null;
      const rivalBond = this.rivalEnabled && !rivalManagedByRegion ? bondedJunction(this.rival, tree) : null;
      const bonded = holdsAnyBond(tree);

      for (const [net, junction, managed] of [
        [this.player, playerBond, playerManagedByRegion],
        [this.rival, rivalBond, rivalManagedByRegion || !this.rivalEnabled],
      ] as const) {
        if (managed || !holdsAnyBond(tree, net.colonyId)) continue;
        const sever = junction
          ? drawTreeDemand(tree, junction, spec, dt)
          : starveBondedTree(tree, dt);
        if (sever) this.severBond(tree, net, junction ? 'stopped supplying' : 'lost the strand that fed it');
      }
      if (!bonded) {
        // Unbonded trees live off the soil alone. Drought hurts them, but
        // slowly: a stand must not be wiped out in the first minute by weather.
        const stress = Math.max(0, 0.2 - soilWater);
        tree.health = Math.max(0.05, tree.health - stress * dt * 0.012);
        if (soilWater > 0.35) tree.health = Math.min(1, tree.health + dt * 0.02);
        tree.patience = Math.min(spec.patience, tree.patience + dt);
      }

      // Growth: a healthy tree matures, then extends new root tips into soil it
      // has not reached yet — which is how the player's target list grows.
      if (tree.health > 0.72 && this.season.warmth > 0.25) {
        tree.maturity = Math.min(1, tree.maturity + dt * 0.004 * this.season.light);
        if (tree.maturity > 0.85 && bonded && tree.rootTips.length < 9 && this.rng() < dt * 0.03) {
          this.growRootTip(tree);
        }
      }

      if (tree.health <= 0.06) {
        tree.dead = true;
        this.log(`${spec.common} died. Its roots are decomposable matter now.`);
        // Death feeds the forest: the trunk becomes food for whoever reaches it.
        const gy = Math.min(GRID.rows - 1, Math.floor(GRID.rows * 0.1));
        const cell = this.world.cells[idx(tree.gx, gy)];
        if (cell) {
          cell.organic = Math.min(1, cell.organic + 0.5);
          cell.nitrogen = Math.min(1, cell.nitrogen + 0.3);
        }
      }
    }

    let biomass = 0;
    for (const tree of this.world.trees) biomass += tree.dead ? 0 : tree.health * tree.maturity;
    this.world.forestBiomass = biomass;
  }

  private growRootTip(tree: Tree): void {
    const spec = SPECIES[tree.species];
    for (let attempt = 0; attempt < 8; attempt++) {
      const gx = Math.round(tree.gx + (this.rng() - 0.5) * 16);
      const gy = Math.round(rowAtDepthCm(this.rng() * spec.rootDepthCm));
      if (!isPassable(this.world, gx, gy)) continue;
      if (tree.rootTips.some((t) => t.gx === gx && t.gy === gy)) continue;
      tree.rootTips.push({ id: tree.rootTips.length, gx, gy, bondedTo: null });
      this.log(`${spec.common} extended a new root tip at −${Math.round(gy * GRID.cmPerRow)}cm.`);
      return;
    }
  }

  private severBond(tree: Tree, net: Network, reason: string): void {
    let severed = false;
    for (const tip of tree.rootTips) {
      if (tip.bondedTo === null) continue;
      if ((tip.bondedColonyId ?? null) !== (net.colonyId ?? null)) continue;
      const node = net.nodes[tip.bondedTo];
      if (node) {
        node.bondedTree = -1;
        node.bondedRootTip = -1;
        node.pulse = 1;
      }
      tip.bondedTo = null;
      tip.bondedColonyId = null;
      severed = true;
    }
    if (severed) {
      this.log(`${SPECIES[tree.species].common} severed its bond — it ${reason}.`);
    }
  }

  /** The rival uses the same root-tip bond and growth orders as the player. */
  private stepRivalDrama(dt: number): void {
    if (this.rival.extinct || this.rival.resting) return;
    this.rivalThinkClock -= dt;
    if (this.rivalThinkClock > 0) return;
    this.rivalThinkClock = 4;
    let next: { gx: number; gy: number; score: number } | null = null;
    for (const tree of this.world.trees) {
      if (tree.dead) continue;
      const alreadyPartnered = holdsAnyBond(tree, this.rival.colonyId);
      for (const tip of tree.rootTips) {
        if (tip.bondedTo !== null) continue;
        const candidate = bondCandidate(this.rival, this.world, tree, tip);
        if (!candidate) continue;
        if (candidate.distanceCm <= BOND_REACH_CM && candidate.availableCarbon >= ECON.bondCharge &&
          tryBond(this.rival, this.world, tree.id, tip.id)) {
          this.log(`The rival bonded a ${SPECIES[tree.species].common}.`);
          return;
        }
        const score = candidate.distanceCm + (alreadyPartnered ? 1000 : 0);
        if (!next || score < next.score) next = { gx: tip.gx, gy: tip.gy, score };
      }
    }
    // An agent playing the rival steers its growth while its order stands.
    if (next && !steeringClaimed(this.rival) && (this.rival.waypoints[0]?.gx !== next.gx || this.rival.waypoints[0]?.gy !== next.gy)) {
      orderWaypoint(this.rival, next.gx, next.gy, this.world);
    }
  }

  private checkOutcome(): void {
    if (this.player.fruited >= this.fruitGoal && !this.regionalContinuation) {
      this.outcome = 'fruited';
      this.log('Spores are away. The lineage travels.');
      return;
    }
    if (this.player.extinct) {
      this.outcome = 'extinct';
      this.log('The last living hypha died.');
    }
  }

  // -------------------------------------------------------------------------
  // Player orders. Each returns whether the order was accepted, so the
  // interface can print a refusal rather than silently doing nothing.
  // -------------------------------------------------------------------------

  /**
   * Direct growth: send the frontier toward a point on the sheet.
   *
   * Returns the refusal's own words, so the sheet can distinguish stone from
   * the stream rather than printing one apology for both.
   */
  growTo(gx: number, gy: number, group = 0): { ok: boolean; message: string } {
    if (this.outcome !== 'playing') return { ok: false, message: 'This specimen is complete.' };
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
      return { ok: false, message: 'Choose a point on the sheet.' };
    }
    const x = Math.round(gx);
    const y = Math.round(gy);
    const cell = cellAt(this.world, x, y);
    if (!cell || cell.stratum === 'bedrock') {
      return { ok: false, message: 'Choose open soil inside the specimen. Stone cannot be crossed.' };
    }
    const regionalBlock = this.world.regionalSoil?.blockAt(x, y);
    if (regionalBlock === 'stream' || (!this.world.regionalSoil && cell.stream)) {
      return {
        ok: false,
        message: 'That is the stream itself. Grow along its damp bank; hyphae cannot cross open water.',
      };
    }
    if (regionalBlock === 'groundwater' || (!this.world.regionalSoil && belowWaterTable(this.world, y))) {
      return { ok: false, message: 'The soil below the water table is saturated. Reach the soft upper fringe for water; hyphae cannot grow deeper.' };
    }
    if (regionalBlock) return { ok: false, message: 'Choose open soil inside the specimen. Stone cannot be crossed.' };
    orderWaypoint(this.player, x, y, this.world, undefined, group);
    return { ok: true, message: `${group ? `Subcluster ${group}` : 'Frontier'} directed to ${x} · −${y}cm` };
  }

  /**
   * Split a subcluster out of the player's colony: the strands within `radius`
   * cells of a point, steered separately from then on. See `GrowthGroup`.
   */
  splitAt(gx: number, gy: number, radius: number): { ok: boolean; message: string; id?: number } {
    if (this.outcome !== 'playing') return { ok: false, message: 'This specimen is complete.' };
    return createGroup(this.player, this.world, gx, gy, radius);
  }

  /** Return a subcluster to the colony at large. */
  mergeGroup(id: number): boolean {
    return dissolveGroup(this.player, this.world, id);
  }

  /** Direct growth as a yes or no, for callers that keep their own words. */
  orderGrowth(gx: number, gy: number): boolean {
    return this.growTo(gx, gy).ok;
  }

  /** Attempt symbiosis with the nearest available root tip. */
  orderBond(gx: number, gy: number): { ok: boolean; message: string } {
    if (this.outcome !== 'playing') return { ok: false, message: 'This specimen is complete.' };
    const candidate = this.nearestAvailableTip(gx, gy);
    if (!candidate) return { ok: false, message: 'No unbonded root tip within reach.' };
    return this.orderBondTip(candidate.treeId, candidate.tipId);
  }

  /**
   * Attempt symbiosis with one specific root tip.
   *
   * The interface binds its root labels to a tree and a tip, so the strand that
   * bonds is the one the player was looking at rather than whichever strand
   * happened to be nearest when they clicked.
   */
  orderBondTip(treeId: number, tipId: number): { ok: boolean; message: string } {
    if (this.outcome !== 'playing') return { ok: false, message: 'This specimen is complete.' };
    const tree = this.world.trees[treeId];
    const tip = tree?.rootTips[tipId];
    if (!tree || !tip) return { ok: false, message: 'No root there.' };
    if (tree.dead) return { ok: false, message: 'That tree is dead. Its roots are food now.' };
    if (tip.bondedTo !== null) return { ok: false, message: 'Already bonded to that root.' };

    const candidate = bondCandidate(this.player, this.world, tree, tip);
    if (!candidate) return { ok: false, message: 'No free living strand left in the network.' };
    if (candidate.distanceCm > BOND_REACH_CM) {
      return {
        ok: false,
        message: `${Math.round(candidate.distanceCm)}cm short of that root. Grow closer first.`,
      };
    }
    if (candidate.availableCarbon < ECON.bondCharge) {
      return { ok: false, message: 'The connected network lacks the carbon to bond. Let it gather from living soil.' };
    }
    if (!tryBond(this.player, this.world, treeId, tipId)) {
      return { ok: false, message: 'The junction would not take. Try a strand on the root itself.' };
    }
    const spec = SPECIES[tree.species];
    this.log(`Symbiosis with ${spec.common}. It wants water and minerals; it pays in sugar.`);
    return { ok: true, message: `Bonded to ${spec.common}. It drinks ${spec.waterDemand.toFixed(1)} water/s.` };
  }

  /** The nearest living, connected strand to a grid point. */
  nearestStrand(gx: number, gy: number): { node: HyphaNode; distance: number } | null {
    let best: HyphaNode | null = null;
    let bestDist = Infinity;
    for (const node of this.player.nodes) {
      if (!node.alive || !node.connected) continue;
      const d = Math.hypot(node.wx - (gx + 0.5), node.wy - (gy + 0.5));
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best ? { node: best, distance: bestDist } : null;
  }

  /** Commit surplus to a fruiting body. */
  orderFruit(gx: number, gy: number): { ok: boolean; message: string } {
    if (this.outcome !== 'playing') return { ok: false, message: 'This specimen is complete.' };
    if (this.player.fruit.active) return { ok: false, message: 'A fruiting body is already rising.' };
    if (this.player.surplus < ECON.fruitThreshold) {
      return {
        ok: false,
        message: `Surplus ${this.player.surplus.toFixed(0)} of ${ECON.fruitThreshold} needed.`,
      };
    }
    if (this.season.warmth < 0.3) return { ok: false, message: 'Too cold to fruit.' };
    if (gy > 12 || gy < 0) return { ok: false, message: 'Grow into the upper 12 cm of soil before fruiting.' };
    const strand = startFruiting(this.player, this.world, Math.round(gx), Math.round(gy));
    if (!strand) return { ok: false, message: 'Nothing of mine is near enough to the surface there.' };
    this.log('A fruiting body has begun to rise. It spends the reserve as it grows.');
    return {
      ok: true,
      message: `Fruiting from the strand at -${strand.gy}cm. It must stay supplied to rise.`,
    };
  }

  /** Thicken the strand nearest a point into a cord. */
  orderCord(gx: number, gy: number): { ok: boolean; message: string } {
    if (this.outcome !== 'playing') return { ok: false, message: 'This specimen is complete.' };
    const node = nearestNode(this.player, gx, gy, 3);
    if (!node) return { ok: false, message: 'No strand of mine there.' };
    if (node.reinforced) return { ok: false, message: 'Already a cord.' };
    if (heldBy(this.player, node, 'carbon') < ECON.cordCharge) {
      return { ok: false, message: 'Not enough carbon at that strand.' };
    }
    makeCord(this.player, node.id);
    this.log('A strand thickened into a cord.');
    return { ok: true, message: 'Cord thickened.' };
  }

  /**
   * Lay a cord from one strand of the colony toward another (by default, all
   * the way home to the founding node), as far as the colony can afford.
   */
  orderCordRoute(fromId: number, toId?: number): { ok: boolean; message: string; laid: number } {
    if (this.outcome !== 'playing' && !this.regionalContinuation) return { ok: false, message: 'This specimen is complete.', laid: 0 };
    const route = cordRoute(this.player, fromId, toId);
    if (!route.length) return { ok: false, message: 'Those strands are not joined.', laid: 0 };
    const laid = layCord(this.player, route);
    if (!laid) {
      return planCord(this.player, route).fresh === 0 && route.every((id) => this.player.nodes[id]?.reinforced)
        ? { ok: false, message: 'Already a cord.', laid: 0 }
        : { ok: false, message: 'Not enough carbon to spare for a cord.', laid: 0 };
    }
    this.log(`${laid} strand${laid === 1 ? '' : 's'} braided into a cord.`);
    return { ok: true, message: 'Cord laid.', laid };
  }

  nearestAvailableTip(gx: number, gy: number, maxDist = 4): { treeId: number; tipId: number } | null {
    let best: { treeId: number; tipId: number } | null = null;
    let bestDist = maxDist;
    for (const tree of this.world.trees) {
      if (tree.dead) continue;
      for (const tip of tree.rootTips) {
        if (tip.bondedTo !== null) continue;
        const d = Math.hypot(tip.gx - gx, tip.gy - gy);
        if (d < bestDist) {
          bestDist = d;
          best = { treeId: tree.id, tipId: tip.id };
        }
      }
    }
    return best;
  }

  log(text: string): void {
    this.events.push({ at: this.time, text });
    if (this.events.length > 60) this.events.shift();
  }
}

/**
 * Where the match opens: beside the shallowest root tip in the stand, offset
 * far enough that the player has to grow a little to reach it, but close enough
 * that the first symbiosis is an early act rather than a long expedition.
 */
function startingGround(world: World, avoid?: { gx: number; gy: number }): { gx: number; gy: number } {
  const middle = Math.floor(world.trees.length / 2);
  const tree = world.trees[middle] ?? world.trees[0];
  if (!tree || tree.rootTips.length === 0) {
    return { gx: Math.floor(GRID.cols / 2), gy: 6 };
  }
  if (!avoid) return groundBeside(world, tree);
  // Ground already held by a founder: the same rule beside another tree, the
  // nearest to the stand's middle that keeps clear of it, or else the farthest.
  const order = world.trees
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.rootTips.length > 0)
    .sort((a, b) => Math.abs(a.i - middle) - Math.abs(b.i - middle) || a.i - b.i);
  let farthest: { gx: number; gy: number } | null = null;
  let farthestDistance = -1;
  for (const { t } of order) {
    const at = groundBeside(world, t);
    const distance = Math.hypot(at.gx - avoid.gx, at.gy - avoid.gy);
    if (distance >= FOUNDER_CLEARANCE) return at;
    if (distance > farthestDistance) { farthest = at; farthestDistance = distance; }
  }
  return farthest ?? groundBeside(world, tree);
}

/** Cells a landing spore keeps between its founder and a founder already in the stand. */
const FOUNDER_CLEARANCE = 24;

/** Beside a tree's shallowest root tip, as `startingGround` places a founder. */
function groundBeside(world: World, tree: World['trees'][number]): { gx: number; gy: number } {
  // Shallowest tip: the one nearest the surface, so the spore is not buried in
  // bedrock and still has soil above it to grow into.
  let best = tree.rootTips[0] as (typeof tree.rootTips)[number];
  for (const tip of tree.rootTips) {
    if (tip.gy < best.gy) best = tip;
  }
  const gx = Math.max(6, Math.min(GRID.cols - 6, best.gx - 5));
  const gy = Math.max(5, Math.min(GRID.rows - 20, best.gy - 3));
  return passableNear(world, gx, gy);
}

/**
 * The nearest soil to a point that a hypha could actually occupy.
 *
 * Used only for the two places a network is placed rather than grown — the
 * founding spore and the rival's first strand — so that neither can begin life
 * floating in a stream. A spore lands on the bank instead.
 */
function passableNear(world: World, gx: number, gy: number): { gx: number; gy: number } {
  if (isPassable(world, gx, gy)) return { gx, gy };
  for (let step = 1; step < GRID.cols; step++) {
    const left = gx - step;
    const right = gx + step;
    if (isPassable(world, left, gy)) return { gx: left, gy };
    if (isPassable(world, right, gy)) return { gx: right, gy };
  }
  return { gx, gy };
}
