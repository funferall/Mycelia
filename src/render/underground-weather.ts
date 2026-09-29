import * as THREE from 'three';
import { GRID } from '../sim/content';
import { FIRE } from '../sim/wildfire';
import type { World } from '../sim/world';
import { FLOOR_DROUGHT, FLOOR_FIRE } from './forest-floor';

/**
 * The ecological powers as the soil sees them, drawn over the active stand's
 * transect in the soil's own frame (column gx at x = gx - cols/2, row gy at
 * y = FLOOR - gy), so it lines up with the grit, the network and the water
 * table. One translucent plane, one draw, no per-cell geometry.
 *
 * - **Storm:** a wetting front soaks down from the surface, rain fingers
 *   percolating ahead of it and droplets falling through the wet soil.
 * - **Flood:** columns under floodwater show the standing water above the
 *   ground and saturated, airless soil below it, bubbles rising.
 * - **Fire:** heat reaches down under the passing front, glowing in the
 *   topsoil it can burn; behind it an ash layer lies on the surface.
 * - **Drought:** a pale, dust-dry front sinks from the surface, stopping short
 *   of the stream's banks, and cracks open down into it.
 *
 * Presentation only: the simulation decides what drowned, burned or withered;
 * the soil particles already re-colour as moisture changes.
 */

const FLOOR = GRID.rows / 2;
/** Height above the surface drawn for standing floodwater. */
const ABOVE = 12;

