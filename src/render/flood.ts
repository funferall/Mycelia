import * as THREE from 'three';
import { makeGlowTexture } from './textures';

/**
 * Presentation of the flood above ground: leaf litter, twigs and foam carried
 * downstream along the stream's own course, spread across the width the water
 * has reached. The water itself is drawn by `FLOOR_FLOOD` and the swollen
 * stream ribbon; what it drowned is simulation state.
 *
 * One draw (a point cloud); reduced motion holds the debris still.
 */

type ToScene = (x: number, y: number) => THREE.Vector3;

const DEBRIS = [300, 100] as const;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Drift { along: number; across: number; speed: number; foam: boolean; phase: number }

export class FloodView {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly drift: Drift[] = [];
  private readonly lengths: number[] = [0];
  private readonly total: number;
  private readonly rand = seeded(0xf100d);
  private time = 0;

  constructor(private readonly course: Array<{ x: number; y: number }>, private readonly toScene: ToScene, fast: boolean) {
    this.group.name = 'flood';
    this.group.visible = false;
    for (let i = 1; i < course.length; i++) {
      this.lengths.push(this.lengths[i - 1]! + Math.hypot(course[i]!.x - course[i - 1]!.x, course[i]!.y - course[i - 1]!.y));
    }
    this.total = this.lengths[this.lengths.length - 1] ?? 0;
    const count = course.length > 1 ? DEBRIS[fast ? 1 : 0] : 0;
    for (let i = 0; i < count; i++) {
      this.drift.push({ along: this.rand() * this.total, across: this.rand() * 2 - 1, speed: 0.7 + this.rand() * 0.6, foam: this.rand() < 0.35, phase: this.rand() * 6.28 });
    }
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.9, map: makeGlowTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** `reach`: distance from the course the water covers now, region units. */
  update(dt: number, level: number, reach: number, reduced: boolean, blend: number): void {
    const above = THREE.MathUtils.smoothstep(blend, 0.2, 0.9);
    this.group.visible = level > 0.02 && above > 0.01 && this.drift.length > 0;
    if (!this.group.visible) return;
    const step = reduced ? 0 : Math.min(Math.max(dt, 0), 0.1);
    this.time += step;
    (this.points.material as THREE.PointsMaterial).opacity = Math.min(1, level * 1.4) * above;
    let segment = 0;
    const order = this.drift.map((_, i) => i).sort((a, b) => this.drift[a]!.along - this.drift[b]!.along);
    for (const i of order) {
      const d = this.drift[i]!;
      // Faster in the middle of the current than at its edges.
      d.along = (d.along + step * (5 + 9 * level) * d.speed * (1 - 0.5 * Math.abs(d.across))) % this.total;
      while (segment > 0 && this.lengths[segment]! > d.along) segment--;
      while (segment < this.lengths.length - 2 && this.lengths[segment + 1]! < d.along) segment++;
      const a = this.course[segment]!, b = this.course[segment + 1] ?? a;
      const span = Math.max(1e-6, this.lengths[segment + 1]! - this.lengths[segment]!);
      const k = Math.min(1, Math.max(0, (d.along - this.lengths[segment]!) / span));
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      const sway = Math.sin(this.time * 0.8 + d.phase) * 0.08;
      const off = (d.across + sway) * reach * 0.85;
      const x = a.x + tx * k - (ty / tl) * off;
      const y = a.y + ty * k + (tx / tl) * off;
      const p = this.toScene(x, y);
      this.positions.set([p.x, p.y + 0.35, p.z], i * 3);
      const shade = 0.75 + 0.25 * Math.sin(this.time * 2 + d.phase);
      this.colors.set(d.foam ? [0.62 * shade, 0.62 * shade, 0.57 * shade] : [0.2 * shade, 0.14 * shade, 0.07 * shade], i * 3);
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
  }

  report(): { visible: boolean; debris: number } {
    return { visible: this.group.visible, debris: this.drift.length };
  }
}
