import * as THREE from 'three';
import { makeGlowTexture } from './textures';

/**
 * Presentation of the drought above ground: dust lifted off the baked soil,
 * drifting on the ambient wind, and a few dust devils wandering the dry land.
 * The ground itself (cracks, bleached soil, wilting crowns, the shrunken
 * stream) is drawn by `FLOOR_DROUGHT`, the scenery shaders and the stream view.
 *
 * Cosmetic only; one draw call (a point cloud). Reduced motion stills the dust
 * and removes the devils.
 */

type ToScene = (x: number, y: number) => THREE.Vector3;

const MOTES = [460, 140] as const;
const DEVILS = 3;
const DEVIL_POINTS = [110, 40] as const;

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

interface Mote { x: number; y: number; h: number; phase: number }
interface Devil { x: number; y: number; heading: number; phase: number }

export class DroughtView {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly motes: Mote[] = [];
  private readonly devils: Devil[] = [];
  private readonly perDevil: number;
  private readonly rand = seeded(0xd057);
  private time = 0;
  private level = 0;

  constructor(private readonly width: number, private readonly depth: number, private readonly toScene: ToScene, fast: boolean) {
    this.group.name = 'drought';
    this.group.visible = false;
    const q = fast ? 1 : 0;
    for (let i = 0; i < MOTES[q]; i++) {
      this.motes.push({ x: this.rand() * width, y: this.rand() * depth, h: 0.3 + this.rand() * 5, phase: this.rand() * 6.28 });
    }
    this.perDevil = DEVIL_POINTS[q];
    for (let d = 0; d < DEVILS; d++) {
      this.devils.push({ x: (0.2 + 0.6 * this.rand()) * width, y: (0.2 + 0.6 * this.rand()) * depth, heading: this.rand() * 6.28, phase: this.rand() * 6.28 });
    }
    const count = this.motes.length + DEVILS * this.perDevil;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 1.4, map: makeGlowTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0,
    }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  update(dt: number, state: { intensity: number; wind: { direction: number; strength: number } }, reduced: boolean, blend: number): void {
    this.level += (state.intensity - this.level) * Math.min(1, dt * 0.8);
    const above = THREE.MathUtils.smoothstep(blend, 0.2, 0.9);
    this.group.visible = this.level > 0.02 && above > 0.01;
    if (!this.group.visible) return;
    const step = reduced ? 0 : Math.min(Math.max(dt, 0), 0.1);
    this.time += step;
    (this.points.material as THREE.PointsMaterial).opacity = 0.55 * this.level * above;
    const wx = Math.cos(state.wind.direction), wy = Math.sin(state.wind.direction);
    const drift = 1.5 + 2.5 * state.wind.strength;
    const dust = [0.78, 0.68, 0.5];
    let i = 0;
    for (const m of this.motes) {
      m.x = (m.x + wx * drift * step + this.width) % this.width;
      m.y = (m.y + wy * drift * step + this.depth) % this.depth;
      const ground = this.toScene(m.x, m.y);
      this.positions.set([ground.x, ground.y + m.h + Math.sin(this.time * 0.7 + m.phase) * 0.6, ground.z], i * 3);
      const k = 0.5 + 0.5 * Math.sin(this.time * 0.4 + m.phase);
      this.colors.set([dust[0]! * k, dust[1]! * k, dust[2]! * k], i * 3);
      i++;
    }
    // Dust devils: spinning funnels that widen with height and wander the dry land.
    for (const d of this.devils) {
      if (!reduced) {
        d.heading += Math.sin(this.time * 0.3 + d.phase) * step * 0.6;
        d.x = Math.min(this.width * 0.9, Math.max(this.width * 0.1, d.x + Math.cos(d.heading) * 3 * step));
        d.y = Math.min(this.depth * 0.9, Math.max(this.depth * 0.1, d.y + Math.sin(d.heading) * 3 * step));
        if (d.x <= this.width * 0.1 || d.x >= this.width * 0.9 || d.y <= this.depth * 0.1 || d.y >= this.depth * 0.9) d.heading += Math.PI * 0.5;
      }
      const base = this.toScene(d.x, d.y);
      const strength = reduced ? 0 : Math.max(0, this.level - 0.35) / 0.65;
      for (let p = 0; p < this.perDevil; p++) {
        const u = p / this.perDevil;
        const h = u * 18;
        const r = 0.8 + u * u * 6;
        const a = this.time * (5 - 3 * u) + p * 2.39 + d.phase;
        this.positions.set([base.x + Math.cos(a) * r, base.y + h, base.z + Math.sin(a) * r], i * 3);
        const k = strength * (1 - u * 0.7);
        this.colors.set([dust[0]! * k, dust[1]! * k, dust[2]! * k], i * 3);
        i++;
      }
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
  }

  report(): { visible: boolean; points: number; devils: number } {
    return { visible: this.group.visible, points: this.motes.length + DEVILS * this.perDevil, devils: DEVILS };
  }

  dispose(): void {
    this.points.geometry.dispose();
    const material = this.points.material as THREE.PointsMaterial;
    material.map?.dispose();
    material.dispose();
    this.group.clear();
  }
}
