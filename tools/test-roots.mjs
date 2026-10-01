/**
 * Headless checks for the species root architecture drawn in the soil section.
 *
 * The architecture is presentation, after the Kutschera and Lichtenegger
 * excavation drawings, but it must honour the simulation: every root tip a
 * hypha can bond to has to sit on a drawn root, nothing may leave the section,
 * and a tree must draw the same roots every time.
 *
 *   node tools/test-roots.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-roots-'));
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
  const modules = [
    'content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'segments', 'crossing', 'shared-soil', 'wildfire', 'drought', 'flood', 'contact', 'network', 'sim', 'match', 'survey',
    'root-architecture',
  ];
  for (const name of modules) {
    const folder = name === 'root-architecture' ? 'render' : 'sim';
    const source = readFileSync(new URL(`../src/${folder}/${name}.ts`, import.meta.url), 'utf8');
    const compiled = stripTypeScriptTypes(source)
      .replace(/from '([^']+)'/g, (_match, spec) => `from './${spec.split('/').pop()}.mjs'`);
    writeFileSync(join(output, `${name}.mjs`), compiled);
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const { rootSystem, grownRoots } = await load('root-architecture');
  const { GRID } = await load('content');
  const { RegionalMatch } = await load('match');

  const match = new RegionalMatch('raven-wood');
  const trees = match.stands.flatMap((stand) => stand.sim.world.trees);
  const systems = trees.map((tree) => ({ tree, system: rootSystem(tree, GRID.cols, GRID.rows) }));

  check('every simulation root tip is the end of a drawn root', () => {
    for (const { tree, system } of systems) {
      for (const tip of tree.rootTips) {
        const x = tip.gx + 0.5, depth = tip.gy + 0.5;
        const ends = system.ribbons.some((ribbon) => {
          const end = ribbon[ribbon.length - 1];
          return Math.abs(end.x - x) < 1e-9 && Math.abs(end.depth - depth) < 1e-9;
        });
        assert.ok(ends, `tree ${tree.id} (${tree.species}) tip ${tip.id} at ${tip.gx},${tip.gy} has no root`);
      }
    }
  });

  check('roots stay inside the section and below the soil line', () => {
    for (const { system } of systems) {
      for (const ribbon of system.ribbons) {
        for (const p of ribbon) {
          assert.ok(p.x > 0 && p.x < GRID.cols && p.depth > 0 && p.depth < GRID.rows, `point ${p.x},${p.depth}`);
          assert.ok(p.width > 0 && Number.isFinite(p.width));
        }
      }
      for (const fine of system.fines) {
        for (const [x, depth] of fine) assert.ok(x > 0 && x < GRID.cols && depth > 0 && depth < GRID.rows);
      }
    }
  });

  check('a tree draws the same roots every time', () => {
    for (const { tree, system } of systems.slice(0, 12)) {
      assert.deepEqual(rootSystem(tree, GRID.cols, GRID.rows), system);
    }
  });

  check('a new tip adds a root and leaves every existing root where it was', () => {
    for (const species of ['oak', 'birch', 'hemlock']) {
      const { tree, system } = systems.find((s) => s.tree.species === species);
      const grown = { ...tree, rootTips: [...tree.rootTips, { id: tree.rootTips.length, gx: tree.gx + 3, gy: 20, bondedTo: null }] };
      const after = rootSystem(grown, GRID.cols, GRID.rows);
      // Every root drawn before, the tip roots included, is untouched.
      assert.deepEqual(after.ribbons.slice(0, system.ribbons.length), system.ribbons, species);
      assert.equal(after.ribbons.length, system.ribbons.length + 1, species);
    }
  });

  check('maturity never changes the layout: a tree is laid out once, full-grown', () => {
    for (const { tree, system } of systems.slice(0, 12)) {
      assert.deepEqual(rootSystem({ ...tree, maturity: 0.2 }, GRID.cols, GRID.rows), system);
      assert.deepEqual(rootSystem({ ...tree, maturity: 1 }, GRID.cols, GRID.rows), system);
    }
  });

  check('a full-grown tree draws its whole layout', () => {
    for (const { system } of systems.slice(0, 12)) {
      const grown = grownRoots(system, 1);
      assert.deepEqual(grown.ribbons, system.ribbons);
      assert.deepEqual(grown.fines, system.fines);
    }
  });

  const length = (ribbons) => ribbons.reduce((sum, r) => {
    for (let i = 1; i < r.length; i++) sum += Math.hypot(r[i].x - r[i - 1].x, r[i].depth - r[i - 1].depth);
    return sum;
  }, 0);
  check('growing never moves a drawn point; roots only extend, a little at a time', () => {
    for (const species of ['oak', 'birch', 'hemlock']) {
      const { system } = systems.find((s) => s.tree.species === species);
      const full = length(system.ribbons);
      let before = grownRoots(system, 0.3);
      for (let g = 0.31; g <= 1.0001; g += 0.01) {
        const after = grownRoots(system, g);
        const kept = new Set(after.ribbons.flatMap((r) => r.map((p) => `${p.x},${p.depth}`)));
        for (const ribbon of before.ribbons) {
          // Every point but a growing end stays exactly where it was drawn.
          for (const p of ribbon.slice(0, -1)) assert.ok(kept.has(`${p.x},${p.depth}`), `${species} point ${p.x},${p.depth} moved at growth ${g.toFixed(2)}`);
        }
        const grew = length(after.ribbons) - length(before.ribbons);
        assert.ok(grew >= -1e-9 && grew < full * 0.03, `${species} grew ${grew.toFixed(2)} of ${full.toFixed(0)} cells in one step at ${g.toFixed(2)}`);
        before = after;
      }
    }
  });

  check('at any age every drawn root is attached: to the stem base or to a drawn root', () => {
    for (const { tree, system } of systems.slice(0, 18)) {
      for (const g of [0, 0.4, 0.75]) {
        const { ribbons } = grownRoots(system, g);
        ribbons.forEach((ribbon, i) => {
          const [first] = ribbon;
          const atBase = Math.abs(first.x - tree.gx - 0.5) < 2 && first.depth <= 2.5;
          const onRoot = ribbons.some((other, j) => j !== i && other.some((p) => Math.abs(p.x - first.x) < 1e-6 && Math.abs(p.depth - first.depth) < 1e-6));
          assert.ok(atBase || onRoot, `tree ${tree.id} (${tree.species}) root ${i} floats at growth ${g}: starts ${first.x.toFixed(2)},${first.depth.toFixed(2)}`);
        });
      }
    }
  });

  check('a new tip changes nothing until its root grows in, then reaches it', () => {
    for (const species of ['oak', 'birch', 'hemlock']) {
      const { tree, system } = systems.find((s) => s.tree.species === species);
      const grown = { ...tree, rootTips: [...tree.rootTips, { id: tree.rootTips.length, gx: tree.gx + 3, gy: 20, bondedTo: null }] };
      const after = rootSystem(grown, GRID.cols, GRID.rows);
      const done = tree.rootTips.map(() => 1);
      assert.deepEqual(grownRoots(after, 0.6, [...done, 0]), grownRoots(system, 0.6, done), `${species}: a tip that has not grown draws nothing`);
      const half = length(grownRoots(after, 0.6, [...done, 0.75]).ribbons);
      const whole = grownRoots(after, 0.6, [...done, 1]);
      assert.ok(half < length(whole.ribbons), `${species}: the tip's root grows in`);
      const end = whole.ribbons[whole.ribbons.length - 1].at(-1);
      assert.ok(Math.abs(end.x - (tree.gx + 3.5)) < 1e-9 && Math.abs(end.depth - 20.5) < 1e-9, `${species}: grown in, it ends on the tip`);
    }
  });

  // Species form, from the drawings: the root mass of birch and hemlock is a
  // shallow plate; oak carries a far deeper heart and sinkers.
  const mass = (species) => {
    let weighted = 0, total = 0, deepest = 0;
    for (const { tree, system } of systems) {
      if (tree.species !== species) continue;
      for (const ribbon of system.ribbons) {
        for (const p of ribbon) {
          weighted += p.depth * p.width;
          total += p.width;
          deepest = Math.max(deepest, p.depth);
        }
      }
    }
    return { mean: weighted / total, deepest };
  };
  const oak = mass('oak'), birch = mass('birch'), hemlock = mass('hemlock');
  console.log(`  root mass depth (width-weighted mean / deepest, rows): oak ${oak.mean.toFixed(1)}/${oak.deepest.toFixed(0)}, birch ${birch.mean.toFixed(1)}/${birch.deepest.toFixed(0)}, hemlock ${hemlock.mean.toFixed(1)}/${hemlock.deepest.toFixed(0)}`);

  check('birch and hemlock are shallow plates; oak roots deepest', () => {
    assert.ok(birch.mean < oak.mean && hemlock.mean < oak.mean, 'plates are shallower than the heart root');
    assert.ok(oak.deepest > birch.deepest && oak.deepest > hemlock.deepest, 'oak sinkers go deepest');
    assert.ok(birch.mean < 15 && hemlock.mean < 15, 'most plate root mass is near the surface');
  });

  check('laterals spread wider than the roots go deep, as in the drawings', () => {
    for (const species of ['oak', 'birch', 'hemlock']) {
      const spans = systems.filter((s) => s.tree.species === species).map(({ tree, system }) => {
        let spread = 0;
        for (const ribbon of system.ribbons) for (const p of ribbon) if (p.depth < 8) spread = Math.max(spread, Math.abs(p.x - tree.gx - 0.5));
        return spread;
      });
      if (spans.length === 0) continue;
      const median = spans.sort((a, b) => a - b)[Math.floor(spans.length / 2)];
      assert.ok(median > 8, `${species} laterals reach ${median.toFixed(1)} cells`);
    }
  });

  console.log(`PASS: ${count} checks over ${trees.length} trees.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
