/**
 * One real crossing, and the resources that travel it (`MAP-07`, stage 3-4).
 *
 * This is a *fixture*, not a claim that the region has become volumetric. It
 * holds one horizontal `y` constant and grows a single funded colony from one
 * east-west (or north-south) neighbour into the next, across the real shared
 * edge, through the region's real soil volume.
 *
 * What it is here to prove:
 *
 * - **One body.** Crossing a boundary changes a node's stand bucket. It does not
 *   found a colony, mint a root, or split the graph. There is one `Network`, one
 *   `MAX_NODES` budget and one set of stores on both sides of the seam.
 * - **One economy.** Growth, harvest, transport, decay and tree trade are the
 *   same functions `Simulation` runs for a single stand (`stepNetwork`, and the
 *   shared tree-demand rules in `network.ts`). Nothing here re-implements them;
 *   the only new code is the region-aware world lookup they are handed.
 * - **One soil record.** Every material query goes to `SoilVolume` at global
 *   coordinates, so the destination ground is consumed once, by whichever stand
 *   the strand happens to be standing in.
 *
 * The fixed phase order per tick is: regional environment; then, per colony in
 * stable id order, tree demand and trade, the network's own pipeline
 * (connectivity, intake, transport, respiration, growth, decay, fruiting,
 * totals), and finally activation of any stand the colony has just reached.
 * Nothing in it reads a camera, a view or a render origin.
 */
import { GRID, SEASONS, SPECIES, type Season, type Stratum } from './content';
import { STAND_SIZE, createRegion, type Region, type StandSite } from './region';
import { hashString, mulberry32 } from './rng';
import { SoilVolume, seasonalWaterTableOffsetCm } from './soil-volume';
import {
  bondedJunction,
  createNetwork,
  drawTreeDemand,
  holdsAnyBond,
  markConnectivity,
  orderWaypoint,
  starveBondedTree,
  stepNetwork,
  tryBond,
  updateTotals,
  type HyphaNode,
  type Network,
} from './network';
import {
  createStandWorld,
  entryCostFor,
  rowAtDepthCm,
  rowDepthCm,
  type NetworkWorld,
  type NodePosition,
  type PositionedNode,
  type SoilCell,
  type Tree,
  type World,
} from './world';
import {
  elevationAtDepthCm,
  hashParts,
  planePoint,
  rootTipSectionPosition,
  standFrameOf,
  standIdAt,
  vec3,
  type ColonyId,
  type SectionPlane,
  type StandFrame,
  type StandId,
  type TreeRef,
  type Vec3,
} from './spatial';

export type CrossingDirection = 'east' | 'west' | 'north' | 'south';

export interface CrossingOptions {
  seedText?: string;
  /** Stand the funded colony begins in. Defaults to the region's founding stand. */
  originStandId?: StandId;
  /** Which neighbour the colony grows into. Defaults to the first that works. */
  direction?: CrossingDirection;
  /** Columns between the funded strand and the shared edge. */
  runUpColumns?: number;
  /** Columns to keep growing past the seam before the order is done. */
  reachColumns?: number;
  /** What the funded colony starts with. Deliberately generous. */
  kit?: { carbon: number; water: number; nitrogen: number };
}

/** A stand whose local ecology the colony has reached. */
export interface CrossingStand {
  readonly site: StandSite;
  /** The stand's own soil, trees and (later) its rival. */
  readonly world: World;
  /** Index of this stand's first tree in the colony's flat tree table. */
  readonly treeBase: number;
  /** Simulation time the colony first stood here, or null if it never did. */
  activatedAt: number | null;
}

/** A seam crossing read straight off the real graph: not a node, not a store. */
export interface CrossingPortal {
  nodeId: number;
  parentId: number;
  standId: StandId;
  parentStandId: StandId;
  edge: CrossingDirection;
  /** The seam coordinate the parent's edge actually crossed. */
  seam: number;
  at: NodePosition;
}

export interface ColonyView {
  readonly id: ColonyId;
  readonly net: Network;
  readonly view: CrossingWorldView;
}

const DEFAULT_KIT = { carbon: 260, water: 8, nitrogen: 5 };

