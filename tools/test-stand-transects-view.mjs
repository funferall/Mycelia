/**
 * Browser check: every stand's underground is the same flat transect as the
 * founding stand's. After the colony crosses an edge no section opens; going
 * below the stand it grew into shows its strands there among that stand's own
 * soil, trees and roots, and clicks there order the same regional body.
 *
 *   npm run build && node tools/test-stand-transects-view.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { collectProblems, gridToPage, launchBrowser } from './browser.mjs';
import { startPreview } from './preview.mjs';

const server = await startPreview(4225);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(300000);
  await page.goto(`${server.url}/?start=best&seed=raven-wood&qa=fast`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  mkdirSync('design/shots', { recursive: true });

  const frames = (n) => page.evaluate((count) => { const g = window.mycelia.game; for (let i = 0; i < count; i++) g.frame(g.lastFrame + 100, i === count - 1); }, n);

  // Cross an edge: the colony is fed while it grows so the crossing is quick.
  const crossed = await page.evaluate(() => {
    const g = window.mycelia.game;
    g.stop();
    document.querySelector('#begin').click();
    for (let s = 0; s < 20; s++) { for (const n of g.sim.player.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6); for (let i = 0; i < 60; i++) g.match.step(1 / 60); }
    document.querySelector('#view-underground').click();
    for (let i = 0; i < 30; i++) g.frame(g.lastFrame + 100, false);
    const site = g.region.stands[g.region.foundingStand];
    const direction = site.sx < g.region.cols - 1 ? 'east' : 'west';
    const result = g.growAcrossStand(direction);
    const body = g.match.spatialColonies.get(g.region.foundingStand);
    let seconds = 0;
    while (body && body.reachedStandIds().length < 2 && seconds < 240) {
      for (const n of body.colony.nodes) if (n.alive) n.carbon = Math.max(n.carbon, 6);
      for (let i = 0; i < 60; i++) g.match.step(1 / 60);
      seconds++;
    }
    for (let i = 0; i < 10; i++) g.frame(g.lastFrame + 100, i === 9);
    return {
      result, section: g.section, panelHidden: document.querySelector('#section-browser')?.hidden ?? true,
      reached: body?.reachedStandIds() ?? [], seconds, founding: g.region.foundingStand,
    };
  });
  assert(crossed.result.ok, crossed.result.message);
  assert.equal(crossed.section, null, 'crossing an edge opens no section');
  assert.equal(crossed.panelHidden, true, 'the section panel stays hidden');
  const neighbour = crossed.reached.find((id) => id !== crossed.founding);
  assert(neighbour !== undefined, `the body reached a neighbouring stand (${crossed.reached})`);

  // Go below the stand it grew into, through the colony tile.
  const below = await page.evaluate((id) => {
    const g = window.mycelia.game;
    const result = g.goToColony(id);
    for (let i = 0; i < 40; i++) g.frame(g.lastFrame + 100, i === 39);
    const view = g.belowView();
    const shown = view.viewSim.player.nodes.filter((n) => n.alive).length;
    const inStand = view.body?.nodesInStand(id).length ?? 0;
    return {
      result, active: g.match.activeStandId, section: g.section, view: g.stage.rig.view,
      shown, inStand, drawn: g.playerMesh.mesh.count,
      trees: g.sim.world.trees.length, roots: g.forest.group.children.length,
      markers: [...g.markerButtons.values()].filter((b) => !b.hidden).map((b) => b.textContent),
    };
  }, neighbour);
  assert(below.result.ok, below.result.message);
  assert.equal(below.active, neighbour, 'the neighbour stand is the one in view');
  assert.equal(below.section, null, 'its underground is a transect, not a section');
  assert.equal(below.view, 'underground');
  assert(below.shown > 0 && below.shown >= below.inStand, `the body's strands in this stand are drawn (${below.shown} shown, ${below.inStand} in stand)`);
  assert(below.drawn > 0, 'the hyphae mesh has strands');
  assert(below.trees > 0 && below.roots > 0, 'the stand shows its own trees and roots');
  await page.screenshot({ path: 'design/shots/transect-grown-into.png', timeout: 60000 });

  // A grow click in this transect orders the same body, toward this stand's roots.
  const target = await page.evaluate(() => {
    const g = window.mycelia.game;
    document.querySelector('[data-order="grow"]').click();
    const tree = g.sim.world.trees.find((t) => !t.dead);
    return { gx: tree.gx + 0.5, gy: 20.5 };
  });
  const at = await gridToPage(page, target.gx, target.gy);
  await page.mouse.click(at.x, at.y);
  const ordered = await page.evaluate(() => {
    const g = window.mycelia.game;
    const body = g.belowView().body;
    const plane = g.match.transectPlane(g.match.activeStandId);
    const waypoint = body.colony.waypoints[0] ?? body.colony.groups?.[0]?.waypoints[0] ?? null;
    return { note: document.querySelector('#order-note')?.textContent ?? '', waypoint, planeY: plane.fixedY, originX: body.originX, standX: plane.originX };
  });
  assert.match(ordered.note, /directed to stand/, `the click ordered the body: ${ordered.note}`);
  assert(ordered.waypoint, 'the body has the waypoint');
  assert(Math.abs(ordered.waypoint.lateral - ordered.planeY) < 1e-6, 'toward this stand\'s transect');
  assert(Math.abs(ordered.originX + ordered.waypoint.gx - (ordered.standX + target.gx)) <= 1, 'at the clicked column of this stand');

  // Every stand can be gone below, and ground no colony has reached shows no strands.
  const empty = await page.evaluate(() => {
    const g = window.mycelia.game;
    const id = g.match.stands.find((s) => !s.sim.hasColony && !s.rivalPresent)?.site.id;
    if (id === undefined) return null;
    const result = g.openSection(id);
    for (let i = 0; i < 20; i++) g.frame(g.lastFrame + 100, i === 19);
    return { id, result, active: g.match.activeStandId, shown: g.belowView().viewSim.player.nodes.filter((n) => n.alive).length, trees: g.sim.world.trees.length };
  });
  assert(empty && empty.result.ok && empty.active === empty.id, `an uncolonized stand can be gone below (${JSON.stringify(empty)})`);
  assert.equal(empty.shown, 0, 'no placeholder strands');
  assert(empty.trees > 0, 'its own trees are there');
  await page.screenshot({ path: 'design/shots/transect-uncolonized.png', timeout: 60000 });

  // The rival's home stand shows the rival's strands in the same style.
  const rival = await page.evaluate(() => {
    const g = window.mycelia.game;
    const id = g.region.rivalStand;
    const result = g.openSection(id);
    for (let i = 0; i < 20; i++) g.frame(g.lastFrame + 100, i === 19);
    return { result, active: g.match.activeStandId, id, visible: g.rivalMesh.group.visible, drawn: g.rivalMesh.mesh.count };
  });
  assert(rival.result.ok && rival.active === rival.id);
  assert(rival.visible && rival.drawn > 0, `the rival is drawn below its stand (${JSON.stringify(rival)})`);
  await page.screenshot({ path: 'design/shots/transect-rival.png', timeout: 60000 });

  assert.deepEqual(problems.filter((p) => !/favicon/.test(p)), [], 'no console errors');
  console.log(`PASS stand transects: crossed into stand ${neighbour + 1} (${below.shown} strands drawn, ${below.markers.length} root labels), grow click ordered the body; uncolonized stand ${empty.id + 1} shows no strands; rival drawn in stand ${rival.id + 1}.`);
} finally {
  await browser?.close();
  server.stop();
}
