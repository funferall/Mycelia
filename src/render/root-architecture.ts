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
 * A tree's roots are laid out once, at full size, and never change shape.
 * Growth is drawn by revealing that fixed layout (`grownRoots`): each root
 * extends along its own path and thickens, branches emerge as their parent
 * passes them, and a new tip's root grows in from the root it leaves. Laying
 * out at the tree's current size instead re-rolled every root whenever the
 * section was redrawn, so the whole stand jumped into new shapes.
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

/** Where a root or fine root leaves another: the ribbon's index and the fraction of its length. */
export interface RootAnchor {
  readonly ribbon: number;
  readonly at: number;
}

export interface RootSystem {
  /** Structural roots, drawn as tapered ribbons. */
  readonly ribbons: RootPoint[][];
  /** Fine roots, drawn as hairlines: polylines of [x, depth] pairs. */
  readonly fines: [number, number][][];
  /** Per ribbon, the ribbon it branches from; null for roots from the stem base. */
  readonly parents: (RootAnchor | null)[];
  /** Per fine root, the ribbon it hangs from. */
  readonly fineAnchors: RootAnchor[];
  /** Index of the first tip root; one per simulation tip follows, in order. */
  readonly firstTip: number;
}

export interface RootTree {
  readonly gx: number;
  readonly seed: number;
  readonly species: 'oak' | 'birch' | 'hemlock';
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
  // Always the full-grown size: the shape must not depend on the tree's age.
  const size = FULL_SIZE;
  const ribbons: RootPoint[][] = [];
  const fines: [number, number][][] = [];
  /** Branch points and hair anchors, by path and point index; turned into fractions at the end. */
  const branchOf = new Map<RootPoint[], { path: RootPoint[]; index: number }>();
  const fineOn: { path: RootPoint[]; index: number }[] = [];
  const branch = (child: RootPoint[], path: RootPoint[], index: number) => { branchOf.set(child, { path, index }); return child; };
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
      fineOn.push({ path, index: i });
    }
    const end = path[path.length - 1]!;
    for (let k = 0; k < brush; k++) {
      fines.push(twig(end.x, end.depth, 0.6 + rng() * 1.8));
      fineOn.push({ path, index: path.length - 1 });
    }
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
      const atIndex = Math.floor(path.length * between(0.25, 0.75));
      const at = path[atIndex];
      if (!at) continue;
      const sub = branch(grow(at.x, at.depth, side * between(0.6, 1), between(0.2, 0.7), length * between(0.25, 0.45), at.width * 0.5, profile.curl * 1.3, at.depth + between(1, 5)), path, atIndex);
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
      const trunk = tap;
      const fromIndex = trunk.reduce((best, p, k) => (Math.abs(p.depth - layer) < Math.abs(trunk[best]!.depth - layer) ? k : best), 0);
      const from = trunk[fromIndex]!;
      const side = i % 2 === 0 ? -1 : 1;
      // The lower layer runs obliquely down and wanders more than the top one.
      const path = branch(grow(from.x, from.depth, side, 0.35, between(7, 12) * size, profile.lateralWidth * 0.55 * size, profile.curl * 1.8, layer + between(3, 8)), trunk, fromIndex);
      ribbons.push(path);
      feather(path, 0.4, 4);
    }
  }

  // Hemlock and birch also carry a few sinkers of their own from the laterals.
  if (profile.sinkers === 'lateral') {
    const extra = tree.species === 'hemlock' ? 3 : 2;
    for (let i = 0; i < extra && laterals.length; i++) {
      const root = laterals[Math.floor(rng() * laterals.length)]!;
      const atIndex = Math.floor(root.length * between(0.3, 0.6));
      const at = root[atIndex];
      if (!at) continue;
      const target = Math.min(maxDepth - 1, rootDepth * between(0.5, 0.85) * size);
      const path = branch(reach(at.x, at.depth, at.x + between(-1.5, 1.5), target, profile.sinkerWidth * size, 1.1), root, atIndex);
      ribbons.push(path);
      feather(path, 0.35, 5);
    }
  }

  // Every simulation root tip gets a root that ends exactly on it. Tips come
  // last, in order, so a tree growing a new tip adds one root and moves none.
  const structural = [...laterals, ...(tap ? [tap] : [])];
  const tipRoots: RootPoint[][] = [];
  for (const tip of tree.rootTips) {
    const tx = tip.gx + 0.5, td = tip.gy + 0.5;
    let path: RootPoint[];
    if (profile.sinkers === 'base' && td > profile.lateralDepth[1] + 6) {
      // Oak: an oblique sinker fanning from the stock or the upper tap.
      const fromIndex = tap ? Math.min(tap.length - 1, Math.floor(rng() * Math.min(tap.length, 6))) : -1;
      const from = tap ? tap[fromIndex]! : { x: base.x, depth: 2, width: 1 };
      path = reach(from.x, from.depth, tx, td, profile.sinkerWidth * size, 2.4);
      if (tap) branch(path, tap, fromIndex);
    } else {
      // A dropper from the nearest structural root above the tip.
      let best: { root: RootPoint[]; index: number } | null = null;
      let bestScore = Infinity;
      for (const root of structural) {
        for (let k = 0; k < root.length; k++) {
          const p = root[k]!;
          if (p.depth > td - 0.5) continue;
          const score = Math.abs(p.x - tx) * 1.6 + (td - p.depth) * 0.4;
          if (score < bestScore) { bestScore = score; best = { root, index: k }; }
        }
      }
      const from = best ? best.root[best.index]! : { x: base.x, depth: base.depth, width: 1 };
      path = reach(from.x, from.depth, tx, td, Math.min(from.width, profile.sinkerWidth * size), 1.4);
      if (best) branch(path, best.root, best.index);
    }
    ribbons.push(path);
    tipRoots.push(path);
    feather(path, 0.3, 7);
  }

  // Index the kept ribbons, and turn branch points into fractions of length.
  const kept = ribbons.filter((r) => r.length > 1);
  const indexOf = new Map(kept.map((r, i) => [r, i]));
  const anchor = (on: { path: RootPoint[]; index: number } | undefined): RootAnchor | null => {
    const ribbon = on ? indexOf.get(on.path) : undefined;
    if (!on || ribbon === undefined) return null;
    const lengths = arcLengths(on.path);
    return { ribbon, at: lengths[on.index]! / (lengths[lengths.length - 1]! || 1) };
  };
  const keptFines: [number, number][][] = [];
  const fineAnchors: RootAnchor[] = [];
  fines.forEach((fine, k) => {
    const on = anchor(fineOn[k]);
    if (fine.length < 2 || !on) return;
    keptFines.push(fine);
    fineAnchors.push(on);
  });
  return {
    ribbons: kept,
    fines: keptFines,
    parents: kept.map((r) => anchor(branchOf.get(r))),
    fineAnchors,
    firstTip: tipRoots.length ? indexOf.get(tipRoots[0]!)! : kept.length,
  };
}

