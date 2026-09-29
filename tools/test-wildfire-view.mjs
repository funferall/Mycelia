/** Browser check for the wildfire: real controls, warning smoke, the moving front, char, ash. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4199);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(120000);
  await page.goto(`${server.url}/?start=best&seed=ember-run&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());
  mkdirSync('design/shots', { recursive: true });
  const frames = (n, ms = 100) => page.evaluate(([n, ms]) => {
    const g = window.mycelia.game;
    for (let i = 0; i < n; i++) g.frame(g.lastFrame + ms, false);
    g.frame(g.lastFrame + 16, true);
  }, [n, ms]);

  // Synthetic late-game fixture: the capstone and a bank are set directly;
  // kindling, the front and every loss run through the real code.
  await page.evaluate(() => {
    const game = window.mycelia.game;
    const net = game.match.active.sim.player;
    net.evolution.learned = ['living-sheath', 'cord-memory', 'ember-crown'];
    net.evolution.age = 300;
    for (const n of net.nodes) { n.carbon = 300; n.water = 100; n.nitrogen = 50; }
    document.querySelector('#view-forest').click();
  });
  await frames(30);
  await page.locator('.fire-controls summary').click();
  await page.selectOption('#fire-bearing', '0');
  const preview = await page.evaluate(() => ({
    status: document.querySelector('.fire-reason').textContent,
    tiles: document.querySelectorAll('.fire-map .fire-tile').length,
    labels: [...document.querySelectorAll('.fire-map text')].map((t) => t.textContent),
  }));
  assert.equal(preview.status, 'Ready to kindle');
  assert.equal(preview.tiles, 9);
  await page.locator('.fire-controls').screenshot({ path: 'design/shots/fire-picker.png' });
  await page.locator('.fire-invoke').click();

  const warning = await page.evaluate(() => {
    const g = window.mycelia.game;
    g.match.step(25);
    for (let i = 0; i < 60; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    return {
      phase: g.match.fire.phase,
      watch: document.querySelector('.fire-watch strong').textContent,
      hidden: document.querySelector('.fire-watch').hidden,
      report: g.renderReport().fire,
      burned: g.match.fire.burnedTrees.length,
    };
  });
  assert.equal(warning.phase, 'warning');
  assert.equal(warning.hidden, false);
  assert.match(warning.watch, /Fire kindles in \d+s/);
  assert.equal(warning.burned, 0);
  assert.ok(warning.report.draws >= 1, 'smoke rises on the horizon in the warning');
  await page.screenshot({ path: 'design/shots/fire-warning.png', timeout: 60000 });

  const burning = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    // Into the burn, stepped finely as the game does, to the middle of the region.
    for (let i = 0; i < 20 * 60 && m.fire.phase !== 'burning'; i++) m.step(1 / 60);
    for (let i = 0; i < 38 * 10; i++) m.step(0.1);
    for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    return {
      phase: m.fire.phase,
      burned: m.fire.burnedTrees.length,
      report: g.renderReport().fire,
      glow: g.stage.fireGlow,
      watch: document.querySelector('.fire-watch strong').textContent,
    };
  });
  assert.equal(burning.phase, 'burning');
  assert.ok(burning.burned > 0, 'trees behind the front have burned');
  assert.equal(burning.report.flames, true);
  assert.equal(burning.report.embers, true);
  assert.equal(burning.report.draws, 3, 'flames, smoke and embers');
  assert.ok(burning.glow > 0.5, 'the stage takes the fire light');
  assert.match(burning.watch, /Fire running/);
  await page.screenshot({ path: 'design/shots/fire-burning.png', timeout: 60000 });

  // Close to the front: flames, char behind, living forest ahead.
  await page.evaluate(() => {
    const g = window.mycelia.game;
    const f = g.match.fire;
    const p = f.frontAt(g.match.time) - 6;
    const c = Math.cos(f.state.direction), s = Math.sin(f.state.direction);
    const w = g.region.cols * 136, h = g.region.rows * 136;
    const x = Math.min(w - 20, Math.max(20, c * p + -s * (h / 2)));
    const y = Math.min(h - 20, Math.max(20, s * p + c * (h / 2)));
    const scene = g.regionToScenePoint({ x, y, z: g.region.heightAt(x, y) });
    g.stage.rig.snapForest(scene.x, scene.z, 95);
    for (let i = 0; i < 4; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
  });
  await page.screenshot({ path: 'design/shots/fire-front.png', timeout: 60000 });

  const after = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    for (let i = 0; i < 40 * 10 && m.fire.phase === 'burning'; i++) m.step(0.1);
    m.step(60);
    g.stage.rig.reframe();
    for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    return {
      phase: m.fire.phase,
      losses: m.fire.losses,
      living: m.fire.livingTreesBurned,
      flushed: m.stands.filter((s) => s.sim.regionalWeather?.fruiting).length,
      report: g.renderReport().fire,
    };
  });
  assert.equal(after.phase, 'aftermath');
  assert.ok(after.flushed > 0, 'burned stands are in the ash flush');
  assert.equal(after.report.flames, false, 'no flames once the front has passed');
  await page.screenshot({ path: 'design/shots/fire-aftermath.png', timeout: 60000 });

  const settled = await page.evaluate(() => {
    const g = window.mycelia.game;
    g.match.step(g.match.fire.remaining + 0.1);
    for (let i = 0; i < 60; i++) g.frame(g.lastFrame + 100, false);
    return { phase: g.match.fire.phase, hidden: document.querySelector('.fire-watch').hidden, flushed: g.match.stands.filter((s) => s.sim.regionalWeather?.fruiting).length };
  });
  assert.equal(settled.phase, 'idle');
  assert.equal(settled.hidden, true);
  assert.equal(settled.flushed, 0);
  assert.deepEqual(problems, [], 'no browser errors (shaders compiled)');
  console.log(`PASS wildfire browser: picker (9 tiles), kindled via button, warning smoke, front mid-region with ${burning.burned} trees burned, 3 fire draws, glow ${burning.glow.toFixed(2)}, aftermath flush on ${after.flushed} stands, ${after.living} living trees burned, player ${JSON.stringify(after.losses.player)}, rival ${JSON.stringify(after.losses.rival)}. Synthetic late-game fixture, fast QA.`);
} finally {
  await browser?.close();
  server.stop();
}
