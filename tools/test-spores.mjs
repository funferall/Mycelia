/**
 * Headless checks for player-timed spore release (`MAP-10`, regional plan B).
 *
 * A mature fruiting body holds its spores. The player may release them at any
 * time; otherwise the next gust takes them. The wind decides where they land.
 * A colony that cannot pay for the journey keeps its spores and is told so.
 *
 *   node tools/test-spores.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-spores-'));
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
  const modules = ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'network', 'sim', 'crossing', 'shared-soil', 'wildfire', 'drought', 'flood', 'match', 'survey'];
  for (const name of modules) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '(.+?)'/g, "from '$1.mjs'"));
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const { RegionalMatch, SPORE_GUST } = await load('match');
  const { updateTotals } = await load('network');
  const { ECON } = await load('content');
  const DT = 1 / 60;

  /** A founding colony with one mature bloom and enough to pay for a spore. */
  const ready = (seed = 'raven-wood', rich = true) => {
    const m = new RegionalMatch(seed, undefined, { starts: 'best' });
    // The bloom matures on calm air, so what happens next is the test's doing.
    for (let i = 0; i < 600 * 60 && m.gusting(); i++) m.step(DT);
    const stand = m.active;
    const net = stand.sim.player;
    const root = net.nodes[net.rootId];
    if (rich) {
      root.carbon = 300;
      root.water = 12;
      root.nitrogen = 8;
    } else {
      for (const node of net.nodes) {
        node.carbon = 0;
        node.water = 0;
        node.nitrogen = 0;
      }
    }
    updateTotals(net);
    net.fruited += 1;
    return { m, stand, id: m.activeStandId };
  };
  /** Step until the gust signal crosses the threshold (or a limit). */
  const untilGust = (m, limit = 600) => {
    for (let i = 0; i < limit * 60; i++) {
      if (m.gusting()) return true;
      m.step(DT);
    }
    return false;
  };
  /** Step to a moment with no gust, so waiting can be observed. */
  const calm = (m) => {
    for (let i = 0; i < 600 * 60 && m.gusting(); i++) m.step(DT);
  };

  check('a mature body holds its spores while the air is calm', () => {
    const { m, id } = ready();
    calm(m);
    assert.equal(m.sporesReady(id), 1, 'one bloom is waiting');
    const before = m.colonization.length;
    // Step while no gust arrives.
    for (let i = 0; i < 60 * 60 && !m.gusting(); i++) m.step(DT);
    if (!m.gusting()) assert.equal(m.colonization.length, before, 'no spore leaves on calm air');
    assert.ok(m.gustAt(m.time) < SPORE_GUST || m.gusting());
  });

  check('the player releases the spores on command, and the wind picks the stand', () => {
    const { m, id } = ready();
    calm(m);
    const wind = m.wind;
    const targets = m.sporeTargets(id, wind.direction, false, 'player');
    const result = m.releaseSpores(id);
    assert.equal(result.ok, true, result.message);
    assert.equal(m.colonization.length, 1);
    assert.equal(m.colonization[0].to, targets[0], 'the spore lands where the wind points first');
    assert.equal(m.sporesReady(id), 0, 'the bloom is spent');
    assert.equal(m.releaseSpores(id).ok, false, 'a spent bloom cannot be released twice');
  });

  check('a waiting body releases on the first gust, and only once', () => {
    const { m, id } = ready();
    calm(m);
    assert.equal(untilGust(m), true, 'a gust arrives within ten minutes');
    // The spore beat runs once a second: give it two.
    for (let i = 0; i < 120 && m.colonization.length === 0; i++) m.step(DT);
    assert.equal(m.colonization.length, 1, 'the gust took the spores');
    assert.equal(m.sporesReady(id), 0);
    for (let i = 0; i < 20 * 60; i++) m.step(DT);
    assert.equal(m.colonization.length, 1, 'the same bloom never releases twice');
  });

  check('a colony too poor to pay keeps its spores and is told what it needs', () => {
    const { m, stand, id } = ready('raven-wood', false);
    const result = m.releaseSpores(id);
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(`${ECON.colonyFund.carbon} carbon`));
    assert.equal(m.sporesReady(id), 1, 'the spores stay on the stalk');
    assert.ok(stand.sim.player.carbon >= 0, 'never driven into debt');
    // A gust passes: still no journey, and one notice in the stand's log.
    untilGust(m);
    for (let i = 0; i < 180; i++) m.step(DT);
    assert.equal(m.colonization.length, 0);
    assert.equal(m.sporesReady(id), 1);
    const notices = stand.sim.events.filter((e) => /too poor to send spores/.test(e.text));
    assert.equal(notices.length, 1, 'the unaffordable gust is announced once');
    // Once it can pay, the player's release goes through.
    const root = stand.sim.player.nodes[stand.sim.player.rootId];
    root.carbon = 300; root.water = 12; root.nitrogen = 8;
    updateTotals(stand.sim.player);
    assert.equal(m.releaseSpores(id).ok, true);
    assert.equal(m.colonization.length, 1);
  });

  check('release timing and landing are deterministic', () => {
    const run = () => {
      const { m, id } = ready();
      untilGust(m);
      for (let i = 0; i < 300; i++) m.step(DT);
      m.active.sim.player.fruited += 1;
      const root = m.active.sim.player.nodes[m.active.sim.player.rootId];
      root.carbon = 300; root.water = 12; root.nitrogen = 8;
      updateTotals(m.active.sim.player);
      m.releaseSpores(id);
      return m.colonization.map((c) => [c.at.toFixed(6), c.from, c.to]);
    };
    assert.deepEqual(run(), run());
  });

  check('gusts come often enough to matter and rarely enough to wait for', () => {
    const m = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    let onsets = 0, prev = false;
    for (let t = 0; t < 3600; t += 0.1) {
      const g = m.gustAt(t) >= SPORE_GUST;
      if (g && !prev) onsets++;
      prev = g;
    }
    assert.ok(onsets >= 25 && onsets <= 80, `${onsets} gusts in an hour`);
  });

  console.log(`PASS: ${count} checks.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
