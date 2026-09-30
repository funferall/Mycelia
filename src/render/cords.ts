/**
 * Cords, drawn as what they are: several hyphae braided into one rope.
 *
 * A cord is three strands twisted around the strand it thickened, with a knot
 * wherever the twist completes a turn and at both ends. The strand behind the
 * rope is drawn darker than the one in front, so the over-and-under reads in a
 * flat section as well as in depth. Light runs along a cord at a pace set by how
 * hard it is working, so a loaded cord visibly streams and an idle one glows.
 *
 * The same overlay also draws two things the cord order needs and nothing
 * else: the colony's bottlenecks (strands whose carbon pipe is running full,
 * shown only while the cord tool is in hand) and the preview of the cord an
 * order would lay - bright as far as the colony can afford, red beyond it.
 *
 * Nothing here decides anything. Positions come from the caller in the scene
 * frame of whichever view is showing; the simulation owns what a cord is.
 */
import * as THREE from 'three';

export interface CordSegment {
  /** Node id; the segment is the strand from its parent to it. */
  id: number;
  parentId: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** 0..1 how full the strand's pipe runs. */
  load: number;
}

export interface CordPalette {
  core: THREE.Color;
  glow: THREE.Color;
}

const TAU = Math.PI * 2;
const STRANDS = 3;
const HOT = new THREE.Color('#fff2cf');
const CHOKE = new THREE.Color('#ff4a2e');
const CHOKE_HOT = new THREE.Color('#ffd9c9');
const AFFORD = new THREE.Color('#fff6dc');
const SHORT = new THREE.Color('#d8452f');
const UP = new THREE.Vector3(0, 1, 0);
/** A strand whose carbon pipe runs at least this full is shown as a bottleneck. */
export const BOTTLENECK_LOAD = 0.9;

export interface CordOverlayOptions {
  /** Radius of the rope around the strand's axis, in scene units. */
  radius?: number;
  /** The direction the viewer looks along; the braid's over/under is measured on it. */
  normal?: THREE.Vector3;
}

export class CordOverlay {
  readonly group = new THREE.Group();
  private braid: THREE.InstancedMesh;
  private knots: THREE.InstancedMesh;
  private readonly bottlenecks: THREE.Points;
  private readonly preview: THREE.Points;
  private readonly palette: CordPalette;
  private radius: number;
  private readonly normal = new THREE.Vector3(0, 0, 1);

  /** Per braid instance: arc length along its cord, depth shade, load. */
  private arc = new Float32Array(0);
  private shade = new Float32Array(0);
  private loads = new Float32Array(0);
  private braidCount = 0;
  private signature = '';
  private previewPoints: THREE.Vector3[] = [];
  private previewAffordable = 0;
  private bottleneckCount = 0;

  private readonly dummy = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private readonly dir = new THREE.Vector3();
  private readonly u = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  /** Per braid instance: the cord segment (node id) it belongs to. */
  constructor(palette: CordPalette, glowMap: THREE.Texture, options: CordOverlayOptions = {}) {
    this.palette = palette;
    this.radius = options.radius ?? 0.3;
    if (options.normal) this.normal.copy(options.normal).normalize();

    this.braid = this.makeInstanced(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), 2048, 4);
    this.knots = this.makeInstanced(new THREE.IcosahedronGeometry(1, 1), 256, 5);
    this.group.add(this.braid, this.knots);

