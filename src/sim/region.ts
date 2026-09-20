import { GRID, MAX_DEPTH_CM, type TreeSpeciesId } from './content';
import { hashString, makeNoise2D, mulberry32, type Rng } from './rng';

/**
 * The region: a mosaic of forest stands that share one landscape.
 *
 * Everything here is generated from the region's own seed, in dependency
 * order, so that each visible feature has an ecological reason:
 *
 * 1. a low-frequency heightfield with one valley cut through it,
 * 2. drainage derived from that heightfield, accumulated into flow paths,
 * 3. a water table that follows the flow and the relief,
 * 4. a potential community per stand, from moisture, drainage and slope,
 * 5. a spawn point for the player that a network can actually live in.
 *
 * Neighbouring stands agree at their shared edges because there is only ever
 * one answer to "how high is the ground here": every stand samples the same
 * `heightAt`, so the seam between two squares cannot disagree with itself.
 */

/** Side of one logical stand square, in world units. */
export const STAND_SIZE = GRID.cols;
export const REGION_COLS = 3;
export const REGION_ROWS = 3;
export type StandCommunity =
  | 'oak-ridge'
  | 'mixed-slope'
  | 'birch-hollow'
  | 'hemlock-ravine'
  | 'stream-corridor'
  | 'wetland-edge'
  | 'recovering-clearing';

/** Species mix per community: oak, birch, hemlock. */
const COMMUNITY_MIX: Record<StandCommunity, [number, number, number]> = {
  'oak-ridge': [0.7, 0.15, 0.15],
  // The mixed slope is the stand the prototype has always drawn: 45% oak,
  // 35% birch, 20% hemlock. Every other community leans away from it.
  'mixed-slope': [0.45, 0.35, 0.2],
  'birch-hollow': [0.2, 0.6, 0.2],
  'hemlock-ravine': [0.1, 0.25, 0.65],
  'stream-corridor': [0.2, 0.45, 0.35],
  'wetland-edge': [0.1, 0.6, 0.3],
  'recovering-clearing': [0.3, 0.5, 0.2],
};

export const COMMUNITY_LABEL: Record<StandCommunity, string> = {
  'oak-ridge': 'Oak ridge',
  'mixed-slope': 'Mixed hardwood slope',
  'birch-hollow': 'Yellow-birch hollow',
  'hemlock-ravine': 'Hemlock ravine',
  'stream-corridor': 'Stream corridor',
  'wetland-edge': 'Wetland edge',
  'recovering-clearing': 'Recovering clearing',
};

export interface StandEdge {
  /** Neighbour across this edge, or null where the region ends. */
  neighbour: number | null;
  /** Mean height of the shared edge, in world units. Both sides compute this. */
  height: number;
  /** Strongest flow anywhere along the shared edge, 0..1. */
  flow: number;
}

export interface StandSite {
  id: number;
  /** Stand grid coordinates, 0..REGION_COLS-1 and 0..REGION_ROWS-1. */
  sx: number;
  sy: number;
  /** Centre of the square in region world units. */
  centreX: number;
  centreY: number;
  seed: number;
  /** Mean, minimum and maximum ground height across the square. */
  elevation: number;
  low: number;
  high: number;
  /** Mean gradient across the square, in world units per 10 units of ground. */
  slope: number;
  /** Downhill direction, in radians. */
  aspect: number;
  /** 0..1, from water table depth and flow. */
  moisture: number;
  /** 0..1, how freely water leaves the square. */
  drainage: number;
  /** Depth to the water table below the local surface, in centimetres. */
  waterTableCm: number;
  /** Normalised flow accumulation through the square, 0..1. */
  flow: number;
  community: StandCommunity;
  /**
   * The stream's own cross-section through this stand, when the region's
   * channel runs through the square. The underground view is a vertical slice,
   * so a channel crossing the square diagonally still has to be drawn where it
   * lies in the transect: its mean column and the width the flow earns it.
   * Null on ground the stream never reaches.
   */
  stream: { centreGx: number; widthGx: number; flow: number } | null;
  edges: { north: StandEdge; east: StandEdge; south: StandEdge; west: StandEdge };
  /** Orthogonally adjacent stands, in the order north, east, south, west. */
  neighbours: number[];
}

