// Regional navigation fixture: founding a second colony exercises UI binding,
// not the fruiting economy (covered separately by test-region and test:journey).
import assert from 'node:assert/strict';
import { launchBrowser, collectProblems, withQaPreset, parseQaPreset, formatRenderReport, readRenderReport } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4175);
const browser = await launchBrowser();
let checks = 0;
const check = (name, condition) => { assert.ok(condition, name); console.log(`PASS ${name}`); checks++; };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, reducedMotion: 'reduce' });
  const problems = collectProblems(page);
  await page.goto(withQaPreset(server.url + '/?seed=raven-wood', parseQaPreset()), { waitUntil: 'commit' });
  await page.waitForFunction(() => window.mycelia?.game.assets.ready);
  await page.evaluate(() => window.mycelia.game.stop());
  console.log(formatRenderReport(await readRenderReport(page)));
  const fixture = await page.evaluate(() => {
    const g = window.mycelia.game;
    const home = g.match.activeStandId;
    const away = g.match.stands.at(-1).site.id === home ? 0 : g.match.stands.at(-1).site.id;
    // Explicit fixture; the navigation never creates or funds a colony.
    g.match.stands[away].sim.foundColony({ carbon: 46, water: 6, nitrogen: 3 });
    g.refreshStandOptions();
    return { home, away, empty: g.match.stands.find(s => !s.sim.hasColony).site.id };
  });
  const paint = () => page.evaluate(() => { const g = window.mycelia.game; g.frame(g.lastFrame + 250); });
  const select = async id => {
    await page.selectOption('#forest-stand', String(id));
    await paint();
  };
  await select(fixture.empty);
  check('uncolonized stands explain why descent is unavailable', await page.locator('#descend-tree').isDisabled());
  await page.click('#view-underground');
  check('view button cannot enter uncolonized ground', await page.evaluate(() => window.mycelia.game.stage.rig.view === 'forest'));
  await select(fixture.away);
  await page.click('#descend-tree');
  await paint();
  check('stand selector enters the daughter simulation and all local views', await page.evaluate(id => {
    const g = window.mycelia.game;
    return g.match.activeStandId === id && g.sim === g.match.stands[id].sim && g.soil.world === g.sim.world && g.forest.world === g.sim.world && g.surface.world === g.sim.world;
  }, fixture.away));
  check('catalogue shows daughter reserves, not founding reserves', await page.evaluate(() => {
    const g = window.mycelia.game;
    return document.querySelector('#record dd[data-value="46"]') !== null && g.sim.player.carbon === 46;
  }));
  await page.click('#begin');
  await page.click('.speed-row button[data-speed="0"]');
  await page.click('#rest');
  check('orders affect only the active colony', await page.evaluate(({ home, away }) => {
    const g = window.mycelia.game;
    return g.match.stands[away].sim.player.resting && !g.match.stands[home].sim.player.resting;
  }, fixture));
  await page.click('#view-forest');
  await paint();
  const crown = await page.evaluate(home => `${home}:${window.mycelia.game.match.stands[home].sim.world.trees[0].id}`, fixture.home);
  await page.selectOption('#forest-tree', crown);
  await paint();
  await page.click('#descend-tree');
  await paint();
  check('a crown returns to its own stand and root', await page.evaluate(home => {
    const g = window.mycelia.game;
    const root = g.sim.world.trees[0].rootTips;
    return g.match.activeStandId === home && root.some(r => Math.hypot(g.stage.rig.target.x - 8 - (r.gx - 68), g.stage.rig.target.y - (56 - r.gy)) < 0.001);
  }, fixture.home));
  const before = await page.evaluate(away => window.mycelia.game.match.stands[away].sim.time, fixture.away);
  await page.evaluate(() => window.mycelia.game.warmUp(2));
  check('daughter colony advances while another stand is viewed', await page.evaluate(({ away, before }) => window.mycelia.game.match.stands[away].sim.time > before + 1.9, { away: fixture.away, before }));
  const sceneCount = await page.evaluate(() => {
    const g = window.mycelia.game;
    window.oldLocalGroups = [g.soil.group, g.forest.group, g.living.group];
    window.disposedSoil = false;
    g.soil.mesh.geometry.addEventListener('dispose', () => { window.disposedSoil = true; });
    return g.stage.scene.children.length;
  });
  for (let i = 0; i < 3; i++) {
    await page.click('#view-forest');
    await paint();
    await select(i % 2 === 0 ? fixture.away : fixture.home);
    await page.click('#descend-tree');
    await paint();
  }
  check('re-entry preserves daughter orders and uses its real network', await page.evaluate(away => {
    const g = window.mycelia.game;
    return g.match.activeStandId === away && g.sim.player.resting && g.playerMesh.mesh.count <= g.sim.player.nodes.length;
  }, fixture.away));
  check('repeated travel releases previous local views and soil GPU geometry', await page.evaluate(count => {
    const g = window.mycelia.game;
    return g.stage.scene.children.length === count && window.oldLocalGroups.every(group => group.parent === null) && window.disposedSoil;
  }, sceneCount));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const animate = () => page.evaluate(() => {
    const g = window.mycelia.game;
    for (let i = 0; i < 8; i++) g.frame(g.lastFrame + 250, false);
    g.frame(g.lastFrame + 16);
  });
  await page.click('#view-forest');
  await animate();
  await select(fixture.home);
  await page.click('#descend-tree');
  check('normal-motion cross-stand descent starts a timed crossing', await page.evaluate(() => window.mycelia.game.viewReport().crossing));
  await animate();
  await page.click('#view-forest');
  await animate();
  await select(fixture.away);
  await animate();
  const pan = await page.evaluate(() => {
    const g = window.mycelia.game, rig = g.stage.rig;
    const before = rig.goal.target.clone();
    rig.pan(1, 0);
    return rig.goal.target.distanceTo(before);
  });
  check('panning an outer stand does not clamp back to the founding stand', pan < 1.01 && pan > 0.99);
  await page.evaluate(() => {
    const rig = window.mycelia.game.stage.rig;
    rig.goal.distance = 106;
  });
  await page.locator('#gl').focus();
  await page.keyboard.press('+');
  await animate();
  check('keyboard zoom enters the selected daughter stand', await page.evaluate(away => {
    const g = window.mycelia.game;
    return g.match.activeStandId === away && g.viewReport().view === 'underground' && !g.viewReport().crossing;
  }, fixture.away));
  await page.click('#view-forest');
  await animate();
  check('batched tree IDs survive travel and authored tier swaps', await page.evaluate(() => {
    const r = window.mycelia.game.renderReport();
    return r.batching.trees === r.lodDressed && r.batching.identities.length === r.lodDressed && r.batching.draws < r.batching.parts;
  }));
  await page.screenshot({ path: 'design/shots/regional-navigation.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await animate();
  check('stand controls remain within the portrait viewport', await page.evaluate(() => ['#forest-stand', '#forest-tree', '#descend-tree'].every(id => {
    const r = document.querySelector(id).getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  })));
  await page.screenshot({ path: 'design/shots/regional-navigation-portrait.png' });
  assert.deepEqual(problems, []);
  console.log(`${checks} navigation checks passed; no browser errors.`);
} finally {
  await browser.close();
  server.stop();
}
