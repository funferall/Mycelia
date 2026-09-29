import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out = mkdtempSync(join(tmpdir(), 'mycelia-fire-'));
for (const file of readdirSync(new URL('../src/sim/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
  writeFileSync(join(out, file.replace('.ts', '.mjs')), stripTypeScriptTypes(readFileSync(new URL('../src/sim/' + file, import.meta.url), 'utf8')).replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = name => import(pathToFileURL(join(out, name + '.mjs')));
const { RegionalMatch } = await load('match');
const { FIRE } = await load('wildfire');
const { GRID } = await load('content');
const { markConnectivity, updateTotals } = await load('network');
const { adaptationState } = await load('evolution');

/** A late-game colony with the capstone, ecology frozen so every effect is the fire's. */
function fixture(seed = 'ember-test') {
  const m = new RegionalMatch(seed);
  const id = m.region.foundingStand;
  const from = m.stands[id];
  const net = from.sim.player;
  net.evolution.learned = ['living-sheath', 'cord-memory', 'ember-crown'];
  net.evolution.age = 300;
  for (const n of net.nodes) { n.carbon = 300; n.water = 100; n.nitrogen = 50; }
  markConnectivity(net); updateTotals(net);
  for (const s of m.stands) s.sim.step = () => {};
  m.soil.step = () => {};
  for (const s of m.stands) for (const c of s.sim.world.cells) c.water = 0;
  return { m, id, from, net };
}
const cell = (world, gx, gy) => world.cells[gy * GRID.cols + gx];

{
  const { m, id, net } = fixture();
  net.evolution.learned = ['living-sheath', 'cord-memory'];
  assert.notEqual(adaptationState(net, 'ember-crown'), 'Learned');
  assert.match(m.fireStatus(id), /Ember crown/);
  net.evolution.learned.push('ember-crown');
  const before = net.carbon;
  assert.match(m.kindleFire(id, NaN), /Choose/);
  assert.equal(net.carbon, before, 'a refused kindling costs nothing');
  m.storm.phase = 'active';
  assert.match(m.kindleFire(id, 0), /storm/);
  m.storm.phase = 'idle';
  assert.equal(m.kindleFire(id, 0), 'Fire kindled');
  assert(Math.abs(before - net.carbon - FIRE.cost.carbon) < 1e-6, 'the kindler pays');
  assert.match(m.stormStatus(id), /wildfire/, 'no storm while a fire runs');
  m.step(FIRE.warning - 0.01);
  assert.equal(m.fire.phase, 'warning');
  assert.equal(m.fire.burnedTrees.length, 0, 'nothing burns in the warning');
  m.step(0.02);
  assert.equal(m.fire.phase, 'burning');
  m.step(FIRE.burn);
  assert.equal(m.fire.phase, 'aftermath');
  m.step(FIRE.aftermath);
  assert.equal(m.fire.phase, 'idle');
  assert.match(m.fireStatus(id), /recovering/);
  m.step(FIRE.cooldown);
  assert.equal(m.fireStatus(id), 'Ready to kindle');
  console.log('PASS capstone gating, atomic cost, storm exclusion, warning/burn/aftermath/cooldown boundaries');
}
{
  // The front runs the chosen way: with fire toward +x, western stands burn first.
  const { m, id } = fixture();
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 1);
  const firstAt = new Map();
  for (const b of m.fire.burnedTrees) if (!firstAt.has(b.stand)) firstAt.set(b.stand, b.at);
  const bySx = [0, 1, 2].map(sx => Math.min(...m.region.stands.filter(s => s.sx === sx).map(s => firstAt.get(s.id) ?? Infinity)));
  assert(bySx[0] < bySx[1] && bySx[1] < bySx[2], `burn order follows the front ${JSON.stringify(bySx)}`);
  const sched = m.fire.schedule(0);
  assert(sched.every(s => s.at >= 0 && s.at <= FIRE.burn), 'preview schedule lies inside the burn');
  console.log(`PASS the front sweeps downwind: first burns at ${bySx.map(t => t.toFixed(1)).join(' < ')}s`);
}
{
  // Dry crowns burn; crowns on wet ground are spared.
  const { m, id, from } = fixture();
  const trees = from.sim.world.trees.filter(t => !t.dead);
  const [dry, wet] = trees;
  for (let gy = 0; gy < 12; gy++) cell(from.sim.world, wet.gx, gy).water = 0.9;
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 1);
  assert(dry.dead && dry.burned, 'a dry tree burns');
  assert(!wet.dead && !wet.burned, 'a tree on wet ground is spared');
  console.log(`PASS dry crowns burn, wet refuges are spared (${m.fire.livingTreesBurned} living trees burned region-wide)`);
}
{
  // Underground: depth, thickness and wetness decide.
  const { m, id, from, net } = fixture();
  // Five strands grown directly from the root, one per case.
  const root0 = net.nodes[net.rootId];
  for (let i = 0; i < 5; i++) {
    const id2 = net.nodes.length;
    net.nodes.push({ ...root0, id: id2, parent: root0.id, children: [], gx: root0.gx + 4 + i * 3, wx: root0.gx + 4 + i * 3, bondedTree: -1, bondedRootTip: -1 });
    root0.children.push(id2);
  }
  markConnectivity(net);
  const pool = net.nodes.slice(-5);
  assert(pool.length >= 5, 'the founder has enough strands to test');
  const [shallow, singe, deep, cord, soaked] = pool;
  const place = (n, gy, wet = 0) => { n.gy = gy; n.isTip = true; n.reinforced = false; n.thickness = 0.2; n.health = 1; n.carbon = 10; cell(from.sim.world, n.gx, gy).water = wet; };
  place(shallow, 2); place(singe, 10); place(deep, 40); place(cord, 2); place(soaked, 2, 0.9);
  cord.reinforced = true;
  const root = net.nodes[net.rootId];
  net.fruit.active = true; net.fruit.nodeId = deep.id; net.fruit.store = 50; net.fruit.progress = 0.5;
  const organic = cell(from.sim.world, shallow.gx, 1).organic;
  const nitrogen = cell(from.sim.world, shallow.gx, 1).nitrogen;
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 1);
  assert.equal(shallow.alive, false, 'a shallow thin strand burns');
  assert(singe.alive && singe.health < 1 && singe.carbon < 10, 'a strand at 10 cm is singed');
  assert(deep.alive && deep.health === 1 && deep.carbon === 10, 'a deep strand is untouched');
  assert(cord.alive, 'a reinforced cord survives the surface fire');
  assert(soaked.alive, 'a strand in soaked soil survives');
  assert(root.alive, 'the colony root is never burned out');
  assert.equal(net.fruit.active, false, 'the fruiting body burns');
  assert.equal(net.fruit.store, 0, 'with its committed reserve');
  const ash = cell(from.sim.world, shallow.gx, 1);
  assert(ash.organic < organic && ash.nitrogen > nitrogen, 'topsoil turns to nitrogen-rich ash');
  assert(m.fire.losses.player.strands >= 1 && m.fire.losses.player.bodies === 1);
  console.log(`PASS underground: shallow strands burn, 10 cm singes, deep/cord/wet/root survive, body burns, ash (${JSON.stringify(m.fire.losses.player)})`);
}
{
  // The rival burns by the same rules; the aftermath is a fruiting flush on burned ground.
  const { m, id, from } = fixture();
  from.rivalPresent = true;
  const rival = from.sim.rival;
  for (const n of rival.nodes) { n.gy = 2; n.isTip = true; n.thickness = 0.1; n.reinforced = false; }
  const alive = rival.nodes.filter(n => n.alive).length;
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 0.5);
  assert.equal(m.fire.phase, 'aftermath');
  assert(rival.nodes.filter(n => n.alive).length < alive, 'the rival burns too');
  m.step(0.5);
  assert.deepEqual(from.sim.regionalWeather, { rainfall: from.sim.season.rain, fruiting: true }, 'burned ground fruits in any weather');
  const unburned = m.stands.find(s => !m.fire.burnedStands.has(s.site.id));
  if (unburned) assert.equal(unburned.sim.regionalWeather, null);
  m.step(FIRE.aftermath);
  assert.equal(from.sim.regionalWeather, null, 'the flush ends with the aftermath');
  console.log(`PASS rival burns alike (${JSON.stringify(m.fire.losses.rival)}); burned stands fruit in any weather through the aftermath only`);
}
{
  const run = () => {
    const { m, id } = fixture('ember-replay');
    m.kindleFire(id, Math.PI / 3);
    m.step(FIRE.warning + FIRE.burn + 1);
    return JSON.stringify({ state: m.fire.state, trees: m.fire.burnedTrees, losses: m.fire.losses });
  };
  assert.equal(run(), run());
  console.log('PASS deterministic replay');
}

