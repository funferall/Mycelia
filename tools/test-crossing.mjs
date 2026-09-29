/**
 * Headless checks for the first real stand crossing (`MAP-07` stages 3-4).
 *
 * The fixture is the small funded two-stand corridor, not a warmed match: one
 * colony, one section plane, one boundary. What is being checked is that
 * crossing that boundary is ordinary growth through ordinary soil by ordinary
 * rules, and that resources keep crossing it afterwards.
 *
 *   node tools/test-crossing.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'mycelia-crossing-'));
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
  for (const name of ['content', 'rng', 'region', 'world', 'spatial', 'soil-volume', 'network', 'sim', 'crossing', 'shared-soil', 'wildfire', 'drought', 'flood', 'match', 'survey']) {
    const source = readFileSync(new URL(`../src/sim/${name}.ts`, import.meta.url), 'utf8');
    writeFileSync(join(output, `${name}.mjs`), stripTypeScriptTypes(source).replace(/from '(.+?)'/g, "from '$1.mjs'"));
  }
  const load = (name) => import(pathToFileURL(join(output, `${name}.mjs`)).href);
  const { CrossingMatch } = await load('crossing');
  const { RegionalMatch } = await load('match');
  const { buildSurvey } = await load('survey');
  const { ECON, GRID, MAX_TIPS } = await load('content');
  const {
    MAX_NODES,
    bondedJunction,
    createNetwork,
    holdsAnyBond,
    makeCord,
    markConnectivity,
    stepNetwork,
    updateTotals,
    tryBond,
  } = await load('network');
  const { createStandWorld, entryCostFor } = await load('world');
  const { mulberry32 } = await load('rng');
  const { elevationAtDepthCm, segmentStands, traverseSegment, vec3 } = await load('spatial');

  const DT = 1 / 30;
  const stepFor = (match, seconds) => {
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) match.step(DT);
  };
  const totalOf = (match) => {
    const totals = match.totals();
    return totals.carbon + totals.water + totals.nitrogen;
  };
  const living = (match) => match.colony.nodes.filter((node) => node.alive);

  /** Step until the colony stands on both sides of the seam, or give up. */
  function cross(match, seconds = 90) {
    match.orderAcross();
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) {
      match.step(DT);
      if (match.portals().length > 0) return i * DT;
    }
    return -1;
  }

  // -------------------------------------------------------------------------
  check('the fixture funds one colony beside one shared edge', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    assert.notEqual(match.originStandId, match.destinationStandId);
    const origin = match.region.stands[match.originStandId];
    const destination = match.region.stands[match.destinationStandId];
    const steps = Math.abs(origin.sx - destination.sx) + Math.abs(origin.sy - destination.sy);
    assert.equal(steps, 1, 'the two stands are orthogonally adjacent');
    assert.equal(match.colonies.length, 1, 'one colony, not one per stand');
    assert.equal(match.colony.rootId, 0);
    // Every strand carries the section's fixed coordinate: horizontal y is held
    // constant in this fixture, which is what keeps the first crossing small.
    assert.ok(match.plane.along === 'x' ? match.direction === 'east' || match.direction === 'west' : true);
    for (const node of match.colony.nodes) {
      assert.equal(node.y, match.plane.fixed);
      assert.equal(node.standId, match.originStandId);
    }
    assert.ok(match.stands.length === 1, 'only the origin stand is active at the start');
  });

  check('a tip grows across the seam at normal speed, unbroken and unsplit', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    const strandsBefore = match.colony.nodes.length;
    const ceilingBefore = match.colony.tipCeiling;
    const seconds = cross(match);
    assert.ok(seconds > 0, 'the colony reached the next stand');
    assert.ok(seconds < 60, `the crossing is a short run, not a campaign (${seconds.toFixed(1)}s)`);
    assert.ok(match.colony.nodes.length > strandsBefore, 'the colony grew into it');
    // One body: same colony, same root, same budget.
    assert.equal(match.colonies.length, 1);
    assert.equal(match.colony.rootId, 0);
    assert.equal(match.colony.tipCeiling, ceilingBefore, 'a boundary is not a second frontier budget');
    assert.ok(match.colony.nodes.length < MAX_NODES);

    const portals = match.portals();
    assert.ok(portals.length >= 1, 'a real edge spans the seam');
    for (const portal of portals) {
      assert.notEqual(portal.standId, portal.parentStandId);
      assert.equal(portal.parentStandId, match.originStandId);
      assert.equal(portal.standId, match.destinationStandId);
      // The parent edge is unbroken: walking it reaches the founding strand.
      let cursor = portal.parentId;
      let hops = 0;
      while (cursor > 0) {
        const node = match.colony.nodes[cursor];
        assert.ok(node, 'every parent link resolves');
        assert.ok(hops < 4000, 'the walk terminates');
        cursor = node.parent;
        hops++;
      }
      assert.equal(cursor, 0, 'the crossing strand is still joined to the founder');
    }
    // The destination stand's own ecology was activated by the simulation, and
    // not by anyone looking at it.
    const reached = match.stand(match.destinationStandId);
    assert.ok(reached, 'the destination stand is active');
    assert.ok(reached.world.trees.length > 0, 'its trees came with it');
    assert.ok(match.nodesInStand(match.destinationStandId).length > 0);
  });

  check('crossing a boundary adds no tax: the same voxel costs the same', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    assert.ok(cross(match) > 0, 'the colony crossed');
    const portal = match.portals()[0];
    const node = match.colony.nodes[portal.nodeId];
    // The destination voxel, priced from the strand that crossed into it.
    const inDestination = match.world.costFrom(node, 0, 0);
    const voxel = match.voxelOf(node, 0, 0);
    const material = match.soil.readMaterialAt(voxel.x, voxel.y, voxel.z);
    const expected = entryCostFor(material);
    assert.equal(inDestination.cost, expected.cost);
    assert.equal(inDestination.stratum.id, expected.stratum.id);
    // And the same rule holds on the parent's side of the seam: the boundary is
    // not a price and a stand is not a surcharge. The fixture's strands drift a
    // little across their growth plane, so the parent and the child stand in
    // different physical cells; each is priced by the one rule, at its own cell.
    const parent = match.colony.nodes[portal.parentId];
    const parentVoxel = match.voxelOf(parent, 0, 0);
    const parentCost = match.world.costFrom(parent, 0, 0);
    const parentExpected = entryCostFor(match.soil.readMaterialAt(parentVoxel.x, parentVoxel.y, parentVoxel.z));
    assert.equal(parentCost.cost, parentExpected.cost, 'the origin side is priced by the same rule');
    assert.equal(parentCost.stratum.id, parentExpected.stratum.id);
    // The ordinary length-based price is the one charged.
    const pressure = 1 + Math.pow(match.colony.nodes.length / MAX_NODES, 4) * 14;
    const entryTotal = expected.cost * ECON.growthPerCm * ECON.entryCharge * pressure;
    assert.ok(entryTotal > 0 && Number.isFinite(entryTotal));
    assert.ok(entryTotal < ECON.colonyFund.carbon * 0.5, 'one centimetre is not a colony tax');
  });

  check('the destination soil is consumed once per arrival', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    match.orderAcross();
    const occupied = new Set();
    let arrivals = 0;
    for (let i = 0; i < 30 / DT && match.portals().length === 0; i++) {
      match.step(DT);
      for (const node of match.colony.nodes) {
        if (!node.alive) continue;
        const voxel = match.voxelOf(node, 0, 0);
        if (!voxel) continue;
        const key = `${voxel.x.toFixed(3)},${voxel.y.toFixed(3)},${voxel.z.toFixed(3)}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        const occupancy = match.soil.readMaterialAt(voxel.x, voxel.y, voxel.z).occupancy;
        // Arriving in a cell adds exactly one hyphal load. It is never charged
        // twice for one arrival, and never once per stand that can see the same
        // physical cell. Thickening may add its trickle in the same tick.
        const trickle = 0.02 * DT;
        let loads = -1;
        for (let k = 12; k >= 0; k--) {
          const rest = occupancy - k * 0.34;
          if (rest < -1e-9) continue;
          const trickles = Math.round(rest / trickle);
          if (Math.abs(rest - trickles * trickle) < 1e-9) {
            loads = k;
            break;
          }
        }
        assert.ok(loads >= 0, `occupancy ${occupancy} is arrivals plus thickening, nothing else`);
        arrivals += loads;
      }
    }
    assert.ok(arrivals > 0, 'arrivals were recorded on the way across');
    assert.ok(match.portals().length > 0, 'the colony crossed the seam');
    assert.ok(match.soil.materializedCount > 0, 'the shared volume holds the changed soil');
  });

  check('resources stay conserved while a spanning colony is stepped', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    assert.ok(cross(match) > 0, 'the colony crossed');
    // Freeze growth and intake, then step the real pipeline: every transfer
    // between strands must subtract exactly what it adds, seam or no seam.
    match.colony.resting = true;
    markConnectivity(match.colony);
    for (const node of match.colony.nodes) {
      if (!node.alive) continue;
      const voxel = match.voxelOf(node, 0, 0);
      if (voxel) match.soil.mutate(voxel.x, voxel.y, voxel.z, { water: 0, nitrogen: 0, organic: 0 });
    }
    const totals = () => {
      let water = 0;
      let nitrogen = 0;
      for (const node of match.colony.nodes) {
        if (!node.alive) continue;
        water += node.water;
        nitrogen += node.nitrogen;
      }
      return { water, nitrogen };
    };
    const tick = (i) =>
      stepNetwork(match.colony, {
        world: match.world,
        light: 1,
        warmth: 1,
        rival: null,
        time: match.time + i * DT,
        log() {},
        dt: DT,
      });
    // One settling tick first: the funded kit starts above the working caps, and
    // bringing it down is the existing storage rule, not a leak across the seam.
    tick(0);
    const before = totals();
    for (let i = 1; i <= 60; i++) tick(i);
    const after = totals();
    assert.ok(Math.abs(after.water - before.water) < 1e-9, `water is conserved (${before.water} -> ${after.water})`);
    assert.ok(Math.abs(after.nitrogen - before.nitrogen) < 1e-9, 'mineral is conserved');
    assert.ok(match.nodesInStand(match.destinationStandId).length > 0, 'the colony still spans the seam');
    match.colony.resting = false;
  });

  check('a bonded tree in the far stand feeds the same connected body', () => {
    const [a, b] = [new CrossingMatch({ seedText: 'raven-wood', direction: 'east' }), new CrossingMatch({ seedText: 'raven-wood', direction: 'east' })];
    // Grow toward the nearest reachable root tip and take the bond as soon as a
    // strand is close enough - which is what a player does with the root label,
    // and what keeps the arriving tip the junction that bonds.
    const bond = (match) => {
      assert.ok(cross(match) > 0, 'the colony crossed');
      const tried = new Set();
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = match.nearestUnbondedTip(match.destinationStandId, tried);
        if (!candidate) break;
        for (let i = 0; i < 30 / DT; i++) {
          if (i % 15 === 0) match.orderTowardTip(candidate.treeRef, candidate.tipId);
          match.step(DT);
          if (i % 4 === 0 && match.bond(candidate.treeRef, candidate.tipId).ok) return candidate;
        }
        // Unreachable behind stone, saturation or a dying strand: ask for the
        // next one instead of looping on the same answer.
        tried.add(`${candidate.treeRef.treeId}:${candidate.tipId}`);
      }
      return null;
    };
    const bondedRun = a;
    const severedRun = b;
    const remote = bond(bondedRun);
    const other = bond(severedRun);
    assert.ok(remote && other, 'a remote bond formed in both runs');
    assert.equal(a.hash(), b.hash(), 'the two identical runs agree exactly before the cut');

    // The junction really is in the far stand, joined to the founder.
    const index = bondedRun.treeIndex(remote.treeRef);
    const tree = bondedRun.world.trees[index];
    const junction = tree.rootTips[remote.tipId].bondedTo;
    assert.notEqual(junction, null, 'the tree is bonded');
    const junctionNode = bondedRun.colony.nodes[junction];
    assert.equal(junctionNode.standId, bondedRun.destinationStandId);
    assert.ok(junctionNode.connected, 'the far junction is joined to the same body');

    // Sever the same bond in the other run only. The two differ in exactly one
    // fact - whether the far tree is trading - so the difference in carbon is
    // what that far partner pays into the one connected body.
    const severedTree = severedRun.world.trees[severedRun.treeIndex(other.treeRef)];
    const severedJunction = severedTree.rootTips[other.tipId].bondedTo;
    severedTree.rootTips[other.tipId].bondedTo = null;
    severedRun.colony.nodes[severedJunction].bondedTree = -1;
    severedRun.colony.nodes[severedJunction].bondedRootTip = -1;
    bondedRun.colony.resting = true;
    severedRun.colony.resting = true;
    const bondedBefore = bondedRun.totals().carbon;
    const severedBefore = severedRun.totals().carbon;
    stepFor(bondedRun, 8);
    stepFor(severedRun, 8);
    const bondedGain = bondedRun.totals().carbon - bondedBefore;
    const severedGain = severedRun.totals().carbon - severedBefore;
    assert.ok(
      bondedGain > severedGain,
      `the far tree pays the body that supplies it (${bondedGain.toFixed(3)} > ${severedGain.toFixed(3)})`
    );
    assert.ok(
      tree.waterReceived > 0 || bondedRun.colony.nodes[junction].water < ECON.nodeWaterCap,
      'the far tree is being supplied'
    );
  });

  check('cutting the seam stops supply to the far side', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    assert.ok(cross(match) > 0);
    const farNodesBefore = match.nodesInStand(match.destinationStandId).length;
    assert.ok(farNodesBefore > 0);
    // Cut every strand that spans the seam. The colony is a tree, so those are
    // the far stand's only supply routes.
    const spans = match.portals();
    assert.ok(spans.length > 0, 'there is something to cut');
    const cutOffIds = new Set(match.nodesInStand(match.destinationStandId).map((node) => node.id));
    for (const span of spans) match.cut(span.parentId);
    markConnectivity(match.colony);
    const far = match.nodesInStand(match.destinationStandId);
    assert.ok(far.length > 0, 'the far strands are still standing');
    // Distal tissue is not deleted just because it is unseen, but it is no
    // longer part of the living body and cannot keep trading.
    const stranded = far.filter((node) => cutOffIds.has(node.id));
    assert.ok(stranded.length > 0);
    assert.equal(stranded.every((node) => !node.connected), true, 'the far side is severed, not erased');
    const healthBefore = stranded.reduce((sum, node) => sum + node.health, 0);
    stepFor(match, 30);
    const stillSevered = stranded.filter((node) => node.alive && node.connected);
    assert.equal(stillSevered.length, 0, 'nothing stranded by the cut reconnects to the founder');
    // And without supply they are starving: a cut is felt, not merely recorded.
    const healthAfter = stranded.reduce((sum, node) => sum + node.health, 0);
    assert.ok(healthAfter < healthBefore, `stranded strands lose health (${healthBefore.toFixed(2)} -> ${healthAfter.toFixed(2)})`);
  });

  check('a cord pays its cost and carries more than a hair-fine strand', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    assert.ok(cross(match) > 0);
    const portal = match.portals()[0];
    const node = match.colony.nodes[portal.nodeId];
    node.carbon = ECON.cordCharge + 10;
    const before = node.carbon;
    assert.equal(makeCord(match.colony, node.id), true, 'the cord is laid');
    assert.ok(Math.abs(node.carbon - (before - ECON.cordCharge)) < 1e-9, 'the cord cost exactly its charge');
    assert.equal(node.reinforced, true);
    assert.ok(node.thickness >= 0.9);
    assert.ok(ECON.cordThroughput > 1, 'a cord is a highway, not a wider lane');
  });

  check('a flooded target is refused before a tip can commit to it', () => {
    const match = new CrossingMatch({ seedText: 'raven-wood', direction: 'east' });
    assert.ok(cross(match) > 0);
    const tip = match.colony.nodes.find((node) => node.alive && node.isTip);
    assert.ok(tip, 'the frontier still has tips');
    // Aim at ground below the live water table and let the pipeline answer.
    const below = match.soil.waterTableDepthCm(
      match.planePointAt(tip.gx + 0.5).x,
      match.planePointAt(tip.gx + 0.5).y
    );
    const row = Math.min(GRID.rows - 1, Math.round(below) + 6);
    tip.targetGx = tip.gx + 1;
    tip.targetGy = row;
    tip.paid = false;
    const targetVoxel = match.voxelOf(tip, 1, row - tip.gy);
    assert.ok(targetVoxel, 'the target is inside the region');
    assert.equal(match.soil.blockAt(targetVoxel.x, targetVoxel.y, targetVoxel.z).reason, 'groundwater');
    for (let i = 0; i < 40; i++) {
      stepNetwork(match.colony, {
        world: match.world,
        light: 1,
        warmth: 1,
        rival: null,
        time: match.time + i * DT,
        log() {},
        dt: DT,
      });
    }
    assert.ok(tip.gy < row, `the tip never occupies saturated ground (row ${tip.gy} < ${row})`);
  });

  check('all four edge directions cross, and a corner is tested cell by cell', () => {
    const centre = 4;
    for (const direction of ['east', 'west', 'north', 'south']) {
      const match = new CrossingMatch({ seedText: 'old-growth', originStandId: centre, direction });
      assert.equal(match.direction, direction, `${direction} was reachable from the centre stand`);
      const seconds = cross(match);
      assert.ok(seconds > 0, `the colony crossed ${direction}`);
      const portal = match.portals()[0];
      assert.equal(portal.edge, direction);
      assert.notEqual(portal.parentStandId, portal.standId);
    }
    // A diagonal step through a stand corner is tested on both sides of it, so
    // growth cannot tunnel between four squares.
    const match = new CrossingMatch({ seedText: 'old-growth', originStandId: centre, direction: 'east' });
    const frame = match.standFrame(match.originStandId);
    const cornerX = frame.originX + frame.size;
    const cornerY = frame.originY + frame.size;
    const from = vec3(cornerX - 0.4, cornerY - 0.4, match.region.heightAt(cornerX - 0.4, cornerY - 0.4) - 20);
    const to = vec3(cornerX + 0.4, cornerY + 0.4, match.region.heightAt(cornerX + 0.4, cornerY + 0.4) - 20);
    const touched = traverseSegment(from, to).map((key) => `${key.ix},${key.iy}`);
    assert.ok(touched.length >= 4, `a corner step touches every square meeting there (${touched.join(' ')})`);
    assert.ok(segmentStands(match.region, from, to).length >= 3, 'the corner really is shared by several stands');
    const forward = match.soil.segment(from, to);
    const backward = match.soil.segment(to, from);
    assert.equal(forward.blocked, backward.blocked, 'the verdict does not depend on the direction walked');
    assert.equal(forward.reason, backward.reason);
  });

  check('watching a section changes nothing the simulation would notice', () => {
    const watched = new CrossingMatch({ seedText: 'ironwood', direction: 'east' });
    const unwatched = new CrossingMatch({ seedText: 'ironwood', direction: 'east' });
    for (const match of [watched, unwatched]) match.orderAcross();
    for (let i = 0; i < 40 / DT; i++) {
      watched.step(DT);
      // Someone browses a section, twice, at every tick.
      watched.soil.sampleSection({ id: 'look', y: watched.plane.fixed, xFrom: watched.seam - 30, xTo: watched.seam + 30, depthFromCm: 4, depthToCm: 60, across: 6, down: 6 });
      watched.soil.sample(watched.seam, watched.plane.fixed, watched.region.heightAt(watched.seam, watched.plane.fixed) - 20);
      unwatched.step(DT);
    }
    assert.ok(watched.portals().length > 0, 'the watched run crossed');
    assert.equal(watched.hash(), unwatched.hash(), 'a section view is not a simulation input');
    assert.ok(updateTotals(watched.colony) === undefined);
  });

  check('the running match promotes its own funded body and steps it once', () => {
    const region = new RegionalMatch('old-growth', undefined, { starts: 'best' });
    const origin = region.activeStandId;
    const sim = region.active.sim;
    const body = sim.player;
    const corridor = new CrossingMatch({ seedText: 'old-growth', originStandId: origin, direction: 'east' });
    const frame = corridor.standFrame(origin);
    const local = corridor.direction === 'west' ? 8 : frame.size - 8;
    for (const node of body.nodes) {
      const shift = local - node.gx;
      node.gx += shift;
      node.wx += shift;
      node.targetGx += shift;
      node.gy = corridor.depthRow;
      node.wy = corridor.depthRow + 0.5;
      node.targetGy = corridor.depthRow;
    }
    sim.syncRegionalPositions();
    const before = body.nodes.reduce((sum, node) => sum + node.carbon + node.water + node.nitrogen, 0);
    assert.equal(region.growAcross('east').ok, true);
    assert.equal(region.spatial.colony, body, 'the existing network is adopted, not copied');
    assert.equal(region.spatial.region, region.region, 'the running region is shared');
    assert.equal(region.spatial.stand(origin).world, sim.world, 'the same trees are used');
    const after = body.nodes.reduce((sum, node) => sum + node.carbon + node.water + node.nitrogen, 0);
    assert.ok(Math.abs(before - after) < 1e-9, 'promotion charges no founding kit');
    assert.equal(region.colonization.length, 0, 'a growth order is not a spore arrival');
    const timeBefore = region.time;
    region.step(DT);
    assert.ok(Math.abs(region.spatial.time - region.time) < 1e-8, 'one regional tick advances one shared body');
    assert.ok(region.time > timeBefore);
    for (let i = 0; i < 60 / DT && region.spatial.portals().length === 0; i++) region.step(DT);
    assert.ok(region.spatial.portals().length > 0, 'the running match reaches the neighboring stand');
    assert.equal(region.colonization.length, 0, 'the new stand was reached by growth, not spores');
    assert.equal(region.stands[region.spatial.destinationStandId].sim.hasColony, true);
    assert.equal(region.spatial.colony, body, 'the far strand still belongs to the original body');
    assert.equal(region.growthCrossings.length, 1, 'a separate physical-arrival record is kept');
    const destination = buildSurvey(region).stands[region.spatial.destinationStandId];
    assert.equal(destination.growthFrom, origin);
    assert.equal(destination.parent, null, 'a strand crossing is not spore parentage');
    assert.equal(destination.connected, true, 'the survey reads the body’s actual supply');
  });

  check('opening XYZ survives promotion and an order steers through a perpendicular section', () => {
    const region = new RegionalMatch('old-growth', undefined, { starts: 'best' });
    for (let i = 0; i < 45; i++) region.step(DT);
    const net = region.active.sim.player;
    const before = net.nodes.map((node) => ({ ...node.spatial }));
    const addresses = net.nodes.map(({ gx, gy, wx, wy, y, lateral, standId }) =>
      ({ gx, gy, wx, wy, y, lateral, standId }));
    const soilBefore = region.soil.hash();
    assert.ok(before.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)));
    assert.equal(region.growAcross('north').ok, true);
    const body = region.spatial;
    assert.equal(body.direction, 'north', 'the requested edge is chosen independently of the opening slice');
    assert.deepEqual(net.nodes.slice(0, addresses.length).map(({ gx, gy, wx, wy, y, lateral, standId }) =>
      ({ gx, gy, wx, wy, y, lateral, standId })), addresses, 'promotion changes no existing node address');
    assert.equal(region.soil.hash(), soilBefore, 'promotion moves no material');
    for (let i = 0; i < before.length; i++) {
      const after = body.nodePosition(net.nodes[i]);
      assert.ok(Math.hypot(after.x - before[i].x, after.y - before[i].y, after.z - before[i].z) < 1e-8,
        `node ${i} kept its original regional position`);
    }
    const initialX = net.nodes.map((node) => body.nodePosition(node).x);
    const left = Math.min(...initialX);
    const right = Math.max(...initialX);
    const founder = net.nodes[net.rootId];
    const centre = body.nodePosition(founder);
    const depth = (region.region.heightAt(centre.x, centre.y) - centre.z) * GRID.cmPerRow;
    const targets = [
      { x: right + 6, y: centre.y + 5 }, { x: left - 6, y: centre.y - 5 },
      { x: right + 4, y: centre.y - 4 }, { x: left - 4, y: centre.y + 4 },
    ]
      .map(({ x, y }) => ({ x, y, z: elevationAtDepthCm(region.region, x, y, depth) }))
      .filter((point) => body.soil.passableAt(point.x, point.y, point.z));
    assert.ok(targets.length > 0, 'a lateral destination has passable soil');
    const target = targets[0];
    assert.equal(body.growAt(target, 'x', target.y).ok, true, 'a perpendicular section can direct growth');
    assert.equal(net.waypoints[0].lateral, target.y);
    assert.ok(net.nodes.some((node) => node.isTip && node.targetLateral !== node.y), 'a tip aims laterally');
    for (let i = 0; i < 30 / DT; i++) region.step(DT);
    const moved = net.nodes.some((node) => node.alive &&
      (target.x > right ? body.nodePosition(node).x > right + 1 : body.nodePosition(node).x < left - 1));
    assert.ok(moved, 'the real network leaves its opening plane toward the lateral order');
  });

  check('an opening slice survives a region with no passable east-west seam corridor', () => {
    const region = new RegionalMatch('old-growth', undefined, { starts: 'best' });
    const original = region.soil.segment;
    region.soil.segment = () => ({ blocked: true });
    try {
      const slice = region.ensureSharedSoil(4);
      assert.equal(slice.alongIsX, true);
      const root = region.stands[4].sim.player.nodes[0];
      assert.ok(root.spatial, 'the independent opening still records a regional position');
      assert.equal(region.soil.passableAt(root.spatial.x, root.spatial.y, root.spatial.z), true);
    } finally {
      region.soil.segment = original;
    }
  });

  check('a lateral 3D arrival crosses its own stand edge and records the correct portal', () => {
    const region = new RegionalMatch('old-growth', undefined, { starts: 'best' });
    assert.equal(region.growAcross('north').ok, true);
    const body = region.spatial;
    const origin = body.originStandId;
    const frame = body.standFrame(origin);
    const seam = frame.originX;
    let site = null;
    for (let y = frame.originY + 12; y < frame.originY + frame.size - 12 && !site; y += 2) {
      for (let gy = 2; gy < 8; gy++) {
        const from = body.voxelAt(0, y + 0.5, gy);
        const to = body.voxelAt(-1, y + 0.5, gy);
        if (from && to && !body.soil.segment(from, to).blocked) {
          site = { y, gy };
          break;
        }
      }
    }
    assert.ok(site, 'there is passable soil across a perpendicular stand boundary');
    const tip = body.colony.nodes.find((node) => node.alive && node.isTip);
    assert.ok(tip);
    tip.gx = 0;
    tip.wx = 0.5;
    tip.gy = site.gy;
    tip.wy = site.gy + 0.5;
    tip.y = site.y + 0.5;
    tip.lateral = tip.y;
    tip.targetGx = -1;
    tip.targetGy = tip.gy;
    tip.targetLateral = tip.y;
    tip.standId = origin;
    tip.carbon = 100;
    tip.water = 10;
    tip.nitrogen = 10;
    tip.paid = false;
    assert.equal(body.world.passableFrom(tip, -1, 0, 0), true);
    for (let i = 0; i < 180 && tip.standId === origin; i++) {
      stepNetwork(body.colony, { world: body.world, light: 1, warmth: 1, rival: null,
        time: i * DT, log() {}, dt: DT });
    }
    assert.equal(tip.standId, origin - 1, 'a real 3D tip enters the western stand');
    const portal = body.portals().find((entry) => entry.nodeId === tip.id);
    assert.equal(portal?.edge, 'west');
    assert.equal(portal?.seam, seam);
  });

  check('a naturally bonded ordinary colony can be directed across an edge', () => {
    const region = new RegionalMatch('old-growth', undefined, { starts: 'best' });
    const sim = region.active.sim;
    const founder = sim.player.nodes[sim.player.rootId];
    const options = sim.world.trees.flatMap((tree) => tree.rootTips.map((tip) => ({ tree, tip })));
    options.sort((a, b) =>
      Math.hypot(a.tip.gx - founder.gx, a.tip.gy - founder.gy) -
      Math.hypot(b.tip.gx - founder.gx, b.tip.gy - founder.gy));
    const target = options[0];
    assert.ok(sim.growTo(target.tip.gx, target.tip.gy).ok);
    let bonded = false;
    for (let i = 0; i < 120 / DT && !bonded; i++) {
      region.step(DT);
      if (i % 5 === 0) bonded = sim.orderBondTip(target.tree.id, target.tip.id).ok;
    }
    assert.ok(bonded, 'the ordinary opening reached and bonded a root');
    assert.ok(region.growAcross('east').ok);
    for (let i = 0; i < 360 / DT && region.spatial.portals().length === 0; i++) region.step(DT);
    assert.ok(region.spatial.portals().length > 0, 'the naturally funded body crossed');
  });

  check('a paid spore founds a separate spatial body on the same soil volume', () => {
    const region = new RegionalMatch('raven-wood', undefined, { starts: 'best' });
    const origin = region.activeStandId;
    const parent = region.active.sim.player;
    const root = parent.nodes[parent.rootId];
    root.carbon = 300;
    root.water = 12;
    root.nitrogen = 8;
    updateTotals(parent);
    parent.fruited++;
    // A mature body holds its spores until released (or a gust takes them).
    region.step(DT);
    assert.equal(region.releaseSpores(origin).ok, true, 'the player releases the waiting spores');
    assert.equal(region.colonization.length, 1, 'one paid spore landed');
    const to = region.colonization[0].to;
    const daughter = region.stands[to].sim.player;
    const body = region.spatialColonies.get(to);
    assert.ok(body, 'the daughter has its own regional graph immediately');
    assert.notEqual(body.colony, parent, 'the daughter is not a branch of its parent');
    assert.equal(body.soil, region.soil, 'both bodies use one material volume');
    assert.equal(body.colony, daughter, 'daughter orders address the live graph');
    assert.equal(body.colony.nodes[body.colony.rootId].parent, -1, 'the daughter has its own root');
    assert.equal(region.spatialColonies.has(origin), false, 'the parent need not be promoted to found it');
    const before = parent.waypoints.length;
    assert.ok(body.orderAcross().ok, 'the daughter can be directed independently');
    assert.equal(parent.waypoints.length, before, 'directing the daughter does not direct the parent');
  });

  check('two networks in one stand cannot claim each other’s root bond', () => {
    const world = createStandWorld(4312);
    const tree = world.trees.find((candidate) => candidate.rootTips.length > 0);
    assert.ok(tree);
    const tip = tree.rootTips[0];
    const make = (id) => {
      const net = createNetwork('player', id, tip.gx, tip.gy, mulberry32(42), 120);
      net.colonyId = id;
      return net;
    };
    const parent = make('parent');
    const daughter = make('daughter');
    assert.equal(tryBond(parent, world, tree.id, tip.id), true);
    assert.equal(tip.bondedColonyId, 'parent');
    assert.ok(bondedJunction(parent, tree));
    assert.equal(bondedJunction(daughter, tree), null);
    assert.equal(holdsAnyBond(tree, 'daughter'), false);
    assert.equal(tryBond(daughter, world, tree.id, tip.id), false, 'the daughter cannot take the occupied tip');
  });

  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`PASS: ${count} checks in ${elapsed}s.`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
