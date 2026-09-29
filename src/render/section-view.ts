/**
 * The drawn vertical section (`VIEW-06`).
 *
 * A section is a slab, so this draws three things and nothing else: the strands
 * clipped to it, a continuation mark where a strand leaves the slab, and the
 * faint frame of the slab itself so the player can see which plane they are
 * looking at. Nothing here decides anything - the section's spec and its clipped
 * edges come from `sections.ts`, which is pure.
 *
 * Coordinates are the simulation's. The caller supplies the region-to-scene
 * transform, so the section and the forest cannot disagree about where a place
 * is, and a rebase moves both together.
 */
import * as THREE from 'three';
import { GRID, PLAYER_PALETTE, RIVAL_PALETTE } from '../sim/content';
import type { Vec3 } from '../sim/spatial';
import type { ClippedEdge, SectionClip, SectionSpec } from './sections';
import { soilColour, type SoilLook } from './soil';

/** Amber for the living section, dimmer brown for a severed remnant. */
const LIVE = new THREE.Color(PLAYER_PALETTE.core[0], PLAYER_PALETTE.core[1], PLAYER_PALETTE.core[2]);
const SEVERED = new THREE.Color(0.62, 0.44, 0.22);
/** Another owner's strands, drawn so a front reads at a glance (contact war). */
const ENEMY = new THREE.Color(RIVAL_PALETTE.core[0], RIVAL_PALETTE.core[1], RIVAL_PALETTE.core[2]);
const ENEMY_SEVERED = new THREE.Color(0.42, 0.5, 0.4);
/** The selected subcluster, in the selection circle's own cool blue. */
const SELECTED = new THREE.Color(0.62, 0.9, 1);
const FRAME = new THREE.Color(0.72, 0.65, 0.48);
const MARK = new THREE.Color(PLAYER_PALETTE.glow[0], PLAYER_PALETTE.glow[1], PLAYER_PALETTE.glow[2]);
/** How far a continuation mark reaches beyond the slab, in region units. */
const MARK_LENGTH = 2.4;
/** Reach across a full neighbouring stand, including the widest section view. */
export const SECTION_SOIL_MARGIN = 180;

/** What the backdrop needs from the regional soil. */
export interface SectionSoilSource {
  /** The soil's look at a regional point, or null outside the region. */
  sample(x: number, y: number, z: number): SoilLook | null;
  /** Which stand owns a horizontal position, or null outside the region. */
  standAt(x: number, y: number): number | null;
}

export class SectionView {
  readonly group = new THREE.Group();
  /** The part of the slab the camera is actually framing, if it is not all of it. */
  private window: { alongFrom: number; alongTo: number; depthFromCm: number; depthToCm: number } | null = null;
  private readonly toScene: (point: Vec3) => THREE.Vector3;
  private readonly groundAt: (x: number, y: number) => number;
  private strands: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private marks: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private frame: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  /** Strand nodes as dots: at fixture spacing a one-unit segment is tiny. */
  private nodes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private spec: SectionSpec | null = null;
  /** The regional soil drawn behind the strands, running into the neighbours. */
  private soil: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private soilSource: SectionSoilSource | null = null;
  private soilFor: string | null = null;
  /** Reuse the nearby slices players usually step back to; at most four meshes. */
  private readonly soilCache = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>();
  private strandCount = 0;
  private markCount = 0;

  constructor(toScene: (point: Vec3) => THREE.Vector3, groundAt: (x: number, y: number) => number) {
    this.toScene = toScene;
    this.groundAt = groundAt;
    this.group.visible = false;
  }

  /** Which slab is being shown. Rebuilds the frame, and the soil if the slab changed. */
  setSection(spec: SectionSpec | null): void {
    const changed = (this.spec?.id ?? null) !== (spec?.id ?? null);
    this.spec = spec;
    this.group.visible = spec !== null;
    if (changed) {
      this.buildFrame();
      this.buildSoil();
    }
  }

  /** Where the soil backdrop reads its material from. */
  setSoilSource(source: SectionSoilSource | null): void {
    this.soilSource = source;
    this.clearSoilCache();
    this.soilFor = null;
    this.buildSoil(false);
  }

  /** Redraw the soil, e.g. after the ground has changed under a power. */
  refreshSoil(): void {
    this.clearSoilCache();
    this.soilFor = null;
    this.buildSoil(false);
  }

  /**
   * Show the slab's outline over the part of it on screen.
   *
   * A stand is 136 units wide and a colony may occupy a tenth of that, so a
   * frame drawn at the stand's full extent would sit mostly off screen while
   * the camera looks at the strands. The window is presentation only: the
   * section itself is unchanged, and the readout still names the real plane.
   */
  setWindow(window: { alongFrom: number; alongTo: number; depthFromCm: number; depthToCm: number } | null): void {
    this.window = window;
    this.buildFrame();
  }

