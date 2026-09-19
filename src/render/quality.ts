/**
 * Rendering presets for the browser harness.
 *
 * Normal is the game's shipping presentation. The fast preset is opt-in for
 * software-WebGL visual QA: it changes only drawing cost, never the scene graph,
 * simulation state, camera, input, or CSS layout.
 */
export type QualityPresetId = 'normal' | 'fast';

export interface QualityPreset {
  readonly id: QualityPresetId;
  /** Multiple of the normal drawing-buffer pixel ratio. CSS size never changes. */
  readonly pixelRatioScale: number;
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  /** Whether the scene is rendered through EffectComposer at all. */
  readonly postprocessing: boolean;
  readonly bloom: boolean;
  /** The baked tree-shadow decals drawn on the forest floor. */
  readonly surfaceShadows: boolean;
  /** Real-time shadow maps. The current game ships with these disabled. */
  readonly shadowMaps: boolean;
}

export const NORMAL_QUALITY: QualityPreset = {
  id: 'normal',
  pixelRatioScale: 1,
  maxPixelRatio: 2,
  antialias: true,
  postprocessing: true,
  bloom: true,
  surfaceShadows: true,
  shadowMaps: false,
};

/**
 * Half-resolution drawing buffer, no multisampling, no ground-shadow decals,
 * and no postprocessing. It is deliberately visual-only: every tree, stand,
 * root, label, camera transition and order still runs exactly as it does in
 * normal mode.
 */
export const FAST_QUALITY: QualityPreset = {
  id: 'fast',
  pixelRatioScale: 0.5,
  maxPixelRatio: 2,
  antialias: false,
  postprocessing: false,
  bloom: false,
  surfaceShadows: false,
  shadowMaps: false,
};

/**
 * Resolve `?qa=fast` from a URL search string. Anything else is normal mode, so
 * an ordinary link is never silently downgraded.
 */
export function qualityFromSearch(search: string): QualityPreset {
  return new URLSearchParams(search).get('qa') === 'fast' ? FAST_QUALITY : NORMAL_QUALITY;
}

/** Drawing-buffer pixel ratio for this preset at a device's own ratio. */
export function qualityPixelRatio(preset: QualityPreset, devicePixelRatio: number): number {
  const device = Math.min(Math.max(devicePixelRatio || 1, 0.5), preset.maxPixelRatio);
  return Math.max(0.5, device * preset.pixelRatioScale);
}
