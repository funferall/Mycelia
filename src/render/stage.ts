import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GRID } from '../sim/content';
import { mulberry32 } from '../sim/rng';
import { CameraRig } from './camera';
import { makePaperTexture, makeSkyTexture } from './textures';

/** Half-width and half-height of the mount, in world units. */
export const MOUNT_HALF_W = GRID.cols / 2;
export const MOUNT_HALF_H = GRID.rows / 2;

/**
 * The sheet.
 *
 * The scene is a sheet of dark mounting paper with a specimen on it, lit by one
 * raking museum light. There is no sky, no ground plane and no horizon: every
 * object in the game lives on this sheet, and the only light the world produces
 * on its own comes out of the network.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  /** Where the specimen and the sheet live, so callers can add to either. */
  readonly world = new THREE.Group();
  private readonly paper: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
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
    key.position.set(-60, 120, 90);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x35506b, 0.7);
    fill.position.set(80, -40, 60);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x2a2119, 1.1));

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
    this.scene.add(this.paper);

    // The one band of light in the world that the network did not make: a low
    // warm glow above the soil line, so the trunks read as silhouettes against
    // the canopy rather than vanishing into black paper.
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 98),
      new THREE.MeshBasicMaterial({
        map: makeSkyTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
      })
    );
    sky.position.set(0, MOUNT_HALF_H + 34, -12.6);
    this.scene.add(sky);

    // The mount: a near-black backing so the specimen reads as one solid object
    // lifted off the sheet, rather than grit scattered on paper.
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(MOUNT_HALF_W * 2 + 2.4, MOUNT_HALF_H * 2 + 2.4, 4.6),
      new THREE.MeshStandardMaterial({ color: '#0a0807', roughness: 1, metalness: 0 })
    );
    backing.position.z = -2.6;
    this.scene.add(backing);

    this.scene.add(makeTapeStrips());

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    // Threshold is set above the soil's albedo so only the network blooms —
    // paper, tape and grit must never catch the glow.
    // Only the brightest cores of the network should bloom. A low threshold
    // catches the whole mass and turns it into a single white shape.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.44);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    this.rig.resize(width / Math.max(1, height));
  }

  render(dt: number): void {
    this.rig.update(dt);
    this.composer.render(dt);
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
