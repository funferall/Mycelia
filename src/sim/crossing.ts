/**
 * One real crossing, and the resources that travel it (`MAP-07`, stage 3-4).
 *
 * The funded fixture and the running match use this same corridor coordinator.
 * The funded fixture holds one narrow lane for focused crossing checks. In a
 * running match, the opening body's node addresses and XYZ stay unchanged at
 * promotion, then its frontier may enter any passable neighbouring 3D voxel.
 *
 * What it is here to prove:
 *
 * - **One body.** Crossing a boundary changes a node's stand bucket. It does not
 *   found a colony, mint a root, or split the graph. There is one `Network`, one
 *   tip allowance and one set of stores on both sides of the seam.
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
import { ECON, GRID, SEASONS, SPECIES, type Season, type Stratum } from './content';
import { STAND_SIZE, createRegion, type Region, type StandSite } from './region';
import { hashString, mulberry32 } from './rng';
import { SoilVolume, seasonalWaterTableOffsetCm } from './soil-volume';
import {
  bondedJunction,
  createNetwork,
  drawTreeDemand,
  holdsAnyBond,
  markConnectivity,
  makeCord,
  cordRoute,
  layCord,
  nearestNode,
  orderWaypoint,
  startFruiting,
  starveBondedTree,
  stepNetwork,
  tryBond,
  updateTotals,
  createGroupWhere,
  dissolveGroup,
  type HyphaNode,
  type Network,
} from './network';
import { forEachMovedStrand, heldBy, markStrandsStale, releaseStrands, strandsCurrent } from './segments';
import {
  ASH_FRUIT_SPEED,
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
  neighbourStand,
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
  colonyId?: ColonyId;
  /** Running-match integration: use its region, colony, and persistent trees. */
  region?: Region;
  soil?: SoilVolume;
  /** Keep the opening transect and promoted graph on the same soil slice. */
  corridor?: CrossingCorridor;
  /** Preserve the opening body's recorded XYZ positions and grow in 3D. */
  regionalCoordinates?: boolean;
  colony?: Network;
  worldForStand?: (standId: StandId) => World;
  onActivate?: (standId: StandId, fromStandId: StandId | null) => void;
  initialTime?: number;
  initialSeasonIndex?: number;
  initialSeasonClock?: number;
  /** Stand the funded colony begins in. Defaults to the region's founding stand. */
  originStandId?: StandId;
  /** Which neighbour the colony grows into. Defaults to the first that works. */
  direction?: CrossingDirection;
  /** Columns between the funded strand and the shared edge. */
  runUpColumns?: number;
  /** Columns to keep growing past the seam before the order is done. */
  reachColumns?: number;
  /**
   * How far one arrival may shift a strand across the section plane, and the
   * spread that shift is allowed to reach. The fixture holds one plane constant
   * so the first crossing stays small; this is what gives the body a little
   * thickness in the third axis, so neighbouring sections are not all empty.
   */
  laneDrift?: number;
  laneSpread?: number;
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

/**
 * One strand of the colony, as the region sees it: a parent and a child node
 * with real XYZ endpoints. Sections and the forest reveal both read the body
 * through this, so a drawn strand and a simulated strand cannot disagree.
 */
export interface ColonyEdge {
  readonly key: string;
  readonly parent: number;
  readonly child: number;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly thickness: number;
  readonly reinforced: boolean;
  readonly connected: boolean;
  readonly standId: StandId;
  readonly parentStandId: StandId;
}

const DEFAULT_KIT = { carbon: 260, water: 8, nitrogen: 5 };
const DEFAULT_LANE_DRIFT = 1.2;
const DEFAULT_LANE_SPREAD = 14;

/**
 * The colony's view of the region: one flat tree table, and soil lookups that
 * resolve a strand's growth-plane cell to the region's own voxel.
 */
export class CrossingWorldView implements NetworkWorld {
  /** Every tree of every reached stand, in activation order. */
  readonly trees: Tree[] = [];
  rainfall = 1;
  readonly spatialGrowth: boolean;

  private readonly refs: TreeRef[] = [];
  private readonly reached = new Set<StandId>();
  private readonly match: CrossingMatch;

