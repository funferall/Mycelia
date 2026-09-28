import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out = mkdtempSync(join(tmpdir(), 'mycelia-flood-'));
for (const file of readdirSync(new URL('../src/sim/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
  writeFileSync(join(out, file.replace('.ts', '.mjs')), stripTypeScriptTypes(readFileSync(new URL('../src/sim/' + file, import.meta.url), 'utf8')).replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = name => import(pathToFileURL(join(out, name + '.mjs')));
const { RegionalMatch, STORM } = await load('match');
const { FLOOD, Flood } = await load('flood');
const { GRID } = await load('content');
const { markConnectivity, updateTotals, isPassable } = await load('network');

/** A storm-capable colony on a stand the stream runs through; ecology frozen. */
function fixture(seed = 'storm-race') {
  const m = new RegionalMatch(seed);
  const id = m.region.foundingStand;
  const from = m.stands[id];
  assert(from.site.stream, 'fixture stand has a stream');
  const net = from.sim.player;
  net.evolution.learned = ['fruit-memory', 'spore-memory', 'deep-drink', 'mineral-weave', 'storm-crown'];
  net.evolution.age = 300; net.fruited = 1; from.released = 1;
  net.nodes[0].bondedTree = 0; net.nodes[1].bondedTree = 1;
  for (const n of net.nodes) { n.carbon = 300; n.water = 100; n.nitrogen = 50; }
  markConnectivity(net); updateTotals(net);
  for (const s of m.stands) s.sim.step = () => {};
  m.soil.step = () => {};
  return { m, id, from, net };
}
const colAt = (site, d) => Math.round(site.stream.centreGx + site.stream.widthGx / 2 + d);
const cell = (world, gx, gy) => world.cells[gy * GRID.cols + gx];

{
  const { m, id, from } = fixture();
  assert.equal(m.summonStorm(id, 0), 'Storm announced');
  m.step(STORM.warning);
  assert.equal(m.flood.level, 0, 'no flood before the storm');
  m.step(FLOOD.rise / 2);
  assert(Math.abs(m.flood.level - 0.5) < 0.02, 'the water rises through the storm');
  m.step(FLOOD.rise / 2 + 0.5);
  assert.equal(m.flood.level, 1);
  const near = colAt(from.site, 4), far = colAt(from.site, FLOOD.reach + 6);
  assert.equal(cell(from.sim.world, near, 3).flooded, true, 'ground by the channel is under water');
  assert.equal(cell(from.sim.world, near, 3).water, 1, 'and waterlogged');
  assert.equal(isPassable(from.sim.world, near, 3), false, 'flooded ground is closed to growth');
  assert.notEqual(cell(from.sim.world, far, 3).flooded, true, 'ground beyond the reach stays dry');
  const dry = m.stands.find(s => !s.site.stream);
  if (dry) assert(!dry.sim.world.cells.some(c => c.flooded), 'a stand with no stream is high ground');
  m.step(STORM.duration - FLOOD.rise);
  assert.equal(m.storm.phase, 'recovery');
  m.step(FLOOD.recede / 2);
  assert(m.flood.level > 0.4 && m.flood.level < 0.6, 'it drains through the recovery');
  m.step(FLOOD.recede / 2 + 1);
  assert.equal(m.flood.level, 0);
  assert(!from.sim.world.cells.some(c => c.flooded), 'the ground reopens when the water has gone');
  assert.equal(isPassable(from.sim.world, near, 3), true);
  console.log('PASS rises with the storm, reaches its bank, closes flooded ground, spares high ground, drains and reopens');
}
{
  // Strands: washed away, drowned, or holding on.
  const { m, id, from, net } = fixture();
  const root = net.nodes[net.rootId];
  const make = (d, gy, props = {}) => {
    const nid = net.nodes.length;
    net.nodes.push({ ...root, id: nid, parent: root.id, children: [], gx: colAt(from.site, d), gy, health: 1, isTip: true, reinforced: false, thickness: 0.2, bondedTree: -1, bondedRootTip: -1, ...props });
    root.children.push(nid);
    return net.nodes[nid];
  };
  const washed = make(3, 4), drowned = make(5, 20), deep = make(5, 60), cord = make(3, 4, { reinforced: true }), high = make(FLOOD.reach + 8, 4);
  markConnectivity(net);
  m.summonStorm(id, 0);
  m.step(STORM.warning + STORM.duration + FLOOD.recede + 1);
  assert.equal(washed.alive, false, 'a thin surface strand is washed away');
  assert.equal(drowned.alive, false, 'a strand in waterlogged soil drowns');
  assert(deep.alive && deep.health === 1, 'a deep strand is below the flood');
  assert(cord.alive, 'a reinforced cord holds');
  assert(high.alive && high.health === 1, 'a strand on high ground is untouched');
  assert(m.flood.losses.player.washed >= 1 && m.flood.losses.player.drowned >= 1);
  console.log(`PASS strands: washed ${m.flood.losses.player.washed}, drowned ${m.flood.losses.player.drowned}; deep, cord and high ground survive`);
}
{
  // Trees by species: oak drowns where birch stands.
  const { m, id, from } = fixture();
  const w = from.sim.world;
  const [oak, birch] = w.trees.filter(t => !t.dead);
  for (const [t, species] of [[oak, 'oak'], [birch, 'birch']]) { t.species = species; t.gx = colAt(from.site, 3); t.health = 0.8; t.seed = 500; }
  m.summonStorm(id, 0);
  m.step(STORM.warning + STORM.duration + FLOOD.recede + 1);
  assert(oak.dead && oak.drowned, 'waterlogged oak drowns');
  assert(!birch.dead && birch.health > 0.5, `birch tolerates wet ground (${birch.health.toFixed(2)})`);
  assert(m.flood.drownedTrees.some(d => d.tree === oak.id));
  console.log(`PASS trees: oak drowned, birch ${birch.health.toFixed(2)}`);
}
{
  // Silt: the peak's reach is left richer; ground beyond it is not.
  const { m, id, from } = fixture();
  const w = from.sim.world;
  const near = colAt(from.site, 4), far = colAt(from.site, FLOOD.reach + 6);
  const before = [cell(w, near, 1).nitrogen, cell(w, far, 1).nitrogen];
  m.summonStorm(id, 0);
  m.step(STORM.warning + STORM.duration + FLOOD.recede + 1);
  assert(cell(w, near, 1).nitrogen > before[0] + 0.1, 'silt feeds the flooded ground');
  assert.equal(cell(w, far, 1).nitrogen, before[1], 'dry ground gets no silt');
  console.log('PASS silt enriches the flooded reach only');
}
{
  const run = () => {
    const { m, id } = fixture('storm-race');
    m.summonStorm(id, 0);
    m.step(STORM.warning + STORM.duration + FLOOD.recede + 1);
    return JSON.stringify({ losses: m.flood.losses, trees: m.flood.drownedTrees });
  };
  assert.equal(run(), run());
  assert.equal(Flood.distance({ stream: null }, 5), null);
  console.log('PASS deterministic replay');
}
