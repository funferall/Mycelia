/**
 * Headless checks for the shared spatial coordinates (`MAP-14` stage 1).
 *
 * These are pure-coordinate checks: no match, no renderer, no browser. They
 * exist to fix the conventions the rest of the spatial work depends on, so a
 * later section, cord or reveal cannot quietly disagree about where a place is.
 *
 *   node tools/test-spatial.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-spatial-'));
const started = performance.now();
let count = 0;

function check(name, fn) {
  fn();
  count++;
  console.log(`PASS ${name}`);
}

try {
  for (const name of ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume']) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '(.+?)'/g, "from '$1.mjs'"));
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const spatial = await load('spatial');
  const soilModule = await load('soil-volume');
  const { createRegion, STAND_SIZE } = await load('region');
  const { GRID } = await load('content');
  const { mulberry32 } = await load('rng');
  const {
    SPATIAL_VERSION,
    VOXEL_SIZE,
    RENDER_FLOOR,
    depthCmAt,
    distanceCm,
    elevationAtDepthCm,
    fromRender,
    insideRegion,
    neighbourStand,
    regionSpanX,
    regionSpanY,
    refKey,
    rootTipSectionPosition,
    rowDepthCm,
    segmentCrossesStandBoundary,
    segmentLeavesRegion,
    segmentStands,
    standFrameOf,
    standIdAt,
    standSideCoordinate,
    toRender,
    treeLocalOffset,
    treeSectionPosition,
    treeSpatialPosition,
    traverseSegment,
    vec3,
    voxelKeyOf,
    voxelKeyText,
  } = spatial;

  const region = createRegion('raven-wood');
  const grid = { cols: region.cols, rows: region.rows };

  // -------------------------------------------------------------------------
  check('the coordinate conventions carry a version and a documented voxel', () => {
    assert.equal(SPATIAL_VERSION, 1);
    assert.equal(VOXEL_SIZE, 1);
    assert.equal(typeof SPATIAL_VERSION, 'number');
  });

  check('stand ownership is half-open, finite and never clamped', () => {
    assert.equal(standIdAt(grid, 0, 0), 0);
    assert.equal(standIdAt(grid, STAND_SIZE - 0.001, 0), 0);
    // The seam belongs to the eastern square, and to the southern one.
    assert.equal(standIdAt(grid, STAND_SIZE, 0), 1);
    assert.equal(standIdAt(grid, 0, STAND_SIZE), grid.cols);
    assert.equal(standIdAt(grid, STAND_SIZE - 1, STAND_SIZE - 1), 0);
    // Outside and non-finite positions are invalid rather than clamped.
    assert.equal(standIdAt(grid, -1, 10), null);
    assert.equal(standIdAt(grid, 10, -1), null);
    assert.equal(standIdAt(grid, regionSpanX(grid), 10), null);
    assert.equal(standIdAt(grid, 10, regionSpanY(grid)), null);
    assert.equal(standIdAt(grid, NaN, 10), null);
    assert.equal(standIdAt(grid, Infinity, 10), null);
    assert.equal(insideRegion(grid, 0, 0), true);
    assert.equal(insideRegion(grid, regionSpanX(grid) - 0.001, regionSpanY(grid) - 0.001), true);
    assert.equal(insideRegion(grid, regionSpanX(grid) - 0.001, regionSpanY(grid)), false);
  });

  check('all four edges of a square resolve to the same seam from either side', () => {
    const frame = standFrameOf(grid, grid.cols + 1);
    assert.equal(frame.sx, 1);
    assert.equal(frame.sy, 1);
    for (const [side, opposite] of [
      ['east', 'west'],
      ['west', 'east'],
      ['north', 'south'],
      ['south', 'north'],
    ]) {
      const other = neighbourStand(grid, frame, side);
      assert.notEqual(other, null, `${side} neighbour exists`);
      const otherFrame = standFrameOf(grid, other);
      // East/west share a vertical line, north/south a horizontal one; the
      // numbers are the same from both frames.
      const mine = standSideCoordinate(frame, side);
      const theirs = standSideCoordinate(otherFrame, opposite);
      assert.equal(mine, theirs, `${side} seam coordinate`);
    }
    // A frame with no neighbour on a side reports null rather than wrapping.
    const corner = standFrameOf(grid, 0);
    assert.equal(neighbourStand(grid, corner, 'west'), null);
    assert.equal(neighbourStand(grid, corner, 'north'), null);
  });

  check('depth and elevation round-trip, and a seam does not move the ground', () => {
    const seamX = STAND_SIZE;
    const y = 40.5;
    const height = region.heightAt(seamX, y);
    // The same absolute elevation is at the same depth whichever square is
    // asked, because there is one heightfield and no per-stand datum.
    assert.ok(Math.abs(region.heightAt(seamX - 1e-6, y) - region.heightAt(seamX + 1e-6, y)) < 0.01);
    assert.equal(depthCmAt(region, seamX, y, height), 0);
    for (const depth of [0, 8, 26.5, 111.5]) {
      const z = elevationAtDepthCm(region, seamX, y, depth);
      assert.ok(Math.abs(depthCmAt(region, seamX, y, z) - depth) < 1e-9, `depth ${depth}`);
    }
    // A stand's own frame adds nothing to elevation.
    const frame = standFrameOf(grid, 1);
    const x = frame.originX + 20;
    assert.equal(elevationAtDepthCm(region, x, y, 30), region.heightAt(x, y) - 30);
  });

  check('the render adapter is invertible with and without vertical exaggeration', () => {
    const origin = { originX: 100, originY: 20, floor: RENDER_FLOOR };
    for (const exaggeration of [1, 2.5]) {
      const point = vec3(143.25, 61.75, -3.5);
      const render = toRender(point, origin, exaggeration);
      assert.equal(render.x, point.x - origin.originX);
      assert.equal(render.z, origin.originY - point.y);
      assert.equal(render.y, origin.floor + point.z * exaggeration);
      const back = fromRender(render, origin, exaggeration);
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(back[axis] - point[axis]) < 1e-9, `${axis} round trip`);
      }
    }
  });

  check('voxel keys are global and independent of any stand', () => {
    assert.deepEqual(voxelKeyOf(vec3(12.4, 3.9, -0.2)), { ix: 12, iy: 3, iz: -1 });
    assert.equal(voxelKeyText({ ix: 12, iy: 3, iz: -1 }), '12,3,-1');
    // A place on a seam has one key, not one per stand that can see it.
    const west = vec3(STAND_SIZE - 0.5, 40.5, 0);
    const east = vec3(STAND_SIZE + 0.5, 40.5, 0);
    assert.notEqual(voxelKeyText(voxelKeyOf(west)), voxelKeyText(voxelKeyOf(east)));
    assert.equal(standIdAt(grid, west.x, west.y), 0);
    assert.equal(standIdAt(grid, east.x, east.y), 1);
  });

  check('segment traversal covers every crossed cell and never skips an edge', () => {
    // A diagonal step through a corner visits every cell meeting there, so a
    // diagonal is never allowed to tunnel between two others.
    const diagonal = traverseSegment(vec3(0.5, 0.5, 0.5), vec3(1.5, 1.5, 1.5));
    const keys = diagonal.map(voxelKeyText);
    for (const expected of ['0,0,0', '1,0,0', '0,1,0', '0,0,1', '1,1,0', '1,0,1', '0,1,1', '1,1,1']) {
      assert.ok(keys.includes(expected), `diagonal visits ${expected} (saw ${keys.join(' ')})`);
    }
    // The planar case a stand corner actually produces.
    const corner = traverseSegment(vec3(0.5, 0.5, 40), vec3(1.5, 1.5, 40)).map(voxelKeyText);
    for (const expected of ['0,0,40', '1,0,40', '0,1,40', '1,1,40']) {
      assert.ok(corner.includes(expected), `corner visits ${expected} (saw ${corner.join(' ')})`);
    }
    // A long segment tests the cells in between, not just its endpoints.
    const long = traverseSegment(vec3(2.0, 30.5, 60.5), vec3(9.0, 30.5, 60.5));
    assert.equal(long.length, 8);
    assert.deepEqual(long.map((key) => key.ix), [2, 3, 4, 5, 6, 7, 8, 9]);
    // A segment that leaves the region says so.
    assert.equal(segmentLeavesRegion(grid, vec3(1.5, 30.5, 0), vec3(-3.5, 30.5, 0)), true);
    assert.equal(segmentLeavesRegion(grid, vec3(40.5, 30.5, 0), vec3(44.5, 30.5, 0)), false);
    // Degenerate segments do not spin forever.
    assert.equal(traverseSegment(vec3(3, 3, 3), vec3(3, 3, 3)).length, 1);
  });

  check('a seam crossing is visible in the stands the segment actually crosses', () => {
    const y = 40.5;
    const z = region.heightAt(STAND_SIZE - 6, y);
    const from = vec3(STAND_SIZE - 6, y, z);
    const to = vec3(STAND_SIZE + 6, y, z);
    assert.deepEqual(segmentStands(grid, from, to), [0, 1]);
    assert.equal(segmentCrossesStandBoundary(grid, from, to), true);
    assert.equal(segmentCrossesStandBoundary(grid, vec3(4, y, z), vec3(9, y, z)), false);
  });

  check('tree placement is simulation-owned and keeps its seeded place', () => {
    const tree = { id: 3, gx: 52, seed: 0x51f3a2c7 };
    // The same formula the renderer used, checked against the raw generator.
    const roll = mulberry32(tree.seed ^ 0x9af2)();
    assert.equal(treeLocalOffset(tree.seed), 10 + roll * (STAND_SIZE - 26));
    const frame = standFrameOf(grid, 0);
    const position = treeSpatialPosition(tree, region, frame);
    assert.equal(position.x, frame.originX + tree.gx);
    assert.equal(position.y, frame.originY + treeLocalOffset(tree.seed));
    assert.equal(position.z, region.heightAt(position.x, position.y));
    assert.equal(depthCmAt(region, position.x, position.y, position.z), 0);
  });

  check('the same tree and root keep matching coordinates in both projections', () => {
    const tree = { id: 1, gx: 60, seed: 12345 };
    const tip = { gx: 63, gy: 30 };
    const frame = standFrameOf(grid, 1);
    const plane = { along: 'x', fixed: frame.originY + 44.5 };
    const forest = treeSpatialPosition(tree, region, frame);
    const section = treeSectionPosition(tree, region, frame, plane);
    assert.equal(section.x, forest.x, 'the same trunk column in both projections');
    assert.equal(section.z, region.heightAt(section.x, plane.fixed));
    const tipPosition = rootTipSectionPosition(tip, region, frame, plane);
    // A root tip is addressed by its cell, so its centre sits half a unit along.
    assert.equal(tipPosition.x, frame.originX + tip.gx + 0.5);
    assert.equal(tipPosition.y, plane.fixed);
    // Its stored row is exactly the depth the position reports.
    assert.ok(Math.abs(depthCmAt(region, tipPosition.x, tipPosition.y, tipPosition.z) - rowDepthCm(tip.gy)) < 1e-9);
    // Bonding distance is a real 3D distance: a tip directly beneath the trunk
    // is not "near" merely because it shares a column.
    const deep = rootTipSectionPosition({ gx: tip.gx, gy: 60 }, region, frame, plane);
    const shallow = rootTipSectionPosition({ gx: tip.gx, gy: 30 }, region, frame, plane);
    const dz = (60 - 30) * GRID.cmPerRow;
    assert.ok(Math.abs(distanceCm(deep, shallow) - dz) < 1e-9);
    const sideways = rootTipSectionPosition({ gx: tip.gx + 7, gy: 30 }, region, frame, plane);
    assert.ok(distanceCm(shallow, sideways) > 6.9 && distanceCm(shallow, sideways) < 7.1);
    // A north-south section is the same helper on the other axis, so a crossing
    // in either direction is browsed by the same code.
    const vertical = { along: 'y', fixed: frame.originX + 20.5 };
    const verticalSection = treeSectionPosition(tree, region, frame, vertical);
    assert.equal(verticalSection.y, frame.originY + tree.gx, 'the tree keeps its own column along y');
    assert.equal(verticalSection.x, vertical.fixed);
  });

  check('references stay stable across stands while local ids collide', () => {
    const west = { standId: 0, treeId: 3 };
    const east = { standId: 1, treeId: 3 };
    assert.notEqual(refKey(west), refKey(east));
    assert.equal(refKey(west), '0:3');
    assert.equal(refKey({ standId: 1, treeId: 3, tipId: 2 }), '1:3:2');
  });

  // -------------------------------------------------------------------------
  // Stage 2: the shared soil volume
  // -------------------------------------------------------------------------
  const { SoilVolume, SOIL_VOLUME_VERSION, seasonalWaterTableOffsetCm } = soilModule;

  check('the soil volume carries its own version and a zero-offset season', () => {
    assert.equal(SOIL_VOLUME_VERSION, 1);
    assert.equal(seasonalWaterTableOffsetCm(1), 0);
    // A dry season pushes the table down; a wet one lifts it.
    assert.ok(seasonalWaterTableOffsetCm(0.35) > 0);
    assert.ok(seasonalWaterTableOffsetCm(1.35) < 0);
  });

  check('a shared boundary samples the same material from either stand', () => {
    const soil = new SoilVolume(region);
    const seamX = STAND_SIZE;
    const y = 60.5;
    const z = elevationAtDepthCm(region, seamX, y, 30);
    const west = soil.sampleIn(0, seamX, y, z);
    const east = soil.sampleIn(1, seamX, y, z);
    assert.equal(west.keyText, east.keyText);
    assert.equal(west.material.stratum, east.material.stratum);
    assert.equal(west.material.hardness, east.material.hardness);
    assert.equal(west.material.organic, east.material.organic);
    // The seam belongs to the eastern square, and the two squares either side
    // of it are genuinely different stands.
    assert.equal(west.standId, 1);
    assert.equal(standIdAt(region, seamX - 0.5, y), 0);
    assert.equal(standIdAt(region, seamX + 0.5, y), 1);
    // And the field itself is continuous across the seam rather than jumping
    // from one stand's noise to another's.
    const near = soil.sample(seamX - 0.25, y, z);
    const far = soil.sample(seamX + 0.25, y, z);
    assert.equal(near.material.stratum, far.material.stratum);
    assert.ok(Math.abs(near.material.organic - far.material.organic) < 0.02);
  });

  check('reading and slicing change no state and no hash', () => {
    const soil = new SoilVolume(region);
    const x = STAND_SIZE - 40;
    soil.mutate(x, 30.5, elevationAtDepthCm(region, x, 30.5, 20), { occupancy: 0.4 });
    const before = soil.hash();
    const materialized = soil.materializedCount;
    for (let i = 0; i < 400; i++) soil.sample(i * 0.7, 40.5, region.heightAt(i * 0.7, 40.5) - 30);
    soil.sampleSection({ id: 'a', y: 40.5, xFrom: 0, xTo: 60, depthFromCm: 0, depthToCm: 90, across: 12, down: 18 });
    soil.sampleSection({ id: 'b', y: 41.5, xFrom: 10, xTo: 90, depthFromCm: 20, depthToCm: 60, across: 9, down: 9 });
    assert.equal(soil.hash(), before);
    assert.equal(soil.materializedCount, materialized);
  });

  check('two sections through one voxel see the same depletion', () => {
    const soil = new SoilVolume(region);
    const x = 45;
    const y = 44.5;
    const depthCm = 25;
    const z = elevationAtDepthCm(region, x, y, depthCm);
    const cell = soil.materialAt(x, y, z);
    const startNitrogen = cell.nitrogen;
    cell.nitrogen = Math.max(0, cell.nitrogen - 0.25);
    cell.occupancy = 0.6;
    // Two different sections, both crossing the same physical voxel.
    const first = soil.sampleSection({ id: 'wide', y, xFrom: 40, xTo: 50, depthFromCm: 20, depthToCm: 30, across: 3, down: 3 });
    const second = soil.sampleSection({ id: 'narrow', y, xFrom: x, xTo: x, depthFromCm: depthCm, depthToCm: depthCm, across: 1, down: 1 });
    const inFirst = first.find((s) => s.keyText === voxelKeyText(voxelKeyOf({ x, y, z })));
    const inSecond = second.find((s) => s.keyText === voxelKeyText(voxelKeyOf({ x, y, z })));
    assert.ok(inFirst && inSecond, 'both sections include the voxel');
    assert.equal(inFirst.material.nitrogen, inSecond.material.nitrogen);
    assert.equal(inFirst.material.occupancy, 0.6);
    assert.ok(inFirst.material.nitrogen < startNitrogen, 'the depletion is visible');
    assert.equal(inFirst.changed, true);
  });

  check('groundwater and the stream refuse the same segment in every view', () => {
    const soil = new SoilVolume(region);
    // A point on the region's actual course.
    const course = region.streamPath[Math.floor(region.streamPath.length / 2)];
    assert.ok(soil.streamDistanceAt(course.x, course.y) < 0.75, 'the course reads as the channel');
    const surfaceZ = region.heightAt(course.x, course.y);
    assert.equal(soil.blockAt(course.x, course.y, surfaceZ - 2).reason, 'stream');
    // The segment through the channel is refused, from either direction.
    const across = { ...course, x: course.x - 6 };
    const from = vec3(across.x, course.y, elevationAtDepthCm(region, across.x, course.y, 12));
    const to = vec3(course.x + 6, course.y, elevationAtDepthCm(region, course.x + 6, course.y, 12));
    const forward = soil.segment(from, to);
    const backward = soil.segment(to, from);
    assert.equal(forward.blocked, true);
    assert.equal(forward.reason, 'stream');
    assert.equal(backward.reason, 'stream');
    // And the same query from the far stand's own ground agrees.
    const stand = standIdAt(region, course.x, course.y);
    assert.equal(soil.sampleIn(stand, course.x, course.y, surfaceZ - 2).material.stream, true);

    // Saturated ground below the live table.
    const dry = region.stands.find((s) => s.stream === null && s.waterTableCm > 30);
    assert.ok(dry, 'a dry stand exists');
    const dryX = dry.centreX;
    const dryY = dry.centreY;
    const deepZ = elevationAtDepthCm(region, dryX, dryY, soil.waterTableDepthCm(dryX, dryY) + 2);
    assert.equal(soil.blockAt(dryX, dryY, deepZ).reason, 'groundwater');
    // The reachable fringe just above it is not refused.
    const fringeZ = elevationAtDepthCm(region, dryX, dryY, soil.waterTableDepthCm(dryX, dryY) - 2);
    const fringe = soil.blockAt(dryX, dryY, fringeZ);
    assert.equal(fringe.blocked, false, `fringe refused as ${fringe.reason}`);
    // A long diagonal segment is tested cell by cell, so it cannot tunnel
    // through the seam corner and the saturated ground beyond it.
    const diagonal = soil.segment(
      vec3(dryX - 3, dryY - 3, region.heightAt(dryX - 3, dryY - 3) - 18),
      vec3(dryX + 3, dryY + 3, region.heightAt(dryX + 3, dryY + 3) - 90)
    );
    assert.equal(diagonal.blocked, true);
    assert.equal(diagonal.reason, 'groundwater');
  });

  check('groundwater moves as one regional surface when the season changes', () => {
    const soil = new SoilVolume(region);
    const a = { x: region.stands[0].centreX, y: region.stands[0].centreY };
    const b = { x: region.stands[region.stands.length - 1].centreX, y: region.stands[region.stands.length - 1].centreY };
    const dry = soil.groundwaterElevationAt(a.x, a.y);
    soil.setEnvironment({ waterTableOffsetCm: seasonalWaterTableOffsetCm(0.35) });
    const drought = soil.groundwaterElevationAt(a.x, a.y);
    const droughtFar = soil.groundwaterElevationAt(b.x, b.y);
    assert.ok(drought < dry, 'the summer table is deeper everywhere');
    // Moving the table moves it by the same rule for both stands, so the
    // surface keeps its shape rather than each square drifting on its own.
    const depthNow = soil.waterTableDepthCm(a.x, a.y);
    const depthThen = soil.waterTableDepthCm(b.x, b.y);
    assert.ok(depthNow >= 16 && depthNow <= 108);
    assert.ok(depthThen >= 16 && depthThen <= 108);
    assert.ok(Math.abs((soil.groundwaterElevationAt(a.x, a.y) - drought) - (soil.groundwaterElevationAt(b.x, b.y) - droughtFar)) < 1e-9);
  });

  check('only changed cells advance, in stable key order', () => {
    const soil = new SoilVolume(region);
    const empty = soil.step(0.25, { rainfall: 1, litterfall: 0.25 });
    assert.equal(empty, 0, 'an untouched volume visits nothing');
    const x = 51.5;
    const y = 30.5;
    const z = elevationAtDepthCm(region, x, y, 22);
    const cell = soil.materialAt(x, y, z);
    cell.organic = 0.2;
    cell.nitrogen = 0.05;
    const before = soil.hash();
    const visits = soil.step(0.25, { rainfall: 1.2, litterfall: 1 });
    assert.equal(visits, 1);
    assert.equal(soil.materializedCount, 1);
    assert.notEqual(soil.hash(), before);
    assert.ok(cell.organic > 0.2 && cell.nitrogen > 0.05, 'the soil recovers');
    // The same history twice gives the same numbers.
    const twin = new SoilVolume(region);
    const twinCell = twin.materialAt(x, y, z);
    twinCell.organic = 0.2;
    twinCell.nitrogen = 0.05;
    twin.step(0.25, { rainfall: 1.2, litterfall: 1 });
    assert.equal(twin.hash(), soil.hash());
  });

  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`PASS: ${count} checks in ${elapsed}s.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
