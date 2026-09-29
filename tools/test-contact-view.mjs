/**
 * Browser check for contact war (C2): a player colony founded in the rival's
 * stand grows into it, a front opens and is announced, Z frames it, and the
 * chemical keys cast at the cursor with effects drawn in the soil.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4203);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(180000);
  await page.goto(`${server.url}/?start=best&seed=contact-run&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());
  mkdirSync('design/shots', { recursive: true });
  const frames = (n, ms = 100) => page.evaluate(([n, ms]) => {
    const g = window.mycelia.game;
    for (let i = 0; i < n; i++) g.frame(g.lastFrame + ms, false);
    g.frame(g.lastFrame + 16, true);
  }, [n, ms]);

  // Fixture: spores land in the rival's stand (the real founding path) and
  // the colony is ordered toward the rival's founding strand.
  const setup = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    const R = m.region.rivalStand;
    for (let i = 0; i < 300; i++) m.step(1 / 60);
    m.found(m.stands[R], m.stands[m.region.foundingStand], { carbon: 120, water: 20, nitrogen: 10 }, 0);
    const body = m.spatialColonies.get(R);
    const rival = m.stands[R].sim.rival;
    const target = rival.nodes[rival.rootId].spatial;
    let t = 0;
    for (; t < 120 && !m.contact.frontsOf('player').length; t++) {
      if (t % 5 === 0) body.growAt({ ...target }, 'x', target.y);
      for (let i = 0; i < 60; i++) m.step(1 / 60);
    }
    return { R, t, fronts: m.contact.frontsOf('player').length };
  });
  assert(setup.fronts > 0, `a front opens (${JSON.stringify(setup)})`);
  await frames(5);
  const alert = await page.evaluate(() => ({
    hidden: document.querySelector('.contact-alert').hidden,
    text: document.querySelector('.contact-alert').textContent,
    chips: document.querySelectorAll('.contact-chip').length,
    announced: window.mycelia.game.match.active.sim.events.some((e) => /Contact!/.test(e.text)),
  }));
  assert.equal(alert.hidden, false, 'the front alert shows');
  assert.match(alert.text, /Front/);
  assert.equal(alert.chips, 6, 'six chemicals on the bar');
  assert(alert.announced, 'the front is announced');

  // Z frames the front underground.
  await page.keyboard.press('z');
  await frames(40);
  const framed = await page.evaluate(() => {
    const g = window.mycelia.game;
    return { view: g.stage.rig.view, stand: g.match.activeStandId };
  });
  assert.equal(framed.view, 'underground');
  assert.equal(framed.stand, setup.R, 'jumped to the front\'s stand');

  // Aim at the front: its centre on screen. The fixture keeps the colony fed
  // and the placeholder opponent quiet, so the front holds while we aim.
  const aim = await page.evaluate(() => {
    const g = window.mycelia.game;
    const m = g.match;
    m.contact.bots.clear();
    const body = m.spatialColonies.get(m.region.rivalStand);
    for (let t = 0; t < 60 && !m.contact.frontsOf('player').length; t++) {
      for (const n of body.colony.nodes) if (n.alive) { n.carbon = Math.max(n.carbon, 2); n.water = Math.max(n.water, 2); n.nitrogen = Math.max(n.nitrogen, 1.5); }
      for (let i = 0; i < 30; i++) m.step(1 / 60);
    }
    for (const n of body.colony.nodes) if (n.alive) { n.carbon = 2.4; n.water = 3; n.nitrogen = 2; }
    for (let i = 0; i < 3; i++) g.frame(g.lastFrame + 16, true);
    const front = m.contact.frontsOf('player')[0];
    const at = front && g.contactToScene(front.centre);
    if (!at) {
      const soil = g.sim.world.regionalSoil;
      return { debug: { section: Boolean(g.section), spec: g.section?.spec?.plane, halfWidth: g.section?.spec?.halfWidth, centre: front?.centre, soilStand: soil?.standId, p0: soil?.pointAt(0, 0), p1: soil?.pointAt(1, 0), standPlane: g.standPlane, active: g.match.activeStandId } };
    }
    at.project(g.stage.rig.camera);
    const rect = g.canvas.getBoundingClientRect();
    return { x: rect.left + (at.x + 1) / 2 * rect.width, y: rect.top + (1 - at.y) / 2 * rect.height };
  });
  assert(aim && !aim.debug, `the front is drawn in this view ${JSON.stringify(aim)}`);
  await page.mouse.move(aim.x, aim.y);
  const before = await page.evaluate(() => window.mycelia.game.match.contact.casts.filter((c) => c.owner === 'player').length);
  for (const key of ['q', 'q', 'e', 'w', 'a', 'c']) {
    await page.keyboard.press(key);
    await frames(1, 250);
  }
  await frames(1, 16);
  const after = await page.evaluate(() => {
    const g = window.mycelia.game;
    const mine = g.match.contact.casts.filter((c) => c.owner === 'player');
    return {
      casts: mine.length,
      kinds: [...new Set(mine.map((c) => c.chemical))],
      hits: mine.reduce((v, c) => v + c.hits, 0),
      note: document.querySelector('#note, .note')?.textContent ?? '',
      sprites: g.contactFx.group.children.filter((s) => s.visible).length,
    };
  });
  assert(after.casts - before >= 3, `casts went out (${JSON.stringify(after)})`);
  assert(after.sprites > 0, 'effects are drawn');
  await page.screenshot({ path: 'design/shots/contact-front.png' });
  await page.locator('.contact-bar').screenshot({ path: 'design/shots/contact-bar.png' });
  assert.deepEqual(problems, [], `no page errors: ${problems.join('\n')}`);
  console.log(`PASS contact browser: front opened after ${setup.t}s in stand ${setup.R + 1}, announced and shown; Z framed it; ${after.casts - before} casts (${after.kinds.join(', ')}) hit ${after.hits} strands; ${after.sprites} effect sprites drawn. Synthetic founding, fast QA.`);
} finally {
  await browser?.close();
  server.stop();
}
