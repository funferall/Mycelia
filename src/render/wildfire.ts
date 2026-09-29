import * as THREE from 'three';
import { makeGlowTexture } from './textures';

/**
 * Presentation of the wildfire: a wall of flame along the front, embers and
 * smoke carried the way it runs, and (through `FLOOR_FIRE` and the dressing
 * shaders) char and glowing ground behind it.
 *
 * Cosmetic only: the simulation owns the front and decides what burned. This
 * view reads the front each frame and draws it in regional coordinates through
 * `toScene`, so a stand change moves nothing here. Three draws: flames, smoke
 * and embers. Reduced motion keeps the flames and smoke still and drops the
 * embers.
 */

export interface FireVisual {
  phase: 'idle' | 'warning' | 'burning' | 'aftermath';
  /** Regional radians the front travels toward. */
  direction: number;
  /** Leading edge as a projection on the direction, region units. */
  front: number;
  /** Where the front starts, so the warning's smoke rises beyond the region. */
  start: number;
  band: number;
  intensity: number;
  /** A hurricane carries a second ember front across the entire region. */
  spot?: { direction: number; front: number; start: number } | null;
  /** Trees actually torched by the simulation in the last few seconds. */
  torches?: ReadonlyArray<{ x: number; y: number; z: number; height: number; age: number }>;
}

type ToScene = (x: number, y: number) => THREE.Vector3;

const FLAMES = [260, 90] as const;
const SMOKE = [80, 30] as const;
const EMBERS = [520, 160] as const;

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

/** Cylindrical billboards: each instance stands upright facing the camera. */
const BILLBOARD_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aLife;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLife;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vLife = aLife;
    vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float width = length(instanceMatrix[0].xyz);
    float height = length(instanceMatrix[1].xyz);
    vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
    vec3 world = centre + right * position.x * width + vec3(0.0, 1.0, 0.0) * position.y * height;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const NOISE = /* glsl */ `
  float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
  }
`;

const FLAME_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLife;
  ${NOISE}
  void main() {
    // Several rising tongues share a broad orange base and a narrow hot core.
    vec2 p = vec2(vUv.x - 0.5, vUv.y);
    float flow = fNoise(vec2(p.x * 4.5 + vSeed * 19.0, p.y * 3.5 - uTime * 2.2));
    float detail = fNoise(vec2(p.x * 12.0 - vSeed * 9.0, p.y * 8.0 - uTime * 4.6));
    float wavering = (flow - 0.5) * 0.22 * p.y + (detail - 0.5) * 0.06;
    float width = (0.47 - 0.38 * p.y) * (0.75 + 0.45 * flow);
    float edge = abs(p.x - wavering);
    float body = 1.0 - smoothstep(width * 0.62, width, edge);
    float tip = 1.0 - smoothstep(0.58 + 0.34 * flow, 0.98, p.y);
    float flame = body * tip * smoothstep(0.0, 0.04, p.y);
    float core = (1.0 - smoothstep(width * 0.12, width * 0.52, edge)) * (1.0 - smoothstep(0.08, 0.6, p.y));
    vec3 col = mix(vec3(0.68, 0.075, 0.018), vec3(1.0, 0.35, 0.045), clamp(flame * 1.3, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.9, 0.52), core * 0.9);
    gl_FragColor = vec4(col, flame * (0.38 + 0.32 * core) * uAlpha * vLife);
  }
`;

const SMOKE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLife;
  ${NOISE}
  void main() {
    vec2 p = vUv - vec2(0.5, 0.45);
    float large = fNoise(p * 3.4 + vec2(vSeed * 13.0, -uTime * 0.22));
    float small = fNoise(p * 8.0 + vec2(-vSeed * 6.0, -uTime * 0.37));
    float billow = large * 0.7 + small * 0.3;
    float shape = length(p * vec2(0.95, 1.1)) + (billow - 0.5) * 0.28;
    float cloud = 1.0 - smoothstep(0.23, 0.49, shape);
    float light = (1.0 - smoothstep(0.05, 0.55, vLife)) * (1.0 - vUv.y);
    vec3 col = mix(vec3(0.075, 0.078, 0.076), vec3(0.19, 0.19, 0.18), billow);
    col += vec3(0.28, 0.085, 0.015) * light;
    float fade = smoothstep(0.0, 0.16, vLife) * (1.0 - smoothstep(0.72, 1.0, vLife));
    gl_FragColor = vec4(col, cloud * (0.34 + 0.3 * billow) * uAlpha * fade);
  }
`;

