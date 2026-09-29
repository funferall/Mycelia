/**
 * Browser check for seeing and visiting colonies (`VIEW-07`, `MAP-08`).
 *
 * With a founding colony and a spore daughter: the side panel lists one tile
 * per colonized stand; the toggle projects every colony through the forest
 * floor (more strands than the founding colony alone); a tile takes the
 * player below that stand, rebinding the view to it; and the home tile
 * returns to the founding transect.
 *
 *   npm run test:colonies-view
 */
import assert from 'node:assert/strict';
import { collectProblems, launchBrowser, parseQaPreset, withQaPreset } from './browser.mjs';
import { startPreview } from './preview.mjs';

const qa = parseQaPreset();
const server = await startPreview(4236);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(180000);
  await page.goto(withQaPreset(`${server.url}/?seed=raven-wood`, qa), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));

  const setup = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.awaken();
    game.stop();
    const m = game.match;
    const DT = 1 / 30;
    const feed = () => { for (const s of m.stands) for (const n of s.sim.player.nodes) if (n.alive) { n.carbon = Math.max(n.carbon, 5); n.water = Math.max(n.water, 1); n.nitrogen = Math.max(n.nitrogen, 1); } };
    for (let s = 0; s < 40; s++) { feed(); for (let i = 0; i < 30; i++) m.step(DT); }
    for (let i = 0; i < 600 * 30 && m.gusting(); i++) m.step(DT);
    const net = m.active.sim.player;
    const root = net.nodes[net.rootId];
    root.carbon = 300; root.water = 12; root.nitrogen = 8;
    net.fruited += 1;
    const released = m.releaseSpores(m.activeStandId);
    for (let s = 0; s < 30; s++) { feed(); for (let i = 0; i < 30; i++) m.step(DT); }
    game.frame(performance.now(), true);
    return { released: released.ok, home: m.activeStandId, colonies: game.colonyStands(), homeEdges: net.nodes.filter((n) => n.parent >= 0).length };
  });
  assert.equal(setup.released, true, 'a daughter was founded');
  assert.equal(setup.colonies.length, 2, `two colonized stands: ${JSON.stringify(setup.colonies)}`);
  const daughter = setup.colonies.find((c) => c.how === 'spores');
  assert.ok(daughter, 'the daughter is listed as landed by spores');

  const tiles = await page.evaluate(() => [...document.querySelectorAll('.colony-tile')].map((b) => ({ stand: Number(b.dataset.stand), how: b.dataset.how, label: b.getAttribute('aria-label') })));
  assert.equal(tiles.length, 2, 'one tile per colonized stand');
  assert.ok(tiles.some((t) => t.how === 'home') && tiles.some((t) => t.how === 'spores'));

  await page.locator('#forest-reveal').click();
  const reveal = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.frame(performance.now(), true);
    return { report: game.revealReport(), pressed: document.querySelector('#forest-reveal').getAttribute('aria-pressed') };
  });
  assert.equal(reveal.pressed, 'true');
  assert.equal(reveal.report.enabled, true);
  assert.ok(reveal.report.strands > setup.homeEdges, `every colony is projected (${reveal.report.strands} strands, home alone ${setup.homeEdges})`);

  await page.locator(`.colony-tile[data-stand="${daughter.standId}"]`).click();
  const below = await page.evaluate(() => {
    const game = window.mycelia.game;
    for (let i = 0; i < 40; i++) game.frame(performance.now() + i * 50, true);
    return {
      view: game.stage.rig.view,
      section: game.sectionReport(),
      active: game.match.activeStandId,
      selectValue: document.querySelector('#section-stand')?.value,
      current: document.querySelector('.colony-tile[aria-current="true"]')?.dataset.stand ?? null,
    };
  });
  assert.equal(below.view, 'underground', 'the tile takes the player below');
  assert.equal(below.section.open, true);
  assert.equal(below.active, daughter.standId, 'the view is rebound to the daughter stand');
  assert.equal(Number(below.selectValue), daughter.standId);
  assert.ok(below.section.strands > 0, 'the daughter’s strands are in the section');
  assert.equal(Number(below.current), daughter.standId, 'the visited tile is marked current');

  await page.locator(`.colony-tile[data-stand="${setup.home}"]`).click();
  const home = await page.evaluate(() => {
    const game = window.mycelia.game;
    for (let i = 0; i < 60; i++) game.frame(performance.now() + i * 50, true);
    return { view: game.stage.rig.view, active: game.match.activeStandId, section: game.sectionReport().open };
  });
  assert.equal(home.active, setup.home, 'the home tile returns to the founding stand');
  assert.equal(home.view, 'underground');
  assert.equal(home.section, false, 'the founding colony is shown in its own transect');
  assert.deepEqual(problems, [], 'no page errors');
  console.log(`PASS colonies browser: ${tiles.length} colony tiles, ${reveal.report.strands} strands projected through the floor, daughter tile opens stand ${daughter.standId + 1} below, home tile returns.`);
} finally {
  await browser?.close();
  server.stop();
}