const VERTEX = /* glsl */ `
  varying float vCol;
  varying float vDepth;
  void main() {
    vCol = position.x + ${(GRID.cols / 2).toFixed(1)};
    vDepth = ${FLOOR.toFixed(1)} - position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  uniform float uWetFront;
  uniform float uFlood;
  uniform float uFlash;
  uniform vec2 uOrigin;
  uniform sampler2D uColumns;
  uniform vec2 fireDir; uniform float fireFront; uniform float fireBand;
  uniform vec2 fireSpotDir; uniform float fireSpotFront; uniform float fireSpotScorch;
  uniform float fireScorch; uniform float fireRegrowth; uniform float fireActive;
  uniform float droughtSeverity;
  varying float vCol;
  varying float vDepth;
  float uHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float uNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(uHash(i), uHash(i + vec2(1, 0)), f.x), mix(uHash(i + vec2(0, 1)), uHash(i + vec2(1, 1)), f.x), f.y);
  }
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  void over(vec3 c, float a) {
    a = clamp(a, 0.0, 1.0);
    rgb = mix(rgb, c, a);
    alpha = alpha + a * (1.0 - alpha);
  }
  void main() {
    float gx = vCol, d = vDepth;
    vec4 column = texture2D(uColumns, vec2((floor(gx) + 0.5) / ${GRID.cols.toFixed(1)}, 0.5));
    float bank = column.r;
    float standing = column.g * 30.0;
    float soil = step(0.0, d);

    // Storm: the wetting front and the rain working down ahead of it.
    if (uRain > 0.001) {
      float front = uWetFront;
      float wet = (1.0 - smoothstep(front - 3.0, front + 1.0, d)) * soil;
      float fingers = smoothstep(0.55, 0.9, uNoise(vec2(gx * 0.9, d * 0.08 - uTime * 0.6)));
      float ahead = fingers * smoothstep(front + 16.0, front, d) * soil;
      over(vec3(0.09, 0.15, 0.19), (wet * 0.3 + ahead * 0.35) * uRain);
      over(vec3(0.3, 0.42, 0.48), exp(-pow((d - front) / 1.2, 2.0)) * 0.35 * uRain * soil);
      float drop = step(0.975, uHash(floor(vec2(gx * 1.3, (d + uTime * 24.0) * 0.45)))) * wet;
      over(vec3(0.62, 0.72, 0.8) * (1.0 + uFlash), drop * 0.7 * uRain);
    }

    // Flood: standing water over the column, airless saturated soil beneath.
    if (standing > 0.05) {
      float lap = sin(gx * 0.7 + uTime * 2.0) * 0.4;
      if (d < 0.0 && -d < standing + lap) {
        over(vec3(0.13, 0.17, 0.15), 0.75);
        over(vec3(0.45, 0.5, 0.45), exp(-pow((-d - standing - lap) / 0.5, 2.0)) * 0.6);
      } else if (d >= 0.0 && d < 40.0) {
        over(vec3(0.04, 0.09, 0.13), 0.5 * uFlood * (1.0 - smoothstep(30.0, 40.0, d)));
        float bubble = step(0.985, uHash(floor(vec2(gx * 2.0, (d + uTime * 7.0) * 0.6))));
        over(vec3(0.5, 0.62, 0.68), bubble * 0.6 * uFlood);
      }
    }

    // Distant orange breathing along the soil ceiling; the passing front is
    // hotter and reaches only the shallow strands the simulation can damage.
    if (fireActive > 0.001 && d >= 0.0) {
      // Illumination reaches wet soil too; the damaging heat below remains
      // masked by moisture and the stream bank in the separate front term.
      float breathing = 0.68 + 0.32 * sin(uTime * 3.1 + gx * 0.05);
      float ceiling = (1.0 - smoothstep(0.0, 24.0, d)) * breathing;
      over(vec3(1.0, 0.27, 0.035), fireActive * ceiling * 0.48);
    }
    // Fire: heat under the passing front; ash on the surface behind it.
    if (fireScorch > 0.001 && d >= 0.0) {
      vec2 at = vec2(uOrigin.x + gx + 0.5, uOrigin.y);
      float behind = fireFront - dot(at, fireDir);
      float spotBehind = fireSpotFront - dot(at, fireSpotDir);
      float dry = 1.0 - smoothstep(${FIRE.dryBelow.toFixed(2)}, ${FIRE.wetRefuge.toFixed(2)}, column.b);
      float refuge = 1.0 - smoothstep(0.25, 0.4, bank);
      float ordinaryHeat = smoothstep(-2.0, 1.0, behind) * (1.0 - smoothstep(fireBand * 0.3, fireBand * 1.8, behind)) * dry * refuge;
      float emberHeat = smoothstep(-2.0, 1.0, spotBehind) * (1.0 - smoothstep(fireBand * 0.3, fireBand * 1.8, spotBehind)) * fireSpotScorch;
      float heat = max(ordinaryHeat, emberHeat) * fireScorch;
      float pulse = 0.78 + 0.22 * sin(uTime * 3.2 + gx * 0.11);
      float flicker = (0.68 + 0.32 * uNoise(vec2(gx * 0.5, uTime * 3.0))) * pulse;
      float glow = heat * (1.0 - smoothstep(${FIRE.lethalCm.toFixed(1)}, ${FIRE.singeCm.toFixed(1)}, d)) * flicker;
      over(vec3(1.0, 0.36, 0.045), glow * 0.87);
      over(vec3(1.0, 0.73, 0.25), heat * (1.0 - smoothstep(0.0, ${FIRE.lethalCm.toFixed(1)}, d)) * 0.62 * flicker);
      float ash = max(smoothstep(0.0, 2.0, behind), smoothstep(0.0, 2.0, spotBehind) * fireSpotScorch)
        * (1.0 - smoothstep(2.0, 4.0, d)) * fireScorch;
      over(mix(vec3(0.06, 0.055, 0.05), vec3(0.2, 0.19, 0.17), uNoise(vec2(gx * 1.7, d))), ash * (0.85 - 0.4 * fireRegrowth));
    }

    // Drought: a dry front sinking from the surface; cracks opening into it.
    if (droughtSeverity > 0.001 && d >= 0.0) {
      float spared = 1.0 - smoothstep(0.15, 0.45, bank);
      float dryFront = 24.0 * droughtSeverity * spared;
      float dry = 1.0 - smoothstep(dryFront - 5.0, dryFront, d);
      over(vec3(0.72, 0.6, 0.42), dry * 0.55 * droughtSeverity);
      float lane = floor(gx / 6.0);
      float seed = uHash(vec2(lane, 3.7));
      float crackLen = dryFront * (0.55 + 0.6 * seed);
      float x = lane * 6.0 + 1.0 + seed * 4.0 + (uNoise(vec2(d * 0.35, lane)) - 0.5) * 2.2;
      float width = 0.8 * (1.0 - d / max(crackLen, 0.001));
      float crack = step(abs(gx - x), width) * step(d, crackLen) * step(0.25, seed);
      over(vec3(0.03, 0.022, 0.015), crack * 0.9 * spared);
    }

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(rgb, alpha);
  }
`;

