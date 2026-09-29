/**
 * Real vertical sections through the region (`VIEW-06`).
 *
 * A section is a slab of finite thickness in canonical region coordinates: a
 * plane pinned to one horizontal axis, running along the other, and reaching
 * from the ground down to a stated depth. Everything here is pure arithmetic
 * over the same `Vec3` positions the simulation owns, so a section can be
 * clipped, followed and checked without a renderer, and the strand a player
 * clicks is the strand whose real coordinates were clipped.
 *
 * The two rules that matter most:
 *
 * - **Clips, never breaks.** A strand that passes through the slab with both
 *   endpoints outside it is drawn, and the points where it enters and leaves are
 *   reported as continuation marks. Nothing here touches simulation state: a
 *   section is a view of the one body, not a copy of it.
 * - **The seam is not an edge.** A slab may span two stands; an edge that
 *   crosses the boundary is one segment, and the section reports it once.
 */
import { STAND_SIZE, type Region, type StandCommunity } from '../sim/region';
import { GRID } from '../sim/content';
import { elevationAtDepthCm, planePoint, type SectionPlane, type StandId, type Vec3 } from '../sim/spatial';

/**
 * Neighbouring sections sit this far apart, in region units.
 *
 * Equal to the slab's thickness, so the sections tile a stand: every strand in
 * a stand lies inside exactly one of them, and "follow the connection" always
 * lands on a section that really contains the far end.
 */
export const SECTION_STEP = 4;
/** Half-thickness of one section's slab. The plan's suggested 4-unit thickness. */
export const SECTION_HALF_WIDTH = 2;
/** How deep a section reaches below the local ground, in centimetres. */
export const SECTION_DEPTH_CM = 70;
/** Which way a section runs. `east-west` is a plane of constant `y`. */
export type SectionAxis = 'east-west' | 'north-south';

export interface SectionSpec {
  /** Stable id: `stand:axis:index`. The same section always has the same key. */
  readonly id: string;
  readonly standId: StandId;
  readonly axis: SectionAxis;
  /** Which horizontal axis the plane runs along, and where it is pinned. */
  readonly plane: SectionPlane;
  /** Slab half-thickness, so a strand just outside the plane still appears. */
  readonly halfWidth: number;
  /** Extent along the plane, in region units. */
  readonly alongFrom: number;
  readonly alongTo: number;
  /** Vertical extent, as depth below the local ground. */
  readonly depthFromCm: number;
  readonly depthToCm: number;
}

/** A strand as the section sees it: clipped, and still the same edge. */
export interface ClippedEdge {
  readonly key: string;
  readonly parent: number;
  readonly child: number;
  /** The clipped portion actually inside the slab. */
  readonly from: Vec3;
  readonly to: Vec3;
  readonly depthFromCm: number;
  readonly depthToCm: number;
  readonly thickness: number;
  readonly reinforced: boolean;
  readonly connected: boolean;
  /** Where the strand leaves the slab, for the continuation marks. */
  readonly exits: Array<{ at: Vec3; side: 'enter' | 'leave' }>;
  readonly standId: StandId;
  readonly parentStandId: StandId;
}

/** The minimum a section needs to know about a strand. */
export interface SectionEdge {
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

export interface SectionClip {
  readonly visible: ClippedEdge[];
  /** Edges whose whole visible portion is a single point: they only cross it. */
  readonly pierced: number;
}

/** Depth below the local ground at a point, in centimetres. */
export const depthCmAt = (region: Region, point: Vec3): number =>
  (region.heightAt(point.x, point.y) - point.z) * GRID.cmPerRow;

/** The horizontal coordinate a section is pinned to. */
export const sectionFixed = (spec: SectionSpec): number => spec.plane.fixed;

/** True when a point lies inside the slab and its depth range. */
export function sectionContains(region: Region, spec: SectionSpec, point: Vec3, slack = 0): boolean {
  const along = spec.plane.along === 'x' ? point.x : point.y;
  const fixed = spec.plane.along === 'x' ? point.y : point.x;
  if (Math.abs(fixed - spec.plane.fixed) > spec.halfWidth + slack) return false;
  if (along < spec.alongFrom - slack || along > spec.alongTo + slack) return false;
  const depth = depthCmAt(region, point);
  return depth >= spec.depthFromCm - slack && depth <= spec.depthToCm + slack;
}

/**
 * The plane a point belongs to, out of a stand's own sections.
 *
 * Used by "follow connection" and by clicking a projected strand: the answer is
 * a real section id, not a new one invented for the click.
 */
export function sectionForPoint(
  region: Region,
  sections: readonly SectionSpec[],
  point: Vec3,
  axis?: SectionAxis
): SectionSpec | null {
  let best: SectionSpec | null = null;
  let bestDistance = Infinity;
  for (const spec of sections) {
    if (axis && spec.axis !== axis) continue;
    const fixed = spec.plane.along === 'x' ? point.y : point.x;
    const distance = Math.abs(fixed - spec.plane.fixed);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = spec;
    }
  }
  void region;
  return best;
}

