/**
 * What an agent sees: a compact, text-only JSON state for one owner, and the
 * closed sets of targets and growth moves it may choose between.
 *
 * System One models answer typed questions over a state; they do not invent
 * coordinates. So the code proposes candidates (enemy strands worth hitting,
 * places worth growing toward), labels them in plain words, and the model only
 * picks. Everything here is pure and deterministic, so the same match gives
 * the same observation whoever asks.
 */
import { CHEMICALS, CHEMICAL_ORDER, CONTACT, type Chemical } from '../sim/contact';
import type { RegionalMatch } from '../sim/match';
import type { HyphaNode, Network, Owner } from '../sim/network';
import type { Vec3 } from '../sim/spatial';
import { regionNetworks, type RegionNetwork } from '../sim/wildfire';
import { standIdAt } from '../sim/spatial';

export interface TargetCandidate {
  id: string;
  label: string;
  point: Vec3;
  standId: number;
}

export interface GrowthCandidate {
  id: string;
  label: string;
  /**
   * null = no new order. `point` is a regional target for a colony that has
   * grown into a regional body; it may lie in another stand.
   */
  order: { standId: number; gx: number; gy: number; point?: Vec3 } | null;
}

export interface Observation {
  owner: Owner;
  time: number;
  state: Record<string, unknown>;
  targets: TargetCandidate[];
  growth: GrowthCandidate[];
  /** Fronts this owner is fighting on. With none, there is no fight to press or lose. */
  fronts: number;
  /** Chemicals ready now and affordable somewhere near a front (a hint for the model; the cast still validates). */
  ready: Chemical[];
}

const MAX_TARGETS = 8;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Strands cut off if this node died: its descendants, counted up to a cap. */
function beyond(net: Network, node: HyphaNode, cap = 400): number {
  let count = 0;
  const stack = [...node.children];
  while (stack.length && count < cap) {
    const child = net.nodes[stack.pop()!];
    if (!child?.alive) continue;
    count++;
    stack.push(...child.children);
  }
  return count;
}

function totals(entries: RegionNetwork[]) {
  let carbon = 0, water = 0, nitrogen = 0, strands = 0, tips = 0;
  for (const { net } of entries) {
    carbon += net.carbon; water += net.water; nitrogen += net.nitrogen;
    for (const n of net.nodes) if (n.alive) { strands++; if (n.isTip) tips++; }
  }
  return { carbon: round(carbon), water: round(water), nitrogen: round(nitrogen), strands, tips };
}