  /** The clipped strands of the current section. */
  sync(clip: SectionClip, enemy?: SectionClip, highlight?: ReadonlySet<number>): void {
    const positions: number[] = [];
    const colours: number[] = [];
    const theirs = new Set(enemy?.visible ?? []);
    const all = enemy ? [...clip.visible, ...enemy.visible] : clip.visible;
    for (const edge of all) {
      const from = this.toScene(edge.from);
      const to = this.toScene(edge.to);
      const colour = theirs.has(edge) ? (edge.connected ? ENEMY : ENEMY_SEVERED)
        : highlight?.has(edge.child) ? SELECTED : edge.connected ? LIVE : SEVERED;
      // A severed remnant is a double line, so "this piece is cut off" is
      // legible without depending on colour alone.
      const offsets = edge.connected ? [0] : [-0.4, 0.4];
      for (const offset of offsets) {
        positions.push(from.x, from.y + offset, from.z, to.x, to.y + offset, to.z);
        colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
      }
    }
    this.strandCount = clip.visible.length;
    this.strands = this.replace(this.strands, new Float32Array(positions), new Float32Array(colours), 0.95);

    const markPositions: number[] = [];
    const markColours: number[] = [];
    for (const edge of clip.visible) {
      for (const exit of edge.exits) pushMark(markPositions, markColours, edge, exit.at, exit.side, this.toScene);
    }
    this.markCount = markPositions.length / 6;
    this.marks = this.replace(this.marks, new Float32Array(markPositions), new Float32Array(markColours), 0.85);

    // One dot per strand node, so the section reads at any zoom. The nodes are
    // the simulation's own; the dots are a drawing of them, not new state.
    const nodePositions: number[] = [];
    const nodeColours: number[] = [];
    for (const edge of all) {
      const colour = theirs.has(edge) ? (edge.connected ? ENEMY : ENEMY_SEVERED)
        : highlight?.has(edge.child) ? SELECTED : edge.connected ? LIVE : SEVERED;
      for (const point of [edge.from, edge.to]) {
        const scene = this.toScene(point);
        nodePositions.push(scene.x, scene.y, scene.z);
        nodeColours.push(colour.r, colour.g, colour.b);
      }
    }
    this.nodes = this.replacePoints(this.nodes, new Float32Array(nodePositions), new Float32Array(nodeColours));
  }

  update(blend: number, reduced: boolean, time: number): void {
    const visible = this.spec !== null && blend < 0.4;
    this.group.visible = visible;
    if (!visible) return;
    // A slow breath on the frame only: the strands themselves are the record
    // and are never animated into pretend growth.
    if (this.frame) (this.frame.material as THREE.LineBasicMaterial).opacity = reduced ? 0.42 : 0.34 + Math.sin(time * 0.6) * 0.06;
  }

  report(): { section: string | null; strands: number; marks: number; visible: boolean } {
    return {
      section: this.spec?.id ?? null,
      strands: this.strandCount,
      marks: this.markCount,
      visible: this.group.visible,
    };
  }

  dispose(): void {
    if (this.soil) {
      this.group.remove(this.soil);
      this.soil.geometry.dispose();
      this.soil.material.dispose();
      this.soil = null;
    }
    this.clearSoilCache();
    for (const batch of [this.strands, this.marks, this.frame, this.nodes]) {
      if (!batch) continue;
      this.group.remove(batch);
      batch.geometry.dispose();
      batch.material.dispose();
    }
    this.strands = null;
    this.marks = null;
    this.frame = null;
    this.nodes = null;
  }

  // -------------------------------------------------------------------------

  /**
   * The ground the section cuts through, as a vertex-coloured sheet one unit
   * per column and one centimetre per row, running past both ends into the
   * neighbouring stands. It sits behind the strands and is rebuilt only when
   * the section changes: soil does not move fast enough to need more.
   */
  private clearSoilCache(): void {
    for (const soil of this.soilCache.values()) {
      soil.geometry.dispose();
      soil.material.dispose();
    }
    this.soilCache.clear();
  }

