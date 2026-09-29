/**
 * Headless checks for regional play (`TECH-01`, `MAP-15`, `CORE-05`, regional
 * plan C to E): one lineage of adaptations across every colony, automatic
 * fusion of the player's colonies on contact, and the regional victory.
 *
 *   node tools/test-regional-play.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-regional-play-'));
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
  const modules = ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'network', 'sim', 'crossing', 'shared-soil', 'wildfire', 'drought', 'flood', 'match', 'survey', 'evolution'];
  for (const name of modules) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '(.+?)'/g, "from '$1.mjs'"));
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const { RegionalMatch } = await load('match');
  const { updateTotals } = await load('network');
  const { learnAdaptation } = await load('evolution');
  const DT = 1 / 60;

  /** Found one spore daughter from the founding colony, on the player's order. */
  const foundDaughter = (m) => {
    for (let i = 0; i < 600 * 60 && m.gusting(); i++) m.step(DT);
    const net = m.active.sim.player;
    const root = net.nodes[net.rootId];
    root.carbon = 300; root.water = 12; root.nitrogen = 8;
    updateTotals(net);
    net.fruited += 1;
    const result = m.releaseSpores(m.activeStandId);
    assert.equal(result.ok, true, result.message);
    return m.colonization[m.colonization.length - 1].to;
  };

  // ---------------------------------------------------------------- C: lineage

  check('every colony shares one learned list', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    const lists = new Set(m.stands.map((stand) => stand.sim.player.evolution.learned));
    assert.equal(lists.size, 1, 'one list for the player');
    assert.equal([...lists][0], m.lineage.player);
    assert.notEqual(m.lineage.player, m.lineage.rival, 'the rival learns for itself');
  });

  check('what one colony learns, every colony knows, including later daughters', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    const home = m.active.sim.player;
    home.nodes[home.rootId].bondedTree = 0;
    assert.equal(learnAdaptation(home, 'deep-drink'), 'Deep drink learned.');
    for (const stand of m.stands) assert.ok(stand.sim.player.evolution.learned.includes('deep-drink'));
    const to = foundDaughter(m);
    const daughter = m.stands[to].sim.player;
    assert.notEqual(daughter, home, 'the daughter is its own network');
    assert.ok(daughter.evolution.learned.includes('deep-drink'), 'the daughter is born knowing it');
    assert.equal(daughter.evolution.age, 0, 'but its age and timers are its own');
    // Learning in the daughter teaches home too.
    daughter.nodes[daughter.rootId].bondedTree = 0;
    daughter.nodes[daughter.rootId].connected = true;
    const again = learnAdaptation(daughter, 'deep-drink');
    assert.notEqual(again, 'Deep drink learned.', 'already learned by the lineage');
    assert.equal(m.lineage.player.filter((id) => id === 'deep-drink').length, 1, 'learning never stacks');
  });

  check('the rival lineage is separate from the player lineage', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    const rival = m.active.sim.rival;
    rival.evolution.learned.push('deep-drink');
    assert.equal(m.lineage.rival.includes('deep-drink'), true);
    assert.equal(m.lineage.player.includes('deep-drink'), false);
  });

  // ---------------------------------------------------------------- D: fusion

  /**
   * Found a daughter in a neighbouring stand and grow the two colonies toward
   * each other, stopping on the step before they touch.
   */
  const meet = () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    const home = m.activeStandId;
    const to = foundDaughter(m);
    const hs = m.region.stands[home], ts = m.region.stands[to];
    const dir = ts.sx > hs.sx ? 'east' : ts.sx < hs.sx ? 'west' : ts.sy > hs.sy ? 'south' : 'north';
    assert.equal(m.growAcross(dir).ok, true);
    const feed = () => {
      for (const body of m.spatialColonies.values()) {
        for (const n of body.colony.nodes) if (n.alive) {
          n.carbon = Math.max(n.carbon, 5); n.water = Math.max(n.water, 1); n.nitrogen = Math.max(n.nitrogen, 1);
        }
      }
    };
    const homeBody = m.spatialColonies.get(home);
    const target = homeBody.nodePosition(homeBody.colony.nodes[homeBody.colony.rootId]);
    for (let s = 0; s < 900; s++) {
      feed();
      if (s % 10 === 0) {
        const d = m.spatialColonies.get(to);
        d.growAt(target, 'x', target.y);
        const p = d.nodePosition(d.colony.nodes[d.colony.rootId]);
        homeBody.growAt(p, 'x', p.y);
      }
      for (let i = 0; i < 30; i++) {
        const bodies = m.playerBodies();
        if (bodies.length === 2 && m.contactBetween(bodies[0].positions, bodies[1].positions, bodies[1].standId)) {
          return { m, home, to };
        }
        m.step(DT2);
      }
    }
    throw new Error('the colonies never met');
  };
  const DT2 = 1 / 30;
  const sum = (m, key) => {
    let total = 0;
    for (const body of m.spatialColonies.values()) for (const n of body.colony.nodes) if (n.alive) total += n[key];
    return total;
  };

  check('two player colonies that touch fuse into one network, conserving everything', () => {
    const { m, home, to } = meet();
    const before = { carbon: sum(m, 'carbon'), water: sum(m, 'water'), nitrogen: sum(m, 'nitrogen') };
    const daughterAlive = m.spatialColonies.get(to).colony.nodes.filter((n) => n.alive).length;
    const homeAlive = m.spatialColonies.get(home).colony.nodes.filter((n) => n.alive).length;
    m.stepFusion(1);
    assert.equal(m.fusions.length, 1, 'one fusion');
    assert.deepEqual([m.fusions[0].into, m.fusions[0].from], [home, to], 'the older colony survives');
    assert.equal(m.spatialColonies.has(to), false, 'the daughter body is retired');
    assert.equal(m.stands[to].fusedInto, home);
    const body = m.spatialColonies.get(home);
    assert.equal(body.colony.nodes.filter((n) => n.alive).length, homeAlive + daughterAlive, 'every living strand joined');
    for (const key of ['carbon', 'water', 'nitrogen']) {
      assert.ok(Math.abs(sum(m, key) - before[key]) < 1e-6 * Math.max(1, before[key]), `${key} conserved: ${before[key]} -> ${sum(m, key)}`);
    }
    assert.equal(m.stands[to].sim.player.extinct, true, 'the absorbed network is empty');
    assert.ok(body.colony.nodes.some((n) => n.alive && n.connected && body.standOf(n) === to), 'the fused body holds the daughter stand, connected');
    // Every bond the fused colony holds points at a living strand of it.
    for (const stand of m.stands) for (const tree of stand.sim.world.trees) for (const tip of tree.rootTips) {
      if (tip.bondedTo === null || tip.bondedColonyId !== body.colony.colonyId) continue;
      const node = body.colony.nodes[tip.bondedTo];
      assert.ok(node && node.bondedRootTip === tip.id, `tip ${tree.id}:${tip.id} points at its junction`);
    }
    // The spores of the daughter's stand now belong to the survivor.
    assert.equal(m.sporesReady(to), 0);
  });

  check('a fused network still starves a piece cut off from the root', () => {
    const { m, home } = meet();
    const joiningNodes = m.spatialColonies.get(m.playerBodies()[1].standId).colony.nodes.length;
    m.stepFusion(1);
    const body = m.spatialColonies.get(home);
    // The absorbed nodes are the last block; its old founder is the one node in
    // that block whose parent lies outside it: the link the fusion made.
    const offset = body.colony.nodes.length - joiningNodes;
    const link = body.colony.nodes.findIndex((n, i) => i >= offset && n.parent >= 0 && n.parent < offset);
    assert.ok(link >= 0, 'the fusion link exists');
    assert.equal(body.colony.nodes[link].connected, true, 'the joined founder is connected to the root');
    const parent = body.colony.nodes[body.colony.nodes[link].parent];
    parent.children = parent.children.filter((c) => c !== link);
    body.colony.nodes[link].parent = -1;
    for (let i = 0; i < 60; i++) m.step(DT);
    assert.equal(body.colony.nodes[link].connected, false, 'cut from the root, the joined piece is severed again');
  });

  check('fusion is deterministic', () => {
    const run = () => {
      const { m } = meet();
      m.stepFusion(1);
      return JSON.stringify(m.fusions.map((f) => ({ ...f, at: f.at.toFixed(6) })));
    };
    assert.equal(run(), run());
  });

  // ------------------------------------------------- E: the regional victory

  const { HOLD_TILES } = await load('match');
  const { SEASONS } = await load('content');
  /**
   * Bond a tree in each of `n` dormant stands (not the founding one, which is
   * stepped and would trade the fixture away). Dormant stands are not stepped,
   * so the bonds stand still while the rule is exercised.
   */
  const holdStands = (m, n, colony = 'player@fixture') => {
    const dormant = m.stands.filter((stand) => stand.site.id !== m.activeStandId && !stand.sim.hasColony);
    const chosen = dormant.slice(0, n);
    for (const stand of chosen) {
      const tree = stand.sim.world.trees.find((t) => !t.dead);
      tree.rootTips[0].bondedTo = 0;
      tree.rootTips[0].bondedColonyId = colony;
    }
    return chosen.map((stand) => stand.site.id);
  };
  /** Jump to a few seconds before the season turns. */
  const nearTurn = (m) => {
    m.seasonClock = SEASONS[m.seasonIndex % SEASONS.length].seconds - 3;
  };

  check('there is no two-bloom win in a regional match', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    m.active.sim.player.fruited = 2;
    for (let i = 0; i < 120; i++) m.step(DT);
    assert.equal(m.outcome, 'playing');
    assert.equal(m.active.sim.outcome, 'playing', 'the founding colony keeps growing');
    assert.equal(m.victory, 'playing');
  });

  check('holding five stands through the turn of the season takes the region', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    holdStands(m, HOLD_TILES);
    for (let i = 0; i < 90; i++) m.step(DT);
    assert.equal(m.hold.player.tiles, HOLD_TILES);
    assert.notEqual(m.hold.player.since, null, 'the hold has begun');
    assert.match(m.holdStatus(), /until the season turns/);
    nearTurn(m);
    for (let i = 0; i < 6 * 60 && m.victory === 'playing'; i++) m.step(DT);
    assert.equal(m.victory, 'won');
    assert.match(m.holdStatus(), /Region taken/);
  });

  check('losing a stand mid-season breaks the hold, and the turn then wins nothing', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    const held = holdStands(m, HOLD_TILES);
    for (let i = 0; i < 90; i++) m.step(DT);
    assert.notEqual(m.hold.player.since, null);
    // One stand's bond is lost.
    const lost = m.stands[held[0]].sim.world.trees.find((t) => t.rootTips[0].bondedTo !== null);
    lost.rootTips[0].bondedTo = null;
    lost.rootTips[0].bondedColonyId = null;
    for (let i = 0; i < 90; i++) m.step(DT);
    assert.equal(m.hold.player.since, null, 'the hold resets');
    assert.equal(m.hold.player.tiles, HOLD_TILES - 1);
    nearTurn(m);
    for (let i = 0; i < 6 * 60; i++) m.step(DT);
    assert.equal(m.victory, 'playing', 'no win without the hold');
    assert.ok(m.stands.some((stand) => stand.sim.events.some((e) => /hold on the region broke/.test(e.text))), 'the break is announced');
  });

  check('a stand tied with the rival does not count', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    const held = holdStands(m, HOLD_TILES);
    // The rival matches the player in one stand.
    const tree = m.stands[held[0]].sim.world.trees.filter((t) => !t.dead)[1];
    tree.rootTips[0].bondedTo = 0;
    tree.rootTips[0].bondedColonyId = 'rival@fixture';
    for (let i = 0; i < 90; i++) m.step(DT);
    const entry = m.standDominance().find((d) => d.standId === held[0]);
    assert.deepEqual([entry.player, entry.rival, entry.holder], [1, 1, null]);
    assert.equal(m.hold.player.tiles, HOLD_TILES - 1);
    assert.equal(m.hold.player.since, null);
  });

  console.log(`PASS: ${count} checks.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
