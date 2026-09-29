/** A stand's familiar flat view into the one regional soil volume. */
import { GRID } from './content';
import type { CrossingCorridor } from './crossing';
import type { Region } from './region';
import { SoilVolume } from './soil-volume';
import { elevationAtDepthCm, planePoint, standFrameOf, vec3, voxelKeyOf, voxelKeyText, type Vec3 } from './spatial';
import { entryCostFor, rowDepthCm, type SoilCell, type World } from './world';

export function bindStandToSharedSoil(
  world: World,
  region: Region,
  standId: number,
  corridor: CrossingCorridor,
  soil: SoilVolume
): void {
  const frame = standFrameOf(region, standId);
  if (!frame) throw new Error(`shared soil: no stand ${standId}`);
  const offset = corridor.alongIsX ? frame.originX : frame.originY;
  let blockClimate = soil.environment.waterTableOffsetCm;
  const blocks = new Map<number, 'outside' | 'bedrock' | 'stream' | 'groundwater' | null>();
  const cellAt = (gx: number, gy: number): SoilCell | null =>
    gx >= 0 && gx < GRID.cols && gy >= 0 && gy < GRID.rows
      ? world.cells[gy * GRID.cols + gx] ?? null : null;
  // Elevation is terrain noise: pure, and the most expensive part of a point.
  // Whole-cell points are asked for constantly (every passability test and
  // every cell view), so they are computed once per stand.
  const cellElevation = new Float64Array(GRID.cols * GRID.rows).fill(NaN);
  const pointAt = (gx: number, gy: number): Vec3 | null => {
    if (gx < 0 || gx >= GRID.cols || gy < 0 || gy >= GRID.rows) return null;
    const point = planePoint({ along: corridor.alongIsX ? 'x' : 'y', fixed: corridor.fixed }, offset + gx + 0.5);
    if (Number.isInteger(gx) && Number.isInteger(gy)) {
      const index = gy * GRID.cols + gx;
      let z = cellElevation[index]!;
      if (Number.isNaN(z)) z = cellElevation[index] = elevationAtDepthCm(region, point.x, point.y, rowDepthCm(gy));
      return vec3(point.x, point.y, z);
    }
    return vec3(point.x, point.y, elevationAtDepthCm(region, point.x, point.y, rowDepthCm(gy)));
  };
  const blockAt = (gx: number, gy: number) => {
    if (soil.environment.waterTableOffsetCm !== blockClimate) {
      blocks.clear();
      blockClimate = soil.environment.waterTableOffsetCm;
    }
    if (gx < 0 || gx >= GRID.cols || gy < 0 || gy >= GRID.rows) return 'outside' as const;
    const index = gy * GRID.cols + gx;
    const known = blocks.get(index);
    if (known !== undefined) return known;
    const point = pointAt(gx, gy)!;
    const reason = soil.blockAt(point.x, point.y, point.z).reason;
    blocks.set(index, reason);
    return reason;
  };

  // Local cells are views. A read sees the analytic baseline or the current
  // changed voxel; a write materializes that voxel. Merely drawing the full
  // transect never turns 15,000 untouched cells into simulation work.
  //
  // A materialized voxel is one canonical, permanent record (the volume never
  // drops a change), so once a cell has one the view is retired: the array
  // slot is replaced by the record itself and later reads and writes are plain
  // property access. Anyone still holding the view sees the same record.
  for (let gy = 0; gy < GRID.rows; gy++) for (let gx = 0; gx < GRID.cols; gx++) {
    const point = pointAt(gx, gy)!;
    const cellKey = voxelKeyText(voxelKeyOf(point));
    const baseline = soil.readMaterialAt(point.x, point.y, point.z);
    const index = gy * GRID.cols + gx;
    let live: SoilCell | null = soil.changedMaterialForKey(cellKey);
    const settle = (cell: SoilCell): SoilCell => {
      live = cell;
      world.cells[index] = cell;
      return cell;
    };
    world.cells[index] = live ?? new Proxy(baseline, {
      get(_target, property) {
        const current = live ?? soil.changedMaterialForKey(cellKey);
        return Reflect.get(current ? (live ?? settle(current)) : baseline, property);
      },
      set(_target, property, value) {
        return Reflect.set(live ?? settle(soil.materialAt(point.x, point.y, point.z)), property, value);
      },
    }) as SoilCell;
  }
  world.regionalSoil = { standId, blockAt, pointAt };
  const centre = pointAt(Math.floor(GRID.cols / 2), 0)!;
  world.waterTableBaseCm = soil.waterTableDepthCm(centre.x, centre.y);
  world.waterTableCm = world.waterTableBaseCm;
  world.cellFrom = (node, dx, dy) => cellAt(node.gx + dx, node.gy + dy);
  world.cellOf = (node) => cellAt(node.gx, node.gy);
  world.passableFrom = (node, dx, dy) => {
    if (blockAt(node.gx, node.gy) || blockAt(node.gx + dx, node.gy + dy)) return false;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let step = 1; step < steps; step++) {
        if (blockAt(node.gx + Math.round(dx * step / steps), node.gy + Math.round(dy * step / steps))) return false;
      }
    }
    return true;
  };
  world.costFrom = (node, dx, dy) => entryCostFor(cellAt(node.gx + dx, node.gy + dy));
}
