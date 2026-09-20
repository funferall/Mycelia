/**
 * Bounded browser smoke for section browsing and the forest reveal.
 *
 * `test:sections` and `test:reveal` already fix the maths headlessly; this is
 * the part that needs a real renderer and real input: descend into the fixture's
 * own sections, flip and follow them, come back to the forest exactly where the
 * player left it, toggle the reveal, and click a projected strand.
 *
 *   npm run test:feature -- sections --browser
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { collectProblems, formatRenderReport, launchBrowser, parseQaPreset, withQaPreset } from './browser.mjs';
import { startPreview } from './preview.mjs';

const started = performance.now();
const qa = parseQaPreset();
const server = await startPreview(4192);
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = collectProblems(page);
  page.setDefaultTimeout(150000);

  await page.goto(withQaPreset(`${server.url}/?lab=crossing&seed=raven-wood`, qa), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.test-bench');
  await page.waitForFunction(() => window.mycelia.game?.crossingReport() !== null);
  await page.evaluate(() => window.mycelia.game.stop());
  await page.waitForTimeout(1500);

  let count = 0;
  function check(name, ok, detail = '') {
    assert(ok, `${name}${detail ? ` (${detail})` : ''}`);
    count++;
    console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
  }

  mkdirSync('design/shots', { recursive: true });
  async function capture(name) {
    const data = await page.evaluate(() => {
      const stage = window.mycelia.game.stage;
      stage.render(0);
      return stage.renderer.domElement.toDataURL();
    });
    writeFileSync(`design/shots/${name}-${qa}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }

  const report = await page.evaluate(() => window.mycelia.game.renderReport());
  console.log(formatRenderReport(report));
  const opening = await page.evaluate(() => {
    const game = window.mycelia.game;
    const rig = game.stage.rig;
    return {
      crossing: game.crossingReport(),
      section: game.sectionReport(),
      reveal: game.revealReport(),
      // Where the forest is before anything descends: the pose the player
      // must come back to.
      forestPose: { distance: rig.distance, azimuth: rig.azimuth, elevation: rig.elevation, x: rig.target.x, z: rig.target.z },
      tree: document.querySelector('#forest-tree')?.value ?? '',
    };
  });
  console.log(`Fixture: ${opening.crossing[1]}`);
  check('the fixture opens with a colony that spans a stand boundary', /stands held: \d+ \(/.test(opening.crossing[2]));
  check('the Network control is a real, unpressed forest control', await page.evaluate(() => {
    const button = document.querySelector('#forest-reveal');
    return Boolean(button) && !button.hidden && button.getAttribute('aria-pressed') === 'false';
  }));

  // --- sections ------------------------------------------------------------
  const descended = await page.evaluate(() => {
    const game = window.mycelia.game;
    const before = game.sectionReport();
    const opened = game.openFirstSection();
    const after = game.sectionReport();
    game.frame(performance.now(), false);
    return { before, opened, after, view: game.stage.rig.view, blend: game.stage.rig.surfaceBlend };
  });
  check('descent opens a real section with strands and continuation marks', descended.opened.ok && descended.after.open && descended.after.strands > 0, descended.after.label);
  check('the section is a view below the surface', descended.view === 'underground' && descended.blend < 0.05, `${descended.view} blend ${descended.blend}`);
  check(
    'the readout names the stand, the community, the orientation and the position',
    /Stand \d+/.test(descended.after.label) && /(across|up) the slope/.test(descended.after.label) && /\d+ of \d+/.test(descended.after.label),
    descended.after.label
  );
  check('the section holds a strand the projection also knows', await page.evaluate((edge) => {
    const check = window.mycelia.game.strandCheck(edge);
    return Boolean(check.section) && Boolean(check.projected) && check.depthCm > 0;
  }, descended.after.edge));
  await capture('sections-open');

  const moved = await page.evaluate(() => {
    const game = window.mycelia.game;
    const first = game.sectionReport();
    const next = game.stepSection(1);
    const second = game.sectionReport();
    const back = game.stepSection(-1);
    const again = game.sectionReport();
    const flipped = game.flipSectionAxis();
    const flip = game.sectionReport();
    return { first, next, second, back, again, flipped, flip };
  });
  check('next and previous move along the family and come back', moved.next.ok && moved.back.ok && moved.again.id === moved.first.id);
  check(
    'an adjacent section with no network in it says so instead of inventing strands',
    moved.second.strands === 0 && /no network in this section/.test(moved.second.label),
    moved.second.label
  );
  check('flipping keeps the stand and changes the orientation', moved.flipped.ok && moved.flip.open && moved.flip.label !== moved.second.label, moved.flip.label);

  const followed = await page.evaluate(() => {
    const game = window.mycelia.game;
    const before = game.sectionReport();
    const result = game.followConnection();
    const after = game.sectionReport();
    return { before, result, after };
  });
  check('following a strand moves to the section that holds its far end', followed.result.ok && followed.after.open && followed.after.label !== followed.before.label, followed.after.label);

  // --- return to the forest ------------------------------------------------
  const returned = await page.evaluate(() => {
    const game = window.mycelia.game;
    const rig = game.stage.rig;
    const result = game.returnToForest();
    game.frame(performance.now(), false);
    return {
      result,
      after: { distance: rig.distance, azimuth: rig.azimuth, elevation: rig.elevation },
      view: rig.view,
      treeAfter: document.querySelector('#forest-tree')?.value ?? '',
    };
  });
  check(
    'returning to the forest restores the same pose and view',
    returned.result.ok && returned.view === 'forest' &&
      Math.abs(returned.after.distance - opening.forestPose.distance) < 1e-6 &&
      Math.abs(returned.after.azimuth - opening.forestPose.azimuth) < 1e-6 &&
      Math.abs(returned.after.elevation - opening.forestPose.elevation) < 1e-6,
    `${opening.forestPose.distance.toFixed(2)} -> ${returned.after.distance.toFixed(2)}`
  );
  check('the forest selection comes back with the picture', returned.treeAfter === opening.tree, `${opening.tree} -> ${returned.treeAfter}`);

  // --- the reveal ----------------------------------------------------------
  const revealed = await page.evaluate(() => {
    const game = window.mycelia.game;
    const before = game.crossingReport();
    const on = game.toggleReveal();
    game.frame(performance.now(), false);
    const after = game.crossingReport();
    const report = game.revealReport();
    return { on, draws: report.draws, strands: report.strands, slice: report.slice, unchanged: before.join('|') === after.join('|') };
  });
  check('the Network toggle draws the projection and reports its strands', revealed.on && revealed.draws > 0 && revealed.strands > 0, `${revealed.strands} strands, ${revealed.draws} draws`);
  check('revealing changes nothing about the colony', revealed.unchanged);
  check('the slice marker remembers the last section inspected', revealed.slice !== null, String(revealed.slice));
  await capture('reveal-forest');

  const clicked = await page.evaluate(() => {
    const game = window.mycelia.game;
    const camera = game.stage.rig.camera;
    camera.updateMatrixWorld();
    const rect = document.querySelector('#gl').getBoundingClientRect();
    // Aim at a strand the click can actually own. A crown in the way is not a
    // bug - a visible tree wins the click by design - so the check looks for a
    // strand whose midpoint is not under one.
    let aimed = null;
    for (let index = 0; index < 60 && !aimed; index++) {
      const key = game.reveal.strandFor
        ? (game.reveal.strandFor(`player@raven-wood:${index}-${index + 1}`) ?? null)
        : null;
      if (!key) continue;
      const middle = key.points[Math.floor(key.points.length / 2)];
      const scene = game.regionToScenePoint(middle);
      scene.x += game.reveal.group.position.x;
      scene.z += game.reveal.group.position.z;
      const ndc = scene.clone().project(camera);
      if (ndc.z > 1) continue;
      const clientX = rect.left + ((ndc.x + 1) / 2) * rect.width;
      const clientY = rect.top + ((1 - ndc.y) / 2) * rect.height;
      const element = document.elementFromPoint(clientX, clientY);
      if (!element || element.tagName !== 'CANVAS') continue;
      if (game.pickCrown(clientX, clientY)) continue;
      aimed = { key, clientX, clientY, element };
      break;
    }
    if (!aimed) return { ok: false, reason: 'no strand was free of a crown' };
    aimed.element.dispatchEvent(new PointerEvent('pointerdown', { clientX: aimed.clientX, clientY: aimed.clientY, bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
    aimed.element.dispatchEvent(new PointerEvent('pointerup', { clientX: aimed.clientX, clientY: aimed.clientY, bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
    game.frame(performance.now(), false);
    const picked = game.revealReport().pick;
    return {
      ok: true,
      key: aimed.key.key,
      pick: picked,
      section: game.sectionReport(),
      // Whatever the click actually resolved to: the section it opened must be
      // the one through the picked strand's own far end.
      strandCheck: game.strandCheck(picked?.key ?? aimed.key.key),
    };
  });
  check(
    'clicking a projected strand selects it and opens its section',
    Boolean(clicked.ok && clicked.pick) &&
      clicked.section.open &&
      clicked.section.edge === clicked.pick.key,
    clicked.ok ? clicked.key : String(clicked.reason)
  );
  check('the picked strand carries its real depth', Boolean(clicked.pick) && clicked.pick.depthCm > 0, clicked.pick ? `${clicked.pick.depthCm.toFixed(1)}cm` : '');
  check(
    'the projection and the section are the same edge in the same place',
    Boolean(clicked.strandCheck?.projected) && Boolean(clicked.strandCheck?.section) &&
      Math.abs(clicked.strandCheck.projected[0].x - clicked.strandCheck.section.from.x) < 1e-6 &&
      Math.abs(clicked.strandCheck.projected[0].y - clicked.strandCheck.section.from.y) < 1e-6
  );
  await capture('sections-from-reveal');

  const treeWins = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.returnToForest();
    game.frame(performance.now(), false);
    const surface = game.regionSurfaces[game.match.activeStandId];
    const pick = surface.pickTargets.find((mesh) => mesh.userData.treeId !== undefined);
    if (!pick) return { ok: false, reason: 'no crown proxy' };
    // Look at that crown closely first: at the region overview a crown is a few
    // pixels wide and a click test would prove nothing either way.
    // `pick.position` is already in its parent's frame, so ask the object for
    // its world position rather than transforming the offset twice.
    const centred = pick.getWorldPosition(pick.position.clone());
    game.stage.rig.snapForest(centred.x, centred.z, 150);
    game.frame(performance.now(), false);
    // No draw call has run since the snap, so the scene graph's world matrices
    // have to be refreshed before projecting anything.
    game.stage.scene.updateMatrixWorld(true);
    const camera = game.stage.rig.camera;
    camera.updateMatrixWorld();
    const world = pick.getWorldPosition(pick.position.clone());
    const ndc = world.clone().project(camera);
    if (ndc.z > 1) return { ok: false, reason: 'the crown is behind the camera' };
    const rect = document.querySelector('#gl').getBoundingClientRect();
    const clientX = rect.left + ((ndc.x + 1) / 2) * rect.width;
    const clientY = rect.top + ((1 - ndc.y) / 2) * rect.height;
    // Dispatched on the canvas deliberately: a root label may sit over the
    // crown, and a click on a label is an order, not a selection. This checks
    // the picking order itself - crown before strand before ground.
    const element = document.querySelector('#gl');
    if (!element) return { ok: false, reason: 'no canvas' };
    const treesBefore = game.renderReport().trees;
    const expected = `${game.match.activeStandId}:${pick.userData.treeId}`;
    element.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
    element.dispatchEvent(new PointerEvent('pointerup', { clientX, clientY, bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
    game.frame(performance.now(), false);
    const report = game.renderReport();
    return {
      ok: true,
      trees: report.trees,
      unchanged: treesBefore === report.trees,
      selected: report.selectedTreeId === null ? null : `${report.selectedStandId}:${report.selectedTreeId}`,
      expected,
    };
  });
  check(
    'a crown click still selects a tree while the reveal is on',
    Boolean(treeWins.ok) && treeWins.unchanged && treeWins.selected === treeWins.expected,
    treeWins.ok ? `tree ${treeWins.selected} (expected ${treeWins.expected})` : String(treeWins.reason)
  );

  const off = await page.evaluate(() => {
    const game = window.mycelia.game;
    const picksBefore = game.regionSurfaces.map((surface) => surface.pickTargets.length);
    const treesBefore = game.renderReport().trees;
    game.setReveal(false);
    game.frame(performance.now(), false);
    const picksAfter = game.regionSurfaces.map((surface) => surface.pickTargets.length);
    return {
      enabled: game.revealReport().enabled,
      draws: game.revealReport().draws,
      sameTargets: picksBefore.join(',') === picksAfter.join(','),
      sameTrees: treesBefore === game.renderReport().trees,
      pressed: document.querySelector('#forest-reveal')?.getAttribute('aria-pressed'),
    };
  });
  check(
    'turning the reveal off leaves the forest exactly as it was',
    !off.enabled && off.draws === 0 && off.sameTargets && off.sameTrees && off.pressed === 'false'
  );

  assert.deepEqual(problems, [], 'no browser errors or shader compiler errors');
  console.log(`PASS: ${count} checks, no browser errors, ${((performance.now() - started) / 1000).toFixed(1)}s.`);
} finally {
  await browser?.close();
  server.stop();
}
