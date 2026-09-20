/**
 * Shared spatial coordinates for the region (`MAP-14`).
 *
 * Everything here is pure arithmetic: no RNG, no renderer, no mutable state. It
 * exists so that the forest, the underground transect and the future section
 * browser can all speak about the same place.
 *
 * Conventions, used consistently by every caller:
 *
 * - `x`, `y` are horizontal *regional* coordinates in game-space units. They
 *   address the same landscape `Region.heightAt(x, y)` describes, so a position
 *   does not change meaning when a different stand is on screen.
 * - `z` is absolute elevation, positive upward. Depth is derived, never stored:
 *   `depthCm = (heightAt(x, y) - z) * GRID.cmPerRow`.
 * - Stand ownership comes from the horizontal position alone, using half-open
 *   bounds. The internal edge belongs to exactly one stand: the one to its east
 *   or south. Coordinates outside the region are invalid, not clamped.
 * - One unit is one voxel on every axis. The soil volume's canonical key is the
 *   integer triple this module produces, so two callers looking at the same
 *   physical place produce the same key whatever stand they think they are in.
 *
 * The render adapter at the bottom is the *only* place the simulation's axes
 * are re-expressed for Three.js, and it is invertible so picking can come back.
 */
import { GRID } from './content';
import { STAND_SIZE } from './region';
import { mulberry32 } from './rng';

/**
 * Bumped whenever the meaning of a stored spatial coordinate changes. There is
 * no released save format yet; this exists so one can be written later without
 * guessing which convention an old file used.
 */
export const SPATIAL_VERSION = 1;

/** One unit per axis. Documented here because the voxel key depends on it. */
export const VOXEL_SIZE = 1;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The canonical soil-volume key: integers at `VOXEL_SIZE` resolution. */
export interface VoxelKey {
  ix: number;
  iy: number;
  iz: number;
}

export type StandId = number;
export type ColonyId = string;

/** A stable reference to one node of one colony. Local ids collide across stands. */
export interface NodeRef {
  colonyId: ColonyId;
  nodeId: number;
}

/** A stable reference to one tree, independent of stand-local array order. */
export interface TreeRef {
  standId: StandId;
  treeId: number;
}

export interface RootTipRef extends TreeRef {
  tipId: number;
}

/** The horizontal shape of a region; all `stand*` helpers need only this. */
export interface RegionGrid {
  cols: number;
  rows: number;
}

/** A region that can answer "how high is the ground here". */
export interface RegionSurface extends RegionGrid {
  heightAt(x: number, y: number): number;
}

export interface StandFrame {
  id: StandId;
  sx: number;
  sy: number;
  /** Region coordinates of the square's north-west corner. */
  originX: number;
  originY: number;
  size: number;
}

export const nodeRef = (colonyId: ColonyId, nodeId: number): NodeRef => ({ colonyId, nodeId });
export const treeRef = (standId: StandId, treeId: number): TreeRef => ({ standId, treeId });
export const rootTipRef = (standId: StandId, treeId: number, tipId: number): RootTipRef => ({
  standId,
  treeId,
  tipId,
});
export const refKey = (ref: TreeRef | RootTipRef): string =>
  'tipId' in ref ? `${ref.standId}:${ref.treeId}:${ref.tipId}` : `${ref.standId}:${ref.treeId}`;

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// ---------------------------------------------------------------------------
// Stand ownership
// ---------------------------------------------------------------------------

export const regionSpanX = (grid: RegionGrid): number => grid.cols * STAND_SIZE;
export const regionSpanY = (grid: RegionGrid): number => grid.rows * STAND_SIZE;

export const insideRegion = (grid: RegionGrid, x: number, y: number): boolean =>
  Number.isFinite(x) &&
  Number.isFinite(y) &&
  x >= 0 &&
  y >= 0 &&
  x < regionSpanX(grid) &&
  y < regionSpanY(grid);

/**
 * Which stand owns a horizontal position, or null outside the region.
 *
 * Half-open bounds: the seam between two squares belongs to the eastern or
 * southern square. That is the whole reason a shared voxel has one owner rather
 * than two, and it is also why a caller cannot quietly disagree with another
 * about which side of a border it is standing on.
 */
export function standIdAt(grid: RegionGrid, x: number, y: number): StandId | null {
  if (!insideRegion(grid, x, y)) return null;
  const sx = Math.floor(x / STAND_SIZE);
  const sy = Math.floor(y / STAND_SIZE);
  return sy * grid.cols + sx;
}

