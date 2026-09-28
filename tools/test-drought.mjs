import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out = mkdtempSync(join(tmpdir(), 'mycelia-drought-'));
for (const file of readdirSync(new URL('../src/sim/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
  writeFileSync(join(out, file.replace('.ts', '.mjs')), stripTypeScriptTypes(readFileSync(new URL('../src/sim/' + file, import.meta.url), 'utf8')).replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = name => import(pathToFileURL(join(out, name + '.mjs')));
const { RegionalMatch } = await load('match');
const { DROUGHT } = await load('drought');
const { FIRE } = await load('wildfire');
const { GRID } = await load('content');
const { markConnectivity, updateTotals } = await load('network');

/** A colony holding the capstone; stand ecology frozen so every change is the drought's. */
function fixture(seed = 'drought-test', freeze = true) {
  const m = new RegionalMatch(seed);
  const id = m.region.foundingStand;
  const from = m.stands[id];
  const net = from.sim.player;
  net.evolution.learned = ['deep-drink', 'mineral-weave', 'parch-crown', 'ember-crown'];
  net.evolution.age = 300;
  for (const n of net.nodes) { n.carbon = 300; n.water = 100; n.nitrogen = 50; }
  markConnectivity(net); updateTotals(net);
  if (freeze) { for (const s of m.stands) s.sim.step = () => {}; m.soil.step = () => {}; }
  return { m, id, from, net };
}
const cell = (world, gx, gy) => world.cells[gy * GRID.cols + gx];
const whole = DROUGHT.warning + DROUGHT.active;

{
  const { m, id, net } = fixture();
  net.evolution.learned = ['deep-drink', 'mineral-weave'];
  assert.match(m.droughtStatus(id), /Parch crown/);
  net.evolution.learned.push('parch-crown', 'ember-crown');
  m.storm.phase = 'warning';
  assert.match(m.callDrought(id), /storm/);
  m.storm.phase = 'idle';
  const before = net.carbon;
  assert.equal(m.callDrought(id), 'Drought called');
  assert(Math.abs(before - net.carbon - DROUGHT.cost.carbon) < 1e-6, 'the caller pays');
  assert.match(m.stormStatus(id), /drought/, 'no storm forms in a drought');
  assert.equal(m.fireStatus(id), 'Ready to kindle', 'a fire may be kindled into a drought');
  m.step(DROUGHT.warning - 0.01);
  assert.equal(m.drought.phase, 'warning');
  assert.equal(m.drought.severity, 0, 'the warning is only heat');
  m.step(0.02);
  assert.equal(m.drought.phase, 'active');
  m.step(DROUGHT.onset);
  assert.equal(m.drought.severity, 1);
  // Weather is set at the start of a step: take one short step at full severity.
  m.step(0.1);
  for (const s of m.stands) {
    assert.equal(s.sim.regionalWeather.fruiting, false, 'no fruiting weather in a drought');
    assert(s.sim.world.rainfall <= DROUGHT.rainfall + 1e-9, 'the rain has stopped');
  }
  m.step(DROUGHT.active - DROUGHT.onset - 0.1);
  assert.equal(m.drought.phase, 'recovery');
  m.step(DROUGHT.recovery);
  assert.equal(m.drought.phase, 'idle');
  assert.match(m.droughtStatus(id), /recovering/);
  m.step(DROUGHT.cooldown);
  assert.equal(m.droughtStatus(id), 'Ready to call');
  console.log('PASS gating, atomic cost, storm/fire interplay, onset severity, rain withheld, fruiting halted, phase boundaries');
}
{
  // Land cracks away from water; the banks stay damp.
  const { m, id } = fixture();
  const stand = m.stands.find(s => s.sim.world.cells.some(c => c.streamNear >= 0.8 && !c.stream));
  assert(stand, 'some stand has a stream');
  const w = stand.sim.world;
  let bank = -1, far = -1;
  for (let gx = 0; gx < GRID.cols; gx++) {
    const c = cell(w, gx, 2);
    if (bank < 0 && c.streamNear >= 0.8 && !c.stream) bank = gx;
    if (far < 0 && c.streamNear === 0) far = gx;
  }
  for (const gx of [bank, far]) cell(w, gx, 2).water = 0.5;
  m.callDrought(id);
  m.step(whole);
  const b = cell(w, bank, 2).water, f = cell(w, far, 2).water;
  assert(f < 0.1, `far ground parches (${f.toFixed(2)})`);
  assert(b > f + 0.3, `bank stays damp (${b.toFixed(2)} vs ${f.toFixed(2)})`);
  console.log(`PASS soil: far ground ${f.toFixed(2)}, stream bank ${b.toFixed(2)}`);
}
{
  // Fed trees hold; unfed trees decline and die standing; stream-side roots are safe.
  const { m, id, from, net } = fixture();
  const w = from.sim.world;
  const dry = w.trees.filter(t => !t.dead && cell(w, t.gx, 8).streamNear < DROUGHT.bank);
  const [fed, unfed, weak, bankside] = dry;
  for (const t of [fed, unfed, weak, bankside]) { t.species = 'hemlock'; t.maturity = 0.5; t.health = 0.9; t.rootTips.forEach(tip => { tip.bondedTo = null; }); }
  weak.health = 0.25;
  for (let gy = 0; gy < 12; gy++) cell(w, bankside.gx, gy).streamNear = 0.9;
  const junction = net.nodes[net.rootId];
  fed.rootTips[0].bondedTo = junction.id; fed.rootTips[0].bondedColonyId = net.colonyId ?? null;
  junction.bondedTree = fed.id; junction.bondedRootTip = 0; junction.water = 500;
  m.callDrought(id);
  m.step(whole);
  assert(!fed.dead && fed.health >= 0.9, `a fed tree holds (${fed.health.toFixed(2)})`);
  assert(junction.water < 500, 'its water came out of the junction');
  assert(m.drought.fedTrees.has(`${from.site.id}:${fed.id}`));
  assert(unfed.health < 0.9 - 0.2, `an unfed tree declines (${unfed.health.toFixed(2)})`);
  assert(weak.dead && weak.parched, 'a weak unfed tree dies standing');
  assert.equal(bankside.health, 0.9, 'roots at the stream are untouched');
  console.log(`PASS trees: fed ${fed.health.toFixed(2)}, unfed ${unfed.health.toFixed(2)}, weak died, bankside untouched, ${m.drought.waterGiven.toFixed(0)} water given`);
}
{
  // Deep roots tolerate drought: oak loses less than hemlock in the same ground.
  const { m, id, from } = fixture();
  const w = from.sim.world;
  const [oak, hemlock] = w.trees.filter(t => !t.dead && cell(w, t.gx, 8).streamNear < DROUGHT.bank);
  for (const t of [oak, hemlock]) { t.maturity = 0.8; t.health = 1; t.seed = 500; t.rootTips.forEach(tip => { tip.bondedTo = null; }); }
  oak.species = 'oak'; hemlock.species = 'hemlock';
  cell(w, oak.gx, 8).water = cell(w, hemlock.gx, 8).water = 0.2;
  m.callDrought(id);
  m.step(whole);
  assert(1 - oak.health < (1 - hemlock.health) * 0.6, `oak ${oak.health.toFixed(2)} outlasts hemlock ${hemlock.health.toFixed(2)}`);
  console.log(`PASS species: oak ${oak.health.toFixed(2)} vs hemlock ${hemlock.health.toFixed(2)}`);
}
{
  // Strands: shallow and dry wither; deep, banked or watered strands and the root live.
  const { m, id, from, net } = fixture();
  const w = from.sim.world;
  const root = net.nodes[net.rootId];
  for (let i = 0; i < 4; i++) {
    const nid = net.nodes.length;
    net.nodes.push({ ...root, id: nid, parent: root.id, children: [], gx: root.gx + 5 + i * 3, wx: root.gx + 5 + i * 3, bondedTree: -1, bondedRootTip: -1 });
    root.children.push(nid);
  }
  markConnectivity(net);
  const [shallow, deep, banked, root2] = net.nodes.slice(-4);
  const place = (n, gy, water, near = 0) => { n.gy = gy; n.water = 0; n.health = 1; n.carbon = 0; const c = cell(w, n.gx, gy); c.water = water; c.streamNear = near; };
  place(shallow, 4, 0.05); place(deep, 40, 0.05); place(banked, 4, 0.05, 0.9); place(root2, 4, 0.5);
  root.gy = 4; root.water = 0; cell(w, root.gx, 4).water = 0.05; cell(w, root.gx, 4).streamNear = 0;
  m.callDrought(id);
  m.step(whole);
  assert.equal(shallow.alive, false, 'a shallow strand in parched soil withers');
  assert(deep.alive && deep.health === 1, 'a deep strand is untouched');
  assert(banked.alive && banked.health === 1, 'a strand on the bank is untouched');
  assert(root.alive, 'the colony root holds on');
  assert(m.drought.losses.player.strands >= 1);
  console.log(`PASS strands: shallow withers, deep/bank safe, root holds (${JSON.stringify(m.drought.losses.player)})`);
}
{
  // Ground nobody steps recovers with the relief rain.
  const { m, id } = fixture('drought-rewet', false);
  const idle = m.stands.find(s => !s.sim.hasColony && !s.rivalPresent);
  const top = () => { let v = 0; for (let gx = 0; gx < GRID.cols; gx++) v += cell(idle.sim.world, gx, 2).water; return v / GRID.cols; };
  m.callDrought(id);
  for (let i = 0; i < whole * 4; i++) m.step(0.25);
  const parched = top();
  for (let i = 0; i < DROUGHT.recovery * 4; i++) m.step(0.25);
  assert(top() > parched + 0.05, `unstepped ground rewets (${parched.toFixed(2)} -> ${top().toFixed(2)})`);
  console.log(`PASS recovery rewets unstepped ground ${parched.toFixed(2)} -> ${top().toFixed(2)}`);
}
{
  // A fire kindled into a drought finds drier ground and burns more.
  // Kindled as the drought breaks out, so the burn runs inside the dry spell.
  // Compared as a share of the trees alive at ignition: the drought kills some first.
  const burned = (withDrought) => {
    const { m, id } = fixture('drought-fire', false);
    if (withDrought) { m.callDrought(id); for (let i = 0; i < DROUGHT.warning * 4; i++) m.step(0.25); }
    for (const n of m.stands[id].sim.player.nodes) { n.carbon = 300; n.nitrogen = 50; }
    assert.equal(m.kindleFire(id, 0), 'Fire kindled');
    for (let i = 0; i < FIRE.warning * 4; i++) m.step(0.25);
    const living = m.stands.reduce((v, s) => v + s.sim.world.trees.filter(t => !t.dead).length, 0);
    for (let i = 0; i < (FIRE.burn + 1) * 4; i++) m.step(0.25);
    return m.fire.livingTreesBurned / living;
  };
  const wet = burned(false), dry = burned(true);
  assert(dry > wet + 0.1, `drought feeds the fire (${(100 * wet).toFixed(0)}% -> ${(100 * dry).toFixed(0)}%)`);
  console.log(`PASS a fire in a drought burns more: ${(100 * wet).toFixed(0)}% -> ${(100 * dry).toFixed(0)}% of living trees`);
}
{
  const run = () => {
    const { m, id } = fixture('drought-replay', false);
    m.callDrought(id);
    for (let i = 0; i < whole * 4; i++) m.step(0.25);
    return JSON.stringify({ state: m.drought.state, trees: m.drought.parchedTrees, losses: m.drought.losses, water: m.drought.waterGiven });
  };
  assert.equal(run(), run());
  console.log('PASS deterministic replay');
}