/**
 * The colony's view of the region: one flat tree table, and soil lookups that
 * resolve a strand's growth-plane cell to the region's own voxel.
 */
export class CrossingWorldView implements NetworkWorld {
  /** Every tree of every reached stand, in activation order. */
  readonly trees: Tree[] = [];
  rainfall = 1;

  private readonly refs: TreeRef[] = [];
  private readonly reached = new Set<StandId>();
  private readonly match: CrossingMatch;

  constructor(match: CrossingMatch) {
    this.match = match;
  }

  treeRefAt(index: number): TreeRef | null {
    return this.refs[index] ?? null;
  }

  standOfTree(tree: Tree): StandId | null {
    const index = this.trees.indexOf(tree);
    return index < 0 ? null : (this.refs[index]?.standId ?? null);
  }

  /** Called once per reached stand: its partners join the colony's table. */
  activate(site: StandSite, world: World): void {
    if (this.reached.has(site.id)) return;
    this.reached.add(site.id);
    for (const tree of world.trees) {
      this.refs.push({ standId: site.id, treeId: tree.id });
      this.trees.push(tree);
    }
  }

  cellFrom(node: PositionedNode, dx: number, dy: number): SoilCell | null {
    const voxel = this.match.voxelOf(node, dx, dy);
    if (!voxel) return null;
    return this.match.soil.readMaterialAt(voxel.x, voxel.y, voxel.z);
  }

  cellOf(node: PositionedNode): SoilCell | null {
    const voxel = this.match.voxelOf(node, 0, 0);
    if (!voxel) return null;
    return this.match.soil.materialAt(voxel.x, voxel.y, voxel.z);
  }

  passableFrom(node: PositionedNode, dx: number, dy: number): boolean {
    const from = this.match.voxelOf(node, 0, 0);
    const to = this.match.voxelOf(node, dx, dy);
    if (!from || !to) return false;
    // Every voxel the step crosses is tested, so a two-column step cannot
    // tunnel through a stand corner, thin stone or the stream.
    if (dx === 0 && dy === 0) {
      return this.match.soil.passableAt(from.x, from.y, from.z);
    }
    return !this.match.soil.segment(from, to).blocked;
  }

  costFrom(node: PositionedNode, dx: number, dy: number): { cost: number; stratum: Stratum } {
    const voxel = this.match.voxelOf(node, dx, dy);
    if (!voxel) return entryCostFor(null);
    return entryCostFor(this.match.soil.readMaterialAt(voxel.x, voxel.y, voxel.z));
  }

  nodePosition(node: PositionedNode): NodePosition {
    return this.match.nodePosition(node);
  }

  rootTipPosition(tree: Tree, tip: { gx: number; gy: number }): NodePosition {
    const standId = this.standOfTree(tree) ?? this.match.originStandId;
    return this.match.rootTipPosition(standId, tip);
  }

  /** A strand that has arrived in a new square is filed under that square. */
  commit(node: PositionedNode): void {
    this.match.rebucket(node);
  }
}

export class CrossingMatch {
  readonly region: Region;
  readonly soil: SoilVolume;
  readonly direction: CrossingDirection;
  readonly originStandId: StandId;
  readonly destinationStandId: StandId;
  readonly plane: SectionPlane;
  readonly depthCm: number;
  readonly depthRow: number;
  readonly seam: number;
  readonly runUpColumns: number;
  readonly reachColumns: number;
  readonly colonyId: ColonyId;
  readonly colony: Network;
  readonly stands: CrossingStand[] = [];
  readonly events: string[] = [];
  time = 0;
  seasonIndex = 0;
  seasonClock = 0;

  private readonly view: CrossingWorldView;
  private readonly sign: 1 | -1;
  private readonly alongIsX: boolean;
  private readonly siteById = new Map<StandId, CrossingStand>();

