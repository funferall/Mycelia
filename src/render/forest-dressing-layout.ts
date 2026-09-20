/**
 * Where the forest's background vegetation stands (`ASSET-04`, `MAP-05`).
 *
 * This module is deliberately free of Three.js, the DOM and any simulation RNG.
 * It answers one question - which decorative trees, saplings and ground props
 * belong at which regional positions - so the decision can be checked headlessly
 * and so the renderer never decides ecology while drawing.
 *
 * The rules it obeys:
 *
 * - **Regional coordinates, one owner.** Candidates are generated in cells of
 *   the whole region, not per stand, and each belongs to exactly one stand by
 *   half-open bounds. A tree near a shared edge is evaluated once by the same
 *   density field as the trees beside it, so habitat changes read as habitat
 *   rather than as tile seams.
 * - **Deterministic priorities.** Every property of a candidate comes from a
 *   hash of the seed and its cell, so the layout cannot depend on the order
 *   stands were built in, on the camera, or on anything the player did.
 * - **Clusters and gaps.** A low-frequency density field lifts some ground and
 *   leaves other ground thin; spacing between accepted trees is a function of
 *   their own crown size, so clumps form and clearings stay open instead of a
 *   uniform scatter filling every square metre.
 * - **No invented ecology.** Background vegetation has no health, no roots, no
 *   economy and no bond. It is scenery, and it is keyed in its own namespace so
 *   it can never be mistaken for a playable tree.
 * - **Masks that matter.** The open channel, the playable trunks and the ground
 *   around them are excluded before a candidate is ever placed, and everything
 *   is seated on the region's own `heightAt`.
 */
import { STAND_SIZE, type StandCommunity } from '../sim/region';
import { makeNoise2D } from '../sim/rng';
import { treeLocalOffset } from '../sim/spatial';

/** Background canopy target per stand, before the community's own lean. */
export const DRESSING_BANDS = {
  sparse: 24,
  medium: 80,
  dense: 112,
} as const;

export type DressingBand = keyof typeof DRESSING_BANDS;

/** Candidate grid. Small enough to read the terrain, coarse enough to be cheap. */
export const DRESSING_CELL = 6;
/** Spacing buckets. Wider than the largest possible spacing, so one ring of
 *  neighbours is always enough to find every conflict. */
const SPACING_BUCKET = 12;

export type DecorationKind = 'canopy' | 'young' | 'fern' | 'grass' | 'rock' | 'deadwood';

/**
 * Assets the dressing may ask for. A string union rather than a dependency on
 * the asset registry, so this module stays importable without Three.js.
 */
export type DecorationAsset =
  | 'tree.oak'
  | 'tree.birch'
  | 'tree.hemlock'
  | 'understory.oak-sapling'
  | 'understory.birch-sapling'
  | 'understory.hemlock-sapling'
  | 'understory.fern'
  | 'understory.grass'
  | 'prop.boulder'
  | 'prop.log'
  | 'prop.stump'
  | 'prop.snag';

/**
 * One piece of background vegetation.
 *
 * `id` is a decoration key, in its own namespace: it can never collide with a
 * simulation tree's `standId:treeId`, and nothing downstream may resolve one as
 * the other.
 */
export interface ForestDecoration {
  readonly id: string;
  readonly standId: number;
  readonly kind: DecorationKind;
  readonly asset: DecorationAsset;
  /** Regional horizontal position and absolute ground elevation. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Height in world units, and a modest yaw. */
  readonly height: number;
  readonly yaw: number;
  /** 0..1 wind phase offset, so a stand does not sway as one body. */
  readonly phase: number;
  readonly community: StandCommunity;
  /** Which candidate cell produced it, for the layout's own checks. */
  readonly cell: string;
}

/** What one stand contributes to the layout. */
export interface DressingStand {
  readonly id: number;
  readonly sx: number;
  readonly sy: number;
  readonly community: StandCommunity;
  readonly moisture: number;
  readonly drainage: number;
  readonly flow: number;
  readonly elevation: number;
  readonly high: number;
  readonly low: number;
  readonly waterTableCm: number;
}

export interface DressingRegion {
  readonly seed: number;
  readonly cols: number;
  readonly rows: number;
  readonly stands: readonly DressingStand[];
  /** Ground elevation anywhere in the region. */
  heightAt(x: number, y: number): number;
  /** Normalised flow accumulation; the channel is where this is highest. */
  flowAt(x: number, y: number): number;
}