export function standFrameOf(grid: RegionGrid, standId: StandId): StandFrame | null {
  if (!Number.isInteger(standId) || standId < 0 || standId >= grid.cols * grid.rows) return null;
  const sx = standId % grid.cols;
  const sy = Math.floor(standId / grid.cols);
  return {
    id: standId,
    sx,
    sy,
    originX: sx * STAND_SIZE,
    originY: sy * STAND_SIZE,
    size: STAND_SIZE,
  };
}

export type StandSide = 'north' | 'east' | 'south' | 'west';

/**
 * The region coordinate of one side of a stand.
 *
 * The east edge of one square and the west edge of its neighbour return the
 * same number, which is what lets a crossing be tested from either side and get
 * the same answer.
 */
export function standSideCoordinate(frame: StandFrame, side: StandSide): number {
  switch (side) {
    case 'west':
      return frame.originX;
    case 'east':
      return frame.originX + frame.size;
    case 'north':
      return frame.originY;
    default:
      return frame.originY + frame.size;
  }
}

/** The stand on the other side of a side, or null at the edge of the region. */
export function neighbourStand(grid: RegionGrid, frame: StandFrame, side: StandSide): StandId | null {
  const sx = frame.sx + (side === 'east' ? 1 : side === 'west' ? -1 : 0);
  const sy = frame.sy + (side === 'south' ? 1 : side === 'north' ? -1 : 0);
  if (sx < 0 || sy < 0 || sx >= grid.cols || sy >= grid.rows) return null;
  return sy * grid.cols + sx;
}

// ---------------------------------------------------------------------------
// Elevation and depth
// ---------------------------------------------------------------------------

/** Depth below the ground at that place, in centimetres. */
export const depthCmAt = (surface: RegionSurface, x: number, y: number, z: number): number =>
  (surface.heightAt(x, y) - z) * GRID.cmPerRow;

/** Absolute elevation of a point a given depth below the local ground. */
export const elevationAtDepthCm = (
  surface: RegionSurface,
  x: number,
  y: number,
  depthCm: number
): number => surface.heightAt(x, y) - depthCm / GRID.cmPerRow;

export const pointAtDepth = (
  surface: RegionSurface,
  x: number,
  y: number,
  depthCm: number
): Vec3 => vec3(x, y, elevationAtDepthCm(surface, x, y, depthCm));

/** Grid row nearest a depth, matching `world.rowAtDepthCm` for legacy callers. */
export const rowAtDepthCm = (cm: number): number =>
  Math.max(0, Math.min(GRID.rows - 1, Math.round(cm / GRID.cmPerRow - 0.5)));

/** Depth of the top of a row, matching `world.rowDepthCm`. */
export const rowDepthCm = (gy: number): number => (gy + 0.5) * GRID.cmPerRow;

