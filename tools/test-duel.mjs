// The four-stand duel (`?map=4`): a 2 by 2 region, a majority hold of three,
// growth through every stand edge (north and south too), and an agent rival
// that can go after the player in another stand. Pure Node.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
const out = mkdtempSync(join(tmpdir(), 'mycelia-duel-'));
for (const dir of ['src/sim', 'src/agent']) {
  mkdirSync(join(out, dir), { recursive: true });
  for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(f => f.endsWith('.ts'))) {
    const code = stripTypeScriptTypes(readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8'));
    writeFileSync(join(out, dir, file.replace('.ts', '.mjs')), code.replace(/from '(\.{1,2}\/.+?)'/g, "from '$1.mjs'"));
  }
}
const load = (path) => import(pathToFileURL(join(out, path + '.mjs')));
const { RegionalMatch, holdTilesFor } = await load('src/sim/match');
const { observe } = await load('src/agent/observe');
const { act } = await load('src/agent/decision');
const { steeringClaimed } = await load('src/sim/network');
globalThis.performance ??= { now: () => Date.now() };
const step = (m, seconds) => { for (let i = 0; i < seconds * 60; i++) m.step(1 / 60); };

{
  for (const seed of ['raven-wood', 'b2', 'c3', 'd4']) {
    const m = new RegionalMatch(seed, undefined, { stands: 4 });
    const { region } = m;
    assert.equal(region.stands.length, 4);
    assert.deepEqual([region.cols, region.rows], [2, 2]);
    const home = region.stands[region.foundingStand], rival = region.stands[region.rivalStand];
    assert.ok(Math.abs(home.sx - rival.sx) === 1 && Math.abs(home.sy - rival.sy) === 1, `${seed}: the rival starts across the diagonal`);
    assert.equal(m.holdTiles, 3, 'three of four stands take the region');
    assert.ok(region.stands.every((s) => s.neighbours.length === 2), 'every stand has two neighbours');
  }
  assert.equal(holdTilesFor(9), 5, 'the nine-stand region still needs five');
  console.log('PASS four stands in a 2 by 2 region, the rival across the diagonal, three stands to hold');
}

{
  // The hold counts to three on this map.
  const m = new RegionalMatch('raven-wood', undefined, { stands: 4 });
  const held = [];
  for (const stand of m.stands) {
    if (held.length === 3) break;
    const tree = stand.sim.world.trees.find((t) => !t.dead && t.rootTips.length);
    if (!tree) continue;
    tree.rootTips[0].bondedTo = 0;
    tree.rootTips[0].bondedColonyId = 'player@fixture';
    held.push(stand.site.id);
  }
  assert.equal(held.length, 3);
  const said = [];
  m.broadcast = (text) => said.push(text);
  step(m, 1.1);
  assert.equal(m.hold.player.tiles, 3);
  assert.notEqual(m.hold.player.since, null, 'three stands start the hold');
  assert.match(m.holdStatus(), /keep 3/);
  console.log(`PASS the hold starts at three stands ("${m.holdStatus()}")`);
}

{
  // The player grows through every edge that leads somewhere, north and south included.
  const m = new RegionalMatch('raven-wood', undefined, { stands: 4, starts: 'best' });
  const site = m.region.stands[m.region.foundingStand];
  const vertical = site.sy === 0 ? 'south' : 'north';
  const horizontal = site.sx === 0 ? 'east' : 'west';
  const closed = [site.sy === 0 ? 'north' : 'south', site.sx === 0 ? 'west' : 'east'];
  for (const edge of closed) {
    const refused = m.growThrough(edge);
    assert.ok(!refused.ok && /edge of the region/.test(refused.message), `${edge}: ${refused.message}`);
  }
  step(m, 5);
  const first = m.growThrough(vertical);
  assert.ok(first.ok, `${vertical}: ${first.message}`);
  const body = m.spatialColonies.get(site.id);
  assert.ok(body, `growing ${vertical} makes the colony a regional body`);
  const target = site.id + (vertical === 'south' ? m.region.cols : -m.region.cols);
  const fed = () => { for (const n of body.colony.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6); };
  for (let s = 0; s < 240 && !body.reachedStandIds().includes(target); s++) { fed(); step(m, 1); }
  assert.ok(body.reachedStandIds().includes(target), `the body grew ${vertical} into stand ${target + 1} (reached ${body.reachedStandIds()})`);
  const reachedAt = Math.round(m.time);
  // A body that spans stands takes the other edge as a regional order.
  const second = m.growThrough(horizontal);
  assert.ok(second.ok, `${horizontal}: ${second.message}`);
  assert.ok(body.colony.waypoints.length > 0, 'the frontier has a new destination');
  console.log(`PASS growth through the ${vertical} edge reached stand ${target + 1} by ${reachedAt}s; ${horizontal} then ordered ("${second.message}"); outer edges refused`);
}

{
  // A rival body can go after the player in another stand, through the agent's orders.
  const m = new RegionalMatch('raven-wood', undefined, { stands: 4, starts: 'best' });
  step(m, 5);
  const R = m.region.rivalStand;
  const site = m.region.stands[R];
  const neighbour = m.region.stands[site.neighbours[0]];
  const direction = neighbour.sx > site.sx ? 'east' : neighbour.sx < site.sx ? 'west' : neighbour.sy > site.sy ? 'south' : 'north';
  m.ensureRivalSpatialColony(R, direction);
  const body = m.rivalSpatialColonies.get(R);
  const obs = observe(m, 'rival');
  const option = obs.growth.find((g) => /go after the nearest enemy colony/.test(g.label));
  assert.ok(option, `a regional rival is offered the enemy in another stand (${obs.growth.map((g) => g.label).join(' | ')})`);
  assert.match(option.label, new RegExp(`in stand ${m.region.foundingStand + 1}`));
  const done = act(m, obs, { stance: { type: 'choice', choice: 'attack', confidence: 1 }, growth: { type: 'choice', choice: option.id, confidence: 1 } });
  assert.ok(done.some((d) => d.kind === 'grow' && d.ok), JSON.stringify(done));
  assert.ok(steeringClaimed(body.colony) && body.colony.waypoints.length > 0, 'the order stands');
  console.log(`PASS an agent rival can go after the player across stands ("${option.label}": ${done.find((d) => d.kind === 'grow').text})`);
}
