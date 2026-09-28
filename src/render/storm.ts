import * as THREE from 'three';

/**
 * Presentation of the summoned storm: a slate front and low cloud bands that
 * arrive from upwind, a cloud vortex turning over the summoning colony, heavy
 * slanted rain, lightning, and amber spore trails that all travel the same
 * downwind way.
 *
 * Everything here is cosmetic. The simulation owns the lifecycle, direction and
 * intensity; this view reads a snapshot of them and never writes anything back.
 * Six draw calls at most (cloud bands, vortex, front veil, rain, spores, bolt).
 * Every particle is a two-vertex line animated in the vertex shader from a
 * handful of uniforms; the bolt is one preallocated buffer rewritten per strike.
 * Lightning is the one sudden change: strikes are spaced so the scene never
 * flashes more than about twice a second, and reduced motion has none.
 */

export interface StormVisual {
  phase: 'idle' | 'warning' | 'active' | 'recovery';
  /** Regional radians, 0 = +x, pi/2 = +y. Regional +y is scene -z. */
  direction: number;
  /** Seconds left in the current phase. */
  remaining: number;
  intensity: number;
}

const RAIN_NORMAL = 2600;
const SPORE_NORMAL = 380;
const RAIN_FAST = 700;
const SPORE_FAST = 110;
/** Segments one bolt may use, trunk and forks together. */
const BOLT_SEGMENTS = 96;
/**
 * Seconds between strikes while the storm is active. Two pulses per strike and
 * never less than this gap keeps flashing well under three per second.
 */
const STRIKE_GAP = [1.6, 4.8] as const;

const BAND_COUNT = 7;
/** Height of the rain volume; the cloud bands sit in its upper half. */
const SKY = 32;
/** Peak horizontal wind and rain fall speed, metres per second. */
const WIND_SPEED = 18;
const FALL_SPEED = 26;
/** Streak length as seconds of travel. */
const STREAK = 0.1;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

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

const NOISE_GLSL = /* glsl */ `
  float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x),
               mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float sFbm(vec2 p) {
    return sNoise(p) * 0.55 + sNoise(p * 2.03 + 7.1) * 0.3 + sNoise(p * 4.1 + 3.7) * 0.15;
  }
`;

type Uniforms = Record<string, THREE.IUniform>;

