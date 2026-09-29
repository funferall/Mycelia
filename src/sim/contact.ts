/**
 * Contact war: networks that fight where they touch (`ADV-06`, contact-war plan).
 *
 * Two networks of different owners are in contact wherever their living nodes
 * lie in neighbouring voxels of the regional volume. Every contact node spends
 * a little of its own carbon to lyse the enemy strands touching it, so supply
 * decides a front: transport refills the carbon a front spends, and a severed
 * or starved front loses. A strand killed in a fight gives half its carbon to
 * its killer; what lay beyond it is severed and starves under the ordinary
 * rules. A front that reaches a founding node cuts off, and so eliminates, the
 * whole colony.
 *
 * Chemicals are orders `{owner, chemical, point}`: one key each, aimed where
 * the cursor is, paid for from the caster's strands near that point. Rules
 * name owners, never sides, so a person, an agent or a future faction all
 * fight the same way.
 */
import { ECON } from './content';
import { lyseNode, updateTotals, type HyphaNode, type Network, type Owner } from './network';
import { mulberry32, hashString } from './rng';
import { standIdAt, type Vec3 } from './spatial';
import type { NetworkWorld } from './world';
import { regionNetworks, type FireHost, type RegionNetwork } from './wildfire';

export type Chemical = 'lyse' | 'leach' | 'ammonia' | 'oxalate' | 'coil' | 'barrage';

export interface ChemicalSpec {
  id: Chemical;
  key: string;
  name: string;
  weight: 'light' | 'heavy';
  cost: { carbon: number; water: number; nitrogen: number };
  /** Voxels around the aimed point. */
  radius: number;
  /** Health taken from an unarmoured strand at the centre. */
  damage: number;
  /** 1 = full cord armour applies; 0 = armour is ignored. */
  armour: number;
  cooldown: number;
  effect: string;
}

export const CHEMICALS: Record<Chemical, ChemicalSpec> = {
  lyse: {
    id: 'lyse', key: 'q', name: 'Lysing enzymes', weight: 'light',
    cost: { carbon: 0.8, water: 0, nitrogen: 0 }, radius: 2.2, damage: 0.55, armour: 1, cooldown: 0.2,
    effect: 'A burst of enzymes that dissolves fine hyphae. Weak against cords.',
  },
  leach: {
    id: 'leach', key: 'w', name: 'Leachate', weight: 'light',
    cost: { carbon: 0, water: 1.2, nitrogen: 0 }, radius: 3, damage: 0.14, armour: 0.8, cooldown: 0.35,
    effect: 'An antibiotic that lingers in the soil water for five seconds. Stronger in wet ground.',
  },
  ammonia: {
    id: 'ammonia', key: 'e', name: 'Ammonia', weight: 'light',
    cost: { carbon: 0, water: 0, nitrogen: 0.45 }, radius: 2.6, damage: 0.4, armour: 0.9, cooldown: 0.3,
    effect: 'A caustic pulse that also knocks nitrogen out of enemy strands into the soil.',
  },
  oxalate: {
    id: 'oxalate', key: 'a', name: 'Oxalate burst', weight: 'heavy',
    cost: { carbon: 3, water: 0, nitrogen: 1.2 }, radius: 4.2, damage: 0.95, armour: 0.45, cooldown: 2.5,
    effect: 'A heavy acid burst over a wide patch. Cuts through cord armour.',
  },
  coil: {
    id: 'coil', key: 'd', name: 'Coil', weight: 'heavy',
    cost: { carbon: 4, water: 2, nitrogen: 1 }, radius: 3.5, damage: 0, armour: 0, cooldown: 5,
    effect: 'Seize the thickest enemy strand in reach and kill it, severing what lies beyond. Founding strands resist.',
  },
  barrage: {
    id: 'barrage', key: 'c', name: 'Barrage', weight: 'heavy',
    cost: { carbon: 2, water: 2, nitrogen: 0 }, radius: 3.5, damage: 0.05, armour: 1, cooldown: 7,
    effect: 'A melanised zone line for twenty seconds: your strands inside take far less damage, enemy strands inside slowly lyse.',
  },
};

export const CHEMICAL_ORDER: Chemical[] = ['lyse', 'leach', 'ammonia', 'oxalate', 'coil', 'barrage'];

