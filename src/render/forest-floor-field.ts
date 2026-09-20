import { makeNoise2D } from '../sim/rng';
import { distanceToCourse, type DressingRegion } from './forest-dressing-layout';

/** Continuous presentation field: no tile IDs, local RNG, or render origin. */
export function forestFloorField(
  region: DressingRegion,
  course: ReadonlyArray<{ x: number; y: number }>,
  crowns: ReadonlyArray<{ x: number; y: number; height: number }>,
) {
  const patches = makeNoise2D(region.seed ^ 0x7a341, 3, 0.035);
  const detail = makeNoise2D(region.seed ^ 0x91bd2, 2, 0.19);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  // Bucket crowns once; a vertex only visits its immediate neighbourhood.
  const buckets = new Map<string, typeof crowns[number][]>();
  for (const crown of crowns) {
    const key = `${Math.floor(crown.x / 24)},${Math.floor(crown.y / 24)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(crown);
    buckets.set(key, bucket);
  }
  return (x: number, y: number) => {
    const patch = patches(x, y);
    const grain = detail(x, y);
    const slope = Math.hypot(region.heightAt(x + 1, y) - region.heightAt(x - 1, y), region.heightAt(x, y + 1) - region.heightAt(x, y - 1)) / 2;
    const distance = distanceToCourse(course, x, y);
    // Drainage is cell-discrete; distance to the continuous course avoids grid steps.
    const bank = Math.exp(-Math.pow(distance / 8, 2));
    let shade = 0;
    const bx = Math.floor(x / 24), by = Math.floor(y / 24);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      for (const crown of buckets.get(`${bx + ox},${by + oy}`) ?? []) {
        const radius = Math.min(20, crown.height * 0.42);
        const d = Math.hypot(x - crown.x, y - crown.y) / radius;
        shade += Math.pow(Math.max(0, 1 - d * d), 2) * 0.55;
      }
    }
    const canopy = clamp(shade);
    return {
      moss: clamp((patch - 0.4) * 1.7 + bank * 0.3 + canopy * 0.15 - slope * 0.4),
      litter: clamp(0.25 + grain * 0.45 + canopy * 0.25 - bank * 0.45),
      wet: bank,
      shade: canopy,
      mineral: clamp(slope * 0.65 + bank * 0.35),
      grain,
    };
  };
}

export type ForestFloorField = ReturnType<typeof forestFloorField>;
