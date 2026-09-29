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
    'content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'crossing', 'shared-soil', 'wildfire', 'drought', 'flood', 'network', 'sim', 'match', 'survey',
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
  const { rootSystem } = await load('root-architecture');
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