/** A playable trunk to keep clear of, in regional coordinates. */
export interface PlayableTrunk {
  readonly standId: number;
  readonly treeId: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

export interface DressingInput {
  readonly region: DressingRegion;
  /** Playable trunks, which keep a crown-sized clearing around them. */
  readonly playable?: readonly PlayableTrunk[];
  /** The stream's course, for the channel mask. */
  readonly course?: ReadonlyArray<{ x: number; y: number }>;
  readonly band?: DressingBand;
  /** Restrict the layout to these stands, for the single-community fixture. */
  readonly stands?: readonly number[];
}

/**
 * How one community leans. Multipliers are relative to the band's own count, so
 * tuning the band moves every community together.
 */
interface CommunityProfile {
  /** Cumulative species thresholds: oak, birch, then hemlock. */
  readonly mix: readonly [number, number];
  /** Canopy density. Above 1 is open ground with room to spare. */
  readonly canopy: number;
  /** Regeneration: saplings in gaps and along edges. */
  readonly young: number;
  readonly fern: number;
  readonly grass: number;
  readonly rock: number;
  readonly deadwood: number;
  /** Scales the trunk height of this community's background trees. */
  readonly stature: number;
}

/**
 * The community table. These are the trial leanings the fuller-forest plan
 * asks for, not tuned acceptance values: oak ridges stay open and dry, hemlock
 * ravines close over, birch hollows fill with young growth, stream corridors
 * keep their channel clear, and clearings are mostly saplings and grass.
 */
export const COMMUNITY_DRESSING: Record<StandCommunity, CommunityProfile> = {
  'oak-ridge': { mix: [0.85, 0.95], canopy: 0.72, young: 0.5, fern: 0.35, grass: 1.3, rock: 1.5, deadwood: 0.5, stature: 1.15 },
  'mixed-slope': { mix: [0.45, 0.8], canopy: 1, young: 0.8, fern: 1, grass: 1, rock: 0.8, deadwood: 1, stature: 1 },
  'birch-hollow': { mix: [0.2, 0.8], canopy: 1.05, young: 1.6, fern: 1.2, grass: 0.9, rock: 0.5, deadwood: 1.2, stature: 0.92 },
  'hemlock-ravine': { mix: [0.1, 0.35], canopy: 1.25, young: 0.7, fern: 1.7, grass: 0.45, rock: 0.7, deadwood: 1, stature: 1.1 },
  'stream-corridor': { mix: [0.2, 0.65], canopy: 0.95, young: 1.2, fern: 1.3, grass: 0.9, rock: 1.2, deadwood: 1.1, stature: 1 },
  'wetland-edge': { mix: [0.1, 0.7], canopy: 0.85, young: 1.3, fern: 1.4, grass: 1.2, rock: 0.4, deadwood: 0.8, stature: 0.95 },
  'recovering-clearing': { mix: [0.3, 0.8], canopy: 0.5, young: 2, fern: 0.5, grass: 1.5, rock: 0.9, deadwood: 1.4, stature: 0.85 },
};

/** Half-width of the open channel, from the same rule the soil volume uses. */
const channelHalfWidth = (flow: number): number => 1.5 + Math.max(0, Math.min(1, flow)) * 4;

/** Deterministic 0..1 value for one cell and one purpose. */
function cellHash(seed: number, cx: number, cy: number, purpose: number): number {
  let h = (seed ^ 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (cx + 0x7ed55d16), 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ (cy + 0x165667b1), 0x2545f491) >>> 0;
  h = Math.imul(h ^ (purpose + 1), 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h ^ (h >>> 7), 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Distance from a point to the region's stream course, in world units. */
export function distanceToCourse(
  course: ReadonlyArray<{ x: number; y: number }>,
  x: number,
  y: number
): number {
  let best = Infinity;
  for (let i = 0; i < course.length; i++) {
    const a = course[i] as { x: number; y: number };
    const b = course[Math.min(course.length - 1, i + 1)] as { x: number; y: number };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
    const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Where a stand's playable trunks actually stand, in regional coordinates.
 *
 * The half-unit difference between a trunk's stored column and a cell centre is
 * deliberately not applied here: these positions exist to keep scenery away
 * from the tree the player can select, so the crown's own footprint is what
 * matters, not the centimetre.
 */
export function playableTrunkPositions(
  stands: ReadonlyArray<{ id: number; sx: number; sy: number }>,
  treesFor: (standId: number) => ReadonlyArray<{ id: number; gx: number; seed: number; height: number }>
): PlayableTrunk[] {
  const trunks: PlayableTrunk[] = [];
  for (const stand of stands) {
    for (const tree of treesFor(stand.id)) {
      trunks.push({
        standId: stand.id,
        treeId: tree.id,
        x: stand.sx * STAND_SIZE + tree.gx,
        y: stand.sy * STAND_SIZE + treeLocalOffset(tree.seed),
        height: tree.height,
      });
    }
  }
  return trunks;
}

/** The stand that owns a regional position, by half-open bounds. */
function standIndexAt(region: DressingRegion, x: number, y: number): number {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= region.cols * STAND_SIZE ||
    y >= region.rows * STAND_SIZE
  ) {
    return -1;
  }
  const sx = Math.floor(x / STAND_SIZE);
  const sy = Math.floor(y / STAND_SIZE);
  return sy * region.cols + sx;
}

interface Candidate {
  kind: DecorationKind;
  standId: number;
  x: number;
  y: number;
  height: number;
  yaw: number;
  phase: number;
  priority: number;
  asset: DecorationAsset;
  cell: string;
  radius: number;
}

/** Crown radius of a candidate, for spacing. */
const radiusOf = (kind: DecorationKind, height: number): number =>
  kind === 'canopy' || kind === 'young' ? Math.max(2, height * 0.36) : Math.max(0.9, height * 0.7);

/**
 * Minimum distance between two accepted decorations of these sizes.
 *
 * Deliberately below the sum of the two crown radii: neighbourhood trees are
 * meant to close canopy over each other, and it is the gaps that should read as
 * clearings rather than the trunks that read as a planting grid.
 */
const spacingBetween = (a: number, b: number): number => Math.max(1.8, 0.62 * (a + b));

/**
 * Lay out the region's background vegetation.
 *
 * Pure: the same input always produces the same list, no matter what else the
 * process has done, and nothing in the input is modified.
 */
export function layoutForestDressing(input: DressingInput): ForestDecoration[] {
  const { region } = input;
  const band = input.band ?? 'sparse';
  const base = DRESSING_BANDS[band];
  const only = input.stands ? new Set(input.stands) : null;
  const playable = input.playable ?? [];
  const course = input.course ?? [];

  // Two low-frequency fields: one decides where the canopy gathers, the other
  // gives each patch of ground its own character. Both are hashed lattices, so
  // they cannot be consumed by anything else.
  const pocket = makeNoise2D((region.seed ^ 0x51ed270b) >>> 0, 3, 0.013);
  const grain = makeNoise2D((region.seed ^ 0x1b873593) >>> 0, 2, 0.061);

  const profiles = new Map<number, CommunityProfile>();
  const budgets = new Map<number, Record<DecorationKind, number>>();
  for (const stand of region.stands) {
    const profile = COMMUNITY_DRESSING[stand.community];
    profiles.set(stand.id, profile);
    // A stand's own ground lifts or thins the whole square, so two stands of the
    // same community are not copies of each other.
    const macro = 0.75 + pocket((stand.sx + 0.5) * STAND_SIZE, (stand.sy + 0.5) * STAND_SIZE) * 0.5;
    const canopy = Math.round(base * profile.canopy * macro);
    budgets.set(stand.id, {
      canopy,
      young: Math.round(canopy * 0.4 * profile.young),
      fern: Math.round(canopy * 0.5 * profile.fern),
      grass: Math.round(canopy * 0.7 * profile.grass),
      rock: Math.round(canopy * 0.18 * profile.rock),
      deadwood: Math.round(canopy * 0.12 * profile.deadwood),
    });
  }

  // 1. Candidates, in region cells. Each cell is evaluated once, so a tree on a
  //    shared edge is emitted once and belongs to exactly one stand.
  const candidates: Candidate[] = [];
  const cellsX = Math.ceil((region.cols * STAND_SIZE) / DRESSING_CELL);
  const cellsY = Math.ceil((region.rows * STAND_SIZE) / DRESSING_CELL);
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const x = (cx + 0.12 + cellHash(region.seed, cx, cy, 0) * 0.76) * DRESSING_CELL;
      const y = (cy + 0.12 + cellHash(region.seed, cx, cy, 1) * 0.76) * DRESSING_CELL;
      const standId = standIndexAt(region, x, y);
      if (standId < 0) continue;
      if (only && !only.has(standId)) continue;
      const stand = region.stands[standId];
      const profile = profiles.get(standId);
      if (!stand || !profile) continue;

      const density = pocket(x, y) * 0.6 + grain(x, y) * 0.4;
      const cell = `${cx},${cy}`;

      // Canopy: the cell's own roll decides whether it is a tree, and the
      // density field decides how likely that is to be accepted later.
      const roll = cellHash(region.seed, cx, cy, 2);
      const kindRoll = cellHash(region.seed, cx, cy, 3);
      const yaw = cellHash(region.seed, cx, cy, 4) * Math.PI * 2;
      const phase = cellHash(region.seed, cx, cy, 5);
      const species = cellHash(region.seed, cx, cy, 6);
      const canopyAsset: DecorationAsset =
        species < profile.mix[0] ? 'tree.oak' : species < profile.mix[1] ? 'tree.birch' : 'tree.hemlock';
      const stature = profile.stature * (0.82 + cellHash(region.seed, cx, cy, 7) * 0.38);
      // Background canopy is meant to stand over the understory, not beside it:
      // it is the layer the region's silhouette is made of.
      const canopyHeight =
        (canopyAsset === 'tree.oak' ? 19 : canopyAsset === 'tree.birch' ? 16 : 17) * stature * 1.08;
      const saplingAsset: DecorationAsset =
        species < profile.mix[0]
          ? 'understory.oak-sapling'
          : species < profile.mix[1]
            ? 'understory.birch-sapling'
            : 'understory.hemlock-sapling';

      candidates.push({
        kind: 'canopy',
        standId,
        x,
        y,
        height: canopyHeight,
        yaw,
        phase,
        priority: roll + density * 0.45,
        asset: canopyAsset,
        cell,
        radius: radiusOf('canopy', canopyHeight),
      });

      // Regeneration, ground cover and deadwood: one extra candidate per cell,
      // chosen by the community's own lean rather than placed on a grid. The
      // shares are cumulative thresholds on the cell's roll.
      const wet = 1 - Math.max(0, Math.min(1, (stand.waterTableCm - 30) / 70));
      const share = (value: number, low: number, high: number): number =>
        Math.max(low, Math.min(high, value));
      const youngShare = share(0.16 * profile.young, 0.05, 0.4);
      const grassShare = share(0.22 * profile.grass, 0.05, 0.35);
      const fernShare = share(0.3 * profile.fern, 0.05, 0.5);
      const rockShare = share(0.05 * profile.rock, 0.01, 0.08);
      const deadwoodShare = share(0.05 * profile.deadwood * (1 - wet * 0.5), 0.01, 0.1);
      let kind: DecorationKind = 'fern';
      let asset: DecorationAsset = 'understory.fern';
      let height = 1.1 + kindRoll * 1.3;
      if (kindRoll < youngShare) {
        kind = 'young';
        asset = saplingAsset;
        height = 3 + (kindRoll / youngShare) * 4.5;
      } else if (kindRoll < youngShare + grassShare) {
        kind = 'grass';
        asset = 'understory.grass';
        height = 0.55 + kindRoll * 0.6;
      } else if (kindRoll < youngShare + grassShare + fernShare) {
        kind = 'fern';
        asset = 'understory.fern';
      } else if (kindRoll < youngShare + grassShare + fernShare + deadwoodShare) {
        kind = 'deadwood';
        asset = kindRoll > 0.9 ? 'prop.snag' : 'prop.log';
        height = 1 + kindRoll * 1.1;
      } else if (kindRoll > 1 - rockShare) {
        kind = 'rock';
        asset = 'prop.boulder';
        height = 0.7 + (1 - kindRoll) * 3;
      }
      candidates.push({
        kind,
        standId,
        x: x + (cellHash(region.seed, cx, cy, 8) - 0.5) * DRESSING_CELL * 0.5,
        y: y + (cellHash(region.seed, cx, cy, 9) - 0.5) * DRESSING_CELL * 0.5,
        height,
        yaw: cellHash(region.seed, cx, cy, 10) * Math.PI * 2,
        phase: cellHash(region.seed, cx, cy, 11),
        priority: cellHash(region.seed, cx, cy, 12) + density * 0.45,
        asset,
        cell,
        radius: radiusOf(kind, height),
      });
    }
  }

  // 2. Accept highest priority first, so patches fill from their richest ground
  //    outward and the ordering never depends on which stand was built first.
  candidates.sort((a, b) => b.priority - a.priority || (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0));

  const accepted: Candidate[] = [];
  const counts = new Map<number, Record<DecorationKind, number>>();
  const buckets = new Map<string, Candidate[]>();
  const bucketKey = (x: number, y: number): string =>
    `${Math.floor(x / SPACING_BUCKET)},${Math.floor(y / SPACING_BUCKET)}`;
  const near = (candidate: Candidate): boolean => {
    const bx = Math.floor(candidate.x / SPACING_BUCKET);
    const by = Math.floor(candidate.y / SPACING_BUCKET);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const list = buckets.get(`${bx + ox},${by + oy}`);
        if (!list) continue;
        for (const other of list) {
          if (Math.hypot(other.x - candidate.x, other.y - candidate.y) < spacingBetween(candidate.radius, other.radius)) {
            return true;
          }
        }
      }
    }
    return false;
  };