export const CONTACT = {
  /** Seconds between contact scans. */
  tick: 0.25,
  /** Strands of different owners this close, in voxels, are in contact. */
  touch: 2,
  /** Carbon a contact node spends each second on fighting, while it has it. */
  passiveSpend: 0.15,
  /** Health taken from an unarmoured enemy per carbon spent. */
  passiveDamage: 1,
  /** A strand keeps this much carbon; it never spends its last on a fight. */
  carbonFloor: 0.05,
  /** Share of a lysed strand's carbon its killer takes. */
  overgrowShare: 0.5,
  /** How far from the caster's own strands a chemical may be aimed, voxels. */
  reach: 7,
  /** Chemicals are paid from connected strands this close to the source. */
  payRadius: 9,
  leachSeconds: 5,
  barrageSeconds: 20,
  /** Damage multiplier on your strands inside your barrage. */
  barrageShield: 0.3,
  /** A founding node takes at most this much from one coil. */
  coilRootDamage: 0.5,
  /** Seconds between the placeholder opponent's casts. */
  botLyseEvery: 1.4,
  botBurstEvery: 9,
} as const;

export type CastResult = { ok: true; message: string } | { ok: false; message: string };

export interface Front {
  /** Owners in a stable order. */
  owners: [Owner, Owner];
  standId: number;
  centre: Vec3;
  contacts: number;
  since: number;
}

export interface Cast {
  at: number;
  owner: Owner;
  chemical: Chemical;
  point: Vec3;
  hits: number;
  kills: number;
}

export interface Lingering {
  chemical: 'leach' | 'barrage';
  owner: Owner;
  point: Vec3;
  radius: number;
  until: number;
}

interface Placed {
  entry: RegionNetwork;
  node: HyphaNode;
  point: Vec3;
}

const voxelKey = (x: number, y: number, z: number): number =>
  (Math.floor(x) + 2048) + 4096 * ((Math.floor(y) + 2048) + 4096 * (Math.floor(z) + 1024));

/**
 * Networks whose bounding box, grown by a chemical's reach, overlaps a
 * network of another owner. Everything else is too far away to fight.
 */
function nearEnemies(entries: RegionNetwork[]): RegionNetwork[] {
  const margin = CONTACT.reach + 6;
  const boxes = entries.map((entry) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const node of entry.net.nodes) {
      if (!node.alive || !node.spatial) continue;
      const p = node.spatial;
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
    }
    return { entry, x0, y0, z0, x1, y1, z1 };
  }).filter((box) => box.x0 <= box.x1);
  const keep = new Set<RegionNetwork>();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if (a.entry.net.owner === b.entry.net.owner) continue;
    if (a.x0 - margin > b.x1 || b.x0 - margin > a.x1 || a.y0 - margin > b.y1 || b.y0 - margin > a.y1 || a.z0 - margin > b.z1 || b.z0 - margin > a.z1) continue;
    keep.add(a.entry);
    keep.add(b.entry);
  }
  return entries.filter((entry) => keep.has(entry));
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** How much a strand shrugs off: thick cords and reinforced strands are tougher. */
export function armourOf(node: HyphaNode, net: Network): number {
  let armour = 1 + node.thickness * 2;
  if (node.reinforced) armour *= 1.5;
  if (node.id === net.rootId) armour *= 1.5;
  return armour;
}

export class ContactWar {
  fronts: Front[] = [];
  readonly casts: Cast[] = [];
  readonly lingering: Lingering[] = [];
  /** Strands each owner has lost to fighting, and killed. */
  readonly lost: Partial<Record<Owner, number>> = {};
  readonly killed: Partial<Record<Owner, number>> = {};
  /** Owners the simple placeholder opponent plays. */
  readonly bots = new Set<Owner>(['rival']);
  private readonly readyAt = new Map<string, number>();
  /** Networks whose strands a fight changed this scan; only their totals are refreshed. */
  private readonly touched = new Set<Network>();
  private clock = 0;
  private botLyseAt = new Map<Owner, number>();
  private botBurstAt = new Map<Owner, number>();
  private readonly rng: () => number;
  private readonly host: FireHost;
  private readonly broadcast: (text: string) => void;

  constructor(host: FireHost, seed: string, broadcast: (text: string) => void = () => {}) {
    this.host = host;
    this.broadcast = broadcast;
    this.rng = mulberry32(hashString(`${seed}:contact`));
  }

  /** Seconds until this chemical is ready for an owner. */
  cooldown(owner: Owner, chemical: Chemical): number {
    return Math.max(0, (this.readyAt.get(`${owner}:${chemical}`) ?? 0) - this.host.time);
  }

  /** Fronts one owner is fighting on. */
  frontsOf(owner: Owner): Front[] {
    return this.fronts.filter((front) => front.owners.includes(owner));
  }

