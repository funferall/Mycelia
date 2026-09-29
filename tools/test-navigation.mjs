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
  await page.goto(withQaPreset(server.url + '/?start=best&seed=raven-wood', parseQaPreset()), { waitUntil: 'commit' });
  await page.waitForFunction(() => window.mycelia?.game.assets.ready);
  await page.evaluate(() => window.mycelia.game.stop());
  console.log(formatRenderReport(await readRenderReport(page)));
  const fixture = await page.evaluate(() => {
    const g = window.mycelia.game;
    const home = g.match.activeStandId;
    const away = g.match.stands.at(-1).site.id === home ? 0 : g.match.stands.at(-1).site.id;
    // Explicit fixture; the navigation never creates or funds a colony.
    g.match.stands[away].sim.foundColony({ carbon: 46, water: 6, nitrogen: 3 });
    // Record the arrival the way a wind-borne spore would, so the survey can
    // trace the lineage rather than seeing an orphaned colony.
    g.match.stands[away].arrivals.push({ at: g.match.time, from: home, spores: 46 });
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

  // The regional survey: a printed ledger of the whole region, and a way to
  // choose a stand without the selector above.
  await page.click('#survey-open');
  await page.evaluate(() => { const g = window.mycelia.game; g.frame(g.lastFrame + 250, false); });
  const ledger = await page.evaluate(({ home, away, empty }) => {
    const rows = [...document.querySelectorAll('#survey-list .survey-row')];
    const read = (id) => {
      const row = rows.find((entry) => entry.dataset.stand === String(id));
      return row ? {
        community: row.querySelector('.survey-community').textContent,
        state: row.querySelector('.survey-state').textContent,
        fields: row.querySelector('.survey-fields').textContent,
        pressed: row.getAttribute('aria-pressed'),
      } : null;
    };
    return {
      open: !document.querySelector('#survey').hidden,
      pressed: document.querySelector('#survey-open').getAttribute('aria-pressed'),
      rows: rows.length,
      summary: document.querySelector('#survey-summary').textContent,
      home: read(home),
      away: read(away),
      empty: read(empty),
      report: window.mycelia.game.renderReport().survey,
    };
  }, fixture);
  check('the survey opens as a ledger with one line per stand', ledger.open && ledger.rows === 9 && ledger.pressed === 'true', `${ledger.rows} rows`);
  check(
    'the survey summarises the holds, the lineage and the continuity',
    /2 of 9 stands held/.test(ledger.summary) && /lineage \d+ → \d+/.test(ledger.summary) && /every colony connected/.test(ledger.summary),
    ledger.summary
  );
  check('a held stand prints its colony state and its parent stand', ledger.away?.state !== 'uncolonized' && /from stand/.test(ledger.away?.fields ?? ''), JSON.stringify(ledger.away));
  check('a surveyed stand prints a forest health band and a tree count', /forest (sound|strained|declining)/.test(ledger.home?.fields ?? '') && /of \d+ trees standing/.test(ledger.home?.fields ?? ''), JSON.stringify(ledger.home));
  check('ground nobody has held is printed as unsurveyed, not guessed at', ledger.empty?.state === 'uncolonized' && /not surveyed beneath/.test(ledger.empty?.fields ?? ''), JSON.stringify(ledger.empty));
  check('the survey agrees with the match about what is held', ledger.report.held === 2 && ledger.report.contiguous === true, JSON.stringify(ledger.report));
  await page.screenshot({ path: 'design/shots/regional-survey.png' });

  await page.click(`#survey-list .survey-row[data-stand="${fixture.empty}"]`);
  await page.evaluate(() => { const g = window.mycelia.game; g.frame(g.lastFrame + 250, false); });
  const chosen = await page.evaluate(() => ({
    value: document.querySelector('#forest-stand').value,
    selected: window.mycelia.game.renderReport().survey.selected,
    pressed: document.querySelector('#survey-list .survey-row[aria-pressed="true"]')?.dataset.stand ?? null,
  }));
  check(
    'choosing a line selects that stand and marks it in the ledger',
    chosen.value === String(fixture.empty) && chosen.selected === fixture.empty && chosen.pressed === String(fixture.empty),
    JSON.stringify(chosen)
  );
  await page.keyboard.press('Escape');
  check('Escape closes the survey', await page.evaluate(() => document.querySelector('#survey').hidden === true));

  await page.screenshot({ path: 'design/shots/regional-navigation.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await animate();
  check('stand controls remain within the portrait viewport', await page.evaluate(() => ['#forest-stand', '#forest-tree', '#descend-tree'].every(id => {
    const r = document.querySelector(id).getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  })));
  await page.click('#survey-open');
  await page.evaluate(() => { const g = window.mycelia.game; g.frame(g.lastFrame + 250, false); });
  check('the survey page stays on screen at a portrait size', await page.evaluate(() => {
    const r = document.querySelector('#survey').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  }));
  await page.screenshot({ path: 'design/shots/regional-survey-portrait.png' });
  await page.screenshot({ path: 'design/shots/regional-navigation-portrait.png' });
  assert.deepEqual(problems, []);
  console.log(`${checks} navigation checks passed; no browser errors.`);
} finally {
  await browser.close();
  server.stop();
}