interface Puff { x: number; y: number; z: number; age: number; life: number; seed: number; windX: number; windY: number }

export class FireView {
  readonly group = new THREE.Group();
  private readonly flames: THREE.InstancedMesh;
  private readonly smoke: THREE.InstancedMesh;
  private readonly embers: THREE.Points;
  private readonly flameSeeds: Array<{ along: number; depth: number; size: number; phase: number }> = [];
  private readonly flameLife: THREE.InstancedBufferAttribute;
  private readonly puffs: Puff[] = [];
  private readonly sparks: Puff[] = [];
  private readonly flameUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 } };
  private readonly smokeUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 } };
  private readonly emberPositions: Float32Array;
  private readonly emberColors: Float32Array;
  private readonly rand = seeded(0xf17e);
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly identity = new THREE.Quaternion();
  private time = 0;
  private level = 0;
  private phase: FireVisual['phase'] = 'idle';

  constructor(private readonly width: number, private readonly depth: number, private readonly toScene: ToScene, fast: boolean) {
    this.group.name = 'wildfire';
    this.group.visible = false;
    const q = fast ? 1 : 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);

    const flameCount = FLAMES[q];
    const flameGeometry = quad.clone();
    const flameSeed = new Float32Array(flameCount);
    const flameLife = new Float32Array(flameCount).fill(1);
    for (let i = 0; i < flameCount; i++) {
      flameSeed[i] = this.rand();
      this.flameSeeds.push({ along: (i + this.rand()) / flameCount, depth: Math.pow(this.rand(), 1.6), size: 0.6 + this.rand() * 0.8, phase: this.rand() * 6.28 });
    }
    flameGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(flameSeed, 1));
    this.flameLife = new THREE.InstancedBufferAttribute(flameLife, 1).setUsage(THREE.DynamicDrawUsage);
    flameGeometry.setAttribute('aLife', this.flameLife);
    this.flames = new THREE.InstancedMesh(flameGeometry, new THREE.ShaderMaterial({
      uniforms: this.flameUniforms, vertexShader: BILLBOARD_VERTEX, fragmentShader: FLAME_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }), flameCount);

    const smokeCount = SMOKE[q];
    const smokeGeometry = quad.clone();
    const smokeSeed = new Float32Array(smokeCount);
    for (let i = 0; i < smokeCount; i++) {
      smokeSeed[i] = this.rand();
      this.puffs.push({ x: 0, y: 0, z: 0, age: 99, life: 8 + this.rand() * 5, seed: smokeSeed[i]!, windX: 1, windY: 0 });
    }
    smokeGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(smokeSeed, 1));
    smokeGeometry.setAttribute('aLife', new THREE.InstancedBufferAttribute(new Float32Array(smokeCount), 1).setUsage(THREE.DynamicDrawUsage));
    this.smoke = new THREE.InstancedMesh(smokeGeometry, new THREE.ShaderMaterial({
      uniforms: this.smokeUniforms, vertexShader: BILLBOARD_VERTEX, fragmentShader: SMOKE_FRAGMENT,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }), smokeCount);

    const emberCount = EMBERS[q];
    this.emberPositions = new Float32Array(emberCount * 3);
    this.emberColors = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) this.sparks.push({ x: 0, y: 0, z: 0, age: this.rand() * 3, life: 1.5 + this.rand() * 2.5, seed: this.rand(), windX: 1, windY: 0 });
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(this.emberPositions, 3).setUsage(THREE.DynamicDrawUsage));
    emberGeometry.setAttribute('color', new THREE.BufferAttribute(this.emberColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({
      size: 1.1, map: makeGlowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));

    this.smoke.renderOrder = 6;
    this.flames.renderOrder = 7;
    this.embers.renderOrder = 8;
    for (const object of [this.flames, this.smoke, this.embers]) {
      object.frustumCulled = false;
      this.group.add(object);
    }
  }

  /** 0..1 heat for the stage lights: the orange of a nearby fire. */
  get glow(): number {
    return this.group.visible ? this.level : 0;
  }

  update(dt: number, state: FireVisual, reduced: boolean, blend: number): void {
    this.phase = state.phase;
    const target = state.phase === 'idle' ? 0 : state.intensity;
    this.level += (target - this.level) * Math.min(1, dt * 1.5);
    this.group.visible = state.phase !== 'idle' || this.level > 0.01;
    if (!this.group.visible) return;
    const step = reduced ? 0 : Math.min(Math.max(dt, 0), 0.1);
    this.time += step;
    this.flameUniforms.uTime.value = this.time;
    this.smokeUniforms.uTime.value = this.time;
    // The ground and flames belong to the forest view; smoke is seen from above either way.
    const above = THREE.MathUtils.smoothstep(blend, 0.2, 0.9);
    const burning = state.phase === 'burning';
    this.flameUniforms.uAlpha.value = burning ? above : 0;
    this.flames.visible = burning && above > 0.01;
    this.smokeUniforms.uAlpha.value = (0.4 + 0.35 * this.level) * (0.4 + 0.6 * above);
    this.embers.visible = burning && !reduced && above > 0.01;

    const c = Math.cos(state.direction);
    const s = Math.sin(state.direction);
    // Across-front coordinate spans the region at any heading.
    const q = [[0, 0], [this.width, 0], [0, this.depth], [this.width, this.depth]].map(([x, y]) => -x! * s + y! * c);
    const qMin = Math.min(...q);
    const qMax = Math.max(...q);
    const at = (p: number, across: number) => ({ x: c * p - s * across, y: s * p + c * across });
    const spot = state.spot;
    const sc = Math.cos(spot?.direction ?? state.direction), ss = Math.sin(spot?.direction ?? state.direction);
    const spotQ = [[0, 0], [this.width, 0], [0, this.depth], [this.width, this.depth]].map(([x, y]) => -x! * ss + y! * sc);
    const spotMin = Math.min(...spotQ), spotMax = Math.max(...spotQ);
    const spotAt = (p: number, across: number) => ({ x: sc * p - ss * across, y: ss * p + sc * across });
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= this.width && y <= this.depth;

    // Flames: a band of tongues behind the leading edge, clipped to the region.
    if (this.flames.visible) {
      const torches = state.torches ?? [];
      for (let i = 0; i < this.flameSeeds.length; i++) {
        const f = this.flameSeeds[i]!;
        const flicker = 0.75 + 0.25 * Math.sin(this.time * 7 + f.phase) + 0.12 * Math.sin(this.time * 13.7 + f.phase * 2);
        const torch = torches[i];
        let h: number;
        if (torch) {
          this.position.set(torch.x, torch.y, torch.z);
          h = torch.height * (0.55 + f.size * 0.4) * flicker;
          this.flameLife.setX(i, Math.max(0, 1 - torch.age / 12));
        } else {
          const second = spot && i >= this.flameSeeds.length / 2;
          const r = second
            ? spotAt(spot.front - f.depth * state.band * 0.9, spotMin + f.along * (spotMax - spotMin))
            : at(state.front - f.depth * state.band * 0.9, qMin + f.along * (qMax - qMin));
          this.position.copy(this.toScene(r.x, r.y));
          h = inside(r.x, r.y) ? (3 + 7 * (1 - f.depth)) * f.size * flicker * state.intensity : 0;
          this.flameLife.setX(i, 1);
        }
        this.matrix.compose(this.position, this.identity, this.scale.set(h * 0.48, h, 1));
        this.flames.setMatrixAt(i, this.matrix);
      }
      this.flameLife.needsUpdate = true;
      this.flames.instanceMatrix.needsUpdate = true;
    }

    // Smoke: from the flaming band while burning; a column on the horizon in the
    // warning; thin wisps off the smouldering char through the aftermath.
    const life = this.smoke.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i]!;
      puff.age += step;
      if (puff.age >= puff.life) {
        puff.age = 0;
        const second = spot && state.phase === 'burning' && this.rand() < 0.5;
        const across = second ? spotMin + this.rand() * (spotMax - spotMin) : qMin + this.rand() * (qMax - qMin);
        const p = state.phase === 'warning'
          ? state.start - 6 - this.rand() * 18
          : state.phase === 'burning' ? (second ? spot!.front : state.front) - this.rand() * state.band
            : state.front - this.rand() * (state.front - state.start);
        const r = state.phase === 'warning' ? at(p, (qMin + qMax) / 2 + (this.rand() - 0.5) * (qMax - qMin) * 0.7)
          : second ? spotAt(p, across) : at(p, across);
        const ground = this.toScene(r.x, r.y);
        puff.x = ground.x; puff.y = ground.y + 2; puff.z = ground.z;
        puff.windX = second ? sc : c; puff.windY = second ? ss : s;
        puff.life = (state.phase === 'aftermath' ? 5 : 8) + this.rand() * 5;
      }
      const k = puff.age / puff.life;
      const rise = state.phase === 'aftermath' ? 2.5 : 6;
      const drift = 3 + 4 * k;
      const ox = puff.windX * drift * puff.age;
      const oz = -puff.windY * drift * puff.age;
      const size = (state.phase === 'aftermath' ? 5 : 12) + k * (state.phase === 'aftermath' ? 12 : 50);
      this.position.set(puff.x + ox, puff.y + rise * puff.age, puff.z + oz);
      this.matrix.compose(this.position, this.identity, this.scale.set(size, size, 1));
      this.smoke.setMatrixAt(i, this.matrix);
      life.setX(i, state.phase === 'idle' ? 0 : k);
    }
    life.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;

    // Embers: short, bright, spiralling up and downwind.
    if (this.embers.visible) {
      for (let i = 0; i < this.sparks.length; i++) {
        const e = this.sparks[i]!;
        e.age += step;
        if (e.age >= e.life) {
          e.age = 0;
          const second = spot && this.rand() < 0.5;
          const r = second
            ? spotAt(spot.front - this.rand() * state.band, spotMin + this.rand() * (spotMax - spotMin))
            : at(state.front - this.rand() * state.band, qMin + this.rand() * (qMax - qMin));
          if (!inside(r.x, r.y)) { e.life = 0.3; continue; }
          const ground = this.toScene(r.x, r.y);
          e.x = ground.x; e.y = ground.y + 1 + this.rand() * 3; e.z = ground.z;
          e.windX = second ? sc : c; e.windY = second ? ss : s;
          e.life = 1.5 + this.rand() * 2.5;
        }
        const k = e.age / e.life;
        const swirl = Math.sin(this.time * 3 + e.seed * 20) * 1.5;
        this.emberPositions[i * 3] = e.x + e.windX * 6 * e.age + -e.windY * swirl;
        this.emberPositions[i * 3 + 1] = e.y + (5 + 4 * e.seed) * e.age;
        this.emberPositions[i * 3 + 2] = e.z - e.windY * 6 * e.age + -e.windX * swirl;
        const glow = (1 - k) * (0.6 + 0.4 * Math.sin(this.time * 20 + e.seed * 50));
        this.emberColors.set([glow, glow * 0.42, glow * 0.08], i * 3);
      }
      this.embers.geometry.attributes.position!.needsUpdate = true;
      this.embers.geometry.attributes.color!.needsUpdate = true;
    }
  }

  report(): { phase: string; flames: boolean; smoke: number; embers: boolean; draws: number; glow: number } {
    const draws = this.group.visible ? [this.flames, this.smoke, this.embers].filter((o) => o.visible).length : 0;
    return { phase: this.phase, flames: this.group.visible && this.flames.visible, smoke: this.puffs.length, embers: this.group.visible && this.embers.visible, draws, glow: this.glow };
  }

  dispose(): void {
    for (const object of [this.flames, this.smoke, this.embers]) {
      object.geometry.dispose();
      const material = object.material as THREE.Material & { map?: THREE.Texture | null };
      material.map?.dispose();
      material.dispose();
    }
    this.group.clear();
  }
}