export function observe(match: RegionalMatch, owner: Owner): Observation {
  const war = match.contact;
  const all = regionNetworks(match).filter((e) => !e.net.extinct);
  const mine = all.filter((e) => e.net.owner === owner);
  const theirs = all.filter((e) => e.net.owner !== owner);
  const fronts = war.frontsOf(owner).slice().sort((a, b) => b.contacts - a.contacts).slice(0, 3);

  // Targets: around each front, the nearest enemy strand, the most valuable
  // cut (most strands beyond it), and the thickest cord in reach.
  const targets: TargetCandidate[] = [];
  const seen = new Set<string>();
  const add = (entry: RegionNetwork, node: HyphaNode, why: string, standId: number) => {
    const key = `${entry.net.colonyId ?? entry.net.owner}:${node.id}`;
    if (seen.has(key) || targets.length >= MAX_TARGETS || !node.spatial) return;
    seen.add(key);
    const cut = beyond(entry.net, node);
    const kind = node.id === entry.net.rootId ? 'their founding strand' : node.thickness >= 0.45 || node.reinforced ? 'an enemy cord' : node.isTip ? 'an enemy tip' : 'an enemy strand';
    targets.push({
      id: `t${targets.length}`,
      label: `${kind} in stand ${standId + 1}: ${why}; health ${round(node.health)}, thickness ${round(node.thickness)}, killing it cuts off ${cut} strands`,
      point: { ...node.spatial },
      standId,
    });
  };
  for (const front of fronts) {
    // Only what this owner can actually reach: a chemical is secreted from a
    // connected strand within reach of where it is aimed.
    const sources: Vec3[] = [];
    for (const entry of mine) {
      for (const node of entry.net.nodes) {
        if (node.alive && node.connected && node.spatial && dist(node.spatial, front.centre) <= CONTACT.reach * 2) sources.push(node.spatial);
      }
    }
    const reachable = (p: Vec3) => sources.some((s) => dist(s, p) <= CONTACT.reach - 0.5);
    const near: Array<{ entry: RegionNetwork; node: HyphaNode; d: number; cut: number }> = [];
    for (const entry of theirs) {
      for (const node of entry.net.nodes) {
        if (!node.alive || !node.spatial) continue;
        const d = dist(node.spatial, front.centre);
        if (d <= CONTACT.reach && reachable(node.spatial)) near.push({ entry, node, d, cut: 0 });
      }
    }
    if (!near.length) continue;
    near.sort((a, b) => a.d - b.d || a.node.id - b.node.id);
    add(near[0]!.entry, near[0]!.node, 'closest to the front', front.standId);
    for (const n of near) n.cut = beyond(n.entry.net, n.node, 400);
    const cut = [...near].sort((a, b) => b.cut - a.cut || a.d - b.d)[0]!;
    add(cut.entry, cut.node, 'the most strands depend on it', front.standId);
    const cord = [...near].sort((a, b) => b.node.thickness - a.node.thickness || a.d - b.d)[0]!;
    add(cord.entry, cord.node, 'the thickest strand in reach', front.standId);
  }

  // Growth: for this owner's stand-local networks, a few directions worth taking.
  const growth: GrowthCandidate[] = [{ id: 'g0', label: 'keep growing as now; no new order', order: null }];
  for (const stand of match.stands) {
    const net = stand.sim[owner as 'player' | 'rival'];
    if (!net || net.extinct || !mine.some((e) => e.net === net)) continue;
    const root = net.nodes[net.rootId];
    if (!root?.alive) continue;
    const sid = stand.site.id;
    const other = owner === 'player' ? stand.sim.rival : stand.sim.player;
    const enemy = other && !other.extinct && other.nodes.find((n) => n.alive && n.id === other.rootId);
    const push = (label: string, gx: number, gy: number) => {
      if (growth.length >= 6) return;
      growth.push({ id: `g${growth.length}`, label: `stand ${sid + 1}: ${label}`, order: { standId: sid, gx: Math.round(gx), gy: Math.round(gy) } });
    };
    const enemyHere = enemy && (owner === 'player' ? stand.rivalPresent : stand.sim.hasColony);
    if (enemyHere) push('grow toward the enemy founding strand to attack', enemy.gx, enemy.gy);
    // A regional body can go and find an enemy in another stand.
    const body = (owner === 'rival' ? match.rivalSpatialColonies : match.spatialColonies).get(sid);
    if (!enemyHere && body && body.colony === net && root.spatial && growth.length < 6) {
      let nearest: { point: Vec3; d: number; standId: number } | null = null;
      for (const entry of theirs) {
        for (const node of entry.net.nodes) {
          if (!node.alive || !node.spatial) continue;
          const d = dist(node.spatial, root.spatial);
          if (!nearest || d < nearest.d) nearest = { point: node.spatial, d, standId: standIdAt(match.region, node.spatial.x, node.spatial.y) ?? sid };
        }
      }
      if (nearest) {
        growth.push({
          id: `g${growth.length}`,
          label: `stand ${sid + 1}: go after the nearest enemy colony, in stand ${nearest.standId + 1}`,
          order: { standId: sid, gx: Math.round(root.gx), gy: Math.round(root.gy), point: { ...nearest.point } },
        });
      }
    }
    const trees = stand.sim.world.trees;
    const dead = trees.filter((t) => t.dead || t.burned).sort((a, b) => Math.abs(a.gx - root.gx) - Math.abs(b.gx - root.gx))[0];
    if (dead) push('grow toward dead or burned wood to feed on its remains', dead.gx, 6);
    const living = trees.filter((t) => !t.dead && !t.burned).sort((a, b) => Math.abs(a.gx - root.gx) - Math.abs(b.gx - root.gx))[0];
    if (living) push('grow toward the nearest living tree and its roots', living.gx, 8);
    push('go deeper, away from fire and the surface', root.gx, Math.min(stand.sim.world.rows - 4, root.gy + 25));
  }

  const ready = CHEMICAL_ORDER.filter((c) => war.cooldown(owner, c) <= 0);
  const holdMine = match.hold[owner as 'player' | 'rival'];
  const state: Record<string, unknown> = {
    game: 'Mycelia: rival fungal networks fight where their strands touch. Supply decides fronts; chemicals spend resources for burst damage.',
    you: {
      owner,
      ...totals(mine),
      colonies: mine.length,
      stands_held: holdMine?.tiles ?? 0,
      strands_lost_in_fights: war.lost[owner] ?? 0,
      strands_killed: war.killed[owner] ?? 0,
    },
    enemy: { ...totals(theirs), colonies: theirs.length },
    fronts: fronts.map((f) => ({ stand: f.standId + 1, strands_in_contact: f.contacts, seconds_open: round(match.time - f.since) })),
    chemicals: Object.fromEntries(CHEMICAL_ORDER.map((c) => {
      const spec = CHEMICALS[c];
      return [c, { weight: spec.weight, cost: spec.cost, ready_in_seconds: round(war.cooldown(owner, c)), effect: spec.effect }];
    })),
    targets: Object.fromEntries(targets.map((t) => [t.id, t.label])),
    growth_options: Object.fromEntries(growth.map((g) => [g.id, g.label])),
    season_time: round(match.time),
  };
  return { owner, time: match.time, state, targets, growth, fronts: fronts.length, ready };
}
