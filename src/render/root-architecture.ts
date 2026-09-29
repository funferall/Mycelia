/**
 * Species root architecture for the soil section, after the excavation drawings
 * of Kutschera and Lichtenegger (Wurzelatlas; Wageningen UR "Root System
 * Drawings", images.wur.nl coll13). The drawings were studied for form and
 * proportion only; nothing from them is shipped.
 *
 * - Oak, a heart-root system (Quercus robur, drawing 1355: 12.3 m tall, roots
 *   3.5 m deep and 18.5 m across). Most of the root mass is a dense layer of
 *   long laterals just under the surface, with a second layer lower down; a
 *   stout short tap and a fan of oblique sinkers carry fine brushes deep.
 * - Birch, a plate (Betula pendula, drawing 1362: 6.4 m tall, 0.63 m deep and
 *   15.9 m across): many long, sinuous laterals in the top few centimetres of
 *   the section, a flared base, no tap, and only short droppers.
 * - Hemlock, after its nearest European relatives (Abies alba 1256 and Picea
 *   abies 1255): flattened plate laterals, a short tap, and sinkers that drop
 *   almost vertically from partway along the laterals.
 *
 * The simulation's root tips are fixed gameplay points. The architecture never
 * moves them: it routes a sinker or dropper to each one, so every place a
 * hypha can bond sits visibly on a real root.
 *
 * Pure and deterministic (seeded by the tree), with no Three.js, so it can be
 * tested headless. Units are grid cells: x in columns, depth in rows (down).
 */

export interface RootPoint {
  readonly x: number;
  readonly depth: number;
  /** Ribbon width at this point, in cells. */
  readonly width: number;
}

export interface RootSystem {
  /** Structural roots, drawn as tapered ribbons. */
  readonly ribbons: RootPoint[][];
  /** Fine roots, drawn as hairlines: polylines of [x, depth] pairs. */
  readonly fines: [number, number][][];
}

export interface RootTree {
  readonly gx: number;
  readonly seed: number;
  readonly species: 'oak' | 'birch' | 'hemlock';
  readonly maturity: number;
  readonly rootTips: readonly { readonly id: number; readonly gx: number; readonly gy: number }[];
}

interface Profile {
  /** Main laterals: count range, depth range, reach range (cells), base width. */
  laterals: [number, number];
  lateralDepth: [number, number];
  reach: [number, number];
  lateralWidth: number;
  /** How much a lateral wanders (0 straight, 1 very sinuous). */
  curl: number;
  /** Tap depth as a fraction of the species' rooting depth; 0 for none. */
  tap: number;
  tapWidth: number;
  /** A second, deeper lateral layer: count and depth as a fraction of rooting depth. */
  lowerLayer: [number, number];
  /** Where sinkers start: 'base' fans from the stock, 'lateral' drops from laterals. */
  sinkers: 'base' | 'lateral';
  sinkerWidth: number;
  /** Flare stubs at the stem base. */
  flare: number;
}

const PROFILES: Record<RootTree['species'], Profile> = {
  oak: {
    laterals: [6, 8], lateralDepth: [1.5, 6], reach: [12, 19], lateralWidth: 0.95, curl: 0.26,
    tap: 0.45, tapWidth: 1.45, lowerLayer: [3, 0.3], sinkers: 'base', sinkerWidth: 0.62, flare: 2,
  },
  birch: {
    laterals: [7, 10], lateralDepth: [1, 4.5], reach: [15, 25], lateralWidth: 0.7, curl: 0.42,
    tap: 0, tapWidth: 0, lowerLayer: [0, 0], sinkers: 'lateral', sinkerWidth: 0.34, flare: 5,
  },
  hemlock: {
    laterals: [6, 8], lateralDepth: [0.8, 3.5], reach: [11, 17], lateralWidth: 0.82, curl: 0.22,
    tap: 0.5, tapWidth: 0.9, lowerLayer: [0, 0], sinkers: 'lateral', sinkerWidth: 0.42, flare: 3,
  },
};