/** The full-grown size every layout is made at (a tree of maturity 1). */
const FULL_SIZE = 1.1;

/** Cumulative length along a path at each point. */
function arcLengths(path: readonly { x: number; depth: number }[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.depth - path[i - 1]!.depth));
  }
  return out;
}

/** The share of a full-grown root's length and thickness a tree of this maturity shows. */
export const rootReach = (maturity: number) => (0.65 + Math.min(1, Math.max(0, maturity)) * 0.45) / FULL_SIZE;

/**
 * The part of a fixed layout that has grown. Every root follows its own
 * path, so growing never moves a drawn point; it only extends and thickens.
 *
 * - `growth` is the tree's drawn maturity (0..1).
 * - `tipGrowth[k]` is how far simulation tip k's root has grown in (0..1); a
 *   missing entry counts as grown. The first half of a tip's growth extends
 *   the root it leaves to the branch point, if that is still short of it; the
 *   second half grows the new root out. At 1 it ends exactly on the tip.
 */
export function grownRoots(system: RootSystem, growth: number, tipGrowth: readonly number[] = []): { ribbons: RootPoint[][]; fines: [number, number][][] } {
  const n = system.ribbons.length;
  const base = rootReach(growth);
  const tipOf = (i: number) => (i >= system.firstTip ? Math.min(1, Math.max(0, tipGrowth[i - system.firstTip] ?? 1)) : -1);
  // A tip's root needs the root it leaves to reach the branch point.
  const demand = new Array<number>(n).fill(0);
  for (let i = system.firstTip; i < n; i++) {
    const parent = system.parents[i];
    if (parent) demand[parent.ribbon] = Math.max(demand[parent.ribbon]!, parent.at * Math.min(1, tipOf(i) * 2));
  }
  // Parents always precede their branches, so one pass in order settles every share.
  const shown = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = tipOf(i);
    const parent = system.parents[i];
    if (t >= 0) shown[i] = Math.max(0, t * 2 - 1);
    else {
      // A branch emerges once its parent has grown past it, and catches up as the parent does.
      const own = parent ? Math.min(base, Math.max(0, (shown[parent.ribbon]! - parent.at) / (1 - parent.at || 1))) : base;
      shown[i] = Math.max(own, demand[i]!);
    }
  }
  const cuts = system.ribbons.map((ribbon, i) => cutRibbon(ribbon, shown[i]!));
  const fines: [number, number][][] = [];
  system.fines.forEach((fine, k) => {
    const on = system.fineAnchors[k]!;
    const cut = cuts[on.ribbon];
    if (!cut) return;
    if (on.at >= 1) {
      // The brush at a root's end travels with its growing end, as root hairs do.
      const end = cut[cut.length - 1]!;
      const full = system.ribbons[on.ribbon]!.at(-1)!;
      const dx = end.x - full.x, dd = end.depth - full.depth;
      fines.push(dx === 0 && dd === 0 ? fine : fine.map(([x, depth]) => [x + dx, depth + dd]));
      return;
    }
    // Other hairs sprout behind the growing end, finishing by the time the root does.
    const out = Math.min(1, Math.max(0, (shown[on.ribbon]! - on.at) / Math.min(0.08, 1 - on.at)));
    const line = out > 0 ? cutLine(fine, out) : null;
    if (line) fines.push(line);
  });
  return { ribbons: cuts.filter((cut): cut is RootPoint[] => cut !== null), fines };
}

