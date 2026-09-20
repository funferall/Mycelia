/**
 * Headless check for projected-size level-of-detail selection.
 *
 * The renderer is not involved: `src/render/lod.ts` takes a projected height
 * and the tier a tree wears now, and returns the tier it should wear. This
 * exercises the properties that matter — the viewport fraction is honest, each
 * boundary has real hysteresis, a tree on a boundary has one stable answer, and
 * a continuous zoom refines monotonically instead of flickering.
 *
 *   node tools/test-lod.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Compile the one module under test into a unique temporary directory. It has
// no imports on purpose, so nothing else has to be staged beside it.
const output = mkdtempSync(join(tmpdir(), 'mycelia-lod-'));
const source = readFileSync(new URL('../src/render/lod.ts', import.meta.url), 'utf8');
writeFileSync(join(output, 'lod.mjs'), stripTypeScriptTypes(source));
const {
  DEFAULT_LOD_BANDS,
  LOD_TIERS,
  projectedHeightFraction,
  selectLodTier,
} = await import(pathToFileURL(join(output, 'lod.mjs')).href);

let count = 0;
function check(name, fn) {
  fn();
  count++;
  console.log(`PASS ${name}`);
}

const bands = DEFAULT_LOD_BANDS;
const close = (a, b, tolerance = 1e-12) => Math.abs(a - b) <= tolerance;

check('the viewport fraction is the perspective height over the frustum height', () => {
  const expected = 10 / (2 * 100 * Math.tan((30 * Math.PI) / 180 / 2));
  assert(close(projectedHeightFraction(10, 100, 30), expected), '10 m at 100 m, 30 degrees');
});

check('degenerate sizes and distances project to nothing', () => {
  for (const [height, distance, fov] of [
    [0, 100, 30],
    [-4, 100, 30],
    [10, 0, 30],
    [10, -5, 30],
    [10, 100, 0],
    [Number.NaN, 100, 30],
    [10, Number.POSITIVE_INFINITY, 30],
  ]) {
    assert.equal(projectedHeightFraction(height, distance, fov), 0, `${height}/${distance}/${fov}`);
  }
});

check('the bands order coarser thresholds inside finer ones with room to spare', () => {
  assert(bands.lod1 < bands.lod0, 'LOD1 is earned closer than LOD0');
  assert(
    bands.lod1 * (1 + bands.hysteresis) < bands.lod0 * (1 - bands.hysteresis),
    'LOD1 has a stable interval between the two crossings'
  );
  assert(LOD_TIERS === 3);
});

// The numbers below mirror the game's own framing: a 30° field of view, a tree
// about ten metres tall, the region overview at roughly 555 world units and a
// focused crown at roughly 150. If either framing changes, these are the two
// lines that should be re-measured.
check('the game\u2019s own framing lands in the intended tiers', () => {
  const tree = 10;
  const overview = projectedHeightFraction(tree, 555, 30);
  const focused = projectedHeightFraction(tree, 150, 30);
  assert(overview < bands.lod1 * (1 - bands.hysteresis), `overview ${overview} should be LOD2`);
  assert(focused >= bands.lod1 * (1 + bands.hysteresis), `focus ${focused} should be finer than LOD2`);
  assert.equal(selectLodTier(overview, 0), 2);
  assert.ok(selectLodTier(focused, 2) <= 1, 'a focused crown is LOD0 or LOD1');
});

check('each boundary keeps a tree that is sitting on it stable', () => {
  for (const [boundary, finer, coarser] of [
    [bands.lod0, 0, 1],
    [bands.lod1, 1, 2],
  ]) {
    const insideFiner = boundary * (1 - bands.hysteresis * 0.5);
    const insideCoarser = boundary * (1 + bands.hysteresis * 0.5);
    // Just inside the finer tier, staying there is the answer...
    assert.equal(selectLodTier(insideFiner, finer), finer, `stay at ${finer}`);
    // ...and just inside the coarser tier, staying there is also the answer.
    assert.equal(selectLodTier(insideCoarser, coarser), coarser, `stay at ${coarser}`);
  }
});

check('a repeated evaluation never oscillates', () => {
  for (let fraction = 0; fraction <= 0.4; fraction += 0.002) {
    for (let start = 0; start < LOD_TIERS; start++) {
      const once = selectLodTier(fraction, start);
      const twice = selectLodTier(fraction, once);
      assert.equal(twice, once, `fraction ${fraction.toFixed(3)} from ${start}`);
    }
  }
});

check('a continuous zoom refines monotonically and never skips past a tier', () => {
  let tier = 2;
  let previousFraction = -1;
  for (let fraction = 0; fraction <= 0.4; fraction += 0.001) {
    const next = selectLodTier(fraction, tier);
    assert(next <= tier, `fraction ${fraction.toFixed(3)} went from ${tier} to ${next} while zooming in`);
    assert(tier - next <= 1, `fraction ${fraction.toFixed(3)} skipped from ${tier} to ${next}`);
    assert(fraction > previousFraction);
    previousFraction = fraction;
    tier = next;
  }
  assert.equal(tier, 0, 'a full zoom ends at LOD0');
});

check('a jump may cross both boundaries at once, in either direction', () => {
  assert.equal(selectLodTier(0.4, 2), 0, 'a hard cut to close-up lands on LOD0');
  assert.equal(selectLodTier(0.001, 0), 2, 'a hard cut to the overview lands on LOD2');
});

check('out-of-range and non-finite input is clamped rather than trusted', () => {
  assert.equal(selectLodTier(0.1, 99), selectLodTier(0.1, 2), 'current tier clamps');
  assert.equal(selectLodTier(Number.NaN, 0), 2, 'a missing projection is treated as far away');
  assert.equal(selectLodTier(0.2, Number.NaN), 0, 'a missing current tier starts at LOD0');
  assert.equal(selectLodTier(-1, 1), 2, 'a negative projection is treated as far away');
});

console.log(
  `PASS ${count} checks: LOD0 above ${bands.lod0} of viewport height, ` +
    `LOD1 above ${bands.lod1}, ${bands.hysteresis * 100}% hysteresis.`
);