    this.bottlenecks = this.makePoints(glowMap, 2048, 3.2, 6);
    this.preview = this.makePoints(glowMap, 1024, 2.4, 7);
    this.group.add(this.bottlenecks, this.preview);
  }

  setNormal(normal: THREE.Vector3): void {
    if (this.normal.distanceToSquared(normal) < 1e-6) return;
    this.normal.copy(normal).normalize();
    this.signature = '';
  }

  private makeInstanced(geometry: THREE.BufferGeometry, capacity: number, order: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
    }), capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, this.colour.set(0, 0, 0));
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = order;
    return mesh;
  }

  private makePoints(glowMap: THREE.Texture, capacity: number, size: number, order: number): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setDrawRange(0, 0);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size, sizeAttenuation: true, map: glowMap, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      vertexColors: true, toneMapped: false,
    }));
    points.frustumCulled = false;
    points.renderOrder = order;
    return points;
  }

  private grow(mesh: THREE.InstancedMesh, needed: number): THREE.InstancedMesh {
    const capacity = mesh.instanceMatrix.count;
    if (needed <= capacity) return mesh;
    let next = capacity;
    while (next < needed) next *= 2;
    const replacement = new THREE.InstancedMesh(mesh.geometry, mesh.material, next);
    replacement.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    replacement.setColorAt(0, this.colour.set(0, 0, 0));
    replacement.frustumCulled = false;
    replacement.renderOrder = mesh.renderOrder;
    this.group.remove(mesh);
    this.group.add(replacement);
    mesh.dispose();
    return replacement;
  }

  /**
   * Rebuild the ropes when the set of cords has changed. Cords do not move, so
   * this is rare; the shimmer is a recolour in `update`. `frame` names the
   * coordinate frame the points are in, so a new section or a rebase rebuilds.
   */
  setCords(segments: readonly CordSegment[], frame = ''): void {
    const signature = `${frame}|${segments.length}:${segments.length ? segments[0]!.id : -1}:${segments.length ? segments[segments.length - 1]!.id : -1}`;
    const loads = new Map(segments.map((s) => [s.id, s.load]));
    if (signature === this.signature) {
      // Same ropes; only how hard they work has changed.
      for (let i = 0; i < this.braidCount; i++) this.loads[i] = loads.get(this.segmentOf[i]!) ?? this.loads[i]!;
      return;
    }
    this.signature = signature;

    const ordered = [...segments].sort((x, y) => x.id - y.id);
    const inSet = new Set(ordered.map((s) => s.id));
    const hasChild = new Set(ordered.map((s) => s.parentId));
    const phase = new Map<number, number>();
    const arcAt = new Map<number, number>();

    let pieces = 0;
    const plan = ordered.map((segment) => {
      const length = segment.a.distanceTo(segment.b);
      const sub = Math.max(2, Math.ceil(length / (this.radius * 1.6)));
      pieces += sub * STRANDS;
      return { segment, length, sub };
    });
    this.braid = this.grow(this.braid, pieces);
    this.knots = this.grow(this.knots, ordered.length * 2 + 8);
    if (this.arc.length < pieces) {
      this.arc = new Float32Array(pieces);
      this.shade = new Float32Array(pieces);
      this.loads = new Float32Array(pieces);
      this.segmentOf = new Int32Array(pieces);
    }

    // One twist per few rope-widths: tight enough to read as a braid.
    const twist = TAU / (this.radius * 9);
    const strandRadius = this.radius * 0.36;
    let n = 0;
    let k = 0;
    for (const { segment, length, sub } of plan) {
      const start = !inSet.has(segment.parentId);
      // The strand runs parent (b) -> node (a); the phase carries on from the parent.
      const phase0 = start ? (segment.id * 0.618 % 1) * TAU : phase.get(segment.parentId) ?? 0;
      const arc0 = start ? 0 : arcAt.get(segment.parentId) ?? 0;
      const phase1 = phase0 + length * twist;
      phase.set(segment.id, phase1);
      arcAt.set(segment.id, arc0 + length);

      this.dir.copy(segment.a).sub(segment.b);
      if (length < 1e-4) continue;
      this.dir.divideScalar(length);
      this.u.crossVectors(this.dir, this.normal);
      if (this.u.lengthSq() < 1e-6) this.u.set(1, 0, 0).cross(this.dir);
      this.u.normalize();
      this.v.crossVectors(this.u, this.dir).normalize();

      for (let strand = 0; strand < STRANDS; strand++) {
        const offset = (strand / STRANDS) * TAU;
        for (let j = 0; j < sub; j++) {
          const t0 = j / sub;
          const t1 = (j + 1) / sub;
          this.ropePoint(segment, t0, phase0 + (phase1 - phase0) * t0 + offset, this.p0);
          this.ropePoint(segment, t1, phase0 + (phase1 - phase0) * t1 + offset, this.p1);
          this.placeCylinder(this.braid, n, this.p0, this.p1, strandRadius);
          const mid = phase0 + (phase1 - phase0) * (t0 + t1) / 2 + offset;
          // In front of the axis (toward the viewer) is bright, behind is dark.
          this.shade[n] = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(mid));
          this.arc[n] = arc0 + length * (t0 + t1) / 2;
          this.loads[n] = segment.load;
          this.segmentOf[n] = segment.id;
          n++;
        }
      }

      // Knots: where the twist completes a turn, and where a cord begins or ends.
      // One knot every other turn: often enough to read as knotted, sparse
      // enough that the braid between stays visible.
      const knotEvery = TAU * 2;
      const turns = Math.floor(phase1 / knotEvery) - Math.floor(phase0 / knotEvery);
      for (let turn = 1; turn <= turns; turn++) {
        const at = ((Math.floor(phase0 / knotEvery) + turn) * knotEvery - phase0) / Math.max(1e-6, phase1 - phase0);
        this.p0.copy(segment.b).lerp(segment.a, at);
        this.placeKnot(k++, this.p0, 1);
      }
      if (start) this.placeKnot(k++, segment.b, 1.35);
      if (!hasChild.has(segment.id)) this.placeKnot(k++, segment.a, 1.35);
    }
    this.braidCount = n;
    this.braid.count = n;
    this.knots.count = k;
    this.braid.instanceMatrix.needsUpdate = true;
    this.knots.instanceMatrix.needsUpdate = true;
  }

  private segmentOf = new Int32Array(0);

  private ropePoint(segment: CordSegment, t: number, angle: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(segment.b).lerp(segment.a, t);
    const r = this.radius;
    return out.addScaledVector(this.u, Math.cos(angle) * r).addScaledVector(this.v, Math.sin(angle) * r);
  }

  private placeCylinder(mesh: THREE.InstancedMesh, index: number, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    const d = this.axis.copy(b).sub(a);
    const length = d.length();
    this.dummy.position.copy(a).add(b).multiplyScalar(0.5);
    if (length > 1e-5) this.dummy.quaternion.setFromUnitVectors(UP, d.divideScalar(length));
    this.dummy.scale.set(radius, length * 1.15, radius);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private placeKnot(index: number, at: THREE.Vector3, size: number): void {
    if (index >= this.knots.instanceMatrix.count) return;
    this.dummy.position.copy(at);
    this.dummy.quaternion.setFromUnitVectors(UP, this.dir);
    const r = this.radius * 0.62 * size;
    this.dummy.scale.set(r, r * 0.8, r);
    this.dummy.updateMatrix();
    this.knots.setMatrixAt(index, this.dummy.matrix);
    this.colour.copy(this.palette.core).lerp(HOT, 0.35);
    this.knots.setColorAt(index, this.colour);
  }

  /**
   * Strands running full, as pulsing embers: shown while the cord tool is in
   * hand, because that is the question they answer.
   */
  setBottlenecks(points: readonly THREE.Vector3[], loads: readonly number[]): void {
    const pos = this.bottlenecks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.bottlenecks.geometry.getAttribute('color') as THREE.BufferAttribute;
    const count = Math.min(points.length, pos.count);
    for (let i = 0; i < count; i++) {
      const p = points[i]!;
      pos.setXYZ(i, p.x, p.y, p.z);
      this.colour.copy(CHOKE).lerp(CHOKE_HOT, Math.max(0, (loads[i] ?? 0) - BOTTLENECK_LOAD) * 10);
      col.setXYZ(i, this.colour.r, this.colour.g, this.colour.b);
    }
    this.bottleneckCount = count;
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.bottlenecks.geometry.setDrawRange(0, count);
  }

  /**
   * The cord an order would lay, as a line of light from where it starts:
   * bright for the strands the colony can pay for, red for the rest.
   * `affordable` counts route points (not segments) that will be laid.
   */
  setPreview(points: readonly THREE.Vector3[], affordable: number): void {
    this.previewPoints = points.map((p) => p.clone());
    this.previewAffordable = affordable;
    if (!points.length) this.preview.geometry.setDrawRange(0, 0);
  }

  /** Per frame: the shimmer along the ropes, the ember pulse, the marching preview. */
  update(time: number, reduced: boolean): void {
    if (this.braidCount > 0) {
      for (let i = 0; i < this.braidCount; i++) {
        const load = this.loads[i]!;
        const wave = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.arc[i]! * 1.3 - time * (1.5 + load * 7));
        this.colour.copy(this.palette.core).lerp(HOT, Math.min(1, load * 0.7 + wave * 0.35));
        this.colour.multiplyScalar(this.shade[i]! * (0.7 + wave * 0.5));
        this.braid.setColorAt(i, this.colour);
      }
      if (this.braid.instanceColor) this.braid.instanceColor.needsUpdate = true;
      if (this.knots.instanceColor) this.knots.instanceColor.needsUpdate = true;
    }

    const material = this.bottlenecks.material as THREE.PointsMaterial;
    material.size = 3.2 * (reduced ? 1 : 1 + 0.35 * Math.sin(time * 6));
    this.bottlenecks.visible = this.bottleneckCount > 0;

    this.writePreview(reduced ? 0 : time);
  }

  private writePreview(time: number): void {
    const points = this.previewPoints;
    if (points.length < 2) {
      this.preview.visible = false;
      return;
    }
    this.preview.visible = true;
    const pos = this.preview.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.preview.geometry.getAttribute('color') as THREE.BufferAttribute;
    // Dots every so often along the route, marching from where the drag began
    // toward where the cord will run to.
    const spacing = this.radius * 2.4;
    const drift = (time * 2.2) % spacing;
    let n = 0;
    let travelled = 0;
    let carry = drift;
    for (let i = 1; i < points.length && n < pos.count; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const length = a.distanceTo(b);
      const paid = i < this.previewAffordable;
      while (carry <= length && n < pos.count) {
        const t = length > 0 ? carry / length : 0;
        this.p0.copy(a).lerp(b, t);
        pos.setXYZ(n, this.p0.x, this.p0.y, this.p0.z);
        const pulse = 0.75 + 0.25 * Math.sin((travelled + carry) * 0.8 - time * 6);
        this.colour.copy(paid ? AFFORD : SHORT).multiplyScalar(paid ? pulse : 0.55);
        col.setXYZ(n, this.colour.r, this.colour.g, this.colour.b);
        n++;
        carry += spacing;
      }
      carry -= length;
      travelled += length;
    }
    // The last strand the colony can pay for gets a bright knot of its own.
    const cut = Math.min(this.previewAffordable, points.length) - 1;
    if (cut >= 0 && n < pos.count) {
      const p = points[cut]!;
      pos.setXYZ(n, p.x, p.y, p.z);
      this.colour.copy(this.previewAffordable >= points.length ? AFFORD : SHORT).multiplyScalar(1.6);
      col.setXYZ(n, this.colour.r, this.colour.g, this.colour.b);
      n++;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.preview.geometry.setDrawRange(0, n);
  }

  clear(): void {
    this.setCords([]);
    this.setBottlenecks([], []);
    this.setPreview([], 0);
  }

  dispose(): void {
    this.braid.geometry.dispose();
    (this.braid.material as THREE.Material).dispose();
    this.knots.geometry.dispose();
    (this.knots.material as THREE.Material).dispose();
    for (const points of [this.bottlenecks, this.preview]) {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    }
  }
}
