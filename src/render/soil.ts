import * as THREE from 'three';
import { GRID, STRATA, type StratumId } from '../sim/content';
import { mulberry32 } from '../sim/rng';
import { idx, rowDepthCm, type World } from '../sim/world';

/**
 * The mount: a slab of soil built from instanced grit.
 *
 * Every particle is a real object in the scene, scattered through a shallow
 * volume rather than painted on a plane, so tilting the camera opens up real
 * parallax between the litter at the top and the stones at the bottom. Colour
 * comes from the simulation — stratum, moisture, organic content, depletion —
 * so the soil visibly changes as the network drains it.
 */

/** Base material colours per horizon, in the dark warm register of the sheet. */
const STRATUM_COLOR: Record<StratumId, THREE.Color> = {
  // Dark, but never black: the strata have to stay legible as material, and a
  // true black rectangle would read as a hole in the sheet rather than as soil.
  litter: new THREE.Color('#4a3620'),
  humus: new THREE.Color('#3a2814'),
  loam: new THREE.Color('#2f2317'),
  clay: new THREE.Color('#332a23'),
  sand: new THREE.Color('#3c3220'),
  stone: new THREE.Color('#37332c'),
  bedrock: new THREE.Color('#22201b'),
};

/** How many grit particles each stratum gets per cell. Loose material shows more. */
const STRATUM_DENSITY: Record<StratumId, number> = {
  litter: 2.4,
  humus: 1.8,
  loam: 1.5,
  clay: 1.6,
  sand: 2.2,
  stone: 2.6,
  bedrock: 1.1,
};

export interface SoilOptions {
  /** Total particle budget. The mount's fidelity is set by this one number. */
  budget?: number;
  /** Half-thickness of the slab, in world units. */
  depthHalf?: number;
}

export class SoilMesh {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;

  private readonly world: World;
  private readonly count: number;
  private readonly cellOf: Int32Array;
  private readonly baseColor: Float32Array;
  private readonly depthShade: Float32Array;
  private readonly scratch = new THREE.Color();
  private readonly amber = new THREE.Color('#ffb347');
  private colorAccumulator = 0;

