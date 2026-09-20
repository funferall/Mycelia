/**
 * The regional survey: what the player knows about each stand, and how the
 * lineage of colonies hangs together.
 *
 * This is a read-only projection of a match — no RNG, no mutation, no
 * renderer — so the same function serves the printed survey layer and the
 * headless regression, and the sheet can never disagree with the simulation
 * about which stands are held.
 *
 * Two knowledge rules are deliberate:
 *
 * - A stand that has never held a colony has never been *surveyed beneath*. Its
 *   terrain and water are visible from the surface and are reported; its forest
 *   health is not, because nobody has been down there to record it.
 * - A colony whose founding chain has been cut is still occupied but no longer
 *   connected to the founding stand. That distinction is the difference between
 *   a region and a set of islands, so the survey keeps it.
 */
import type { RegionalMatch, StandState } from './match';
import { COMMUNITY_LABEL, type StandCommunity } from './region';

export type StandStateName = 'uncolonized' | 'germinating' | 'established' | 'fruiting' | 'closed';
export type StandHealthBand = 'sound' | 'strained' | 'declining';
export type StandWaterBand = 'saturated' | 'shallow' | 'deep';

export interface StandSurvey {
  readonly id: number;
  readonly community: StandCommunity;
  readonly communityLabel: string;
  /** Depth of the water table under this stand, in centimetres. */
  readonly waterCm: number;
  readonly water: StandWaterBand;
  readonly occupied: boolean;
  /** True once a colony has held this stand and its soil has been recorded. */
  readonly surveyed: boolean;
  readonly state: StandStateName;
  /** Mean health of the stand's trees, or null when it has not been surveyed. */
  readonly health: number | null;
  readonly healthBand: StandHealthBand | null;
  readonly trees: number;
  readonly deadTrees: number;
  /** Stand the colony here was founded from, or null for the founding stand. */
  readonly parent: number | null;
  /** Recorded distance from the founding stand, in stand-to-stand hops. */
  readonly hop: number | null;
  /** True when a chain of living colonies reaches the founding stand. */
  readonly connected: boolean;
  readonly fruited: number;
  readonly spores: number;
}

export interface RegionSurvey {
  readonly stands: StandSurvey[];
  readonly total: number;
  readonly held: number;
  readonly surveyed: number;
  /** Founding stand to the deepest reached stand, following the lineage. */
  readonly lineage: number[];
  /** True when every occupied stand still connects to the founding stand. */
  readonly contiguous: boolean;
}

function waterBand(waterCm: number): StandWaterBand {
  if (waterCm <= 45) return 'saturated';
  if (waterCm <= 62) return 'shallow';
  return 'deep';
}

function healthBand(health: number): StandHealthBand {
  if (health >= 0.75) return 'sound';
  if (health >= 0.5) return 'strained';
  return 'declining';
}

/** A colony that still has a living body is a link in the chain. */
function livingColony(stand: StandState): boolean {
  return stand.sim.hasColony && stand.sim.outcome !== 'extinct';
}

function stateOf(stand: StandState): StandStateName {
  if (!stand.sim.hasColony) return 'uncolonized';
  if (stand.sim.outcome !== 'playing') return 'closed';
  if (stand.sim.player.fruited > 0) return 'fruiting';
  // A spore that has just landed is a colony with a body and no network yet.
  return stand.sim.player.lengthCm < 24 ? 'germinating' : 'established';
}

function parentOf(stand: StandState): number | null {
  const arrival = stand.arrivals[stand.arrivals.length - 1];
  return arrival ? arrival.from : null;
}

