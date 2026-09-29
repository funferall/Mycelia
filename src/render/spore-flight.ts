import * as THREE from 'three';
import type { Vec3 } from '../sim/spatial';

/**
 * Spores in flight (`MAP-10`): a released cloud rising from the fruiting stand,
 * drifting downwind over the canopy and settling into the stand it founds.
 *
 * Presentation only. The founding already happened in the simulation at the
 * moment of release; the cloud shows the journey so the player sees where
 * their spores went. Each flight is a fixed set of particles on a seeded path,
 * pooled in one draw call.
 */

/** Seconds a cloud takes to cross from one stand to the next. */
const FLIGHT_SECONDS = 9;
/** Particles per cloud. */
const PER_FLIGHT = 220;
/** Clouds drawn at once; an older one gives up its slot. */
const MAX_FLIGHTS = 8;
const PLAYER = new THREE.Color('#ffe2a0');
const RIVAL = new THREE.Color('#d98a5e');

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  apex: number;
  age: number;
  colour: THREE.Color;
  /** Per-particle lag, lateral offset and phase, fixed at launch. */
  lag: Float32Array;
  side: Float32Array;
  lift: Float32Array;
}

export class SporeFlights {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly flights: Flight[] = [];
  private readonly toScene: (point: Vec3) => THREE.Vector3;
  private seed = 1;

  constructor(glow: THREE.Texture, toScene: (point: Vec3) => THREE.Vector3) {
    this.toScene = toScene;
    const count = PER_FLIGHT * MAX_FLIGHTS;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 7,
      map: glow,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    }));
    this.points.frustumCulled = false;
    this.points.name = 'spore-flights';
    this.group.add(this.points);
  }

  /** How many clouds are in the air. */
  get active(): number {
    return this.flights.length;
  }

  /** Launch a cloud between two ground points (regional coordinates). */
  launch(from: Vec3, to: Vec3, owner: 'player' | 'rival' = 'player'): void {
    const a = this.toScene(from);
    const b = this.toScene(to);
    const distance = a.distanceTo(b);
    const random = () => {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    };
    const lag = new Float32Array(PER_FLIGHT);
    const side = new Float32Array(PER_FLIGHT * 2);
    const lift = new Float32Array(PER_FLIGHT);
    for (let i = 0; i < PER_FLIGHT; i++) {
      lag[i] = random() * 0.28;
      side[i * 2] = (random() - 0.5) * 2;
      side[i * 2 + 1] = (random() - 0.5) * 2;
      lift[i] = random();
    }
    if (this.flights.length >= MAX_FLIGHTS) this.flights.shift();
    this.flights.push({
      from: a,
      to: b,
      apex: 34 + distance * 0.12,
      age: 0,
      colour: owner === 'player' ? PLAYER : RIVAL,
      lag,
      side,
      lift,
    });
  }

  /** Advance every cloud; `visible` follows the forest view. */
  update(dt: number, visible: boolean): void {
    this.group.visible = visible && this.flights.length > 0;
    for (const flight of this.flights) flight.age += dt;
    while (this.flights.length > 0 && this.flights[0]!.age > FLIGHT_SECONDS * 1.4) this.flights.shift();
    if (!this.group.visible) return;
    const position = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colour = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const across = new THREE.Vector3();
    const point = new THREE.Vector3();
    let n = 0;
    for (const flight of this.flights) {
      across.subVectors(flight.to, flight.from).setY(0);
      const along = across.length() || 1;
      across.set(-across.z / along, 0, across.x / along);
      for (let i = 0; i < PER_FLIGHT; i++) {
        const t = Math.min(1, Math.max(0, flight.age / FLIGHT_SECONDS - flight.lag[i]!));
        const eased = t * t * (3 - 2 * t);
        point.lerpVectors(flight.from, flight.to, eased);
        // Rise off the stalk, ride over the canopy, settle into the new stand.
        point.y += Math.sin(Math.PI * t) * flight.apex * (0.75 + 0.5 * flight.lift[i]!);
        // The cloud spreads in the air and gathers again as it lands.
        const spread = Math.sin(Math.PI * t) * 14 + 1.5;
        point.addScaledVector(across, flight.side[i * 2]! * spread);
        point.y += flight.side[i * 2 + 1]! * spread * 0.4;
        position.setXYZ(n, point.x, point.y, point.z);
        // Bright in the air, fading as the spores settle into the ground.
        const glow = t <= 0 ? 0 : t >= 1 ? Math.max(0, 1 - (flight.age / FLIGHT_SECONDS - 1) * 2.5) : 0.6 + 0.4 * Math.sin(Math.PI * t);
        colour.setXYZ(n, flight.colour.r * glow, flight.colour.g * glow, flight.colour.b * glow);
        n++;
      }
    }
    this.points.geometry.setDrawRange(0, n);
    position.needsUpdate = true;
    colour.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
