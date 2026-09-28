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
 *
 * Tiers come from `forest-manifest.json`. The game asks for the tier a tree's
 * projected size deserves and always gets *something* drawable: the exact tier
 * when it has arrived, the nearest loaded tier until then, and the procedural
 * stand when no tier has loaded at all.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type AssetId =
  | 'tree.oak'
  | 'tree.birch'
  | 'tree.hemlock'
  | 'understory.oak-sapling'
  | 'understory.birch-sapling'
  | 'understory.hemlock-sapling'
  | 'understory.fern'
  | 'understory.grass'
  | 'prop.stump'
  | 'prop.log'
  | 'prop.snag'
  | 'prop.boulder'
  /**
   * Reproductive bodies. The ids match `forest-manifest.json` exactly, so the
   * manifest's own tiers and triangle counts apply to them rather than being
   * dropped as unrecognised.
   */
  | 'fungus.fruitingBody'
  | 'fungus.fruiting-cluster'
  | 'fungus.spore-body'
  | 'fungus.porcini-button'
  | 'fungus.porcini-opening'
  | 'fungus.porcini-mature'
  | 'fungus.chanterelle'
  | 'fungus.amethyst-deceiver'
  | 'fungus.underground-fruiting-body';

export interface AssetSpec {
  readonly id: AssetId;
  /** Path under `public/assets/`, so the build serves it beside the bundle. */
  readonly file: string;
  /** What the game uses it for, for the registry readout and failure notes. */
  readonly use: string;
}

/**
 * The registry the game falls back to when `forest-manifest.json` cannot be
 * read. A missing file is not an error state: the procedural renderer keeps
 * drawing that thing and the failure is recorded for the console and for
 * `assets.failed`.
 */
export const ASSETS: readonly AssetSpec[] = [
  { id: 'fungus.porcini-button', file: 'fungi/porcini-button.glb', use: 'Boletus edulis button' },
  { id: 'fungus.porcini-opening', file: 'fungi/porcini-opening.glb', use: 'Boletus edulis opening cap' },
  { id: 'fungus.porcini-mature', file: 'fungi/porcini-mature.glb', use: 'Boletus edulis mature bloom' },
  { id: 'fungus.chanterelle', file: 'fungi/chanterelle.glb', use: 'Cantharellus cibarius art candidate' },
  { id: 'fungus.amethyst-deceiver', file: 'fungi/amethyst-deceiver.glb', use: 'Laccaria amethystina art candidate' },
  { id: 'tree.oak', file: 'trees/oak.glb', use: 'oak crown' },
  { id: 'tree.birch', file: 'trees/birch.glb', use: 'birch crown' },
  { id: 'tree.hemlock', file: 'trees/hemlock.glb', use: 'hemlock crown' },
  { id: 'understory.oak-sapling', file: 'understory/oak-sapling.glb', use: 'young oak in a gap' },
  { id: 'understory.birch-sapling', file: 'understory/birch-sapling.glb', use: 'young birch in a gap' },
  { id: 'understory.hemlock-sapling', file: 'understory/hemlock-sapling.glb', use: 'young hemlock in a gap' },
  { id: 'understory.fern', file: 'understory/fern.glb', use: 'fern in moist shade' },
  { id: 'understory.grass', file: 'understory/grass.glb', use: 'grass in an opening' },
  { id: 'prop.stump', file: 'props/stump.glb', use: 'cut trunk on the forest floor' },
  { id: 'prop.log', file: 'props/log.glb', use: 'fallen log on the forest floor' },
  { id: 'prop.snag', file: 'props/snag.glb', use: 'standing dead wood' },
  { id: 'prop.boulder', file: 'props/boulder.glb', use: 'exposed rock' },
  { id: 'fungus.spore-body', file: 'fungi/spore-body.glb', use: 'erupting primordium' },
  { id: 'fungus.fruitingBody', file: 'fungi/fruiting-body.glb', use: 'a rising fruiting body' },
  { id: 'fungus.fruiting-cluster', file: 'fungi/fruiting-cluster.glb', use: 'a bloom that has released its spores' },
  { id: 'fungus.underground-fruiting-body', file: 'fungi/underground-fruiting-body.glb', use: 'subterranean reproductive body' },
];

/** Every id the runtime knows how to ask for. */
const KNOWN_IDS: ReadonlySet<string> = new Set(ASSETS.map((spec) => spec.id));

/** One tier of an authored model, as the manifest declares it. */
export interface AssetTier {
  readonly file: string;
  readonly triangles: number;
}

/** Materials the season recolours, with the colour the author shipped. */
export interface TintedMaterial {
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
}