export interface WindState {
  /** Direction the wind blows *toward*, in radians, 0 = +x. */
  direction: number;
  /** 0..1 in ordinary weather; above 1 in a storm, when spores carry further. */
  strength: number;
}

export interface RegionValidation {
  ok: boolean;
  problems: string[];
  foundingStand: number;
  /** Stands reachable from the founding stand by orthogonal adjacency. */
  reachableStands: number;
  /** Stand boundaries a stream or flow path crosses. */
  streamBoundaries: number;
  /** Stands whose soil is wet enough to host a network at all. */
  habitableStands: number;
}

export interface Region {
  seedText: string;
  seed: number;
  cols: number;
  rows: number;
  stands: StandSite[];
  foundingStand: number;
  wind: WindState;
  /**
   * Ground height anywhere in the region, in world units. One function for the
   * whole landscape, which is what makes stand borders invisible.
   */
  heightAt(x: number, y: number): number;
  /** Depth to the water table below the local surface, in centimetres. */
  waterTableAt(x: number, y: number): number;
  /** Normalised flow accumulation, 0..1. Streams are where this is high. */
  flowAt(x: number, y: number): number;
  /** Wind at a moment in a match. Storms are what carry spores further. */
  windAt(time: number): WindState;
  /** The channel's course, in region world units, for drawing and for tests. */
  streamPath: Array<{ x: number; y: number }>;
  /** Stands the channel runs through, in the order it reaches them. */
  streamStands: number[];
  validation: RegionValidation;
}

/** Width of the coarse grid the flow accumulation runs on, in world units. */
const FLOW_STEP = 4;
/** Flow at which ground reads as a channel rather than wet ground. */
const CHANNEL_FLOW = 0.9;

