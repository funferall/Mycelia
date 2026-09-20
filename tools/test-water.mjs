/** Fast hydrology checks: no browser, asset loads or whole-match warmup. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-water-'));
const started = performance.now();
try {
  for (const name of ['content', 'rng', 'region', 'world', 'spatial', 'network', 'sim']) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '(.+?)'/g, "from '$1.mjs'"));
  }
  const load = name => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const { createStandWorld, groundwaterSaturation, idx } = await load('world');
  const { isPassable, createNetwork, stepNetwork, orderWaypoint } = await load('network');
  const { mulberry32 } = await load('rng');
  const { Simulation } = await load('sim');
  const world = createStandWorld(123, { waterTableCm: 60.5, stream: { centreGx: 68, widthGx: 6 } });
  let count = 0;
  function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
  check('smooth fringe increases from dry to saturated, with an exact reachable boundary', () => {
    assert.equal(groundwaterSaturation(world, 52.5), 0);
    assert.equal(groundwaterSaturation(world, 56.5), 0.5);
    assert.equal(groundwaterSaturation(world, 60.5), 1);
    assert(isPassable(world, 40, 56));
    assert(isPassable(world, 40, 60));
    assert(!isPassable(world, 40, 61));
  });
  check('open channel stays blocked; bed becomes reachable only after water recedes', () => {
    assert(!isPassable(world, 68, 5));
    assert(!world.cells[idx(68, 72)].stream);
    assert(!isPassable(world, 68, 72));
    world.waterTableCm = 85;
    assert(isPassable(world, 68, 72));
    assert(!isPassable(world, 68, 5));
    world.waterTableCm = 60.5;
  });
  check('growth orders name groundwater separately from stone and stream', () => {
    const sim = new Simulation('water-check');
    sim.world.waterTableCm = 30.5;
    assert(sim.growTo(40, 30).ok);
    assert(!sim.growTo(40, 31).ok);
    assert.match(sim.growTo(40, 31).message, /water table/i);
  });
  check('funded hyphae reach the fringe but never extend through its lower edge', () => {
    const net = createNetwork('player', 'water test', 40, 57, mulberry32(42), 46);
    orderWaypoint(net, 40, 60, world);
    let reached = 57;
    for (let tick = 0; tick < 900; tick++) {
      for (const node of net.nodes) { node.carbon = 6; node.water = 3; node.nitrogen = 2; }
      stepNetwork(net, { world, dt: 1 / 60, time: tick / 60, warmth: 1, light: 1, rival: null, log() {} });
      for (const node of net.nodes) {
        reached = Math.max(reached, node.gy);
        assert(node.gy <= 60 && node.wy <= 60.5 + 1e-8);
      }
    }
    assert(reached >= 59, `frontier reached row ${reached}`);
  });
  check('a rising table invalidates even an already-arrived, paid target before commit', () => {
    const net = createNetwork('player', 'rising water', 40, 57, mulberry32(42), 46);
    const tip = net.nodes.find(node => node.isTip);
    tip.targetGx = 40; tip.targetGy = 60; tip.wx = 40.5; tip.wy = 60.5; tip.paid = true;
    world.waterTableCm = 58;
    stepNetwork(net, { world, dt: 1 / 60, time: 0, warmth: 1, light: 1, rival: null, log() {} });
    assert(tip.gy < 58 && tip.wy < 58);
  });
  console.log(`PASS: ${count} checks in ${((performance.now() - started) / 1000).toFixed(2)}s.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
