/** Focused water + lab smoke. Use test:feature to rebuild first. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { collectProblems, formatRenderReport, launchBrowser, parseQaPreset, withQaPreset } from './browser.mjs';
import { startPreview } from './preview.mjs';

const started = performance.now();
const qa = parseQaPreset();
const server = await startPreview(4187);
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = collectProblems(page);
  page.setDefaultTimeout(60000);
  await page.goto(withQaPreset(`${server.url}/?lab=water&seed=raven-wood`, qa), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.test-bench');
  await page.waitForFunction(() => window.mycelia.game.renderReport().assets.ready);
  await page.evaluate(() => window.mycelia.game.stop());
  let count = 0;
  function check(name, ok) { assert(ok, name); count++; console.log(`PASS ${name}`); }
  const report = await page.evaluate(() => window.mycelia.game.renderReport());
  console.log(formatRenderReport(report));
  check('water fixture opens directly in the crossed underground stand', report.water.channel > 0 && report.water.fringeCm === 8);
  check('the surface includes a brook and instanced stones', report.water.ribbon > 0 && report.water.rocks > 0);
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
  const before = await capture('water-underground');
  await page.evaluate(() => window.mycelia.game.groundwater.update(12, true));
  check('underground currents visibly move without stepping the simulation', before !== await capture('water-underground-flow'));
  const freeze = await page.evaluate(() => {
    const flow = window.mycelia.game.groundwater;
    const before = flow.tableFlow.uniforms.waterTime.value;
    flow.update(12, false);
    return before === flow.tableFlow.uniforms.waterTime.value;
  });
  check('ambient motion off freezes water phase', freeze);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#ambient-motion').getAttribute('aria-pressed') === 'false');
  check('system reduced motion freezes the game water animation', await page.evaluate(() => {
    const game = window.mycelia.game;
    const phase = game.groundwater.tableFlow.uniforms.waterTime.value;
    game.frame(performance.now(), false);
    return !game.ambientMotion && phase === game.groundwater.tableFlow.uniforms.waterTime.value;
  }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelector('#ambient-motion').getAttribute('aria-pressed') === 'true');

  // Real keyboard input on the bench; the geometry follows without warmup.
  await page.getByLabel('Test water depth').focus();
  await page.keyboard.press('Home');
  check('depth control updates simulation and shader together', await page.evaluate(() => {
    const game = window.mycelia.game;
    return game.sim.world.waterTableCm === 10 && game.groundwater.tableFlow.uniforms.waterDepth.value === 10;
  }));
  await capture('water-high-table');
  await page.keyboard.press('End');
  check('depth control can expose the stream bed', await page.evaluate(() => window.mycelia.game.sim.world.waterTableCm === 112));

  await page.evaluate(() => {
    const game = window.mycelia.game;
    game.prepareLab('forest');
    game.frame(performance.now(), false);
  });
  const forest = await capture('water-forest');
  const costs = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.stream.update(1, 12, true);
    game.stage.renderer.info.autoReset = false;
    game.stage.renderer.info.reset();
    game.stage.render(0);
    const water = game.stage.renderer.info.render.calls;
    game.stream.group.visible = false;
    game.stage.renderer.info.reset();
    game.stage.render(0);
    const dry = game.stage.renderer.info.render.calls;
    game.stream.group.visible = true;
    game.stage.renderer.info.autoReset = true;
    return { water, dry, added: water - dry };
  });
  check('surface water uses only bank, ribbon and stone draws', costs.added === 3);
  check('surface shader visibly flows', forest !== await capture('water-forest-flow'));
  console.log(`Water draw calls: ${JSON.stringify(costs)}`);

  await page.getByLabel('Test scene').selectOption('region');
  await page.waitForFunction(() => Boolean(document.querySelector('.test-bench')) && window.mycelia.game.match.colonizedStands === 9);
  await page.evaluate(() => window.mycelia.game.stop());
  check('region fixture opens all stands immediately', await page.evaluate(() => window.mycelia.game.match.colonizedStands === 9));
  await page.getByRole('button', { name: 'Advance 10 seconds' }).click();
  check('fixed-step advance runs without ten seconds of rendering', await page.evaluate(() => Math.abs(window.mycelia.game.match.time - 10) < 1e-6));
  await page.getByLabel('Test scene').selectOption('growth');
  await page.waitForFunction(() => Boolean(document.querySelector('.test-bench')) && window.mycelia.game.match.time >= 29.9);
  await page.evaluate(() => window.mycelia.game.stop());
  check('growth fixture opens a paused grown network', await page.evaluate(() => {
    const game = window.mycelia.game;
    return game.speed === 0 && game.sim.player.nodes.length > 4;
  }));
  await page.screenshot({ path: `design/shots/test-bench-${qa}.png` });
  // The opt-in fixture must never leak into an ordinary match.
  await page.goto(withQaPreset(`${server.url}/?seed=raven-wood`, qa), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia));
  await page.evaluate(() => window.mycelia.game.stop());
  check('ordinary entry has no test bench and only the founding colony', await page.evaluate(() =>
    !document.querySelector('.test-bench') && window.mycelia.game.match.colonizedStands === 1));
  assert.deepEqual(problems, [], 'no browser errors or shader compiler errors');
  console.log(`PASS: ${count} checks, no browser errors, ${((performance.now() - started) / 1000).toFixed(1)}s.`);
} finally {
  await browser?.close();
  server.stop();
}
