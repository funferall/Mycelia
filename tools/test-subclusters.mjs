import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out = mkdtempSync(join(tmpdir(), 'mycelia-groups-'));
for (const file of readdirSync(new URL('../src/sim/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
  writeFileSync(join(out, file.replace('.ts', '.mjs')), stripTypeScriptTypes(readFileSync(new URL('../src/sim/' + file, import.meta.url), 'utf8')).replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = name => import(pathToFileURL(join(out, name + '.mjs')));
const { RegionalMatch } = await load('match');
const { MIN_SPLIT_STRANDS, MIN_GROUP_STRANDS, groupSummary, setGroupResting, groupResting } = await load('network');

/** A founding colony kept fed, so it grows like a well-supplied match. */
function grown(seconds, seed = 'split-test') {
  const m = new RegionalMatch(seed);
  const sim = m.active.sim;
  const step = (s) => { for (let t = 0; t < s; t++) { for (const n of sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6); for (let i = 0; i < 60; i++) m.step(1 / 60); } };
  step(seconds);
  return { m, sim, net: sim.player, step };
}
const tipsOf = (net, id) => net.nodes.filter(n => n.alive && n.isTip && (n.group ?? 0) === id);
const meanDistance = (nodes, p) => nodes.reduce((v, n) => v + Math.hypot(n.wx - p.gx, n.wy - p.gy), 0) / Math.max(1, nodes.length);

{
  const { sim } = grown(0);
  const refused = sim.splitAt(sim.player.nodes[0].gx, sim.player.nodes[0].gy, 20);
  assert.equal(refused.ok, false);
  assert.match(refused.message, new RegExp(String(MIN_SPLIT_STRANDS)));
  console.log(`PASS a young colony cannot split: "${refused.message}"`);
}
{
  const { sim, net, step } = grown(60);
  assert(net.nodes.filter(n => n.alive).length >= MIN_SPLIT_STRANDS, 'the fed colony is large enough');
  // Pick the living tip farthest from the root, and circle the strands around it.
  const root = net.nodes[net.rootId];
  const far = net.nodes.filter(n => n.alive && n.isTip).sort((a, b) => Math.hypot(b.gx - root.gx, b.gy - root.gy) - Math.hypot(a.gx - root.gx, a.gy - root.gy))[0];
  const tooSmall = sim.splitAt(far.gx, far.gy, 0.5);
  assert.equal(tooSmall.ok, false);
  assert.match(tooSmall.message, new RegExp(String(MIN_GROUP_STRANDS)));
  const split = sim.splitAt(far.gx, far.gy, 12);
  assert.equal(split.ok, true, split.message);
  const id = split.id;
  const inGroup = net.nodes.filter(n => n.alive && n.group === id).length;
  assert.equal(inGroup, split.strands);
  // Opposite destinations: the subcluster one way, the colony the other.
  const groupTarget = { gx: Math.min(130, far.gx + 40), gy: Math.min(60, far.gy + 20) };
  const colonyTarget = { gx: Math.max(4, root.gx - 40), gy: Math.min(60, root.gy + 10) };
  assert.equal(sim.growTo(groupTarget.gx, groupTarget.gy, id).ok, true);
  assert.equal(sim.growTo(colonyTarget.gx, colonyTarget.gy).ok, true);
  const before = meanDistance(tipsOf(net, id), groupTarget);
  step(20);
  const groupTips = tipsOf(net, id);
  assert(groupTips.length >= 1, 'the subcluster has growing tips');
  const after = meanDistance(groupTips, groupTarget);
  assert(after < before - 2, `the subcluster grows toward its own target (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  assert(net.groups.find(g => g.id === id), 'the group persists');
  assert.equal(net.waypoints[0]?.gx ?? colonyTarget.gx, colonyTarget.gx, 'the colony keeps its own order');
  assert(net.tipCount <= net.tipCeiling + 1, 'one shared tip allowance');
  // Rest the subcluster: its tips stop; the colony's keep moving.
  setGroupResting(net, id, true);
  assert.equal(groupResting(net, id), true);
  const held = tipsOf(net, id).map(n => [n.id, n.wx, n.wy]);
  step(5);
  for (const [nid, wx, wy] of held) {
    const n = net.nodes[nid];
    if (n.alive && n.isTip) assert(n.wx === wx && n.wy === wy, 'a resting subcluster does not extend');
  }
  console.log(`PASS split ${split.strands} strands: subcluster tips ${before.toFixed(1)} -> ${after.toFixed(1)} from their own target, colony keeps its order, shared allowance, rest holds`);
  assert.equal(sim.mergeGroup(id), true);
  assert(!net.nodes.some(n => n.group === id), 'merged strands return to the colony');
  assert.equal(groupSummary(net).length, 1);
  console.log('PASS merge returns strands to the colony');
}
{
  // A region picked from the interior has no tips; ordered, it sprouts its own.
  const { sim, net, step } = grown(60);
  const interior = net.nodes.find(n => n.alive && !n.isTip && n.id !== net.rootId &&
    net.nodes.filter(m => m.alive && Math.hypot(m.gx - n.gx, m.gy - n.gy) <= 4).length >= MIN_GROUP_STRANDS &&
    !net.nodes.some(m => m.alive && m.isTip && Math.hypot(m.gx - n.gx, m.gy - n.gy) <= 4.5));
  assert(interior, 'an interior region without tips exists');
  const split = sim.splitAt(interior.gx + 0.5, interior.gy + 0.5, 4);
  assert.equal(split.ok, true, split.message);
  assert.equal(split.tips, 0, 'the region starts with no tips');
  // The colony has spent its whole allowance: the subcluster must borrow.
  const colonyTipsBefore = tipsOf(net, 0).length;
  assert(net.tipCount >= net.tipCeiling, `allowance spent (${net.tipCount}/${net.tipCeiling})`);
  const target = { gx: Math.min(130, interior.gx + 30), gy: Math.min(70, interior.gy + 25) };
  sim.growTo(target.gx, target.gy, split.id);
  step(6);
  const sprouted = tipsOf(net, split.id);
  assert(sprouted.length >= 1, 'the interior subcluster sprouted tips from its own strands');
  assert(tipsOf(net, 0).length < colonyTipsBefore + 2, 'the colony gave up tips to make room');
  assert(net.tipCount <= net.tipCeiling, `still one shared allowance (${net.tipCount}/${net.tipCeiling})`);
  console.log(`PASS an interior region with no tips sprouts ${sprouted.length} of its own, borrowing from the colony (${net.tipCount}/${net.tipCeiling} tips)`);
}
{
  // A circle that takes every tip must not strand the colony: ordered, it sprouts its own.
  const { sim, net, step } = grown(60);
  const root = net.nodes[net.rootId];
  const split = sim.splitAt(root.gx + 0.5, root.gy + 0.5, 200);
  assert.equal(split.ok, true, split.message);
  const left = net.nodes.filter(n => n.alive && !n.group);
  assert.equal(left.length, 0, 'the circle took the whole colony');
  // Merge part back so the colony holds strands but no tips.
  for (const n of net.nodes) if (n.alive && !n.isTip && Math.hypot(n.gx - root.gx, n.gy - root.gy) < 8) delete n.group;
  assert.equal(tipsOf(net, 0).length, 0, 'the colony has strands and no tips');
  sim.growTo(Math.max(2, root.gx - 30), Math.min(60, root.gy + 20));
  step(6);
  assert(tipsOf(net, 0).length >= 1, 'the colony sprouts tips of its own');
  console.log(`PASS a colony left without tips sprouts ${tipsOf(net, 0).length} when ordered`);
}
{
  const run = () => {
    const { sim, net, step } = grown(60, 'split-replay');
    const tip = net.nodes.filter(n => n.alive && n.isTip)[0];
    const split = sim.splitAt(tip.gx, tip.gy, 10);
    sim.growTo(10, 40, split.id);
    step(15);
    return JSON.stringify(net.nodes.map(n => [n.alive, n.gx, n.gy, n.group ?? 0, +n.carbon.toFixed(9)]));
  };
  assert.equal(run(), run());
  console.log('PASS deterministic replay with subclusters');
}