  constructor(options: CrossingOptions = {}) {
    const seedText = options.seedText ?? 'raven-wood';
    this.region = createRegion(seedText);
    this.soil = new SoilVolume(this.region, hashString(`${seedText}:soil`));
    this.runUpColumns = options.runUpColumns ?? 8;
    this.reachColumns = options.reachColumns ?? 4;

    const chosen = chooseCrossing(this.region, this.soil, options.originStandId ?? this.region.foundingStand, options.direction);
    this.originStandId = chosen.originStandId;
    this.destinationStandId = chosen.destinationStandId;
    this.direction = chosen.direction;
    this.alongIsX = chosen.alongIsX;
    this.sign = chosen.sign;
    this.plane = { along: this.alongIsX ? 'x' : 'y', fixed: chosen.fixed };
    // Report the depth the chosen row actually sits at, so the fixture's own
    // numbers and the growth plane's rows cannot disagree.
    this.depthRow = rowAtDepthCm(chosen.depthCm);
    this.depthCm = rowDepthCm(this.depthRow);
    this.seam = chosen.seam;

    this.view = new CrossingWorldView(this);
    this.colonyId = `player@${seedText}`;
    const seed = hashString(`${seedText}:crossing`);
    const startColumn = this.columnAt(chosen.seam) - this.sign * this.runUpColumns;
    const kit = options.kit ?? DEFAULT_KIT;
    this.colony = createNetwork(
      'player',
      'the colony',
      startColumn,
      this.depthRow,
      mulberry32(seed ^ 0x4c0f),
      kit.carbon,
      { water: kit.water, nitrogen: kit.nitrogen }
    );
    updateTotals(this.colony);
    // The colony's growth plane is the whole region, not one stand's transect.
    this.colony.bounds = { cols: this.region.cols * STAND_SIZE, rows: GRID.rows };
    // The funded strand belongs to the origin stand, and carries the section's
    // fixed coordinate from the moment it exists.
    for (const node of this.colony.nodes) {
      node.y = this.plane.fixed;
      node.standId = this.originStandId;
    }
    this.activate(this.originStandId, 'The colony wakes beside the shared edge.');
  }

  /** The colony's own view: the world every network call is given. */
  get world(): CrossingWorldView {
    return this.view;
  }

  get season(): Season {
    return SEASONS[this.seasonIndex % SEASONS.length] as Season;
  }

