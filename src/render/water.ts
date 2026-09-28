import * as THREE from 'three';
import { GRID, MAX_DEPTH_CM } from '../sim/content';
import { standAt, type Region } from '../sim/region';
import { WATER_FRINGE_CM, rowAtDepthCm, rowDepthCm, type World } from '../sim/world';
import { waterMaterial } from './water-material';
import { TILE_SIZE } from './surface';

/**
 * Water, in both views.
 *
 * Above ground the stream is a ribbon lying on the forest floor, following the
 * region's own drainage rather than a painted course: the same `heightAt` the
 * trees stand on, the same path the generator carved. Below ground it is what
 * that stream *is* in cross-section — an open notch from the surface down to
 * its bed, water filling the notch to the local water table, and the ground
 * beneath the bed saturated but still soil.
 *
 * Nothing here decides anything. The simulation owns the channel (`SoilCell.stream`),
 * the bank's dampness (`SoilCell.streamNear`) and the water table; these two
 * objects only draw what the soil already says.
 */

const FLOOR = GRID.rows / 2;

/** The wet band either side of the channel, one shade off the floor. */
const BANK_COLOR = new THREE.Color('#2b2a1f');

export interface StreamReport {
  /** Vertices in the drawn ribbon. Zero when this region has no stream. */
  readonly ribbon: number;
  /** Stands the channel crosses, in the region's own order. */
  readonly stands: number[];
  readonly rocks: number;
}

/**
 * The stream as it appears from above.
 *
 * Built once for the match in the founding stand's frame, exactly as the
 * surfaces are, and shifted with them when the player moves to another stand.
 */
export class StreamView {
  readonly group = new THREE.Group();
  private readonly summary: StreamReport;
  private readonly flow = waterMaterial('stream');
  private water: THREE.Mesh | null = null;
  /** The ribbon's full-flow vertices, edges in pairs, for a drought to narrow. */
  private fullWidth: Float32Array | null = null;
  private dryness = 0;

  /**
   * A drought draws the stream in: the water narrows toward its centreline and
   * drops a little, leaving the muddy bed (the bank ribbon) exposed. 0 is full
   * flow; 1 leaves a quarter of the width.
   */
  setDryness(level: number): void {
    this.reshape(Math.max(0, Math.min(1, level)), this.flooding);
  }

  /**
   * The storm's flood swells the channel: the ribbon widens to twice
   * times its width (the floor draws the wider spread) and rides up its banks. The floor shader draws the water
   * that spreads beyond it.
   */
  setFlood(level: number): void {
    this.reshape(this.dryness, Math.max(0, Math.min(1, level)));
  }

  private flooding = 0;

  private reshape(dry: number, flood: number): void {
    if (!this.water || !this.fullWidth) return;
    if (Math.abs(dry - this.dryness) < 0.005 && Math.abs(flood - this.flooding) < 0.005) return;
    this.dryness = dry;
    this.flooding = flood;
    const full = this.fullWidth;
    const position = this.water.geometry.getAttribute('position') as THREE.BufferAttribute;
    const keep = (1 - 0.75 * dry) * (1 + 1.0 * flood);
    const lift = -0.1 * dry + 0.3 * flood;
    for (let i = 0; i + 1 < position.count; i += 2) {
      const a = i * 3, b = (i + 1) * 3;
      const cx = (full[a]! + full[b]!) / 2, cz = (full[a + 2]! + full[b + 2]!) / 2;
      position.setXYZ(i, cx + (full[a]! - cx) * keep, full[a + 1]! + lift, cz + (full[a + 2]! - cz) * keep);
      position.setXYZ(i + 1, cx + (full[b]! - cx) * keep, full[b + 1]! + lift, cz + (full[b + 2]! - cz) * keep);
    }
    position.needsUpdate = true;
  }

  /** The stream's course in regional coordinates, for anything drifting down it. */
  get course(): Array<{ x: number; y: number }> {
    return this.path;
  }
  private path: Array<{ x: number; y: number }> = [];

