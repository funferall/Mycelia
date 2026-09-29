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
const { elevationAtDepthCm, standFrameOf } = await load('spatial');

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
  // Wind supplies the front's travel speed. Sampling on absolute beats makes
  // a long caller step and many gameplay ticks agree.
  const run = (windDirection, step) => {
    const { m, id } = fixture('ember-wind-speed');
    m.region.windAt = () => ({ direction: windDirection, strength: 1 });
    m.kindleFire(id, 0);
    m.step(FIRE.warning);
    for (let t = 0; t < 20 - 1e-8; t += step) m.step(Math.min(step, 20 - t));
    return { front: m.fire.frontAt(m.time), burned: m.fire.burnedTrees.map(t => `${t.stand}:${t.tree}`) };
  };
  const tail = run(0, 20);
  const tailFine = run(0, 0.25);
  const head = run(Math.PI, 20);
  assert(tail.front > head.front + 20, `tailwind advances farther (${tail.front.toFixed(1)} > ${head.front.toFixed(1)})`);
  assert(Math.abs(tail.front - tailFine.front) < 1e-8, 'wind integration is stable across step sizes');
  assert.deepEqual(tail.burned, tailFine.burned, 'tree outcomes do not depend on caller step size');
  console.log(`PASS wind-driven fire growth: tailwind front ${tail.front.toFixed(1)}, headwind ${head.front.toFixed(1)}, identical coarse/fine outcomes`);
}

{
  // The player can summon a hurricane into a running fire. Its brief ember
  // sweep reaches every stand, then sustained rain quenches the flames.
  const run = () => {
    const { m, id, net } = fixture('ember-hurricane');
    net.evolution.learned.push('storm-crown');
    net.nodes[0].bondedTree = 0; net.nodes[1].bondedTree = 1;
    for (const stand of m.stands) {
      for (const c of stand.sim.world.cells) c.water = 0.9;
      for (const tree of stand.sim.world.trees) if (!tree.dead) tree.hydration = 1;
    }
    m.stepWindfalls = () => {}; m.flood.step = () => {};
    m.kindleFire(id, 0);
    m.step(FIRE.warning + 1);
    assert.equal(m.fire.phase, 'burning');
    assert.equal(m.stormStatus(id), 'Ready to summon');
    assert.equal(m.summonStorm(id, Math.PI / 2), 'Storm announced');
    m.step(60);
    assert.equal(m.storm.phase, 'active');
    m.step(1);
    const tree = m.stands.flatMap(s => s.sim.world.trees).find(t => !t.dead);
    assert.equal(m.fire.treeOdds(m.stands.find(s => s.sim.world.trees.includes(tree)).sim.world, tree, NaN, true).burn, 0.5);
    const quenchAt = m.fire.state.endsAt;
    assert.equal(quenchAt, m.storm.activeAt + FIRE.hurricaneQuench, 'heavy rain sets a short fire window');
    m.step(FIRE.hurricaneSweep - 1);
    assert.equal(m.fire.phase, 'burning', 'fire burns during the initial ember burst');
    m.step(quenchAt - m.time + 1);
    return { trees: m.fire.burnedTrees.map(t => `${t.stand}:${t.tree}`), scars: m.fire.scarredStands.size,
      wet: m.fire.livingTreesBurned, phase: m.fire.phase, storm: m.storm.phase };
  };
  const a = run();
  const b = run();
  assert.equal(a.scars, 9, 'windborne embers reach all nine stands');
  assert(a.wet > 15 && a.wet < 60, `watered trees face a real 50% lottery (${a.wet})`);
  assert.equal(a.phase, 'aftermath');
  assert.equal(a.storm, 'active', 'heavy rain quenches the fire while hurricane winds still blow');
  assert.deepEqual(a, b, 'hurricane fire replays deterministically');
  console.log(`PASS hurricane in a fire: ${a.wet} watered trees burned, all ${a.scars} stands reached, then rain quenched flames before the storm ended`);
}