/** Every section across one stand, east-west family first, then north-south. */
export function sectionsForStand(region: Region, standId: StandId): SectionSpec[] {
  const site = region.stands[standId];
  if (!site) return [];
  const out: SectionSpec[] = [];
  for (const axis of ['east-west', 'north-south'] as const) {
    const along = axis === 'east-west' ? 'x' : 'y';
    const across = axis === 'east-west' ? 'y' : 'x';
    const acrossOrigin = across === 'y' ? site.sy * STAND_SIZE : site.sx * STAND_SIZE;
    const alongOrigin = along === 'x' ? site.sx * STAND_SIZE : site.sy * STAND_SIZE;
    let index = 0;
    for (let fixed = acrossOrigin + SECTION_STEP / 2; fixed < acrossOrigin + STAND_SIZE; fixed += SECTION_STEP) {
      out.push({
        id: `${standId}:${axis === 'east-west' ? 'ew' : 'ns'}:${index}`,
        standId,
        axis,
        plane: { along, fixed },
        halfWidth: SECTION_HALF_WIDTH,
        alongFrom: alongOrigin,
        alongTo: alongOrigin + STAND_SIZE,
        depthFromCm: 0,
        depthToCm: SECTION_DEPTH_CM,
      });
      index++;
    }
  }
  return out;
}

/**
 * Clip one strand into a section's slab.
 *
 * The segment is clipped against three pairs of half-spaces - the slab's two
 * faces, the section's extent along the plane, and its depth range - so a
 * strand that crosses the slab with both endpoints outside it is still drawn.
 */
export function clipEdge(region: Region, spec: SectionSpec, edge: SectionEdge): ClippedEdge | null {
  const alongOf = (point: Vec3): number => (spec.plane.along === 'x' ? point.x : point.y);
  const fixedOf = (point: Vec3): number => (spec.plane.along === 'x' ? point.y : point.x);
  const depthFrom = depthCmAt(region, edge.from);
  const depthTo = depthCmAt(region, edge.to);

  let tMin = 0;
  let tMax = 1;
  // Each constraint narrows [tMin, tMax]; an empty interval means the strand
  // never enters this slab.
  const constrain = (valueFrom: number, valueTo: number, low: number, high: number): boolean => {
    const delta = valueTo - valueFrom;
    if (Math.abs(delta) < 1e-9) return valueFrom >= low && valueFrom <= high;
    const a = (low - valueFrom) / delta;
    const b = (high - valueFrom) / delta;
    const enter = Math.max(tMin, Math.min(a, b));
    const leave = Math.min(tMax, Math.max(a, b));
    if (enter > leave) return false;
    tMin = enter;
    tMax = leave;
    return true;
  };

  const fixed = spec.plane.fixed;
  if (
    !constrain(fixedOf(edge.from), fixedOf(edge.to), fixed - spec.halfWidth, fixed + spec.halfWidth) ||
    !constrain(alongOf(edge.from), alongOf(edge.to), spec.alongFrom, spec.alongTo) ||
    !constrain(depthFrom, depthTo, spec.depthFromCm, spec.depthToCm)
  ) {
    return null;
  }
  if (tMax - tMin < 1e-6) return null;

  const at = (t: number): Vec3 => ({
    x: edge.from.x + (edge.to.x - edge.from.x) * t,
    y: edge.from.y + (edge.to.y - edge.from.y) * t,
    z: edge.from.z + (edge.to.z - edge.from.z) * t,
  });
  const exits: Array<{ at: Vec3; side: 'enter' | 'leave' }> = [];
  if (tMin > 1e-6) exits.push({ at: at(tMin), side: 'enter' });
  if (tMax < 1 - 1e-6) exits.push({ at: at(tMax), side: 'leave' });
  return {
    key: edge.key,
    parent: edge.parent,
    child: edge.child,
    from: at(tMin),
    to: at(tMax),
    depthFromCm: depthFrom + (depthTo - depthFrom) * tMin,
    depthToCm: depthFrom + (depthTo - depthFrom) * tMax,
    thickness: edge.thickness,
    reinforced: edge.reinforced,
    connected: edge.connected,
    exits,
    standId: edge.standId,
    parentStandId: edge.parentStandId,
  };
}

