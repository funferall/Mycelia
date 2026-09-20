/**
 * Headless checks for the forest network reveal (`VIEW-07`).
 *
 * The projection and the picking rule are pure, so they can be checked without
 * a renderer: horizontal positions are the simulation's own, the drawn height
 * is the terrain plus a stated offset, the recorded depth is the strand's real
 * depth, a seam crossing stays one continuous line, and a stack of strands under
 * one click is reported rather than guessed at.
 *
 *   node tools/test-reveal.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-reveal-'));
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
  const simModules = ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'network', 'sim', 'match', 'survey'];
  for (const name of simModules) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '([^']+)'/g, (_m, spec) => `from './${spec.split('/').pop()}.mjs'`));
  }
  for (const [folder, name] of [['sim', 'crossing'], ['render', 'sections'], ['render', 'network-reveal']]) {
    const source = readFileSync(new URL(`../src/${folder}/${name}.ts`, import.meta.url), 'utf8');
    // network-reveal imports Three.js for its drawing half; the checks here use
    // its pure half only, so the import is stubbed out of the compiled copy.
    const compiled = stripTypeScriptTypes(source)
      .replace(/from '([^']+)'/g, (_m, spec) => (spec === 'three' ? "from './three-stub.mjs'" : `from './${spec.split('/').pop()}.mjs'`));
    writeFileSync(join(output, `${name}.mjs`), compiled);
  }
  writeFileSync(
    join(output, 'three-stub.mjs'),
    'export class Group {}\nexport class BufferGeometry {}\nexport class BufferAttribute {}\nexport class LineBasicMaterial {}\nexport class LineSegments {}\n'
  );
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const reveal = await load('network-reveal');
  const { CrossingMatch } = await load('crossing');
  const { STAND_SIZE } = await load('region');
  const {
    REVEAL_LIFT,
    depthBelowGroundCm,
    pickStrand,
    projectEdge,
    projectEdges,
    projectionSamples,
    strandWeight,
  } = reveal;

  const DT = 1 / 30;
  const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
  match.orderAcross();
  for (let i = 0; i < Math.round(20 / DT); i++) match.step(DT);
  const region = match.region;
  const edges = match.colonyEdges();
  const snapshot = JSON.stringify(edges);

  // -------------------------------------------------------------------------
  check('detail falls with distance and never removes a strand', () => {
    assert.ok(projectionSamples(120) > projectionSamples(900), 'close strands are drawn in more detail');
    assert.equal(projectionSamples(1e9), 2);
    assert.equal(projectionSamples(NaN), 8);
    const far = projectEdges(region, edges, 1e9);
    const near = projectEdges(region, edges, 80);
    assert.equal(far.length, edges.length, 'every strand is still drawn when far away');
    assert.equal(near.length, edges.length);
    assert.ok((near[0].points.length ?? 0) >= (far[0].points.length ?? 0));
  });

  check('the projection keeps real horizontal positions and real depths', () => {
    for (const edge of edges.slice(0, 40)) {
      const strand = projectEdge(region, edge, 9);
      const first = strand.points[0];
      const last = strand.points[strand.points.length - 1];
      assert.ok(Math.abs(first.x - edge.from.x) < 1e-9, 'the first sample is the parent end');
      assert.ok(Math.abs(first.y - edge.from.y) < 1e-9);
      assert.ok(Math.abs(last.x - edge.to.x) < 1e-9, 'the last sample is the child end');
      assert.ok(Math.abs(last.y - edge.to.y) < 1e-9);
      for (let i = 0; i < strand.points.length; i++) {
        const point = strand.points[i];
        assert.ok(
          Math.abs(point.z - (region.heightAt(point.x, point.y) + REVEAL_LIFT)) < 1e-9,
          'the drawn height is the terrain plus the stated offset'
        );
        // The depth recorded for each sample is the strand's own depth, not the
        // lift the projection is drawn at.
        assert.ok(strand.depthsCm[i] > 0, `sample ${i} records a real depth (${strand.depthsCm[i]})`);
      }
      assert.ok(Math.abs(depthBelowGroundCm(region, edge.from) - strand.fromDepthCm) < 1e-9);
      assert.ok(Math.abs(depthBelowGroundCm(region, edge.to) - strand.toDepthCm) < 1e-9);
    }
  });

  check('a strand that crosses a stand seam stays one continuous line', () => {
    const spanning = edges.filter((edge) => edge.standId !== edge.parentStandId);
    assert.ok(spanning.length > 0, 'the fixture crossed the seam');
    for (const edge of spanning.slice(0, 12)) {
      const strand = projectEdge(region, edge, 12);
      assert.equal(strand.parentStandId, edge.parentStandId);
      assert.equal(strand.standId, edge.standId);
      for (let i = 1; i < strand.points.length; i++) {
        const a = strand.points[i - 1];
        const b = strand.points[i];
        const step = Math.hypot(b.x - a.x, b.y - a.y);
        const whole = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
        assert.ok(step <= whole / (strand.points.length - 1) + 1e-6, 'the samples are in order with no jump');
      }
      // Crossing the seam is not a break: the drawn line spans both sides.
      const xs = strand.points.map((point) => point.x);
      const seam = edge.parentStandId < edge.standId ? (edge.parentStandId + 1) * STAND_SIZE : edge.parentStandId * STAND_SIZE;
      assert.ok(Math.min(...xs) < seam && Math.max(...xs) > seam, 'the projection straddles the seam');
    }
  });

  check('depth and connectedness read as weight, not as colour alone', () => {
    const shallow = strandWeight(5, true, false);
    const deep = strandWeight(60, true, false);
    const deeper = strandWeight(120, true, false);
    assert.ok(shallow > deep && deep > deeper, 'deeper strands are dimmer');
    assert.ok(strandWeight(20, true, false) > strandWeight(20, false, false), 'a severed strand is dimmer');
    assert.ok(strandWeight(20, true, true) > strandWeight(20, true, false), 'a cord reads brighter than a hair');
    assert.ok(deeper > 0.5, `nothing is drawn invisibly dim (${deeper.toFixed(3)})`);
  });

  check('a click picks the strand under it and reports stacked alternatives', () => {
    const strands = projectEdges(region, edges, 200);
    // A plain projector: the region's own (x, y) mapped straight into NDC, so
    // the check is about the picking rule and not about a camera.
    const project = (point) => ({
      x: (point.x / (region.cols * STAND_SIZE)) * 2 - 1,
      y: (point.y / (region.rows * STAND_SIZE)) * 2 - 1,
    });
    const targetStrand = strands.find((strand) => strand.connected) ?? strands[0];
    const middle = targetStrand.points[Math.floor(targetStrand.points.length / 2)];
    const target = project(middle);
    const picked = pickStrand(strands, project, target, 0.02);
    assert.ok(picked, 'the click lands on a strand');
    assert.ok(picked.depthCm > 0, 'the pick carries the real depth');
    assert.ok(strands.some((strand) => strand.key === picked.key));
    // Deterministic under reordering.
    const reordered = pickStrand([...strands].reverse(), project, target, 0.02);
    assert.equal(reordered.key, picked.key);
    // A click in empty space picks nothing.
    assert.equal(pickStrand(strands, project, { x: 5, y: 5 }, 0.02), null);
    // Two strands under one click: the shallowest is chosen and the other is
    // reported rather than silently dropped.
    const shallow = { ...targetStrand, key: 'test:shallow', depthsCm: targetStrand.depthsCm.map(() => 6) };
    const deep = { ...targetStrand, key: 'test:deep', depthsCm: targetStrand.depthsCm.map(() => 44) };
    const stacked = pickStrand([deep, shallow], project, target, 0.02);
    assert.equal(stacked.key, 'test:shallow');
    assert.equal(stacked.alternatives, 1);
    assert.ok(Math.abs(stacked.depthCm - 6) < 1e-9);
  });

  check('projecting changes nothing about the simulation', () => {
    assert.equal(JSON.stringify(edges), snapshot, 'the edge list is untouched');
    const before = match.hash();
    projectEdges(region, edges, 150);
    const strands = projectEdges(region, edges, 150);
    pickStrand(strands, (point) => ({ x: point.x / 100, y: point.y / 100 }), { x: 0, y: 0 }, 0.05);
    assert.equal(match.hash(), before, 'reading the network changes no state');
    // Every strand names a real edge of the colony, once.
    const keys = new Set(strands.map((strand) => strand.key));
    assert.equal(keys.size, strands.length);
    for (const edge of edges) assert.ok(keys.has(edge.key), `${edge.key} is projected`);
  });

  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`PASS: ${count} checks in ${elapsed}s.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