  constructor(match: CrossingMatch) {
    this.match = match;
    this.spatialGrowth = match.regionalCoordinates;
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

  cellFrom(node: PositionedNode, dx: number, dy: number, lateral = 0): SoilCell | null {
    const voxel = this.match.voxelOf(node, dx, dy, lateral);
    if (!voxel) return null;
    return this.match.soil.readMaterialAt(voxel.x, voxel.y, voxel.z);
  }

  cellOf(node: PositionedNode): SoilCell | null {
    const voxel = this.match.voxelOf(node, 0, 0);
    if (!voxel) return null;
    return this.match.soil.materialAt(voxel.x, voxel.y, voxel.z);
  }

  passableFrom(node: PositionedNode, dx: number, dy: number, lateral = 0): boolean {
    const from = this.match.voxelOf(node, 0, 0);
    const to = this.match.voxelOf(node, dx, dy, lateral);
    if (!from || !to) return false;
    if (this.match.regionalCoordinates) {
      const start = standIdAt(this.match.region, from.x, from.y);
      const end = standIdAt(this.match.region, to.x, to.y);
      const a = start === null ? null : standFrameOf(this.match.region, start);
      const b = end === null ? null : standFrameOf(this.match.region, end);
      // A single node cannot skip the two orthogonal stands touching a corner.
      if (a && b && a.sx !== b.sx && a.sy !== b.sy) return false;
    }
    // Every voxel the step crosses is tested, so a two-column step cannot
    // tunnel through a stand corner, thin stone or the stream.
    if (dx === 0 && dy === 0 && lateral === 0) {
      return this.match.soil.passableAt(from.x, from.y, from.z);
    }
    return !this.match.soil.segment(from, to).blocked;
  }

  costFrom(node: PositionedNode, dx: number, dy: number, lateral = 0): { cost: number; stratum: Stratum } {
    const voxel = this.match.voxelOf(node, dx, dy, lateral);
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
    if (this.match.regionalCoordinates) {
      (node as HyphaNode).spatial = this.match.nodePosition(node);
      this.match.rebucket(node);
      return;
    }
    this.match.rebucket(node);
    // Arriving is also when a strand may step across the plane, giving the
    // fixture a body with some thickness instead of a single sheet.
    this.match.driftLane(node as PositionedNode & { id: number });
  }
}

export class CrossingMatch {
  readonly region: Region;
  readonly soil: SoilVolume;
  readonly regionalCoordinates: boolean;
  readonly direction: CrossingDirection;
  readonly originStandId: StandId;
  /** Regional x of the founding stand; node columns remain relative to it. */
  readonly originX: number;
  readonly destinationStandId: StandId;
  readonly plane: SectionPlane;
  readonly depthCm: number;
  readonly depthRow: number;
  readonly seam: number;
  readonly runUpColumns: number;
  readonly reachColumns: number;
  /** Per-arrival drift across the plane, and how far it may wander. */
  readonly laneDrift: number;
  readonly laneSpread: number;
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
  private readonly worldForStand?: (standId: StandId) => World;
  private readonly onActivate?: (standId: StandId, fromStandId: StandId | null) => void;

