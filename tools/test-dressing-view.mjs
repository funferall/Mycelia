/**
 * Bounded browser smoke for the forest's background vegetation (`ASSET-04`).
 *
 * Headless checks already fix the placement; this is the part that needs a real
 * renderer and real input: that the scenery is drawn, that it is not pickable,
 * that turning it off changes nothing the player can act on, and what it costs
 * in draw calls at a stated preset and backend.
 *
 *   npm run test:feature -- dressing --browser
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { collectProblems, formatRenderReport, launchBrowser, parseQaPreset, withQaPreset } from './browser.mjs';
import { startPreview } from './preview.mjs';

const started = performance.now();
const qa = parseQaPreset();
const server = await startPreview(4188);
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = collectProblems(page);
  page.setDefaultTimeout(120000);

  await page.goto(withQaPreset(`${server.url}/?lab=forest&seed=raven-wood`, qa), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.test-bench');
  await page.waitForFunction(() => window.mycelia.game.renderReport().assets.ready);
  // Let the dressing build from the art that has arrived.
  await page.evaluate(() => window.mycelia.game.stop());
  // Scenery waits for the tier it asked for rather than borrowing a finer one,
  // so the check waits for the dressing to settle before reading its cost.
  await page.waitForFunction(() => {
    const dressing = window.mycelia.game.renderReport().dressing;
    return dressing.planted > 0 && dressing.settled;
  });
  await page.evaluate(() => window.mycelia.game.frame(performance.now(), false));

  let count = 0;
  function check(name, ok) {
    assert(ok, name);
    count++;
    console.log(`PASS ${name}`);
  }

  const report = await page.evaluate(() => window.mycelia.game.renderReport());
  console.log(formatRenderReport(report));
  console.log(`Dressing at the default band: ${JSON.stringify(report.dressing)}`);
  mkdirSync('design/shots', { recursive: true });
  async function capture(name) {
    const data = await page.evaluate(() => {
      const stage = window.mycelia.game.stage;
      stage.render(0);
      return stage.renderer.domElement.toDataURL();
    });
    writeFileSync(`design/shots/${name}-${qa}.png`, Buffer.from(data.split(',')[1], 'base64'));
    return data;
  }
  await capture('dressing-region');
  check(
    'the region opens with dressed background vegetation',
    report.dressing.decorations > 0 && report.dressing.planted > 0 && report.dressing.stands === 9
  );
  check('background trees start coarse', report.dressing.tier === 2);
  check(
    'all vegetation and ground layers are drawn',
    report.dressing.planted === report.dressing.decorations
  );

  // The scenery must not be part of picking: the pick target list is the same
  // length with dressing on as with it off, and a click in the forest can only
  // ever select a tree the selector also lists.
  const selection = await page.evaluate(() => {
    const game = window.mycelia.game;
    const optionKeys = [...document.querySelectorAll('#forest-tree option')].map((option) => option.value);
    const before = game.regionSurfaces.map((surface) => surface.pickTargets.length);
    game.setLabDressing(false);
    game.frame(performance.now(), false);
    const off = game.renderReport();
    game.setLabDressing(true);
    game.frame(performance.now(), false);
    const after = game.regionSurfaces.map((surface) => surface.pickTargets.length);
    return { optionKeys, before, after, off: off.dressing, on: game.renderReport().dressing };
  });
  check('turning the scenery off removes no pick target', selection.after.join(',') === selection.before.join(','));
  check('turning the scenery off keeps the playable population', selection.on.decorations === selection.off.decorations);
  check('turning the scenery off hides it', selection.off.visible === false && selection.on.visible === true);

  // Clicking a patch of dressed ground selects nothing fake: whatever comes
  // back is either nothing or a tree the selector itself offers.
  const canvas = await page.locator('#gl').boundingBox();
  const click = await page.evaluate(async () => {
    const game = window.mycelia.game;
    const rect = document.querySelector('#gl').getBoundingClientRect();
    const points = [
      [rect.left + rect.width * 0.3, rect.top + rect.height * 0.62],
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.7],
      [rect.left + rect.width * 0.7, rect.top + rect.height * 0.62],
      [rect.left + rect.width * 0.42, rect.top + rect.height * 0.55],
    ];
    const selected = [];
    for (const [x, y] of points) {
      const element = document.elementFromPoint(x, y);
      if (!element) continue;
      element.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
      element.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
      game.frame(performance.now(), false);
      const report = game.renderReport();
      selected.push(report.selectedTreeId === null ? null : `${report.selectedStandId}:${report.selectedTreeId}`);
    }
    return selected;
  });
  void canvas;
  const optionKeys = new Set(selection.optionKeys);
  check(
    'clicking among the scenery selects a real, listed playable tree',
    // Some of the four points are sky or sheet, but a click that lands in the
    // forest has to resolve to a tree the selector itself offers - and at least
    // one of them must actually select something, or the check proves nothing.
    click.every((key) => key === null || optionKeys.has(key)) && click.some((key) => key !== null),
    `selected ${JSON.stringify(click)}`
  );

  // The single-community fixture: isolate one stand's dressing and confirm the
  // rest is untouched rather than rebuilt.
  const focus = await page.evaluate(() => {
    const game = window.mycelia.game;
    const communities = game.labCommunities();
    const target = game.focusLabCommunity(communities[0]?.id ?? null);
    game.frame(performance.now(), false);
    const report = game.renderReport();
    game.focusLabCommunity(null);
    game.frame(performance.now(), false);
    return { target, report, all: game.renderReport().dressing };
  });
  check('one community can be isolated in the fixture', focus.target.ok && focus.report.dressing.focus === focus.target.standId);
  check('isolating a community leaves the rest of the region intact', focus.all.planted > focus.report.dressing.planted);
  check('the isolation shows one stand at a time', focus.report.dressing.stands === 1);
  await capture('dressing-community');

  // A denser band plants more, and the draw cost is the batches it needs, not
  // one draw call per decoration.
  const bands = await page.evaluate(() => {
    const game = window.mycelia.game;
    const measure = () => {
      game.frame(performance.now(), false);
      const report = game.renderReport().dressing;
      return { decorations: report.decorations, planted: report.planted, draws: report.draws, triangles: report.triangles };
    };
    game.setLabDressingBand('sparse');
    const sparse = measure();
    game.setLabDressingBand('dense');
    const dense = measure();
    game.setLabDressingBand('sparse');
    return { sparse, dense };
  });
  console.log(`Dressing draw cost: ${JSON.stringify(bands)}`);
  check('a denser band plants more and stays batched', bands.dense.planted > bands.sparse.planted && bands.dense.draws < bands.dense.planted / 4);

  // Draw calls actually made, with the scenery on and off, at this preset.
  const calls = await page.evaluate(() => {
    const game = window.mycelia.game;
    const renderer = game.stage.renderer;
    renderer.info.autoReset = false;
    const draw = () => {
      renderer.info.reset();
      game.stage.render(0);
      return renderer.info.render.calls;
    };
    game.setLabDressing(true);
    game.frame(performance.now(), false);
    const dressed = draw();
    game.dressing.group.visible = false;
    const bare = draw();
    game.dressing.group.visible = true;
    renderer.info.autoReset = true;
    return { dressed, bare, added: dressed - bare };
  });
  console.log(`Dressing draw calls at ${qa}: ${JSON.stringify(calls)}`);
  check(
    'the scenery costs batches per tier and asset, not a draw call per decoration',
    calls.added > 0 && calls.added <= 40,
    `added ${calls.added} draw calls for ${bands.sparse.planted} decorated trees`
  );

  // The fast preset is a drawing switch, not a planting one.
  const fastCounts = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.setLabDressingBand('sparse');
    game.frame(performance.now(), false);
    const report = game.renderReport().dressing;
    return { decorations: report.decorations, planted: report.planted };
  });
  if (qa === 'fast') {
    const normal = await context.newPage();
    const normalProblems = collectProblems(normal);
    await normal.goto(`${server.url}/?lab=forest&seed=raven-wood`, { waitUntil: 'domcontentloaded' });
    await normal.waitForFunction(() => {
      const report = window.mycelia.game?.renderReport();
      return report?.dressing.planted > 0 && report.dressing.settled;
    });
    const normalCounts = await normal.evaluate(() => {
      // Same band on both pages: the preset must not change the forest, and
      // neither should the fixture's last state.
      window.mycelia.game.setLabDressingBand('sparse');
      window.mycelia.game.frame(performance.now(), false);
      const report = window.mycelia.game.renderReport().dressing;
      return { decorations: report.decorations, planted: report.planted };
    });
    check(
      'fast QA does not plant a different forest',
      normalCounts.decorations === fastCounts.decorations && normalCounts.planted === fastCounts.planted,
      `fast ${JSON.stringify(fastCounts)} vs normal ${JSON.stringify(normalCounts)}`
    );
    assert.deepEqual(normalProblems, [], 'no browser errors at normal preset');
    await normal.close();
  }

  assert.deepEqual(problems, [], 'no browser errors or shader compiler errors');
  console.log(`PASS: ${count} checks, no browser errors, ${((performance.now() - started) / 1000).toFixed(1)}s.`);
} finally {
  await browser?.close();
  server.stop();
}