export interface UndergroundWeatherState {
  /** 0..1 storm rain reaching the soil. */
  rain: number;
  /** Depth of the storm's wetting front, centimetres. */
  wetFront: number;
  /** 0..1 flood level. */
  flood: number;
  /** Standing floodwater over each transect column, centimetres. */
  floodDepth: (gx: number) => number;
  /** 0..1 lightning flash. */
  flash: number;
}

export class UndergroundWeather {
  readonly mesh: THREE.Mesh;
  private readonly columns: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly uniforms: Record<string, THREE.IUniform>;

  /** `origin`: regional x of column 0 and regional y of the transect line. */
  constructor(private readonly world: World, origin: { x: number; y: number }) {
    this.data = new Uint8Array(GRID.cols * 4);
    for (let gx = 0; gx < GRID.cols; gx++) {
      this.data[gx * 4] = Math.round(255 * (world.cells[8 * GRID.cols + gx]?.streamNear ?? 0));
      this.data[gx * 4 + 3] = 255;
    }
    this.columns = new THREE.DataTexture(this.data, GRID.cols, 1, THREE.RGBAFormat);
    this.columns.needsUpdate = true;
    this.uniforms = {
      uTime: { value: 0 }, uRain: { value: 0 }, uWetFront: { value: 0 }, uFlood: { value: 0 }, uFlash: { value: 0 },
      uOrigin: { value: new THREE.Vector2(origin.x, origin.y) },
      uColumns: { value: this.columns },
      fireDir: FLOOR_FIRE.dir, fireFront: FLOOR_FIRE.front, fireBand: FLOOR_FIRE.band,
      fireSpotDir: FLOOR_FIRE.spotDir, fireSpotFront: FLOOR_FIRE.spotFront, fireSpotScorch: FLOOR_FIRE.spotScorch,
      fireScorch: FLOOR_FIRE.scorch, fireRegrowth: FLOOR_FIRE.regrowth, fireActive: FLOOR_FIRE.active,
      droughtSeverity: FLOOR_DROUGHT.severity,
    };
    const geometry = new THREE.PlaneGeometry(GRID.cols, GRID.rows + ABOVE);
    geometry.translate(0, FLOOR + ABOVE / 2 - GRID.rows / 2, 0);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, fog: false,
    }));
    this.mesh.name = 'underground-weather';
    this.mesh.position.z = 1.8;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(dt: number, state: UndergroundWeatherState, motion: boolean): void {
    const u = this.uniforms;
    if (motion) u.uTime!.value += dt;
    u.uRain!.value = state.rain;
    u.uWetFront!.value = state.wetFront;
    u.uFlood!.value = state.flood;
    u.uFlash!.value = state.flash;
    let changed = false;
    for (let gx = 0; gx < GRID.cols; gx++) {
      const g = Math.round(255 * Math.min(1, state.floodDepth(gx) / 30));
      if (this.data[gx * 4 + 1] !== g) { this.data[gx * 4 + 1] = g; changed = true; }
      const wet = Math.round(255 * Math.min(1, this.world.cells[6 * GRID.cols + gx]?.water ?? 0));
      if (this.data[gx * 4 + 2] !== wet) { this.data[gx * 4 + 2] = wet; changed = true; }
    }
    if (changed) this.columns.needsUpdate = true;
    this.mesh.visible = state.rain > 0.001 || state.flood > 0.001
      || (u.fireScorch!.value as number) > 0.001 || (u.fireActive!.value as number) > 0.001
      || (u.droughtSeverity!.value as number) > 0.001;
  }

  report(): { visible: boolean; floodedColumns: number } {
    let flooded = 0;
    for (let gx = 0; gx < GRID.cols; gx++) if (this.data[gx * 4 + 1]! > 0) flooded++;
    return { visible: this.mesh.visible, floodedColumns: flooded };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.columns.dispose();
  }
}