export function createRegion(seedText: string, cols = REGION_COLS, rows = REGION_ROWS): Region {
  const seed = hashString(seedText);
  const relief = makeNoise2D(seed ^ 0x2f6b1c3d, 4, 0.0042);
  const detail = makeNoise2D(seed ^ 0x77c1a9e5, 3, 0.017);
  const patch = makeNoise2D(seed ^ 0x4a1f77b3, 3, 0.011);
  const rng: Rng = mulberry32(seed ^ 0x31d5);

  const spanX = cols * STAND_SIZE;
  const spanY = rows * STAND_SIZE;

  // One valley, cut across the whole region at an angle, so there is a place
  // for water to gather and a corridor that genuinely crosses stand borders.
  const valleyAngle = (0.12 + rng() * 0.5) * (rng() < 0.5 ? -1 : 1);
  // Keep the channel away from the stand borders: a stream that runs exactly
  // along a seam is a survey artefact, not a valley. Stands are thirds of the
  // region, so these offsets sit inside one.
  const valleyOffset = [0.2, 0.44, 0.56, 0.8][Math.floor(rng() * 4)] as number;
  const valleyCentre = 0.32 + rng() * 0.36;
  const valleyDepth = 9 + rng() * 5;
  const valleyWidth = spanY * (0.05 + rng() * 0.03);
  // A region falls one way. Without it, a valley floor is a flat line with no
  // way down and the water has nowhere to go: the drainage would pit out in the
  // first hollow it found.
  const fallX = 0.014 + rng() * 0.012;
  const fallY = 0.01 + rng() * 0.014;
  const valleyAt = (x: number, y: number): number => {
    // Distance from the channel line, measured across the region.
    const cx = spanX * valleyCentre;
    const base = spanY * valleyOffset + (x - spanX * 0.5) * Math.tan(valleyAngle);
    return Math.abs(y - base) / valleyWidth + Math.abs(x - cx) / (spanX * 1.6) * 0.35;
  };

  const heightAt = (x: number, y: number): number => {
    const broad = (relief(x, y) - 0.5) * 26;
    const fine = (detail(x, y) - 0.5) * 3.4;
    const cut = Math.max(0, 1 - valleyAt(x, y));
    const fall = (spanX - x) * fallX + (spanY - y) * fallY;
    return broad + fine + fall - cut * cut * valleyDepth;
  };

  // Drainage: steepest descent on a coarse grid, accumulated downhill. This is
  // a real flow solve rather than a painted stream, so the wet ground in a
  // stand follows from the shape of the land.
  const flowCols = Math.ceil(spanX / FLOW_STEP);
  const flowRows = Math.ceil(spanY / FLOW_STEP);
  const heights = new Float32Array(flowCols * flowRows);
  for (let fy = 0; fy < flowRows; fy++) {
    for (let fx = 0; fx < flowCols; fx++) {
      heights[fy * flowCols + fx] = heightAt((fx + 0.5) * FLOW_STEP, (fy + 0.5) * FLOW_STEP);
    }
  }

  const cellCount = flowCols * flowRows;
  const outlet = heights.reduce((best, value, index) => (value < (heights[best] as number) ? index : best), 0);
  // Priority flood out from the region's lowest ground. Every cell is given the
  // neighbour it drains through on the way there, so water always has a way out
  // instead of pooling in the first hollow a steepest-descent walk finds — and
  // the hollows stay honest wetland rather than becoming lakes.
  const downhill = new Int32Array(cellCount).fill(-1);
  const visited = new Uint8Array(cellCount);
  const flood: number[] = [];
  const heap: number[] = [outlet];
  const filled = new Float32Array(heights);
  const heapPush = (index: number): void => {
    heap.push(index);
    let child = heap.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if ((filled[heap[parent] as number] as number) <= (filled[heap[child] as number] as number)) break;
      const swap = heap[parent] as number;
      heap[parent] = heap[child] as number;
      heap[child] = swap;
      child = parent;
    }
  };
  const heapPop = (): number => {
    const top = heap[0] as number;
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < heap.length && (filled[heap[left] as number] as number) < (filled[heap[smallest] as number] as number)) smallest = left;
        if (right < heap.length && (filled[heap[right] as number] as number) < (filled[heap[smallest] as number] as number)) smallest = right;
        if (smallest === parent) break;
        const swap = heap[parent] as number;
        heap[parent] = heap[smallest] as number;
        heap[smallest] = swap;
        parent = smallest;
      }
    }
    return top;
  };
  visited[outlet] = 1;
  while (heap.length > 0) {
    const index = heapPop();
    flood.push(index);
    const fx = index % flowCols;
    const fy = Math.floor(index / flowCols);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = fx + dx;
        const ny = fy + dy;
        if (nx < 0 || ny < 0 || nx >= flowCols || ny >= flowRows) continue;
        const neighbour = ny * flowCols + nx;
        if (visited[neighbour]) continue;
        visited[neighbour] = 1;
        filled[neighbour] = Math.max(heights[neighbour] as number, filled[index] as number);
        downhill[neighbour] = index;
        heapPush(neighbour);
      }
    }
  }
  // Accumulate uphill first: the flood runs outward from the outlet, so walking
  // it backwards is a child-before-parent order.
  const accum = new Float32Array(cellCount).fill(1);
  for (let i = flood.length - 1; i >= 0; i--) {
    const index = flood[i] as number;
    const parent = downhill[index] as number;
    if (parent >= 0) accum[parent] = (accum[parent] as number) + (accum[index] as number);
  }
  // Where the channel is, is a question about this region's own drainage, not
  // about an absolute number: the wettest few percent of the flow field is the
  // stream, whatever shape the land took. A fixed threshold would be a stream
  // on one seed and a dry hillside on the next.
  const ranked = Float32Array.from(accum).sort();
  // The channel is the top twentieth of the flow field. Tight enough that the
  // ground around it still reads as wet rather than as water, wide enough that
  // a stream is a feature of the region rather than of a single square.
  const channelFlow = (ranked[Math.floor(ranked.length * 0.95)] as number) || 1;
  const flowAt = (x: number, y: number): number => {
    const fx = Math.max(0, Math.min(flowCols - 1, Math.floor(x / FLOW_STEP)));
    const fy = Math.max(0, Math.min(flowRows - 1, Math.floor(y / FLOW_STEP)));
    return Math.max(0, Math.min(1, (accum[fy * flowCols + fx] as number) / channelFlow));
  };

  const waterTableAt = (x: number, y: number): number => {
    const flow = flowAt(x, y);
    // Relief is the strongest control on how far down the water sits: the
    // valley floor is wet, the rises are dry, and the channel is wetter still.
    const table = MAX_DEPTH_CM * 0.66 + (heightAt(x, y) - 4) * 1.6 - flow * 28;
    return Math.max(16, Math.min(MAX_DEPTH_CM - 4, table));
  };

  /**
   * Where the water goes.
   *
   * Walk the downhill chain from the region's highest ground to its outlet: the
   * part of that path where the flow has gathered into a channel is the stream,
   * and the stands it passes through are the stands with running water in them.
   * A drawn stream and a gameplay community then come from the same fact.
   */
  // Start at the highest ground that is already a channel: the head of the
  // stream. Flow only gathers downstream, so every cell after it is channel
  // too, and the walk covers the water's whole course out of the region.
  let channelStart = -1;
  let channelStartHeight = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const fx = i % flowCols;
    const fy = Math.floor(i / flowCols);
    if (flowAt((fx + 0.5) * FLOW_STEP, (fy + 0.5) * FLOW_STEP) < CHANNEL_FLOW) continue;
    const value = heights[i] as number;
    if (value > channelStartHeight) {
      channelStartHeight = value;
      channelStart = i;
    }
  }
  const streamPath: Array<{ x: number; y: number }> = [];
  const streamStands: number[] = [];
  for (let cursor = channelStart, guard = 0; cursor >= 0 && guard < flowCols * flowRows; guard++) {
    const fx = cursor % flowCols;
    const fy = Math.floor(cursor / flowCols);
    const x = (fx + 0.5) * FLOW_STEP;
    const y = (fy + 0.5) * FLOW_STEP;
    streamPath.push({ x, y });
    const standId = Math.min(rows - 1, Math.floor(y / STAND_SIZE)) * cols + Math.min(cols - 1, Math.floor(x / STAND_SIZE));
    if (streamStands[streamStands.length - 1] !== standId) streamStands.push(standId);
    const next = downhill[cursor] as number;
    if (next < 0 || next === cursor) break;
    cursor = next;
  }

  // Stands: sample the same fields over each square.
  const stands: StandSite[] = [];
  for (let sy = 0; sy < rows; sy++) {
    for (let sx = 0; sx < cols; sx++) {
      const id = sy * cols + sx;
      const centreX = (sx + 0.5) * STAND_SIZE;
      const centreY = (sy + 0.5) * STAND_SIZE;
      const at = (fx: number, fy: number): number =>
        heightAt((sx + fx) * STAND_SIZE, (sy + fy) * STAND_SIZE);
      const samples: number[] = [];
      const samplesX: number[] = [];
      const samplesY: number[] = [];
      const flowSamples: number[] = [];
      const tableSamples: number[] = [];
      for (let i = 0; i <= 6; i++) {
        for (let j = 0; j <= 6; j++) {
          const fx = i / 6;
          const fy = j / 6;
          const x = (sx + fx) * STAND_SIZE;
          const y = (sy + fy) * STAND_SIZE;
          const value = at(fx, fy);
          samples.push(value);
          samplesX.push((i / 6 - 0.5) * 2);
          samplesY.push((j / 6 - 0.5) * 2);
          flowSamples.push(flowAt(x, y));
          tableSamples.push(waterTableAt(x, y));
        }
      }
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      let variance = 0;
      let gradientX = 0;
      let gradientY = 0;
      samples.forEach((value, i) => {
        variance += (value - mean) * (value - mean);
        gradientX += value * (samplesX[i] as number);
        gradientY += value * (samplesY[i] as number);
      });
      variance /= samples.length;
      const slope = (Math.hypot(gradientX, gradientY) / samples.length) * 5;
      const aspect = Math.atan2(gradientY, gradientX) + Math.PI / 2;
      const low = Math.min(...samples);
      const high = Math.max(...samples);
      // A stand's flow is a percentile, not a maximum: a square the stream
      // brushes with one bank is not a stream corridor, but a square the
      // channel runs through is.
      const rankedFlow = [...flowSamples].sort((a, b) => a - b);
      // A tenth of a stand being channel is a stand with a stream in it.
      const flow = rankedFlow[Math.floor(rankedFlow.length * 0.9)] as number;
      const waterTableCm = tableSamples.reduce((sum, value) => sum + value, 0) / tableSamples.length;
      const moisture = Math.max(
        0,
        Math.min(1, 0.16 + (1 - waterTableCm / MAX_DEPTH_CM) * 0.7 + flow * 0.25)
      );
      const drainage = Math.max(0, Math.min(1, slope / 7));
      // Disturbance is its own history: a patch of old windthrow is not
      // predicted by moisture or slope, only by the stand's own past.
      const disturbance = patch(centreX, centreY);
      const community = communityFor({
        onStream: streamStands.includes(id),
        moisture,
        drainage,
        waterTableCm,
        elevation: mean,
        relief: high - low,
        disturbance,
      });
      const stream = streamThroughStand(streamPath, sx, sy, flow);

      /**
       * Mean height along one side of the square.
       *
       * Both stands either side of a border run this over the same line of the
       * same heightfield — the south edge of one square is the north edge of
       * the next — so the two sides agree exactly rather than approximately.
       */
      const edgeAlong = (side: 'north' | 'east' | 'south' | 'west'): { height: number; flow: number } => {
        let total = 0;
        let strongest = 0;
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          const x = sx * STAND_SIZE + (side === 'east' ? STAND_SIZE : side === 'west' ? 0 : t * STAND_SIZE);
          const y = sy * STAND_SIZE + (side === 'south' ? STAND_SIZE : side === 'north' ? 0 : t * STAND_SIZE);
          total += heightAt(x, y);
          strongest = Math.max(strongest, flowAt(x, y));
        }
        return { height: total / 9, flow: strongest };
      };
      const neighbours: number[] = [];
      const north = sy > 0 ? id - cols : null;
      const south = sy < rows - 1 ? id + cols : null;
      const west = sx > 0 ? id - 1 : null;
      const east = sx < cols - 1 ? id + 1 : null;
      for (const neighbour of [north, east, south, west]) if (neighbour !== null) neighbours.push(neighbour);
      const northEdge = edgeAlong('north');
      const eastEdge = edgeAlong('east');
      const southEdge = edgeAlong('south');
      const westEdge = edgeAlong('west');

      stands.push({
        id,
        sx,
        sy,
        centreX,
        centreY,
        seed: (seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0,
        elevation: mean,
        low,
        high,
        slope,
        aspect,
        moisture,
        drainage,
        waterTableCm,
        flow,
        community,
        stream,
        edges: {
          north: { neighbour: north, ...northEdge },
          east: { neighbour: east, ...eastEdge },
          south: { neighbour: south, ...southEdge },
          west: { neighbour: west, ...westEdge },
        },
        neighbours,
      });
    }
  }

  const wind: WindState = {
    direction: rng() * Math.PI * 2,
    strength: 0.3 + rng() * 0.4,
  };

  const region: Region = {
    seedText,
    seed,
    cols,
    rows,
    stands,
    foundingStand: 0,
    wind,
    heightAt,
    waterTableAt,
    flowAt,
    windAt: (time: number) => windAtTime(wind, time),
    streamPath,
    streamStands,
    validation: { ok: true, problems: [], foundingStand: 0, reachableStands: 0, streamBoundaries: 0, habitableStands: 0 },
  };

  region.foundingStand = chooseFoundingStand(region);
  region.validation = validateRegion(region);
  return region;
}

