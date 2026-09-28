/**
 * Headless regression for the simulation.
 *
 * The game is only real if the whole journey is: reach a root, bond, survive a
 * drought, gather, and fruit twice without anyone handing the player a resource.
 * Everything here drives the same public order methods the interface calls, and
 * every failure prints the refused order's own message plus a state snapshot, so
 * a red run says what went wrong rather than only where.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Compile only the headless simulation into a unique temporary directory.
const output = mkdtempSync(join(tmpdir(), 'mycelia-sim-'));
for (const name of ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'network', 'sim', 'crossing', 'shared-soil', 'wildfire', 'drought', 'flood', 'match']) {
  const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
  const compiled = stripTypeScriptTypes(source);
  writeFileSync(join(output, `${name}.mjs`), compiled.replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
writeFileSync(
  join(output, 'journey.mjs'),
  stripTypeScriptTypes(readFileSync(new URL('../src/ui/journey.ts', import.meta.url), 'utf8'))
    .replace(/from '\.\.\/sim\/(.+?)'/g, "from './$1.mjs'")
);
const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
const { Simulation } = await load('sim');
const { RegionalMatch } = await load('match');
const { createNetwork, makeCord, spawnTip, startFruiting, stepNetwork } = await load('network');
const { createWorld } = await load('world');
const { ECON, GRID } = await load('content');
const { mulberry32 } = await load('rng');
const { deriveJourney } = await load('journey');

const step = (sim, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(1 / 60);
};

/** Everything a failure needs in order to be diagnosable at a glance. */
const describe = (sim) => JSON.stringify({
  time: Math.round(sim.time),
  season: sim.season.id,
  warmth: sim.season.warmth,
  rain: Number(sim.world.rainfall.toFixed(2)),
  surplus: Number(sim.player.surplus.toFixed(1)),
  carbon: Number(sim.player.carbon.toFixed(0)),
  living: sim.player.nodes.filter((n) => n.alive).length,
  tips: sim.player.tipCount,
  bonds: sim.world.trees.filter((t) => t.rootTips.some((tip) => tip.bondedTo !== null)).length,
  fruitActive: sim.player.fruit.active,
  progress: Number(sim.player.fruit.progress.toFixed(2)),
  store: Number(sim.player.fruit.store.toFixed(1)),
  fruited: sim.player.fruited,
  outcome: sim.outcome,
  recent: sim.events.slice(-5).map((event) => `${Math.round(event.at)}s ${event.text}`),
});

/** Cut a strand loose from its parent, the way a dying strand would. */
function sever(net, node) {
  const parent = net.nodes[node.parent];
  if (parent) parent.children = parent.children.filter((id) => id !== node.id);
  node.parent = -1;
}

/**
 * The surface strand a player would choose: the one nearest the root by way of
 * the network, because that is the strand most reliably supplied.
 */
function bestSurfaceStrand(sim) {
  const hops = new Map([[sim.player.rootId, 0]]);
  const queue = [sim.player.rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    const node = sim.player.nodes[id];
    if (!node) continue;
    for (const childId of node.children) {
      if (hops.has(childId)) continue;
      hops.set(childId, hops.get(id) + 1);
      queue.push(childId);
    }
  }
  let best = null;
  for (const node of sim.player.nodes) {
    if (!node.alive || !node.connected || node.gy > 11) continue;
    const distance = hops.get(node.id) ?? Infinity;
    if (!best || distance < best.distance) best = { node, distance };
  }
  return best?.node ?? null;
}

function nearestRoot(sim) {
  const origin = sim.player.nodes[sim.player.rootId];
  const roots = sim.world.trees.flatMap((tree) =>
    tree.rootTips.map((tip) => ({ tree, tip, d: Math.hypot(tip.gx - origin.gx, tip.gy - origin.gy) }))
  );
  roots.sort((a, b) => a.d - b.d);
  return roots[0];
}

const results = [];

