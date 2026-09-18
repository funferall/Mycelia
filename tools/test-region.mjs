/**
 * Headless regression for the regional world.
 *
 * P1 asks for a region of logical stands that share one landscape: coherent
 * terrain, water that crosses stand borders, communities that follow the
 * ground, a founding stand a network can actually live in, and spores that
 * travel between neighbours on the wind. Everything here is deterministic, so
 * a failure prints the numbers that disagree rather than a screenshot.
 *
 *   node tools/test-region.mjs
 *   REGION_SEEDS=raven-wood,old-growth node tools/test-region.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Compile the headless simulation into a unique temporary directory.
const output = mkdtempSync(join(tmpdir(), 'mycelia-region-'));
const modules = ['content', 'rng', 'region', 'world', 'network', 'sim', 'match'];
for (const name of modules) {
  const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
  const compiled = stripTypeScriptTypes(source);
  writeFileSync(join(output, `${name}.mjs`), compiled.replace(/from '(.+?)'/g, "from '$1.mjs'"));
}
const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
const {
  STAND_SIZE,
  createRegion,
  downwindStands,
  speciesFor,
  standAt,
  validateRegion,
} = await load('region');
const { ECON, MAX_DEPTH_CM } = await load('content');
const { RegionalMatch } = await load('match');

const results = [];
const ok = (line) => {
  results.push(line);
  console.log('  ok - ' + line);
};

const seeds = (process.env.REGION_SEEDS ?? 'raven-wood,old-growth,ironwood').split(',').filter(Boolean);
const verbose = process.argv.includes('--verbose');

/** The whole region as one table, for tuning thresholds against real numbers. */
function dump(region, seed) {
  if (!verbose) return;
  console.log(
    `       ${seed} stream: ${region.streamPath.length} points through stands [${region.streamStands.join(', ')}]; ` +
      `flow at stands ${region.stands.map((s) => s.flow.toFixed(2)).join(' ')}`
  );
  console.log(`       ${seed} stands:`);
  for (const stand of region.stands) {
    console.log(
      `         ${stand.id} (${stand.sx},${stand.sy}) ${stand.community.padEnd(20)} ` +
        `flow ${stand.flow.toFixed(2)} moisture ${stand.moisture.toFixed(2)} drainage ${stand.drainage.toFixed(2)} ` +
        `table ${stand.waterTableCm.toFixed(0)} elev ${stand.elevation.toFixed(1)} relief ${(stand.high - stand.low).toFixed(1)} ` +
        `slope ${stand.slope.toFixed(1)} eFlow ${Math.max(stand.edges.north.flow, stand.edges.east.flow, stand.edges.south.flow, stand.edges.west.flow).toFixed(2)}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. The terrain is one surface, not nine squares
// ---------------------------------------------------------------------------
{
  const region = createRegion(seeds[0]);
  let worstSeam = 0;
  let checked = 0;
  for (const stand of region.stands) {
    for (const side of ['north', 'east']) {
      const edge = stand.edges[side];
      if (edge.neighbour === null) continue;
      const other = region.stands[edge.neighbour];
      const opposite = side === 'north' ? other.edges.south : other.edges.west;
      // Both sides sample the same line of the same heightfield.
      assert.equal(edge.height, opposite.height, `${stand.id} ${side} edge disagrees with stand ${other.id}`);
      assert.equal(edge.flow, opposite.flow, `${stand.id} ${side} edge flow disagrees with stand ${other.id}`);
      worstSeam = Math.max(worstSeam, Math.abs(edge.height - opposite.height));
      checked++;
    }
  }
  assert.ok(checked >= 12, 'a 3x3 region has twelve internal borders');

  // And the field itself is continuous across a border, not merely equal at
  // the sampled points.
  const stand = region.stands[4];
  const seam = stand.edges.east;
  const other = region.stands[seam.neighbour];
  const y = other.centreY;
  const left = region.heightAt(seam.height !== undefined ? (stand.sx + 1) * STAND_SIZE - 0.01 : 0, y);
  const right = region.heightAt((stand.sx + 1) * STAND_SIZE + 0.01, y);
  assert.ok(Math.abs(left - right) < 0.01, `height jumps by ${Math.abs(left - right)} at the border`);
  ok(`${checked} shared stand borders agree exactly (worst mismatch ${worstSeam}) and the ground is continuous across them`);
}

// ---------------------------------------------------------------------------
// 2. Terrain comes first, and water follows the ground
// ---------------------------------------------------------------------------
{
  for (const seed of seeds) {
    const region = createRegion(seed);
    dump(region, seed);
    const validation = region.validation;
    assert.ok(validation.ok, `${seed}: ${validation.problems.join('; ')}`);
    assert.ok(validation.reachableStands === region.stands.length, `${seed}: every stand is reachable on foot`);
    assert.ok(validation.streamBoundaries >= 2, `${seed}: the water crosses ${validation.streamBoundaries} borders`);
    assert.ok(validation.habitableStands >= 6, `${seed}: only ${validation.habitableStands} stands can hold a network`);

    // Water gathers where the ground gathers it: the wettest stand in the
    // region is a stream stand, and the deepest water is on high, steep ground.
    const ranked = [...region.stands].sort((a, b) => a.waterTableCm - b.waterTableCm);
    const wettest = ranked[0];
    const deepest = ranked[ranked.length - 1];
    assert.ok(
      wettest.flow >= deepest.flow,
      `${seed}: the shallowest water table (${wettest.waterTableCm.toFixed(0)}cm) is not the strongest flow (${wettest.flow.toFixed(2)})`
    );
    assert.ok(wettest.waterTableCm < deepest.waterTableCm, `${seed}: the water table has no relief`);

    const communities = new Set(region.stands.map((stand) => stand.community));
    assert.ok(communities.size >= 3, `${seed}: only ${communities.size} communities in nine stands`);
    for (const stand of region.stands) {
      assert.ok(stand.moisture >= 0 && stand.moisture <= 1, `${seed}: moisture out of range`);
      assert.ok(stand.waterTableCm >= 16 && stand.waterTableCm <= MAX_DEPTH_CM - 4, `${seed}: water table out of range`);
    }
    // The stands the water runs through are exactly the stands labelled as a
    // stream corridor, so the drawn stream and the community cannot drift apart.
    const corridors = region.stands.filter((stand) => stand.community === 'stream-corridor').map((stand) => stand.id).sort();
    const watered = [...new Set(region.streamStands)].sort((a, b) => a - b);
    assert.deepEqual(corridors, watered, `${seed}: stream corridors ${corridors} do not match the water's course ${watered}`);
    assert.ok(region.streamPath.length > 40, `${seed}: the stream is only ${region.streamPath.length} cells long`);
    console.log(
      `       ${seed}: ${validation.habitableStands} habitable stands, ${validation.streamBoundaries} stream borders, ` +
        `${communities.size} communities, founding stand ${validation.foundingStand}`
    );
  }
  ok(`${seeds.length} regions generate coherent terrain, water and communities`);
}

// ---------------------------------------------------------------------------
// 3. A stand knows where it is, and the map is deterministic
// ---------------------------------------------------------------------------
{
  const a = createRegion(seeds[0]);
  const b = createRegion(seeds[0]);
  const c = createRegion(seeds[1] ?? 'ironwood');
  assert.deepEqual(a.stands, b.stands, 'the same seed must build the same stands');
  assert.equal(a.foundingStand, b.foundingStand);
  assert.notDeepEqual(a.stands.map((stand) => stand.elevation), c.stands.map((stand) => stand.elevation));

  for (const stand of a.stands) {
    const inside = standAt(a, stand.centreX, stand.centreY);
    assert.equal(inside?.id, stand.id, 'a point inside a stand resolves to that stand');
  }
  assert.equal(standAt(a, -1, 10), null, 'outside the region there is no stand');
  assert.equal(standAt(a, a.cols * STAND_SIZE + 1, 10), null);
  ok('the same seed builds the same region, and stand lookup resolves every centre');
}

// ---------------------------------------------------------------------------
// 4. Wind: adjacent stands always, further only in heavy wind
// ---------------------------------------------------------------------------
{
  const region = createRegion(seeds[0]);
  const base = region.wind;
  const calm = { direction: base.direction, strength: base.strength };
  const from = region.foundingStand;
  const source = region.stands[from];

  // Ordinary wind reaches the neighbours it blows toward, and nothing further.
  const near = downwindStands(region, from, calm, 1.01);
  for (const id of near) {
    const stand = region.stands[id];
    assert.ok(source.neighbours.includes(id), `stand ${id} is not adjacent to the founding stand`);
  }
  assert.ok(near.length > 0, 'ordinary wind reaches at least one neighbour');

  // Heavy wind reaches a stand that is not adjacent, in the direction it blows.
  const storm = { direction: base.direction, strength: base.strength + 1.5 };
  const far = downwindStands(region, from, storm, 2.01).filter((id) => !source.neighbours.includes(id));
  assert.ok(far.length > 0, 'a storm carries spores past the adjacent stand');
  for (const id of far) {
    const dx = region.stands[id].centreX - source.centreX;
    const dy = region.stands[id].centreY - source.centreY;
    const along = Math.cos(storm.direction) * dx + Math.sin(storm.direction) * dy;
    assert.ok(along > 0, `stand ${id} is not downwind`);
  }

  // Storms arrive during a match, and the wind turns slowly rather than snapping.
  let stormy = 0;
  let previous = region.windAt(0).direction;
  let biggestTurn = 0;
  for (let t = 0; t < 900; t += 5) {
    const wind = region.windAt(t);
    if (wind.strength > 1.1) stormy++;
    biggestTurn = Math.max(biggestTurn, Math.abs(wind.direction - previous));
    previous = wind.direction;
  }
  assert.ok(stormy > 0, 'no storm in fifteen minutes of weather');
  assert.ok(biggestTurn < 0.05, `the wind snapped ${biggestTurn.toFixed(3)} radians in five seconds`);
  ok(`wind reaches ${near.length} adjacent stand(s) in ordinary weather and ${far.length} more in a storm, with ${stormy} stormy samples in 15 minutes`);
}

// ---------------------------------------------------------------------------
// 5. Communities decide the stand, and a stand decides its mix
// ---------------------------------------------------------------------------
{
  const region = createRegion(seeds[0]);
  const tally = (community) => {
    const counts = { oak: 0, birch: 0, hemlock: 0 };
    for (let i = 0; i < 1000; i++) counts[speciesFor(community, i / 1000)]++;
    return counts;
  };
  const ridge = tally('oak-ridge');
  const ravine = tally('hemlock-ravine');
  const hollow = tally('birch-hollow');
  assert.ok(ridge.oak >= 650, `an oak ridge offers only ${ridge.oak} oak in a thousand`);
  assert.ok(ravine.hemlock >= 600, `a hemlock ravine offers only ${ravine.hemlock} hemlock in a thousand`);
  assert.ok(hollow.birch >= 550, `a birch hollow offers only ${hollow.birch} birch in a thousand`);
  for (const community of ['oak-ridge', 'hemlock-ravine', 'birch-hollow']) {
    const counts = tally(community);
    assert.ok(counts.oak > 0 && counts.birch > 0 && counts.hemlock > 0, `${community} has no mixture at all`);
  }

  // The mixed slope reproduces the stand the prototype has always drawn.
  assert.equal(speciesFor('mixed-slope', 0.44), 'oak');
  assert.equal(speciesFor('mixed-slope', 0.79), 'birch');
  assert.equal(speciesFor('mixed-slope', 0.9), 'hemlock');
  assert.ok(region.stands.some((stand) => stand.community !== 'mixed-slope'), 'nine stands are not one community');
  ok('community decides the species mix, and the mixed slope keeps the original 45/35/20');
}

// ---------------------------------------------------------------------------
// 6. Validation rejects a region that cannot be played
// ---------------------------------------------------------------------------
{
  const region = createRegion(seeds[0]);
  const broken = {
    ...region,
    stands: region.stands.map((stand) => ({ ...stand, neighbours: [] })),
  };
  const verdict = validateRegion(broken);
  assert.equal(verdict.ok, false, 'a region with no adjacency must not validate');
  assert.ok(
    verdict.problems.some((problem) => problem.includes('cannot be reached')),
    `expected a reachability problem, got ${verdict.problems.join('; ')}`
  );
  ok('validation refuses a region whose stands cannot be reached from the founding stand');
}

// ---------------------------------------------------------------------------
// 7. The match: stands, weather, spores and the camera
// ---------------------------------------------------------------------------
{
  const advance = (match, seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) match.step(1 / 60);
  };
  const snapshot = (match) =>
    match.stands.map((stand) => ({
      id: stand.site.id,
      colonized: stand.sim.hasColony,
      strands: stand.sim.hasColony ? stand.sim.player.nodes.filter((node) => node.alive).length : 0,
      carbon: stand.sim.hasColony ? Number(stand.sim.player.carbon.toFixed(6)) : 0,
      waterTable: Number(stand.sim.world.waterTableCm.toFixed(6)),
      fruited: stand.sim.hasColony ? stand.sim.player.fruited : 0,
    }));

  // A match opens in one stand, and only that stand is simulated.
  const match = new RegionalMatch(seeds[0]);
  assert.equal(match.colonizedStands, 1, 'a match opens with one colony');
  assert.equal(match.activeStandId, match.region.foundingStand, 'the founding stand is the one in view');
  assert.equal(match.stands.filter((stand) => stand.sim.hasColony).length, 1, 'no other stand holds a colony yet');
  {
    // Ground with no colony can still be entered and looked at; there is simply
    // nothing to give orders to.
    const empty = match.stands.findIndex((stand) => !stand.sim.hasColony);
    assert.equal(match.selectStand(empty), true, 'ground with no colony can be entered');
    assert.equal(match.activeColonized, false, 'and it is known to be empty');
    assert.equal(match.selectStand(match.region.foundingStand), true);
    assert.equal(match.activeColonized, true);
  }
  advance(match, 5);

  // Every colony shares one weather, without any of them being told about it.
  {
    const other = new RegionalMatch(seeds[0]);
    advance(other, 90);
    const seasons = new Set(other.stands.filter((stand) => stand.sim.hasColony).map((stand) => stand.sim.season.id));
    assert.equal(seasons.size, 1, `colonies disagree about the season: ${[...seasons]}`);
    const times = other.stands.filter((stand) => stand.sim.hasColony).map((stand) => stand.sim.time);
    assert.ok(Math.max(...times) - Math.min(...times) < 1e-6, 'colonies count different time');
  }

  /** Give a colony a bloom's worth of spores and let it release them. */
  const release = (m, standId, into) => {
    const stand = m.stands[standId];
    stand.sim.player.carbon = into ?? 300;
    stand.sim.player.fruited += 1;
    const events = m.colonization.length;
    let before = stand.sim.player.carbon;
    for (let i = 0; i < 240 && m.colonization.length === events; i++) {
      before = stand.sim.player.carbon;
      m.step(1 / 60);
    }
    return { stand, before };
  };

  // A bloom sends a spore to an adjacent stand, and the parent pays for it.
  {
    const m = new RegionalMatch(seeds[0]);
    const from = m.region.foundingStand;
    const { stand, before } = release(m, from);
    assert.equal(m.colonization.length, 1, 'a bloom should found exactly one daughter colony here');
    const event = m.colonization[0];
    assert.equal(event.from, from);
    assert.ok(
      m.region.stands[from].neighbours.includes(event.to),
      `ordinary wind carried a spore to stand ${event.to}, which is not adjacent to ${from}`
    );
    assert.equal(m.colonizedStands, 2, 'the daughter stand is colonized');
    // The parent's balance also moves with its ordinary trade and upkeep, so
    // the exact figure to check is what the daughter *received*.
    assert.ok(
      before - stand.sim.player.carbon >= ECON.colonyFund.carbon - 1e-6,
      `the parent only gave up ${(before - stand.sim.player.carbon).toFixed(2)} carbon for a ${ECON.colonyFund.carbon} fund`
    );
    const daughter = m.stands[event.to].sim;
    assert.ok(daughter, 'the daughter stand has a live colony');
    assert.equal(
      Number(daughter.player.carbon.toFixed(6)),
      ECON.colonyFund.carbon,
      'the daughter must start with exactly what was paid, and no more'
    );
    assert.equal(
      Number(daughter.player.water.toFixed(6)),
      ECON.colonyFund.water,
      'the daughter must not be handed water from nowhere'
    );
    assert.equal(
      Number(daughter.player.nitrogen.toFixed(6)),
      ECON.colonyFund.nitrogen,
      'the daughter must not be handed mineral from nowhere'
    );
    const held = daughter.player.carbon + daughter.player.nodes.reduce((sum, node) => sum + node.carbon, 0);
    assert.equal(
      Number(held.toFixed(6)),
      ECON.colonyFund.carbon,
      'the daughter holds exactly the fund, in its reserves and nowhere else'
    );
    assert.equal(daughter.player.lengthCm, 0, 'a daughter colony begins as a germinating spore, not a network');
  }
  ok('a bloom founds exactly one adjacent stand, and the carbon that crosses the border is the carbon that was paid');

  // Heavy wind reaches further than adjacency — but only when it has to, so the
  // test first fills every neighbour and then asks the storm for somewhere new.
  {
    const m = new RegionalMatch(seeds[0]);
    const from = m.region.foundingStand;
    // Ordinary weather only carries a spore downwind, so fill every stand it
    // can reach and then ask the storm for somewhere it could not have gone.
    for (let attempt = 0; attempt < 8; attempt++) {
      release(m, from);
      const wind = m.region.windAt(m.stands[from].sim.time);
      const reachable = downwindStands(m.region, from, wind, 1.01);
      if (reachable.every((id) => m.stands[id].sim.hasColony)) break;
    }
    const calmWind = m.region.windAt(m.stands[from].sim.time);
    const withinReach = downwindStands(m.region, from, calmWind, 1.01);
    assert.ok(withinReach.length > 0, 'ordinary wind should reach at least one neighbour');
    assert.ok(
      withinReach.every((id) => m.stands[id].sim.hasColony),
      'ordinary wind could still reach an uncolonized stand, so the storm proves nothing'
    );

    const stormAt = (() => {
      for (let t = 1; t < 4000; t += 1) if (m.region.windAt(t).strength >= 1.1) return t;
      return null;
    })();
    assert.ok(stormAt !== null, 'no storm anywhere in a match');
    m.stands[from].sim.time = stormAt;
    const before = m.colonization.length;
    if (verbose) {
      const wind = m.region.windAt(stormAt);
      console.log(
        `       storm at ${stormAt}s: wind ${wind.strength.toFixed(2)} toward ${wind.direction.toFixed(2)}, ` +
          `candidates [${downwindStands(m.region, from, wind, 2.01).join(', ')}], ` +
          `carbon ${m.stands[from].sim.player.carbon.toFixed(0)}, released ${m.stands[from].released}, fruited ${m.stands[from].sim.player.fruited}`
      );
    }
    release(m, from);
    if (verbose) {
      console.log(
        `       after storm release: events ${m.colonization.length}, outcome ${m.outcome}, ` +
          `carbon ${m.stands[from].sim.player.carbon.toFixed(0)}, released ${m.stands[from].released}, ` +
          `fruited ${m.stands[from].sim.player.fruited}, colonized [${m.stands.map((s, i) => (s.sim ? i : null)).filter((i) => i !== null).join(',')}]`
      );
    }
    assert.equal(m.colonization.length, before + 1, 'the storm spore should still land');
    const event = m.colonization[m.colonization.length - 1];
    assert.ok(event.wind >= 1.1, `expected a storm, got wind ${event.wind.toFixed(2)}`);
    assert.ok(
      !m.region.stands[from].neighbours.includes(event.to),
      `with every neighbour colonized, the storm should carry past them, but the spore landed in ${event.to}`
    );
    const straight = Math.hypot(
      m.region.stands[event.to].centreX - m.region.stands[from].centreX,
      m.region.stands[event.to].centreY - m.region.stands[from].centreY
    );
    assert.ok(straight <= STAND_SIZE * 2.1, 'the storm spore travelled further than a storm should carry it');
  }
  ok('a storm carries a spore past the adjacent stand, and no further than the wind reaches');

  // A parent that cannot pay sends nobody.
  {
    const m = new RegionalMatch(seeds[0]);
    const from = m.region.foundingStand;
    const stand = m.stands[from];
    // Nothing to give: the colony still has its soil income, so give it a
    // moment to earn and check that it still cannot fund a journey. The pool
    // and the strands are emptied together — the pool is re-derived from what
    // the strands hold, so emptying one alone would not make it poor.
    stand.sim.player.carbon = 0;
    for (const node of stand.sim.player.nodes) node.carbon = 0;
    stand.sim.player.fruited += 1;
    for (let i = 0; i < 180; i++) m.step(1 / 60);
    assert.ok(
      stand.sim.player.carbon < ECON.colonyFund.carbon,
      `the colony earned ${stand.sim.player.carbon.toFixed(1)} carbon in three seconds, so this proves nothing`
    );
    assert.equal(m.colonization.length, 0, 'a colony that cannot pay must not found a daughter');
    assert.equal(m.colonizedStands, 1);
    assert.ok(stand.sim.player.carbon >= 0, 'a parent is never driven into debt by a spore');
  }
  ok('a colony that cannot afford a spore does not send one, and is never driven into debt');

  // A colony keeps growing while nobody is looking at it.
  {
    const m = new RegionalMatch(seeds[0]);
    const from = m.region.foundingStand;
    release(m, from);
    const daughterId = m.colonization[0].to;
    m.selectStand(from);
    advance(m, 4);
    const looked = m.stands[daughterId].sim.player.nodes.length;
    const carbon = m.stands[daughterId].sim.player.carbon;
    advance(m, 120);
    const after = m.stands[daughterId].sim.player;
    assert.equal(m.activeStandId, from, 'the player never visited the daughter stand');
    assert.ok(after.nodes.length >= looked, 'the daughter colony lost strands while unvisited');
    assert.ok(
      after.nodes.length > 1 || after.carbon !== carbon || after.age > 0,
      'the daughter colony did not change at all while unvisited'
    );
    assert.equal(m.selectStand(daughterId), true, 'the daughter stand can be entered later');
    assert.equal(m.sim, m.stands[daughterId].sim, 'entering a stand reads that stand');
  }
  ok('a colony grows while nobody is looking, and the stand can be entered later');

  // Where the camera is never changes what happens.
  {
    const plain = new RegionalMatch(seeds[0]);
    const watched = new RegionalMatch(seeds[0]);
    for (const m of [plain, watched]) {
      m.stands[m.region.foundingStand].sim.player.carbon = 300;
      m.stands[m.region.foundingStand].sim.player.fruited += 1;
    }
    for (let i = 0; i < 120 * 60; i++) {
      plain.step(1 / 60);
      watched.step(1 / 60);
      if (i % 600 === 0) {
        for (const stand of watched.stands) if (stand.sim) watched.selectStand(stand.site.id);
      }
    }
    assert.deepEqual(snapshot(watched), snapshot(plain), 'looking around changed the match');
    assert.equal(watched.fruited, plain.fruited);
    assert.equal(watched.colonizedStands, plain.colonizedStands);
  }
  ok('two minutes of match are identical whether or not the player moves between stands');

  // And the whole region is deterministic.
  {
    const a = new RegionalMatch(seeds[1] ?? 'ironwood');
    const b = new RegionalMatch(seeds[1] ?? 'ironwood');
    for (const m of [a, b]) {
      m.stands[m.region.foundingStand].sim.player.carbon = 300;
      m.stands[m.region.foundingStand].sim.player.fruited += 1;
    }
    advance(a, 60);
    advance(b, 60);
    assert.deepEqual(snapshot(a), snapshot(b), 'the same seed and the same orders must build the same region');
    assert.deepEqual(a.colonization, b.colonization, 'the same spores must land in the same stands');
  }
  ok('the same seed colonizes the same stands with the same spores');
}

console.log(`PASS: ${results.length} checks.`);