/** Every strand this section can show, in a stable order. */
export function clipEdges(region: Region, spec: SectionSpec, edges: readonly SectionEdge[]): SectionClip {
  const visible: ClippedEdge[] = [];
  let pierced = 0;
  for (const edge of edges) {
    const clipped = clipEdge(region, spec, edge);
    if (!clipped) continue;
    const length = Math.hypot(
      clipped.to.x - clipped.from.x,
      clipped.to.y - clipped.from.y,
      clipped.to.z - clipped.from.z
    );
    if (length < 0.05) pierced++;
    visible.push(clipped);
  }
  visible.sort(
    (a, b) =>
      a.parent - b.parent ||
      a.child - b.child ||
      a.depthFromCm - b.depthFromCm
  );
  return { visible, pierced };
}

/** Where a section's camera should look: its own plane, at mid depth. */
export function sectionAnchor(region: Region, spec: SectionSpec): Vec3 {
  const along = (spec.alongFrom + spec.alongTo) / 2;
  const point = planePoint(spec.plane, along);
  const depth = (spec.depthFromCm + spec.depthToCm) / 2;
  return { x: point.x, y: point.y, z: elevationAtDepthCm(region, point.x, point.y, depth) };
}

/** "Stand 5 · Hemlock ravine · across the slope at 36.5" - a section's name. */
export function sectionLabel(
  region: Region,
  spec: SectionSpec,
  names: Readonly<Record<string, string>>
): string {
  const site = region.stands[spec.standId];
  const community = site ? (names[site.community as StandCommunity] ?? site.community) : 'ground';
  const orientation = spec.axis === 'east-west' ? 'across the slope' : 'up the slope';
  return `Stand ${spec.standId + 1} \u00b7 ${community} \u00b7 ${orientation} at ${spec.plane.fixed.toFixed(1)}`;
}

/** The sections a player may browse: a reached stand and its neighbours. */
export function browsableSections(region: Region, standIds: readonly StandId[]): SectionSpec[] {
  const out: SectionSpec[] = [];
  for (const standId of standIds) out.push(...sectionsForStand(region, standId));
  return out;
}

/**
 * Sections on the same regional corridor, in physical order. East-west
 * sections step north/south within one stand column; north-south sections step
 * east/west within one stand row. Other rows/columns are separate corridors.
 */
function sectionCorridor(sections: readonly SectionSpec[], current: SectionSpec): SectionSpec[] {
  return sections.filter((spec) =>
    spec.axis === current.axis &&
    spec.alongFrom === current.alongFrom &&
    spec.alongTo === current.alongTo
  ).sort((a, b) => a.plane.fixed - b.plane.fixed);
}

/** The next physical slab, including across an interior stand boundary. */
export function stepSection(
  sections: readonly SectionSpec[],
  current: SectionSpec,
  delta: number
): SectionSpec {
  const family = sectionCorridor(sections, current);
  const index = family.findIndex((spec) => spec.id === current.id);
  if (index < 0 || family.length === 0) return current;
  const next = Math.max(0, Math.min(family.length - 1, index + delta));
  const candidate = family[next];
  // A caller may supply only some browsable stands. Never jump an unseen tile.
  return candidate && Math.abs(candidate.plane.fixed - current.plane.fixed) <= Math.abs(delta) * SECTION_STEP + 1e-6
    ? candidate : current;
}

/** How far along its family a section sits, for the readout. */
export function sectionOrder(sections: readonly SectionSpec[], current: SectionSpec): { index: number; count: number } {
  const family = sectionCorridor(sections, current);
  const index = family.findIndex((spec) => spec.id === current.id);
  return { index: index < 0 ? 0 : index, count: family.length };
}

/** Which way the other family runs, for a section the player flips to. */
export const crossAxis = (axis: SectionAxis): SectionAxis =>
  axis === 'east-west' ? 'north-south' : 'east-west';

/** The section in the same stand on the other family, nearest the same point. */
export function flipSection(
  region: Region,
  sections: readonly SectionSpec[],
  current: SectionSpec
): SectionSpec {
  const anchor = sectionAnchor(region, current);
  return sectionForPoint(region, sections.filter((spec) => spec.standId === current.standId), anchor, crossAxis(current.axis)) ?? current;
}
