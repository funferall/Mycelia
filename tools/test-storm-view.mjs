/** Browser check for the summoned storm: real controls, countdown, held bloom, storm, new tiles. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4197);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(120000);
  await page.goto(`${server.url}/?seed=storm-race&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());

  // Synthetic late-game fixture: the capstone's age, bonds and bank are set
  // directly; learning, summoning, release and landings all run the real code.
  const learned = await page.evaluate(() => {
    const game = window.mycelia.game;
    const net = game.match.active.sim.player;
    net.evolution.learned = ['fruit-memory', 'spore-memory', 'deep-drink', 'mineral-weave'];
    net.evolution.age = 300;
    net.fruited = 1;
    game.match.active.released = 1;
    net.nodes[0].bondedTree = 0;
    net.nodes[1].bondedTree = 1;
    for (const n of net.nodes) { n.carbon = 300; n.water = 100; n.nitrogen = 50; }
    game.frame(game.lastFrame + 16, false);
    return { from: game.match.activeStandId, status: game.match.stormStatus(game.match.activeStandId) };
  });
  // The capstone is learned through the ordinary adaptation module.
  await page.evaluate(() => window.mycelia.game.match.active.sim.player.evolution.learned.push('storm-crown'));

  await page.locator('.storm-controls summary').click();
  // Pick the direction with the most free downwind tiles, via the real select.
  const bearing = await page.evaluate((from) => {
    const m = window.mycelia.game.match;
    let best = { deg: 0, n: -1 };
    for (let deg = 0; deg < 360; deg += 45) {
      const n = m.sporeTargets(from, deg * Math.PI / 180).length;
      if (n > best.n) best = { deg, n };
    }
    return best;
  }, learned.from);
  assert.ok(bearing.n >= 2, `some wind reaches at least two free tiles (${bearing.n})`);
  await page.selectOption('#storm-bearing', String(bearing.deg));
  const preview = await page.evaluate(() => ({
    targets: document.querySelectorAll('.storm-map .storm-target').length,
    status: document.querySelector('.storm-reason').textContent,
    enabled: !document.querySelector('.storm-invoke').disabled,
  }));
  assert.equal(preview.targets, bearing.n, 'map preview shows every candidate landing tile');
  assert.equal(preview.status, 'Ready to summon', `invocation is available (${preview.status})`);
  mkdirSync('design/shots', { recursive: true });
  await page.locator('.storm-controls').screenshot({ path: 'design/shots/storm-picker.png' });
  await page.locator('.storm-invoke').click();

  const announced = await page.evaluate(() => {
    const game = window.mycelia.game;
    const m = game.match;
    for (let i = 0; i < 10; i++) game.frame(game.lastFrame + 100, false);
    return {
      phase: m.storm.phase,
      direction: m.storm.direction,
      watchHidden: document.querySelector('.storm-watch').hidden,
      watch: document.querySelector('.storm-watch strong').textContent,
      selectLocked: document.querySelector('#storm-bearing').disabled,
    };
  });
  assert.equal(announced.phase, 'warning');
  assert.ok(Math.abs(announced.direction - bearing.deg * Math.PI / 180) < 1e-9, 'chosen direction is locked into the storm');
  assert.equal(announced.watchHidden, false, 'countdown is visible');
  assert.match(announced.watch, /Storm arrives in \d+s/);
  assert.equal(announced.selectLocked, true);

  // Midway through the warning: a completed bloom waits for the wind.
  const warning = await page.evaluate(() => {
    const game = window.mycelia.game;
    const m = game.match;
    m.step(25);
    m.active.sim.player.fruited++;
    m.step(1);
    document.querySelector('#view-forest').click();
    for (let i = 0; i < 40; i++) game.frame(game.lastFrame + 100, false);
    return { held: m.heldSpores.length, landed: m.colonization.length, remaining: m.stormRemaining, report: game.renderReport().storm };
  });
  assert.equal(warning.held, 1, 'a warning bloom is held, not released');
  assert.equal(warning.landed, 0);
  assert.ok(warning.report.draws >= 1, 'the approaching front is drawn during the warning');
  await page.evaluate(() => { const g = window.mycelia.game; g.frame(g.lastFrame + 16, true); });
  await page.screenshot({ path: 'design/shots/storm-warning.png', timeout: 60000 });

  const active = await page.evaluate((from) => {
    const game = window.mycelia.game;
    const m = game.match;
    m.step(m.stormRemaining + 0.01);
    for (let i = 0; i < 50; i++) game.frame(game.lastFrame + 100, false);
    const lands = m.colonization.filter((c) => c.owner !== 'rival');
    return {
      phase: m.storm.phase,
      held: m.heldSpores.length,
      lands,
      independent: lands.every((c) => m.stands[c.to].sim.player !== m.stands[from].sim.player),
      report: game.renderReport().storm,
      watch: document.querySelector('.storm-watch strong').textContent,
    };
  }, learned.from);
  assert.equal(active.phase, 'active');
  assert.equal(active.held, 0);
  assert.ok(active.lands.length >= 2, `held bloom founds several downwind tiles (${active.lands.length})`);
  assert.equal(active.independent, true);
  // The front veil fades once the front has passed overhead; clouds, rain and spores remain.
  assert.ok(active.report.draws >= 3, `storm layers drawn (${active.report.draws})`);
  assert.ok(active.report.particles > 0);
  assert.match(active.watch, /Storm · \d+s remaining/);
  assert.equal(active.report.vortex, true, 'the vortex turns over the region');
  await page.evaluate(() => { const g = window.mycelia.game; g.frame(g.lastFrame + 16, true); });
  await page.screenshot({ path: 'design/shots/storm-active.png', timeout: 60000 });

  // Throw down a bonded tree through the match's own windfall path, then watch
  // the view topple it and strike it.
  const windfall = await page.evaluate(() => {
    const game = window.mycelia.game;
    const m = game.match;
    const stand = m.active;
    const net = stand.sim.player;
    // The fixture's bond on tree 0 is node-side only; complete it on the tree's
    // root tip, as real bonding does, so the windfall has a real bond to tear.
    const tree = stand.sim.world.trees[0];
    const junction = net.nodes.find((n) => n.bondedTree === tree.id);
    tree.rootTips[0].bondedTo = junction.id;
    tree.rootTips[0].bondedColonyId = net.colonyId ?? null;
    junction.bondedRootTip = 0;
    const strikesBefore = game.stormView.report().strikes;
    const bondedBefore = net.nodes.filter((n) => n.bondedTree === tree.id).length;
    m.fellTree(stand, tree, m.storm.direction);
    game.frame(game.lastFrame + 16, false);
    const struck = game.stormView.report().strikes > strikesBefore;
    for (let i = 0; i < 40; i++) game.frame(game.lastFrame + 100, false);
    const view = game.surfaces.find((s) => s?.standId === stand.site.id).trees.find((v) => v.tree.id === tree.id);
    const up = { x: 0, y: 1, z: 0 };
    const q = view.group.quaternion;
    // Rotate +y by the tree's quaternion; its y component is cos(tilt).
    const y = 1 - 2 * (q.x * q.x + q.z * q.z);
    return {
      fallen: tree.dead && !!tree.fallen,
      tilt: Math.acos(Math.max(-1, Math.min(1, y))),
      struck,
      bondedBefore,
      bondedAfter: net.nodes.filter((n) => n.bondedTree === tree.id).length,
      recorded: m.windfalls.at(-1),
      up,
    };
  });
  assert.equal(windfall.fallen, true);
  assert.ok(windfall.tilt > 1.2, `the felled tree lies down in the forest view (${windfall.tilt.toFixed(2)} rad)`);
  assert.equal(windfall.struck, true, 'lightning strikes the felled tree');
  assert.equal(windfall.bondedAfter, 0, 'no junction still holds the felled tree');
  await page.evaluate((treeId) => {
    const game = window.mycelia.game;
    const view = game.surfaces.find((s) => s?.standId === game.match.activeStandId).trees.find((v) => v.tree.id === treeId);
    const at = view.group.getWorldPosition(view.group.position.clone());
    game.stage.rig.snapForest(at.x, at.z, 70);
    for (let i = 0; i < 3; i++) game.frame(game.lastFrame + 100, false);
    game.frame(game.lastFrame + 16, true);
  }, windfall.recorded.tree);
  await page.screenshot({ path: 'design/shots/storm-windfall.png', timeout: 60000 });

  // A strike at its brightest, lighting the vortex from inside.
  const lit = await page.evaluate((treeId) => {
    const game = window.mycelia.game;
    const view = game.surfaces.find((s) => s?.standId === game.match.activeStandId).trees.find((v) => v.tree.id === treeId);
    game.stormView.strike(game.stormView.group.worldToLocal(view.group.getWorldPosition(view.group.position.clone())));
    game.frame(game.lastFrame + 16, false);
    game.frame(game.lastFrame + 30, true);
    return { flash: game.stormView.flash, lightning: game.stage.lightning, strikes: game.stormView.report().strikes };
  }, windfall.recorded.tree);
  assert.ok(lit.flash > 0.3 && lit.lightning > 0.3, `the flash lights the stage (${lit.flash.toFixed(2)})`);
  await page.screenshot({ path: 'design/shots/storm-lightning.png', timeout: 60000 });

  const settled = await page.evaluate(() => {
    const game = window.mycelia.game;
    const m = game.match;
    m.step(m.stormRemaining + 0.01);
    const recovery = m.storm.phase;
    m.step(m.stormRemaining + 0.01);
    for (let i = 0; i < 40; i++) game.frame(game.lastFrame + 100, false);
    return { recovery, phase: m.storm.phase, report: game.renderReport().storm, watchHidden: document.querySelector('.storm-watch').hidden };
  });
  assert.equal(settled.recovery, 'recovery');
  assert.equal(settled.phase, 'idle');
  assert.equal(settled.report.draws, 0, 'the storm leaves nothing drawn when idle');
  assert.equal(settled.watchHidden, true);
  assert.deepEqual(problems, [], 'no browser errors');
  console.log(`PASS storm browser: picker preview (${bearing.n} tiles toward ${bearing.deg}°), locked direction, visible countdown, held warning bloom, ${active.lands.length} independent daughters, ${active.report.draws} storm draws / ${active.report.particles} particles, vortex, windfall toppled ${windfall.tilt.toFixed(2)} rad and struck, bond gone (${windfall.bondedBefore}→0), flash ${lit.flash.toFixed(2)} after ${lit.strikes} strikes, clean recovery. Synthetic late-game fixture, fast QA.`);
} finally {
  await browser?.close();
  server.stop();
}
