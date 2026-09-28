/**
 * The vocabulary an eruption is drawn in (`CORE-04`, `ATM-05`).
 *
 * A Boletus edulis-inspired mushroom develops from a stout button through an
 * opening brown cap to a broad mature cap with a pale pore surface. This is
 * shared visual identity, not a new playable species or faction.
 * Both views — the soil transect and the forest floor above it — name the
 * same stages, so descending through the ground shows one event rather than two.
 *
 * This module is deliberately free of Three.js: it is a naming table, and it is
 * what keeps the two views from disagreeing about which model a stage wears.
 */
import type { AssetId } from './assets';

export type BodyStage = 'primordium' | 'rising' | 'bloom';

/** The authored model each stage wears. */
export const BODY_ASSET: Record<BodyStage, AssetId> = {
  primordium: 'fungus.porcini-button',
  rising: 'fungus.porcini-opening',
  bloom: 'fungus.porcini-mature',
};

/** The progress at which an eruption leaves its primordium and opens its cap. */
export const CAP_OPENS_AT = 0.42;

/** Which stage a body is in at this eruption progress. */
export function stageAt(progress: number): BodyStage {
  return progress < CAP_OPENS_AT ? 'primordium' : 'rising';
}

/**
 * How tall each stage stands in each view's own units.
 *
 * The transect is drawn at a centimetre to the unit, and a body there is a few
 * centimetres of soil. The region is drawn at a metre to the unit, where a
 * fruiting body is a small thing beside a tree rather than a landmark, so these
 * stay close to the sizes the pack was authored at.
 */
export const SOIL_BODY_HEIGHT: Record<BodyStage, number> = {
  primordium: 3.4,
  rising: 5.4,
  bloom: 6.2,
};

export const SURFACE_BODY_HEIGHT: Record<BodyStage, number> = {
  primordium: 0.5,
  rising: 0.85,
  bloom: 1.05,
};