  for (const candidate of candidates) {
    if (standIndexAt(region, candidate.x, candidate.y) !== candidate.standId) continue;
    const budget = budgets.get(candidate.standId);
    const used = counts.get(candidate.standId) ?? { canopy: 0, young: 0, fern: 0, grass: 0, rock: 0, deadwood: 0 };
    if (!budget || used[candidate.kind] >= budget[candidate.kind]) continue;
    if (!maskAllows(region, candidate, playable, course)) continue;
    if (near(candidate)) continue;
    used[candidate.kind]++;
    counts.set(candidate.standId, used);
    accepted.push(candidate);
    const key = bucketKey(candidate.x, candidate.y);
    const list = buckets.get(key);
    if (list) list.push(candidate);
    else buckets.set(key, [candidate]);
  }

  // 3. Stable ids in the decoration namespace, ordered by stand then position so
  //    a re-layout after a resize or a re-entry produces the same keys.
  accepted.sort(
    (a, b) =>
      a.standId - b.standId ||
      a.kind.localeCompare(b.kind) ||
      a.y - b.y ||
      a.x - b.x
  );
  const perStand = new Map<number, number>();
  return accepted.map((candidate) => {
    const n = (perStand.get(candidate.standId) ?? 0) + 1;
    perStand.set(candidate.standId, n);
    const stand = region.stands[candidate.standId] as DressingStand;
    return {
      id: `dressing:${candidate.standId}:${n}`,
      standId: candidate.standId,
      kind: candidate.kind,
      asset: candidate.asset,
      x: candidate.x,
      y: candidate.y,
      z: region.heightAt(candidate.x, candidate.y),
      height: candidate.height,
      yaw: candidate.yaw,
      phase: candidate.phase,
      community: stand.community,
      cell: candidate.cell,
    };
  });
}

