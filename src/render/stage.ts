import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GRID } from '../sim/content';
import { mulberry32 } from '../sim/rng';
import { CameraRig } from './camera';
import { NORMAL_QUALITY, qualityPixelRatio, type QualityPreset } from './quality';
import { makePaperTexture, makeSkyTexture } from './textures';

/** Half-width and half-height of the mount, in world units. */
export const MOUNT_HALF_W = GRID.cols / 2;
export const MOUNT_HALF_H = GRID.rows / 2;
/** How far behind the section the dusk glow hangs, behind the backdrop forest. */
const SKY_DEPTH = 900;

/**
 * The sheet.
 *
 * The scene is a sheet of dark mounting paper with a specimen on it, lit by one
 * raking museum light. There is no sky, no ground plane and no horizon: every
 * object in the game lives on this sheet, and the only light the world produces
 * on its own comes out of the network.
 */
const FIRE_KEY = new THREE.Color('#ff9a4a');
const FIRE_SKY = new THREE.Color('#d9774a');
const FIRE_SMOKE = new THREE.Color('#3a2a22');
const DROUGHT_SUN = new THREE.Color('#fff0c8');
const DROUGHT_SKY = new THREE.Color('#d9c89a');
const DROUGHT_DUST = new THREE.Color('#8a7a58');

export class Stage {
  stormIntensity = 0;
  /** Current lightning flash, 0..1, from the storm view. */
  lightning = 0;
  /** 0..1 heat of a wildfire, from the fire view. */
  fireGlow = 0;
  /** 0..1 glare and dust of a drought. */
  droughtHeat = 0;
  private baseKey?: THREE.Color;
  private baseSky?: THREE.Color;
  private baseFog?: THREE.Color;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly quality: QualityPreset;
  /** Where the specimen and the sheet live, so callers can add to either. */
  readonly world = new THREE.Group();
  private readonly paper: THREE.Mesh;
  /** The dusk glow, placed far behind the backdrop forest every frame. */
  private readonly sky: THREE.Mesh;
  private readonly decor = new THREE.Group();
  private readonly backing: THREE.Mesh;
  private readonly key: THREE.DirectionalLight;
  private readonly atmosphere = new THREE.HemisphereLight('#cad6b2', '#362d1d', 0);
  private readonly fog = new THREE.FogExp2('#252c21', 0);