/**
 * Where the region's stream lies inside one stand's own transect.
 *
 * The path points that fall in the square give the channel's mean column and
 * its spread; a square the stream merely brushes with one bank gets a narrow
 * seam, and a square the channel runs through gets a wide one. The width also
 * follows the flow the square carries, so the lower course is wider than the
 * headwater it started as.
 */
function streamThroughStand(
  path: Array<{ x: number; y: number }>,
  sx: number,
  sy: number,
  flow: number
): { centreGx: number; widthGx: number; flow: number } | null {
  let total = 0;
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const point of path) {
    if (point.x < sx * STAND_SIZE || point.x >= (sx + 1) * STAND_SIZE) continue;
    if (point.y < sy * STAND_SIZE || point.y >= (sy + 1) * STAND_SIZE) continue;
    const local = point.x - sx * STAND_SIZE;
    total += local;
    min = Math.min(min, local);
    max = Math.max(max, local);
    count++;
  }
  if (count === 0) return null;
  // Keep the channel's centre away from the stand's own border columns: a
  // stream that runs exactly along a boundary cannot be drawn as a channel in
  // either stand's transect, and it would also hide the bank the player needs.
  const centreGx = Math.max(8, Math.min(STAND_SIZE - 8, total / count));
  const spread = Math.max(2, max - min);
  const widthGx = Math.max(3, Math.min(14, Math.round(spread + 2 + flow * 6)));
  return { centreGx, widthGx, flow };
}