/** One placed copy of a model, scaled and prepared for the simulation to tint. */
export interface AssetInstance {
  readonly id: AssetId;
  /** Which tier this copy actually wears, which may not be the tier asked for. */
  readonly tier: number;
  object: THREE.Object3D;
  /** Foliage materials, which take the season's colour. */
  foliage: TintedMaterial[];
  /** Everything else, tinted by health alone. */
  wood: TintedMaterial[];
  /** Height of this instance in world units, after scaling. */
  height: number;
}

/** One mesh of a model, in the model's own space, for instanced batching. */
export interface BatchPart {
  /** Shared with every other copy of this tier: never disposed by a batch. */
  readonly geometry: THREE.BufferGeometry;
  /** The model's own material, which a batch clones once. */
  readonly material: THREE.MeshStandardMaterial;
  /** The part's transform relative to the model's root. */
  readonly matrix: THREE.Matrix4;
  /** Whether the season recolours this part. */
  readonly foliage: boolean;
}

/**
 * A model reduced to what an instanced batch needs.
 *
 * The ground-contact correction is returned separately rather than baked in,
 * because each instance stands at its own height: a caller scales the model by
 * `height / authoredHeight` and lifts it by `groundOffset * scale` before
 * applying the part's own matrix.
 */
export interface BatchSource {
  readonly tier: number;
  readonly authoredHeight: number;
  readonly groundOffset: number;
  readonly parts: readonly BatchPart[];
}

const FOLIAGE = /leaf|leaves|needle|foliage|canopy/i;

/** The registry file under `public/assets/`. */
const MANIFEST = 'assets/forest-manifest.json';

function tierKey(id: AssetId, tier: number): string {
  return `${id}#${tier}`;
}

/**
 * Loads authored models once and hands out instances of them.
 *
 * Loading is opportunistic and parallel. A caller loads the library, keeps
 * running with procedural art, and asks again later; nothing waits on the
 * network for the game to start or for a frame to be drawn.
 */
export class AssetLibrary {
  /**
   * Called whenever a model finishes loading.
   *
   * A caller that draws from the shared geometry (the forest dressing) uses
   * this to rebuild once its art has arrived, instead of guessing when to look.
   */
  onLoad: (() => void) | null = null;

  private readonly entries = new Map<AssetId, readonly AssetTier[]>();
  private readonly models = new Map<string, THREE.Object3D>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly failed = new Set<string>();
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

  /** How many tiers the registry knows for `id`; zero when it is unknown. */
  tiers(id: AssetId): number {
    return this.entries.get(id)?.length ?? 0;
  }

  has(id: AssetId, tier = 0): boolean {
    return this.models.has(tierKey(id, tier));
  }

  /** How many models are still in flight, for the render report and its checks. */
  get loading(): number {
    return this.pending.size;
  }

  /** Every tier the registry declares, summed across assets. */
  get expected(): number {
    let total = 0;
    for (const tiers of this.entries.values()) total += tiers.length;
    return total;
  }

  async load(): Promise<void> {
    await this.loadRegistry();
    await Promise.all(
      [...this.entries.keys()].map((id) => this.loadTier(id, 0))
    );
    this.settled = true;
    // Every remaining tier is a warm-up, never a gate: a tree draws at whatever
    // tier has arrived and refines when a finer one lands. Nothing awaits this.
    for (const id of this.entries.keys()) {
      for (let tier = 1; tier < this.tiers(id); tier++) this.request(id, tier);
    }
  }

