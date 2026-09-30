/**
 * Headless checks for cords (`CORE-03` cord order): the route a drag braids,
 * what a cord costs and who pays, the reserve it never spends, and the
 * bottleneck signal (`load`) the cord tool shows.
 *
 *   node tools/test-cords.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-cords-'));
let count = 0;
function check(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
  count++;
  console.log(`PASS ${name}`);
}

try {
  for (const name of ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'segments', 'network', 'sim']) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '(.+?)'/g, "from '$1.mjs'"));
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const { Simulation } = await load('sim');
  const { cordRoute, planCord, layCord, cordBudget, markConnectivity, CORD_RESERVE } = await load('network');
  const { ECON } = await load('content');
  const DT = 1 / 60;

  /**
   * A colony that has bonded its nearest tree and then grown on: a real graph
   * with a real supply line, which is what a cord is for.
   */
  const grown = (seconds = 60) => {
    const sim = new Simulation('raven-wood');
    const origin = sim.player.nodes[sim.player.rootId];
    const target = sim.world.trees.flatMap((tree) => tree.rootTips.map((tip) => ({ tree, tip, d: Math.hypot(tip.gx - origin.gx, tip.gy - origin.gy) })))
      .sort((a, b) => a.d - b.d)[0];
    sim.orderGrowth(target.tip.gx, target.tip.gy);
    let bonded = false;
    for (let s = 0; s < 90 && !bonded; s++) {
      for (let i = 0; i < 60; i++) sim.step(DT);
      bonded = sim.orderBondTip(target.tree.id, target.tip.id).ok;
    }
    assert.ok(bonded, 'the fixture colony bonds its first tree');
    for (let i = 0; i < seconds / DT; i++) sim.step(DT);
    markConnectivity(sim.player);
    return sim;
  };
  const connectedCarbon = (net) => net.nodes.reduce((sum, n) => sum + (n.alive && n.connected ? n.carbon : 0), 0);
  const farthestTip = (net) => {
    let best = null;
    let depth = -1;
    for (const node of net.nodes) {
      if (!node.alive || !node.isTip || !node.connected) continue;
      let d = 0;
      for (let at = node; at.parent >= 0; at = net.nodes[at.parent]) d++;
      if (d > depth) { depth = d; best = node; }
    }
    return best;
  };

  check('a route home walks parent links from the strand to the founding node', () => {
    const sim = grown();
    const net = sim.player;
    const tip = farthestTip(net);
    const route = cordRoute(net, tip.id);
    assert.ok(route.length > 3, `a real route (${route.length})`);
    assert.equal(route[0], tip.id);
    for (let i = 1; i < route.length; i++) assert.equal(net.nodes[route[i - 1]].parent, route[i]);
    assert.equal(net.nodes[route[route.length - 1]].parent, net.rootId, 'ends one short of the founder');
  });

  check('a drag between two strands follows the graph through their common ancestor', () => {
    const sim = grown();
    const net = sim.player;
    const tips = net.nodes.filter((n) => n.alive && n.isTip && n.connected);
    const a = tips[0];
    const b = tips[tips.length - 1];
    const route = cordRoute(net, a.id, b.id);
    assert.ok(route.length > 0);
    // Walk it as the preview does: every step moves along exactly one strand.
    let current = a.id;
    for (const id of route) {
      const node = net.nodes[id];
      const next = node.parent === current ? id : node.parent;
      assert.ok(net.nodes[next].parent === current || net.nodes[current].parent === next, 'adjacent');
      current = next;
    }
    assert.equal(current, b.id, 'the walk arrives where the drag ended');
    assert.deepEqual(cordRoute(net, a.id, a.id), [], 'no route to itself');
  });

  check('laying a cord costs its charge per new strand, paid by the colony, above the reserve', () => {
    const sim = grown();
    const net = sim.player;
    const route = cordRoute(net, farthestTip(net).id);
    const budget = cordBudget(net);
    const plan = planCord(net, route);
    assert.ok(plan.fresh > 0, 'something to lay');
    assert.ok(Math.abs(plan.cost - plan.fresh * ECON.cordCharge) < 1e-9);
    assert.ok(plan.cost <= budget + 1e-9);
    const before = connectedCarbon(net);
    const laid = layCord(net, route);
    assert.equal(laid, plan.fresh);
    assert.ok(Math.abs(before - connectedCarbon(net) - plan.cost) < 1e-6, 'exactly the cost left the colony');
    assert.ok(connectedCarbon(net) >= CORD_RESERVE - 1e-6, 'the reserve is never spent');
    for (const id of route.slice(0, plan.affordable)) {
      assert.equal(net.nodes[id].reinforced, true);
      assert.ok(net.nodes[id].thickness >= 0.9);
    }
    const again = planCord(net, route.slice(0, plan.affordable));
    assert.equal(again.cost, 0, 'laid strands are free to pass along');
  });

  check('a poor colony lays only what it can afford, from the start of the drag', () => {
    const sim = grown();
    const net = sim.player;
    const route = cordRoute(net, farthestTip(net).id);
    // Leave enough for exactly two strands above the reserve.
    const spare = CORD_RESERVE + ECON.cordCharge * 2 + 0.1;
    const total = connectedCarbon(net);
    for (const node of net.nodes) if (node.alive && node.connected) node.carbon *= spare / total;
    const plan = planCord(net, route);
    assert.equal(plan.fresh, 2);
    assert.equal(layCord(net, route), 2);
    assert.equal(net.nodes[route[0]].reinforced, true);
    assert.equal(net.nodes[route[1]].reinforced, true);
    assert.equal(net.nodes[route[2]].reinforced, false);
    assert.equal(layCord(net, route), 0, 'nothing left above the reserve');
  });

  check('the order methods report plainly and never mint carbon', () => {
    const sim = grown();
    const net = sim.player;
    const tip = farthestTip(net);
    const before = connectedCarbon(net);
    const result = sim.orderCordRoute(tip.id);
    assert.equal(result.ok, true, result.message);
    assert.ok(connectedCarbon(net) < before);
    const cut = net.nodes.find((n) => n.alive && n.parent >= 0 && !n.connected);
    if (cut) assert.equal(sim.orderCordRoute(cut.id).ok, false, 'a severed piece has no way home');
  });

  check('load marks strands whose pipe runs full, and a cord relieves them', () => {
    const sim = grown(90);
    const net = sim.player;
    const loads = net.nodes.filter((n) => n.alive && n.parent >= 0).map((n) => n.load ?? 0).sort((a, b) => a - b);
    const q = (p) => loads[Math.floor(p * (loads.length - 1))].toFixed(2);
    console.log(`  above 0.85: ${loads.filter((l) => l > 0.85).length}, above 0.95: ${loads.filter((l) => l > 0.95).length}, tips among >0.85: ${net.nodes.filter((n) => n.alive && n.isTip && (n.load ?? 0) > 0.85).length}`);
    console.log(`  load over ${loads.length} strands: median ${q(0.5)}, p90 ${q(0.9)}, max ${q(1)}; ${loads.filter((l) => l > 0.7).length} above 0.7`);
    assert.ok(loads.every((l) => l >= 0 && l <= 1 + 1e-9), 'load is a fraction');
    const busy = net.nodes.filter((n) => n.alive && n.parent >= 0 && (n.load ?? 0) > 0.7);
    assert.ok(busy.length > 0, 'a working colony has bottlenecks to show');
    const target = busy.sort((a, b) => (b.load ?? 0) - (a.load ?? 0))[0];
    const was = target.load;
    layCord(net, [target.id]);
    for (let i = 0; i < 10 / DT; i++) sim.step(DT);
    assert.ok((target.load ?? 0) < was, `a cord's wider pipe runs less full (${was.toFixed(2)} -> ${(target.load ?? 0).toFixed(2)})`);
  });

  console.log(`PASS: ${count} checks.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
