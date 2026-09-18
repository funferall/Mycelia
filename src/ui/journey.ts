import { ECON } from '../sim/content';
import type { HyphaNode } from '../sim/network';
import type { Simulation } from '../sim/sim';
import type { Tree } from '../sim/world';

/**
 * How close a living strand has to be to a root tip before a symbiosis can be
 * made. The simulation enforces the same number; it lives here so the interface
 * can tell the player the truth about what is in reach without asking the
 * simulation to re-derive it per label.
 */
export const BOND_REACH = 3.5;

/** A root label's state, in the order a player has to work through them. */
export type RootState = 'bondable' | 'poor' | 'distant' | 'bonded';

export interface RootTarget {
  treeId: number;
  tipId: number;
  /** Grid cell the label is pinned to. */
  gx: number;
  gy: number;
  /** Distance from the nearest living strand, in centimetres. */
  distance: number;
  state: RootState;
  tree: Tree;
}

/** A strand near the surface a fruiting body could rise from. */
export interface FruitSite {
  nodeId: number;
  gx: number;
  gy: number;
}

export interface Journey {
  /** 0 Reach, 1 Bond, 2 Gather, 3 Fruit. */
  step: number;
  title: string;
  copy: string;
  /** What is stopping the current objective, phrased for the player. */
  blocker: string | null;
  /** True while the committed reserve is enough to start a body. */
  enoughSurplus: boolean;
  /** Root labels worth showing, actionable first. */
  roots: RootTarget[];
  /** Where a fruiting body may be raised, best first. */
  sites: FruitSite[];
  bondedTrees: number;
  livingTrees: number;
}

/**
 * Everything the interface needs to tell the player where they are and what
 * they can do, derived once from simulation state.
 *
 * This exists because the journal, the root labels and the surface markers were
 * each doing their own slightly different proximity scan over every node. One
 * function means one answer: a root is labelled "Bond" exactly when clicking it
 * will actually bond.
 */
export function deriveJourney(sim: Simulation): Journey {
  const net = sim.player;
  const strands: HyphaNode[] = [];
  for (const node of net.nodes) {
    // Only strands still joined to the root can be ordered to grow, bond or
    // fruit, so a cut-off strand must never be offered as a target.
    if (node.alive && node.connected) strands.push(node);
  }

  const roots: RootTarget[] = [];
  let bondedTrees = 0;
  let livingTrees = 0;
  for (const tree of sim.world.trees) {
    if (tree.dead) continue;
    livingTrees++;
    const bond = tree.rootTips.find((tip) => tip.bondedTo !== null);
    if (bond) {
      bondedTrees++;
      roots.push({
        treeId: tree.id,
        tipId: bond.id,
        gx: bond.gx,
        gy: bond.gy,
        distance: 0,
        state: 'bonded',
        tree,
      });
      continue;
    }
    let best: RootTarget | null = null;
    for (const tip of tree.rootTips) {
      if (tip.bondedTo !== null) continue;
      let distance = Infinity;
      let carbon = 0;
      for (const node of strands) {
        const d = Math.hypot(node.wx - tip.gx - 0.5, node.wy - tip.gy - 0.5);
        if (d < distance) {
          distance = d;
          carbon = node.carbon;
        }
      }
      if (distance === Infinity) continue;
      if (best && distance >= best.distance) continue;
      const state: RootState =
        distance > BOND_REACH ? 'distant' : carbon >= ECON.bondCharge ? 'bondable' : 'poor';
      best = { treeId: tree.id, tipId: tip.id, gx: tip.gx, gy: tip.gy, distance, state, tree };
    }
    if (best) roots.push(best);
  }

  // Actionable roots first, then the shortest errand. Bonded partners are kept,
  // but they are context rather than an action, so they sort to the back.
  const rank: Record<RootState, number> = { bondable: 0, poor: 1, distant: 2, bonded: 3 };
  roots.sort((a, b) => rank[a.state] - rank[b.state] || a.distance - b.distance);

  const sites = surfaceSites(strands);
  const enoughSurplus = net.surplus >= ECON.fruitThreshold;
  const blend = describe({ sim, roots, enoughSurplus, sites, bondedTrees, livingTrees });

  return { ...blend, enoughSurplus, roots, sites, bondedTrees, livingTrees };
}

/** Up to three distinct surface strands, shallowest first. */
function surfaceSites(strands: HyphaNode[]): FruitSite[] {
  const sites: FruitSite[] = [];
  const candidates = strands
    .filter((node) => node.gy <= 12 && Number.isFinite(node.gx))
    .sort((a, b) => a.gy - b.gy);
  for (const node of candidates) {
    if (sites.some((site) => Math.abs(site.gx - node.gx) < 8 && Math.abs(site.gy - node.gy) < 3)) continue;
    sites.push({ nodeId: node.id, gx: node.gx, gy: node.gy });
    if (sites.length >= 3) break;
  }
  return sites;
}

interface DescribeInput {
  sim: Simulation;
  roots: RootTarget[];
  enoughSurplus: boolean;
  sites: FruitSite[];
  bondedTrees: number;
  livingTrees: number;
}

/** The journal's four chapters, resolved against what is actually true now. */
function describe(input: DescribeInput): Pick<Journey, 'step' | 'title' | 'copy' | 'blocker'> {
  const { sim, roots, enoughSurplus, sites } = input;
  const net = sim.player;
  const fruit = net.fruit;

  if (fruit.active) {
    const origin = net.nodes[fruit.nodeId];
    const fed = Boolean(origin && origin.alive && origin.connected);
    const sky = sim.season.warmth > 0.3 && sim.world.rainfall > 0.45;
    const percent = Math.round(fruit.progress * 100);
    const blocker = !fed
      ? 'Its strand has been cut off. The body is receding.'
      : !sky
        ? `${sim.season.label} is too dry or too cold. The body waits.`
        : null;
    return {
      step: 3,
      title: 'Something is rising.',
      copy: `${percent}% grown, and it is spending the reserve you committed.`,
      blocker,
    };
  }

  if (enoughSurplus && sites.length > 0) {
    return {
      step: 3,
      title: 'The network is ready to fruit.',
      copy: 'Choose Fruit, then click a marked strand in the top 12 cm. Two blooms carry the lineage onward.',
      blocker: sim.season.warmth < 0.3 ? 'Too cold to raise a body this season.' : null,
    };
  }

  const bondable = roots.find((root) => root.state === 'bondable');
  if (bondable) {
    return {
      step: 1,
      title: 'A root is within reach.',
      copy: 'Click its label to bond. You give water and minerals; the tree returns sunlight as sugar.',
      blocker: null,
    };
  }

  if (input.bondedTrees === 0) {
    const nearest = roots.find((root) => root.state !== 'bonded');
    return {
      step: 0,
      title: 'Reach toward another life.',
      copy: 'Click a labelled root to send your filaments toward it. Your network follows slowly; there is time to watch.',
      blocker: nearest
        ? `${Math.round(nearest.distance)}cm of soil between your frontier and the nearest root.`
        : 'No root is close enough to sense. Grow deeper.',
    };
  }

  const progress = `Surplus ${net.surplus.toFixed(0)} of ${ECON.fruitThreshold}.`;
  return {
    step: 2,
    title: 'Give, and receive.',
    copy: 'Rest & gather holds the frontier still and banks a share of what your trees pay. Well-supplied partners keep trading.',
    blocker: net.resting
      ? progress
      : 'Rest & gather to start banking reproductive energy.',
  };
}