  constructor(region: Region, foundingStandId: number) {
    const founding = region.stands[foundingStandId];
    const course = region.streamPath;
    this.summary = { ribbon: 0, stands: [...region.streamStands], rocks: 0 };
    if (!founding || course.length < 2) return;
    // Round the drainage grid's right-angle steps without inventing a new
    // tributary. Arc-length sampling also keeps flow speed steady in bends.
    const curve = new THREE.CatmullRomCurve3(course.map(p => new THREE.Vector3(p.x, 0, p.y)), false, 'centripetal');
    const path = curve.getSpacedPoints(Math.ceil(curve.getLength() / 2)).map(p => ({ x: p.x, y: p.z }));
    this.path = path;
    // Region coordinates to the forest's own frame; the same inverse the floor
    // geometry uses, so the ribbon lies on the ground rather than beside it.
    const originX = founding.sx * TILE_SIZE;
    const originZ = founding.sy * TILE_SIZE;
    const toWorld = (x: number, y: number): THREE.Vector3 =>
      new THREE.Vector3(x - originX - GRID.cols / 2, FLOOR + region.heightAt(x, y), originZ - y);

    const water: THREE.Vector3[] = [];
    const banks: THREE.Vector3[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const stones: THREE.Vector3[] = [];
    let distance = 0;
    let nextStone = 11;
    for (let i = 0; i < path.length; i++) {
      const point = path[i] as { x: number; y: number };
      const before = path[Math.max(0, i - 1)] as { x: number; y: number };
      const after = path[Math.min(path.length - 1, i + 1)] as { x: number; y: number };
      const centre = toWorld(point.x, point.y);
      const segment = i > 0 ? Math.hypot(point.x - before.x, point.y - before.y) : 0;
      distance += segment;
      uvs.push(0, distance, 1, distance);
      // Perpendicular in the ground plane, so the ribbon keeps its width as the
      // stream bends.
      const dirX = after.x - before.x;
      const dirZ = -(after.y - before.y);
      const length = Math.hypot(dirX, dirZ) || 1;
      const nx = (-dirZ / length) * 1;
      const nz = (dirX / length) * 1;
      const stand = standAt(region, point.x, point.y);
      const half = Math.max(1.8, ((stand?.stream?.widthGx ?? 4) * 0.72) / 2);
      const halfBank = half + 1.5;
      while (distance >= nextStone && segment > 0) {
        const f = 1 - (distance - nextStone) / segment;
        const stone = toWorld(before.x + (point.x - before.x) * f, before.y + (point.y - before.y) * f);
        stone.x -= nx * half * 0.3;
        stone.z -= nz * half * 0.3;
        stone.y += 0.22;
        stones.push(stone);
        nextStone += 22;
      }
      water.push(
        new THREE.Vector3(centre.x + nx * half, centre.y + 0.14, centre.z + nz * half),
        new THREE.Vector3(centre.x - nx * half, centre.y + 0.14, centre.z - nz * half)
      );
      banks.push(
        new THREE.Vector3(centre.x + nx * halfBank, centre.y + 0.08, centre.z + nz * halfBank),
        new THREE.Vector3(centre.x - nx * halfBank, centre.y + 0.08, centre.z - nz * halfBank)
      );
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.summary = { ribbon: water.length, stands: [...region.streamStands], rocks: stones.length };

    this.group.add(this.ribbon(banks, indices, BANK_COLOR, 0.5, 0));
    const ribbon = this.ribbon(water, indices, BANK_COLOR, 0.86, 1);
    this.water = ribbon;
    this.fullWidth = Float32Array.from(water.flatMap((p) => [p.x, p.y, p.z]));
    (ribbon.material as THREE.Material).dispose();
    ribbon.material = this.flow.material;
    ribbon.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.group.add(ribbon);
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: '#6b7060', roughness: 0.94 }), stones.length);
    const pose = new THREE.Object3D();
    stones.forEach((point, i) => {
      pose.position.copy(point);
      pose.rotation.set(i * 0.7, i * 2.4, i * 0.3);
      pose.scale.set(0.7 + (i % 3) * 0.18, 0.4, 0.55 + (i % 2) * 0.2);
      pose.updateMatrix();
      rocks.setMatrixAt(i, pose.matrix);
    });
    rocks.instanceMatrix.needsUpdate = true;
    this.group.add(rocks);
  }

  private ribbon(vertices: THREE.Vector3[], indices: number[], color: THREE.Color, opacity: number, order: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: order === 1 ? 0.24 : 1,
        metalness: 0,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        forceSinglePass: true,
      })
    );
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Fold with the ground during a crossing, exactly as the stand's floor does,
   * so the water is never left floating over a rising specimen.
   */
  update(blend: number, dt = 0, motion = true): void {
    this.group.visible = blend > 0.01;
    if (this.group.visible && motion) this.flow.uniforms.waterTime.value += dt;
    this.group.scale.z = Math.max(0.006, blend);
  }

  report(): StreamReport {
    return this.summary;
  }
}

/**
 * The underground half: the channel's water, and the water table beneath the
 * stand.
 *
 * Both are drawn in the soil's own frame — the same coordinates the grit and
 * the depth rail use — so the water sits inside the transect rather than over
 * it. Both dissolve through the same capillary fringe used by the soil shading;
 * the channel fades into its bed rather than ending in a bright rectangle.
 */
export class GroundwaterView {
  readonly group = new THREE.Group();
  private readonly tableFlow = waterMaterial('table');
  private readonly channelFlow = waterMaterial('channel');
  private readonly bedRow: number;

  constructor(private readonly world: World, private readonly stream: { centreGx: number; widthGx: number } | null) {
    this.bedRow = rowAtDepthCm(Math.min(MAX_DEPTH_CM - 4, world.waterTableBaseCm + 6));
    const table = new THREE.Mesh(new THREE.PlaneGeometry(GRID.cols, GRID.rows), this.tableFlow.material);
    table.position.z = 1.4;
    table.renderOrder = 0;
    this.group.add(table);
    if (stream) {
      const height = this.bedRow + 1;
      // Bake local position into geometry so shader depth uses the same frame
      // as soil and simulation, with a smooth fringe even in the channel.
      const geometry = new THREE.PlaneGeometry(stream.widthGx, height);
      geometry.translate(stream.centreGx - GRID.cols / 2, FLOOR - height / 2, 0);
      const channel = new THREE.Mesh(geometry, this.channelFlow.material);
      channel.position.z = 1.6;
      channel.renderOrder = 1;
      this.group.add(channel);
    }
    this.update(0);
  }

  update(dt: number, motion = true): void {
    for (const flow of [this.tableFlow, this.channelFlow]) {
      flow.uniforms.waterDepth.value = this.world.waterTableCm;
      if (motion && this.group.visible) flow.uniforms.waterTime.value += dt;
    }
  }

  report() {
    return {
      channel: this.world.cells.reduce((sum, cell) => sum + Number(cell.stream), 0),
      tableCm: Math.round(this.world.waterTableCm),
      fringeCm: WATER_FRINGE_CM,
      width: Math.round(this.stream?.widthGx ?? 0),
      centre: this.stream?.centreGx ?? 0,
    };
  }

  get deepestCm(): number {
    return rowDepthCm(this.bedRow);
  }
}