{
  // When the storm arrives early, a single long match step must still split
  // at the rain quench instead of burning through to the old 70-second end.
  const run = (step) => {
    const { m, id, net } = fixture('ember-early-rain');
    net.evolution.learned.push('storm-crown');
    net.nodes[0].bondedTree = 0; net.nodes[1].bondedTree = 1;
    m.stepWindfalls = () => {}; m.flood.step = () => {};
    m.kindleFire(id, 0);
    assert.equal(m.summonStorm(id, Math.PI / 2), 'Storm announced');
    const until = 60 + FIRE.hurricaneQuench + 1;
    for (let t = 0; t < until - 1e-8; t += step) m.step(Math.min(step, until - t));
    return { phase: m.fire.phase, burnEnd: m.fire.state.endsAt,
      trees: m.fire.burnedTrees.map(t => `${t.stand}:${t.tree}`).sort(),
      latestTorch: Math.max(...m.fire.burnedTrees.map(t => t.at)), scars: m.fire.scarredStands.size };
  };
  const coarse = run(79), fine = run(0.25);
  assert.equal(coarse.burnEnd, 60 + FIRE.hurricaneQuench);
  assert.equal(coarse.phase, 'aftermath');
  assert.equal(coarse.scars, 9);
  assert.deepEqual({ ...coarse, latestTorch: 0 }, { ...fine, latestTorch: 0 },
    'large and small caller steps quench at the same time with the same tree outcomes');
  assert(coarse.latestTorch <= coarse.burnEnd && fine.latestTorch <= fine.burnEnd, 'no torching after the rain quench');
  console.log('PASS early hurricane: coarse and fine steps both quench at 18 seconds with the same burn footprint');
}

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
  assert.doesNotMatch(m.stormStatus(id), /wildfire/, 'a hurricane may be summoned during a fire');
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
  console.log('PASS capstone gating, atomic cost, storm overlap, warning/burn/aftermath/cooldown boundaries');
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
  assert(m.fire.livingTreesBurned > 0, 'dry crowns in the region burn');
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
    net.nodes.push({ ...root0, spatial: root0.spatial ? { ...root0.spatial } : undefined,
      id: id2, parent: root0.id, children: [], gx: root0.gx + 4 + i * 3, wx: root0.gx + 4 + i * 3, bondedTree: -1, bondedRootTip: -1 });
    root0.children.push(id2);
  }
  markConnectivity(net);
  const pool = net.nodes.slice(-5);
  assert(pool.length >= 5, 'the founder has enough strands to test');
  const [shallow, singe, deep, cord, soaked] = pool;
  const frame = standFrameOf(m.region, id);
  const place = (n, gy, wet = 0) => {
    n.gy = gy; n.isTip = true; n.reinforced = false; n.thickness = 0.2; n.health = 1; n.carbon = 10;
    if (n.spatial) {
      n.spatial.x = frame.originX + n.gx;
      n.spatial.y = frame.originY + GRID.cols / 2;
      n.spatial.z = elevationAtDepthCm(m.region, n.spatial.x, n.spatial.y, gy * GRID.cmPerRow);
    }
    cell(from.sim.world, n.gx, gy).water = wet;
  };
  place(shallow, 2); place(singe, 10); place(deep, 40); place(cord, 2); place(soaked, 2, 0.9);
  // A section can project a genuinely deep XYZ node into a shallow-looking row.
  // Fire must judge its absolute depth, not that presentation row.
  if (deep.spatial) deep.gy = 2;
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
  // Heat continues through the visible band, so a newly grown surface tip
  // cannot safely follow the leading edge while flames still occupy the soil.
  const { m, id, net, from } = fixture('ember-hot-band');
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn * 0.5);
  const root = net.nodes[net.rootId];
  const x = m.fire.frontAt(m.time) - FIRE.band * 0.5;
  const y = root.spatial.y;
  const gx = root.gx + 5;
  const tip = { ...root, spatial: { ...root.spatial, x, y, z: elevationAtDepthCm(m.region, x, y, 2) },
    id: net.nodes.length, parent: root.id, children: [], gx, gy: 2, wx: gx, wy: 2.5,
    alive: true, isTip: true, reinforced: false, thickness: 0.1, health: 1, carbon: 10, water: 0, nitrogen: 0 };
  net.nodes.push(tip);
  root.children.push(tip.id);
  cell(from.sim.world, gx, 2).water = 0;
  markConnectivity(net);
  m.step(0.5);
  assert.equal(tip.alive, false, 'a new shallow tip in the hot band burns after the leading edge passed');
  console.log('PASS lingering front heat burns a newly grown shallow tip inside the band');
}
{
  // The rival burns by the same rules; the aftermath is a fruiting flush on burned ground.
  const { m, id, from } = fixture();
  from.rivalPresent = true;
  const rival = from.sim.rival;
  for (const n of rival.nodes) {
    n.gy = 2; n.isTip = true; n.thickness = 0.1; n.reinforced = false;
    if (n.spatial) n.spatial.z = elevationAtDepthCm(m.region, n.spatial.x, n.spatial.y, 2 * GRID.cmPerRow);
  }
  const alive = rival.nodes.filter(n => n.alive).length;
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 0.5);
  assert.equal(m.fire.phase, 'aftermath');
  assert(rival.nodes.filter(n => n.alive).length < alive, 'the rival burns too');
  m.step(0.5);
  assert.deepEqual(from.sim.regionalWeather, { rainfall: from.sim.season.rain, fruiting: true, fruitSpeed: FIRE.ashFruitSpeed }, 'burned ground fruits in any weather, and faster');
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
{
  const run = (extraTip) => {
    const { m, id, net } = fixture('ember-tree-rolls');
    for (const s of m.stands) for (const t of s.sim.world.trees) if (!t.dead) t.hydration = 0.3;
    if (extraTip) {
      const root = net.nodes[net.rootId];
      const gx = root.gx + 3;
      net.nodes.push({ ...root, spatial: root.spatial ? { ...root.spatial, x: root.spatial.x + 3,
        z: elevationAtDepthCm(m.region, root.spatial.x + 3, root.spatial.y, 2) } : undefined,
      id: net.nodes.length, parent: root.id, children: [], gx, gy: 2, wx: gx, wy: 2.5,
      isTip: true, reinforced: false, thickness: 0.1 });
      root.children.push(net.nodes.length - 1);
      markConnectivity(net);
    }
    m.kindleFire(id, 0);
    m.step(FIRE.warning + FIRE.burn + 1);
    return m.fire.burnedTrees.map(t => `${t.stand}:${t.tree}`);
  };
  assert.deepEqual(run(true), run(false), 'one extra shallow strand cannot reroll a tree elsewhere');
  console.log('PASS tree ignition rolls do not change when another strand enters the fire');
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
  for (const [i, t] of trees.entries()) {
    t.rootTips[0].bondedTo = 0; t.rootTips[0].bondedColonyId = null;
    t.hydration = i === 0 ? 1 : 0;
  }
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 1);
  for (const t of trees) {
    if (t.burned) assert.equal(t.rootTips[0].bondedTo, null, 'a torched tree gives up its bond');
    else assert.equal(t.rootTips[0].bondedTo, 0, 'a scorched or spared tree keeps its bond');
  }
  assert(trees.some(t => t.burned) && trees.some(t => !t.burned), 'the bond fixture includes torched and surviving trees');
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