/**
 * The first `share` of a ribbon's length, ending on an interpolated point.
 * Its thickness is the full root's profile compressed into what has grown and
 * scaled by it, so a young root tapers to a point as a grown one does.
 */
function cutRibbon(path: RootPoint[], share: number): RootPoint[] | null {
  if (share >= 1) return path;
  const lengths = arcLengths(path);
  const total = lengths[lengths.length - 1]!;
  const end = total * share;
  if (end < 0.05) return null;
  const widthAt = (s: number) => {
    let k = 1;
    while (k < lengths.length - 1 && lengths[k]! < s) k++;
    const a = path[k - 1]!, b = path[k]!;
    const t = Math.min(1, Math.max(0, (s - lengths[k - 1]!) / ((lengths[k]! - lengths[k - 1]!) || 1)));
    return a.width + (b.width - a.width) * t;
  };
  const out: RootPoint[] = [];
  for (let k = 0; k < path.length; k++) {
    const p = path[k]!;
    if (lengths[k]! >= end) {
      const a = path[k - 1]!;
      const t = (end - lengths[k - 1]!) / ((lengths[k]! - lengths[k - 1]!) || 1);
      out.push({ x: a.x + (p.x - a.x) * t, depth: a.depth + (p.depth - a.depth) * t, width: widthAt(total) * share });
      break;
    }
    out.push({ x: p.x, depth: p.depth, width: widthAt(lengths[k]! / share) * share });
  }
  return out.length > 1 ? out : null;
}

/** The first `share` of a polyline's length. */
function cutLine(line: [number, number][], share: number): [number, number][] | null {
  if (share >= 1) return line;
  const lengths = arcLengths(line.map(([x, depth]) => ({ x, depth })));
  const end = lengths[lengths.length - 1]! * share;
  if (end < 0.02) return null;
  const out: [number, number][] = [line[0]!];
  for (let k = 1; k < line.length; k++) {
    if (lengths[k]! >= end) {
      const t = (end - lengths[k - 1]!) / ((lengths[k]! - lengths[k - 1]!) || 1);
      out.push([line[k - 1]![0] + (line[k]![0] - line[k - 1]![0]) * t, line[k - 1]![1] + (line[k]![1] - line[k - 1]![1]) * t]);
      break;
    }
    out.push(line[k]!);
  }
  return out;
}
