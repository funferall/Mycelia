/** Browser check: press and hold to circle a subcluster, steer it, rest it, merge it. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, gridToPage, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4221);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(300000);
  await page.goto(`${server.url}/?start=best&seed=split-view&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  mkdirSync('design/shots', { recursive: true });
  // Synthetic fixture: the colony is fed while it grows, so it is large enough
  // to split; the selection, orders and growth are the real code.
  const seed = await page.evaluate(() => {
    const g = window.mycelia.game;
    g.stop();
    document.querySelector('#begin').click();
    const m = g.match;
    for (let s = 0; s < 60; s++) { for (const n of g.sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6); for (let i = 0; i < 60; i++) m.step(1 / 60); }
    document.querySelector('#view-underground').click();
    for (let i = 0; i < 40; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    const net = g.sim.player;
    const root = net.nodes[net.rootId];
    const far = net.nodes.filter((n) => n.alive && n.isTip).sort((a, b) => Math.hypot(b.gx - root.gx, b.gy - root.gy) - Math.hypot(a.gx - root.gx, a.gy - root.gy))[0];
    return { gx: far.gx + 0.5, gy: far.gy + 0.5, strands: net.nodes.filter((n) => n.alive).length, rootGx: root.gx, rootGy: root.gy };
  });
  assert(seed.strands >= 60, `colony large enough to split (${seed.strands})`);
  const at = await gridToPage(page, seed.gx, seed.gy);

  // Press and hold: the circle grows while frames run in real time.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const held = await page.evaluate(async () => {
    const g = window.mycelia.game;
    for (let i = 0; i < 14; i++) { g.frame(g.lastFrame + 100, i === 13); await new Promise((r) => setTimeout(r, 100)); }
    return { active: g.lasso?.active ?? false, radius: g.lasso?.radius ?? 0, ring: Boolean(g.lassoRing?.visible) };
  });
  assert.equal(held.active, true, 'holding still starts a selection circle');
  assert(held.radius > 8, `the circle widens while held (${held.radius.toFixed(1)})`);
  assert.equal(held.ring, true);
  await page.screenshot({ path: 'design/shots/subcluster-circle.png', timeout: 60000 });
  await page.mouse.up();

  const split = await page.evaluate(() => {
    const g = window.mycelia.game;
    for (let i = 0; i < 3; i++) g.frame(g.lastFrame + 16, i === 2);
    const net = g.sim.player;
    return {
      groups: net.groups?.length ?? 0,
      selected: g.selectedGroup,
      inGroup: net.nodes.filter((n) => n.alive && n.group === g.selectedGroup).length,
      bar: !document.querySelector('.cluster-bar').hidden,
      chips: document.querySelectorAll('.cluster-select').length,
      pressed: document.querySelector('.cluster-select[aria-pressed="true"]')?.textContent ?? '',
      note: document.querySelector('#order-note')?.textContent ?? '',
      ring: Boolean(g.lassoRing?.visible),
    };
  });
  assert.equal(split.groups, 1, split.note);
  assert.equal(split.selected, 1);
  assert(split.inGroup >= 6);
  assert.equal(split.bar, true);
  assert.equal(split.chips, 2, 'Colony and Subcluster 1');
  assert.match(split.pressed, /Subcluster 1/);
  assert.equal(split.ring, false, 'the circle is gone once released');
  await page.screenshot({ path: 'design/shots/subcluster-selected.png', timeout: 60000 });

  // A tap on the soil steers only the subcluster.
  await page.evaluate(() => { const b = document.querySelector('[data-order="grow"]'); b?.click(); });
  const target = { gx: Math.min(128, seed.gx + 30), gy: Math.min(60, seed.gy + 18) };
  const tap = await gridToPage(page, target.gx, target.gy);
  const colonyBefore = await page.evaluate(() => JSON.stringify(window.mycelia.game.sim.player.waypoints));
  await page.mouse.click(tap.x, tap.y);
  const ordered = await page.evaluate(() => {
    const net = window.mycelia.game.sim.player;
    return { group: net.groups[0].waypoints[0] ?? null, colony: JSON.stringify(net.waypoints) };
  });
  assert(ordered.group && Math.abs(ordered.group.gx - Math.round(target.gx)) <= 1, 'the order went to the subcluster');
  assert.equal(ordered.colony, colonyBefore, 'the colony kept its own orders');

  // Rest applies to the selection alone.
  await page.evaluate(() => document.querySelector('#rest').click());
  const rested = await page.evaluate(() => ({ group: window.mycelia.game.sim.player.groups[0].resting, colony: window.mycelia.game.sim.player.resting, label: document.querySelector('#rest').textContent }));
  assert.equal(rested.group, true);
  assert.equal(rested.colony, false, 'the colony keeps growing');
  assert.match(rested.label, /Wake/);

  // Escape returns orders to the colony; merge dissolves the subcluster.
  await page.keyboard.press('Escape');
  const escaped = await page.evaluate(() => window.mycelia.game.selectedGroup);
  assert.equal(escaped, 0);
  await page.evaluate(() => document.querySelector('.cluster-merge').click());
  const merged = await page.evaluate(() => ({ groups: window.mycelia.game.sim.player.groups.length, hidden: document.querySelector('.cluster-bar').hidden }));
  assert.equal(merged.groups, 0);
  assert.equal(merged.hidden, true);
  assert.deepEqual(problems, [], 'no browser errors');
  console.log(`PASS subclusters browser: held ${held.radius.toFixed(1)}-cell circle selected ${split.inGroup} strands, bar and highlight, tap steered only the subcluster, rest held only it, Escape and merge. Fast QA.`);
} finally {
  await browser?.close();
  server.stop();
}