/** Distance between two points, in centimetres, on all three axes. */
export function distanceCm(a: Vec3, b: Vec3): number {
  const dx = (a.x - b.x) * GRID.cmPerRow;
  const dy = (a.y - b.y) * GRID.cmPerRow;
  const dz = (a.z - b.z) * GRID.cmPerRow;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------------------
// Simulation-owned tree and root-tip placement
// ---------------------------------------------------------------------------

/** Local depth into a stand where a tree's seed puts its trunk, in world units. */
export const TREE_NEAR_UNITS = 10;
const TREE_RANGE_UNITS = STAND_SIZE - 26;

/**
 * The horizontal placement the forest has always used, moved here so the
 * simulation owns it rather than the renderer.
 *
 * The formula is unchanged (a hash of the tree's own seed), so every existing
 * tree keeps the exact place it stood on screen. Returned in region-space units
 * *within the stand*, so the caller adds the frame origin.
 */
export const treeLocalOffset = (treeSeed: number): number => {
  // The renderer's own generator, so the placement it already drew is exactly
  // the placement the simulation now owns.
  const roll = mulberry32(treeSeed ^ 0x9af2)();
  return TREE_NEAR_UNITS + roll * TREE_RANGE_UNITS;
};

export interface PlacedTree {
  id: number;
  gx: number;
  seed: number;
}

export interface PlacedRootTip {
  gx: number;
  gy: number;
}

/**
 * Where a tree stands on the forest floor: the seeded placement the renderer
 * used, now computed from simulation data.
 */
export function treeSpatialPosition(
  tree: PlacedTree,
  surface: RegionSurface,
  frame: StandFrame
): Vec3 {
  const x = frame.originX + tree.gx;
  const y = frame.originY + treeLocalOffset(tree.seed);
  return vec3(x, y, surface.heightAt(x, y));
}

/**
 * A vertical section: a plane that runs along one horizontal axis and is fixed
 * on the other. East/west growth browses a plane of constant `y`; north/south
 * growth browses one of constant `x`.
 */
export interface SectionPlane {
  along: 'x' | 'y';
  /** The coordinate the plane is pinned to on the other horizontal axis. */
  fixed: number;
}

export const planePoint = (plane: SectionPlane, along: number): { x: number; y: number } =>
  plane.along === 'x' ? { x: along, y: plane.fixed } : { x: plane.fixed, y: along };

/**
 * Where a tree stands in a vertical section through its stand.
 *
 * The tree keeps its own column, so the same trunk is found in the section it
 * belongs to.
 */
export function treeSectionPosition(
  tree: PlacedTree,
  surface: RegionSurface,
  frame: StandFrame,
  plane: SectionPlane
): Vec3 {
  const along = (plane.along === 'x' ? frame.originX : frame.originY) + tree.gx;
  const point = planePoint(plane, along);
  return vec3(point.x, point.y, surface.heightAt(point.x, point.y));
}

/**
 * A root tip's real position beneath its tree.
 *
 * Depth is measured from the ground directly above the tip, not from the tree's
 * own column: the tip's `gx` is a real horizontal coordinate and its `gy` is a
 * real depth, so bonding distance is a 3D distance rather than a screen-label
 * coincidence.
 */
export function rootTipSectionPosition(
  tip: PlacedRootTip,
  surface: RegionSurface,
  frame: StandFrame,
  plane: SectionPlane
): Vec3 {
  const along = (plane.along === 'x' ? frame.originX : frame.originY) + tip.gx + 0.5;
  const point = planePoint(plane, along);
  const z = elevationAtDepthCm(surface, point.x, point.y, rowDepthCm(tip.gy));
  return vec3(point.x, point.y, z);
}

// ---------------------------------------------------------------------------
// Voxel keys and segment traversal
// ---------------------------------------------------------------------------

export const voxelKeyOf = (position: Vec3): VoxelKey => ({
  ix: Math.floor(position.x / VOXEL_SIZE),
  iy: Math.floor(position.y / VOXEL_SIZE),
  iz: Math.floor(position.z / VOXEL_SIZE),
});

export const voxelKeyText = (key: VoxelKey): string => `${key.ix},${key.iy},${key.iz}`;

export const voxelCentre = (key: VoxelKey): Vec3 => vec3(
  (key.ix + 0.5) * VOXEL_SIZE,
  (key.iy + 0.5) * VOXEL_SIZE,
  (key.iz + 0.5) * VOXEL_SIZE
);

export const sameVoxel = (a: VoxelKey, b: VoxelKey): boolean =>
  a.ix === b.ix && a.iy === b.iy && a.iz === b.iz;

/**
 * Every voxel a segment passes through, in order, endpoints included.
 *
 * This is a supercover traversal, not an endpoint test: a strand that steps
 * diagonally past a stand corner reports the cells it actually crossed rather
 * than only where it landed. Where the segment runs exactly through an edge or
 * corner, the traversal visits each touched cell instead of choosing one, so no
 * shared edge can be skipped.
 */
export function traverseSegment(from: Vec3, to: Vec3): VoxelKey[] {
  const x0 = from.x / VOXEL_SIZE;
  const y0 = from.y / VOXEL_SIZE;
  const z0 = from.z / VOXEL_SIZE;
  const x1 = to.x / VOXEL_SIZE;
  const y1 = to.y / VOXEL_SIZE;
  const z1 = to.z / VOXEL_SIZE;

  let ix = Math.floor(x0);
  let iy = Math.floor(y0);
  let iz = Math.floor(z0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const ez = Math.floor(z1);

  const out: VoxelKey[] = [{ ix, iy, iz }];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const boundary = (index: number, step: number): number => (step > 0 ? index + 1 : index);
  let tMaxX = dx === 0 ? Infinity : (boundary(ix, stepX) - x0) / dx;
  let tMaxY = dy === 0 ? Infinity : (boundary(iy, stepY) - y0) / dy;
  let tMaxZ = dz === 0 ? Infinity : (boundary(iz, stepZ) - z0) / dz;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);

  // A unit step never crosses more than this many cells; the bound also keeps a
  // degenerate or non-finite segment from spinning.
  const maxVisits =
    4 * (Math.abs(ex - ix) + Math.abs(ey - iy) + Math.abs(ez - iz)) + 8;

  const EPS = 1e-9;
  for (let guard = 0; guard < maxVisits; guard++) {
    if (ix === ex && iy === ey && iz === ez) break;
    const least = Math.min(tMaxX, tMaxY, tMaxZ);
    if (!Number.isFinite(least)) break;
    // Which axes cross at this point? One axis is an ordinary step. More than
    // one means the segment runs exactly through an edge or a corner, and every
    // cell meeting there is touched: record all of them rather than picking one
    // order and letting the others fall through the crack.
    const crossing: number[] = [];
    if (tMaxX <= least + EPS && stepX !== 0) crossing.push(0);
    if (tMaxY <= least + EPS && stepY !== 0) crossing.push(1);
    if (tMaxZ <= least + EPS && stepZ !== 0) crossing.push(2);
    if (crossing.length === 0) break;
    const bx = ix;
    const by = iy;
    const bz = iz;
    if (crossing.length > 1) {
      for (let subset = 1; subset < 1 << crossing.length; subset++) {
        const useX = crossing.includes(0) && (subset & 1) !== 0;
        const useY = crossing.includes(1) && (subset & 2) !== 0;
        const useZ = crossing.includes(2) && (subset & 4) !== 0;
        out.push({
          ix: bx + (useX ? stepX : 0),
          iy: by + (useY ? stepY : 0),
          iz: bz + (useZ ? stepZ : 0),
        });
      }
    } else {
      out.push({
        ix: bx + (crossing[0] === 0 ? stepX : 0),
        iy: by + (crossing[0] === 1 ? stepY : 0),
        iz: bz + (crossing[0] === 2 ? stepZ : 0),
      });
    }
    if (crossing.includes(0)) {
      ix += stepX;
      tMaxX += tDeltaX;
    }
    if (crossing.includes(1)) {
      iy += stepY;
      tMaxY += tDeltaY;
    }
    if (crossing.includes(2)) {
      iz += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
  return out;
}

/** Stands a horizontal segment passes through, in the order it reaches them. */
export function segmentStands(grid: RegionGrid, from: Vec3, to: Vec3): StandId[] {
  const seen: StandId[] = [];
  for (const key of traverseSegment(from, to)) {
    const x = (key.ix + 0.5) * VOXEL_SIZE;
    const y = (key.iy + 0.5) * VOXEL_SIZE;
    const stand = standIdAt(grid, x, y);
    if (stand === null) continue;
    if (seen[seen.length - 1] !== stand && !seen.includes(stand)) seen.push(stand);
  }
  return seen;
}

/** True when the segment touches ground outside the region at all. */
export function segmentLeavesRegion(grid: RegionGrid, from: Vec3, to: Vec3): boolean {
  for (const key of traverseSegment(from, to)) {
    if (standIdAt(grid, (key.ix + 0.5) * VOXEL_SIZE, (key.iy + 0.5) * VOXEL_SIZE) === null) {
      return true;
    }
  }
  return false;
}

export function segmentCrossesStandBoundary(grid: RegionGrid, from: Vec3, to: Vec3): boolean {
  return segmentStands(grid, from, to).length > 1;
}

// ---------------------------------------------------------------------------
// Three.js adapter
// ---------------------------------------------------------------------------

/** The height the forest floor sits at in render space, matching the surface. */
export const RENDER_FLOOR = GRID.rows / 2;
/** Visual stretch of elevation only. Kept here, never inside a simulation value. */
export const VERTICAL_EXAGGERATION = 1;

export interface RenderOrigin {
  /** The stand's north-west corner, in region coordinates. */
  originX: number;
  originY: number;
  /** Render-space height of simulation elevation zero. */
  floor?: number;
}

/**
 * Simulation position to Three.js position.
 *
 * `y` points up in render space and down in region space, which is why the
 * third component is `originY - y`; elevation is added to the floor. Vertical
 * exaggeration lives here and only here, and `fromRender` undoes it.
 */
export function toRender(
  position: Vec3,
  origin: RenderOrigin,
  exaggeration: number = VERTICAL_EXAGGERATION
): Vec3 {
  return vec3(
    position.x - origin.originX,
    (origin.floor ?? RENDER_FLOOR) + position.z * exaggeration,
    origin.originY - position.y
  );
}

/** The inverse of `toRender`, for picking and for the forest reveal. */
export function fromRender(
  render: Vec3,
  origin: RenderOrigin,
  exaggeration: number = VERTICAL_EXAGGERATION
): Vec3 {
  const scale = exaggeration === 0 ? 1 : exaggeration;
  return vec3(
    render.x + origin.originX,
    origin.originY - render.z,
    (render.y - (origin.floor ?? RENDER_FLOOR)) / scale
  );
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** FNV-1a over a list of parts, for stable state comparisons in tests. */
export function hashParts(parts: ReadonlyArray<string | number>): string {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = typeof part === 'number' ? formatNumber(part) : part;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

/** Fixed-precision so a hash does not depend on the host's float printing. */
const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf';
  return value.toFixed(6);
};
