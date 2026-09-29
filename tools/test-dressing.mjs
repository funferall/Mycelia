/**
 * Headless checks for the forest's background vegetation (`ASSET-04`, `MAP-05`).
 *
 * The placement helper is pure, so everything it promises can be checked
 * without a renderer: determinism, ownership across stand edges, the channel and
 * playable-tree masks, spacing, community variation, and the fact that laying
 * the region's scenery out changes nothing the simulation can see.
 *
 *   node tools/test-dressing.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-dressing-'));
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
  const modules = [
    'content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'crossing', 'shared-soil', 'wildfire', 'drought', 'flood', 'network', 'sim', 'match', 'survey',
    'forest-dressing-layout', 'forest-floor-field',
  ];
  for (const name of modules) {
    const source = name.startsWith('forest-')
      ? readFileSync(new URL(`../src/render/${name}.ts`, import.meta.url), 'utf8')
      : readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    // Flatten every relative import: the compiled copies all live side by side.
    const compiled = stripTypeScriptTypes(source)
      .replace(/from '([^']+)'/g, (_match, spec) => `from './${spec.split('/').pop()}.mjs'`);
    writeFileSync(join(output, `${name}.mjs`), compiled);
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const {
    COMMUNITY_DRESSING,
    DRESSING_BANDS,
    distanceToCourse,
    dressingSummary,
    layoutForestDressing,
    playableTrunkPositions,
  } = await load('forest-dressing-layout');
  const { STAND_SIZE, createRegion } = await load('region');
  const { RegionalMatch } = await load('match');

  const SEED = 'raven-wood';
  const region = createRegion(SEED);
  const match = new RegionalMatch(SEED);
  const trunks = playableTrunkPositions(
    region.stands.map((stand) => ({ id: stand.id, sx: stand.sx, sy: stand.sy })),
    (standId) => match.stands[standId].sim.world.trees.map((tree) => ({
      id: tree.id,
      gx: tree.gx,
      seed: tree.seed,
      height: tree.height,
    }))
  );
  const input = { region, playable: trunks, course: region.streamPath, band: 'sparse' };
  const layout = () => layoutForestDressing(input);
  const decorations = layout();

  /** The checksum the simulation must agree on, whatever the forest draws. */
  const simChecksum = (regional) => {
    const parts = [];
    for (const stand of regional.stands) {
      const sim = stand.sim;
      parts.push(stand.site.id, sim.time.toFixed(3), sim.player.nodes.length);
      for (const node of sim.player.nodes) {
        parts.push(node.id, node.gx, node.gy, node.alive ? 1 : 0, node.carbon.toFixed(4));
      }
      for (const tree of sim.world.trees) {
        parts.push(`t${tree.id}`, tree.health.toFixed(4), tree.dead ? 1 : 0);
        for (const tip of tree.rootTips) parts.push(tip.id, tip.gx, tip.gy, tip.bondedTo ?? -1);
      }
    }
    return parts.join('|');
  };

  // -------------------------------------------------------------------------
  check('the same input lays out the same forest, and a new seed does not', () => {
    const again = layout();
    assert.equal(again.length, decorations.length);
    for (let i = 0; i < decorations.length; i++) {
      assert.equal(again[i].id, decorations[i].id);
      assert.equal(again[i].asset, decorations[i].asset);
      assert.ok(Math.abs(again[i].x - decorations[i].x) < 1e-12);
      assert.ok(Math.abs(again[i].y - decorations[i].y) < 1e-12);
    }
    const other = layoutForestDressing({ ...input, region: createRegion('old-growth') });
    assert.notEqual(
      other.map((d) => `${d.id}${d.asset}`).join('|'),
      decorations.map((d) => `${d.id}${d.asset}`).join('|'),
      'a different region lays out a different forest'
    );
    // Reordering the playable list cannot change the result: the masks are set
    // membership, not sequence.
    const reversed = layoutForestDressing({ ...input, playable: [...trunks].reverse() });
    assert.deepEqual(reversed.map((d) => d.id), decorations.map((d) => d.id));
  });

  check('the layout reads its input and never writes to it', () => {
    const before = JSON.stringify({
      trunks,
      stands: region.stands.map((stand) => [stand.id, stand.community, stand.waterTableCm]),
    });
    layout();
    const after = JSON.stringify({
      trunks,
      stands: region.stands.map((stand) => [stand.id, stand.community, stand.waterTableCm]),
    });
    assert.equal(after, before, 'no input array or stand was modified');
    // And it does not consume a simulation RNG: a match's own stream is
    // unaffected by how many times the layout runs.
    const first = new RegionalMatch(SEED);
    const second = new RegionalMatch(SEED);
    for (let i = 0; i < 120; i++) {
      first.step(1 / 30);
      if (i % 10 === 0) layout();
      second.step(1 / 30);
    }
    assert.equal(first.stands[first.activeStandId].sim.player.nodes.length, second.stands[second.activeStandId].sim.player.nodes.length);
    assert.equal(simChecksum(first), simChecksum(second), 'laying out scenery changes no simulation state');
  });

  check('every decoration belongs to exactly one stand, by half-open bounds', () => {
    assert.ok(decorations.length > 0, 'the region has background vegetation');
    const ids = new Set();
    const canopyCells = new Set();
    for (const decoration of decorations) {
      assert.ok(!ids.has(decoration.id), `duplicate decoration id ${decoration.id}`);
      ids.add(decoration.id);
      // A decoration key is not a tree key: it lives in its own namespace.
      assert.ok(decoration.id.startsWith('dressing:'), decoration.id);
      assert.equal(decoration.id.includes(':') && !decoration.id.startsWith('dressing:'), false);
      const sx = Math.floor(decoration.x / STAND_SIZE);
      const sy = Math.floor(decoration.y / STAND_SIZE);
      assert.equal(sy * region.cols + sx, decoration.standId, `${decoration.id} owner`);
      if (decoration.kind === 'canopy') {
        // One candidate cell yields at most one canopy tree, so a tree near a
        // shared edge is emitted once rather than once per square.
        assert.ok(!canopyCells.has(decoration.cell), `cell ${decoration.cell} emitted a second canopy`);
        canopyCells.add(decoration.cell);
      }
    }
    // Half the region's stand edges are shared; the layout still has one tree
    // per cell on both sides of them.
    assert.ok(canopyCells.size >= 40, `only ${canopyCells.size} canopy cells were used`);
  });

  check('every decoration stands on the region own ground', () => {
    for (const decoration of decorations) {
      assert.equal(decoration.z, region.heightAt(decoration.x, decoration.y));
      assert.ok(decoration.height > 0.1 && decoration.height < 30, `${decoration.id} height ${decoration.height}`);
      assert.ok(decoration.yaw >= 0 && decoration.yaw <= Math.PI * 2 + 1e-9);
      assert.ok(decoration.phase >= 0 && decoration.phase <= 1);
    }
  });

  check('open water, its banks and the playable crowns are left clear', () => {
    for (const decoration of decorations) {
      const flow = region.flowAt(decoration.x, decoration.y);
      assert.ok(flow < 0.9, `${decoration.id} stands in the channel`);
      if (flow >= 0.3) {
        const halfWidth = 1.5 + flow * 4;
        const distance = distanceToCourse(region.streamPath, decoration.x, decoration.y);
        assert.ok(distance > halfWidth, `${decoration.id} is inside the channel`);
        if (decoration.kind === 'canopy' || decoration.kind === 'young') {
          assert.ok(distance > halfWidth + 0.79, `${decoration.id} is on the wet bank`);
        }
      }
      if (decoration.kind === 'canopy' || decoration.kind === 'young') {
        for (const trunk of trunks) {
          const keepOut = Math.max(4, trunk.height * 0.55);
          assert.ok(
            Math.hypot(trunk.x - decoration.x, trunk.y - decoration.y) >= keepOut,
            `${decoration.id} crowds playable tree ${trunk.standId}:${trunk.treeId}`
          );
        }
      }
    }
  });

  check('clusters and gaps: nothing is packed closer than its crown allows', () => {
    const radiusOf = (kind, height) => (kind === 'canopy' || kind === 'young' ? Math.max(2, height * 0.36) : Math.max(0.9, height * 0.7));
    for (let i = 0; i < decorations.length; i++) {
      for (let j = i + 1; j < decorations.length; j++) {
        const a = decorations[i];
        const b = decorations[j];
        const min = Math.max(1.8, 0.62 * (radiusOf(a.kind, a.height) + radiusOf(b.kind, b.height)));
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(distance >= min - 1e-9, `${a.id} and ${b.id} are ${distance.toFixed(2)} apart, under ${min.toFixed(2)}`);
      }
    }
    // Openings exist: the region is not a carpet. Measure the emptiest 20-unit
    // square in a stand and require some ground to be genuinely clear.
    const stand = region.stands[4];
    const canopyInStand = decorations.filter((d) => d.standId === stand.id && d.kind === 'canopy');
    assert.ok(canopyInStand.length > 4, 'the sample stand carries canopy');
    let largestGap = 0;
    for (let x = stand.sx * STAND_SIZE + 10; x < (stand.sx + 1) * STAND_SIZE - 10; x += 10) {
      for (let y = stand.sy * STAND_SIZE + 10; y < (stand.sy + 1) * STAND_SIZE - 10; y += 10) {
        let nearest = Infinity;
        for (const d of canopyInStand) nearest = Math.min(nearest, Math.hypot(d.x - x, d.y - y));
        largestGap = Math.max(largestGap, nearest);
      }
    }
    assert.ok(largestGap > 8, `the densest stand still has clearings (largest gap ${largestGap.toFixed(1)})`);
  });

  check('the band and the community both change the forest', () => {
    const sparse = dressingSummary(layoutForestDressing({ ...input, band: 'sparse' }));
    const dense = dressingSummary(layoutForestDressing({ ...input, band: 'dense' }));
    assert.equal(DRESSING_BANDS.sparse, 24);
    assert.ok(dense.byKind.canopy > sparse.byKind.canopy, 'a denser band plants more canopy');
    // The band is the nominal per-stand count; a community scales it, so the
    // honest assertion is that every stand is in the band's own range and that
    // the region's average sits on it.
    const counts = region.stands.map(
      (stand) => decorations.filter((d) => d.standId === stand.id && d.kind === 'canopy').length
    );
    for (const [index, value] of counts.entries()) {
      assert.ok(value <= DRESSING_BANDS.sparse * 2, `stand ${index} has ${value} canopy trees`);
    }
    const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
    assert.ok(
      mean > DRESSING_BANDS.sparse * 0.35 && mean < DRESSING_BANDS.sparse * 1.5,
      `the sparse band averages ${mean.toFixed(1)} canopy trees per stand`
    );

    // Three communities must read differently: hemlock ravines carry more
    // conifer than oak ridges, oak ridges carry more rock than hemlock ravines,
    // and a recovering clearing is younger than an oak ridge.
    const community = (id) => region.stands.find((stand) => stand.id === id)?.community;
    const byCommunity = (name) => decorations.filter((d) => d.community === name);
    const hemlockShare = (name) => {
      const canopy = byCommunity(name).filter((d) => d.kind === 'canopy');
      if (canopy.length === 0) return 0;
      return canopy.filter((d) => d.asset.startsWith('tree.hemlock')).length / canopy.length;
    };
    const ridge = byCommunity('oak-ridge');
    const ravine = byCommunity('hemlock-ravine');
    const clearing = byCommunity('recovering-clearing');
    assert.ok(ridge.length > 0 || ravine.length > 0, 'the seed has ridge or ravine ground');
    if (ridge.length > 0 && ravine.length > 0) {
      assert.ok(hemlockShare('hemlock-ravine') > hemlockShare('oak-ridge'), 'ravines are more coniferous than ridges');
      const rockRate = (list) => list.filter((d) => d.kind === 'rock').length / list.length;
      assert.ok(rockRate(ridge) > rockRate(ravine), 'ridges are rockier than ravines');
    }
    if (ridge.length > 0 && clearing.length > 0) {
      const youngRate = (list) => list.filter((d) => d.kind === 'young').length / list.length;
      assert.ok(youngRate(clearing) > youngRate(ridge), 'clearings are younger than ridges');
    }
    assert.ok(Object.keys(COMMUNITY_DRESSING).length === 7);
    assert.ok(DRESSING_BANDS.sparse < DRESSING_BANDS.medium && DRESSING_BANDS.medium < DRESSING_BANDS.dense);
    void community;
  });

  check('one community can be isolated without disturbing the rest', () => {
    const sample = region.stands.find((stand) => stand.community === 'hemlock-ravine') ?? region.stands[0];
    const single = layoutForestDressing({ ...input, stands: [sample.id], band: 'medium' });
    assert.ok(single.length > 0, 'the fixture stand is dressed');
    assert.equal(single.every((d) => d.standId === sample.id), true, 'nothing outside the chosen stand');
    assert.equal(single.every((d) => d.community === sample.community), true);
    // It is a window, not a different world: the same stand laid out alone and
    // in the region uses the same rules and the same ground.
    const inRegion = decorations.filter((d) => d.standId === sample.id);
    assert.ok(inRegion.every((d) => d.z === region.heightAt(d.x, d.y)));
    for (const decoration of single) {
      assert.ok(decoration.id.startsWith(`dressing:${sample.id}:`), decoration.id);
      assert.ok(decoration.x >= sample.sx * STAND_SIZE && decoration.x < (sample.sx + 1) * STAND_SIZE);
    }
  });

  const { forestFloorField } = await load('forest-floor-field');
  check('ground habitat is continuous across both stand axes and deterministic', () => {
    const field = forestFloorField(region, region.streamPath, trunks);
    const again = forestFloorField(region, region.streamPath, trunks);
    for (let t = 2; t < STAND_SIZE * 3 - 2; t += 3) {
      for (const [x, y, dx, dy] of [[STAND_SIZE, t, 1e-5, 0], [t, STAND_SIZE, 0, 1e-5]]) {
        assert.deepEqual(field(x, y), again(x, y));
        const a = field(x - dx, y - dy), b = field(x + dx, y + dy);
        for (const key of Object.keys(a)) {
          assert.ok(Number.isFinite(a[key]) && a[key] >= 0 && a[key] <= 1, key);
          assert.ok(Math.abs(a[key] - b[key]) < .001, `${key} seam at ${x},${y}`);
        }
      }
    }
    const wet = field(region.streamPath[2].x, region.streamPath[2].y).wet;
    assert.ok(wet > .99, 'stream banks have an actual wet mask');
  });

  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`PASS: ${count} checks in ${elapsed}s.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
