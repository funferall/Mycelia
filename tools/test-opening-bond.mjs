/** Reproduce the lean-strand opening and click its actual oak label. */
import assert from 'node:assert/strict';
import { launchBrowser, withQaPreset } from './browser.mjs';
import { startPreview } from './preview.mjs';

const port = 4186;
const server = await startPreview(port);
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(withQaPreset(`http://127.0.0.1:${port}/?seed=oak`, 'fast'));
  await page.waitForFunction(() => Boolean(window.mycelia?.game));
  await page.click('#begin');
  await page.evaluate(() => {
    const game = window.mycelia.game;
    game.stop();
    for (let i = 0; i < 30; i++) game.frame(game.lastFrame + 100, false);
  });
  await page.click('.speed-row button[data-speed="4"]');
  const reach = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#root-markers button')]
      .find((entry) => !entry.hidden && /Reach.*oak/i.test(entry.textContent ?? ''));
    button?.click();
    return button?.textContent?.trim() ?? null;
  });
  assert.ok(reach, 'the opening oak has a visible Reach label');
  const reached = await page.evaluate(() => {
    const game = window.mycelia.game;
    while (game.sim.time < 10) game.frame(game.lastFrame + 100, false);
    const button = [...document.querySelectorAll('#root-markers button')]
      .find((entry) => !entry.hidden && /Bond.*oak/i.test(entry.textContent ?? '') && !/Bonded/i.test(entry.textContent ?? ''));
    return { label: button?.textContent?.trim() ?? null, time: game.sim.time };
  });
  assert.ok(reached.label, `a funded oak shows Bond at ${reached.time.toFixed(1)}s`);
  await page.evaluate(() => {
    [...document.querySelectorAll('#root-markers button')]
      .find((entry) => !entry.hidden && /Bond.*oak/i.test(entry.textContent ?? '') && !/Bonded/i.test(entry.textContent ?? ''))?.click();
  });
  const result = await page.evaluate(() => ({
    bonds: window.mycelia.game.sim.world.trees
      .filter((tree) => tree.species === 'oak' && tree.rootTips.some((tip) => tip.bondedTo !== null)).length,
    note: document.querySelector('#order-note')?.textContent ?? '',
  }));
  assert.ok(result.bonds > 0, `clicking ${reached.label} bonds an oak: ${result.note}`);
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(`PASS: reached ${reach}; clicked ${reached.label} at ${reached.time.toFixed(1)}s; ${result.bonds} oak bonded.`);
} finally {
  await browser.close();
  server.stop();
}