  private buildSoil(reuse = true): void {
    if (this.soil) {
      this.group.remove(this.soil);
      if (reuse && this.soilFor) {
        this.soilCache.set(this.soilFor, this.soil);
        if (this.soilCache.size > 4) {
          const oldest = this.soilCache.keys().next().value;
          if (oldest !== undefined) {
            const evicted = this.soilCache.get(oldest);
            evicted?.geometry.dispose();
            evicted?.material.dispose();
            this.soilCache.delete(oldest);
          }
        }
      } else {
        this.soil.geometry.dispose();
        this.soil.material.dispose();
      }
      this.soil = null;
    }
    const spec = this.spec;
    const source = this.soilSource;
    this.soilFor = spec?.id ?? null;
    if (!spec || !source) return;
    const cached = this.soilCache.get(spec.id);
    if (cached) {
      this.soilCache.delete(spec.id);
      this.soil = cached;
      this.group.add(cached);
      return;
    }
    const from = Math.floor(spec.alongFrom - SECTION_SOIL_MARGIN);
    const to = Math.ceil(spec.alongTo + SECTION_SOIL_MARGIN);
    const rows = Math.max(2, Math.round(spec.depthToCm - spec.depthFromCm) + 1);
    const depthAt = (row: number) => spec.depthFromCm + ((spec.depthToCm - spec.depthFromCm) * row) / (rows - 1);
    const positions: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    const colour = new THREE.Color();
    // Columns run left to right; a column outside the region breaks the sheet
    // so nothing is drawn past the region's own edge.
    let previousColumn: number | null = null;
    for (let along = from; along <= to; along++) {
      const top = pointOn(spec, along, spec.depthFromCm, this.groundAt);
      const stand = source.standAt(top.x, top.y);
      if (stand === null) {
        previousColumn = null;
        continue;
      }
      const column = positions.length / 3;
      for (let row = 0; row < rows; row++) {
        const point = pointOn(spec, along, depthAt(row), this.groundAt);
        const scene = this.toScene(point);
        positions.push(scene.x, scene.y, scene.z);
        const look = source.sample(point.x, point.y, point.z);
        if (look) soilColour(look, colour);
        else colour.setRGB(0.05, 0.045, 0.04);
        // The grain of the ground: a fixed per-voxel hash, never animated.
        const grain = 0.86 + 0.28 * hash(along, row);
        colour.multiplyScalar(grain * (0.8 + 0.2 * (1 - row / rows)) * 1.15);
        colours.push(colour.r, colour.g, colour.b);
      }
      if (previousColumn !== null) {
        for (let row = 0; row < rows - 1; row++) {
          const a = previousColumn + row;
          const b = column + row;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      previousColumn = column;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    this.soil = new THREE.Mesh(geometry, material);
    this.soil.frustumCulled = false;
    // Drawn first, so every strand, node and mark sits over it.
    this.soil.renderOrder = -2;
    this.group.add(this.soil);
  }

  /** The slab's own outline: extent along the plane, and its depth. */
  private buildFrame(): void {
    const spec = this.spec;
    const positions: number[] = [];
    const colours: number[] = [];
    if (spec) {
      const alongFrom = this.window?.alongFrom ?? spec.alongFrom;
      const alongTo = this.window?.alongTo ?? spec.alongTo;
      const depthFrom = this.window?.depthFromCm ?? spec.depthFromCm;
      const depthTo = this.window?.depthToCm ?? spec.depthToCm;
      const corners: Vec3[] = [
        pointOn(spec, alongFrom, depthFrom, this.groundAt),
        pointOn(spec, alongTo, depthFrom, this.groundAt),
        pointOn(spec, alongTo, depthTo, this.groundAt),
        pointOn(spec, alongFrom, depthTo, this.groundAt),
      ];
      for (let i = 0; i < corners.length; i++) {
        const a = this.toScene(corners[i] as Vec3);
        const b = this.toScene(corners[(i + 1) % corners.length] as Vec3);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        colours.push(FRAME.r, FRAME.g, FRAME.b, FRAME.r, FRAME.g, FRAME.b);
      }
    }
    this.frame = this.replace(this.frame, new Float32Array(positions), new Float32Array(colours), 0.4);
  }

  private replace(
    existing: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null,
    positions: Float32Array,
    colours: Float32Array,
    opacity: number
  ): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
    if (existing) {
      this.group.remove(existing);
      existing.geometry.dispose();
      existing.material.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  private replacePoints(
    existing: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null,
    positions: Float32Array,
    colours: Float32Array
  ): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    if (existing) {
      this.group.remove(existing);
      existing.geometry.dispose();
      existing.material.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.PointsMaterial({
      vertexColors: true,
      size: 4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    return points;
  }
}

/** A stable 0..1 hash for the soil's grain. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A point on the section plane at a given along-distance and depth. */
function pointOn(
  spec: SectionSpec,
  along: number,
  depthCm: number,
  groundAt: (x: number, y: number) => number
): Vec3 {
  const x = spec.plane.along === 'x' ? along : spec.plane.fixed;
  const y = spec.plane.along === 'x' ? spec.plane.fixed : along;
  // Depth is measured from the ground directly above, exactly as the strands'
  // own positions are.
  return { x, y, z: groundAt(x, y) - depthCm / GRID.cmPerRow };
}

/** A short tick where a strand leaves the slab. */
function pushMark(
  positions: number[],
  colours: number[],
  edge: ClippedEdge,
  at: Vec3,
  side: 'enter' | 'leave',
  toScene: (point: Vec3) => THREE.Vector3
): void {
  const direction = side === 'enter' ? -1 : 1;
  const outward: Vec3 = {
    x: at.x,
    y: at.y + direction * MARK_LENGTH,
    z: at.z + (edge.thickness > 0.6 ? 0.6 : 0),
  };
  const a = toScene(at);
  const b = toScene(outward);
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  colours.push(MARK.r, MARK.g, MARK.b, MARK.r, MARK.g, MARK.b);
}
