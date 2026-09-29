/** Browser check: the flood above ground, and storm, flood, fire and drought as the soil sees them. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4205);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(180000);
  await page.goto(`${server.url}/?start=best&seed=storm-race&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());
  mkdirSync('design/shots', { recursive: true });
  const view = (which) => page.evaluate((which) => {
    const g = window.mycelia.game;
    document.querySelector(`#view-${which}`).click();
    for (let i = 0; i < 40; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
  }, which);

  // Synthetic late-game fixture: every capstone and a bank are set directly;
  // each event, and everything it does, runs through the real code.
  const home = await page.evaluate(() => {
    const g = window.mycelia.game;
    const stand = g.match.active;
    const net = stand.sim.player;
    net.evolution.learned = ['fruit-memory', 'spore-memory', 'deep-drink', 'mineral-weave', 'living-sheath', 'cord-memory', 'storm-crown', 'ember-crown', 'parch-crown'];
    net.evolution.age = 300;
    net.nodes[0].bondedTree = 0; net.nodes[1].bondedTree = 1; net.nodes[2] && (net.nodes[2].bondedTree = 2);
    window.__topUp = () => { for (const n of net.nodes) { if (!n.alive) continue; n.carbon = 300; n.water = 100; n.nitrogen = 50; } };
    window.__topUp();
    return { stream: !!stand.site.stream, id: stand.site.id };
  });
  assert.equal(home.stream, true, 'the home stand has a stream to flood');

  // Storm and flood.
  const flood = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    const r = m.summonStorm(m.activeStandId, 0);
    for (let i = 0; i < (60 + 32) * 4; i++) m.step(0.25);
    document.querySelector('#view-forest').click();
    for (let i = 0; i < 40; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    return { r, level: m.flood.level, report: g.renderReport().flood, extent: m.flood.extent };
  });
  assert.equal(flood.r, 'Storm announced');
  assert.equal(flood.level, 1, 'the stream is at its flood peak');
  assert.equal(flood.report.visible, true, 'debris is carried downstream');
  assert.ok(flood.extent.length > 0);
  await page.screenshot({ path: 'design/shots/flood-surface.png', timeout: 60000 });
  // Close, at the stream where it crosses the home stand.
  await page.evaluate(() => {
    const g = window.mycelia.game;
    const site = g.match.active.site;
    const course = g.stream.course;
    const inside = course.filter((p) => p.x >= site.sx * 136 && p.x < (site.sx + 1) * 136 && p.y >= site.sy * 136 && p.y < (site.sy + 1) * 136);
    const p = inside[Math.floor(inside.length / 2)] ?? course[Math.floor(course.length / 2)];
    const at = g.regionToScenePoint({ x: p.x, y: p.y, z: g.region.heightAt(p.x, p.y) });
    g.stage.rig.snapForest(at.x, at.z, 110);
    for (let i = 0; i < 6; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
  });
  await page.screenshot({ path: 'design/shots/flood-close.png', timeout: 60000 });
  await view('underground');
  const floodUnder = await page.evaluate(() => window.mycelia.game.renderReport().flood.underground);
  assert.equal(floodUnder.visible, true, 'the soil shows the storm');
  assert.ok(floodUnder.floodedColumns > 0, `flooded columns drawn in the transect (${floodUnder.floodedColumns})`);
  await page.screenshot({ path: 'design/shots/underground-flood.png', timeout: 60000 });

  const drained = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    for (let i = 0; i < (13 + 180 + 1) * 4; i++) m.step(0.25);
    for (let i = 0; i < 20; i++) g.frame(g.lastFrame + 100, false);
    return { phase: m.storm.phase, level: m.flood.level, losses: m.flood.losses, columns: g.renderReport().flood.underground.floodedColumns };
  });
  assert.equal(drained.phase, 'idle');
  assert.equal(drained.level, 0);
  assert.equal(drained.columns, 0, 'the transect drains with the flood');

  // Fire, with the front crossing this stand.
  const fire = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    window.__topUp();
    const r = m.kindleFire(m.activeStandId, 0);
    const at = m.fire.schedule(0).find((s) => s.stand === m.activeStandId).at;
    for (let i = 0; i < (45 + at) * 4; i++) m.step(0.25);
    for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    return { r, phase: m.fire.phase, visible: g.renderReport().flood.underground.visible };
  });
  assert.equal(fire.r, 'Fire kindled');
  assert.equal(fire.phase, 'burning');
  assert.equal(fire.visible, true, 'the soil shows the fire');
  await page.screenshot({ path: 'design/shots/underground-fire.png', timeout: 60000 });

  // Drought.
  const drought = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    for (let i = 0; i < 300 * 4 && m.fire.phase !== 'idle'; i++) m.step(0.25);
    window.__topUp();
    for (const n of m.active.sim.player.nodes) if (n.alive) n.water = 100;
    const r = m.callDrought(m.activeStandId);
    for (let i = 0; i < (40 + 60) * 4; i++) m.step(0.25);
    for (let i = 0; i < 80; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    return { r, phase: m.drought.phase, visible: g.renderReport().flood.underground.visible, severity: g.renderReport().drought.severity };
  });
  assert.equal(drought.r, 'Drought called');
  assert.equal(drought.phase, 'active');
  assert.equal(drought.visible, true, 'the soil shows the drought');
  await page.screenshot({ path: 'design/shots/underground-drought.png', timeout: 60000 });

  assert.deepEqual(problems, [], 'no browser errors (shaders compiled)');
  console.log(`PASS underground and flood browser: flood peak with debris over ${flood.extent.length} stands, ${floodUnder.floodedColumns} flooded transect columns, drained clean (player ${JSON.stringify(drained.losses.player)}, rival ${JSON.stringify(drained.losses.rival)}); fire and drought drawn in the soil (drought ${drought.severity.toFixed(2)}). Synthetic late-game fixture, fast QA.`);
} finally {
  await browser?.close();
  server.stop();
}
