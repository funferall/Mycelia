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
  createNetwork,
  isPassable,
  orderWaypoint,
  nearestNode,
  makeCord,
  startFruiting,
  stepNetwork,
  tryBond,
  type HyphaNode,
  type Network,
} from './network';
import { hashString, mulberry32, type Rng } from './rng';
import { createWorld, idx, rowAtDepthCm, updateMoisture, updateSoil, type Tree, type World } from './world';

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
  readonly player: Network;
  readonly rival: Network;
  readonly seed: number;
  readonly events: SimEvent[] = [];
  readonly runStartedAt = Date.now();

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

  constructor(seedText = 'raven-wood') {
    const seed = hashString(seedText);
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x1d872b41);
    this.world = createWorld(seed);

    // The player wakes in the soil beside a tree's root system, close enough
    // that the first bond is a short, legible act rather than a long march.
    const anchor = startingGround(this.world);
    this.player = createNetwork(
      'player',
      PLAYER_PALETTE.label,
      anchor.gx,
      anchor.gy,
      mulberry32(seed ^ 0xabc123),
      220
    );
    // The rival saprotroph starts deep in the litter at the far end, where the
    // decomposable matter is richest, and spreads toward the player.
    this.rival = createNetwork(
      'rival',
      RIVAL_PALETTE.label,
      Math.floor(GRID.cols * 0.14),
      3,
      mulberry32(seed ^ 0x55aa77),
      40
    );

    this.log(`Match opened on seed "${seedText}".`);
    this.log(`${this.world.trees.length} trees standing in the stand.`);
  }

  get season(): Season {
    return SEASONS[this.seasonIndex % SEASONS.length] as Season;
  }

  /** Advance by exactly one fixed step. */
  step(dt: number): void {
    if (this.outcome !== 'playing') return;

    this.time += dt;
    this.advanceSeason(dt);

    const season = this.season;
    this.world.rainfall = season.rain;
    this.world.litterfall = season.litterfall;
    // Drought pulls the water table down; wet seasons raise it.
    const tableTarget = GRID.rows * 0.66 + (1 - season.rain) * 22 - (season.rain - 1) * 8;
    this.world.waterTableCm += (tableTarget - this.world.waterTableCm) * Math.min(1, dt * 0.08);

    // Soil moisture and mineralisation touch every cell, which is far more
    // often than soil actually changes, so they run on a beat rather than every
    // single step.
    this.moistureClock += dt;
    if (this.moistureClock >= 0.25) {
      updateMoisture(this.world, this.moistureClock);
      updateSoil(this.world, this.moistureClock, season.litterfall);
      this.moistureClock = 0;
    }

    const ctx = {
      world: this.world,
      light: season.light,
      warmth: season.warmth,
      rival: this.rival,
      time: this.time,
      log: (text: string) => this.log(text),
      dt,
    };
    stepNetwork(this.player, ctx);
    stepNetwork(this.rival, ctx);

    this.stepTrees(dt);
    this.stepRivalDrama(dt);
    this.checkOutcome();
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
  private stepTrees(dt: number): void {
    for (const tree of this.world.trees) {
      if (tree.dead) continue;
      const spec = SPECIES[tree.species];
      const rootRow = rowAtDepthCm(spec.rootDepthCm * 0.5);
      const soilCell = this.world.cells[idx(tree.gx, Math.min(GRID.rows - 1, rootRow))];
      const soilWater = soilCell ? soilCell.water : 0;

      // Which of my nodes is bonded to this tree?
      let bondNode = null;
      let bonded = false;
      for (const tip of tree.rootTips) {
        if (tip.bondedTo === null) continue;
        bonded = true;
        const node = this.player.nodes[tip.bondedTo];
        // A junction that has been severed from the root is not supplying
        // anything, however much of it is still standing. The tree feels the
        // cut as an unmet demand and counts down to leaving.
        if (node && node.alive && node.connected) {
          bondNode = node;
          break;
        }
      }

      if (bondNode) {
        // The tree draws what it needs out of the junction.
        const wantWater = spec.waterDemand * dt * (0.5 + tree.maturity * 0.8);
        const wantNutrient = spec.nutrientDemand * dt * (0.5 + tree.maturity * 0.8);
        const gotWater = Math.min(bondNode.water, wantWater);
        const gotNutrient = Math.min(bondNode.nitrogen, wantNutrient);
        bondNode.water -= gotWater;
        bondNode.nitrogen -= gotNutrient;
        tree.waterReceived = gotWater / Math.max(1e-6, wantWater);
        tree.nutrientReceived = gotNutrient / Math.max(1e-6, wantNutrient);

        const satisfaction = Math.min(tree.waterReceived, tree.nutrientReceived);
        if (satisfaction > 0.85) {
          tree.patience = Math.min(spec.patience, tree.patience + dt * 2);
          tree.health = Math.min(1, tree.health + dt * 0.02 * satisfaction);
        } else {
          tree.patience -= dt * (1.6 - satisfaction);
          tree.health = Math.max(0.05, tree.health - dt * 0.012 * (1 - satisfaction));
          if (tree.patience <= 0) {
            this.severBond(tree, 'stopped supplying');
          }
        }
      } else if (bonded) {
        // The tree is still bonded to something, but the strand holding the
        // bond is dead or cut off from the root. It is not being fed, and it
        // must feel that: an abandoned junction is not a quiet no-op.
        tree.waterReceived = 0;
        tree.nutrientReceived = 0;
        tree.patience -= dt * 1.6;
        tree.health = Math.max(0.05, tree.health - dt * 0.012);
        if (tree.patience <= 0) {
          this.severBond(tree, 'lost the strand that fed it');
        }
      } else {
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
        if (tree.maturity > 0.85 && bondNode && tree.rootTips.length < 9 && this.rng() < dt * 0.03) {
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

  private severBond(tree: Tree, reason: string): void {
    let severed = false;
    for (const tip of tree.rootTips) {
      if (tip.bondedTo === null) continue;
      const node = this.player.nodes[tip.bondedTo];
      if (node) {
        node.bondedTree = -1;
        node.bondedRootTip = -1;
        node.pulse = 1;
      }
      tip.bondedTo = null;
      severed = true;
    }
    if (severed) {
      this.log(`${SPECIES[tree.species].common} severed its bond — it ${reason}.`);
    }
  }

  /**
   * The rival's "mind": very simple, and deliberately not a mirror of the
   * player. It does not court trees at all. It hunts decomposable matter, which
   * means every corpse — a dead tree, a starved strand — is a gift to it.
   */
  private stepRivalDrama(dt: number): void {
    if (this.rival.extinct) return;
    this.rivalThinkClock -= dt;
    if (this.rivalThinkClock > 0) return;
    this.rivalThinkClock = 5 + this.rng() * 6;
    if (this.rival.waypoints.length > 0) return;

    // Look for the richest patch of organic matter the rival has not reached.
    let bestScore = -Infinity;
    const rivalRoot = this.rival.nodes[this.rival.rootId];
    let bestX = rivalRoot?.gx ?? 0;
    let bestY = rivalRoot?.gy ?? 0;
    for (let sample = 0; sample < 220; sample++) {
      const gx = Math.floor(this.rng() * GRID.cols);
      const gy = Math.floor(this.rng() * GRID.rows);
      const cell = this.world.cells[idx(gx, gy)];
      if (!cell || cell.stratum === 'bedrock') continue;
      // Distance matters: a saprotroph will not cross the whole sheet for a
      // slightly better meal.
      const dist = rivalRoot ? Math.hypot(gx - rivalRoot.gx, gy - rivalRoot.gy) : 0;
      const score = cell.organic * 3 + cell.nitrogen - dist * 0.012 - cell.occupancy * 2;
      if (score > bestScore) {
        bestScore = score;
        bestX = gx;
        bestY = gy;
      }
    }
    orderWaypoint(this.rival, bestX, bestY);
  }

  private checkOutcome(): void {
    if (this.player.fruited >= this.fruitGoal) {
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

  /** Direct growth: send the frontier toward a point on the sheet. */
  orderGrowth(gx: number, gy: number): boolean {
    if (this.outcome !== 'playing') return false;
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return false;
    if (!isPassable(this.world, Math.round(gx), Math.round(gy))) return false;
    orderWaypoint(this.player, Math.round(gx), Math.round(gy), this.world);
    return true;
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

    const distance = this.nearestStrand(tip.gx, tip.gy);
    if (!distance) return { ok: false, message: 'No living strand left in the network.' };
    if (distance.distance > 3.5) {
      return {
        ok: false,
        message: `${Math.round(distance.distance)}cm short of that root. Grow closer first.`,
      };
    }
    if (distance.node.carbon < ECON.bondCharge) {
      return { ok: false, message: 'The strand at that root is too poor to hold a bond. Let it gather.' };
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
    if (node.carbon < ECON.cordCharge) {
      return { ok: false, message: 'Not enough carbon at that strand.' };
    }
    makeCord(this.player, node.id);
    this.log('A strand thickened into a cord.');
    return { ok: true, message: 'Cord thickened.' };
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
function startingGround(world: World): { gx: number; gy: number } {
  const tree = world.trees[Math.floor(world.trees.length / 2)] ?? world.trees[0];
  if (!tree || tree.rootTips.length === 0) {
    return { gx: Math.floor(GRID.cols / 2), gy: 6 };
  }
  // Shallowest tip: the one nearest the surface, so the spore is not buried in
  // bedrock and still has soil above it to grow into.
  let best = tree.rootTips[0] as (typeof tree.rootTips)[number];
  for (const tip of tree.rootTips) {
    if (tip.gy < best.gy) best = tip;
  }
  const gx = Math.max(6, Math.min(GRID.cols - 6, best.gx - 5));
  const gy = Math.max(5, Math.min(GRID.rows - 20, best.gy - 3));
  return { gx, gy };
}
