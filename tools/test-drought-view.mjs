/** Browser check for the drought: real controls, heat warning, cracked land, a fed tree, recovery. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4203);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(180000);
  await page.goto(`${server.url}/?start=best&seed=dry-run&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());
  mkdirSync('design/shots', { recursive: true });

  // Synthetic late-game fixture: the capstone, a bank and one supplied bond are
  // set directly; the drought, thirst, withering and recovery are the real code.
  const setup = await page.evaluate(() => {
    const game = window.mycelia.game;
    const stand = game.match.active;
    const net = stand.sim.player;
    net.evolution.learned = ['deep-drink', 'mineral-weave', 'parch-crown'];
    net.evolution.age = 300;
    for (const n of net.nodes) { n.carbon = 300; n.water = 100; n.nitrogen = 50; }
    const tree = stand.sim.world.trees.find((t) => !t.dead && stand.sim.world.cells[8 * 136 + t.gx].streamNear < 0.4);
    const junction = net.nodes[net.rootId];
    tree.rootTips[0].bondedTo = junction.id;
    tree.rootTips[0].bondedColonyId = net.colonyId ?? null;
    junction.bondedTree = tree.id; junction.bondedRootTip = 0; junction.water = 2000;
    document.querySelector('#view-forest').click();
    for (let i = 0; i < 30; i++) game.frame(game.lastFrame + 100, false);
    return { tree: tree.id, health: tree.health };
  });
  await page.locator('.drought-controls summary').click();
  const ready = await page.evaluate(() => ({
    status: document.querySelector('.drought-reason').textContent,
    tiles: document.querySelectorAll('.drought-map .drought-tile').length,
  }));
  assert.equal(ready.status, 'Ready to call');
  assert.equal(ready.tiles, 9);
  await page.locator('.drought-controls').screenshot({ path: 'design/shots/drought-picker.png' });
  await page.locator('.drought-invoke').click();

  const warning = await page.evaluate(() => {
    const g = window.mycelia.game;
    for (let i = 0; i < 30 * 4; i++) g.match.step(0.25);
    for (let i = 0; i < 20; i++) g.frame(g.lastFrame + 100, false);
    return { phase: g.match.drought.phase, watch: document.querySelector('.drought-watch strong').textContent, severity: g.match.drought.severity };
  });
  assert.equal(warning.phase, 'warning');
  assert.match(warning.watch, /Rain stops in \d+s/);
  assert.equal(warning.severity, 0);

  const active = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    // Deep into the dry spell, stepped on the drought's own beat.
    for (let i = 0; i < 70 * 4; i++) m.step(0.25);
    for (let i = 0; i < 80; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    const report = g.renderReport().drought;
    const ribbon = g.stream.water?.geometry.getAttribute('position');
    const full = g.stream.fullWidth;
    const width = (arr, i) => Math.hypot(arr[i * 3] - arr[(i + 1) * 3], arr[i * 3 + 2] - arr[(i + 1) * 3 + 2]);
    const mid = ribbon ? Math.floor(ribbon.count / 4) * 2 : 0;
    return {
      phase: m.drought.phase,
      severity: m.drought.severity,
      shown: report.severity,
      visible: report.visible,
      streamRatio: ribbon ? width(ribbon.array, mid) / width(full, mid) : 1,
      rain: m.active.sim.world.rainfall,
      fed: m.drought.fedTrees.size,
      parched: m.drought.parchedTrees.length,
      watch: document.querySelector('.drought-watch p').textContent,
    };
  });
  assert.equal(active.phase, 'active');
  assert.equal(active.severity, 1);
  assert.ok(active.shown > 0.8, `the ground shows the drought (${active.shown.toFixed(2)})`);
  assert.equal(active.visible, true, 'dust is in the air');
  assert.ok(active.streamRatio < 0.5, `the stream has narrowed (${active.streamRatio.toFixed(2)})`);
  assert.ok(active.rain < 0.05, 'no rain');
  assert.ok(active.fed >= 1, 'a supplied tree is being fed');
  assert.match(active.watch, /Feeding \d+ trees/);
  await page.screenshot({ path: 'design/shots/drought-active.png', timeout: 60000 });

  // Close: cracked ground away from water, the fed tree green among failing ones.
  await page.evaluate((treeId) => {
    const g = window.mycelia.game;
    const view = g.surfaces.find((s) => s?.standId === g.match.activeStandId).trees.find((v) => v.tree.id === treeId);
    const at = view.group.getWorldPosition(view.group.position.clone());
    g.stage.rig.snapForest(at.x, at.z, 80);
    for (let i = 0; i < 4; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
  }, setup.tree);
  await page.screenshot({ path: 'design/shots/drought-close.png', timeout: 60000 });

  const ended = await page.evaluate((treeId) => {
    const g = window.mycelia.game;
    const m = g.match;
    for (let i = 0; i < 35 * 4; i++) m.step(0.25);
    const tree = m.active.sim.world.trees[treeId];
    const result = { phase: m.drought.phase, fedAlive: !tree.dead, fedHealth: tree.health, parched: m.drought.parchedTrees.length, player: m.drought.losses.player, rival: m.drought.losses.rival };
    document.querySelector('#view-underground').click();
    for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    return result;
  }, setup.tree);
  assert.equal(ended.phase, 'recovery');
  assert.equal(ended.fedAlive, true, 'the tree the mycelium fed survived');
  assert.ok(ended.parched > 0, 'unfed trees died of thirst');
  await page.screenshot({ path: 'design/shots/drought-underground.png', timeout: 60000 });

  const settled = await page.evaluate(() => {
    const g = window.mycelia.game;
    g.match.step(g.match.drought.remaining + 0.1);
    document.querySelector('#view-forest').click();
    for (let i = 0; i < 120; i++) g.frame(g.lastFrame + 100, false);
    return { phase: g.match.drought.phase, hidden: document.querySelector('.drought-watch').hidden, shown: g.renderReport().drought.severity };
  });
  assert.equal(settled.phase, 'idle');
  assert.equal(settled.hidden, true);
  assert.ok(settled.shown < 0.05, 'cracks close once the rain is back');
  assert.deepEqual(problems, [], 'no browser errors (shaders compiled)');
  console.log(`PASS drought browser: called via button, heat warning, full severity shown ${active.shown.toFixed(2)}, stream at ${Math.round(active.streamRatio * 100)}% width, dust, fed tree survived (${setup.health.toFixed(2)} -> ${ended.fedHealth.toFixed(2)}), ${ended.parched} trees died of thirst, player ${JSON.stringify(ended.player)}, rival ${JSON.stringify(ended.rival)}, recovery clears. Synthetic late-game fixture, fast QA.`);
} finally {
  await browser?.close();
  server.stop();
}