  constructor(canvas: HTMLCanvasElement, quality: QualityPreset = NORMAL_QUALITY) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = quality.shadowMaps;
    this.renderer.setClearColor(0x0b0908, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;

    this.rig = new CameraRig(1);
    this.scene.add(this.world);

    // One raking light from the upper left, as a photographer would light a
    // sheet on a table, plus a cold fill so the stone at depth still reads.
    // Three's lights are physically scaled, so a near-black albedo needs a
    // generous irradiance to read as soil rather than as a hole in the sheet.
    const key = new THREE.DirectionalLight(0xffdcae, 2.6);
    this.key = key;
    key.position.set(-60, 120, 90);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x35506b, 0.7);
    fill.position.set(80, -40, 60);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x2a2119, 1.1));
    this.scene.add(this.atmosphere, this.decor);

    // The paper itself.
    const paperTexture = makePaperTexture(1024);
    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1000),
      new THREE.MeshStandardMaterial({
        map: paperTexture,
        roughness: 1,
        metalness: 0,
      })
    );
    this.paper.position.z = -14;
    // The sheet ends at the soil line: above it, the forest behind the section
    // recedes into the dusk instead of stopping at the paper.
    this.paper.position.y = MOUNT_HALF_H - 500;
    this.decor.add(this.paper);

    // The one band of light in the world that the network did not make: a low
    // warm glow above the soil line, so the trunks read as silhouettes against
    // the canopy rather than vanishing into black paper.
    const sky = this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 98),
      new THREE.MeshBasicMaterial({
        map: makeSkyTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
      })
    );
    sky.position.set(0, MOUNT_HALF_H + 34, -12.6);
    this.decor.add(sky);

    // The mount: a near-black backing so the specimen reads as one solid object
    // lifted off the sheet, rather than grit scattered on paper.
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(MOUNT_HALF_W * 2 + 2.4, MOUNT_HALF_H * 2 + 2.4, 4.6),
      new THREE.MeshStandardMaterial({ color: '#0a0807', roughness: 1, metalness: 0 })
    );
    backing.position.z = -2.6;
    this.backing = backing;
    this.scene.add(backing);

    this.decor.add(makeTapeStrips());
    this.decor.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;
        material.userData.baseOpacity = material.opacity;
        material.transparent = true;
      }
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    // Threshold is set above the soil's albedo so only the network blooms —
    // paper, tape and grit must never catch the glow.
    // Only the brightest cores of the network should bloom. A low threshold
    // catches the whole mass and turns it into a single white shape.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.44);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = qualityPixelRatio(this.quality, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    // The normal path keeps its pre-existing postprocessing resolution. The
    // fast path never reads these targets, so leave them at their tiny
    // constructor size instead of allocating full-size half-float buffers.
    if (this.quality.postprocessing) {
      this.composer.setSize(width, height);
      this.bloom.setSize(width, height);
    }
    this.rig.resize(width / Math.max(1, height));
  }

  /**
   * What the current renderer is actually doing.
   *
   * The browser tools print this before a check so a result names both the
   * preset and the backend instead of assuming a machine and a quality level.
   */
  qualityReport(): {
    preset: string;
    backend: string;
    software: boolean;
    pixelRatio: number;
    viewport: { width: number; height: number };
    canvasCss: { width: number; height: number };
    drawingBuffer: { width: number; height: number };
    antialias: boolean;
    shadowMaps: boolean;
    groundShadows: boolean;
    postprocessing: boolean;
    bloom: boolean;
  } {
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const canvas = this.renderer.domElement;
    const backend = this.backendName();
    return {
      preset: this.quality.id,
      backend,
      software: /swiftshader|llvmpipe|software/i.test(backend),
      pixelRatio: this.renderer.getPixelRatio(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvasCss: { width: canvas.clientWidth, height: canvas.clientHeight },
      drawingBuffer: { width: drawing.width, height: drawing.height },
      antialias: this.quality.antialias,
      shadowMaps: this.renderer.shadowMap.enabled,
      groundShadows: this.quality.surfaceShadows,
      postprocessing: this.quality.postprocessing,
      bloom: this.quality.postprocessing && this.bloom.enabled,
    };
  }

  private backendName(): string {
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    if (debug) {
      const name = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string | null;
      if (name) return name;
    }
    const version = this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1';
    return `${version} (${String(gl.getParameter(gl.RENDERER))})`;
  }

  render(dt: number): void {
    const blend = this.rig.surfaceBlend;
    this.decor.visible = blend < 0.99;
    // The glow is authored as if 12.6 units behind the section, which would put
    // it in front of the backdrop forest. Push it far back and scale it about the
    // camera so it covers the same part of the picture, now behind every tree.
    const camera = this.rig.camera;
    const near = camera.position.z + 12.6;
    const far = camera.position.z + SKY_DEPTH;
    const k = far / Math.max(1, near);
    this.sky.position.set(
      camera.position.x * (1 - k),
      camera.position.y + (MOUNT_HALF_H + 34 - camera.position.y) * k,
      -SKY_DEPTH
    );
    // Wider than authored, so its ends never show beside the specimen.
    this.sky.scale.set(k * 12, k, 1);
    this.decor.traverse(object => {
      if (object instanceof THREE.Mesh) object.material.opacity = object.material.userData.baseOpacity * (1 - blend);
    });
    this.backing.scale.z = 1 + blend * 15.5;
    // The regional terrain has its own perimeter. The local specimen backing
    // must not protrude through a low valley or hang beneath the forest edge.
    this.backing.visible = blend < 0.99;
    // Keep the backing below the terrain, including the lowest part of its relief.
    this.backing.scale.y = 1 - blend * 0.025;
    this.backing.position.z = -2.6 - blend * 35.65;
    // Storm light: the forest darkens under the vortex; a strike lights both views.
    this.atmosphere.intensity = blend * (2.1 - this.stormIntensity * 1.25) + this.lightning * 2.4;
    this.key.intensity = (2.6 - blend * .8) * (1 - this.stormIntensity * (.18 + .4 * blend)) + this.lightning * 3.2;
    // Fire light: a pulsing amber cast leaks into the soil while the front runs.
    this.baseKey ??= this.key.color.clone();
    this.baseSky ??= this.atmosphere.color.clone();
    this.baseFog ??= this.fog.color.clone();
    const heat = this.fireGlow;
    // Drought light: a hard, pale sun and a dusty haze; applied before the fire's amber.
    const glare = this.droughtHeat;
    this.key.color.copy(this.baseKey).lerp(DROUGHT_SUN, glare * 0.6).lerp(FIRE_KEY, heat * 0.7);
    this.atmosphere.color.copy(this.baseSky).lerp(DROUGHT_SKY, glare * 0.5).lerp(FIRE_SKY, heat * 0.6);
    this.fog.color.copy(this.baseFog).lerp(DROUGHT_DUST, glare * 0.7).lerp(FIRE_SMOKE, heat * 0.8);
    this.key.intensity *= 1 + glare * 0.25 * blend;
    this.atmosphere.intensity += heat * (0.15 + (1 - blend) * 0.42);
    this.key.intensity += heat * (1 - blend) * 0.32;
    this.key.intensity *= 1 - heat * 0.25 * blend;
    this.bloom.strength = 0.42 - blend * 0.31 + heat * (0.06 * blend + 0.12 * (1 - blend));
    this.fog.density = blend * (.001 + this.stormIntensity * .0012 + heat * .00025 + glare * .0003);
    this.scene.fog = blend > 0.01 ? this.fog : null;
    this.renderer.setClearColor(new THREE.Color('#0b0908').lerp(new THREE.Color('#12150f'), blend).multiplyScalar(0.18));
    if (this.quality.postprocessing) this.composer.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);
  }
}

/**
 * Gummed paper tape holding the specimen down. Slightly irregular, and never
 * perfectly aligned — a template would read as a screen element rather than a
 * mount.
 */
function makeTapeStrips(): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(0x7a9e1c);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: '#8d8266',
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });

  const h = MOUNT_HALF_H;
  const w = MOUNT_HALF_W;
  const placements: Array<[number, number, number, number, number]> = [];
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const y = h - ((i + 0.6) / rows) * h * 2;
    // Tape crosses the mount's flanks, hanging a little over each edge.
    placements.push([-w + 1, y + (rng() - 0.5) * 6, 5.4, 1.9, (rng() - 0.5) * 0.34]);
    placements.push([w - 1, y + (rng() - 0.5) * 6, 5.4, 1.9, (rng() - 0.5) * 0.34]);
  }
  // Corner pins.
  placements.push([-w + 4, h - 3, 8, 2.1, 0.62]);
  placements.push([w - 4, h - 3, 8, 2.1, -0.62]);
  placements.push([-w + 4, -h + 3, 8, 2.1, -0.55]);
  placements.push([w - 4, -h + 3, 8, 2.1, 0.55]);

  for (const [x, y, width, height, rotation] of placements) {
    const strip = new THREE.Mesh(geometry, material);
    strip.position.set(x, y, 2.9);
    strip.rotation.z = rotation;
    strip.scale.set(width, height, 1);
    group.add(strip);
  }
  return group;
}
