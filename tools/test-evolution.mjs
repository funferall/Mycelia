import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-evolution-'));
for (const name of ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'network', 'evolution']) {
  writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8')).replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = name => import(pathToFileURL(join(output, `${name}.mjs`)));
const { createNetwork, markConnectivity, stepNetwork, startFruiting } = await load('network');
const { createWorld } = await load('world');
const { mulberry32 } = await load('rng');
const { ADAPTATIONS, adaptationState, learnAdaptation, invokePower, powerState } = await load('evolution');
const { ECON } = await load('content');
const fresh = () => createNetwork('player', 'test', 30, 8, mulberry32(12), 220);
const net = fresh();
assert.notEqual(learnAdaptation(net, 'deep-drink'), 'Deep drink learned.');
assert.equal(net.evolution.learned.length, 0);
net.nodes[0].bondedTree = 0;
assert.equal(learnAdaptation(net, 'deep-drink'), 'Deep drink learned.');
learnAdaptation(net, 'deep-drink');
assert.equal(net.evolution.learned.length, 1, 'learning cannot stack');
net.nodes[1].bondedTree = 0;
assert.notEqual(adaptationState(net, 'mineral-weave'), 'Ready to learn', 'two junctions on one tree are one partner');
net.nodes[1].bondedTree = 1;
assert.equal(learnAdaptation(net, 'mineral-weave'), 'Mineral weave learned.');
assert.equal(invokePower(net, 'pulse'), 'Complete the first fruiting.');
net.fruited = 1;
assert.equal(invokePower(net, 'pulse'), 'Forest pulse awakened.');
assert.match(invokePower(net, 'pulse'), /Active/);
net.evolution.active.pulse = 0;
assert.match(invokePower(net, 'pulse'), /Recovering/);
net.evolution.cooldown.pulse = 0;
net.nodes[0].children = net.nodes[0].children.filter(id => id !== 1);
markConnectivity(net);
assert.notEqual(powerState(net, 'pulse'), 'Ready to invoke', 'disconnected partners do not qualify');
// A bare network knows nothing; in a regional match the shared lineage supplies
// what the player has learned (see tools/test-regional-play.mjs).
assert.equal(fresh().evolution.learned.length, 0, 'a bare network starts without adaptations');
console.log('PASS milestone gating, distinct partners, idempotence, first bloom, cooldown and severance');

// Identical bodies in identical soil: each upgrade must affect its claimed behavior.
function pair(learned = [], active = {}) {
  const a = fresh(), b = fresh();
  a.resting = b.resting = true;
  for (const n of [...a.nodes, ...b.nodes]) { n.water = 0; n.nitrogen = 0; n.health = .5; }
  b.evolution.learned = learned;
  b.evolution.active = active;
  return [a, b];
}
function tick(n, dt = 1 / 30) {
  const world = createWorld(44);
  stepNetwork(n, { world, dt, time: 1, warmth: 1, light: 1, log() {} });
}
let [a, b] = pair(['deep-drink', 'mineral-weave', 'living-sheath']);
tick(a); tick(b);
assert(b.water > a.water); assert(b.nitrogen > a.nitrogen);
assert(b.nodes[0].health > a.nodes[0].health);
[a, b] = pair([], { mend: 20 });
tick(a); tick(b);
assert(b.nodes[0].health > a.nodes[0].health);
assert(b.carbon < a.carbon, 'repair must spend carbon');
assert.equal(b.evolution.active.mend, 20 - 1 / 30);
const c = fresh(); c.resting = true;
c.evolution.cooldown.pulse = 100;
tick(c); assert.equal(c.evolution.cooldown.pulse, 100 - 1 / 30);
console.log('PASS uptake, recovery, paid healing and fixed-step power clocks');

// A cut cannot be healed or resurrected by a pulse.
const cut = fresh(); cut.resting = true; cut.evolution.active.mend = 20;
const child = cut.nodes[1]; child.health = .4;
cut.nodes[0].children = cut.nodes[0].children.filter(id => id !== child.id);
tick(cut); assert(child.health < .4);
cut.nodes[0].alive = false;
for (const tech of ADAPTATIONS) assert.notEqual(adaptationState(cut, tech.id), 'Ready to learn');
console.log('PASS repair respects topology and dead founders cannot evolve');

// Fruiting acceleration consumes the same reserve and still respects weather.
function fruitNet() {
  const n = fresh(); n.resting = true;
  n.surplus = ECON.fruitThreshold;
  const root = n.nodes[0]; root.gy = 2; root.wy = 2.5; root.water = 6; root.nitrogen = 3;
  startFruiting(n, () => true, root.gx, root.gy);
  assert(n.fruit.active);
  return n;
}
a = fruitNet(); b = fruitNet();
b.evolution.active.bloom = 20;
const worldA = createWorld(44), worldB = createWorld(44);
worldA.rainfall = worldB.rainfall = 1;
const context = world => ({ world, dt: 1 / 30, time: 1, warmth: 1, light: 1, log() {} });
stepNetwork(a, context(worldA)); stepNetwork(b, context(worldB));
assert(b.fruit.store < a.fruit.store, 'faster fruit spends reserve faster');
assert(Math.abs((ECON.fruitThreshold - b.fruit.store) / (ECON.fruitThreshold - a.fruit.store) - 2) < 1e-6);
const before = b.fruit.store;
stepNetwork(b, { ...context(worldB), warmth: 0 });
assert.equal(b.fruit.store, before, 'power cannot bypass frost');
console.log('PASS fruit acceleration pays its reserve and respects frost');

[a, b] = pair(['cord-memory']);
tick(a); tick(b);
assert(b.nodes[0].carbon < a.nodes[0].carbon, 'cord memory increases transfer out of the founder');
[a, b] = pair([], { pulse: 20 });
tick(a); tick(b);
assert(b.nodes[0].carbon < a.nodes[0].carbon, 'forest pulse increases transport');
console.log('PASS cord memory and forest pulse move resources along existing edges');

[a, b] = pair(['fruit-memory']);
a.nodes[0].bondedTree = b.nodes[0].bondedTree = 0;
const tradeWorld = () => {
  const w = createWorld(44);
  w.trees[0].waterReceived = w.trees[0].nutrientReceived = 1;
  return w;
};
stepNetwork(a, context(tradeWorld())); stepNetwork(b, context(tradeWorld()));
assert(a.surplus > 0);
assert(Math.abs(b.surplus / a.surplus - .65 / .55) < 1e-8, 'quiet reserve reallocates healthy trade');
a = fruitNet(); b = fruitNet(); b.evolution.learned = ['spore-memory'];
stepNetwork(a, context(worldA)); stepNetwork(b, context(worldB));
assert(Math.abs((ECON.fruitThreshold - b.fruit.store) / (ECON.fruitThreshold - a.fruit.store) - 1.15) < 1e-6);
console.log('PASS quiet reserve and spore memory apply their researched effects');

a = fresh(); b = fresh();
for (const n of [a, b]) { n.evolution.learned = ADAPTATIONS.map(t => t.id); n.evolution.active.pulse = 20; }
const deterministicA = createWorld(44), deterministicB = createWorld(44);
for (let i = 0; i < 120; i++) { stepNetwork(a, context(deterministicA)); stepNetwork(b, context(deterministicB)); }
assert.deepEqual(a.nodes, b.nodes); assert.deepEqual(a.evolution, b.evolution);
console.log('PASS deterministic evolution under identical fixed steps');