export function standAt(region: Region, x: number, y: number): StandSite | null {
  if (x < 0 || y < 0 || x >= region.cols * STAND_SIZE || y >= region.rows * STAND_SIZE) return null;
  const sx = Math.floor(x / STAND_SIZE);
  const sy = Math.floor(y / STAND_SIZE);
  return region.stands[sy * region.cols + sx] ?? null;
}

/** Stands a spore released from `from` could reach, best-first: downwind first. */
export function downwindStands(region: Region, from: number, wind: WindState, reach: number): number[] {
  const source = region.stands[from];
  if (!source) return [];
  const scored: Array<{ id: number; score: number }> = [];
  for (const stand of region.stands) {
    if (stand.id === from) continue;
    const dx = stand.centreX - source.centreX;
    const dy = stand.centreY - source.centreY;
    const distance = Math.hypot(dx, dy) / STAND_SIZE;
    if (distance > reach) continue;
    // How much of the journey is downwind: 1 straight downwind, -1 upwind.
    const alignment = (Math.cos(wind.direction) * dx + Math.sin(wind.direction) * dy) / Math.max(1e-6, Math.hypot(dx, dy));
    const orthogonallyAdjacent = distance <= 1.01;
    if (!orthogonallyAdjacent && alignment < 0.72) continue;
    if (orthogonallyAdjacent && alignment < 0.2) continue;
    scored.push({ id: stand.id, score: alignment - distance * 0.15 });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.id - b.id));
  return scored.map((entry) => entry.id);
}

