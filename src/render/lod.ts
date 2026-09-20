/**
 * Level-of-detail selection by how large a tree actually is on screen.
 *
 * Kept free of Three.js and the DOM on purpose: the renderer only has to supply
 * two numbers — the tree's height in world units and its distance from the
 * camera — and the decision can be exercised in a headless test without a
 * browser or a GPU.
 *
 * The unit is the fraction of the viewport's own height a tree covers. Pixel
 * counts would tie the choice to the drawing buffer, so the opt-in fast QA
 * preset (which halves the buffer) would silently change which meshes load;
 * a fraction is the same number at every resolution.
 */

/** Tiers the authored pack ships: LOD0, LOD1, LOD2 from finest to coarsest. */
export const LOD_TIERS = 3;

export interface LodBands {
  /** Fraction of viewport height at which a tree earns LOD0 instead of LOD1. */
  readonly lod0: number;
  /** Fraction of viewport height at which a tree earns LOD1 instead of LOD2. */
  readonly lod1: number;
  /** Relative margin on each boundary; see `selectLodTier`. */
  readonly hysteresis: number;
}

/**
 * Calibrated against the game's own framing at a 30° field of view: a tree is
 * roughly 3% of the viewport at the region overview (where LOD2 is plenty at
 * 266 triangles), about 12% when the camera focuses one crown (LOD1), and over
 * 20% when the player has zoomed right in (LOD0).
 */
export const DEFAULT_LOD_BANDS: LodBands = {
  lod0: 0.14,
  lod1: 0.045,
  hysteresis: 0.15,
};

/**
 * Fraction of the viewport's height a world-space height covers at a distance,
 * for a perspective camera. A full viewport is two NDC units tall, so the
 * half-angle tangent is doubled.
 */
export function projectedHeightFraction(
  worldHeight: number,
  distance: number,
  fovDegrees: number
): number {
  if (!(worldHeight > 0) || !(distance > 0)) return 0;
  const halfTan = Math.tan(((fovDegrees * Math.PI) / 180) / 2);
  if (!(halfTan > 0)) return 0;
  return worldHeight / (2 * distance * halfTan);
}

function clampTier(tier: number): number {
  if (!Number.isFinite(tier)) return 0;
  return Math.min(LOD_TIERS - 1, Math.max(0, Math.round(tier)));
}

/**
 * The tier a tree should wear, given its projected height and what it wears now.
 *
 * Each boundary is crossed at a different value in each direction: leaving a
 * tier needs the projected size to fall below `threshold * (1 - hysteresis)`,
 * and returning needs it to rise above `threshold * (1 + hysteresis)`. A tree
 * sitting exactly on a boundary therefore has one stable answer instead of two,
 * which is what stops a crow's-nest of flickering meshes at the threshold.
 *
 * A tree may move only one tier per call, unless the projected size has crossed
 * both boundaries at once (a cut or a jump, not a glide), in which case the
 * coarser or finer tier is taken directly.
 */
export function selectLodTier(
  projectedFraction: number,
  current: number,
  bands: LodBands = DEFAULT_LOD_BANDS
): number {
  const now = clampTier(current);
  const fraction = Number.isFinite(projectedFraction) ? Math.max(0, projectedFraction) : 0;
  const margin = Math.max(0, bands.hysteresis);
  // Thresholds read as: to enter a finer tier / to fall out of one.
  const enter0 = bands.lod0 * (1 + margin);
  const leave0 = bands.lod0 * (1 - margin);
  const enter1 = bands.lod1 * (1 + margin);
  const leave1 = bands.lod1 * (1 - margin);

  if (now === 0) {
    if (fraction < leave1) return 2;
    if (fraction < leave0) return 1;
    return 0;
  }
  if (now === 1) {
    if (fraction >= enter0) return 0;
    if (fraction < leave1) return 2;
    return 1;
  }
  if (fraction >= enter0) return 0;
  if (fraction >= enter1) return 1;
  return 2;
}
