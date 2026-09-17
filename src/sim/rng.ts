/**
 * Deterministic randomness.
 *
 * The whole simulation is replayable from a seed, so nothing inside `sim/` may
 * touch `Math.random`. Renderer-only effects (spore drift, mote jitter) may use
 * whatever they like, but anything that changes world state comes from here.
 */

export type Rng = () => number;

/** Small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string -> 32-bit seed, so maps can be named rather than numbered. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng2D {
  /** Fractal value noise in [0,1]. Smooth, seamless enough for soil strata. */
  (x: number, y: number): number;
}

/**
 * Value noise over a hashed integer lattice, summed across octaves. Used for
 * stratum boundaries, organic pockets and mineral veins — the things that make
 * one patch of soil differ from the next.
 */
export function makeNoise2D(seed: number, octaves = 4, frequency = 0.08): Rng2D {
  const lattice = (ix: number, iy: number): number => {
    let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  return (x: number, y: number): number => {
    let amplitude = 1;
    let total = 0;
    let norm = 0;
    let freq = frequency;
    for (let o = 0; o < octaves; o++) {
      const fx = x * freq;
      const fy = y * freq;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = smooth(fx - ix);
      const ty = smooth(fy - iy);
      const c00 = lattice(ix, iy);
      const c10 = lattice(ix + 1, iy);
      const c01 = lattice(ix, iy + 1);
      const c11 = lattice(ix + 1, iy + 1);
      const top = c00 + (c10 - c00) * tx;
      const bottom = c01 + (c11 - c01) * tx;
      total += (top + (bottom - top) * ty) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      freq *= 2.07;
    }
    return total / norm;
  };
}

/** Uniform float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T;
}