/** Storms arrive on a slow cycle; heavy wind is what carries spores further. */
function windAtTime(base: WindState, time: number): WindState {
  const turn = Math.sin(time * 0.0043) * 0.5 + Math.sin(time * 0.0011) * 0.35;
  const storm = Math.max(0, Math.sin(time * 0.0091 + 1.7));
  return {
    direction: base.direction + turn,
    strength: base.strength + Math.pow(storm, 6) * 1.5,
  };
}

function communityFor(input: {
  onStream: boolean;
  moisture: number;
  drainage: number;
  waterTableCm: number;
  elevation: number;
  relief: number;
  disturbance: number;
}): StandCommunity {
  const { onStream, moisture, drainage, waterTableCm, elevation, relief, disturbance } = input;
  if (onStream) return 'stream-corridor';
  if (waterTableCm <= 45 && drainage < 0.6) return 'wetland-edge';
  if (waterTableCm <= 62 && drainage < 0.62) return 'birch-hollow';
  if (waterTableCm >= 74 && drainage > 0.5 && elevation > 0) return 'oak-ridge';
  if (relief > 12) return 'hemlock-ravine';
  if (disturbance > 0.72 && relief > 2) return 'recovering-clearing';
  if (relief > 6 && moisture < 0.5) return 'recovering-clearing';
  return 'mixed-slope';
}