/**
 * The exclusion masks: open water, the banks right beside it, and the crowns and
 * sightlines of the trees the player can actually select.
 */
function maskAllows(
  region: DressingRegion,
  candidate: Candidate,
  playable: readonly PlayableTrunk[],
  course: ReadonlyArray<{ x: number; y: number }>
): boolean {
  const flow = region.flowAt(candidate.x, candidate.y);
  const wet = candidate.kind === 'canopy' || candidate.kind === 'young';
  // The channel itself is never planted, and its immediate bank is left clear so
  // the water reads as a feature rather than something growing over.
  if (flow >= 0.9) return false;
  if (course.length > 0 && flow >= 0.3) {
    const distance = distanceToCourse(course, candidate.x, candidate.y);
    if (distance <= channelHalfWidth(flow) + (wet ? 0.8 : 0.2)) return false;
  }
  if (wet) {
    for (const trunk of playable) {
      const keepOut = Math.max(4, trunk.height * 0.55);
      if (Math.hypot(trunk.x - candidate.x, trunk.y - candidate.y) < keepOut) return false;
    }
  }
  return true;
}

/** A quick readout for the bench and for the verification record. */
export function dressingSummary(
  decorations: readonly ForestDecoration[]
): {
  total: number;
  perStand: number[];
  byKind: Record<DecorationKind, number>;
  byCommunity: Record<string, number>;
  byAsset: Record<string, number>;
} {
  const byKind: Record<DecorationKind, number> = { canopy: 0, young: 0, fern: 0, grass: 0, rock: 0, deadwood: 0 };
  const byCommunity: Record<string, number> = {};
  const byAsset: Record<string, number> = {};
  const perStand: number[] = [];
  for (const decoration of decorations) {
    byKind[decoration.kind]++;
    byCommunity[decoration.community] = (byCommunity[decoration.community] ?? 0) + 1;
    byAsset[decoration.asset] = (byAsset[decoration.asset] ?? 0) + 1;
    perStand[decoration.standId] = (perStand[decoration.standId] ?? 0) + 1;
  }
  for (let i = 0; i < perStand.length; i++) perStand[i] = perStand[i] ?? 0;
  return { total: decorations.length, perStand, byKind, byCommunity, byAsset };
}
