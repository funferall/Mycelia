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
const { MIN_SPLIT_STRANDS, MIN_GROUP_STRANDS, groupSummary, setGroupResting, groupResting, createGroupWhere, orderWaypoint } = await load('network');

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
  const { sim, net, step } = grown(60);
  const root = net.nodes[net.rootId];
  const far = tipsOf(net, 0).sort((a, b) => Math.hypot(b.gx - root.gx, b.gy - root.gy) - Math.hypot(a.gx - root.gx, a.gy - root.gy))[0];
  const first = sim.splitAt(root.gx + 0.5, root.gy + 0.5, 10);
  const second = createGroupWhere(net, sim.world, (n) => !n.group && Math.hypot(n.gx - far.gx, n.gy - far.gy) <= 12);
  assert(first.ok && second.ok, `${first.message}; ${second.message}`);
  const targets = [
    { id: first.id, gx: Math.max(4, root.gx - 30), gy: Math.min(60, root.gy + 10) },
    { id: second.id, gx: Math.min(130, far.gx + 40), gy: Math.min(60, far.gy + 20) },
  ];
  const distance = (p) => Math.min(...net.nodes.filter((n) => n.alive && n.group === p.id).map((n) => Math.hypot(n.wx - p.gx, n.wy - p.gy)));
  net.resting = true;
  const colonyOrder = JSON.stringify(net.waypoints);
  for (const p of targets) assert(sim.growTo(p.gx, p.gy, p.id).ok);
  const before = targets.map(distance);
  step(20);
  for (const [i, p] of targets.entries()) {
    assert(distance(p) < before[i] - 2, `group ${p.id} independently approaches its target (${before[i]} -> ${distance(p)})`);
    assert.equal(net.groups.find((g) => g.id === p.id).waypoints[0].gx, p.gx);
  }
  assert.equal(net.resting, true);
  assert.equal(JSON.stringify(net.waypoints), colonyOrder);
  assert(net.tipCount <= net.tipCeiling, 'independent objectives share the existing tip allowance');
  console.log('PASS two subclusters grow simultaneously toward opposite objectives while the colony keeps its own rest and orders');

  const tip = tipsOf(net, second.id)[0];
  orderWaypoint(net, tip.gx, tip.gy, sim.world, undefined, second.id);
  assert.equal(net.groups.find((g) => g.id === second.id).waypoints.length, 1, 'an arrived tip keeps the group objective');
  const held = [tip.wx, tip.wy];
  step(1);
  assert.deepEqual([tip.wx, tip.wy], held, 'an arrived tip holds instead of resuming autonomous growth');
  const obstructed = Object.create(sim.world);
  obstructed.passableFrom = () => false;
  obstructed.cellFrom = () => null;
  orderWaypoint(net, targets[1].gx, targets[1].gy, obstructed, undefined, second.id);
  assert.equal(net.groups.find((g) => g.id === second.id).waypoints.length, 1, 'an obstructed tip keeps the group objective');
  assert.equal(net.groups.find((g) => g.id === first.id).waypoints[0].gx, targets[0].gx, 'arrival and obstruction leave the other group alone');
  console.log('PASS arrival holds and obstruction preserves the objective without clearing another group\'s direction');
}

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
  const { m, sim, net, step } = grown(60);
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
  // With no viable parent, requesting a tip must not retire a colony tip.
  const carbon = net.nodes.map((n) => n.carbon);
  for (const n of net.nodes) n.carbon = 0;
  net.resting = true;
  const donorIds = tipsOf(net, 0).map((n) => n.id);
  m.step(1 / 60);
  assert(donorIds.every((id) => net.nodes[id].isTip), 'an unfunded group does not consume another group\'s tip');
  net.resting = false;
  net.nodes.forEach((n, i) => { n.carbon = carbon[i] ?? n.carbon; });
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
{
  // A regional body (the colony has grown across a stand edge): a subcluster
  // circled in physical XYZ takes a section order alone.
  const { m, net, step } = grown(60, 'split-regional');
  const site = m.region.stands[m.region.foundingStand];
  const dir = site.sx < m.region.cols - 1 ? 'east' : 'west';
  const localTip = net.nodes.find((n) => n.alive && n.isTip);
  const localSplit = m.active.sim.splitAt(localTip.gx, localTip.gy, 12);
  assert(localSplit.ok && localSplit.id, localSplit.message);
  const unselectedOrder = JSON.stringify(net.waypoints);
  const crossing = m.growAcross(dir, localSplit.id);
  assert(crossing.ok, crossing.message);
  assert.match(crossing.message, /Subcluster/);
  assert.equal(net.groups.find((g) => g.id === localSplit.id).waypoints.length, 1,
    'the edge crossing belongs to the selected subcluster');
  assert.equal(JSON.stringify(net.waypoints), unselectedOrder,
    'promoting the network to a regional body leaves colony orders alone');
  assert.equal(m.spatial.mergeGroup(localSplit.id), true);
  step(5);
  const body = m.spatialColonies.get(m.region.foundingStand);
  assert.equal(body.colony, net, 'the body is the same network');
  const { elevationAtDepthCm } = await load('spatial');
  const root = body.nodePosition(net.nodes[net.rootId]);
  const far = net.nodes.filter((n) => n.alive && n.isTip)
    .map((n) => ({ n, at: body.nodePosition(n) }))
    .sort((a, b) => Math.hypot(b.at.x - root.x, b.at.y - root.y) - Math.hypot(a.at.x - root.x, a.at.y - root.y))[0];
  const split = body.splitAt(far.at, 12);
  assert(split.ok && split.id, split.message);
  const colonyBefore = JSON.stringify(net.waypoints);
  const x = far.at.x + (far.at.x > root.x ? 14 : -14);
  const target = { x, y: far.at.y, z: elevationAtDepthCm(m.region, x, far.at.y, 12) };
  const ordered = body.growAt(target, 'x', far.at.y, split.id);
  assert(ordered.ok, ordered.message);
  assert.match(ordered.message, /Subcluster/);
  const group = net.groups.find((g) => g.id === split.id);
  assert.equal(group.waypoints.length, 1, 'the order went to the subcluster');
  assert.equal(JSON.stringify(net.waypoints), colonyBefore, 'the colony kept its own orders');
  const nearest = () => Math.min(...net.nodes.filter((n) => n.alive && n.group === split.id).map((n) => { const p = body.nodePosition(n); return Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z); }));
  const before = nearest();
  step(30);
  const after = nearest();
  assert(after < before - 3, `the subcluster grows toward its order (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  assert.equal(body.groupNodeIds(split.id).size, net.nodes.filter((n) => n.alive && n.group === split.id).length);
  assert(body.mergeGroup(split.id) && !net.groups.some((g) => g.id === split.id), 'merged back');
  console.log(`PASS a regional body's subcluster (${split.message.split(':')[1].trim()}) took a section order alone and closed from ${before.toFixed(1)} to ${after.toFixed(1)} in 30 s`);
}
