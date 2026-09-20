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
import { GRID, PLAYER_PALETTE } from '../sim/content';
import type { Vec3 } from '../sim/spatial';
import type { ClippedEdge, SectionClip, SectionSpec } from './sections';

/** Amber for the living section, dimmer brown for a severed remnant. */
const LIVE = new THREE.Color(PLAYER_PALETTE.core[0], PLAYER_PALETTE.core[1], PLAYER_PALETTE.core[2]);
const SEVERED = new THREE.Color(0.62, 0.44, 0.22);
const FRAME = new THREE.Color(0.72, 0.65, 0.48);
const MARK = new THREE.Color(PLAYER_PALETTE.glow[0], PLAYER_PALETTE.glow[1], PLAYER_PALETTE.glow[2]);
/** How far a continuation mark reaches beyond the slab, in region units. */
const MARK_LENGTH = 2.4;

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
  private strandCount = 0;
  private markCount = 0;

  constructor(toScene: (point: Vec3) => THREE.Vector3, groundAt: (x: number, y: number) => number) {
    this.toScene = toScene;
    this.groundAt = groundAt;
    this.group.visible = false;
  }

  /** Which slab is being shown. Rebuilds only the frame. */
  setSection(spec: SectionSpec | null): void {
    this.spec = spec;
    this.group.visible = spec !== null;
    this.buildFrame();
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
  sync(clip: SectionClip): void {
    const positions: number[] = [];
    const colours: number[] = [];
    for (const edge of clip.visible) {
      const from = this.toScene(edge.from);
      const to = this.toScene(edge.to);
      const colour = edge.connected ? LIVE : SEVERED;
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
    for (const edge of clip.visible) {
      const colour = edge.connected ? LIVE : SEVERED;
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
