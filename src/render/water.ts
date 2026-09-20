import * as THREE from 'three';
import { GRID, MAX_DEPTH_CM } from '../sim/content';
import { standAt, type Region } from '../sim/region';
import { rowAtDepthCm, rowDepthCm, type World } from '../sim/world';
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

/** Forest water: dark, cool, and glossy enough to catch the raking light. */
const WATER_COLOR = new THREE.Color('#2c4148');
/** The wet band either side of the channel, one shade off the floor. */
const BANK_COLOR = new THREE.Color('#2b2a1f');

export interface StreamReport {
  /** Vertices in the drawn ribbon. Zero when this region has no stream. */
  readonly ribbon: number;
  /** Stands the channel crosses, in the region's own order. */
  readonly stands: number[];
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

  constructor(region: Region, foundingStandId: number) {
    const founding = region.stands[foundingStandId];
    const path = region.streamPath;
    this.summary = { ribbon: 0, stands: [...region.streamStands] };
    if (!founding || path.length < 2) return;
    // Region coordinates to the forest's own frame; the same inverse the floor
    // geometry uses, so the ribbon lies on the ground rather than beside it.
    const originX = founding.sx * TILE_SIZE;
    const originZ = founding.sy * TILE_SIZE;
    const toWorld = (x: number, y: number): THREE.Vector3 =>
      new THREE.Vector3(x - originX - GRID.cols / 2, FLOOR + region.heightAt(x, y), originZ - y);

    const water: THREE.Vector3[] = [];
    const banks: THREE.Vector3[] = [];
    const indices: number[] = [];
    for (let i = 0; i < path.length; i++) {
      const point = path[i] as { x: number; y: number };
      const before = path[Math.max(0, i - 1)] as { x: number; y: number };
      const after = path[Math.min(path.length - 1, i + 1)] as { x: number; y: number };
      const centre = toWorld(point.x, point.y);
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
    this.summary = { ribbon: water.length, stands: [...region.streamStands] };

    this.group.add(this.ribbon(banks, indices, BANK_COLOR, 0.5, 0));
    this.group.add(this.ribbon(water, indices, WATER_COLOR, 0.86, 1));
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
  update(blend: number): void {
    this.group.visible = blend > 0.01;
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
 * it. The table is a rule across the specimen; the channel is a column of water
 * filling the notch down to its bed.
 */
export class GroundwaterView {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly channel: THREE.Mesh | null;
  private readonly table: THREE.Mesh;
  private readonly channelHalf: number;
  private readonly centreGx: number;
  private readonly bedRow: number;

  constructor(world: World, stream: { centreGx: number; widthGx: number } | null) {
    this.world = world;
    const waterRow = rowAtDepthCm(world.waterTableCm);
    this.bedRow = rowAtDepthCm(Math.min(MAX_DEPTH_CM - 4, world.waterTableBaseCm + 6));
    this.channelHalf = stream ? stream.widthGx / 2 : 0;
    this.centreGx = stream ? stream.centreGx : 0;

    if (stream) {
      const width = stream.widthGx;
      const geometry = new THREE.PlaneGeometry(width, 1);
      const material = new THREE.MeshBasicMaterial({
        color: '#2f4a55',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      this.channel = new THREE.Mesh(geometry, material);
      this.channel.position.set(stream.centreGx - GRID.cols / 2, FLOOR - waterRow, 1.1);
      this.channel.renderOrder = 1;
      this.group.add(this.channel);
    } else {
      this.channel = null;
    }

    // The water table: one hairline of shade across the whole specimen, moving
    // with the season as the table rises and falls.
    const tableGeometry = new THREE.PlaneGeometry(GRID.cols, 1.6);
    const tableMaterial = new THREE.MeshBasicMaterial({
      color: '#3d5a66',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.table = new THREE.Mesh(tableGeometry, tableMaterial);
    this.table.position.set(0, FLOOR - waterRow, 1.4);
    this.table.renderOrder = 0;
    this.group.add(this.table);
  }

  /** Follow the live water table and the channel's own water surface. */
  update(_dt: number): void {
    const waterRow = rowAtDepthCm(this.world.waterTableCm);
    const surface = FLOOR - waterRow;
    this.table.position.y = surface;
    if (this.channel) {
      const bottom = FLOOR - this.bedRow - 1;
      const height = Math.max(0.6, surface - bottom);
      this.channel.scale.y = height;
      this.channel.position.y = (surface + bottom) / 2;
    }
  }

  /** Cells of open channel in this stand, and the table's depth. */
  report(): { channel: number; tableCm: number; width: number; centre: number } {
    let channel = 0;
    for (const cell of this.world.cells) if (cell.stream) channel++;
    return {
      channel,
      tableCm: Math.round(this.world.waterTableCm),
      width: Math.round(this.channelHalf * 2),
      centre: this.centreGx,
    };
  }

  /** Depth, in centimetres, of the deepest drawn water. Used by the checks. */
  get deepestCm(): number {
    return rowDepthCm(this.bedRow);
  }
}
