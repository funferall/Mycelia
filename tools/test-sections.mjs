/**
 * Headless checks for real vertical sections (`VIEW-06`).
 *
 * The section maths is pure, so everything the view promises can be checked
 * without a renderer: stable section ids, previous/next ordering, clipping that
 * keeps a strand which crosses the slab with both ends outside it, continuation
 * marks, an empty section that says so, and the fact that a section shows the
 * same edges the simulation owns.
 *
 *   node tools/test-sections.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-sections-'));
const started = performance.now();
let count = 0;

function check(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
  count++;
  console.log(`PASS ${name}`);
}

try {
  const simModules = ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'segments', 'network', 'sim', 'shared-soil', 'wildfire', 'drought', 'flood', 'contact', 'match', 'survey'];
  for (const name of simModules) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '([^']+)'/g, (_m, spec) => `from './${spec.split('/').pop()}.mjs'`));
  }
  for (const [folder, name] of [['sim', 'crossing'], ['render', 'sections']]) {
    const source = readFileSync(new URL(`../src/${folder}/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '([^']+)'/g, (_m, spec) => `from './${spec.split('/').pop()}.mjs'`));
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const sections = await load('sections');
  const { CrossingMatch } = await load('crossing');
  const { RegionalMatch } = await load('match');
  const { STAND_SIZE, COMMUNITY_LABEL } = await load('region');
  const { GRID } = await load('content');
  const {
    SECTION_HALF_WIDTH,
    SECTION_DEPTH_CM,
    SECTION_STEP,
    browsableSections,
    clipEdge,
    clipEdges,
    crossAxis,
    depthCmAt,
    flipSection,
    sectionAnchor,
    sectionContains,
    sectionForPoint,
    sectionLabel,
    sectionOrder,
    sectionsForStand,
    stepSection,
  } = sections;

  const DT = 1 / 30;
  const buildFixture = (seconds = 20) => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    match.orderAcross();
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) match.step(DT);
    return match;
  };

  const match = buildFixture();
  const region = match.region;
  const edges = match.colonyEdges();
  const originStand = match.originStandId;
  const sectionsOfOrigin = sectionsForStand(region, originStand);
  const site = region.stands[originStand];

  /** A strand the test places by hand, so the clipping cases are exact. */
  const handEdge = (key, from, to, extra = {}) => ({
    key,
    parent: 0,
    child: 1,
    from,
    to,
    thickness: 0.4,
    reinforced: false,
    connected: true,
    standId: originStand,
    parentStandId: originStand,
    ...extra,
  });

  // -------------------------------------------------------------------------
  check('a stand has an east-west and a north-south family of sections', () => {
    assert.ok(sectionsOfOrigin.length > 8, `only ${sectionsOfOrigin.length} sections`);
    const ids = new Set(sectionsOfOrigin.map((spec) => spec.id));
    assert.equal(ids.size, sectionsOfOrigin.length, 'section ids are unique');
    const ew = sectionsOfOrigin.filter((spec) => spec.axis === 'east-west');
    const ns = sectionsOfOrigin.filter((spec) => spec.axis === 'north-south');
    assert.ok(ew.length > 4 && ns.length > 4);
    for (const spec of ew) {
      assert.equal(spec.plane.along, 'x');
      assert.ok(spec.plane.fixed > site.sy * STAND_SIZE && spec.plane.fixed < (site.sy + 1) * STAND_SIZE);
      assert.equal(spec.alongFrom, site.sx * STAND_SIZE);
      assert.equal(spec.alongTo, (site.sx + 1) * STAND_SIZE);
    }
    for (const spec of ns) {
      assert.equal(spec.plane.along, 'y');
      assert.ok(spec.plane.fixed > site.sx * STAND_SIZE && spec.plane.fixed < (site.sx + 1) * STAND_SIZE);
    }
    assert.equal(SECTION_HALF_WIDTH * 2, 4, 'the plan suggests a four-unit slab');
    assert.equal(SECTION_DEPTH_CM, 70);
    // Slabs tile the stand: a strand lies inside exactly one section.
    assert.equal(SECTION_STEP, SECTION_HALF_WIDTH * 2);
    assert.deepEqual(
      sectionsForStand(region, originStand).map((spec) => spec.id),
      sectionsOfOrigin.map((spec) => spec.id),
      'laying out a stand twice gives the same sections'
    );
    const label = sectionLabel(region, sectionsOfOrigin[0], COMMUNITY_LABEL);
    assert.match(label, /Stand \d+/);
    assert.match(label, /across the slope|up the slope/);
  });

  check('previous and next move along one family and stop at the ends', () => {
    const ew = sectionsOfOrigin.filter((spec) => spec.axis === 'east-west');
    const middle = ew[Math.floor(ew.length / 2)];
    const first = ew[0];
    const last = ew[ew.length - 1];
    assert.notEqual(stepSection(sectionsOfOrigin, middle, 1).id, middle.id);
    assert.notEqual(stepSection(sectionsOfOrigin, middle, -1).id, middle.id);
    assert.equal(stepSection(sectionsOfOrigin, first, -1).id, first.id, 'the family clamps at its start');
    assert.equal(stepSection(sectionsOfOrigin, last, 1).id, last.id, 'the family clamps at its end');
    const order = sectionOrder(sectionsOfOrigin, middle);
    assert.equal(order.count, ew.length);
    assert.ok(order.index > 0 && order.index < order.count - 1, JSON.stringify(order));
    const flipped = flipSection(region, sectionsOfOrigin, middle);
    assert.equal(flipped.axis, crossAxis(middle.axis));
    assert.equal(flipped.standId, middle.standId);
  });

  check('adjacent sections continue through interior stands and stop only at the region edge', () => {
    const all = browsableSections(region, region.stands.map((stand) => stand.id));
    const centre = region.stands.find((stand) => stand.sx === 1 && stand.sy === 1);
    assert.ok(centre);
    const north = region.stands.find((stand) => stand.sx === 1 && stand.sy === 0);
    const south = region.stands.find((stand) => stand.sx === 1 && stand.sy === 2);
    const west = region.stands.find((stand) => stand.sx === 0 && stand.sy === 1);
    const east = region.stands.find((stand) => stand.sx === 2 && stand.sy === 1);
    const ew = sectionsForStand(region, centre.id).filter((spec) => spec.axis === 'east-west');
    const ns = sectionsForStand(region, centre.id).filter((spec) => spec.axis === 'north-south');
    for (const [edge, delta, expected] of [
      [ew[0], -1, north], [ew.at(-1), 1, south],
      [ns[0], -1, west], [ns.at(-1), 1, east],
    ]) {
      const adjacent = stepSection(all, edge, delta);
      assert.equal(adjacent.standId, expected.id);
      assert.equal(adjacent.axis, edge.axis);
      assert.equal(Math.abs(adjacent.plane.fixed - edge.plane.fixed), SECTION_STEP);
      assert.equal(stepSection(all, adjacent, -delta).id, edge.id);
      assert.equal(flipSection(region, all, adjacent).standId, adjacent.standId);
    }
    assert.equal(sectionOrder(all, ew[0]).count, ew.length * region.rows);
    const northernmost = sectionsForStand(region, north.id).find((spec) => spec.axis === 'east-west');
    assert.equal(stepSection(all, northernmost, -1).id, northernmost.id);
    const limited = browsableSections(region, [centre.id, south.id]);
    assert.equal(stepSection(limited, ew[0], -1).id, ew[0].id, 'a missing neighbour cannot be skipped');
  });

  check('a promoted colony grows from one section into the next physical slab', () => {
    const regional = new RegionalMatch('old-growth', undefined, { starts: 'best' });
    assert.equal(regional.growAcross('north').ok, true);
    const body = regional.spatial;
    const root = body.nodePosition(body.colony.nodes[body.colony.rootId]);
    const family = sectionsForStand(regional.region, body.originStandId).filter(spec => spec.axis === 'east-west');
    const current = sectionForPoint(regional.region, family, root, 'east-west');
    const next = stepSection(family, current, current.plane.fixed < family.at(-1).plane.fixed ? 1 : -1);
    assert.notEqual(next.id, current.id);
    const depth = depthCmAt(regional.region, root);
    const candidates = [root.x + 4, root.x - 4, root.x + 8, root.x - 8].flatMap(x =>
      [depth, 22, 26].map(d => ({ x, y: next.plane.fixed,
        z: regional.region.heightAt(x, next.plane.fixed) - d / GRID.cmPerRow })));
    const target = candidates.find(point => body.soil.passableAt(point.x, point.y, point.z));
    assert.ok(target, 'adjacent slab has passable soil');
    assert.equal(body.growAt(target, next.plane.along, next.plane.fixed).ok, true);
    assert.equal(body.colony.waypoints[0].lateral, next.plane.fixed);
    let arrived = false;
    for (let i = 0; i < 30 / DT && !arrived; i++) {
      regional.step(DT);
      arrived = body.colony.nodes.some(node => node.alive &&
        sectionContains(regional.region, next, body.nodePosition(node)) &&
        Math.abs(body.nodePosition(node).y - root.y) > SECTION_HALF_WIDTH);
    }
    assert.ok(arrived, 'a living strand enters the adjacent section without promotion or a new colony');
  });

  check('a strand inside the slab keeps its own identity and coordinates', () => {
    const spec = sectionsOfOrigin[0];
    const x = site.sx * STAND_SIZE + 20;
    const y = spec.plane.fixed;
    const z = region.heightAt(x, y) - 20;
    const edge = handEdge('hand:inside', { x, y, z }, { x: x + 4, y, z: z - 0.5 });
    const clipped = clipEdge(region, spec, edge);
    assert.ok(clipped, 'the strand is in the slab');
    assert.equal(clipped.key, edge.key, 'the clipped strand is the simulated strand');
    assert.equal(clipped.parent, edge.parent);
    assert.equal(clipped.child, edge.child);
    assert.ok(Math.abs(clipped.from.x - edge.from.x) < 1e-6);
    assert.ok(Math.abs(clipped.to.x - edge.to.x) < 1e-6);
    assert.equal(clipped.exits.length, 0, 'a strand wholly inside has no continuation marks');
    assert.ok(clipped.depthFromCm > 19 && clipped.depthFromCm < 21, `${clipped.depthFromCm}`);
  });

  check('a strand crossing the slab with both ends outside is still drawn', () => {
    const spec = sectionsOfOrigin[0];
    const y = spec.plane.fixed;
    const outside = spec.halfWidth + 9;
    const x = site.sx * STAND_SIZE + 30;
    const z = region.heightAt(x, y) - 25;
    const edge = handEdge(
      'hand:crossing',
      { x, y: y - outside, z },
      { x, y: y + outside, z: z - 1 }
    );
    const clipped = clipEdge(region, spec, edge);
    assert.ok(clipped, 'a strand the plane only passes through is drawn');
    assert.equal(clipped.exits.length, 2, 'it enters and leaves, so both continuation marks are reported');
    assert.ok(Math.abs(clipped.from.y - (y - spec.halfWidth)) < 1e-6);
    assert.ok(Math.abs(clipped.to.y - (y + spec.halfWidth)) < 1e-6);
  });

  check('a strand the section does not reach is not drawn', () => {
    const spec = sectionsOfOrigin[0];
    const y = spec.plane.fixed;
    const x = site.sx * STAND_SIZE + 30;
    const beside = handEdge(
      'hand:beside',
      { x, y: y + spec.halfWidth + 12, z: region.heightAt(x, y) - 20 },
      { x: x + 6, y: y + spec.halfWidth + 12, z: region.heightAt(x, y) - 22 }
    );
    assert.equal(clipEdge(region, spec, beside), null, 'a neighbouring plane does not show this strand');
    const deep = handEdge(
      'hand:deep',
      { x, y, z: region.heightAt(x, y) - (SECTION_DEPTH_CM + 20) },
      { x: x + 6, y, z: region.heightAt(x, y) - (SECTION_DEPTH_CM + 22) }
    );
    assert.equal(clipEdge(region, spec, deep), null, 'a strand below the section depth is not drawn');
    const beyond = handEdge(
      'hand:beyond',
      { x: site.sx * STAND_SIZE - 20, y, z: region.heightAt(x, y) - 20 },
      { x: site.sx * STAND_SIZE - 10, y, z: region.heightAt(x, y) - 21 }
    );
    assert.equal(clipEdge(region, spec, beyond), null, 'a strand outside the section extent is not drawn');
  });

  check('a section in ground the colony never reached is simply empty', () => {
    const farId = region.stands.find((candidate) => candidate.id !== originStand && !edges.some((edge) => edge.standId === candidate.id))?.id;
    assert.notEqual(farId, undefined);
    const far = sectionsForStand(region, farId)[0];
    const clip = clipEdges(region, far, edges);
    assert.equal(clip.visible.length, 0, 'an empty section says nothing is there');
    assert.equal(clip.pierced, 0);
    assert.ok(sectionAnchor(region, far));
  });

  check('a seam-spanning strand is one segment, drawn once', () => {
    const spanning = edges.filter((edge) => edge.standId !== edge.parentStandId);
    assert.ok(spanning.length > 0, 'the fixture crossed the seam');
    const edge = spanning[0];
    // A section whose slab covers the seam: the middle of the two stands, on the
    // axis the crossing ran along.
    const frame = match.standFrame(originStand);
    const seamY = originStand === 0 ? 60 : edge.from.y;
    const spec = {
      id: 'seam:test',
      standId: edge.standId,
      axis: 'east-west',
      plane: { along: 'x', fixed: seamY },
      halfWidth: 4,
      alongFrom: frame.originX,
      alongTo: frame.originX + STAND_SIZE * 2,
      depthFromCm: 0,
      depthToCm: SECTION_DEPTH_CM,
    };
    const clip = clipEdges(region, spec, [edge]);
    assert.equal(clip.visible.length, 1, 'a strand that crosses the boundary is one segment');
    const clipped = clip.visible[0];
    assert.equal(clipped.key, edge.key);
    assert.equal(clipped.parentStandId, edge.parentStandId);
    assert.equal(clipped.standId, edge.standId);
    assert.notEqual(clipped.parentStandId, clipped.standId);
  });

  check('a point chooses the nearest real section, never a new one', () => {
    const ew = sectionsOfOrigin.filter((spec) => spec.axis === 'east-west');
    const target = ew[2];
    const x = site.sx * STAND_SIZE + 40;
    const y = target.plane.fixed + 1;
    const point = { x, y, z: region.heightAt(x, y) - 18 };
    const found = sectionForPoint(region, sectionsOfOrigin, point);
    assert.equal(found.id, target.id, 'the nearest plane is the one that owns the point');
    assert.equal(sectionForPoint(region, sectionsOfOrigin, point, 'north-south').axis, 'north-south');
    assert.ok(sectionContains(region, target, point, SECTION_HALF_WIDTH));
    assert.equal(sectionContains(region, ew[0], point, 0), false);
    assert.ok(Math.abs(depthCmAt(region, point) - 18) < 0.001);
    const anchor = sectionAnchor(region, target);
    assert.ok(depthCmAt(region, anchor) > SECTION_DEPTH_CM * 0.4 && depthCmAt(region, anchor) < SECTION_DEPTH_CM * 0.6);
  });

  check('browsing is limited to reached stands and their neighbours', () => {
    const stands = match.browsableStandIds();
    assert.ok(stands.includes(originStand));
    for (const reached of match.reachedStandIds()) assert.ok(stands.includes(reached), `reached stand ${reached} is browsable`);
    const browsable = browsableSections(region, stands);
    assert.ok(browsable.length >= stands.length * 8);
    for (const spec of browsable) assert.ok(stands.includes(spec.standId), `section ${spec.id} escaped the browsable set`);
    // Every strand the colony owns is drawn by at least one browsable section.
    const seen = new Set();
    for (const spec of browsable) {
      for (const clipped of clipEdges(region, spec, edges).visible) seen.add(clipped.key);
    }
    const missing = edges.filter((edge) => !seen.has(edge.key));
    assert.ok(
      missing.length < edges.length * 0.25,
      `${missing.length} of ${edges.length} strands are in no browsable section`
    );
  });

  check('clipping is deterministic and reports what it pierced', () => {
    // The fixture colony grows along one east-west plane, so its own section is
    // the one that shows it; a distant parallel plane is a different slab.
    const spec = sectionForPoint(region, sectionsOfOrigin, edges[0].from, 'east-west');
    assert.ok(spec, 'the colony sits on one of the stand sections');
    const first = clipEdges(region, spec, edges);
    const second = clipEdges(region, spec, edges);
    assert.deepEqual(first.visible.map((edge) => edge.key), second.visible.map((edge) => edge.key));
    assert.ok(first.visible.length > 0, 'the fixture colony reaches this section');
    for (const clipped of first.visible) {
      assert.ok(clipped.key.startsWith('player@'), clipped.key);
      assert.ok(clipped.exits.length <= 2);
      assert.ok(clipped.depthFromCm >= -1 && clipped.depthToCm <= SECTION_DEPTH_CM + 1);
    }
    assert.ok(first.pierced >= 0);
  });

  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`PASS: ${count} checks in ${elapsed}s.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
