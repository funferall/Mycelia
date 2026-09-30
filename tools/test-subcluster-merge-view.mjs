/**
 * Browser check: the subcluster bar's × merges on the first click, even while
 * the colony grows between press and release, and in a stand the colony's
 * regional body has grown into.
 *
 *   npm run build && node tools/test-subcluster-merge-view.mjs
 */
import assert from 'node:assert/strict';
import { collectProblems, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4226);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(300000);
  await page.goto(`${server.url}/?start=best&seed=split-view&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));

  const split = await page.evaluate(() => {
    const g = window.mycelia.game;
    g.stop();
    document.querySelector('#begin').click();
    for (let s = 0; s < 60; s++) { for (const n of g.sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6); for (let i = 0; i < 60; i++) g.match.step(1 / 60); }
    document.querySelector('#view-underground').click();
    for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 100, false);
    const root = g.sim.player.nodes[g.sim.player.rootId];
    const made = g.sim.splitAt(root.gx + 0.5, root.gy + 0.5, 14);
    g.syncClusterControls(true);
    g.frame(g.lastFrame + 16, true);
    return { made, groups: g.sim.player.groups?.length ?? 0 };
  });
  assert(split.made.ok, split.made.message);

  /** Press the ×, let the colony grow and redraw while it is held, then release. */
  const clickWhileGrowing = async (selector) => {
    const box = await page.locator(selector).first().boundingBox();
    assert(box, 'the merge button is on screen');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.evaluate(() => {
      const g = window.mycelia.game;
      for (let f = 0; f < 6; f++) { for (let i = 0; i < 20; i++) g.match.step(1 / 60); g.frame(g.lastFrame + 50, f === 5); }
    });
    await page.mouse.up();
    await page.evaluate(() => { const g = window.mycelia.game; g.frame(g.lastFrame + 16, true); });
  };

  const countsBefore = await page.evaluate(() => document.querySelector('.cluster-chip small')?.textContent ?? '');
  await clickWhileGrowing('.cluster-merge');
  const merged = await page.evaluate(() => {
    const g = window.mycelia.game;
    return {
      groups: g.sim.player.groups?.length ?? 0,
      barHidden: document.querySelector('.cluster-bar')?.hidden ?? true,
      note: document.querySelector('#order-note')?.textContent ?? '',
      counts: document.querySelector('.cluster-chip small')?.textContent ?? '',
    };
  });
  assert.equal(merged.groups, 0, `one click merges the subcluster (${merged.note})`);
  assert.equal(merged.barHidden, true, 'the bar hides with no subclusters left');
  assert.match(merged.note, /rejoins the colony/);
  void countsBefore;

  // In a stand the colony's body has grown into, the × merges on the body.
  const body = await page.evaluate(() => {
    const g = window.mycelia.game;
    const site = g.region.stands[g.region.foundingStand];
    const crossed = g.growAcrossStand(site.sx < g.region.cols - 1 ? 'east' : 'west');
    const owner = g.match.spatialColonies.get(g.region.foundingStand);
    let seconds = 0;
    while (owner && owner.reachedStandIds().length < 2 && seconds < 240) {
      for (const n of owner.colony.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6);
      for (let i = 0; i < 60; i++) g.match.step(1 / 60);
      seconds++;
    }
    const neighbour = owner.reachedStandIds().find((id) => id !== g.region.foundingStand);
    g.goToColony(neighbour);
    for (let i = 0; i < 20; i++) g.frame(g.lastFrame + 100, i === 19);
    const inStand = owner.nodesInStand(neighbour)[0] ?? owner.colony.nodes.find((n) => n.alive);
    const made = owner.splitAt(owner.nodePosition(inStand), 30);
    g.syncClusterControls(true);
    g.frame(g.lastFrame + 16, true);
    return { crossed, neighbour, made, active: g.match.activeStandId, groups: owner.colony.groups?.length ?? 0 };
  });
  assert(body.crossed.ok && body.made.ok, `${body.crossed.message} ${body.made.message}`);
  assert.equal(body.active, body.neighbour);
  await clickWhileGrowing('.cluster-merge');
  const bodyMerged = await page.evaluate(() => {
    const g = window.mycelia.game;
    const owner = g.match.spatialColonies.get(g.region.foundingStand);
    return { groups: owner.colony.groups?.length ?? 0, note: document.querySelector('#order-note')?.textContent ?? '' };
  });
  assert.equal(bodyMerged.groups, 0, `one click merges on the regional body (${bodyMerged.note})`);

  assert.deepEqual(problems.filter((p) => !/favicon/.test(p)), [], 'no console errors');
  console.log(`PASS subcluster merge: first click merges while growing, in the founding stand and in stand ${body.neighbour + 1}.`);
} finally {
  await browser?.close();
  server.stop();
}
