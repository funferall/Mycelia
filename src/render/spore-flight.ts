import * as THREE from 'three';
import type { Vec3 } from '../sim/spatial';

/**
 * Spores in flight (`MAP-10`): a released cloud rising from the fruiting stand,
 * drifting downwind over the canopy and settling into the stand it founds.
 *
 * Two layers, both seen from the forest view: a slight haze (a few large, faint
 * glow puffs that travel and breathe with the cloud) and the spores themselves
 * as sparkling dots, each twinkling on its own rhythm.
 *
 * Presentation only. The founding already happened in the simulation at the
 * moment of release; the cloud shows the journey so the player sees where
 * their spores went. Each flight is a fixed set of particles on a seeded path,
 * pooled in one draw call; the haze is a handful of sprites per cloud.
 */

/** Seconds a cloud takes to cross from one stand to the next. */
const FLIGHT_SECONDS = 9;
/** Sparkling spores per cloud. */
const PER_FLIGHT = 260;
/** Haze puffs per cloud. */
const HAZE_PER_FLIGHT = 6;
/** Clouds drawn at once; an older one gives up its slot. */
const MAX_FLIGHTS = 8;
const PLAYER = new THREE.Color('#ffe7b0');
const PLAYER_HAZE = new THREE.Color('#f3d9a0');
const RIVAL = new THREE.Color('#d98a5e');
const RIVAL_HAZE = new THREE.Color('#b8704a');

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  apex: number;
  age: number;
  colour: THREE.Color;
  /** Per-particle lag, lateral offset, lift, and twinkle rate and phase, fixed at launch. */
  lag: Float32Array;
  side: Float32Array;
  lift: Float32Array;
  twinkle: Float32Array;
  haze: THREE.Sprite[];
}

export class SporeFlights {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly flights: Flight[] = [];
  private readonly toScene: (point: Vec3) => THREE.Vector3;
  private readonly glow: THREE.Texture;
  private seed = 1;
  private clock = 0;

  constructor(glow: THREE.Texture, toScene: (point: Vec3) => THREE.Vector3) {
    this.toScene = toScene;
    this.glow = glow;
    const count = PER_FLIGHT * MAX_FLIGHTS;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 5,
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
    this.points.renderOrder = 3;
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
    const twinkle = new Float32Array(PER_FLIGHT * 2);
    for (let i = 0; i < PER_FLIGHT; i++) {
      lag[i] = random() * 0.28;
      side[i * 2] = (random() - 0.5) * 2;
      side[i * 2 + 1] = (random() - 0.5) * 2;
      lift[i] = random();
      twinkle[i * 2] = 2.5 + random() * 6;
      twinkle[i * 2 + 1] = random() * Math.PI * 2;
    }
    const haze: THREE.Sprite[] = [];
    for (let h = 0; h < HAZE_PER_FLIGHT; h++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glow,
        color: owner === 'player' ? PLAYER_HAZE : RIVAL_HAZE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }));
      sprite.userData.offset = new THREE.Vector3((random() - 0.5) * 22, (random() - 0.5) * 8, (random() - 0.5) * 22);
      sprite.userData.size = 26 + random() * 18;
      sprite.userData.phase = random() * Math.PI * 2;
      sprite.renderOrder = 2;
      sprite.raycast = () => {};
      this.group.add(sprite);
      haze.push(sprite);
    }
    if (this.flights.length >= MAX_FLIGHTS) this.retire(this.flights.shift()!);
    this.flights.push({
      from: a,
      to: b,
      apex: 34 + distance * 0.12,
      age: 0,
      colour: owner === 'player' ? PLAYER : RIVAL,
      lag,
      side,
      lift,
      twinkle,
      haze,
    });
  }

  /** Advance every cloud; `visible` follows the forest view. */
  update(dt: number, visible: boolean): void {
    this.clock += dt;
    this.group.visible = visible && this.flights.length > 0;
    for (const flight of this.flights) flight.age += dt;
    while (this.flights.length > 0 && this.flights[0]!.age > FLIGHT_SECONDS * 1.5) this.retire(this.flights.shift()!);
    if (!this.group.visible) return;
    const position = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colour = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const across = new THREE.Vector3();
    const point = new THREE.Vector3();
    const centre = new THREE.Vector3();
    let n = 0;
    for (const flight of this.flights) {
      across.subVectors(flight.to, flight.from).setY(0);
      const along = across.length() || 1;
      across.set(-across.z / along, 0, across.x / along);
      // The cloud as a whole: where its middle is, and how thick it is now.
      const whole = Math.min(1, Math.max(0, flight.age / FLIGHT_SECONDS - 0.14));
      const wholeEased = whole * whole * (3 - 2 * whole);
      centre.lerpVectors(flight.from, flight.to, wholeEased);
      centre.y += Math.sin(Math.PI * whole) * flight.apex * 0.95;
      const settle = flight.age > FLIGHT_SECONDS ? Math.max(0, 1 - (flight.age / FLIGHT_SECONDS - 1) * 2) : 1;
      const rise = Math.min(1, flight.age / 1.2);
      const thickness = rise * settle * (0.55 + 0.45 * Math.sin(Math.PI * whole));
      for (const sprite of flight.haze) {
        const offset = sprite.userData.offset as THREE.Vector3;
        const breathe = 1 + 0.12 * Math.sin(this.clock * 0.9 + (sprite.userData.phase as number));
        const spread = 0.4 + 0.9 * Math.sin(Math.PI * whole);
        sprite.position.copy(centre).addScaledVector(offset, spread);
        const size = (sprite.userData.size as number) * spread * breathe;
        sprite.scale.set(size, size * 0.62, 1);
        (sprite.material as THREE.SpriteMaterial).opacity = 0.075 * thickness;
      }
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
        // Each spore sparkles on its own rhythm: mostly a dim mote, now and
        // then a bright glint. Brightest in the air, fading as it settles.
        const air = t <= 0 ? 0 : t >= 1 ? Math.max(0, 1 - (flight.age / FLIGHT_SECONDS - 1) * 2.5) : 0.55 + 0.45 * Math.sin(Math.PI * t);
        const wave = Math.max(0, Math.sin(this.clock * flight.twinkle[i * 2]! + flight.twinkle[i * 2 + 1]!));
        const glint = 0.28 + 1.1 * wave * wave * wave;
        const glow = air * glint;
        colour.setXYZ(n, flight.colour.r * glow, flight.colour.g * glow, flight.colour.b * glow);
        n++;
      }
    }
    this.points.geometry.setDrawRange(0, n);
    position.needsUpdate = true;
    colour.needsUpdate = true;
  }

  private retire(flight: Flight): void {
    for (const sprite of flight.haze) {
      this.group.remove(sprite);
      sprite.material.dispose();
    }
  }

  dispose(): void {
    for (const flight of this.flights) this.retire(flight);
    this.flights.length = 0;
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