  get colonies(): ColonyView[] {
    // One colony today, still sorted by stable id: the phase order must not
    // depend on which stand happened to be iterated first.
    return [{ id: this.colonyId, net: this.colony, view: this.view }]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  /** The along-axis coordinate of a growth-plane column. */
  columnAt(along: number): number {
    return Math.round(along);
  }

  /** A point on the section plane, from an along-axis coordinate. */
  planePointAt(along: number): { x: number; y: number } {
    return planePoint(this.plane, along);
  }

  /**
   * The voxel a growth-plane cell addresses.
   *
   * `gy` stays a depth row, exactly as it is on the flat transect; `dx` moves
   * along the section's axis, which is what lets one graph cross a stand edge
   * without changing any other coordinate.
   */
  voxelOf(node: PositionedNode, dx: number, dy: number): Vec3 | null {
    const row = node.gy + dy;
    if (!Number.isFinite(row) || row < 0 || row >= GRID.rows) return null;
    const point = this.planePointAt(node.gx + dx + 0.5);
    if (standIdAt(this.region, point.x, point.y) === null) return null;
    const depth = rowDepthCm(row);
    return vec3(point.x, point.y, elevationAtDepthCm(this.region, point.x, point.y, depth));
  }

  nodePosition(node: PositionedNode): NodePosition {
    const point = this.planePointAt(node.wx);
    const depth = rowDepthCm(node.wy);
    return {
      x: point.x,
      y: point.y,
      z: elevationAtDepthCm(this.region, point.x, point.y, depth),
    };
  }

  rootTipPosition(standId: StandId, tip: { gx: number; gy: number }): NodePosition {
    const frame = standFrameOf(this.region, standId);
    if (!frame) return { x: this.plane.fixed, y: this.plane.fixed, z: 0 };
    const point = rootTipSectionPosition(tip, this.region, frame, this.plane);
    return { x: point.x, y: point.y, z: point.z };
  }

  standFrame(standId: StandId): StandFrame | null {
    return standFrameOf(this.region, standId);
  }

  standOf(node: PositionedNode): StandId | null {
    const point = this.planePointAt(node.gx + 0.5);
    return standIdAt(this.region, point.x, point.y);
  }

  /** Re-file a strand into the square its new position belongs to. */
  rebucket(node: PositionedNode): void {
    const standId = this.standOf(node);
    if (standId === null) return;
    const changed = node.standId !== standId;
    node.standId = standId;
    if (changed && !this.siteById.has(standId)) {
      this.activate(standId, `The colony reaches the ${this.region.stands[standId]?.community.replace(/-/g, ' ')}.`);
    }
  }

  // -------------------------------------------------------------------------
  // Reached stands
  // -------------------------------------------------------------------------

  stand(standId: StandId): CrossingStand | null {
    return this.siteById.get(standId) ?? null;
  }

  nodesInStand(standId: StandId): HyphaNode[] {
    return this.colony.nodes.filter((node) => node.alive && node.standId === standId);
  }

  /** Graph edges that genuinely cross a seam, derived from parent links. */
  portals(): CrossingPortal[] {
    const portals: CrossingPortal[] = [];
    for (const node of this.colony.nodes) {
      if (!node.alive || node.parent < 0) continue;
      const parent = this.colony.nodes[node.parent];
      if (!parent || !parent.alive || parent.standId === node.standId) continue;
      if (parent.standId < 0 || node.standId < 0) continue;
      portals.push({
        nodeId: node.id,
        parentId: parent.id,
        standId: node.standId,
        parentStandId: parent.standId,
        edge: this.direction,
        seam: this.seam,
        at: this.nodePosition(node),
      });
    }
    return portals;
  }

  private activate(standId: StandId, note: string): void {
    if (this.siteById.has(standId)) return;
    const site = this.region.stands[standId];
    if (!site) return;
    const world = createStandWorld(site.seed, {
      waterTableCm: site.waterTableCm,
      mix: undefined,
      stream: site.stream,
    });
    const stand: CrossingStand = { site, world, treeBase: this.view.trees.length, activatedAt: this.time };
    this.stands.push(stand);
    this.siteById.set(standId, stand);
    this.view.activate(site, world);
    this.log(`${note} (${this.stands.length} stand${this.stands.length === 1 ? '' : 's'} held)`);
  }

  /** Any stand the colony now stands in, activated for the next tick. */
  private activateReached(): void {
    for (const node of this.colony.nodes) {
      if (!node.alive) continue;
      const standId = this.standOf(node);
      if (standId === null) continue;
      node.standId = standId;
      if (!this.siteById.has(standId)) {
        this.activate(standId, `The colony reaches the ${this.region.stands[standId]?.community.replace(/-/g, ' ')}.`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  /** Send the frontier across the shared edge, and only just across it. */
  orderAcross(): { ok: boolean; message: string } {
    if (this.portals().length > 0) {
      return { ok: false, message: 'The colony already stands in both stands.' };
    }
    const target = this.columnAt(this.seam) + this.sign * this.reachColumns;
    orderWaypoint(this.colony, target, this.depthRow, this.view);
    return { ok: true, message: `Frontier directed across the seam to column ${target}.` };
  }

  /** Send the frontier toward one tree's root tip, for a remote bond. */
  orderTowardTip(treeRef: TreeRef, tipId: number): { ok: boolean; message: string } {
    const index = this.treeIndex(treeRef);
    const tree = index < 0 ? null : (this.view.trees[index] as Tree);
    const tip = tree?.rootTips[tipId];
    if (!tree || !tip) return { ok: false, message: 'No such root tip.' };
    // A root tip's `gx` is a column inside its own stand; the colony's growth
    // plane counts across the whole region, so the order has to be translated.
    orderWaypoint(this.colony, this.alongOfTip(treeRef.standId, tip), tip.gy, this.view);
    return { ok: true, message: `Frontier directed to a root tip of tree ${treeRef.treeId}.` };
  }

  /** Growth-plane column of a root tip that belongs to a stand. */
  alongOfTip(standId: StandId, tip: { gx: number }): number {
    const frame = standFrameOf(this.region, standId);
    if (!frame) return tip.gx;
    return (this.plane.along === 'x' ? frame.originX : frame.originY) + tip.gx;
  }

  /** Index of a tree in the colony's flat table, or -1. */
  treeIndex(treeRef: TreeRef): number {
    for (let i = 0; i < this.view.trees.length; i++) {
      const ref = this.view.treeRefAt(i);
      if (ref && ref.standId === treeRef.standId && ref.treeId === treeRef.treeId) return i;
    }
    return -1;
  }

  /** Try to bond one root tip of one reached stand's tree. */
  bond(treeRef: TreeRef, tipId: number, reachCm = 3.5 * GRID.cmPerRow): { ok: boolean; message: string } {
    const index = this.treeIndex(treeRef);
    if (index < 0) return { ok: false, message: 'That tree is not in a stand the colony has reached.' };
    const tree = this.view.trees[index] as Tree;
    if (tree.dead) return { ok: false, message: 'That tree is dead.' };
    const tip = tree.rootTips[tipId];
    if (!tip) return { ok: false, message: 'No such root tip.' };
    if (tip.bondedTo !== null) {
      return { ok: false, message: 'That root tip is already bonded.' };
    }
    if (!tryBond(this.colony, this.view, index, tipId, reachCm)) {
      return { ok: false, message: 'No strand of mine is close enough to that root.' };
    }
    this.log(`A strand bonds with a ${SPECIES[tree.species].common} in the ${this.region.stands[treeRef.standId]?.community.replace(/-/g, ' ')}.`);
    return { ok: true, message: `Bonded to tree ${treeRef.treeId}.` };
  }

  /**
   * The nearest unbonded root tip of a reached stand to a colony node.
   *
   * `exclude` lets a caller that has already tried a tip - because stone or
   * saturation proved it unreachable - ask for the next one instead of being
   * handed the same answer forever.
   */
  nearestUnbondedTip(
    standId: StandId,
    exclude?: Set<string>
  ): { treeRef: TreeRef; tipId: number; distanceCm: number } | null {
    let best: { treeRef: TreeRef; tipId: number; distanceCm: number } | null = null;
    for (let index = 0; index < this.view.trees.length; index++) {
      const ref = this.view.treeRefAt(index);
      if (!ref || ref.standId !== standId) continue;
      const tree = this.view.trees[index] as Tree;
      if (tree.dead) continue;
      for (const tip of tree.rootTips) {
        if (tip.bondedTo !== null) continue;
        if (exclude?.has(`${ref.treeId}:${tip.id}`)) continue;
        const target = this.rootTipPosition(standId, tip);
        for (const node of this.colony.nodes) {
          if (!node.alive || !node.connected) continue;
          if (node.standId !== standId) continue;
          const here = this.nodePosition(node);
          const distanceCm = Math.hypot(
            (here.x - target.x) * GRID.cmPerRow,
            (here.y - target.y) * GRID.cmPerRow,
            (here.z - target.z) * GRID.cmPerRow
          );
          if (!best || distanceCm < best.distanceCm) best = { treeRef: ref, tipId: tip.id, distanceCm };
        }
      }
    }
    return best;
  }

  /** Cut a strand: the seam's only surviving link, for severance checks. */
  cut(nodeId: number): boolean {
    const node = this.colony.nodes[nodeId];
    if (!node || !node.alive || node.parent < 0) return false;
    node.alive = false;
    node.health = 0;
    if (node.isTip) this.colony.tipCount = Math.max(0, this.colony.tipCount - 1);
    this.log(`A strand in the ${this.region.stands[node.standId]?.community.replace(/-/g, ' ')} is cut.`);
    return true;
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  private advanceClock(dt: number): void {
    this.seasonClock += dt;
    for (let guard = 0; guard < 8; guard++) {
      const current = this.season;
      if (this.seasonClock < current.seconds) return;
      this.seasonClock -= current.seconds;
      this.seasonIndex++;
    }
  }

  step(dt: number): void {
    this.advanceClock(dt);
    const season = this.season;
    this.view.rainfall = season.rain;
    // 1. The regional environment, once, for every stand at once.
    this.soil.step(dt, {
      rainfall: season.rain,
      litterfall: season.litterfall,
      waterTableOffsetCm: seasonalWaterTableOffsetCm(season.rain),
    });
    // 2. Per colony, in stable id order.
    for (const colony of this.colonies) {
      markConnectivity(colony.net);
      this.tradeTrees(colony, dt);
      stepNetwork(colony.net, {
        world: colony.view,
        light: season.light,
        warmth: season.warmth,
        rival: null,
        time: this.time,
        log: (text) => this.log(text),
        dt,
      });
      this.activateReached();
    }
    this.time += dt;
  }

  /** Trees drink from their junctions; a short one stops being patient. */
  private tradeTrees(colony: ColonyView, dt: number): void {
    for (const stand of [...this.stands].sort((a, b) => a.site.id - b.site.id)) {
      for (const tree of stand.world.trees) {
        if (tree.dead) continue;
        const junction = bondedJunction(colony.net, tree);
        const bonded = holdsAnyBond(tree);
        if (junction) {
          if (drawTreeDemand(tree, junction, SPECIES[tree.species], dt)) {
            this.severBond(colony, tree, 'stopped supplying');
          }
        } else if (bonded && starveBondedTree(tree, dt)) {
          this.severBond(colony, tree, 'lost the strand that fed it');
        }
      }
    }
  }

  private severBond(colony: ColonyView, tree: Tree, reason: string): void {
    let severed = false;
    for (const tip of tree.rootTips) {
      if (tip.bondedTo === null) continue;
      const node = colony.net.nodes[tip.bondedTo];
      if (node) {
        node.bondedTree = -1;
        node.bondedRootTip = -1;
        node.pulse = 1;
      }
      tip.bondedTo = null;
      severed = true;
    }
    if (severed) {
      this.log(`${SPECIES[tree.species].common} severed its bond - it ${reason}.`);
    }
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  log(text: string): void {
    this.events.push(`${this.time.toFixed(1)}s ${text}`);
    if (this.events.length > 40) this.events.shift();
  }

  totals(): { carbon: number; water: number; nitrogen: number; living: number } {
    let carbon = 0;
    let water = 0;
    let nitrogen = 0;
    let living = 0;
    for (const node of this.colony.nodes) {
      if (!node.alive) continue;
      living++;
      carbon += node.carbon;
      water += node.water;
      nitrogen += node.nitrogen;
    }
    return { carbon, water, nitrogen, living };
  }

  hash(): string {
    const parts: Array<string | number> = [this.colonyId, this.colony.nodes.length, this.colony.fruited];
    for (const node of this.colony.nodes) {
      parts.push(
        node.id,
        node.parent,
        node.gx,
        node.gy,
        node.standId,
        node.alive ? 1 : 0,
        node.connected ? 1 : 0,
        node.carbon,
        node.water,
        node.nitrogen
      );
    }
    parts.push(this.soil.hash(), this.time);
    return hashParts(parts);
  }

  report(): string[] {
    const totals = this.totals();
    const lines = [
      `Crossing: stand ${this.originStandId} -> ${this.destinationStandId} (${this.direction}), ` +
        `plane ${this.plane.along} = ${this.plane.fixed.toFixed(1)}, depth ${this.depthCm} cm`,
      `colony ${this.colonyId}: ${totals.living} living strands, ` +
        `carbon ${totals.carbon.toFixed(1)}, water ${totals.water.toFixed(1)}, mineral ${totals.nitrogen.toFixed(1)}`,
      `stands held: ${this.stands.map((stand) => `${stand.site.id} (${this.nodesInStand(stand.site.id).length} strands)`).join(', ') || 'none'}`,
      `seam crossings: ${this.portals().length}; changed soil voxels: ${this.soil.materializedCount}`,
    ];
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Choosing a corridor
// ---------------------------------------------------------------------------

interface Corridor {
  originStandId: StandId;
  destinationStandId: StandId;
  direction: CrossingDirection;
  alongIsX: boolean;
  sign: 1 | -1;
  fixed: number;
  seam: number;
  depthCm: number;
}

const DIRECTIONS: Array<{ direction: CrossingDirection; alongIsX: boolean; sign: 1 | -1 }> = [
  { direction: 'east', alongIsX: true, sign: 1 },
  { direction: 'south', alongIsX: false, sign: 1 },
  { direction: 'west', alongIsX: true, sign: -1 },
  { direction: 'north', alongIsX: false, sign: -1 },
];

/**
 * Find the first adjacent pair and section plane with a genuinely passable
 * corridor between them.
 *
 * The fixture refuses to invent a crossing: if no plane carries soil a hypha
 * could use across the whole run, it keeps looking, and throws rather than
 * teleporting the colony past water or stone.
 */
function chooseCrossing(
  region: Region,
  soil: SoilVolume,
  from: StandId,
  preferred?: CrossingDirection
): Corridor {
  const order = preferred
    ? [...DIRECTIONS.filter((entry) => entry.direction === preferred), ...DIRECTIONS.filter((entry) => entry.direction !== preferred)]
    : DIRECTIONS;
  // Depths a root system would actually use, shallowest first.
  const depths = [22, 26, 18, 30, 16, 34];
  for (const entry of order) {
    for (const candidate of standPairs(region, from, entry)) {
      const fixedCandidates = fixedScan(candidate.originFrame, candidate.alongIsX);
      for (const depthCm of depths) {
        for (const fixed of fixedCandidates) {
          const inside = candidate.seam - candidate.sign * 12;
          const beyond = candidate.seam + candidate.sign * 12;
          const plane: SectionPlane = { along: candidate.alongIsX ? 'x' : 'y', fixed };
          const a = planePoint(plane, inside);
          const b = planePoint(plane, beyond);
          const from_ = vec3(a.x, a.y, elevationAtDepthCm(region, a.x, a.y, depthCm));
          const to = vec3(b.x, b.y, elevationAtDepthCm(region, b.x, b.y, depthCm));
          if (!soil.segment(from_, to).blocked) {
            return {
              originStandId: candidate.originStandId,
              destinationStandId: candidate.destinationStandId,
              direction: entry.direction,
              alongIsX: candidate.alongIsX,
              sign: candidate.sign,
              fixed,
              seam: candidate.seam,
              depthCm,
            };
          }
        }
      }
    }
  }
  throw new Error('crossing: no adjacent stand pair has a passable corridor at any tested depth');
}

interface StandPair {
  originStandId: StandId;
  destinationStandId: StandId;
  originFrame: StandFrame;
  alongIsX: boolean;
  sign: 1 | -1;
  seam: number;
}

function standPairs(region: Region, from: StandId, entry: { alongIsX: boolean; sign: 1 | -1 }): StandPair[] {
  const frame = standFrameOf(region, from);
  if (!frame) return [];
  const dx = entry.alongIsX ? entry.sign : 0;
  const dy = entry.alongIsX ? 0 : entry.sign;
  const sx = frame.sx + dx;
  const sy = frame.sy + dy;
  const seam = entry.alongIsX
    ? entry.sign > 0
      ? frame.originX + STAND_SIZE
      : frame.originX
    : entry.sign > 0
      ? frame.originY + STAND_SIZE
      : frame.originY;
  if (sx < 0 || sy < 0 || sx >= region.cols || sy >= region.rows) return [];
  const destinationStandId = sy * region.cols + sx;
  return [{
    originStandId: from,
    destinationStandId,
    originFrame: frame,
    alongIsX: entry.alongIsX,
    sign: entry.sign,
    seam,
  }];
}

/** Section planes across the square, ordered outward from its middle. */
function fixedScan(frame: StandFrame, alongIsX: boolean): number[] {
  // East/west growth browses a plane of constant y; north/south of constant x.
  const origin = alongIsX ? frame.originY : frame.originX;
  const out: number[] = [];
  const half = STAND_SIZE / 2;
  for (let step = 0; step < half - 6; step += 2) {
    const centre = origin + half + 0.5;
    for (const candidate of [centre + step, centre - step]) {
      if (candidate <= origin + 2 || candidate >= origin + STAND_SIZE - 2) continue;
      if (!out.includes(candidate)) out.push(candidate);
    }
  }
  return out;
}
