/**
 * Browser check for the cord tool: hover a strand to preview the braid home,
 * drag between strands to braid them, tap to braid home, and see the ropes.
 *
 *   npm run build && node tools/test-cords-view.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, gridToPage, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4223);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(300000);
  await page.goto(`${server.url}/?start=best&seed=cord-view&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  mkdirSync('design/shots', { recursive: true });

  // Synthetic fixture: the colony is fed while it grows so it has branches to
  // braid and carbon to pay; the tool, the preview and the orders are real.
  const seed = await page.evaluate(() => {
    const g = window.mycelia.game;
    g.stop();
    document.querySelector('#begin').click();
    const m = g.match;
    for (let s = 0; s < 50; s++) { for (const n of g.sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6); for (let i = 0; i < 60; i++) m.step(1 / 60); }
    document.querySelector('#view-underground').click();
    for (let i = 0; i < 40; i++) g.frame(g.lastFrame + 100, false);
    g.frame(g.lastFrame + 16, true);
    const net = g.sim.player;
    const root = net.nodes[net.rootId];
    const tips = net.nodes.filter((n) => n.alive && n.isTip && n.connected)
      .sort((a, b) => Math.hypot(b.gx - root.gx, b.gy - root.gy) - Math.hypot(a.gx - root.gx, a.gy - root.gy));
    const far = tips[0];
    // A second tip well away from the first, for the drag.
    const other = tips.find((t) => Math.hypot(t.gx - far.gx, t.gy - far.gy) > 12) ?? tips[tips.length - 1];
    const thirds = tips.filter((t) => t !== far && t !== other && Math.hypot(t.gx - far.gx, t.gy - far.gy) > 6);
    const point = (n) => ({ id: n.id, gx: n.wx, gy: n.wy });
    return { far: point(far), other: point(other), thirds: (thirds.length ? thirds : [tips[1]]).map(point), strands: net.nodes.filter((n) => n.alive).length };
  });
  assert(seed.strands >= 60, `a colony worth braiding (${seed.strands})`);

  const reinforced = () => page.evaluate(() => window.mycelia.game.sim.player.nodes.filter((n) => n.alive && n.reinforced).length);
  const frames = (n) => page.evaluate((count) => { const g = window.mycelia.game; for (let i = 0; i < count; i++) g.frame(g.lastFrame + 50, i === count - 1); }, n);

  await page.evaluate(() => document.querySelector('[data-order="cord"]').click());
  const note = await page.evaluate(() => document.querySelector('#order-note')?.textContent ?? '');
  assert.match(note, /Drag/, 'the cord hint says how to use it, in one line');

  // Hover: the braid home is previewed before anything is paid.
  const far = await gridToPage(page, seed.far.gx, seed.far.gy);
  await page.mouse.move(far.x, far.y);
  await frames(6);
  const hover = await page.evaluate(() => {
    const o = window.mycelia.game.cordOverlay;
    return { points: o.previewPoints.length, affordable: o.previewAffordable, drawn: o.preview.geometry.drawRange.count, bottlenecks: o.bottleneckCount };
  });
  assert(hover.points > 3, `hovering a strand previews its route home (${hover.points} points)`);
  assert(hover.drawn > 0, 'the preview is drawn');
  assert.equal(await reinforced(), 0, 'a preview costs nothing');
  await page.screenshot({ path: 'design/shots/cord-preview.png', timeout: 60000 });

  // Drag from one strand to another: the view holds still and the strands braid.
  const other = await gridToPage(page, seed.other.gx, seed.other.gy);
  const cameraBefore = await page.evaluate(() => window.mycelia.game.stage.rig.camera.position.toArray());
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(far.x + (other.x - far.x) * i / 12, far.y + (other.y - far.y) * i / 12);
    if (i === 8) await frames(3);
  }
  await frames(3);
  await page.screenshot({ path: 'design/shots/cord-drag.png', timeout: 60000 });
  await page.mouse.up();
  await frames(8);
  const dragged = await page.evaluate(() => ({
    camera: window.mycelia.game.stage.rig.camera.position.toArray(),
    note: document.querySelector('#order-note')?.textContent ?? '',
    braid: window.mycelia.game.cordOverlay.braidCount,
  }));
  assert.deepEqual(dragged.camera, cameraBefore, 'a cord drag does not pan the view');
  const afterDrag = await reinforced();
  assert(afterDrag > 3, `the drag braided the strands between (${afterDrag}): ${dragged.note}`);
  assert(dragged.braid > afterDrag * 3, `every cord strand is drawn as a braid (${dragged.braid} pieces)`);

  // Tap a third strand: its route home is braided.
  // A root's Bond label can sit over a strand; tap one the label does not cover.
  let third = null;
  for (const candidate of seed.thirds) {
    const at = await gridToPage(page, candidate.gx, candidate.gy);
    if (await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS', at)) { third = at; break; }
  }
  assert(third, 'a strand clear of labels to tap');
  await page.mouse.click(third.x, third.y);
  await frames(8);
  const afterTap = await reinforced();
  assert(afterTap > afterDrag, `a tap braids a strand home (${afterDrag} -> ${afterTap})`);

  // Close in on the ropes for the record.
  await page.evaluate(({ gx, gy }) => {
    const g = window.mycelia.game;
    const { halfWidth, halfHeight } = g.viewReport().mount;
    g.stage.rig.focus(gx - halfWidth, halfHeight - gy, 26);
  }, seed.far);
  await frames(40);
  await page.screenshot({ path: 'design/shots/cord-braid.png', timeout: 60000 });

  assert.deepEqual(problems.filter((p) => !/favicon/.test(p)), [], 'no console errors');
  console.log(`PASS cord tool: preview ${hover.points} points, ${hover.bottlenecks} bottlenecks shown, drag braided ${afterDrag}, tap braided ${afterTap - afterDrag} more.`);
} finally {
  await browser?.close();
  server.stop();
}