// A thin strand can reach the first oak after spending its own carbon on growth.
// Its connected founder still holds the bond charge, so the label must offer a
// working Bond action instead of leaving the opening stuck on "gathering".
{
  const sim = new Simulation('oak');
  const match = new RegionalMatch('oak', sim);
  const target = nearestRoot(sim);
  assert.equal(target.tree.species, 'oak');
  assert.equal(sim.orderGrowth(target.tip.gx, target.tip.gy), true);
  for (let i = 0; i < 10 * 60; i++) match.step(1 / 60);
  const nearest = sim.nearestStrand(target.tip.gx, target.tip.gy);
  assert.ok(nearest && nearest.distance < 3.5 && nearest.node.carbon < ECON.bondCharge,
    'the regression seed reaches an oak with a locally poor strand');
  const label = deriveJourney(sim).roots.find((root) => root.treeId === target.tree.id);
  assert.equal(label?.state, 'bondable', 'the label predicts a funded bond');
  const carbonBefore = sim.player.nodes.reduce((total, node) => total + node.carbon, 0);
  assert.equal(sim.orderBondTip(target.tree.id, target.tip.id).ok, true);
  const carbonAfter = sim.player.nodes.reduce((total, node) => total + node.carbon, 0);
  assert.ok(Math.abs(carbonBefore - carbonAfter - ECON.bondCharge) < 1e-8,
    'the connected network pays exactly one bond charge');
  assert.equal(target.tip.bondedTo, nearest.node.id, 'the closest free strand owns the junction');

  const unfunded = new Simulation('oak');
  const unfundedMatch = new RegionalMatch('oak', unfunded);
  const sameRoot = nearestRoot(unfunded);
  unfunded.orderGrowth(sameRoot.tip.gx, sameRoot.tip.gy);
  for (let i = 0; i < 10 * 60; i++) unfundedMatch.step(1 / 60);
  for (const node of unfunded.player.nodes) node.carbon = 0;
  assert.equal(deriveJourney(unfunded).roots.find((root) => root.treeId === sameRoot.tree.id)?.state, 'poor');
  assert.equal(unfunded.orderBondTip(sameRoot.tree.id, sameRoot.tip.id).ok, false);
  results.push('opening oak bond draws its exact charge from connected ancestors; an unfunded label stays honest');
}
if (process.argv.includes('--bond-only')) {
  for (const line of results) console.log('  ok - ' + line);
  console.log(`PASS: ${results.length} focused check.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Input bounds and the founding reserve
// ---------------------------------------------------------------------------
{
  const sim = new Simulation('raven-wood');
  assert.equal(sim.orderGrowth(-4, 4), false);
  assert.equal(sim.orderGrowth(NaN, 4), false);
  assert.equal(sim.orderGrowth(999, 4), false);
  step(sim, 0.1);
  assert.equal(sim.player.surplus, 0, 'starting carbon must not become fruiting energy');
  assert.ok(sim.player.carbon > 200, 'the founding reserve must survive the opening');
  results.push('input bounds and the founding reserve');
}

// ---------------------------------------------------------------------------
// 2. Conservation: nothing is created at birth, and decay returns to soil
// ---------------------------------------------------------------------------
{
  const rng = mulberry32(7);
  const net = createNetwork('player', 'test', 40, 40, rng, 100);
  const parent = net.nodes[0];
  parent.carbon = 5;
  parent.water = 4;
  parent.nitrogen = 3;
  const child = spawnTip(net, parent, Math.PI / 2, rng, true);
  assert.ok(child, 'a fork should be produced when the parent can afford it');
  assert.equal(parent.carbon + child.carbon, 5, 'a new tip takes its carbon out of the parent');
  assert.equal(parent.water + child.water, 4, 'water is transferred, never minted');
  assert.equal(parent.nitrogen + child.nitrogen, 3, 'mineral is transferred, never minted');
  assert.ok(parent.carbon >= ECON.parentReserveFloor, 'a parent keeps a floor it cannot be pushed below');

  // A parent too poor to pay produces a lean child rather than a free one.
  parent.carbon = ECON.parentReserveFloor;
  const lean = spawnTip(net, parent, 0, rng, true);
  assert.equal(lean.carbon, 0, 'a broke parent produces a broke child');
  assert.ok(parent.carbon >= 0, 'a parent is never driven into debt');

  // Decay: a cut strand starves, dies, and becomes soil the forest can use.
  const world = createWorld(1234);
  const dying = createNetwork('player', 'test', 40, 40, mulberry32(9), 50);
  // Rested, so the cut strand stays in the cell it was cut in.
  dying.resting = true;
  const branch = dying.nodes.find((node) => node.isTip);
  const cell = world.cells[branch.gy * GRID.cols + branch.gx];
  const organicBefore = cell.organic;
  sever(dying, branch);
  const ctx = { world, light: 1, warmth: 1, rival: null, time: 0, log: () => {}, dt: 1 / 60 };
  for (let i = 0; i < 60 * 60 && branch.alive; i++) stepNetwork(dying, ctx);
  assert.equal(branch.alive, false, 'a severed strand starves and dies');
  assert.ok(cell.organic > organicBefore, 'a dead strand returns its body to the soil');
  results.push('resource conservation at birth, and decay returning matter to soil');
}

// ---------------------------------------------------------------------------
// 3. Supply, severance and a dead founder
// ---------------------------------------------------------------------------
{
  const sim = new Simulation('raven-wood');
  const target = nearestRoot(sim);
  sim.orderGrowth(target.tip.gx, target.tip.gy);
  let bonded = false;
  for (let i = 0; i < 90 && !bonded; i++) {
    step(sim, 1);
    bonded = sim.orderBondTip(target.tree.id, target.tip.id).ok;
  }
  assert.ok(bonded, `the first tree can be reached and bonded\n  ${describe(sim)}`);

  const junction = sim.player.nodes[target.tip.bondedTo];
  sever(sim.player, junction);
  step(sim, 1);
  assert.equal(junction.connected, false, 'a cut junction must read as severed');

  const surplusBefore = sim.player.surplus;
  const patienceBefore = target.tree.patience;
  step(sim, 10);
  assert.equal(sim.player.surplus, surplusBefore, 'a cut junction must not keep earning trade income');
  assert.ok(target.tree.patience < patienceBefore, 'a tree that is not supplied loses patience');
  step(sim, 40);
  assert.equal(
    target.tree.rootTips.some((tip) => tip.bondedTo !== null),
    false,
    'an unsupplied tree severs the bond'
  );
  results.push('cut supply: no trade income, patience falls, the bond is severed');
}

// ---------------------------------------------------------------------------
// 4. A dead founding spore leaves the colony severed
// ---------------------------------------------------------------------------
{
  const sim = new Simulation('raven-wood');
  step(sim, 20);
  assert.ok(sim.player.nodes[0].alive, 'the founder starts alive');
  sim.player.nodes[0].alive = false;
  step(sim, 1);
  assert.equal(
    sim.player.nodes.some((node) => node.alive && node.connected),
    false,
    'a dead founding spore must not keep a severed colony connected'
  );
  results.push('a dead founder disconnects the colony');
}

// ---------------------------------------------------------------------------
// 5. Fruiting depends on weather, on supply, and on a paid-up reserve
// ---------------------------------------------------------------------------
{
  const sim = new Simulation('raven-wood');
  sim.orderGrowth(sim.player.nodes[0].gx, 8);
  let site = null;
  for (let i = 0; i < 150 && !site; i++) {
    step(sim, 1);
    site = sim.player.nodes.find((n) => n.alive && n.connected && n.gy <= 11) ?? null;
  }
  assert.ok(site, `a network can reach the surface\n  ${describe(sim)}`);

  // Arm the reserve directly: this section is a unit test of the fruiting rule.
  // The end-to-end journey below never assigns anything.
  sim.seasonIndex = 0;
  sim.player.surplus = ECON.fruitThreshold;
  assert.ok(
    startFruiting(sim.player, sim.world, site.gx, site.gy),
    `a body may rise at a supplied surface strand\n  ${describe(sim)}`
  );
  assert.equal(sim.player.surplus, 0, 'the reserve is committed when the body starts');
  assert.equal(sim.player.fruit.store, ECON.fruitThreshold, 'the body carries what was committed');
  const progress = sim.player.fruit.progress;
  step(sim, 5);
  assert.ok(sim.player.fruit.progress > progress, 'a supplied body grows in kind weather');
  assert.ok(sim.player.fruit.store < ECON.fruitThreshold, 'the body spends its store as it grows');

  // Dry weather pauses it without wasting the store.
  const progressAtDrought = sim.player.fruit.progress;
  const storeAtDrought = sim.player.fruit.store;
  sim.seasonIndex = 1;
  step(sim, 5);
  assert.equal(sim.player.fruit.progress, progressAtDrought, 'a drought pauses the eruption');
  assert.equal(sim.player.fruit.store, storeAtDrought, 'a paused eruption spends nothing');

  // Cut the whole patch beneath it and the body recedes. (Cutting one strand is
  // not enough: another strand in the same ground can feed the body, which is
  // exactly what should happen when a strand is simply replaced.)
  sim.seasonIndex = 0;
  const patch = sim.player.nodes.filter(
    (node) =>
      node.alive &&
      node.connected &&
      Math.abs(node.gx - sim.player.fruit.gx) <= 2 &&
      Math.abs(node.gy - sim.player.fruit.gy) <= 2
  );
  for (const node of patch) sever(sim.player, node);
  step(sim, 1);
  assert.ok(patch.length > 0, 'the fruiting patch had strands to cut');
  assert.ok(
    patch.every((node) => !node.connected),
    'the fruiting patch reads as cut off'
  );
  const progressAtCut = sim.player.fruit.progress;
  step(sim, 10);
  assert.ok(
    sim.player.fruit.progress < progressAtCut || !sim.player.fruit.active,
    'a fruiting body without supply recedes rather than rising'
  );
  results.push('fruiting: weather pauses, supply feeds, a cut loses the bloom');
}

// ---------------------------------------------------------------------------
// 6. The full journey, over several seeds, through the public orders only
// ---------------------------------------------------------------------------

/**
 * Play a match the way the interface would: send the frontier to a labelled
 * root, bond when the label says it can, rest to bank energy, grow back to the
 * surface, and fruit twice. Nothing here writes to a resource, a tree, or the
 * outcome, so a pass means the loop is winnable as presented.
 */
function playJourney(seedText, budgetSeconds = 1800) {
  const sim = new Simulation(seedText);
  const match = process.env.REGIONAL_JOURNEY ? new RegionalMatch(seedText, sim) : null;
  // `JOURNEY_TRACE=1` prints the state every five seconds of a journey, which is
  // how a balance failure gets diagnosed without editing this file.
  const trace = Boolean(process.env.JOURNEY_TRACE);
  let traceClock = 0;
  const advance = (seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      (match ?? sim).step(1 / 60);
      if (!trace) continue;
      traceClock += 1 / 60;
      if (traceClock >= 5) {
        traceClock = 0;
        console.log(`    trace ${describe(sim)}`);
      }
    }
  };
  const target = nearestRoot(sim);
  assert.ok(sim.orderGrowth(target.tip.gx, target.tip.gy), `${seedText}: first reach refused\n  ${describe(sim)}`);
  let bonded = false;
  for (let i = 0; i < 90 && !bonded; i++) {
    advance(1);
    bonded = sim.orderBondTip(target.tree.id, target.tip.id).ok;
  }
  assert.ok(bonded, `${seedText}: first bond never completed\n  ${describe(sim)}`);

  sim.player.resting = false;
  sim.orderGrowth(target.tip.gx, 8);
  let site = null;
  for (let i = 0; i < 200 && !site; i++) {
    advance(1);
    site = bestSurfaceStrand(sim);
  }
  assert.ok(site, `${seedText}: a supplied network can grow back to the surface\n  ${describe(sim)}`);

  let clock = 0;
  while (sim.outcome === 'playing' && clock < budgetSeconds) {
    sim.player.resting = true;
    for (let i = 0; i < 500 && sim.player.surplus < ECON.fruitThreshold; i++) {
      advance(0.5);
      clock += 0.5;
    }
    assert.ok(
      sim.player.surplus >= ECON.fruitThreshold,
      `${seedText}: the reserve for bloom ${sim.player.fruited + 1} never filled\n  ${describe(sim)}`
    );
    const node = bestSurfaceStrand(sim);
    assert.ok(node, `${seedText}: no surface strand stands for the next bloom\n  ${describe(sim)}`);
    const order = sim.orderFruit(node.gx, node.gy);
    assert.ok(
      order.ok,
      `${seedText}: the bloom order was refused: ${order.message}\n  ${describe(sim)}`
    );
    for (let i = 0; i < 700 && sim.player.fruit.active; i++) {
      advance(0.5);
      clock += 0.5;
    }
    assert.equal(
      sim.player.fruit.active,
      false,
      `${seedText}: the bloom never finished\n  ${describe(sim)}`
    );
  }
  assert.equal(
    sim.outcome,
    'fruited',
    `${seedText}: the two-bloom journey must be winnable\n  ${describe(sim)}`
  );
  assert.equal(sim.player.blooms.length, sim.player.fruited, 'every bloom is recorded where it stood');
  assert.ok(
    sim.player.blooms.every((bloom) => bloom.gy <= 12),
    'blooms are recorded at the surface where they were raised'
  );
  if (match) {
    assert.ok(match.colonization.length >= 1, 'a real bloom must found at least one daughter');
    console.log(`  regional: ${match.colonization.length} daughter colonies funded by actual blooms`);
  }
  return sim;
}

const seeds = (process.env.JOURNEY_SEEDS ?? 'raven-wood,old-growth,ironwood').split(',').filter(Boolean);
for (const seed of seeds) {
  const sim = playJourney(seed);
  results.push(
    `full journey on "${seed}": ${sim.player.fruited} blooms, ${sim.player.spores} spores, ` +
      `${Math.round(sim.time)}s simulated, ${sim.player.nodes.filter((n) => n.alive).length} living strands`
  );
}

// ---------------------------------------------------------------------------
// 7. Cords, refusals after the match, and determinism
// ---------------------------------------------------------------------------
{
  const sim = new Simulation('raven-wood');
  step(sim, 8);
  const node = sim.player.nodes.find((n) => n.alive && n.connected && n.carbon > ECON.nodeCarbonCap);
  assert.ok(node, 'a strand should be holding enough carbon to pay for a cord');
  assert.ok(makeCord(sim.player, node.id), 'a paid cord is accepted');
  assert.equal(makeCord(sim.player, node.id), false, 'a cord cannot be charged twice');
  assert.ok(node.reinforced && node.thickness >= 0.9, 'a paid cord keeps its strength');
  step(sim, 2);
  assert.ok(node.reinforced, 'a paid cord is permanent');

  sim.player.surplus = ECON.fruitThreshold;
  assert.equal(startFruiting(sim.player, sim.world, sim.player.nodes[0].gx, 30), null, 'deep fruiting is refused');
  sim.outcome = 'fruited';
  assert.equal(sim.orderBond(10, 10).ok, false);
  assert.equal(sim.orderCord(10, 10).ok, false);
  assert.equal(sim.orderFruit(10, 10).ok, false);
  assert.equal(sim.orderGrowth(10, 10), false);
  results.push('permanent cords, deep-fruiting refusal and outcome guards');
}
{
  const a = new Simulation('determinism');
  const b = new Simulation('determinism');
  a.orderGrowth(70, 20);
  b.orderGrowth(70, 20);
  step(a, 10);
  step(b, 10);
  assert.deepEqual(a.player.nodes, b.player.nodes, 'identical seeds and orders must stay deterministic');
  assert.equal(a.world.waterTableCm, b.world.waterTableCm, 'soil state stays deterministic too');
  results.push('determinism under identical orders');
}

for (const line of results) console.log('  ok - ' + line);
console.log(`PASS: ${results.length} checks.`);