  /**
   * Read `forest-manifest.json`, falling back to the built-in registry.
   *
   * The manifest is art metadata: ids, tier files and triangle counts. Anything
   * unrecognised is ignored rather than fatal, and an id the manifest omits
   * keeps its fallback path, so a pack that is mid-rebuild still leaves the
   * rest of the game drawing.
   */
  private async loadRegistry(): Promise<void> {
    const base = import.meta.env.BASE_URL ?? './';
    let declared = false;
    try {
      const response = await fetch(`${base}${MANIFEST}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = (await response.json()) as { assets?: unknown };
      if (!Array.isArray(manifest.assets)) throw new Error('no assets array');
      for (const raw of manifest.assets) {
        const asset = raw as { id?: unknown; lods?: unknown };
        if (typeof asset.id !== 'string' || !KNOWN_IDS.has(asset.id)) continue;
        if (!Array.isArray(asset.lods)) continue;
        const tiers: AssetTier[] = [];
        for (const rawTier of asset.lods) {
          const tier = rawTier as { file?: unknown; triangles?: unknown };
          if (typeof tier.file !== 'string' || tier.file.length === 0) continue;
          tiers.push({
            file: tier.file,
            triangles: typeof tier.triangles === 'number' ? tier.triangles : 0,
          });
        }
        if (tiers.length > 0) this.entries.set(asset.id as AssetId, tiers);
      }
      declared = this.entries.size > 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.problems.push(`${MANIFEST} did not load: ${message}`);
    }
    if (!declared) {
      // No usable manifest: every known asset is its own single tier.
      for (const spec of ASSETS) this.entries.set(spec.id, [{ file: spec.file, triangles: 0 }]);
      return;
    }
    // A usable manifest that omits an id keeps that id's fallback path.
    for (const spec of ASSETS) {
      if (!this.entries.has(spec.id)) this.entries.set(spec.id, [{ file: spec.file, triangles: 0 }]);
    }
  }

  /** Ask for a tier and wait for it; resolves false when it cannot be loaded. */
  async loadTier(id: AssetId, tier = 0): Promise<boolean> {
    const spec = this.entries.get(id)?.[tier];
    if (!spec) return false;
    const key = tierKey(id, tier);
    if (this.models.has(key)) return true;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    if (this.failed.has(key)) return false;
    const promise = this.fetchTier(id, spec.file, key);
    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Ask for a tier without waiting. A caller keeps drawing what it already has
   * and asks again next frame; a failed file is not re-fetched.
   */
  request(id: AssetId, tier = 0): void {
    const key = tierKey(id, tier);
    if (this.models.has(key) || this.pending.has(key) || this.failed.has(key)) return;
    void this.loadTier(id, tier);
  }

  private async fetchTier(id: AssetId, file: string, key: string): Promise<boolean> {
    const base = import.meta.env.BASE_URL ?? './';
    try {
      const gltf = await new GLTFLoader().loadAsync(`${base}assets/${file}`);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      this.models.set(key, root);
      this.onLoad?.();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failed.add(key);
      this.problems.push(`${id} (${file}) did not load: ${message}`);
      return false;
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * A fresh copy of `id`, scaled so it stands `height` world units tall.
   *
   * `tier` is a request, not a promise: the exact tier is used when it has
   * loaded, otherwise the nearest available tier (finer wins a tie, so art
   * never looks worse than it has to while a file is still arriving).
   *
   * The returned object's own `position.y` carries the ground-contact
   * correction, so a caller placing it on terrain adds the terrain height to
   * that rather than overwriting it. Materials are cloned per instance: a
   * hundred trees share one file, but each keeps its own health and season.
   */
  instance(id: AssetId, height: number, tier = 0): AssetInstance | null {
    const found = this.nearestLoaded(id, tier);
    if (!found) return null;
    const source = found.root;

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

    return { id, tier: found.tier, object, foliage, wood, height };
  }

  /**
   * Which tier `instance()` would actually use, without building a copy.
   *
   * A caller deciding whether to swap an already-placed model asks this first,
   * so a request that would fall back to the tier on screen costs nothing.
   */
  resolveTier(id: AssetId, tier = 0): number | null {
    return this.nearestLoaded(id, tier)?.tier ?? null;
  }

  /**
   * The shared geometry and materials of one tier, for a caller that draws many
   * copies through `InstancedMesh`.
   *
   * `instance()` clones an object hierarchy per copy, which is the right price
   * for seventy-five playable trees and the wrong price for hundreds of pieces
   * of scenery. This hands back the model's own parts instead, so a batch can
   * write one matrix per decoration and share every buffer.
   */
  batchParts(id: AssetId, tier = 0, preferCoarser = false): BatchSource | null {
    const found = this.nearestLoaded(id, tier, preferCoarser);
    if (!found) return null;
    const source = found.root;
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    const parts: BatchPart[] = [];
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material || !material.isMeshStandardMaterial) return;
      parts.push({
        geometry: mesh.geometry,
        material,
        matrix: mesh.matrixWorld.clone(),
        foliage: FOLIAGE.test(material.name),
      });
    });
    if (parts.length === 0) return null;
    return {
      tier: found.tier,
      authoredHeight: Math.max(0.001, bounds.max.y - bounds.min.y),
      groundOffset: -bounds.min.y,
      parts,
    };
  }

  /** The exact tier when loaded, else the closest one that is. */
  private nearestLoaded(
    id: AssetId,
    tier: number,
    preferCoarser = false
  ): { tier: number; root: THREE.Object3D } | null {
    const count = this.tiers(id);
    if (count === 0) return null;
    const wanted = Math.min(count - 1, Math.max(0, Math.round(tier)));
    for (let step = 0; step < count; step++) {
      // Finer (lower) tiers are tried first on a tie: better art, same cost to
      // the caller, and the tree refines to the requested tier when it lands.
      // A caller drawing scenery asks for the opposite, because for background
      // vegetation the coarse file is the right fallback rather than the finest.
      const candidates =
        step === 0
          ? [wanted]
          : preferCoarser
            ? [wanted + step, wanted - step]
            : [wanted - step, wanted + step];
      for (const candidate of candidates) {
        if (candidate < 0 || candidate >= count) continue;
        const root = this.models.get(tierKey(id, candidate));
        if (root) return { tier: candidate, root };
      }
    }
    return null;
  }
}
