/** Browser smoke for promoting a played colony into the shared spatial view. */
import assert from 'node:assert/strict';
import { collectProblems, formatRenderReport, launchBrowser, parseQaPreset, withQaPreset } from './browser.mjs';
import { startPreview } from './preview.mjs';

const qa = parseQaPreset();
const server = await startPreview(4194);
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const problems = collectProblems(page);
  page.setDefaultTimeout(120000);
  await page.goto(withQaPreset(`${server.url}/?seed=old-growth`, qa), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.mycelia?.game?.match));
  await page.evaluate(() => window.mycelia.game.stop());
  const before = await page.evaluate(() => {
    const game = window.mycelia.game;
    return { pose: game.stage.rig.capturePose(), spatial: game.match.spatial };
  });
  assert.equal(before.spatial, null);
  const prepared = await page.evaluate(() => {
    const game = window.mycelia.game;
    const sim = game.match.active.sim;
    const founder = sim.player.nodes[sim.player.rootId];
    const options = sim.world.trees.flatMap(tree => tree.rootTips.map(tip => ({ tree, tip })));
    options.sort((a, b) =>
      Math.hypot(a.tip.gx - founder.gx, a.tip.gy - founder.gy) -
      Math.hypot(b.tip.gx - founder.gx, b.tip.gy - founder.gy));
    const target = options[0];
    if (!sim.growTo(target.tip.gx, target.tip.gy).ok) return false;
    for (let i = 0; i < 120 * 30; i++) {
      game.match.step(1 / 30);
      if (i % 5 === 0 && sim.orderBondTip(target.tree.id, target.tip.id).ok) return true;
    }
    return false;
  });
  assert.equal(prepared, true, 'the ordinary opening can fund a root bond');
  await page.evaluate(() => document.querySelector('#forest-cross').click());
  const opened = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.frame(performance.now(), false);
    return {
      sameBody: game.match.spatial?.colony === game.match.stands[game.match.spatial.originStandId].sim.player,
      sameRegion: game.match.spatial?.region === game.match.region,
      section: game.sectionReport(),
      edges: game.match.spatial?.colonyEdges().length ?? 0,
      view: game.stage.rig.view,
      report: game.renderReport(),
    };
  });
  console.log(formatRenderReport(opened.report));
  assert.equal(opened.sameBody, true, 'the section reads the existing player body');
  assert.equal(opened.sameRegion, true);
  assert.equal(opened.section.open, true);
  assert.ok(opened.section.strands > 0, 'the opened section draws real strands');
  assert.equal(opened.view, 'underground');
  const sectionOrder = await page.evaluate(() => {
    const game = window.mycelia.game;
    const spatial = game.match.spatial;
    const spec = game.section.spec;
    const edge = spatial.colonyEdges().find(entry => entry.key === game.selectedEdgeKey);
    const along = spec.plane.along === 'x' ? edge.to.x : edge.to.y;
    const x = spec.plane.along === 'x' ? along : spec.plane.fixed;
    const y = spec.plane.along === 'x' ? spec.plane.fixed : along;
    const depth = (game.region.heightAt(edge.to.x, edge.to.y) - edge.to.z);
    const target = { x, y, z: game.region.heightAt(x, y) - depth };
    const scene = game.regionToScenePoint(target);
    scene.x += game.sectionView.group.position.x;
    scene.z += game.sectionView.group.position.z;
    const camera = game.stage.rig.camera;
    camera.updateMatrixWorld();
    const ndc = scene.project(camera);
    const rect = game.canvas.getBoundingClientRect();
    const clientX = rect.left + (ndc.x + 1) * rect.width / 2;
    const clientY = rect.top + (1 - ndc.y) * rect.height / 2;
    const resolved = game.sectionPointAt(clientX, clientY);
    game.ui.setActiveOrder('grow');
    game.applyOrderAt(clientX, clientY);
    const note = document.querySelector('#order-note').textContent;
    spatial.orderAcross();
    return { resolved, target, note };
  });
  assert.ok(sectionOrder.resolved, 'a section click resolves to regional XYZ');
  assert.ok(Math.hypot(sectionOrder.resolved.x - sectionOrder.target.x, sectionOrder.resolved.y - sectionOrder.target.y) < 1e-5);
  assert.match(sectionOrder.note, /Frontier directed/);
  const crossed = await page.evaluate(() => {
    const game = window.mycelia.game;
    const spatial = game.match.spatial;
    for (let i = 0; i < 360 * 30 && spatial.portals().length === 0; i++) game.match.step(1 / 30);
    game.refreshSpatialViews();
    const edge = spatial.colonyEdges().find(entry => entry.standId !== entry.parentStandId);
    if (!edge) return null;
    const originSection = game.sectionHolding(edge, edge.parentStandId);
    const opened = game.openSection(edge.parentStandId, originSection?.id);
    game.selectedEdgeKey = edge.key;
    const followed = game.followConnection();
    return {
      opened: opened.ok,
      followed: followed.ok,
      destination: spatial.destinationStandId,
      sectionStand: game.section?.spec.standId,
      edge: edge.key,
      growth: game.match.growthCrossings.length,
      colonization: game.match.colonization.length,
      strand: game.strandCheck(edge.key),
    };
  });
  assert.ok(crossed, 'the naturally bonded match crossed the seam');
  assert.equal(crossed.opened, true);
  assert.equal(crossed.followed, true, 'Follow opens the same edge in the next stand');
  assert.equal(crossed.sectionStand, crossed.destination);
  assert.equal(crossed.growth, 1);
  assert.equal(crossed.colonization, 0);
  assert.ok(crossed.strand.section && crossed.strand.projected);
  await page.evaluate(() => document.querySelector('#section-return').click());
  const returned = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.frame(performance.now(), false);
    return {
      pose: game.stage.rig.capturePose(),
      view: game.stage.rig.view,
      soilVisible: game.soil.group.visible,
      networkVisible: game.playerMesh.group.visible,
      streamVisible: game.stream.group.visible,
    };
  });
  assert.equal(returned.view, 'forest');
  assert.ok(Math.abs(returned.pose.sceneX - before.pose.sceneX) < 1e-5);
  assert.ok(Math.abs(returned.pose.sceneZ - before.pose.sceneZ) < 1e-5);
  assert.equal(returned.soilVisible, false, 'the first forest frame hides the local soil');
  assert.equal(returned.networkVisible, false, 'the first forest frame hides the local underground network');
  assert.equal(returned.streamVisible, true, 'the first forest frame restores the surface stream');
  await page.evaluate(() => document.querySelector('#forest-reveal').click());
  const reveal = await page.evaluate(() => {
    const game = window.mycelia.game;
    game.refreshSpatialViews();
    return game.revealReport();
  });
  assert.equal(reveal.enabled, true);
  assert.equal(reveal.strands, await page.evaluate(() => window.mycelia.game.match.spatial.colonyEdges().length), 'forest and section read one graph');
  const picked = await page.evaluate((key) => {
    const game = window.mycelia.game;
    const strand = game.reveal.strandFor(key);
    const middle = strand.points[Math.floor(strand.points.length / 2)];
    const scene = game.regionToScenePoint(middle);
    scene.x += game.reveal.group.position.x;
    scene.z += game.reveal.group.position.z;
    const camera = game.stage.rig.camera;
    camera.updateMatrixWorld();
    const ndc = scene.project(camera);
    const rect = game.canvas.getBoundingClientRect();
    const x = rect.left + (ndc.x + 1) * rect.width / 2;
    const y = rect.top + (1 - ndc.y) * rect.height / 2;
    const hit = game.pickStrandAt(x, y);
    return { hit, pick: game.revealReport().pick, section: game.sectionReport() };
  }, crossed.edge);
  assert.equal(picked.hit, true, 'a projected strand resolves to a real edge');
  assert.equal(picked.section.open, true);
  assert.equal(picked.section.edge, picked.pick.key);
  assert.deepEqual(problems, [], 'no page errors');
  console.log('PASS regional spatial browser: adopted body, natural seam, section follow, forest return, reveal pick');
} finally {
  await browser?.close();
  server.stop();
}