// ---------------------------------------------------------------------------
// Wildfire v2, W2: charred remains are a nutrient race.
// ---------------------------------------------------------------------------
const { REMAINS, charRemains, stepRemains, ASH_FRUIT_SPEED } = await load('world');
const { createNetwork, startFruiting, stepNetwork } = await load('network');
const { createWorld } = await load('world');
const { mulberry32 } = await load('rng');
{
  // Burned trees hold a store, and the fire gives every burned tree one.
  const { m, id, from } = fixture('ember-remains');
  for (const s of m.stands) for (const t of s.sim.world.trees) if (!t.dead) t.hydration = 0;
  m.kindleFire(id, 0);
  m.step(FIRE.warning + FIRE.burn + 1);
  const burned = m.stands.flatMap(s => s.sim.world.trees).filter(t => t.burned);
  assert(burned.length > 0 && burned.every(t => t.burned.nitrogen0 > 0 && t.burned.organic0 > 0 && t.burned.nitrogen === t.burned.nitrogen0),
    'every burned tree holds nitrogen and organic matter in proportion to its biomass');
  assert(burned.every(t => Math.abs(t.burned.nitrogen0 - t.burned.biomass * REMAINS.nitrogenPerBiomass) < 1e-9));
  void from;
  console.log(`PASS remains: ${burned.length} burned trees hold ${burned.reduce((v, t) => v + t.burned.nitrogen0, 0).toFixed(1)} nitrogen for the soil`);
}
{
  // Decay gives the store to the soil around the trunk, conserving it, and leaves a stump.
  const { from } = fixture('ember-decay');
  const world = from.sim.world;
  for (const c of world.cells) { c.nitrogen = 0.2; c.organic = 0.1; }
  const tree = world.trees.find(t => !t.dead && t.gx > 5 && t.gx < 130);
  tree.dead = true; tree.burned = { at: 0, remains: 'snag', biomass: 30 };
  charRemains(tree);
  const around = () => {
    let n = 0, o = 0;
    for (let dx = -REMAINS.reachCols; dx <= REMAINS.reachCols; dx++) for (let gy = 0; gy < REMAINS.rows; gy++) {
      const c = world.cells[gy * GRID.cols + tree.gx + dx];
      n += c.nitrogen; o += c.organic;
    }
    return { n, o };
  };
  const start = around();
  const total = (a) => ({ n: a.n + tree.burned.nitrogen, o: a.o + tree.burned.organic });
  const before = total(start);
  for (let i = 0; i < 100; i++) stepRemains(world, 1, () => 1);
  const mid = total(around());
  assert(Math.abs(mid.n - before.n) < 1e-9 && Math.abs(mid.o - before.o) < 1e-9, 'nothing is created or lost');
  assert(tree.burned.nitrogen < tree.burned.nitrogen0 && tree.burned.remains === 'snag', 'a third of the way through, still a snag');
  for (let i = 0; i < REMAINS.snagSeconds; i++) stepRemains(world, 1, () => 1);
  assert.equal(tree.burned.remains, 'stump', 'spent remains leave a charred stump');
  const after = around();
  assert(after.n - start.n > tree.burned.nitrogen0 * 0.99, 'the soil around it received the store');
  console.log(`PASS decay: ${tree.burned.nitrogen0.toFixed(2)} nitrogen moved into the soil around the trunk, conserved, then a stump`);
}
{
  // A decomposer's strands double the pace; the trait is the placeholder rival's.
  const { m, from } = fixture('ember-decomposer');
  const world = from.sim.world;
  for (const c of world.cells) { c.nitrogen = 0; c.organic = 0; }
  const [a, b] = world.trees.filter(t => !t.dead && t.gx > 5 && t.gx < 130);
  for (const t of [a, b]) { t.dead = true; t.burned = { at: 0, remains: 'log', biomass: 30 }; charRemains(t); }
  for (let i = 0; i < 60; i++) stepRemains(world, 1, (t) => (t === a ? REMAINS.decomposerSpeed : 1));
  const spentA = a.burned.nitrogen0 - a.burned.nitrogen;
  const spentB = b.burned.nitrogen0 - b.burned.nitrogen;
  assert(Math.abs(spentA / spentB - 2) < 0.05, `a decomposer doubles decay (${(spentA / spentB).toFixed(2)}x)`);
  assert.equal(from.sim.rival.traits?.decomposer, true, 'the placeholder opponent is a decomposer by trait');
  assert.notEqual(from.sim.player.traits?.decomposer, true, 'the player colony is not');
  void m;
  console.log(`PASS decomposers: ${spentA.toFixed(3)} against ${spentB.toFixed(3)} nitrogen released in a minute; a trait, not a side`);
}
{
  // Burned ground in its flush matures fruiting bodies faster, at the same cost.
  const grow = (speed) => {
    const net = createNetwork('player', 't', 30, 8, mulberry32(12), 220);
    net.surplus = ECON.fruitThreshold;
    const root = net.nodes[0]; root.gy = 2; root.wy = 2.5; root.water = 60; root.nitrogen = 30;
    startFruiting(net, () => true, root.gx, root.gy);
    const world = createWorld(44); world.rainfall = 1;
    let t = 0;
    while (net.fruit.active && t < 400) {
      root.water = 60; root.nitrogen = 30;
      stepNetwork(net, { world, dt: 0.25, time: t, warmth: 1, light: 1, fruitingWeather: true, fruitSpeed: speed, rival: null, log() {} });
      t += 0.25;
    }
    return { t, fruited: net.fruited };
  };
  const { ECON } = await load('content');
  const plain = grow(1);
  const ash = grow(ASH_FRUIT_SPEED);
  assert(plain.fruited === 1 && ash.fruited === 1, 'both bodies complete');
  assert(ash.t < plain.t * 0.85, `ash fruiting is faster (${ash.t}s against ${plain.t}s)`);
  console.log(`PASS ash flush: a body on burned ground matures in ${ash.t}s against ${plain.t}s, for the same reserve`);
}
