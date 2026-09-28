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
  const pointAt = (gx: number, gy: number): Vec3 | null => {
    if (gx < 0 || gx >= GRID.cols || gy < 0 || gy >= GRID.rows) return null;
    const point = planePoint({ along: corridor.alongIsX ? 'x' : 'y', fixed: corridor.fixed }, offset + gx + 0.5);
    return vec3(point.x, point.y, elevationAtDepthCm(region, point.x, point.y, rowDepthCm(gy)));
  };
  const blockAt = (gx: number, gy: number) => {
    if (soil.environment.waterTableOffsetCm !== blockClimate) {
      blocks.clear();
      blockClimate = soil.environment.waterTableOffsetCm;
    }
    const point = pointAt(gx, gy);
    if (!point) return 'outside' as const;
    const index = gy * GRID.cols + gx;
    if (blocks.has(index)) return blocks.get(index)!;
    const reason = soil.blockAt(point.x, point.y, point.z).reason;
    blocks.set(index, reason);
    return reason;
  };

  // Local cells are views. A read sees the analytic baseline or the current
  // changed voxel; a write materializes that voxel. Merely drawing the full
  // transect never turns 15,000 untouched cells into simulation work.
  for (let gy = 0; gy < GRID.rows; gy++) for (let gx = 0; gx < GRID.cols; gx++) {
    const point = pointAt(gx, gy)!;
    const cellKey = voxelKeyText(voxelKeyOf(point));
    const baseline = soil.readMaterialAt(point.x, point.y, point.z);
    world.cells[gy * GRID.cols + gx] = new Proxy(baseline, {
      get(_target, property) {
        const current = soil.changedMaterialForKey(cellKey) ?? baseline;
        return Reflect.get(current, property);
      },
      set(_target, property, value) {
        const current = soil.materialAt(point.x, point.y, point.z);
        return Reflect.set(current, property, value);
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
