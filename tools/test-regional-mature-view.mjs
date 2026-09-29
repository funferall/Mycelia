/** Bounded browser check for a mature match with an independent spore daughter. */
import assert from 'node:assert/strict';
import { collectProblems, formatRenderReport, launchBrowser, parseQaPreset, withQaPreset } from './browser.mjs';
import { startPreview } from './preview.mjs';

const qa = parseQaPreset();
const server = await startPreview(4195);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(120000);
  await page.goto(withQaPreset(`${server.url}/?seed=raven-wood`, qa), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());

  const emptyId = await page.evaluate(() => {
    const game = window.mycelia.game;
    const empty = game.match.stands.find((stand) => !stand.sim.hasColony);
    const select = document.querySelector('#forest-stand');
    select.value = String(empty.site.id);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#descend-tree').click();
    return { id: empty.site.id, section: game.sectionReport(), standId: game.section?.spec.standId, view: game.stage.rig.view };
  });
  assert.equal(emptyId.section.open, true, 'an uncolonized tile opens underground');
  assert.equal(emptyId.standId, emptyId.id);
  assert.equal(emptyId.section.strands, 0, 'uncolonized soil invents no network');
  await page.evaluate(() => document.querySelector('#section-return').click());

  const founded = await page.evaluate(() => {
    const game = window.mycelia.game;
    const parent = game.match.active.sim.player;
    const root = parent.nodes[parent.rootId];
    root.carbon = 300;
    root.water = 12;
    root.nitrogen = 8;
    parent.carbon = 300;
    parent.water = 12;
    parent.nitrogen = 8;
    parent.fruited++;
    game.match.step(1 / 60);
    game.match.releaseSpores(game.match.activeStandId);
    for (let i = 0; i < 120 && game.match.colonization.length === 0; i++) game.match.step(1 / 60);
    const landing = game.match.colonization[0];
    if (!landing) return null;
    const body = game.match.spatialColonies.get(landing.to);
    return {
      landing,
      distinct: body?.colony !== parent,
      sharedSoil: body?.soil === game.match.soil,
      sameLiveDaughter: body?.colony === game.match.stands[landing.to].sim.player,
      initialEdges: body?.colonyEdges().length ?? -1,
      bodyCount: game.match.spatialColonies.size,
    };
  });
  assert.ok(founded, 'a paid spore lands in the mature match');
  assert.equal(founded.distinct, true);
  assert.equal(founded.sharedSoil, true);
  assert.equal(founded.sameLiveDaughter, true);
  assert.equal(founded.bodyCount, 1);

  const opened = await page.evaluate((id) => {
    const game = window.mycelia.game;
    const select = document.querySelector('#forest-stand');
    select.value = String(id);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#descend-tree').click();
    return {
      activeStand: game.match.activeStandId,
      section: game.sectionReport(),
      standId: game.section?.spec.standId,
      activeBody: game.spatial === game.match.spatialColonies.get(id),
      selected: document.querySelector('#section-stand').value,
    };
  }, founded.landing.to);
  assert.equal(opened.activeStand, founded.landing.to, 'controls rebind to the daughter stand');
  assert.equal(opened.standId, founded.landing.to);
  assert.equal(opened.activeBody, true, 'section orders address the daughter graph');
  assert.equal(opened.selected, String(founded.landing.to));

  const managed = await page.evaluate((id) => {
    const game = window.mycelia.game;
    const body = game.match.spatialColonies.get(id);
    const parent = game.match.stands[game.region.foundingStand].sim.player;
    const before = parent.waypoints.length;
    document.querySelector('#section-root').click();
    const note = document.querySelector('#order-note').textContent;
    const order = body.orderAcross();
    const started = performance.now();
    for (let i = 0; i < 30 * 60; i++) game.match.step(1 / 60);
    const elapsedMs = performance.now() - started;
    game.refreshSpatialViews();
    const target = game.match.stands.find((stand) => !stand.sim.hasColony && stand.site.id !== id)?.site.id;
    const select = document.querySelector('#section-stand');
    select.value = String(target);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const remote = { ...game.sectionReport(), standId: game.section?.spec.standId };
    select.value = String(id);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      note,
      order,
      elapsedMs,
      daughterEdges: body.colonyEdges().length,
      parentUnchanged: parent.waypoints.length === before,
      remote,
      returned: { ...game.sectionReport(), standId: game.section?.spec.standId },
      report: game.renderReport(),
    };
  }, founded.landing.to);
  console.log(formatRenderReport(managed.report));
  assert.match(managed.note, /root|Frontier|strand/i, 'the daughter accepts a root control');
  assert.equal(managed.order.ok, true, 'the daughter can take a crossing order');
  assert.equal(managed.parentUnchanged, true, 'daughter orders do not steer the parent');
  assert.ok(managed.daughterEdges > founded.initialEdges, 'the daughter grows its own strands');
  assert.equal(managed.remote.open, true);
  assert.notEqual(managed.remote.standId, founded.landing.to, 'the selector opens another tile');
  assert.equal(managed.returned.standId, founded.landing.to, 'the selector returns to the daughter');
  assert.ok(managed.elapsedMs < 30000, `30s of mature simulation took ${managed.elapsedMs.toFixed(0)}ms`);
  const returnedToParent = await page.evaluate(() => {
    const game = window.mycelia.game;
    document.querySelector('#section-return').click();
    const origin = game.region.foundingStand;
    const select = document.querySelector('#forest-stand');
    select.value = String(origin);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#descend-tree').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
    return {
      activeStand: game.match.activeStandId,
      origin,
      section: game.section,
      localSim: game.sim === game.match.stands[origin].sim,
      sectionControlsHidden: document.querySelector('#section-browser').hidden,
      view: game.stage.rig.view,
    };
  });
  assert.equal(returnedToParent.activeStand, returnedToParent.origin, 'founding controls rebind after viewing the daughter');
  assert.equal(returnedToParent.section, null, 'the original colony uses its local underground view');
  assert.equal(returnedToParent.localSim, true);
  assert.equal(returnedToParent.sectionControlsHidden, true);
  assert.equal(returnedToParent.view, 'underground');
  assert.deepEqual(problems, [], 'no browser errors');
  console.log(`PASS mature regional browser: nine-tile access, independent daughter, controls, return to parent and 30s pacing (${managed.elapsedMs.toFixed(0)}ms)`);
} finally {
  await browser?.close();
  server.stop();
}