/** Line-segment particles: attribute `position` is a unit-cube base, `aData` is rank, jitter, end, phase. */
function particleGeometry(count: number, seed: number, yMin: number, ySpan: number): THREE.BufferGeometry {
  const rand = seeded(seed);
  const position = new Float32Array(count * 6);
  const data = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    const x = rand();
    const y = yMin + rand() * ySpan;
    const z = rand();
    const jitter = 0.88 + rand() * 0.24;
    const phase = rand();
    // Rank is stratified so any prefix of the density range is evenly spread.
    const rank = (i + 0.5) / count;
    for (let e = 0; e < 2; e++) {
      const v = i * 2 + e;
      position[v * 3] = x;
      position[v * 3 + 1] = y;
      position[v * 3 + 2] = z;
      data[v * 4] = rank;
      data[v * 4 + 1] = jitter;
      data[v * 4 + 2] = e;
      data[v * 4 + 3] = phase;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aData', new THREE.BufferAttribute(data, 4));
  return geometry;
}

const RAIN_VERTEX = /* glsl */ `
  attribute vec4 aData;
  uniform vec3 uWind;
  uniform vec3 uSize;
  uniform vec3 uStreak;
  uniform float uDist;
  uniform float uFallT;
  uniform float uDensity;
  uniform float uAlpha;
  varying float vAlpha;
  void main() {
    float keep = step(aData.x, uDensity);
    vec3 q = position * uSize;
    q.x += uWind.x * uDist * aData.y;
    q.z += uWind.z * uDist * aData.y;
    q.y -= uFallT * aData.y;
    vec3 h = vec3(mod(q.x, uSize.x), mod(q.y, uSize.y), mod(q.z, uSize.z));
    vec2 e = min(h.xz / uSize.xz, 1.0 - h.xz / uSize.xz);
    float yy = h.y / uSize.y;
    float fade = smoothstep(0.0, 0.05, min(e.x, e.y)) * smoothstep(0.0, 0.07, yy) * smoothstep(1.0, 0.85, yy);
    vec3 pos = h - vec3(uSize.x * 0.5, 0.0, uSize.z * 0.5);
    pos -= uStreak * aData.z * (0.6 + 0.8 * aData.w);
    vAlpha = uAlpha * fade * (1.0 - 0.85 * aData.z) * keep;
    gl_Position = keep > 0.5 ? projectionMatrix * modelViewMatrix * vec4(pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }
`;

const SPORE_VERTEX = /* glsl */ `
  attribute vec4 aData;
  uniform vec3 uWind;
  uniform vec3 uSize;
  uniform float uDist;
  uniform float uTime;
  uniform float uDensity;
  uniform float uAlpha;
  uniform float uTrail;
  varying float vAlpha;
  void main() {
    float keep = step(aData.x, uDensity);
    vec3 side = vec3(-uWind.z, 0.0, uWind.x);
    vec3 q = position * uSize;
    q.x += uWind.x * uDist * 0.55 * aData.y;
    q.z += uWind.z * uDist * 0.55 * aData.y;
    vec2 xz = vec2(mod(q.x, uSize.x), mod(q.z, uSize.z));
    vec2 e = min(xz / uSize.xz, 1.0 - xz / uSize.xz);
    float fade = smoothstep(0.0, 0.06, min(e.x, e.y));
    vec3 pos = vec3(xz.x - uSize.x * 0.5, q.y, xz.y - uSize.z * 0.5);
    pos.y += sin(uTime * 0.9 + aData.w * 6.2831) * 0.7;
    pos += side * sin(uTime * 0.6 + aData.w * 11.0) * 1.4;
    pos -= uWind * uTrail * aData.z * (0.5 + aData.w);
    vAlpha = uAlpha * fade * (1.0 - aData.z) * keep;
    gl_Position = keep > 0.5 ? projectionMatrix * modelViewMatrix * vec4(pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const SPORE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }
`;

const CLOUD_VERTEX = /* glsl */ `
  attribute float aBand;
  varying vec2 vLocal;
  varying vec2 vUv;
  varying float vBand;
  void main() {
    vLocal = position.xz;
    vUv = uv;
    vBand = aBand;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAGMENT = /* glsl */ `
  uniform float uDrift;
  uniform float uFront;
  uniform float uSoft;
  uniform float uCloud;
  uniform vec3 uSlate;
  uniform vec3 uHigh;
  uniform vec3 uAmber;
  varying vec2 vLocal;
  varying vec2 vUv;
  varying float vBand;
  ${NOISE_GLSL}
  void main() {
    vec2 p = vec2((vLocal.x - uDrift) * 0.006, vLocal.y * 0.02) + vBand * 7.3;
    float n = sFbm(p);
    vec2 uv = vUv + (n - 0.5) * 0.3;
    float edge = smoothstep(0.0, 0.35, uv.x) * smoothstep(1.0, 0.65, uv.x)
               * smoothstep(0.0, 0.35, uv.y) * smoothstep(1.0, 0.65, uv.y);
    float front = 1.0 - smoothstep(uFront - uSoft, uFront + uSoft, vLocal.x);
    float a = edge * smoothstep(0.25, 0.85, n) * 0.6 * uCloud * front;
    vec3 col = mix(uSlate, uHigh, n) + uAmber * (1.0 - n) * 0.05;
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * The storm's roof: one disc of cloud turning about an eye over the summoning
 * colony. Rotation is differential (fast near the eye, slow at the rim) and
 * the arms follow a logarithmic spiral, so the whole deck visibly winds in.
 * Gaps in the cover keep the forest readable beneath it.
 */
const VORTEX_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VORTEX_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uCloud;
  uniform float uFlash;
  uniform float uRadius;
  uniform vec2 uEye;
  uniform vec3 uDark;
  uniform vec3 uLight;
  uniform vec3 uFlashColor;
  varying vec2 vPos;
  ${NOISE_GLSL}
  void main() {
    vec2 d = (vPos - uEye) / uRadius;
    float r = length(d);
    float a = atan(d.y, d.x);
    // Differential rotation plus a spiral twist; counter-clockwise from above.
    float turn = uTime * (0.55 / (r + 0.25)) + 1.9 * log(r + 0.04);
    float c = cos(turn), s = sin(turn);
    vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    float n = sFbm(q * 3.2 + 11.0);
    float fine = sNoise(q * 9.0 - uTime * 0.2);
    float arms = 0.5 + 0.5 * sin(4.0 * (a + turn * 0.6));
    float cover = n * 0.62 + arms * 0.28 + fine * 0.1;
    float eye = smoothstep(0.05, 0.13, r);
    float wall = exp(-pow((r - 0.15) / 0.05, 2.0));
    float rim = 1.0 - smoothstep(0.72, 1.0, r);
    float density = smoothstep(0.38, 0.72, cover + wall * 0.25) * eye * rim;
    float alpha = density * 0.82 * uCloud;
    vec3 col = mix(uDark, uLight, pow(n, 1.6) * 0.9 + wall * 0.25);
    col = mix(col, uFlashColor, uFlash * (0.08 + 0.3 * n) * density);
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Bolt ribbons: `uv.x` runs across a ribbon for a soft core, `uv.y` is brightness. */
const BOLT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BOLT_FRAGMENT = /* glsl */ `
  uniform float uBolt;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float core = pow(across, 3.0);
    float glow = pow(across, 1.2) * 0.35;
    gl_FragColor = vec4(uColor * (core * 1.6 + glow), (core + glow) * uBolt * vUv.y);
  }
`;

const VEIL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VEIL_FRAGMENT = /* glsl */ `
  uniform float uVeil;
  uniform float uDrift;
  uniform vec3 uSlate;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float streak = sNoise(vec2(vUv.x * 46.0 + uDrift * 0.02, vUv.y * 2.5));
    float side = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
    float height = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    float a = side * height * (0.35 + 0.65 * streak) * 0.34 * uVeil;
    gl_FragColor = vec4(uSlate, a);
  }
`;

export class StormView {
  readonly group = new THREE.Group();

  private readonly frame = new THREE.Group();
  private readonly clouds: THREE.Mesh;
  private readonly veil: THREE.Mesh;
  private readonly rain: THREE.LineSegments;
  private readonly spores: THREE.LineSegments;
  private readonly rainCount: number;
  private readonly sporeCount: number;
  private readonly diag: number;
  private half: number;

  private readonly rainUniforms: Uniforms;
  private readonly sporeUniforms: Uniforms;
  private readonly cloudUniforms: Uniforms;
  private readonly veilUniforms: Uniforms;
  private readonly vortex: THREE.Mesh;
  private readonly vortexUniforms: Uniforms;
  private readonly bolt: THREE.Mesh;
  private readonly boltUniforms: Uniforms;
  private readonly boltPositions: Float32Array;
  private readonly boltUvs: Float32Array;
  private readonly strikeRand: () => number;
  private readonly boltRand: () => number;
  /** Seconds until the next strike, and since the last one. */
  private nextStrike = 2;
  private sinceStrike = Infinity;
  private strikes = 0;
  private pending: THREE.Vector3 | null = null;
  private flashLevel = 0;
  private readonly windDir = new THREE.Vector3(1, 0, 0);

  private phase: StormVisual['phase'] = 'idle';
  private locked = false;
  private direction = 0;
  private warnTotal = 0;
  private front = 0;
  private cloud = 0;
  private rainLevel = 0;
  private wind = 0;
  private veilLevel = 0;
  private dist = 0;
  private fallT = 0;
  private time = 0;
  private drift = 0;
  private gate = 0;
  private reduced = false;

  constructor(private readonly width: number, private readonly depth: number, fast: boolean) {
    this.rainCount = fast ? RAIN_FAST : RAIN_NORMAL;
    this.sporeCount = fast ? SPORE_FAST : SPORE_NORMAL;
    this.diag = Math.hypot(width, depth);
    this.half = this.diag * 0.5;
    this.group.name = 'storm';
    this.group.visible = false;
    this.group.add(this.frame);

    const seed = (Math.round(width * 31) ^ Math.round(depth * 17) ^ 0x57a3) >>> 0;
    const size = new THREE.Vector3(width, SKY, depth);

    // Rain.
    this.rainUniforms = {
      uWind: { value: this.windDir },
      uSize: { value: size },
      uStreak: { value: new THREE.Vector3() },
      uDist: { value: 0 },
      uFallT: { value: 0 },
      uDensity: { value: 0 },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(0x9fb0b4) },
    };
    this.rain = new THREE.LineSegments(
      particleGeometry(this.rainCount, seed, 0, 1),
      new THREE.ShaderMaterial({
        uniforms: this.rainUniforms,
        vertexShader: RAIN_VERTEX,
        fragmentShader: RAIN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );

    // Spores: low, amber, additive trails.
    const sporeSize = new THREE.Vector3(width, 8, depth);
    this.sporeUniforms = {
      uWind: { value: this.windDir },
      uSize: { value: sporeSize },
      uDist: { value: 0 },
      uTime: { value: 0 },
      uDensity: { value: 0 },
      uAlpha: { value: 0 },
      uTrail: { value: 2 },
      uColor: { value: new THREE.Color(0xffb347) },
    };
    this.spores = new THREE.LineSegments(
      particleGeometry(this.sporeCount, seed ^ 0x9e37, 0.05, 0.95),
      new THREE.ShaderMaterial({
        uniforms: this.sporeUniforms,
        vertexShader: SPORE_VERTEX,
        fragmentShader: SPORE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );

    // Cloud bands: long across the wind, stacked along it, in the frame's local axes (+x downwind).
    this.cloudUniforms = {
      uDrift: { value: 0 },
      uFront: { value: 0 },
      uSoft: { value: this.half * 0.25 },
      uCloud: { value: 0 },
      uSlate: { value: new THREE.Color(0x1c2226) },
      uHigh: { value: new THREE.Color(0x3a444a) },
      uAmber: { value: new THREE.Color(0xffb347) },
    };
    this.clouds = new THREE.Mesh(
      this.buildBands(seed ^ 0x1f3d),
      new THREE.ShaderMaterial({
        uniforms: this.cloudUniforms,
        vertexShader: CLOUD_VERTEX,
        fragmentShader: CLOUD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );

    this.veilUniforms = {
      uVeil: { value: 0 },
      uDrift: { value: 0 },
      uSlate: { value: new THREE.Color(0x2a3236) },
    };
    this.veil = new THREE.Mesh(
      this.buildVeil(),
      new THREE.ShaderMaterial({
        uniforms: this.veilUniforms,
        vertexShader: VEIL_VERTEX,
        fragmentShader: VEIL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );

    this.vortexUniforms = {
      uTime: { value: 0 },
      uCloud: { value: 0 },
      uFlash: { value: 0 },
      uRadius: { value: this.diag * 0.5 },
      uEye: { value: new THREE.Vector2() },
      uDark: { value: new THREE.Color(0x0d1114) },
      uLight: { value: new THREE.Color(0x4a565c) },
      uFlashColor: { value: new THREE.Color(0x9aa3ad) },
    };
    const disc = new THREE.CircleGeometry(this.diag * 0.5, 72, 0, Math.PI * 2);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0, SKY * 1.08, 0);
    this.vortex = new THREE.Mesh(
      disc,
      new THREE.ShaderMaterial({
        uniforms: this.vortexUniforms,
        vertexShader: VORTEX_VERTEX,
        fragmentShader: VORTEX_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );

    // One preallocated bolt: two crossed ribbons per segment, rewritten per strike.
    this.boltPositions = new Float32Array(BOLT_SEGMENTS * 2 * 4 * 3);
    this.boltUvs = new Float32Array(BOLT_SEGMENTS * 2 * 4 * 2);
    const boltIndex: number[] = [];
    for (let q = 0; q < BOLT_SEGMENTS * 2; q++) boltIndex.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    const boltGeometry = new THREE.BufferGeometry();
    boltGeometry.setAttribute('position', new THREE.BufferAttribute(this.boltPositions, 3).setUsage(THREE.DynamicDrawUsage));
    boltGeometry.setAttribute('uv', new THREE.BufferAttribute(this.boltUvs, 2).setUsage(THREE.DynamicDrawUsage));
    boltGeometry.setIndex(boltIndex);
    boltGeometry.setDrawRange(0, 0);
    this.boltUniforms = { uBolt: { value: 0 }, uColor: { value: new THREE.Color(0xe4ecff) } };
    this.bolt = new THREE.Mesh(
      boltGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.boltUniforms,
        vertexShader: BOLT_VERTEX,
        fragmentShader: BOLT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    // Cosmetic randomness: seeded so a QA capture is repeatable, never read by the simulation.
    this.strikeRand = seeded(seed ^ 0x6c1d);
    this.boltRand = seeded(seed ^ 0x2b0f);

    this.clouds.renderOrder = 3;
    this.vortex.renderOrder = 4;
    this.veil.renderOrder = 5;
    this.rain.renderOrder = 6;
    this.spores.renderOrder = 7;
    this.bolt.renderOrder = 8;
    for (const object of this.layers) {
      object.frustumCulled = false;
      object.visible = false;
    }
    // Clouds and veil live in the wind-aligned frame; particles, vortex and bolt in region axes.
    this.frame.add(this.clouds, this.veil);
    this.group.add(this.vortex, this.rain, this.spores, this.bolt);
  }

  private get layers(): THREE.Object3D[] {
    return [this.clouds, this.vortex, this.veil, this.rain, this.spores, this.bolt];
  }

  /**
   * Brightness of the current lightning flash, 0..1, for the stage lights.
   * Underground it still arrives, dimmed: the soil view hears the storm too.
   */
  get flash(): number {
    return this.flashLevel * (0.35 + 0.65 * this.gate);
  }

  /** Put the vortex eye over a point in this view's local frame (the summoning colony). */
  setEye(x: number, z: number): void {
    (this.vortexUniforms.uEye.value as THREE.Vector2).set(x, z);
  }

  /**
   * Strike a particular place next, in this view's local frame: a tree the
   * storm has just thrown down. Presentation only.
   */
  strike(at: THREE.Vector3): void {
    this.pending = at.clone();
    this.nextStrike = 0;
  }

  update(dt: number, state: StormVisual, reducedMotion: boolean, surfaceBlend: number): void {
    if (state.phase === 'idle') {
      this.reset();
      return;
    }
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    const inten = Number.isFinite(state.intensity) ? clamp01(state.intensity) : 0;
    const remaining = Number.isFinite(state.remaining) ? Math.max(0, state.remaining) : 0;
    this.reduced = reducedMotion;

    if (!this.locked) this.lock(state.direction);
    if (state.phase === 'warning') this.warnTotal = Math.max(this.warnTotal, remaining);
    this.phase = state.phase;

    const progress = state.phase === 'warning' && this.warnTotal > 0 ? clamp01(1 - remaining / this.warnTotal) : state.phase === 'warning' ? 0 : 1;
    let cloudT = 0;
    let rainT = 0;
    let windT = 0;
    let veilT = 0;
    let frontT = 1.5 * this.half;
    if (state.phase === 'warning') {
      cloudT = 0.25 + 0.35 * progress;
      windT = 0.12 + 0.2 * progress;
      veilT = 0.35 + 0.4 * progress;
      frontT = -1.25 * this.half + 1.1 * this.half * progress;
    } else if (state.phase === 'active') {
      cloudT = 0.55 + 0.45 * inten;
      rainT = inten;
      windT = 0.3 + 0.7 * inten;
      veilT = 1;
    } else {
      cloudT = 0.2 + 0.8 * inten;
      rainT = inten * 0.9;
      windT = inten;
    }

    const rate = state.phase === 'recovery' ? 5 : 1.6;
    const k = 1 - Math.exp(-rate * step);
    this.cloud += (cloudT - this.cloud) * k;
    this.rainLevel += (rainT - this.rainLevel) * k;
    this.wind += (windT - this.wind) * k;
    this.veilLevel += (veilT - this.veilLevel) * k;
    if (reducedMotion) this.front = frontT;
    else this.front += (frontT - this.front) * (1 - Math.exp(-0.9 * step));

    this.gate = smooth(0.2, 0.95, Number.isFinite(surfaceBlend) ? surfaceBlend : 0);

    if (!reducedMotion) {
      this.dist += WIND_SPEED * this.wind * step;
      this.fallT += FALL_SPEED * step * (0.4 + 0.6 * this.rainLevel);
      this.time += step;
      this.drift += WIND_SPEED * this.wind * 0.15 * step;
    }

    // Lightning: overhead through the storm, distant and rare late in the
    // warning. Reduced motion has no strikes and no flash at all.
    const near = state.phase === 'active';
    const striking = !reducedMotion && (near || (state.phase === 'warning' && progress > 0.55));
    this.sinceStrike += step;
    if (striking) {
      this.nextStrike -= step;
      if (this.nextStrike <= 0) {
        this.fire(near);
        this.nextStrike = near
          ? STRIKE_GAP[0] + this.strikeRand() * (STRIKE_GAP[1] - STRIKE_GAP[0])
          : 5 + this.strikeRand() * 6;
      }
    } else {
      this.pending = null;
    }
    const t = this.sinceStrike;
    const pulse = Math.exp(-t * 10) + (t > 0.13 ? 0.7 * Math.exp(-(t - 0.13) * 9) : 0);
    this.flashLevel = reducedMotion || !Number.isFinite(t) ? 0 : clamp01(pulse) * (near ? 1 : 0.4);
    this.boltUniforms.uBolt.value = t < 0.32 ? clamp01(pulse * 1.3) : 0;
    this.apply();
  }

  /** Build one bolt: a jagged trunk from the cloud base with a few forks. */
  private fire(near: boolean): void {
    const rand = this.boltRand;
    let target = this.pending;
    this.pending = null;
    if (!target) {
      if (near) {
        target = new THREE.Vector3((rand() - 0.5) * this.width * 0.9, 0, (rand() - 0.5) * this.depth * 0.9);
      } else {
        // Out at the approaching front, upwind of the region.
        const side = (rand() - 0.5) * this.half * 1.4;
        target = new THREE.Vector3(
          -this.windDir.x * this.half * 1.1 - this.windDir.z * side, 0,
          -this.windDir.z * this.half * 1.1 + this.windDir.x * side);
      }
    }
    // Slanted from upwind, so it reads as a jagged line from the overhead camera too.
    const lean = 16 + rand() * 12;
    const swing = (rand() - 0.5) * 1.4;
    const top = new THREE.Vector3(
      target.x - (this.windDir.x * Math.cos(swing) - this.windDir.z * Math.sin(swing)) * lean, SKY * 0.98,
      target.z - (this.windDir.z * Math.cos(swing) + this.windDir.x * Math.sin(swing)) * lean);
    let quad = 0;
    const ribbon = (a: THREE.Vector3, b: THREE.Vector3, width: number, bright: number): void => {
      for (const axis of [0, 2]) {
        if (quad >= BOLT_SEGMENTS * 2) return;
        const o = quad * 4;
        const w = width * 0.5;
        const corners = [a, b, b, a];
        const across = [-w, -w, w, w];
        for (let c = 0; c < 4; c++) {
          const p = corners[c];
          this.boltPositions.set([p.x + (axis === 0 ? across[c] : 0), p.y, p.z + (axis === 2 ? across[c] : 0)], (o + c) * 3);
          this.boltUvs.set([c < 2 ? 0 : 1, bright], (o + c) * 2);
        }
        quad++;
      }
    };
    const walk = (from: THREE.Vector3, to: THREE.Vector3, steps: number, jag: number): THREE.Vector3[] => {
      const points = [from.clone()];
      const drift = new THREE.Vector3();
      for (let i = 1; i < steps; i++) {
        drift.x += (rand() - 0.5) * jag;
        drift.z += (rand() - 0.5) * jag;
        const along = i / steps;
        // Pull the wander back so the bolt still lands on its target.
        points.push(from.clone().lerp(to, along).addScaledVector(drift, 1 - along));
      }
      points.push(to.clone());
      return points;
    };
    const trunk = walk(top, target, 26, 3.2);
    for (let i = 0; i + 1 < trunk.length; i++) ribbon(trunk[i], trunk[i + 1], 1.8, 1);
    for (let f = 0; f < 4; f++) {
      const from = trunk[4 + Math.floor(rand() * 14)];
      const reach = 5 + rand() * 9;
      const angle = rand() * Math.PI * 2;
      const end = from.clone().add(new THREE.Vector3(Math.cos(angle) * reach, -reach * (0.8 + rand() * 0.6), Math.sin(angle) * reach));
      const fork = walk(from, end, 7, 1.8);
      for (let i = 0; i + 1 < fork.length; i++) ribbon(fork[i], fork[i + 1], 0.9, 0.55 * (1 - i / fork.length));
    }
    const geometry = this.bolt.geometry;
    geometry.setDrawRange(0, quad * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
    this.sinceStrike = 0;
    this.strikes++;
  }

  dispose(): void {
    for (const object of [this.clouds, this.vortex, this.veil, this.rain, this.spores, this.bolt]) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
    this.group.clear();
    this.frame.clear();
  }

  report(): { phase: string; particles: number; draws: number; intensity: number; strikes: number; flash: number; vortex: boolean } {
    const rain = this.rain.visible ? Math.round(this.rainCount * (this.rainUniforms.uDensity.value as number)) : 0;
    const spores = this.spores.visible ? Math.round(this.sporeCount * (this.sporeUniforms.uDensity.value as number)) : 0;
    let draws = 0;
    for (const object of this.layers) if (this.group.visible && object.visible) draws++;
    return {
      phase: this.phase, particles: rain + spores, draws,
      intensity: this.group.visible ? Math.max(this.rainLevel, this.cloud * 0.5) : 0,
      strikes: this.strikes, flash: this.flash, vortex: this.group.visible && this.vortex.visible,
    };
  }

  /** Direction is taken once per storm; regional +y is scene -z. */
  private lock(direction: number): void {
    this.direction = Number.isFinite(direction) ? direction : 0;
    this.locked = true;
    const c = Math.cos(this.direction);
    const s = Math.sin(this.direction);
    this.windDir.set(c, 0, -s);
    // Local +x of the frame is downwind: rotation.y = a maps +x to (cos a, 0, -sin a).
    this.frame.rotation.y = this.direction;
    // Half-extent along the wind depends on direction; the soft edge follows it.
    this.half = (Math.abs(c) * this.width + Math.abs(s) * this.depth) * 0.5;
    this.cloudUniforms.uSoft.value = this.half * 0.25;
    this.front = -1.25 * this.half;
    this.warnTotal = 0;
  }

  private reset(): void {
    if (!this.locked && !this.group.visible) return;
    this.locked = false;
    this.phase = 'idle';
    this.cloud = this.rainLevel = this.wind = this.veilLevel = 0;
    this.gate = 0;
    this.flashLevel = 0;
    this.sinceStrike = Infinity;
    this.nextStrike = 2;
    this.pending = null;
    this.group.visible = false;
    for (const object of this.layers) object.visible = false;
    this.rainUniforms.uDensity.value = 0;
    this.sporeUniforms.uDensity.value = 0;
  }

  private apply(): void {
    const g = this.gate;
    const on = g > 0.004;
    this.group.visible = on;
    if (!on) return;

    const cloud = this.cloud * g;
    const veilFade = clamp01((1.45 * this.half - this.front) / (0.6 * this.half));
    const veil = this.veilLevel * veilFade * g;
    const rain = this.rainLevel * g;
    const spores = this.reduced ? 0 : this.wind * g;

    this.clouds.visible = cloud > 0.004;
    this.veil.visible = veil > 0.004 && this.front > -1.4 * this.half;
    this.rain.visible = rain > 0.01;
    this.spores.visible = spores > 0.01;

    // The vortex builds through the warning and dominates the active storm.
    const vortex = this.cloud * this.cloud * g;
    this.vortex.visible = vortex > 0.01;
    this.vortexUniforms.uCloud.value = vortex;
    this.vortexUniforms.uTime.value = this.time;
    this.vortexUniforms.uFlash.value = this.flashLevel;
    this.bolt.visible = (this.boltUniforms.uBolt.value as number) > 0.01;

    this.cloudUniforms.uCloud.value = cloud;
    this.cloudUniforms.uFront.value = this.front;
    this.cloudUniforms.uDrift.value = this.drift;
    this.veilUniforms.uVeil.value = veil;
    this.veilUniforms.uDrift.value = this.drift;
    this.veil.position.x = this.front;

    const horizontal = WIND_SPEED * this.wind;
    const streak = this.rainUniforms.uStreak.value as THREE.Vector3;
    streak.set(this.windDir.x * horizontal * STREAK, -FALL_SPEED * STREAK, this.windDir.z * horizontal * STREAK);
    this.rainUniforms.uDist.value = this.dist;
    this.rainUniforms.uFallT.value = this.fallT;
    this.rainUniforms.uDensity.value = clamp01(rain) * (this.reduced ? 0.6 : 1);
    this.rainUniforms.uAlpha.value = 0.16 + 0.44 * clamp01(rain) + 0.3 * this.flashLevel;

    this.sporeUniforms.uDist.value = this.dist;
    this.sporeUniforms.uTime.value = this.time;
    this.sporeUniforms.uDensity.value = clamp01(spores);
    this.sporeUniforms.uAlpha.value = 0.55 * clamp01(spores + 0.2);
    this.sporeUniforms.uTrail.value = 1.5 + 4 * this.wind;
  }

  private buildBands(seed: number): THREE.BufferGeometry {
    const rand = seeded(seed);
    const position = new Float32Array(BAND_COUNT * 12);
    const uv = new Float32Array(BAND_COUNT * 8);
    const band = new Float32Array(BAND_COUNT * 4);
    const index: number[] = [];
    const diag = this.diag;
    for (let i = 0; i < BAND_COUNT; i++) {
      const cx = ((i + 0.5) / BAND_COUNT - 0.5) * diag * 1.5 + (rand() - 0.5) * diag * 0.08;
      const halfAlong = diag * (0.14 + rand() * 0.1);
      const halfAcross = diag * (0.7 + rand() * 0.15);
      const y = SKY * (0.55 + rand() * 0.35);
      const shift = (rand() - 0.5) * diag * 0.1;
      const corners = [
        [cx - halfAlong, -halfAcross + shift, 0, 0],
        [cx + halfAlong, -halfAcross + shift, 1, 0],
        [cx + halfAlong, halfAcross + shift, 1, 1],
        [cx - halfAlong, halfAcross + shift, 0, 1],
      ];
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        position.set([corners[c][0], y, corners[c][1]], v * 3);
        uv.set([corners[c][2], corners[c][3]], v * 2);
        band[v] = i;
      }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('aBand', new THREE.BufferAttribute(band, 1));
    geometry.setIndex(index);
    return geometry;
  }

  /** A sheet across the wind, leaning downwind with height, moved along the frame's x by the front. */
  private buildVeil(): THREE.BufferGeometry {
    const rows = 6;
    const across = this.diag * 0.75;
    const top = SKY * 0.85;
    const position = new Float32Array((rows + 1) * 6);
    const uv = new Float32Array((rows + 1) * 4);
    const index: number[] = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      for (let s = 0; s < 2; s++) {
        const v = r * 2 + s;
        position.set([t * top * 0.5, t * top, (s ? 1 : -1) * across], v * 3);
        uv.set([s, t], v * 2);
      }
      if (r < rows) index.push(r * 2, r * 2 + 1, r * 2 + 3, r * 2, r * 2 + 3, r * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(index);
    return geometry;
  }
}
