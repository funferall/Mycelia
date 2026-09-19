/**
 * Asset intake: the single door through which authored 3D models enter the
 * game.
 *
 * The contract an artist — or a modelling agent — builds to lives in
 * `DESIGN.md` and is repeated here because this file is what enforces it:
 *
 * - glTF 2.0 binary (`.glb`), Y-up, metres, no baked lighting;
 * - origin at ground contact: the base of the trunk, or the underside of a prop;
 * - materials named so foliage can be told from wood, with `leaf`, `needle` or
 *   `foliage` in the name getting the season's colour;
 * - an optional empty named `anchor_crown` marks the point the game selects,
 *   frames the camera on and hangs airborne effects from.
 *
 * Nothing here is required for the game to run. Every lookup can miss, every
 * load can fail, and the caller falls back to the procedural stand that shipped
 * first. That is what lets art arrive one file at a time, and what keeps the
 * browser checks meaningful while a model is still being made.
 *
 * The pipeline is deliberately presentation-only: models are scaled, anchored
 * and tinted to the simulation's own trees and never feed numbers back into it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type AssetId =
  | 'tree.oak'
  | 'tree.birch'
  | 'tree.hemlock'
  | 'prop.stump'
  | 'prop.log'
  | 'fungus.fruitingBody';

export interface AssetSpec {
  readonly id: AssetId;
  /** Path under `public/assets/`, so the build serves it beside the bundle. */
  readonly file: string;
  /** What the game uses it for, for the registry readout and failure notes. */
  readonly use: string;
}

/**
 * Every model the game will look for. A missing file is not an error state:
 * the procedural renderer keeps drawing that thing and the failure is recorded
 * for the console and for `assets.failed`.
 */
export const ASSETS: readonly AssetSpec[] = [
  { id: 'tree.oak', file: 'trees/oak.glb', use: 'oak crown' },
  { id: 'tree.birch', file: 'trees/birch.glb', use: 'birch crown' },
  { id: 'tree.hemlock', file: 'trees/hemlock.glb', use: 'hemlock crown' },
  { id: 'prop.stump', file: 'props/stump.glb', use: 'cut trunk on the forest floor' },
  { id: 'prop.log', file: 'props/log.glb', use: 'fallen log on the forest floor' },
  { id: 'fungus.fruitingBody', file: 'fungi/fruiting-body.glb', use: 'fruiting body' },
];

/** Materials the season recolours, with the colour the author shipped. */
export interface TintedMaterial {
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
}

/** One placed copy of a model, scaled and prepared for the simulation to tint. */
export interface AssetInstance {
  object: THREE.Object3D;
  /** Foliage materials, which take the season's colour. */
  foliage: TintedMaterial[];
  /** Everything else, tinted by health alone. */
  wood: TintedMaterial[];
  /** Height of this instance in world units, after scaling. */
  height: number;
}

const FOLIAGE = /leaf|leaves|needle|foliage|canopy/i;

/**
 * Loads authored models once and hands out instances of them.
 *
 * Loading is opportunistic and parallel. A caller loads the library, keeps
 * running with procedural art, and asks again later; nothing waits on the
 * network for the game to start or for a frame to be drawn.
 */
export class AssetLibrary {
  private readonly models = new Map<AssetId, THREE.Object3D>();
  private readonly problems: string[] = [];
  private settled = false;

  /** True once every asset has either loaded or been recorded as missing. */
  get ready(): boolean {
    return this.settled;
  }

  /** Human-readable notes for every model that did not load. */
  get failures(): readonly string[] {
    return this.problems;
  }

  /** How many models are available right now. */
  get size(): number {
    return this.models.size;
  }

  has(id: AssetId): boolean {
    return this.models.has(id);
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    // `base` is relative in this build, so every URL resolves against the page
    // and the bundle survives being mounted at any sub-path.
    const base = import.meta.env.BASE_URL ?? './';
    await Promise.all(
      ASSETS.map(async (spec) => {
        try {
          const gltf = await loader.loadAsync(`${base}assets/${spec.file}`);
          const root = gltf.scene;
          root.updateMatrixWorld(true);
          this.models.set(spec.id, root);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.problems.push(`${spec.id} (${spec.file}) did not load: ${message}`);
        }
      })
    );
    this.settled = true;
  }

  /**
   * A fresh copy of `id`, scaled so it stands `height` world units tall.
   *
   * The returned object's own `position.y` carries the ground-contact
   * correction, so a caller placing it on terrain adds the terrain height to
   * that rather than overwriting it. Materials are cloned per instance: a
   * hundred trees share one file, but each keeps its own health and season.
   */
  instance(id: AssetId, height: number): AssetInstance | null {
    const source = this.models.get(id);
    if (!source) return null;

    // Height comes from the model itself rather than a declared number, so an
    // author cannot be wrong about it; the contract's origin-at-base rule is
    // what the bounding box cannot infer and must be authored correctly.
    const bounds = new THREE.Box3().setFromObject(source);
    const authored = Math.max(0.001, bounds.max.y - bounds.min.y);
    const scale = height / authored;

    const object = source.clone(true);
    object.scale.multiplyScalar(scale);
    object.position.y -= bounds.min.y * scale;

    const foliage: TintedMaterial[] = [];
    const wood: TintedMaterial[] = [];
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = source.map((material) => {
        const copy = (material as THREE.MeshStandardMaterial).clone();
        const tier = FOLIAGE.test(copy.name) ? foliage : wood;
        tier.push({ material: copy, base: copy.color.clone() });
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    return { object, foliage, wood, height };
  }
}
