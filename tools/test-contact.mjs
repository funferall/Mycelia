// Contact war (C1, C2): fronts, supply-limited fighting, overgrowth, severing,
// elimination, and the six chemicals as orders. Pure simulation, no browser.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out = mkdtempSync(join(tmpdir(), 'mycelia-contact-'));
for (const file of readdirSync(new URL('../src/sim/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
  writeFileSync(join(out, file.replace('.ts', '.mjs')), stripTypeScriptTypes(readFileSync(new URL('../src/sim/' + file, import.meta.url), 'utf8')).replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = name => import(pathToFileURL(join(out, name + '.mjs')));
const { ContactWar, CHEMICALS, CHEMICAL_ORDER, CONTACT } = await load('contact');
const { createNetwork, markConnectivity, updateTotals } = await load('network');
const { mulberry32 } = await load('rng');
const { RegionalMatch } = await load('match');

/** A straight chain of strands along x from `start`, founding node first. */
function chain(owner, start, step, n, { carbon = 2, water = 2, nitrogen = 1, thickness = 0.1 } = {}) {
  const net = createNetwork(owner, owner, 0, 0, mulberry32(owner.length), carbon);
  const root = net.nodes[0];
  net.nodes = [root];
  root.children = [];
  net.tipCount = 0;
  root.spatial = { ...start };
  root.carbon = carbon; root.water = water; root.nitrogen = nitrogen;
  for (let i = 1; i < n; i++) {
    const node = { ...root, id: i, parent: i - 1, children: [], isTip: i === n - 1, thickness, carbon, water, nitrogen,
      spatial: { x: start.x + step * i, y: start.y, z: start.z } };
    net.nodes.push(node);
    net.nodes[i - 1].children.push(i);
  }
  net.colonyId = `${owner}@test`;
  markConnectivity(net);
  updateTotals(net);
  return net;
}

function world() {
  const cells = new Map();
  return {
    trees: [], rainfall: 1,
    cellOf(node) {
      if (!cells.has(node)) cells.set(node, { occupancy: 1, organic: 0, nitrogen: 0, water: 0.5 });
      return cells.get(node);
    },
  };
}

/** Two owners' chains facing each other across a gap, in one stand. */
function duel(options = {}) {
  const w = world();
  // Player grows east from x=10, rival west from x=40; tips meet near x=25.
  const player = chain('player', { x: 10, y: 20, z: 50 }, 1, 16, options.player);
  const rival = chain('rival', { x: 40, y: 20, z: 50 }, -1, 15, options.rival);
  const host = {
    time: 0,
    region: { cols: 3, rows: 3 },
    stands: [{ site: { id: 0 }, rivalPresent: true, sim: { hasColony: true, rivalEnabled: true, player, rival, world: w } }],
    spatialColonies: new Map(),
  };
  const messages = [];
  const war = new ContactWar(host, 'duel', (text) => messages.push(text));
  war.bots.clear();
  const run = (seconds) => { for (let t = 0; t < seconds; t += 0.25) { host.time += 0.25; war.step(0.25); } };
  return { host, war, player, rival, messages, run };
}

const living = (net) => net.nodes.filter((n) => n.alive).length;

{
  // A front opens where the tips touch, once, and names the stand.
  const { war, messages, run } = duel();
  run(0.25);
  assert.equal(war.fronts.length, 1, 'one front');
  const front = war.fronts[0];
  assert.deepEqual(front.owners, ['player', 'rival']);
  assert.equal(front.standId, 0);
  assert(front.contacts >= 2, `contacts ${front.contacts}`);
  assert.equal(messages.filter((m) => /Contact!/.test(m)).length, 1, 'announced once');
  run(2);
  assert.equal(messages.filter((m) => /Contact!/.test(m)).length, 1, 'not re-announced while it holds');
  console.log(`PASS a front opens at the touching tips (${front.contacts} contacts, centre x ${front.centre.x.toFixed(1)}) and is announced once`);
}
{
  // Networks that never come near cost nothing and fight nothing.
  const w = world();
  const player = chain('player', { x: 10, y: 20, z: 50 }, 1, 10);
  const rival = chain('rival', { x: 120, y: 20, z: 50 }, 1, 10);
  const host = { time: 0, region: { cols: 3, rows: 3 }, stands: [{ site: { id: 0 }, rivalPresent: true, sim: { hasColony: true, rivalEnabled: true, player, rival, world: w } }], spatialColonies: new Map() };
  const war = new ContactWar(host, 'apart');
  const before = JSON.stringify([player.nodes, rival.nodes]);
  for (let i = 0; i < 40; i++) { host.time += 0.25; war.step(0.25); }
  assert.equal(war.fronts.length, 0);
  assert.equal(JSON.stringify([player.nodes, rival.nodes]), before, 'distant networks are untouched');
  console.log('PASS networks far apart are left exactly as they were');
}
{
  // Supply decides a front: the side with carbon behind its tips wins it.
  const { war, player, rival, run } = duel({ player: { carbon: 2.4 }, rival: { carbon: 0.2 } });
  run(60);
  const lostR = war.lost.rival ?? 0;
  const lostP = war.lost.player ?? 0;
  assert(lostR > lostP, `the fed side wins (rival lost ${lostR}, player lost ${lostP})`);
  assert(player.genetic > 0, 'overgrowth feeds the victor');
  console.log(`PASS supply decides a front: in 60 s the starved side lost ${lostR} strands, the fed side ${lostP}; overgrowth gave ${player.genetic.toFixed(2)} carbon`);
}
{
  // Cords are armour: the same fight against a cord line kills far fewer.
  const thin = duel({ player: { carbon: 2.4 }, rival: { carbon: 0.2 } });
  thin.run(30);
  const cord = duel({ player: { carbon: 2.4 }, rival: { carbon: 0.2, thickness: 0.8 } });
  cord.run(30);
  assert((cord.war.lost.rival ?? 0) < (thin.war.lost.rival ?? 0), `cords resist (${cord.war.lost.rival ?? 0} vs ${thin.war.lost.rival ?? 0})`);
  console.log(`PASS cords resist: 30 s of the same fight lysed ${thin.war.lost.rival ?? 0} fine strands but ${cord.war.lost.rival ?? 0} cords`);
}
{
  // A severing kill: strands beyond a lysed node lose the founding spore.
  const { war, rival, host } = duel({ rival: { carbon: 1 } });
  host.time = 0;
  const cut = rival.nodes[11];
  const res = war.cast('player', 'coil', { x: cut.spatial.x, y: cut.spatial.y, z: cut.spatial.z });
  assert(res.ok, res.message);
  markConnectivity(rival);
  const severed = rival.nodes.filter((n) => n.alive && !n.connected).length;
  assert(severed > 0, 'strands beyond the cut are severed');
  assert(rival.nodes[0].connected, 'the founding node stays joined');
  console.log(`PASS a coil cut severs ${severed} strands beyond it: ${res.message}`);
}
{
  // Elimination: a front that reaches the founding node cuts off the whole colony.
  const { war, rival, host } = duel({ player: { carbon: 2.4, nitrogen: 3 }, rival: { carbon: 0.3 } });
  const root = rival.nodes[0];
  // Burst the founding node down with oxalate from the player's front (in reach).
  let casts = 0;
  for (let i = 0; i < 40 && root.alive; i++) {
    host.time += 3;
    const aim = { x: 27, y: 20, z: 50 };
    // Walk the player's front toward the root by bursting what stands in the way.
    const target = rival.nodes.filter((n) => n.alive).sort((a, b) => a.spatial.x - b.spatial.x)[0];
    const res = war.cast('player', 'oxalate', target ? { ...target.spatial } : aim);
    if (res.ok) casts++;
    // Move the player's tip forward onto the cleared ground, as growth would.
    const mine = war['host'].stands[0].sim.player.nodes;
    const shift = target ? target.spatial.x - 1 - mine.at(-1).spatial.x : 0;
    if (shift > 0) for (const n of mine) n.spatial = { ...n.spatial, x: n.spatial.x + shift };
    // Refill the front, as transport would.
    for (const n of war['host'].stands[0].sim.player.nodes) { n.carbon = 2.4; n.nitrogen = 3; }
  }
  assert(!root.alive, 'the founding node falls');
  markConnectivity(rival);
  assert.equal(rival.nodes.filter((n) => n.connected).length, 0, 'nothing is joined any more');
  console.log(`PASS elimination: ${casts} oxalate bursts reached the founding node; the whole colony is cut off and will starve`);
}
{
  // Chemicals: cost, one resource for light, combinations for heavy, reach, cooldown, atomic refusal.
  for (const id of CHEMICAL_ORDER) {
    const spec = CHEMICALS[id];
    const kinds = ['carbon', 'water', 'nitrogen'].filter((r) => spec.cost[r] > 0).length;
    assert(spec.weight === 'light' ? kinds === 1 : kinds >= 2, `${id} cost shape`);
  }
  const keys = CHEMICAL_ORDER.map((id) => CHEMICALS[id].key);
  assert.equal(new Set(keys).size, keys.length, 'one key each');
  const { war, player, host } = duel();
  const tip = player.nodes.at(-1).spatial;
  const far = war.cast('player', 'lyse', { x: tip.x + 30, y: tip.y, z: tip.z });
  assert(!far.ok && /reach/.test(far.message), far.message);
  updateTotals(player);
  const before = player.carbon;
  const hit = war.cast('player', 'lyse', { x: tip.x + 1, y: tip.y, z: tip.z });
  assert(hit.ok, hit.message);
  updateTotals(player);
  assert(Math.abs(before - player.carbon - CHEMICALS.lyse.cost.carbon) < 1e-6, 'light lyse costs its carbon exactly');
  const again = war.cast('player', 'lyse', { x: tip.x + 1, y: tip.y, z: tip.z });
  assert(!again.ok && /ready in/.test(again.message), 'cooldown holds');
  host.time += CHEMICALS.lyse.cooldown + 0.01;
  assert(war.cast('player', 'lyse', { x: tip.x + 1, y: tip.y, z: tip.z }).ok, 'ready again: spammable');
  // An unaffordable heavy is refused and charges nothing.
  for (const n of player.nodes) n.nitrogen = 0;
  updateTotals(player);
  const c0 = player.carbon;
  const poor = war.cast('player', 'oxalate', { x: tip.x + 1, y: tip.y, z: tip.z });
  assert(!poor.ok && /nitrogen/.test(poor.message), poor.message);
  updateTotals(player);
  assert.equal(player.carbon, c0, 'a refused cast costs nothing');
  console.log(`PASS chemicals: light ones cost one resource and heavy ones several; reach, spam cooldown (${CHEMICALS.lyse.cooldown}s) and atomic refusal hold (${poor.message})`);
}
{
  // Barrage shields your strands; leachate lingers.
  const shielded = duel({ player: { carbon: 0.3 }, rival: { carbon: 2.4 } });
  const tip = shielded.player.nodes.at(-1).spatial;
  shielded.player.nodes.forEach((n) => { n.water = 3; n.carbon = 2.4; });
  assert(shielded.war.cast('player', 'barrage', { ...tip }).ok);
  shielded.player.nodes.forEach((n) => { n.carbon = 0.3; });
  shielded.run(15);
  const open = duel({ player: { carbon: 0.3 }, rival: { carbon: 2.4 } });
  open.run(15);
  assert((shielded.war.lost.player ?? 0) < (open.war.lost.player ?? 0) || (open.war.lost.player ?? 0) === 0,
    `barrage holds the line (${shielded.war.lost.player ?? 0} vs ${open.war.lost.player ?? 0})`);
  const soak = duel();
  const t2 = soak.player.nodes.at(-1).spatial;
  assert(soak.war.cast('player', 'leach', { x: t2.x + 2, y: t2.y, z: t2.z }).ok);
  assert.equal(soak.war.lingering.length, 1);
  soak.run(CONTACT.leachSeconds + 0.5);
  assert.equal(soak.war.lingering.length, 0, 'leachate washes out');
  console.log(`PASS barrage shields a starved line (${shielded.war.lost.player ?? 0} lost against ${open.war.lost.player ?? 0} unshielded in 15 s); leachate lingers ${CONTACT.leachSeconds}s then washes out`);
}
{
  // The placeholder opponent casts the same orders.
  const { war, run, player } = duel({ player: { thickness: 0.9 }, rival: { carbon: 2.4, nitrogen: 3 } });
  war.bots.add('rival');
  void player;
  run(20);
  const botCasts = war.casts.filter((c) => c.owner === 'rival');
  assert(botCasts.length >= 3, `bot casts ${botCasts.length}`);
  assert(botCasts.some((c) => c.chemical === 'lyse'), 'lyses');
  console.log(`PASS the placeholder opponent fights with the same orders: ${botCasts.length} casts in 20 s (${[...new Set(botCasts.map((c) => c.chemical))].join(', ')})`);
}
{
  // Determinism: the same duel twice gives the same result.
  const a = duel({ rival: { carbon: 1.1 } }); a.war.bots.add('rival'); a.run(30);
  const b = duel({ rival: { carbon: 1.1 } }); b.war.bots.add('rival'); b.run(30);
  const sig = (d) => JSON.stringify([d.war.lost, d.war.killed, d.player.nodes.map((n) => [n.alive, +n.health.toFixed(9), +n.carbon.toFixed(9)]), d.rival.nodes.map((n) => [n.alive, +n.health.toFixed(9)])]);
  assert.equal(sig(a), sig(b));
  console.log('PASS the same duel replays identically');
}
{
  // In a real match the war is wired in and quiet until networks meet.
  const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
  for (let i = 0; i < 60 * 20; i++) m.step(1 / 60);
  assert(m.contact, 'the match owns a contact war');
  assert.equal(m.contact.casts.length, 0, 'nobody casts without a front');
  console.log(`PASS the match runs its contact war: ${m.contact.fronts.length} fronts after 20 s of an ordinary opening`);
}
