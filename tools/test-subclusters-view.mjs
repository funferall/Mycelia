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

  // A recorded order is only useful if the selected branches actually grow.
  // Rest the unselected colony and advance the live match through the browser.
  await page.evaluate(() => {
    document.querySelector('.cluster-select[data-group="0"]').click();
    document.querySelector('#rest').click();
    document.querySelector('.cluster-select[data-group="1"]').click();
  });
  const movement = await page.evaluate(({ gx, gy }) => {
    const g = window.mycelia.game;
    const net = g.sim.player;
    const distance = () => Math.min(...net.nodes.filter((n) => n.alive && n.group === 1)
      .map((n) => Math.hypot(n.wx - gx, n.wy - gy)));
    const colonyTips = () => net.nodes.filter((n) => n.alive && n.isTip && !n.group)
      .map((n) => [n.id, n.wx, n.wy]);
    const before = distance();
    const held = colonyTips();
    for (let i = 0; i < 12 * 60; i++) g.match.step(1 / 60);
    return { before, after: distance(), held, colonyTips: colonyTips(), selected: g.selectedGroup };
  }, target);
  assert(movement.after < movement.before - 2,
    `selected subcluster grows toward its own target (${movement.before.toFixed(1)} -> ${movement.after.toFixed(1)})`);
  assert.equal(movement.selected, 1, 'the selected group stays selected while it grows');
  for (const [id, wx, wy] of movement.held) {
    const tip = movement.colonyTips.find(([current]) => current === id);
    if (tip) assert.deepEqual(tip, [id, wx, wy], 'the resting colony does not move with the subcluster');
  }

  // Rest applies to the selection alone.
  await page.evaluate(() => document.querySelector('#rest').click());
  const rested = await page.evaluate(() => ({ group: window.mycelia.game.sim.player.groups[0].resting, colony: window.mycelia.game.sim.player.resting, label: document.querySelector('#rest').textContent }));
  assert.equal(rested.group, true);
  assert.equal(rested.colony, true, 'the colony stays at rest while the subcluster rests');
  assert.match(rested.label, /Wake/);

  // Create a second, interior subcluster and choose its chip. A Grow click
  // must leave both the first subcluster's and the colony's orders intact.
  const second = await page.evaluate(({ rootGx, rootGy }) => {
    const g = window.mycelia.game;
    const split = g.sim.splitAt(rootGx + 0.5, rootGy + 0.5, 10);
    g.syncClusterControls(true);
    document.querySelector('.cluster-select[data-group="2"]')?.click();
    return { split, selected: g.selectedGroup };
  }, seed);
  assert(second.split.ok && second.split.id === 2, second.split.message);
  assert.equal(second.selected, 2, 'the second subcluster can be chosen in the UI');
  const otherOrders = await page.evaluate(() => {
    const net = window.mycelia.game.sim.player;
    return { colony: JSON.stringify(net.waypoints), first: JSON.stringify(net.groups[0].waypoints) };
  });
  await page.mouse.click(tap.x, tap.y);
  const secondOrder = await page.evaluate(() => {
    const net = window.mycelia.game.sim.player;
    return {
      selected: window.mycelia.game.selectedGroup,
      second: net.groups.find((g) => g.id === 2)?.waypoints[0] ?? null,
      first: JSON.stringify(net.groups.find((g) => g.id === 1)?.waypoints),
      colony: JSON.stringify(net.waypoints),
    };
  });
  assert.equal(secondOrder.selected, 2);
  assert(secondOrder.second, 'Grow from the second chip orders that subcluster');
  assert.equal(secondOrder.first, otherOrders.first, 'the first subcluster keeps its own order');
  assert.equal(secondOrder.colony, otherOrders.colony, 'the colony keeps its own order');

  // With subclusters present, a number key picks the subcluster and leaves the order alone.
  await page.evaluate(() => document.querySelector('[data-order="grow"]')?.click());
  await page.keyboard.press('Escape');
  const colonyRest = await page.evaluate(() => document.querySelector('#rest').textContent);
  assert.match(colonyRest, /Wake/, 'the Rest control reflects the selected colony');
  await page.keyboard.press('1');
  const keyed = await page.evaluate(() => ({ group: window.mycelia.game.selectedGroup, order: window.mycelia.game.ui.order }));
  assert.equal(keyed.group, 1, 'the number key selects the subcluster');
  assert.equal(keyed.order, 'grow', 'and does not change the order');

  // The edge action promotes the network into regional sections. It must keep
  // the selected group and give that group, rather than the colony, the order.
  const crossing = await page.evaluate(() => {
    const g = window.mycelia.game;
    const site = g.region.stands[g.region.foundingStand];
    const direction = site.sx < g.region.cols - 1 ? 'east' : 'west';
    const colonyBefore = JSON.stringify(g.sim.player.waypoints);
    const result = g.growAcrossStand(direction);
    return {
      result, selected: g.selectedGroup, section: Boolean(g.section),
      groupOrder: g.sim.player.groups[0]?.waypoints[0] ?? null,
      colonyBefore, colonyAfter: JSON.stringify(g.sim.player.waypoints),
    };
  });
  assert(crossing.result.ok, crossing.result.message);
  assert.match(crossing.result.message, /Subcluster 1/);
  assert.equal(crossing.selected, 1, 'the group stays selected in the section');
  assert.equal(crossing.section, true);
  assert(crossing.groupOrder, 'the group has a crossing destination');
  assert.equal(crossing.colonyAfter, crossing.colonyBefore, 'the whole colony was not redirected');

  // A real click on the newly opened section must still steer the selection.
  const sectionTap = await page.evaluate(() => {
    const g = window.mycelia.game;
    for (let i = 0; i < 18; i++) g.frame(g.lastFrame + 100, false);
    const rect = g.canvas.getBoundingClientRect();
    for (const y of [0.5, 0.6, 0.4, 0.7]) for (const x of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const clientX = rect.left + rect.width * x;
      const clientY = rect.top + rect.height * y;
      const point = g.sectionPointAt(clientX, clientY);
      if (point && g.match.spatial.soil.passableAt(point.x, point.y, point.z)) {
        return { x: clientX, y: clientY, point };
      }
    }
    return null;
  });
  assert(sectionTap, 'a passable point in the opened section is clickable');
  const sectionColonyBefore = await page.evaluate(() => JSON.stringify(window.mycelia.game.sim.player.waypoints));
  await page.mouse.click(sectionTap.x, sectionTap.y);
  const sectionOrder = await page.evaluate(() => {
    const g = window.mycelia.game;
    return {
      selected: g.selectedGroup,
      note: document.querySelector('#order-note').textContent,
      group: g.sim.player.groups.find((item) => item.id === 1)?.waypoints[0] ?? null,
      colony: JSON.stringify(g.sim.player.waypoints),
    };
  });
  assert.equal(sectionOrder.selected, 1);
  assert.match(sectionOrder.note, /Subcluster 1 directed/);
  assert(sectionOrder.group, 'the section click gave the selected subcluster a destination');
  assert.equal(sectionOrder.colony, sectionColonyBefore, 'the section click did not order the colony');

  const roundTrip = await page.evaluate(() => {
    const g = window.mycelia.game;
    const rise = g.surfaceHere();
    for (let i = 0; i < 20; i++) g.frame(g.lastFrame + 100, false);
    const above = { view: g.stage.rig.view, selected: g.selectedGroup };
    document.querySelector('#view-underground').click();
    for (let i = 0; i < 20; i++) g.frame(g.lastFrame + 100, false);
    return { rise, above, below: g.stage.rig.view, selected: g.selectedGroup, section: Boolean(g.section) };
  });
  assert(roundTrip.rise.ok, roundTrip.rise.message);
  assert.equal(roundTrip.above.view, 'forest');
  assert.equal(roundTrip.above.selected, 1);
  assert.equal(roundTrip.below, 'underground');
  assert.equal(roundTrip.selected, 1, 'a forest round trip keeps the selected subcluster');
  assert.equal(roundTrip.section, true);

  // Escape returns orders to the colony; merge dissolves the subcluster.
  await page.keyboard.press('Escape');
  const escaped = await page.evaluate(() => window.mycelia.game.selectedGroup);
  assert.equal(escaped, 0);
  await page.evaluate(() => {
    document.querySelector('.cluster-merge[data-merge="1"]').click();
    document.querySelector('.cluster-merge[data-merge="2"]').click();
  });
  const merged = await page.evaluate(() => ({ groups: window.mycelia.game.sim.player.groups.length, hidden: document.querySelector('.cluster-bar').hidden }));
  assert.equal(merged.groups, 0);
  assert.equal(merged.hidden, true);
  assert.deepEqual(problems, [], 'no browser errors');
  console.log(`PASS subclusters browser: held ${held.radius.toFixed(1)}-cell circle selected ${split.inGroup} strands, selected growth ${movement.before.toFixed(1)} -> ${movement.after.toFixed(1)} while the colony rested, second chip directed separately, group Grow clicks worked after section entry and forest round trip, rest, Escape and merge. Fast QA.`);
} finally {
  await browser?.close();
  server.stop();
}
