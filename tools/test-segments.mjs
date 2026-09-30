/**
 * Headless checks for the strand economy (`PERF-04`, `src/sim/segments.ts`):
 * runs of strands pool their stores during a step and share them back after,
 * so the game outside a step still sees every strand's own stores.
 *
 *   node tools/test-segments.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'mycelia-segments-'));
for (const file of readdirSync(new URL('../src/sim/', import.meta.url)).filter((f) => f.endsWith('.ts'))) {
  writeFileSync(join(out, file.replace('.ts', '.mjs')), stripTypeScriptTypes(readFileSync(new URL('../src/sim/' + file, import.meta.url), 'utf8')).replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = (name) => import(pathToFileURL(join(out, name + '.mjs')));
const { RegionalMatch } = await load('match');
const { updateTotals } = await load('network');
const { economyOf, TEND_SLICES, heldBy, poolStrands, spreadStrands } = await load('segments');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

/** A fed colony grown for `seconds`, the way the benches grow one. */
function grown(seconds = 120) {
  const match = new RegionalMatch('raven-wood');
  for (let s = 0; s < seconds; s++) {
    for (const n of match.active.sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6);
    for (let i = 0; i < 60; i++) match.step(1 / 60);
  }
  return match;
}

const living = (net) => net.nodes.filter((n) => n.alive);
const stock = (net, key) => net.nodes.reduce((v, n) => v + (n.alive && n.connected ? n[key] : 0), 0);

check('runs hold only plain struts, and most of a grown colony is in one', () => {
  const match = grown();
  const net = match.active.sim.player;
  match.step(1 / 60);
  const economy = economyOf(net);
  assert.ok(economy, 'a stepped network has an economy');
  let members = 0;
  for (const segment of economy.segments) {
    for (const id of segment.members) {
      const node = net.nodes[id];
      members++;
      if (!node.alive) continue;
      assert.equal(node.isTip, false, 'no tip in a run');
      assert.ok(node.bondedTree < 0, 'no tree junction in a run');
      assert.notEqual(node.id, net.rootId, 'the founder is never in a run');
      assert.equal(node.children.filter((c) => net.nodes[c]?.alive).length, 1, 'a run strand has one living child');
    }
  }
  const strands = living(net).length;
  console.log(`  ${strands} strands: ${members} in ${economy.segments.length} runs, ${economy.order.length} trading entities`);
  assert.ok(members > strands * 0.5, 'most strands are pooled');
  assert.ok(economy.order.length < strands / 3, 'far fewer trading entities than strands');
});

check('outside a step every strand holds its own stores, and totals agree', () => {
  const match = grown(60);
  const net = match.active.sim.player;
  match.step(1 / 60);
  const economy = economyOf(net);
  assert.equal(economy.pooled, false, 'pools exist only inside a step');
  for (const node of living(net)) {
    for (const key of ['carbon', 'water', 'nitrogen']) assert.equal(heldBy(net, node, key), node[key]);
  }
  const before = { carbon: net.carbon, water: net.water, nitrogen: net.nitrogen };
  updateTotals(net);
  for (const key of ['carbon', 'water', 'nitrogen']) {
    assert.ok(Math.abs(before[key] - net[key]) < 1e-6, `${key} totals from pools match totals from strands`);
  }
});

check('a write to a strand between steps is carried into its run, and shared back exactly', () => {
  const match = grown(60);
  const net = match.active.sim.player;
  const economy = economyOf(net);
  const segment = economy.segments.find((s) => s.members.length > 4);
  assert.ok(segment, 'a run to feed');
  const members = segment.members.map((id) => net.nodes[id]);
  const sum = () => members.reduce((v, n) => v + n.carbon, 0);
  members[2].carbon += 0.5;
  const written = sum();
  poolStrands(net, economy);
  assert.ok(Math.abs(segment.carbon - written) < 1e-9, 'the pool holds what the strands held, the gift included');
  spreadStrands(net, economy);
  assert.ok(Math.abs(sum() - written) < 1e-9, 'sharing back conserves the pool');
  assert.ok(members.every((n) => Math.abs(n.carbon - written / members.length) < 1e-9), 'every strand holds an equal share');
});

check('every strand in a run is tended within one full turn of slices', () => {
  const match = grown(60);
  const net = match.active.sim.player;
  for (let i = 0; i < TEND_SLICES; i++) match.step(1 / 60);
  const economy = economyOf(net);
  const now = net.evolution.age;
  const stale = [];
  for (const segment of economy.segments) {
    for (const id of segment.members) {
      const node = net.nodes[id];
      if (node.alive && now - (node.tendedAt ?? -Infinity) > TEND_SLICES / 60 + 1e-6) stale.push(id);
    }
  }
  assert.deepEqual(stale, [], 'no strand waits longer than its slice');
});

check('a strand killed inside a run splits it at the next step', () => {
  const match = grown(60);
  const net = match.active.sim.player;
  const economy = economyOf(net);
  const segment = economy.segments.find((s) => s.members.length > 6);
  assert.ok(segment, 'a long run');
  const victim = net.nodes[segment.members[3]];
  const below = net.nodes[segment.members[5]];
  // Kill it the way the soil does: through a withering strand.
  victim.health = 0;
  victim.alive = false;
  net.nodes[victim.parent].children = net.nodes[victim.parent].children.filter((id) => id !== victim.id);
  economy.stale = true;
  match.step(1 / 60);
  const rebuilt = economyOf(net);
  assert.notEqual(rebuilt, economy, 'the economy was rebuilt');
  assert.equal(below.connected, false, 'the strands beyond the cut are no longer reached');
  for (const s of rebuilt.segments) assert.ok(!s.members.includes(victim.id), 'the dead strand left its run');
});

console.log(`PASS: ${passed} checks.`);