  constructor(world: World, options: SoilOptions = {}) {
    this.world = world;
    // Many small particles rather than fewer large ones: soil reads as grain,
    // and fine grit does not merge into boulders at close zoom.
    const budget = options.budget ?? 34000;
    const depthHalf = options.depthHalf ?? 1.9;

    // Work out how the budget splits across the grid, then build the particles.
    const weights = new Float32Array(GRID.cols * GRID.rows);
    let totalWeight = 0;
    for (let gy = 0; gy < GRID.rows; gy++) {
      for (let gx = 0; gx < GRID.cols; gx++) {
        const cell = world.cells[idx(gx, gy)];
        const stratum = cell ? cell.stratum : 'bedrock';
        // Open channel carries almost no grit: what is drawn there is water and
        // shadow, and the notch should read as an absence of soil.
        const body = cell?.stream ? 0.12 : 1;
        const w = STRATUM_DENSITY[stratum] * (0.55 + (cell ? cell.hardness : 1) * 0.9) * body;
        weights[gy * GRID.cols + gx] = w;
        totalWeight += w;
      }
    }

    const rng = mulberry32(world.seed ^ 0x2f9a1c);
    const counts = new Int32Array(GRID.cols * GRID.rows);
    let count = 0;
    for (let i = 0; i < counts.length; i++) {
      const c = Math.max(1, Math.round(((weights[i] as number) / totalWeight) * budget));
      counts[i] = c;
      count += c;
    }
    this.count = count;
    this.cellOf = new Int32Array(count);
    this.baseColor = new Float32Array(count * 3);
    this.depthShade = new Float32Array(count);

    const geometry = new THREE.IcosahedronGeometry(0.5, 0);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.96,
      metalness: 0.0,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // Continuous earth behind the aggregate: grit is embedded in sediment,
    // not suspended over a black void. Its strata come from the generated map.
    const earth = document.createElement('canvas');
    earth.width = 544;
    earth.height = 448;
    const context = earth.getContext('2d')!;
    const pixels = context.createImageData(earth.width, earth.height);
    const earthRng = mulberry32(world.seed ^ 0x80fe);
    const tones: Record<StratumId, number[]> = {
      litter: [58, 43, 25], humus: [48, 34, 23], loam: [43, 32, 24],
      clay: [51, 39, 31], sand: [57, 48, 35], stone: [43, 41, 36], bedrock: [31, 30, 27],
    };
    for (let y = 0; y < earth.height; y++) for (let x = 0; x < earth.width; x++) {
      const cell = world.cells[idx(Math.floor(x / 4), Math.floor(y / 4))];
      const base = tones[cell.stratum];
      const grain = 0.58 + earthRng() * 0.48;
      const lamina = 0.8 + Math.sin(y * 0.42 + Math.sin(x * 0.027) * 3 + Math.sin(x * 0.08)) * 0.12;
      const shade = grain * lamina * (1 - y / earth.height * 0.22);
      const index = (y * earth.width + x) * 4;
      for (let c = 0; c < 3; c++) pixels.data[index + c] = base[c] * shade;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(earth);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sediment = new THREE.Mesh(new THREE.PlaneGeometry(GRID.cols, GRID.rows), new THREE.MeshBasicMaterial({ map: texture }));
    sediment.position.z = -1.95;
    this.group.add(sediment);

    const dummy = new THREE.Object3D();
    let p = 0;
    for (let gy = 0; gy < GRID.rows; gy++) {
      for (let gx = 0; gx < GRID.cols; gx++) {
        const cellIndex = gy * GRID.cols + gx;
        const cell = world.cells[cellIndex];
        const n = counts[cellIndex] as number;
        for (let i = 0; i < n; i++) {
          const wx = gx + rng();
          const wy = -(gy + rng());
          const wz = (rng() - 0.5) * 2 * depthHalf;
          dummy.position.set(wx - GRID.cols / 2, wy + GRID.rows / 2, wz);
          dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
          // Hard material breaks into bigger, more angular pieces.
          const s = (0.3 + (cell ? cell.hardness : 1) * 0.7) * (0.45 + rng() * 0.75);
          dummy.scale.set(s, s * (0.6 + rng() * 0.6), s * (0.6 + rng() * 0.6));
          dummy.updateMatrix();
          this.mesh.setMatrixAt(p, dummy.matrix);
          this.cellOf[p] = cellIndex;
          this.depthShade[p] = 1 - Math.min(0.62, rowDepthCm(gy) / 150);
          p++;
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.refreshColors();
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  /**
   * Re-derive every particle's colour from the current soil state. Called on a
   * slow cadence rather than per frame: soil does not change fast, and the
   * network's own light does the per-frame work.
   */
  refreshColors(): void {
    const world = this.world;
    const color = this.scratch;
    for (let p = 0; p < this.count; p++) {
      const cellIndex = this.cellOf[p] as number;
      const cell = world.cells[cellIndex];
      if (!cell) continue;
      const base = STRATUM_COLOR[cell.stratum];
      color.copy(base);

      // The stream is drawn as what it is: air above the water line, water
      // beneath it. Both are nearly gritless, so the tint carries the shape.
      if (cell.stream) {
        const gy = Math.floor(cellIndex / GRID.cols);
        const submerged = rowDepthCm(gy) >= world.waterTableCm;
        color.copy(submerged ? _stream : _notch);
        color.multiplyScalar(submerged ? 0.9 + Math.max(0, 0.3 - cell.water * 0.2) : 0.85);
        this.baseColor[p * 3] = color.r;
        this.baseColor[p * 3 + 1] = color.g;
        this.baseColor[p * 3 + 2] = color.b;
        this.mesh.setColorAt(p, color);
        continue;
      }

      // Moisture darkens and slightly cools the material.
      const wet = cell.water;
      color.multiplyScalar(1 - wet * 0.3);
      color.lerp(_cool, wet * 0.12);

      // Organic matter warms it; depletion pales it toward dust.
      color.lerp(_warm, cell.organic * 0.18);
      color.lerp(_dust, Math.max(0, 0.35 - cell.nitrogen) * 0.5);

      // Depth falloff — the transect is near-black at bedrock.
      color.multiplyScalar(0.72 + (this.depthShade[p] as number) * 0.28);

      // Everything below the water table reads as saturated ground: cooler and
      // a shade darker, so the table itself is legible as a horizon.
      const gy = Math.floor(cellIndex / GRID.cols);
      if (rowDepthCm(gy) >= world.waterTableCm) color.lerp(_saturated, 0.38);

      // Light spilling from network packed into this cell.
      if (cell.occupancy > 0.01) {
        color.lerp(this.amber, Math.min(0.4, cell.occupancy * 0.42));
        color.multiplyScalar(1 + cell.occupancy * 0.5);
      }

      this.baseColor[p * 3] = color.r;
      this.baseColor[p * 3 + 1] = color.g;
      this.baseColor[p * 3 + 2] = color.b;
      this.mesh.setColorAt(p, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Cheap per-frame tick: refresh colours on a cadence. */
  update(dt: number): void {
    this.colorAccumulator += dt;
    if (this.colorAccumulator < 0.5) return;
    this.colorAccumulator = 0;
    this.refreshColors();
  }
}

const _cool = new THREE.Color('#2b3340');
const _warm = new THREE.Color('#5a3d18');
const _dust = new THREE.Color('#6b6255');
/** Open water in the channel, and the shadowed notch above its surface. */
const _stream = new THREE.Color('#2f5560');
const _notch = new THREE.Color('#12181a');
/** Ground beneath the water table: wet, cold, and slightly mineral. */
const _saturated = new THREE.Color('#25373d');

/** Flatten the world's stratum map into the horizon letters the ruler prints. */
export function horizonBands(world: World): Array<{ id: StratumId; label: string; horizon: string; fromCm: number; toCm: number }> {
  const bands: Array<{ id: StratumId; label: string; horizon: string; fromCm: number; toCm: number }> = [];
  let current: StratumId | null = null;
  for (let gy = 0; gy < GRID.rows; gy++) {
    // Sample the middle column: the ruler describes the map, not one lucky spot.
    const cell = world.cells[idx(Math.floor(GRID.cols / 2), gy)];
    const id = (cell ? cell.stratum : 'bedrock') as StratumId;
    if (id !== current) {
      if (current !== null) {
        const last = bands[bands.length - 1];
        if (last) last.toCm = rowDepthCm(gy - 1);
      }
      const stratum = STRATA[id];
      bands.push({ id, label: stratum.label, horizon: stratum.horizon, fromCm: Math.max(0, rowDepthCm(gy) - GRID.cmPerRow), toCm: rowDepthCm(gy) });
      current = id;
    }
  }
  const last = bands[bands.length - 1];
  if (last) last.toCm = GRID.rows * GRID.cmPerRow;
  return bands;
}