  step(dt: number): void {
    this.clock += dt;
    if (this.clock < CONTACT.tick - 1e-9) return;
    const span = this.clock;
    this.clock = 0;
    // Only networks that come near another owner's can fight; the rest of the
    // region costs one bounding-box pass.
    const entries = nearEnemies(regionNetworks(this.host).filter((entry) => !entry.net.extinct));
    if (!entries.length) {
      if (this.fronts.length) this.fronts = [];
      this.expire();
      return;
    }
    const placed = this.place(entries);
    this.touched.clear();
    this.fight(placed, span);
    this.stepLingering(placed, span);
    for (const owner of this.bots) this.playBot(owner, placed);
    this.expire();
    for (const net of this.touched) updateTotals(net);
  }

  /** Every living node with a regional position, indexed by voxel. */
  private place(entries: RegionNetwork[]): { all: Placed[]; voxels: Map<number, Placed[]> } {
    const all: Placed[] = [];
    const voxels = new Map<number, Placed[]>();
    for (const entry of entries) {
      for (const node of entry.net.nodes) {
        if (!node.alive || !node.spatial) continue;
        const item = { entry, node, point: node.spatial };
        all.push(item);
        const key = voxelKey(node.spatial.x, node.spatial.y, node.spatial.z);
        const list = voxels.get(key);
        if (list) list.push(item);
        else voxels.set(key, [item]);
      }
    }
    return { all, voxels };
  }

