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
  await page.goto(withQaPreset(`${server.url}/?start=best&seed=raven-wood`, qa), { waitUntil: 'domcontentloaded' });
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
  const adjacentGrow = await page.evaluate((id) => {
    const game = window.mycelia.game;
    game.awaken();
    const body = game.match.spatialColonies.get(id);
    const root = body.nodePosition(body.colony.nodes[body.colony.rootId]);
    const family = game.section.sections.filter(spec => spec.standId === id && spec.axis === 'east-west');
    const current = family.reduce((best, spec) => Math.abs(spec.plane.fixed - root.y) < Math.abs(best.plane.fixed - root.y) ? spec : best);
    const index = family.findIndex(spec => spec.id === current.id);
    const next = family[index < family.length - 1 ? index + 1 : index - 1];
    game.openSection(id, next.id);
    game.stage.rig.setView('underground', true);
    game.frame(performance.now(), false);
    let target = null;
    for (const depth of [22, 26, 18, 30]) {
      for (const x of [root.x, root.x + 4, root.x - 4, root.x + 8, root.x - 8]) {
        const point = { x, y: next.plane.fixed, z: game.region.heightAt(x, next.plane.fixed) - depth };
        if (body.soil.passableAt(point.x, point.y, point.z)) { target = point; break; }
      }
      if (target) break;
    }
    if (!target) return { reason: 'no passable adjacent section point' };
    const scene = game.regionToScenePoint(target);
    scene.x += game.sectionView.group.position.x;
    scene.z += game.sectionView.group.position.z;
    const camera = game.stage.rig.camera;
    camera.updateMatrixWorld();
    const ndc = scene.project(camera);
    const rect = game.canvas.getBoundingClientRect();
    const x = rect.left + (ndc.x + 1) * rect.width / 2;
    const y = rect.top + (1 - ndc.y) * rect.height / 2;
    const resolved = game.sectionPointAt(x, y);
    game.ui.setActiveOrder('grow');
    game.applyOrderAt(x, y);
    return { section: game.section.spec.id, target, resolved,
      note: document.querySelector('#order-note').textContent,
      waypoint: body.colony.waypoints[0] };
  }, founded.landing.to);
  assert.ok(adjacentGrow.resolved, `the adjacent section is clickable: ${JSON.stringify(adjacentGrow)}`);
  assert.match(adjacentGrow.note, /Frontier directed/, 'Grow click orders the adjacent section');
  assert.ok(Math.abs(adjacentGrow.waypoint.lateral - adjacentGrow.resolved.y) < 1e-5,
    'the order uses the adjacent section’s regional coordinate');
  const acrossTileGrow = await page.evaluate((id) => {
    const game = window.mycelia.game;
    const body = game.match.spatialColonies.get(id);
    const spec = game.section.spec;
    const site = game.region.stands[id];
    const direction = site.sx < game.region.cols - 1 ? 1 : -1;
    const neighbour = id + direction;
    const seam = (site.sx + (direction > 0 ? 1 : 0)) * 136;
    let target = null;
    for (const depth of [22, 26, 18, 30]) {
      for (const distance of [6, 12, 20, 32]) {
        const x = seam + direction * distance;
        const point = { x, y: spec.plane.fixed, z: game.region.heightAt(x, spec.plane.fixed) - depth };
        if (body.soil.passableAt(point.x, point.y, point.z)) { target = point; break; }
      }
      if (target) break;
    }
    if (!target) return { reason: 'no passable neighbour soil' };
    const scene = game.regionToScenePoint(target);
    scene.x += game.sectionView.group.position.x;
    scene.z += game.sectionView.group.position.z;
    const camera = game.stage.rig.camera;
    camera.updateMatrixWorld();
    const ndc = scene.project(camera);
    const rect = game.canvas.getBoundingClientRect();
    const x = rect.left + (ndc.x + 1) * rect.width / 2;
    const y = rect.top + (1 - ndc.y) * rect.height / 2;
    const resolved = game.sectionPointAt(x, y);
    game.applyOrderAt(x, y);
    return { target, resolved, neighbour,
      note: document.querySelector('#order-note').textContent,
      waypoint: body.colony.waypoints[0] };
  }, founded.landing.to);
  assert.ok(acrossTileGrow.resolved, `neighbouring stand soil is clickable: ${JSON.stringify(acrossTileGrow)}`);
  assert.match(acrossTileGrow.note, new RegExp(`Frontier directed to stand ${acrossTileGrow.neighbour + 1}`),
    'Grow click across the stand seam targets the neighbouring stand');
  assert.ok(Math.abs(acrossTileGrow.waypoint.lateral - acrossTileGrow.resolved.y) < 1e-5,
    'the cross-stand order keeps the same section plane');
  const returnedToParent = await page.evaluate(() => {
    const game = window.mycelia.game;
    document.querySelector('#section-return').click();
    let now = Math.max(performance.now(), game.lastFrame);
    for (let i = 0; i < 36 && game.stage.rig.transitioning; i++) game.frame(now += 100, false);
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
  console.log(`PASS mature regional browser: nine-tile access, independent daughter, adjacent and cross-stand Grow clicks, controls, return to parent and 30s pacing (${managed.elapsedMs.toFixed(0)}ms)`);
} finally {
  await browser?.close();
  server.stop();
}