function surveyStand(stand: StandState): Omit<StandSurvey, 'connected' | 'hop'> {
  const trees = stand.sim.world.trees;
  const deadTrees = trees.filter((tree) => tree.dead).length;
  const surveyed = stand.sim.hasColony;
  const health = surveyed
    ? trees.reduce((sum, tree) => sum + (tree.dead ? 0 : tree.health), 0) / Math.max(1, trees.length)
    : null;
  return {
    id: stand.site.id,
    community: stand.site.community,
    communityLabel: COMMUNITY_LABEL[stand.site.community],
    waterCm: Math.round(stand.site.waterTableCm),
    water: waterBand(stand.site.waterTableCm),
    occupied: stand.sim.hasColony,
    surveyed,
    state: stateOf(stand),
    health,
    healthBand: health === null ? null : healthBand(health),
    trees: trees.length,
    deadTrees,
    parent: parentOf(stand),
    fruited: stand.sim.hasColony ? stand.sim.player.fruited : 0,
    spores: stand.sim.hasColony ? stand.sim.player.spores : 0,
  };
}

/**
 * Project a match into the survey layer's own record.
 *
 * Connectedness is walked from the founding stand over parent links, so a
 * daughter founded across a cut chain is reported as occupied but isolated
 * rather than silently counted as part of the region.
 */
export function buildSurvey(match: RegionalMatch): RegionSurvey {
  const walk = lineageWalk(match);
  const standSurveys: StandSurvey[] = match.stands.map((stand) => ({
    ...surveyStand(stand),
    hop: walk.depth.get(stand.site.id) ?? null,
    // Occupied *and* every link back to the founding stand still alive.
    connected: stand.sim.hasColony && chainAlive(match, stand.site.id, walk.parent),
  }));
  const lineage: number[] = [];
  for (let id: number | undefined = walk.deepest; id !== undefined; id = walk.parent.get(id)) {
    lineage.unshift(id);
  }
  const heldStands = standSurveys.filter((survey) => survey.occupied);
  return {
    stands: standSurveys,
    total: standSurveys.length,
    held: heldStands.length,
    surveyed: standSurveys.filter((survey) => survey.surveyed).length,
    lineage,
    contiguous: heldStands.every((survey) => survey.connected),
  };
}

/**
 * Reconstruct the recorded lineage: which stand each colony was founded from,
 * how far it is from the founding stand, and the longest chain out.
 *
 * This is history, not health. A route stays on the survey after a link in it
 * dies, because the stands really were founded that way; whether the chain is
 * still alive is what `connected` reports separately.
 */
function lineageWalk(match: RegionalMatch): {
  depth: Map<number, number>;
  parent: Map<number, number>;
  deepest: number;
} {
  const founding = match.region.foundingStand;
  const parent = new Map<number, number>();
  for (const stand of match.stands) {
    const link = parentOf(stand);
    if (link !== null && link !== stand.site.id) parent.set(stand.site.id, link);
  }
  const depth = new Map<number, number>([[founding, 0]]);
  // Breadth-first from the founding stand: a stand's lineage is its parent's
  // lineage plus one, and the walk visits every stand at most once.
  let frontier = [founding];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const stand of match.stands) {
        if (parent.get(stand.site.id) !== id || depth.has(stand.site.id)) continue;
        depth.set(stand.site.id, (depth.get(id) ?? 0) + 1);
        next.push(stand.site.id);
      }
    }
    frontier = next;
  }
  // The lineage is the longest recorded chain; ties go to the lower stand id so
  // the printed route is stable for a given seed.
  let deepest = founding;
  let deepestDepth = depth.get(founding) ?? -1;
  for (const [id, value] of [...depth.entries()].sort((a, b) => a[0] - b[0])) {
    if (value > deepestDepth) {
      deepest = id;
      deepestDepth = value;
    }
  }
  return { depth, parent, deepest };
}

/** True when this colony and every ancestor of it still has a living body. */
function chainAlive(match: RegionalMatch, id: number, parent: Map<number, number>): boolean {
  let cursor: number | undefined = id;
  const seen = new Set<number>();
  while (cursor !== undefined) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const stand = match.stands[cursor];
    if (!stand || !livingColony(stand)) return false;
    cursor = parent.get(cursor);
  }
  return true;
}