  private neighbours(voxels: Map<number, Placed[]>, point: Vec3, radius: number): Placed[] {
    const out: Placed[] = [];
    const r = Math.ceil(radius);
    for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const list = voxels.get(voxelKey(point.x + dx, point.y + dy, point.z + dz));
      if (list) for (const item of list) if (distance(item.point, point) <= radius) out.push(item);
    }
    return out;
  }

  /** Passive fighting at every contact; damage is gathered first, then applied together. */
  private fight(placed: { all: Placed[]; voxels: Map<number, Placed[]> }, dt: number): void {
    const damage = new Map<Placed, { amount: number; by: Placed }>();
    const fronts = new Map<string, { owners: [Owner, Owner]; standId: number; sum: Vec3; contacts: number }>();
    for (const item of placed.all) {
      const owner = item.entry.net.owner;
      const enemies = this.neighbours(placed.voxels, item.point, CONTACT.touch).filter((other) => other.entry.net.owner !== owner);
      if (!enemies.length) continue;
      const owners = [owner, enemies[0]!.entry.net.owner].sort() as [Owner, Owner];
      const standId = standIdAt(this.host.region, item.point.x, item.point.y) ?? -1;
      const key = `${owners.join('|')}@${standId}`;
      const front = fronts.get(key) ?? { owners, standId, sum: { x: 0, y: 0, z: 0 }, contacts: 0 };
      front.sum.x += item.point.x; front.sum.y += item.point.y; front.sum.z += item.point.z;
      front.contacts++;
      fronts.set(key, front);
      // A strand fights with the carbon it holds; supply decides how long.
      const spend = Math.min(Math.max(0, item.node.carbon - CONTACT.carbonFloor), CONTACT.passiveSpend * dt);
      if (spend <= 0) continue;
      item.node.carbon -= spend;
      this.touched.add(item.entry.net);
      const share = (spend * CONTACT.passiveDamage) / enemies.length;
      for (const enemy of enemies) {
        const dealt = share / armourOf(enemy.node, enemy.entry.net) * this.shield(enemy);
        const prior = damage.get(enemy);
        if (prior) prior.amount += dealt;
        else damage.set(enemy, { amount: dealt, by: item });
      }
    }
    for (const [target, hit] of damage) this.harm(target, hit.amount, hit.by);
    const previous = new Map(this.fronts.map((front) => [`${front.owners.join('|')}@${front.standId}`, front]));
    this.fronts = [...fronts.entries()].map(([key, front]) => {
      const known = previous.get(key);
      if (!known) this.announce(front.owners, front.standId);
      return {
        owners: front.owners,
        standId: front.standId,
        centre: { x: front.sum.x / front.contacts, y: front.sum.y / front.contacts, z: front.sum.z / front.contacts },
        contacts: front.contacts,
        since: known?.since ?? this.host.time,
      };
    });
  }

  /** Damage multiplier from the target owner's own barrages. */
  private shield(target: Placed): number {
    for (const zone of this.lingering) {
      if (zone.chemical === 'barrage' && zone.owner === target.entry.net.owner && distance(zone.point, target.point) <= zone.radius) return CONTACT.barrageShield;
    }
    return 1;
  }

  /** Take health; a strand that dies gives part of its carbon to its killer. */
  private harm(target: Placed, amount: number, by: Placed | null): boolean {
    const node = target.node;
    if (!node.alive || amount <= 0) return false;
    node.health -= amount;
    node.pulse = 1;
    this.touched.add(target.entry.net);
    if (node.health > 0) return false;
    this.kill(target, by);
    return true;
  }

  private kill(target: Placed, by: Placed | null): void {
    const { net, world } = target.entry;
    const node = target.node;
    if (by && by.node.alive) {
      const taken = Math.max(0, node.carbon) * CONTACT.overgrowShare;
      const room = Math.max(0, ECON.nodeCarbonCap - by.node.carbon);
      const gained = Math.min(taken, room);
      by.node.carbon += gained;
      node.carbon -= gained;
      by.entry.net.genetic += gained;
      this.touched.add(by.entry.net);
    }
    if (net.fruit.active && net.fruit.nodeId === node.id) {
      net.fruit.active = false;
      net.fruit.progress = 0;
      net.fruit.store = 0;
    }
    lyseNode(net, world as NetworkWorld, node);
    this.lost[net.owner] = (this.lost[net.owner] ?? 0) + 1;
    if (by) this.killed[by.entry.net.owner] = (this.killed[by.entry.net.owner] ?? 0) + 1;
  }

  private stepLingering(placed: { all: Placed[]; voxels: Map<number, Placed[]> }, dt: number): void {
    for (const zone of this.lingering) {
      if (zone.until <= this.host.time) continue;
      const spec = CHEMICALS[zone.chemical];
      for (const item of this.neighbours(placed.voxels, zone.point, zone.radius)) {
        if (item.entry.net.owner === zone.owner) continue;
        let amount = spec.damage * dt / Math.pow(armourOf(item.node, item.entry.net), spec.armour);
        if (zone.chemical === 'leach') {
          const cell = item.entry.world.cellOf(item.node);
          amount *= 0.5 + Math.min(1, cell?.water ?? 0);
        }
        this.harm(item, amount * this.shield(item), null);
      }
    }
  }

  private expire(): void {
    for (let i = this.lingering.length - 1; i >= 0; i--) if (this.lingering[i]!.until <= this.host.time) this.lingering.splice(i, 1);
    // Keep the recent cast log bounded; the renderer only needs the last few seconds.
    while (this.casts.length > 256) this.casts.shift();
  }

  /**
   * Secrete a chemical at a point, for an owner. Deterministic, validated and
   * the same whoever issues it.
   */
  cast(owner: Owner, chemical: Chemical, point: Vec3): CastResult {
    const spec = CHEMICALS[chemical];
    if (!spec) return { ok: false, message: 'No such chemical.' };
    if (![point.x, point.y, point.z].every(Number.isFinite)) return { ok: false, message: 'Aim at the soil.' };
    const wait = this.cooldown(owner, chemical);
    if (wait > 0) return { ok: false, message: `${spec.name} ready in ${(Math.ceil(wait * 10) / 10).toFixed(1)}s.` };
    const entries = regionNetworks(this.host).filter((entry) => !entry.net.extinct);
    const placed = this.place(entries);
    // The source: the caster's nearest living, connected strand within reach.
    let source: Placed | null = null;
    let best = Infinity;
    for (const item of this.neighbours(placed.voxels, point, CONTACT.reach)) {
      if (item.entry.net.owner !== owner || !item.node.connected) continue;
      const d = distance(item.point, point);
      if (d < best) { best = d; source = item; }
    }
    if (!source) return { ok: false, message: `Out of reach: secrete within ${CONTACT.reach} cm of your connected strands.` };
    const short = this.pay(source, placed.voxels, spec.cost);
    if (short.length) return { ok: false, message: `Not enough ${short.join(' and ')} at this front for ${spec.name.toLowerCase()}.` };
    this.readyAt.set(`${owner}:${chemical}`, this.host.time + spec.cooldown);
    const record: Cast = { at: this.host.time, owner, chemical, point: { ...point }, hits: 0, kills: 0 };
    this.casts.push(record);
    const targets = this.neighbours(placed.voxels, point, spec.radius).filter((item) => item.entry.net.owner !== owner && item.node.alive);
    if (chemical === 'leach' || chemical === 'barrage') {
      this.lingering.push({
        chemical, owner, point: { ...point }, radius: spec.radius,
        until: this.host.time + (chemical === 'leach' ? CONTACT.leachSeconds : CONTACT.barrageSeconds),
      });
      record.hits = targets.length;
    } else if (chemical === 'coil') {
      let seized: Placed | null = null;
      for (const item of targets) {
        if (!seized || item.node.thickness > seized.node.thickness + 1e-9 ||
          (Math.abs(item.node.thickness - seized.node.thickness) <= 1e-9 && distance(item.point, point) < distance(seized.point, point))) seized = item;
      }
      if (seized) {
        record.hits = 1;
        const root = seized.node.id === seized.entry.net.rootId;
        if (root) { if (this.harm(seized, CONTACT.coilRootDamage, source)) record.kills++; }
        else { this.kill(seized, source); record.kills++; }
      }
    } else {
      for (const item of targets) {
        const falloff = 1 - 0.5 * (distance(item.point, point) / spec.radius);
        const amount = spec.damage * falloff / Math.pow(armourOf(item.node, item.entry.net), spec.armour) * this.shield(item);
        if (chemical === 'ammonia' && item.node.nitrogen > 0) {
          // Knocked out into the soil, not destroyed.
          const lost = item.node.nitrogen * 0.5;
          item.node.nitrogen -= lost;
          const cell = item.entry.world.cellOf(item.node);
          if (cell) cell.nitrogen = Math.min(1, cell.nitrogen + lost * 0.05);
        }
        record.hits++;
        if (this.harm(item, amount, source)) record.kills++;
      }
    }
    updateTotals(source.entry.net);
    for (const net of this.touched) updateTotals(net);
    this.touched.clear();
    return { ok: true, message: record.hits ? `${spec.name}: ${record.hits} strands hit, ${record.kills} lysed.` : `${spec.name} secreted; nothing of theirs is there.` };
  }

  /** Pay from connected strands near the source, nearest first; all or nothing. Returns what was short. */
  private pay(source: Placed, voxels: Map<number, Placed[]>, cost: ChemicalSpec['cost']): string[] {
    const near = this.neighbours(voxels, source.point, CONTACT.payRadius)
      .filter((item) => item.entry.net === source.entry.net && item.node.connected)
      .sort((a, b) => distance(a.point, source.point) - distance(b.point, source.point) || a.node.id - b.node.id);
    const resources = ['carbon', 'water', 'nitrogen'] as const;
    const short = resources.filter((resource) => {
      if (cost[resource] <= 0) return false;
      const floor = resource === 'carbon' ? CONTACT.carbonFloor : 0;
      const held = near.reduce((sum, item) => sum + Math.max(0, item.node[resource] - floor), 0);
      return held < cost[resource] - 1e-9;
    });
    if (short.length) return short;
    for (const resource of resources) {
      let remaining = cost[resource];
      const floor = resource === 'carbon' ? CONTACT.carbonFloor : 0;
      for (const item of near) {
        if (remaining <= 0) break;
        const paid = Math.min(Math.max(0, item.node[resource] - floor), remaining);
        item.node[resource] -= paid;
        remaining -= paid;
      }
    }
    return [];
  }

  /**
   * The placeholder opponent: lyse where it touches, burst when it can. Stands
   * in for people and agents; it uses exactly the orders they would.
   */
  private playBot(owner: Owner, placed: { all: Placed[]; voxels: Map<number, Placed[]> }): void {
    const fronts = this.frontsOf(owner);
    if (!fronts.length) return;
    const now = this.host.time;
    // The enemy strand nearest this owner's contact, in stable order.
    const front = fronts[Math.floor(this.rng() * fronts.length)]!;
    let target: Placed | null = null;
    let best = Infinity;
    for (const item of this.neighbours(placed.voxels, front.centre, 4)) {
      if (item.entry.net.owner === owner || !item.node.alive) continue;
      const d = distance(item.point, front.centre);
      if (d < best) { best = d; target = item; }
    }
    if (!target) return;
    if ((this.botBurstAt.get(owner) ?? 0) <= now) {
      this.botBurstAt.set(owner, now + CONTACT.botBurstEvery);
      if (this.cast(owner, 'oxalate', target.point).ok) return;
    }
    if ((this.botLyseAt.get(owner) ?? 0) <= now) {
      this.botLyseAt.set(owner, now + CONTACT.botLyseEvery);
      this.cast(owner, 'lyse', target.point);
    }
  }

  private announce(owners: [Owner, Owner], standId: number): void {
    const where = standId >= 0 ? `stand ${standId + 1}` : 'the soil';
    const text = owners.includes('player')
      ? `Contact! Enemy hyphae meet yours in ${where}. Q W E to secrete, A D C for heavy chemicals.`
      : `Networks meet in ${where}.`;
    this.broadcast(text);
  }
}
