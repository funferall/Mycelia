import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchBrowser, waitForGame } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4177);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`${server.url}/?qa=fast`, { waitUntil: 'commit' });
  await waitForGame(page);
  await page.evaluate(() => { window.mycelia.game.stop(); window.mycelia.game.ui.update(window.mycelia.game.sim, 1); });
  mkdirSync('design/shots', { recursive: true });
  await page.screenshot({ path: 'design/shots/living-ui-desktop.png', timeout: 60000 });
  assert.equal(await page.locator('.reserve-ring').count(), 3);
  await page.locator('.resource-readout').first().focus();
  assert(await page.locator('.reserve-tooltip').first().isVisible());
  await page.locator('.evolution-open').click();
  assert(await page.locator('.evolution-dialog').isVisible());
  // Six adaptations plus the three ecological capstones (Storm, Ember and Parch crowns).
  assert.equal(await page.locator('.adaptation').count(), 9);
  assert.equal(await page.locator('.adaptation[data-state="ready"]').count(), 0);
  const before = await page.evaluate(() => window.mycelia.game.sim.player.resting);
  await page.keyboard.press('r');
  assert.equal(await page.evaluate(() => window.mycelia.game.sim.player.resting), before, 'dialog key must not issue rest');
  await page.screenshot({ path: 'design/shots/living-tech-tree.png', timeout: 60000 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.evolution-dialog').isVisible(), false);
  assert.equal(await page.locator('.evolution-open').evaluate(el => el === document.activeElement), true);
  // Explicit synthetic mature fixture: verify real learn/invoke buttons against authoritative state.
  await page.evaluate(() => {
    const game = window.mycelia.game;
    game.sim.player.nodes[0].bondedTree = 0;
    game.sim.player.nodes[1].bondedTree = 1;
    game.sim.player.fruited = 1;
    game.ui.update(game.sim, 1);
  });
  await page.locator('.evolution-open').click();
  await page.getByRole('button', { name: /^Deep drink/ }).click();
  await page.getByRole('button', { name: /^Mineral weave/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Forest pulse · Invoke' }).click();
  assert.equal(await page.evaluate(() => window.mycelia.game.sim.player.evolution.active.pulse), 20);
  assert(await page.getByRole('button', { name: /Forest pulse · Active/ }).isDisabled());
  await page.getByText('Detailed readings', { exact: true }).click();
  assert(await page.locator('#record').isVisible());
  await page.getByText('Detailed readings', { exact: true }).click();
  await page.locator('#view-underground').click();
  await page.evaluate(() => {
    const game = window.mycelia.game;
    for (let i = 0; i < 25; i++) game.frame(game.lastFrame + 100, false);
    game.frame(game.lastFrame + 100, true);
    document.querySelector('.living-panel').scrollTop = 0;
  });
  await page.screenshot({ path: 'design/shots/living-ui-underground.png', timeout: 60000 });
  await page.setViewportSize({ width: 820, height: 900 });
  const disclosurePace = await page.evaluate(() => ({ speed: window.mycelia.game.speed, awakened: window.mycelia.game.awakened }));
  await page.getByText('Detailed readings', { exact: true }).focus();
  await page.keyboard.press('Space');
  assert(await page.locator('#record').isVisible(), 'intermediate-width readings open with Space');
  assert.deepEqual(await page.evaluate(() => ({ speed: window.mycelia.game.speed, awakened: window.mycelia.game.awakened })), disclosurePace, 'summary Space must not awaken or pause the game');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#record').isVisible(), false);
  assert.notEqual(await page.locator('#focus-root').evaluate(el => getComputedStyle(el).display), 'none');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const game = window.mycelia.game;
    game.frame(game.lastFrame + 100, true);
    document.querySelector('.living-panel').scrollTop = 0;
  });
  await page.screenshot({ path: 'design/shots/living-ui-compact.png', timeout: 60000 });
  assert(await page.locator('.evolution-open').isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.evolution-open').click();
  assert.equal(await page.locator('.evolution-branches').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
  await page.screenshot({ path: 'design/shots/living-tech-tree-compact.png', timeout: 60000 });
  assert.deepEqual(errors, []);
  console.log('PASS desktop/compact layout, focused resource details, modal isolation and focus return, nine tech nodes (six plus three capstones), learn/invoke/cooldown UI, detailed readings; no runtime errors. Mature fixture is synthetic.');
} finally { await browser.close(); server.stop(); }
