import * as THREE from 'three';
import { GRID } from '../sim/content';
import { soilColour, type SoilLook } from './soil';

/**
 * The neighbouring stands' soil, drawn faintly past both ends of the flat
 * underground transect (`MAP-07`).
 *
 * The transect is one stand wide, but its ends are seams, not walls: a grow
 * order placed in this strip crosses into the next stand. The strip is sampled
 * from the same regional soil volume as everything else, so it shows the
 * ground the strands will actually meet. It is presentation only.
 */

/** How many columns of each neighbour are shown, in grid cells. */
export const EDGE_SOIL_COLUMNS = 40;
/** How bright a neighbour's soil is, against the transect's own. */
const NEIGHBOUR_SHADE = 0.85;
const SEAM = new THREE.Color(0.86, 0.76, 0.52);

export interface EdgeSoilSource {
  /** Soil at a local column (may lie outside 0..cols-1) and depth, or null outside the region. */
  sample(column: number, depthCm: number): SoilLook | null;
  readonly west: boolean;
  readonly east: boolean;
}

/** Build both strips as one group, in the transect's own local coordinates. */
export function buildEdgeSoil(source: EdgeSoilSource): THREE.Group {
  const group = new THREE.Group();
  group.name = 'edge-soil';
  const strips: Array<[number, number]> = [];
  if (source.west) strips.push([-EDGE_SOIL_COLUMNS, -1]);
  if (source.east) strips.push([GRID.cols, GRID.cols + EDGE_SOIL_COLUMNS - 1]);
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const seamPositions: number[] = [];
  const colour = new THREE.Color();
  const rows = GRID.rows;
  for (const [first, last] of strips) {
    let previous: number | null = null;
    for (let column = first; column <= last + 1; column++) {
      const start = positions.length / 3;
      const x = column - GRID.cols / 2;
      // Fade toward the far end, so the strip reads as a glimpse, not a floor.
      const distance = column < 0 ? -column : column - GRID.cols + 1;
      const fade = NEIGHBOUR_SHADE * (1 - 0.55 * Math.min(1, distance / EDGE_SOIL_COLUMNS));
      for (let row = 0; row <= rows; row++) {
        positions.push(x, GRID.rows / 2 - row, -0.6);
        const look = source.sample(Math.min(last, column), (Math.min(rows - 1, row) + 0.5) * GRID.cmPerRow);
        if (look) soilColour(look, colour);
        else colour.setRGB(0.04, 0.035, 0.03);
        const grain = 0.85 + 0.3 * grainAt(column, row);
        colour.multiplyScalar(grain * fade * (0.75 + 0.25 * (1 - row / rows)));
        colours.push(colour.r, colour.g, colour.b);
      }
      if (previous !== null) {
        for (let row = 0; row < rows; row++) {
          const a = previous + row;
          const b = start + row;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      previous = start;
    }
    // The seam itself, dashed, at the transect's own edge.
    const seamX = (first < 0 ? 0 : GRID.cols) - GRID.cols / 2;
    for (let row = 0; row < rows; row += 4) {
      seamPositions.push(seamX, GRID.rows / 2 - row, -0.4, seamX, GRID.rows / 2 - Math.min(rows, row + 2), -0.4);
    }
  }
  if (positions.length === 0) return group;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const sheet = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  sheet.name = 'edge-soil-sheet';
  group.add(sheet);
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seamPositions, 3));
  const seams = new THREE.LineSegments(seamGeometry, new THREE.LineBasicMaterial({ color: SEAM, transparent: true, opacity: 0.8 }));
  seams.name = 'edge-soil-seams';
  group.add(seams);
  return group;
}

/** A stable 0..1 hash for the soil's grain. */
function grainAt(a: number, b: number): number {
  let h = Math.imul((a + 1000) | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