/** Rooting depth in rows, matching the simulation's species table. */
const ROOT_DEPTH: Record<RootTree['species'], number> = { oak: 88, birch: 42, hemlock: 30 };

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rootSystem(tree: RootTree, cols: number, rows: number): RootSystem {
  const profile = PROFILES[tree.species];
  const rootDepth = ROOT_DEPTH[tree.species];
  const rng = mulberry(tree.seed ^ 0x2f0a7c3);
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const size = 0.65 + tree.maturity * 0.45;
  const ribbons: RootPoint[][] = [];
  const fines: [number, number][][] = [];
  const minX = 0.5, maxX = cols - 0.5, maxDepth = rows - 1;
  const inside = (x: number, d: number) => x > minX && x < maxX && d < maxDepth;

  /** A root that wanders toward a heading, and (optionally) settles at a depth. */
  const grow = (x: number, depth: number, dx: number, dd: number, length: number, width: number, curl: number, settle: number | null): RootPoint[] => {
    const points: RootPoint[] = [{ x, depth, width }];
    const step = 0.9;
    const n = Math.max(2, Math.round(length / step));
    let heading = Math.atan2(dd, dx);
    for (let i = 1; i <= n; i++) {
      heading += (rng() - 0.5) * curl * 1.4;
      // Horizontal roots are pulled back toward their layer rather than diving.
      if (settle !== null) {
        const pull = (settle - depth) * 0.12;
        const horizontal = dx >= 0 ? 0 : Math.PI;
        heading = heading * 0.8 + (horizontal + Math.sign(dx || 1) * pull) * 0.2;
      }
      x += Math.cos(heading) * step;
      depth = Math.max(0.4, depth + Math.sin(heading) * step);
      if (!inside(x, depth)) break;
      points.push({ x, depth, width: width * (1 - (i / n) * 0.85) });
    }
    return points;
  };

  /** A root that must end exactly at a target: a wandering walk that homes in. */
  const reach = (x: number, depth: number, tx: number, td: number, width: number, wander: number): RootPoint[] => {
    const points: RootPoint[] = [{ x, depth, width }];
    const total = Math.hypot(tx - x, td - depth);
    const n = Math.max(2, Math.round(total / 1.1));
    // A smooth drift, not per-step jitter: roots bend around stones, they do
    // not zigzag.
    let drift = 0;
    let offset = 0;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      drift = drift * 0.8 + (rng() - 0.5) * wander * 0.35;
      offset += drift;
      // The offset fades out so the root still lands on its target.
      const bend = offset * Math.sin(Math.PI * t);
      const along = { x: x + (tx - x) * t, depth: depth + (td - depth) * t };
      points.push({
        x: Math.min(maxX - 0.1, Math.max(minX + 0.1, along.x + bend)),
        depth: Math.min(maxDepth - 0.1, Math.max(0.4, along.depth + bend * 0.25)),
        width: width * (1 - t * 0.7),
      });
    }
    points.push({ x: tx, depth: td, width: width * 0.3 });
    return points;
  };

  /** Hair roots along a structural root, and a brush where it ends. */
  const feather = (path: RootPoint[], density: number, brush: number) => {
    for (let i = 1; i < path.length; i++) {
      if (rng() > density) continue;
      const p = path[i]!;
      fines.push(twig(p.x, p.depth, 0.8 + rng() * 2.2));
    }
    const end = path[path.length - 1]!;
    for (let k = 0; k < brush; k++) fines.push(twig(end.x, end.depth, 0.6 + rng() * 1.8));
  };

  const twig = (x: number, depth: number, length: number): [number, number][] => {
    const out: [number, number][] = [[x, depth]];
    let heading = rng() * Math.PI * 2;
    // Fine roots explore sideways and down more than up.
    if (Math.sin(heading) < -0.3) heading = -heading;
    for (let s = 0; s < 3; s++) {
      heading += (rng() - 0.5) * 1.2;
      x += Math.cos(heading) * (length / 3);
      depth = Math.max(0.3, depth + Math.sin(heading) * (length / 3));
      if (!inside(x, depth)) break;
      out.push([x, depth]);
    }
    return out;
  };

  const base = { x: tree.gx + 0.5, depth: 0.5 };
  const laterals: RootPoint[][] = [];

  // The main laterals, alternating sides, each settling into its own layer.
  const count = Math.round(between(profile.laterals[0], profile.laterals[1]));
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const layer = between(profile.lateralDepth[0], profile.lateralDepth[1]);
    const length = between(profile.reach[0], profile.reach[1]) * size;
    const path = grow(base.x + side * 0.4, base.depth + rng() * 0.8, side, layer * 0.25, length, profile.lateralWidth * size * between(0.7, 1.1), profile.curl, layer);
    laterals.push(path);
    ribbons.push(path);
    // Secondary laterals branch off and angle down a little.
    const branches = 1 + Math.floor(rng() * 3);
    for (let b = 0; b < branches; b++) {
      const at = path[Math.floor(path.length * between(0.25, 0.75))];
      if (!at) continue;
      const sub = grow(at.x, at.depth, side * between(0.6, 1), between(0.2, 0.7), length * between(0.25, 0.45), at.width * 0.5, profile.curl * 1.3, at.depth + between(1, 5));
      ribbons.push(sub);
      feather(sub, 0.35, 3);
    }
    feather(path, 0.45, 5);
  }

  // Flare: short, thick buttress stubs at the stem base.
  for (let i = 0; i < profile.flare; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    ribbons.push(grow(base.x, 0.4, side, 0.6, between(1.5, 3) * size, profile.lateralWidth * 1.4 * size, 0.1, null));
  }

  // The tap, and (for oak) the lower lateral layer hung from it.
  let tap: RootPoint[] | null = null;
  if (profile.tap > 0) {
    tap = reach(base.x, base.depth, base.x + between(-2, 2), rootDepth * profile.tap * size, profile.tapWidth * size, 1.2);
    ribbons.push(tap);
    feather(tap, 0.3, 6);
    const lower = profile.lowerLayer[0];
    for (let i = 0; i < lower; i++) {
      const layer = rootDepth * profile.lowerLayer[1] * between(0.8, 1.2);
      const from = tap.reduce((best, p) => (Math.abs(p.depth - layer) < Math.abs(best.depth - layer) ? p : best), tap[0]!);
      const side = i % 2 === 0 ? -1 : 1;
      // The lower layer runs obliquely down and wanders more than the top one.
      const path = grow(from.x, from.depth, side, 0.35, between(7, 12) * size, profile.lateralWidth * 0.55 * size, profile.curl * 1.8, layer + between(3, 8));
      ribbons.push(path);
      feather(path, 0.4, 4);
    }
  }

  // Hemlock and birch also carry a few sinkers of their own from the laterals.
  if (profile.sinkers === 'lateral') {
    const extra = tree.species === 'hemlock' ? 3 : 2;
    for (let i = 0; i < extra && laterals.length; i++) {
      const root = laterals[Math.floor(rng() * laterals.length)]!;
      const at = root[Math.floor(root.length * between(0.3, 0.6))];
      if (!at) continue;
      const target = Math.min(maxDepth - 1, rootDepth * between(0.5, 0.85) * size);
      const path = reach(at.x, at.depth, at.x + between(-1.5, 1.5), target, profile.sinkerWidth * size, 1.1);
      ribbons.push(path);
      feather(path, 0.35, 5);
    }
  }

  // Every simulation root tip gets a root that ends exactly on it. Tips come
  // last, in order, so a tree growing a new tip adds one root and moves none.
  const structural = [...laterals, ...(tap ? [tap] : [])];
  for (const tip of tree.rootTips) {
    const tx = tip.gx + 0.5, td = tip.gy + 0.5;
    let path: RootPoint[];
    if (profile.sinkers === 'base' && td > profile.lateralDepth[1] + 6) {
      // Oak: an oblique sinker fanning from the stock or the upper tap.
      const from = tap ? tap[Math.min(tap.length - 1, Math.floor(rng() * Math.min(tap.length, 6)))]! : { x: base.x, depth: 2, width: 1 };
      path = reach(from.x, from.depth, tx, td, profile.sinkerWidth * size, 2.4);
    } else {
      // A dropper from the nearest structural root above the tip.
      let best: RootPoint | null = null;
      let bestScore = Infinity;
      for (const root of structural) {
        for (const p of root) {
          if (p.depth > td - 0.5) continue;
          const score = Math.abs(p.x - tx) * 1.6 + (td - p.depth) * 0.4;
          if (score < bestScore) { bestScore = score; best = p; }
        }
      }
      const from = best ?? { x: base.x, depth: base.depth, width: 1 };
      path = reach(from.x, from.depth, tx, td, Math.min(from.width, profile.sinkerWidth * size), 1.4);
    }
    ribbons.push(path);
    feather(path, 0.3, 7);
  }

  return { ribbons: ribbons.filter((r) => r.length > 1), fines: fines.filter((f) => f.length > 1) };
}