// ---------------------------------------------------------------------------
// Wildfire v2, W1: water is fire armour.
// ---------------------------------------------------------------------------
const { stepHydration, hydrationTarget, HYDRATION_SECONDS } = await load('world');
const { FLAMMABILITY } = await load('wildfire');
{
  // Hydration follows what the partners deliver, smoothed over ~40 s.
  const { m, from } = fixture('ember-hydration');
  const world = from.sim.world;
  const [fed, unfed] = world.trees.filter(t => !t.dead);
  for (const c of world.cells) c.water = 0.3;
  fed.rootTips[0].bondedTo = 0;
  fed.waterReceived = 1;
  fed.hydration = 0;
  unfed.hydration = 0;
  for (let i = 0; i < HYDRATION_SECONDS * 10; i++) { stepHydration(world, fed, 0.1); stepHydration(world, unfed, 0.1); }
  const target = hydrationTarget(world, fed);
  assert(Math.abs(fed.hydration - target * (1 - Math.exp(-1))) < 0.02, `one time constant reaches 63% (${fed.hydration.toFixed(3)} of ${target.toFixed(3)})`);
  assert(fed.hydration > unfed.hydration * 2, 'a fed tree is far better watered than an unfed one');
  void m;
  console.log(`PASS hydration follows supply: fed ${fed.hydration.toFixed(2)}, unfed ${unfed.hydration.toFixed(2)} after ${HYDRATION_SECONDS}s`);
}
{
  // The same fire, the same seed: watered forests keep their trees.
  const burnWith = (hydration) => {
    const { m, id } = fixture('ember-armour');
    const living = [];
    for (const s of m.stands) for (const t of s.sim.world.trees) if (!t.dead) { t.hydration = hydration; living.push(t); }
    m.kindleFire(id, 0);
    m.step(FIRE.warning + FIRE.burn + 1);
    return { torched: m.fire.livingTreesBurned, scorched: m.fire.treesScorched, spared: m.fire.treesSpared, living: living.length, trees: living, m };
  };
  const dry = burnWith(0);
  const wet = burnWith(1);
  assert(dry.torched >= dry.living * 0.4, `unfed crowns mostly burn (${dry.torched}/${dry.living})`);
  assert(wet.torched <= Math.max(1, dry.torched * 0.1), `fed crowns resist (${wet.torched} against ${dry.torched})`);
  // Scorched trees live and keep their bonds.
  const fedScorched = wet.trees.filter(t => t.scorched);
  assert(fedScorched.length > 0 && fedScorched.every(t => !t.dead && t.health < 1), 'a ground fire scars but spares');
  // Torched trees leave remains; a fierce, dry fire fells some of them as logs.
  const dead = dry.trees.filter(t => t.burned);
  assert(dead.every(t => t.burned.remains && t.burned.biomass > 0), 'every burned tree records its remains');
  const logs = dead.filter(t => t.burned.remains === 'log');
  assert(logs.length > 0 && logs.every(t => t.fallen && Math.abs(t.fallen.direction - dry.m.fire.state.direction) < 1e-9), 'felled trees lie downwind');
  console.log(`PASS water is armour: unfed ${dry.torched}/${dry.living} torched (${logs.length} felled as logs), fed ${wet.torched} torched and ${wet.scorched} scorched`);
}
{
  // Bonds survive a scorch and end with a torch.
  const { m, id, from } = fixture('ember-bonds');
  const trees = from.sim.world.trees.filter(t => !t.dead);
  for (const t of trees) { t.rootTips[0].bondedTo = 0; t.rootTips[0].bondedColonyId = null; t.hydration = 0.55; }
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 1);
  for (const t of trees) {
    if (t.burned) assert.equal(t.rootTips[0].bondedTo, null, 'a torched tree gives up its bond');
    else assert.equal(t.rootTips[0].bondedTo, 0, 'a scorched or spared tree keeps its bond');
  }
  console.log(`PASS bonds: ${trees.filter(t => t.burned).length} torched trees let go, ${trees.filter(t => !t.burned).length} survivors keep theirs`);
}
{
  // Species and firebreaks, from the odds themselves.
  const { m, from } = fixture('ember-odds');
  const world = from.sim.world;
  // A tree away from the stream (a bank is a refuge, where nothing burns).
  const tree = world.trees.find(t => !t.dead && !m.fire.treeOdds(world, t).refuge);
  // Moderately watered, so no species reaches the 97% cap on this dry ground.
  tree.hydration = 0.6;
  const odds = (species) => { const was = tree.species; tree.species = species; const o = m.fire.treeOdds(world, tree); tree.species = was; return o.burn; };
  assert(odds('oak') < odds('birch') && odds('birch') < odds('hemlock'), 'hemlock torches, birch catches, oak resists');
  assert(FLAMMABILITY.hemlock > FLAMMABILITY.birch && FLAMMABILITY.birch > FLAMMABILITY.oak);
  const open = m.fire.treeOdds(world, tree, 100).burn;
  m.fire.recentTrees = [{ p: 90, hydration: 1 }, { p: 93, hydration: 1 }, { p: 97, hydration: 1 }];
  const behindBelt = m.fire.treeOdds(world, tree, 100).burn;
  assert(behindBelt < open * 0.6, `a green belt is a firebreak (${behindBelt.toFixed(2)} behind it, ${open.toFixed(2)} in the open)`);
  console.log(`PASS species and firebreak: oak ${odds('oak').toFixed(2)} < birch ${odds('birch').toFixed(2)} < hemlock ${odds('hemlock').toFixed(2)}; a watered belt cuts ${open.toFixed(2)} to ${behindBelt.toFixed(2)}`);
}