  constructor(options: CrossingOptions = {}) {
    const seedText = options.seedText ?? 'raven-wood';
    // A standalone bench keeps the earlier single best start (`StartRule`).
    this.region = options.region ?? createRegion(seedText, undefined, undefined, 'best');
    this.soil = options.soil ?? new SoilVolume(this.region, hashString(`${seedText}:soil`));
    this.regionalCoordinates = options.regionalCoordinates ?? false;
    this.worldForStand = options.worldForStand;
    this.onActivate = options.onActivate;
    this.time = options.initialTime ?? 0;
    this.seasonIndex = options.initialSeasonIndex ?? 0;
    this.seasonClock = options.initialSeasonClock ?? 0;
    this.runUpColumns = options.runUpColumns ?? 8;
    this.reachColumns = options.reachColumns ?? 4;
    this.laneDrift = options.laneDrift ?? DEFAULT_LANE_DRIFT;
    this.laneSpread = options.laneSpread ?? DEFAULT_LANE_SPREAD;

    const chosen = options.corridor ?? chooseCrossing(this.region, this.soil, options.originStandId ?? this.region.foundingStand, options.direction);
    this.originStandId = chosen.originStandId;
    const frame = standFrameOf(this.region, this.originStandId);
    if (!frame) throw new Error('crossing: invalid origin stand');
    this.originX = frame.originX;
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
    this.colonyId = options.colonyId ?? `player@${seedText}`;
    const seed = hashString(`${seedText}:crossing`);
    const startColumn = this.regionalCoordinates
      ? (this.alongIsX ? chosen.seam - this.originX - this.sign * this.runUpColumns : chosen.fixed - this.originX)
      : this.columnAt(chosen.seam) - this.sign * this.runUpColumns;
    const kit = options.kit ?? DEFAULT_KIT;
    this.colony = options.colony ?? createNetwork(
      'player',
      'the colony',
      startColumn,
      this.depthRow,
      mulberry32(seed ^ 0x4c0f),
      kit.carbon,
      { water: kit.water, nitrogen: kit.nitrogen }
    );
    this.colony.colonyId = this.colonyId;
    updateTotals(this.colony);
    // The colony's growth plane is the whole region, not one stand's transect.
    this.colony.bounds = this.regionalCoordinates
      ? { minCol: -this.originX, cols: this.region.cols * STAND_SIZE - this.originX, rows: GRID.rows }
      : { cols: (this.alongIsX ? this.region.cols : this.region.rows) * STAND_SIZE, rows: GRID.rows };
    // The running body's local columns and recorded XYZ have existed since the
    // founding spore. Promotion keeps every node address unchanged.
    const offset = options.colony && frame ? (this.alongIsX ? frame.originX : frame.originY) : 0;
    if (this.regionalCoordinates && options.colony) {
      const projection = this.worldForStand?.(this.originStandId)?.regionalSoil;
      if (!projection) throw new Error('crossing: running colony has no regional soil projection');
      for (const node of this.colony.nodes) {
        const position = node.spatial;
        if (!position) throw new Error(`crossing: node ${node.id} has no opening XYZ position`);
        if (Math.abs(this.originX + node.wx - position.x) > 1e-8 ||
          Math.abs(node.lateral - position.y) > 1e-8) {
          throw new Error(`crossing: node ${node.id} disagrees with its recorded XYZ position`);
        }
      }
      for (const waypoint of this.colony.waypoints) {
        const point = projection.pointAt(waypoint.gx, waypoint.gy);
        if (point) waypoint.lateral = point.y;
      }
      const fruitPoint = projection.pointAt(this.colony.fruit.gx, this.colony.fruit.gy);
      if (fruitPoint) this.colony.fruit.spatial = fruitPoint;
      for (const bloom of this.colony.blooms) {
        const point = projection.pointAt(bloom.gx, bloom.gy);
        if (point) bloom.spatial = point;
      }
    } else {
      for (const node of this.colony.nodes) {
        node.gx += offset;
        node.wx += offset;
        node.targetGx += offset;
        node.y = this.plane.fixed;
        node.lateral = node.y;
        node.targetLateral = node.y;
        node.standId = this.originStandId;
      }
      if (offset !== 0) {
        for (const waypoint of this.colony.waypoints) waypoint.gx += offset;
        this.colony.fruit.gx += offset;
        for (const bloom of this.colony.blooms) bloom.gx += offset;
      }
    }
    this.activate(this.originStandId, 'The colony wakes beside the shared edge.', null);
    if (options.colony && !this.regionalCoordinates) this.importOccupiedSoil(this.worldForStand?.(this.originStandId));
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
 * `gy` stays a depth row. A running colony's `gx` remains relative to its
 * founding stand, and its lateral coordinate is regional y. The fixture uses
 * its older two-dimensional section plane.
   */
  voxelOf(node: PositionedNode, dx: number, dy: number, lateral = 0): Vec3 | null {
    return this.voxelAt(node.gx + dx, node.y + lateral, node.gy + dy);
  }

  /** The voxel at one growth-plane cell, at an explicit across-plane position. */
  voxelAt(gx: number, lane: number, gy: number): Vec3 | null {
    if (!Number.isFinite(gy) || gy < 0 || gy >= GRID.rows) return null;
    const point = this.regionalCoordinates
      ? { x: this.originX + gx + 0.5, y: lane }
      : planePoint({ along: this.plane.along, fixed: lane }, gx + 0.5);
    if (standIdAt(this.region, point.x, point.y) === null) return null;
    const depth = rowDepthCm(gy);
    return vec3(point.x, point.y, elevationAtDepthCm(this.region, point.x, point.y, depth));
  }

  /**
   * Nudge a strand across the section plane as it arrives.
   *
   * The fixture's growth plane is two-dimensional, so without this every
   * strand sits on one plane and every other section is empty. The drift is
   * small, deterministic from the node's own id, capped, and refused whenever
   * the drifted ground could not hold a hypha - so it thickens the body without
   * walking a strand into stone or the stream.
   */
  driftLane(node: PositionedNode & { id: number }): void {
    if (this.laneDrift <= 0) return;
    const roll = this.laneHash(node.gx * 31 + node.gy * 7 + node.id * 0.37 + node.id);
    const step = (roll - 0.5) * 2 * this.laneDrift;
    const limit = this.laneSpread;
    const next = Math.max(this.plane.fixed - limit, Math.min(this.plane.fixed + limit, node.y + step));
    if (Math.abs(next - node.y) < 1e-9) return;
    const probe = this.voxelAt(node.gx, next, node.gy);
    if (!probe) return;
    if (this.soil.blockAt(probe.x, probe.y, probe.z).blocked) return;
    node.y = next;
  }

  /** Deterministic 0..1 from a node, so the drift never touches the colony RNG. */
  private laneHash(id: number): number {
    let h = (this.region.seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h ^ (h >>> 7), 0x27d4eb2d) >>> 0;
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  nodePosition(node: PositionedNode): NodePosition {
    if (this.regionalCoordinates) {
      const point = { x: this.originX + node.wx, y: node.lateral ?? node.y };
      return {
        x: point.x,
        y: point.y,
        z: elevationAtDepthCm(this.region, point.x, point.y, node.wy * GRID.cmPerRow),
      };
    }
    // The node carries its own across-plane coordinate: the fixture's colony
    // drifts a little in that axis as it grows, and the drawn position, the
    // clipped section and the projection all have to see the same lane.
    const point = planePoint({ along: this.plane.along, fixed: node.y }, node.wx);
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
    if (this.regionalCoordinates) {
      const point = this.worldForStand?.(standId)?.regionalSoil?.pointAt(tip.gx, tip.gy);
      if (point) return point;
    }
    const point = rootTipSectionPosition(tip, this.region, frame, this.plane);
    return { x: point.x, y: point.y, z: point.z };
  }

  standFrame(standId: StandId): StandFrame | null {
    return standFrameOf(this.region, standId);
  }

  standOf(node: PositionedNode): StandId | null {
    if (this.regionalCoordinates) return standIdAt(this.region, this.originX + node.gx + 0.5, node.y);
    const point = planePoint({ along: this.plane.along, fixed: node.y }, node.gx + 0.5);
    return standIdAt(this.region, point.x, point.y);
  }

  /** Re-file a strand into the square its new position belongs to. */
  rebucket(node: PositionedNode): void {
    const standId = this.standOf(node);
    if (standId === null) return;
    const changed = node.standId !== standId;
    node.standId = standId;
    if (changed && !this.siteById.has(standId)) {
      const parent = this.colony.nodes[(node as HyphaNode).parent];
      this.activate(standId, `The colony reaches the ${this.region.stands[standId]?.community.replace(/-/g, ' ')}.`, parent?.standId ?? this.originStandId);
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

  /**
   * Every strand of the colony, in stable node order, with the real XYZ
   * endpoints a section or a surface projection has to agree with.
   */
  colonyEdges(): ColonyEdge[] {
    const edges: ColonyEdge[] = [];
    // In regional coordinates every strand carries its position, kept current
    // each step for whatever moved; the corridor fixture computes it.
    const at = (node: HyphaNode): NodePosition => (this.regionalCoordinates && node.spatial) || this.nodePosition(node);
    for (const node of this.colony.nodes) {
      if (node.parent < 0) continue;
      const parent = this.colony.nodes[node.parent];
      if (!parent) continue;
      edges.push({
        key: `${this.colonyId}:${parent.id}-${node.id}`,
        parent: parent.id,
        child: node.id,
        from: at(parent),
        to: at(node),
        thickness: node.thickness,
        reinforced: node.reinforced,
        // A strand is "connected" only if both ends are: a cut parent leaves a
        // remnant standing, and the reveal has to be able to say so.
        connected: node.alive && parent.alive && node.connected && parent.connected,
        standId: node.standId < 0 ? this.originStandId : node.standId,
        parentStandId: parent.standId < 0 ? this.originStandId : parent.standId,
      });
    }
    return edges;
  }

  /** Stands the colony currently stands in. */
  reachedStandIds(): StandId[] {
    const ids = new Set<StandId>();
    for (const node of this.colony.nodes) {
      if (!node.alive) continue;
      if (node.standId >= 0) ids.add(node.standId);
    }
    ids.add(this.originStandId);
    return [...ids].sort((a, b) => a - b);
  }

  /**
   * Stands a player may browse: the ones the colony has reached, plus their
   * orthogonal neighbours. Undiscovered regional soil is not opened up by
   * walking into a section.
   */
  browsableStandIds(): StandId[] {
    const ids = new Set<StandId>(this.reachedStandIds());
    for (const standId of [...ids]) {
      const frame = standFrameOf(this.region, standId);
      if (!frame) continue;
      for (const side of ['north', 'east', 'south', 'west'] as const) {
        const neighbour = neighbourStand(this.region, frame, side);
        if (neighbour !== null) ids.add(neighbour);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  /** Graph edges that genuinely cross a seam, derived from parent links. */
  portals(): CrossingPortal[] {
    const portals: CrossingPortal[] = [];
    for (const node of this.colony.nodes) {
      if (!node.alive || node.parent < 0) continue;
      const parent = this.colony.nodes[node.parent];
      if (!parent || !parent.alive || parent.standId === node.standId) continue;
      if (parent.standId < 0 || node.standId < 0) continue;
      const parentFrame = standFrameOf(this.region, parent.standId);
      const childFrame = standFrameOf(this.region, node.standId);
      let edge = this.direction;
      let seam = this.seam;
      if (this.regionalCoordinates && parentFrame && childFrame) {
        const horizontal = Math.abs(childFrame.sx - parentFrame.sx);
        const vertical = Math.abs(childFrame.sy - parentFrame.sy);
        if (horizontal >= vertical && horizontal > 0) {
          edge = childFrame.sx > parentFrame.sx ? 'east' : 'west';
          seam = edge === 'east' ? parentFrame.originX + STAND_SIZE : parentFrame.originX;
        } else if (vertical > 0) {
          edge = childFrame.sy > parentFrame.sy ? 'south' : 'north';
          seam = edge === 'south' ? parentFrame.originY + STAND_SIZE : parentFrame.originY;
        }
      }
      portals.push({
        nodeId: node.id,
        parentId: parent.id,
        standId: node.standId,
        parentStandId: parent.standId,
        edge,
        seam,
        at: this.nodePosition(node),
      });
    }
    return portals;
  }

  private activate(standId: StandId, note: string, fromStandId: StandId | null): void {
    if (this.siteById.has(standId)) return;
    const site = this.region.stands[standId];
    if (!site) return;
    const world = this.worldForStand?.(standId) ?? createStandWorld(site.seed, {
      waterTableCm: site.waterTableCm,
      mix: undefined,
      stream: site.stream,
    });
    const stand: CrossingStand = { site, world, treeBase: this.view.trees.length, activatedAt: this.time };
    this.stands.push(stand);
    this.siteById.set(standId, stand);
    this.view.activate(site, world);
    this.onActivate?.(standId, fromStandId);
    this.log(`${note} (${this.stands.length} stand${this.stands.length === 1 ? '' : 's'} held)`);
  }

  /** Carry already occupied material into the shared volume once on promotion. */
  private importOccupiedSoil(world?: World): void {
    if (!world) return;
    const frame = standFrameOf(this.region, this.originStandId);
    if (!frame) return;
    for (const node of this.colony.nodes) {
      if (node.standId !== this.originStandId) continue;
      const localX = node.gx - (this.alongIsX ? frame.originX : frame.originY);
      const cell = world.cells[node.gy * world.cols + localX];
      const voxel = this.voxelOf(node, 0, 0);
      if (!cell || !voxel) continue;
      const shared = this.soil.materialAt(voxel.x, voxel.y, voxel.z);
      shared.organic = cell.organic;
      shared.nitrogen = cell.nitrogen;
      shared.water = cell.water;
      shared.occupancy = cell.occupancy;
    }
  }

  /** Any stand the colony now stands in, activated for the next tick. */
  private activateReached(): void {
    for (const node of this.colony.nodes) {
      if (!node.alive) continue;
      const standId = this.standOf(node);
      if (standId === null) continue;
      node.standId = standId;
      if (!this.siteById.has(standId)) {
        const parent = node.parent < 0 ? null : this.colony.nodes[node.parent];
        this.activate(standId, `The colony reaches the ${this.region.stands[standId]?.community.replace(/-/g, ' ')}.`, parent?.standId ?? this.originStandId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Fusion
  // -------------------------------------------------------------------------

  /**
   * Take another of the same player's colonies into this one where their
   * strands touch (`MAP-15`, decided 28 September: fusion is automatic).
   *
   * Every node of the other graph joins this graph with its id shifted past
   * ours; its founding node is re-parented to our node at the contact, so the
   * two become one connected body. Resources are carried node by node, so the
   * total is conserved exactly. Its stores (surplus, a body in progress,
   * blooms) join ours, its tree bonds are re-pointed at the same trees in our
   * table, and it is left empty and extinct. Subclusters of the absorbed
   * graph rejoin the colony at large.
   */
  absorb(other: CrossingMatch, mine: number, theirs: number): { nodes: number; bonds: number } {
    const a = this.colony;
    const b = other.colony;
    if (a === b || !a.nodes[mine]?.alive || !b.nodes[theirs]?.alive) return { nodes: 0, bonds: 0 };
    // Strands are copied with their stores: every strand holds its exact share
    // first, and both graphs' runs are found again at the next step.
    releaseStrands(a);
    releaseStrands(b);
    const offset = a.nodes.length;
    // Both graphs keep regional x as origin + column; y, lateral and depth are
    // already absolute, so only the along axis shifts.
    const dx = other.originX - this.originX;
    // Everything the other graph had reached, we now hold: its trees join our table.
    for (const stand of other.stands) this.activate(stand.site.id, `Fused with a colony holding stand ${stand.site.id + 1}`, null);
    let bonds = 0;
    for (const node of b.nodes) {
      const moved: HyphaNode = {
        ...node,
        id: node.id + offset,
        parent: node.parent >= 0 ? node.parent + offset : mine,
        children: node.children.map((child) => child + offset),
        gx: node.gx + dx,
        wx: node.wx + dx,
        targetGx: node.targetGx + dx,
        group: 0,
        // Tended on the other colony's clock; start afresh on ours.
        tendedAt: undefined,
      };
      if (node.bondedTree >= 0) {
        const ref = other.view.treeRefAt(node.bondedTree);
        const index = ref ? this.treeIndex(ref) : -1;
        const tree = index >= 0 ? (this.view.trees[index] as Tree) : null;
        const tip = tree?.rootTips[node.bondedRootTip];
        if (tree && tip && tip.bondedTo === node.id) {
          moved.bondedTree = index;
          tip.bondedTo = moved.id;
          tip.bondedColonyId = a.colonyId ?? null;
          bonds++;
        } else {
          moved.bondedTree = -1;
          moved.bondedRootTip = -1;
        }
      }
      a.nodes.push(moved);
    }
    // The other founding spore hangs from our node at the contact.
    const joinedRoot = b.rootId + offset;
    (a.nodes[joinedRoot] as HyphaNode).parent = mine;
    (a.nodes[mine] as HyphaNode).children.push(joinedRoot);
    // Stores and reproduction join ours.
    a.surplus += b.surplus;
    a.spores += b.spores;
    a.fruited += b.fruited;
    a.lengthCm += b.lengthCm;
    a.tipCount += b.tipCount;
    a.blooms.push(...b.blooms.map((bloom) => ({ ...bloom, gx: bloom.gx + dx })));
    if (b.fruit.active) {
      if (!a.fruit.active) {
        a.fruit = { ...b.fruit, nodeId: b.fruit.nodeId + offset, gx: b.fruit.gx + dx };
      } else {
        // One body at a time: the second body's committed energy returns to the reserve.
        a.surplus += b.fruit.store;
      }
    }
    // The absorbed graph is now empty.
    b.nodes = [];
    b.extinct = true;
    b.fruit = { ...b.fruit, active: false, store: 0, progress: 0 };
    b.surplus = 0;
    b.waypoints = [];
    b.groups = undefined;
    updateTotals(b);
    markConnectivity(a);
    updateTotals(a);
    this.log(`Fused with the colony founded in stand ${other.originStandId + 1}: ${a.nodes.length - offset} strands joined.`);
    return { nodes: a.nodes.length - offset, bonds };
  }

  /** Every living node with its regional position, for contact tests. */
  livingPositions(): Array<{ id: number; position: NodePosition }> {
    const out: Array<{ id: number; position: NodePosition }> = [];
    for (const node of this.colony.nodes) if (node.alive) out.push({ id: node.id, position: this.nodePosition(node) });
    return out;
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  /** Send the frontier across the shared edge, and only just across it. */
  orderAcross(group = 0): { ok: boolean; message: string } {
    if (this.portals().some((portal) => portal.parentStandId === this.originStandId &&
      portal.standId === this.destinationStandId)) {
      return { ok: false, message: 'The colony already stands in both stands.' };
    }
    const target = this.regionalCoordinates
      ? (this.alongIsX ? this.seam + this.sign * this.reachColumns - this.originX
        : Math.floor(this.plane.fixed) - this.originX)
      : this.columnAt(this.seam) + this.sign * this.reachColumns;
    const lateral = this.regionalCoordinates
      ? (this.alongIsX ? this.plane.fixed : this.seam + this.sign * this.reachColumns + 0.5)
      : undefined;
    const live = group && this.colony.groups?.some((g) => g.id === group) ? group : 0;
    orderWaypoint(this.colony, target, this.depthRow, this.view, lateral, live);
    return { ok: true, message: `${live ? `Subcluster ${live}` : 'Frontier'} directed across the seam to column ${target}.` };
  }

  /** An order from a displayed section, checked against the shared material. */
  growAt(point: Vec3, along: 'x' | 'y', fixed: number, group = 0): { ok: boolean; message: string } {
    if (!this.regionalCoordinates && (along !== this.plane.along || Math.abs(fixed - this.plane.fixed) > this.laneSpread + 2)) {
      return { ok: false, message: 'This section can be inspected, but growth follows the colony’s current corridor.' };
    }
    const gx = this.regionalCoordinates
      ? Math.floor(point.x) - this.originX
      : this.columnAt(along === 'x' ? point.x : point.y);
    const gy = rowAtDepthCm((this.region.heightAt(point.x, point.y) - point.z) * GRID.cmPerRow);
    const owner = standIdAt(this.region, point.x, point.y);
    const lateral = this.regionalCoordinates ? point.y : this.plane.along === 'x' ? point.y : point.x;
    const voxel = this.voxelAt(gx, this.regionalCoordinates ? lateral : fixed, gy);
    if (owner === null || !voxel || this.soil.blockAt(voxel.x, voxel.y, voxel.z).blocked) {
      return { ok: false, message: 'That section point is stone, open water or saturated ground.' };
    }
    // A selected subcluster takes the order alone; the rest keep theirs.
    const live = group && this.colony.groups?.some((g) => g.id === group) ? group : 0;
    orderWaypoint(this.colony, gx, gy, this.view, this.regionalCoordinates ? lateral : undefined, live);
    const who = live ? `Subcluster ${live}` : 'Frontier';
    return { ok: true, message: `${who} directed to stand ${owner + 1}, −${Math.round(rowDepthCm(gy))} cm.` };
  }

  /** Circle part of the body in physical XYZ and make it a subcluster. */
  splitAt(point: Vec3, radius: number): { ok: boolean; message: string; id?: number } {
    return createGroupWhere(this.colony, this.view, (node) => {
      const at = this.nodePosition(node);
      return Math.hypot(at.x - point.x, at.y - point.y, at.z - point.z) <= radius;
    });
  }

  /** Return a subcluster to the body at large. */
  mergeGroup(id: number): boolean {
    return dissolveGroup(this.colony, this.view, id);
  }

  /** Node ids of one subcluster, for highlighting it in a section. */
  groupNodeIds(group: number): Set<number> {
    const ids = new Set<number>();
    if (!group) return ids;
    for (const node of this.colony.nodes) if (node.alive && node.group === group) ids.add(node.id);
    return ids;
  }

  /** Select in physical XYZ, so overlapping projections stay distinct. */
  private nearestSpatialNode(point: Vec3, reach: number, connected = false): HyphaNode | null {
    let best: HyphaNode | null = null;
    let distance = reach;
    for (const node of this.colony.nodes) {
      if (!node.alive || (connected && !node.connected)) continue;
      const at = this.nodePosition(node);
      const next = Math.hypot(at.x - point.x, at.y - point.y, at.z - point.z);
      if (next < distance) {
        best = node;
        distance = next;
      }
    }
    return best;
  }

  /** The living strand of this body nearest a physical point, within reach. */
  strandAt(point: Vec3, reach = 5): number | null {
    return this.nearestSpatialNode(point, reach)?.id ?? null;
  }

  /** Lay a cord from one strand toward another (default: home), as far as affordable. */
  cordRoute(fromId: number, toId?: number): { ok: boolean; message: string; laid: number } {
    const route = cordRoute(this.colony, fromId, toId);
    if (!route.length) return { ok: false, message: 'Those strands are not joined.', laid: 0 };
    const laid = layCord(this.colony, route);
    if (!laid) return { ok: false, message: 'Not enough carbon to spare for a cord.', laid: 0 };
    this.log(`${laid} strand${laid === 1 ? '' : 's'} braided into a cord.`);
    return { ok: true, message: 'Cord laid.', laid };
  }

  cordAt(point: Vec3): { ok: boolean; message: string } {
    const gx = this.regionalCoordinates ? Math.floor(point.x) - this.originX
      : this.columnAt(this.plane.along === 'x' ? point.x : point.y);
    const gy = rowAtDepthCm((this.region.heightAt(point.x, point.y) - point.z) * GRID.cmPerRow);
    const node = this.regionalCoordinates
      ? this.nearestSpatialNode(point, 5)
      : nearestNode(this.colony, gx, gy, 3);
    const here = node ? this.nodePosition(node) : null;
    if (!node || !here || Math.hypot(here.x - point.x, here.y - point.y, here.z - point.z) > 5) {
      return { ok: false, message: 'No living strand at that point.' };
    }
    if (node.reinforced) return { ok: false, message: 'That strand is already a cord.' };
    if (!makeCord(this.colony, node.id)) return { ok: false, message: 'That strand needs more carbon to become a cord.' };
    return { ok: true, message: 'The strand thickens into a cord.' };
  }

  fruitAt(point: Vec3): { ok: boolean; message: string } {
    const gx = this.regionalCoordinates ? Math.floor(point.x) - this.originX
      : this.columnAt(this.plane.along === 'x' ? point.x : point.y);
    const gy = rowAtDepthCm((this.region.heightAt(point.x, point.y) - point.z) * GRID.cmPerRow);
    if (this.season.warmth < 0.3) return { ok: false, message: 'Too cold to fruit.' };
    if (this.colony.surplus < ECON.fruitThreshold) {
      return { ok: false, message: `Surplus ${this.colony.surplus.toFixed(0)} of ${ECON.fruitThreshold} needed.` };
    }
    const nearby = this.regionalCoordinates
      ? this.nearestSpatialNode(point, 4, true)
      : nearestNode(this.colony, gx, gy, 2);
    const here = nearby ? this.nodePosition(nearby) : null;
    if (!nearby || !nearby.connected || !here || Math.hypot(here.x - point.x, here.y - point.y, here.z - point.z) > 4) {
      return { ok: false, message: 'Choose a supplied strand in this section.' };
    }
    const lane = this.regionalCoordinates ? point.y : this.plane.fixed;
    const voxel = this.voxelAt(gx, lane, gy);
    const node = startFruiting(this.colony, () => Boolean(voxel && this.soil.passableAt(voxel.x, voxel.y, voxel.z)), gx, gy,
      this.regionalCoordinates && nearby ? { nodeId: nearby.id, spatial: point } : undefined);
    return node
      ? { ok: true, message: 'A fruiting body rises from the connected strand.' }
      : { ok: false, message: 'Choose a supplied strand in the upper 12 cm.' };
  }

  /**
   * Send the frontier toward one tree's root tip, for a remote bond.
   *
   * `viaRow` routes it first to that shallower row above the tip and then down,
   * which is how a strand gets over a groundwater lens or a stone lip that a
   * straight-line heading keeps pressing into.
   */
  orderTowardTip(treeRef: TreeRef, tipId: number, viaRow?: number): { ok: boolean; message: string } {
    const index = this.treeIndex(treeRef);
    const tree = index < 0 ? null : (this.view.trees[index] as Tree);
    const tip = tree?.rootTips[tipId];
    if (!tree || !tip) return { ok: false, message: 'No such root tip.' };
    // A root tip's `gx` is a column inside its own stand; the colony's growth
    // plane counts across the whole region, so the order has to be translated.
    const point = this.rootTipPosition(treeRef.standId, tip);
    const along = this.regionalCoordinates
      ? Math.floor(point.x) - this.originX
      : this.alongOfTip(treeRef.standId, tip);
    const lateral = this.regionalCoordinates ? point.y : undefined;
    if (viaRow !== undefined && viaRow < tip.gy) {
      orderWaypoint(this.colony, along, viaRow, this.view, lateral);
      this.colony.waypoints.push({ gx: along, gy: tip.gy, lateral });
    } else {
      orderWaypoint(this.colony, along, tip.gy, this.view, lateral);
    }
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
    exclude?: Set<string>,
    unpartneredTree = false
  ): { treeRef: TreeRef; tipId: number; distanceCm: number } | null {
    let best: { treeRef: TreeRef; tipId: number; distanceCm: number } | null = null;
    for (let index = 0; index < this.view.trees.length; index++) {
      const ref = this.view.treeRefAt(index);
      if (!ref || ref.standId !== standId) continue;
      const tree = this.view.trees[index] as Tree;
      if (tree.dead) continue;
      if (unpartneredTree && holdsAnyBond(tree, this.colony.colonyId)) continue;
      for (const tip of tree.rootTips) {
        if (tip.bondedTo !== null) continue;
        if (exclude?.has(`${ref.treeId}:${tip.id}`)) continue;
        const target = this.rootTipPosition(standId, tip);
        for (const node of this.colony.nodes) {
          if (!node.alive || !node.connected || node.bondedTree >= 0) continue;
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
    markStrandsStale(this.colony);
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

  /** Set by the match: whether burned ground in a stand is in its post-fire flush. */
  ashFlush: ((standId: StandId) => boolean) | null = null;

  step(dt: number, advanceSoil = true, stormRainfall?: number): void {
    this.advanceClock(dt);
    const season = this.season;
    this.view.rainfall = stormRainfall ?? season.rain;
    // 1. The regional environment, once, for every stand at once.
    if (advanceSoil) this.soil.step(dt, {
      rainfall: season.rain,
      litterfall: season.litterfall,
      waterTableOffsetCm: seasonalWaterTableOffsetCm(season.rain),
    });
    // 2. Per colony, in stable id order.
    for (const colony of this.colonies) {
      // Nothing has cut the network since its last step marked what the founder reaches.
      if (!strandsCurrent(colony.net)) markConnectivity(colony.net);
      this.tradeTrees(colony, dt);
      // A body rising from burned ground in its flush fruits in any weather, faster.
      const fruit = colony.net.fruit;
      const fruitStand = fruit.active && fruit.spatial ? standIdAt(this.region, fruit.spatial.x, fruit.spatial.y) : null;
      const ash = fruitStand !== null && this.ashFlush?.(fruitStand) === true;
      stepNetwork(colony.net, {
        world: colony.view,
        light: season.light,
        warmth: season.warmth,
        fruitingWeather: stormRainfall !== undefined || ash,
        fruitSpeed: ash ? ASH_FRUIT_SPEED : 1,
        rival: null,
        time: this.time,
        log: (text) => this.log(text),
        dt,
      });
      if (this.regionalCoordinates) {
        // Only tips and strands that just settled have moved.
        const place = (node: HyphaNode): void => { node.spatial = this.nodePosition(node); };
        if (!forEachMovedStrand(colony.net, place)) for (const node of colony.net.nodes) place(node);
      }
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
        const bonded = holdsAnyBond(tree, colony.net.colonyId);
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
      if ((tip.bondedColonyId ?? null) !== (colony.net.colonyId ?? null)) continue;
      const node = colony.net.nodes[tip.bondedTo];
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
      carbon += heldBy(this.colony, node, 'carbon');
      water += heldBy(this.colony, node, 'water');
      nitrogen += heldBy(this.colony, node, 'nitrogen');
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
        node.y,
        node.lateral,
        node.targetLateral,
        node.standId,
        node.alive ? 1 : 0,
        node.connected ? 1 : 0,
        heldBy(this.colony, node, 'carbon'),
        heldBy(this.colony, node, 'water'),
        heldBy(this.colony, node, 'nitrogen')
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

export interface CrossingCorridor {
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
export function chooseCrossing(
  region: Region,
  soil: SoilVolume,
  from: StandId,
  preferred?: CrossingDirection
): CrossingCorridor {
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