/** Pick the species a community's mix implies, from one roll in [0,1). */
export function speciesFor(community: StandCommunity, roll: number): TreeSpeciesId {
  const [oak, birch] = COMMUNITY_MIX[community];
  if (roll < oak) return 'oak';
  if (roll < oak + birch) return 'birch';
  return 'hemlock';
}

/** The same mix as cumulative thresholds, for the soil generator. */
export function communityThresholds(community: StandCommunity): [number, number] {
  const [oak, birch] = COMMUNITY_MIX[community];
  return [oak, oak + birch];
}

/**
 * Where a network can begin: ground that can hold one, near water, on the way
 * down rather than up, and preferably the ordinary mixed slope the game has
 * always opened on.
 */
function chooseFoundingStand(region: Region): number {
  let best = 0;
  let bestScore = -Infinity;
  for (const stand of region.stands) {
    const habitability = stand.moisture < 0.78 && stand.drainage < 0.85 ? 1 : 0.2;
    const water = Math.max(0, 1 - Math.abs(stand.waterTableCm - MAX_DEPTH_CM * 0.66) / 40);
    const ordinary = stand.community === 'mixed-slope' ? 1 : stand.community === 'oak-ridge' ? 0.75 : 0.4;
    const score = habitability * 2 + water + ordinary + stand.neighbours.length * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = stand.id;
    }
  }
  return best;
}

export function validateRegion(region: Region): RegionValidation {
  const problems: string[] = [];
  const founding = region.stands[region.foundingStand];
  if (!founding) {
    return {
      ok: false,
      problems: ['no stands'],
      foundingStand: 0,
      reachableStands: 0,
      streamBoundaries: 0,
      habitableStands: 0,
    };
  }

  // Reachability: every stand has to be connected to the founding stand by
  // orthogonal steps, or part of the map is decoration.
  const seen = new Set<number>([founding.id]);
  const queue = [founding.id];
  while (queue.length > 0) {
    const id = queue.shift() as number;
    for (const neighbour of region.stands[id]?.neighbours ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  if (seen.size !== region.stands.length) {
    problems.push(`${region.stands.length - seen.size} stands cannot be reached from the founding stand`);
  }

  const habitable = region.stands.filter((stand) => stand.moisture > 0.2 && stand.waterTableCm < MAX_DEPTH_CM - 8);
  if (habitable.length === 0) problems.push('no stand can hold a network');
  if (founding.waterTableCm > MAX_DEPTH_CM * 0.86) problems.push('the founding stand has no water in reach');
  if (founding.moisture < 0.2) problems.push('the founding stand is too dry to begin in');

  // A stream or flow path that crosses at least two stand borders, so water is
  // a feature of the region rather than of one square.
  // Borders the stream crosses on its way out of the region.
  const streamBoundaries = Math.max(0, region.streamStands.length - 1);
  if (streamBoundaries < 2) problems.push('the water does not cross two stand borders');
  if (region.streamStands.length === 0) problems.push('no stream forms anywhere in the region');

  return {
    ok: problems.length === 0,
    problems,
    foundingStand: founding.id,
    reachableStands: seen.size,
    streamBoundaries,
    habitableStands: habitable.length,
  };
}
