/**
 * The forest's background vegetation, drawn as instance batches (`ASSET-04`).
 *
 * Everything here is presentation. The decorations come from the pure layout in
 * `forest-dressing-layout.ts`, they have no simulation identity, they are never
 * added to a pick target list, and nothing they do can reach `World.trees` or
 * the network.
 *
 * The drawing is built for hundreds of static pieces:
 *
 * - Every model part is normalised once - unit height, base at the origin, its
 *   authored colour baked into a vertex-colour attribute. One instance matrix
 *   then means the same thing for a 20-unit oak and a 4-unit sapling, and the
 *   parts of one model merge into a single wood or foliage geometry with no
 *   wasted triangles.
 * - Those merged geometries and their two materials are shared across the whole
 *   region, so a batch is one (tier, asset, category) group. The region draws
 *   `visible tiers x used assets x 2`, never one draw per tree.
 * - Each decoration earns its own tier from its own size on screen, with the
 *   same hysteresis the playable trees use. Assignments are re-checked every
 *   frame and only rewritten when one of them actually changes.
 * - Wind is a shader term phased by the instance's own translation, and reduced
 *   motion simply stops the clock. No matrices are rewritten to sway.
 * - Season tint is written to instance colours only when the tint changes.
 *
 * The scenery has no roots, so it does not fold into the soil. It leaves with
 * the surface fade instead: by the time the camera is through the ground the
 * terrain is opaque over it, and nothing invented is left beneath the specimen.
 */
import * as THREE from 'three';
import { foliageColour } from './seasons';
import { GRID, type SeasonId } from '../sim/content';
import type { AssetId, AssetLibrary, BatchPart } from './assets';
import { projectedHeightFraction, selectLodTier } from './lod';
import {
  layoutForestDressing,
  type DecorationKind,
  type DressingBand,
  type DressingRegion,
  type ForestDecoration,
  type PlayableTrunk,
} from './forest-dressing-layout';
import { SEASON_FOLIAGE } from './surface';

export interface ForestDressingInput {
  readonly region: DressingRegion;
  readonly course: ReadonlyArray<{ x: number; y: number }>;
  readonly playable: readonly PlayableTrunk[];
  /**
   * Region corner of the stand the forest is currently rebased around. Every
   * decoration is placed relative to it, exactly as the stands are.
   */
  readonly sceneOrigin: { readonly x: number; readonly y: number };
  /** Which layers to draw. Canopy and regeneration are trees; the rest is ground. */
  readonly kinds?: readonly DecorationKind[];
  readonly band?: DressingBand;
  readonly stands?: readonly number[];
}

export interface ForestDressingView {
  readonly blend: number;
  readonly season: SeasonId;
  readonly progress: number;
  readonly reduced: boolean;
}

/** Kinds drawn as batched authored models in this changeset. */
export const DRESSING_TREE_KINDS: readonly DecorationKind[] = ['canopy', 'young'];

/** The floor's render height at elevation zero, matching `surface.ts`. */
const FLOOR = GRID.rows / 2;
const TILE = GRID.cols;
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color('#ffffff');
/** Background trees open coarse; a close camera earns them detail. */
const START_TIER = 2;
/**
 * The scenery earns its detail later than a playable tree does.
 *
 * A partner tree is the subject of the picture and refines as soon as it is
 * worth looking at; background canopy is atmosphere, and spending LOD0
 * triangles on it at the region overview buys nothing anyone can see. LOD0 is
 * still reached, but only when a decoration is genuinely large on screen.
 */
const DRESSING_LOD_BANDS = { lod0: 0.3, lod1: 0.12, hysteresis: 0.15 };
/**
 * How much of the descent the scenery survives. The terrain is opaque well
 * before this, so the cut is hidden behind it rather than seen.
 */
const FADE_BLEND = 0.3;

type Category = 'wood' | 'foliage';

interface Batch {
  readonly key: string;
  readonly tier: number;
  readonly asset: AssetId;
  readonly category: Category;
  readonly geometry: THREE.BufferGeometry;
  readonly triangles: number;
  readonly decorations: ForestDecoration[];
}

export class ForestDressing {
  readonly group = new THREE.Group();
  private readonly assets: AssetLibrary;
  private readonly input: ForestDressingInput;
  private readonly time = { value: 0 };
  private readonly cameraPoint = new THREE.Vector3();
  private readonly tint = new THREE.Color('#ffffff');
  private season: SeasonId = 'spring';
  private progress = 0;
  private readonly geometry = new Map<string, { geometry: THREE.BufferGeometry; triangles: number } | null>();
  private readonly materials = new Map<Category, THREE.MeshStandardMaterial>();
  private readonly meshes: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  private band: DressingBand;
  private readonly kinds: readonly DecorationKind[];
  private shown = true;
  private focusStand: number | null = null;
  private decorations: ForestDecoration[] = [];
  private drawn: ForestDecoration[] = [];
  private tiers = new Map<string, number>();
  private built = false;
  private planted = 0;
  private triangleTotal = 0;
  private instanceTotal = 0;
  private highestTier = START_TIER;
  /** Seconds since the last tier pass, and the camera pose it used. */
  private lodClock = 0;
  private readonly lodCamera = new THREE.Vector3(NaN, NaN, NaN);
  /** How many models the library had loaded when the batches were built. */
  private loadedModels = -1;

  constructor(assets: AssetLibrary, input: ForestDressingInput) {
    this.assets = assets;
    this.input = input;
    this.band = input.band ?? 'medium';
    this.kinds = input.kinds ?? ['canopy', 'young', 'fern', 'grass', 'rock', 'deadwood'];
    this.build();
  }

  /** True once the layout has produced anything at all. */
  get ready(): boolean {
    return this.built;
  }

  get builtBand(): DressingBand {
    return this.band;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** The stand the fixture has isolated, or null for the whole region. */
  get focus(): number | null {
    return this.focusStand;
  }

  /**
   * Lay the region out and build the batches.
   *
   * Called at construction, when the band changes, when the fixture isolates a
   * stand, and when previously missing art arrives. A decoration whose model is
   * not loaded is simply not drawn: scenery never blocks on the network and
   * never falls back to a stand-in tree.
   */
  build(band: DressingBand = this.band): void {
    this.band = band;
    this.decorations = layoutForestDressing({
      region: this.input.region,
      playable: this.input.playable,
      course: this.input.course,
      band: this.band,
      stands: this.focusStand === null ? this.input.stands : [this.focusStand],
    });
    const wanted = new Set(this.kinds);
    this.drawn = this.decorations.filter((decoration) => wanted.has(decoration.kind));
    this.tiers = new Map();
    for (const decoration of this.drawn) this.tiers.set(decoration.id, START_TIER);
    this.built = this.decorations.length > 0;
    this.rebuildBatches();
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
  }

  /** Show one stand's dressing on its own, or null for the whole region. */
  setFocus(standId: number | null): void {
    if (this.focusStand === standId) return;
    this.focusStand = standId;
    this.build(this.band);
  }

  /** Every decoration this dressing placed, in layout order. */
  decorationAt(index: number): ForestDecoration | null {
    return this.decorations[index] ?? null;
  }

  /**
   * Give every decoration the tier its own size on screen deserves.
   *
   * Projected height is a fraction of the viewport rather than a pixel count, so
   * the fast QA preset cannot change which meshes load. Batches are rebuilt only
   * when at least one decoration actually changes tier, which the hysteresis in
   * `selectLodTier` keeps rare.
   */
  refine(camera: THREE.PerspectiveCamera, dt: number): void {
    camera.getWorldPosition(this.cameraPoint);
    // Tier work is deliberately low-cadence: a camera that is still gliding
    // would otherwise re-assign and rebuild batches every frame, which is
    // exactly the per-frame work the scenery must not do.
    this.lodClock += dt;
    const moved = this.cameraPoint.distanceToSquared(this.lodCamera) > 0.25;
    if (this.lodClock < 0.35 && !moved) return;
    this.lodClock = 0;
    this.lodCamera.copy(this.cameraPoint);
    // A tier file arriving is a reason to rebuild even when nobody moved: the
    // scenery must not stay on a boot-time fallback for the whole session.
    let changed = this.assets.size !== this.loadedModels;
    this.loadedModels = this.assets.size;
    let highest = 0;
    for (const decoration of this.drawn) {
      const world = this.worldPosition(decoration);
      const distance = Math.hypot(
        world.x - this.cameraPoint.x,
        world.y + decoration.height * 0.5 - this.cameraPoint.y,
        world.z - this.cameraPoint.z
      );
      const projected = projectedHeightFraction(decoration.height, distance, camera.fov);
      const current = this.tiers.get(decoration.id) ?? START_TIER;
      const tier = selectLodTier(projected, current, DRESSING_LOD_BANDS);
      if (tier !== current) {
        this.tiers.set(decoration.id, tier);
        changed = true;
      }
      highest = Math.max(highest, tier);
    }
    if (changed) this.rebuildBatches();
    this.highestTier = highest;
  }

  /** Follow the surface's own fade, tint and clock. */
  update(dt: number, view: ForestDressingView): void {
    this.time.value += view.reduced ? 0 : dt;
    this.season = view.season;
    this.progress = view.progress;
    const colour = seasonColour(view.season, view.progress);
    if (!colour.equals(this.tint)) {
      this.tint.copy(colour);
      this.applyTint();
    }
    for (const mesh of this.meshes) {
      mesh.visible = this.shown && view.blend > FADE_BLEND;
    }
  }

  report(): {
    /** Every decoration the layout placed, whether or not it is on screen. */
    decorations: number;
    /** What the drawn layers planted after art and tier checks. */
    planted: number;
    /** Part instances across every batch; one tree may be several. */
    instances: number;
    /** Stands represented in the current batch set. */
    stands: number;
    focus: number | null;
    visible: boolean;
    band: DressingBand;
    tier: number;
    /** True once every declared tier file has loaded, so nothing is borrowed. */
    settled: boolean;
    draws: number;
    triangles: number;
  } {
    const stands = new Set<number>();
    for (const decoration of this.drawn) stands.add(decoration.standId);
    let draws = 0;
    for (const mesh of this.meshes) if (mesh.visible && mesh.count > 0) draws++;
    return {
      decorations: this.decorations.length,
      planted: this.planted,
      instances: this.instanceTotal,
      stands: this.shown ? stands.size : 0,
      focus: this.focusStand,
      visible: this.shown,
      band: this.band,
      tier: this.highestTier,
      settled: this.assets.size >= this.assets.expected,
      draws,
      triangles: this.triangleTotal,
    };
  }

  dispose(): void {
    this.clearBatches();
    for (const entry of this.geometry.values()) entry?.geometry.dispose();
    this.geometry.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  // -------------------------------------------------------------------------

  /** Where a decoration stands in scene space, in the rebased forest frame. */
  private worldPosition(decoration: ForestDecoration): { x: number; y: number; z: number } {
    return {
      x: decoration.x - this.input.sceneOrigin.x - TILE / 2,
      y: FLOOR + decoration.z,
      z: -(decoration.y - this.input.sceneOrigin.y),
    };
  }

  private clearBatches(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      // Geometry and materials are shared and outlive every batch.
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.planted = 0;
    this.instanceTotal = 0;
    this.triangleTotal = 0;
  }

  /**
   * One batch per tier, asset and category.
   *
   * A decoration whose tier has no loaded file keeps the nearest loaded tier,
   * so the dressing never thins out while art is arriving.
   */
  private rebuildBatches(): void {
    this.clearBatches();
    if (this.drawn.length === 0) return;

    const batches = new Map<string, Batch>();
    for (const decoration of this.drawn) {
      const asset = decoration.asset as AssetId;
      const tier = Math.min(this.tiers.get(decoration.id) ?? START_TIER, Math.max(0, this.assets.tiers(asset) - 1));
      // Scenery falls back to a coarser tier, never to a finer one, and asks
      // for the tier it wants when that file has not arrived yet.
      const resolved = this.assets.batchParts(asset, tier, true);
      if (!resolved) {
        this.assets.request(asset, tier);
        continue;
      }
      // Never draw the scenery finer than it asked to be. Before the coarse
      // files arrive a decoration waits rather than flashing in at LOD0 and
      // then coarsening, which is both the expensive and the ugly way round.
      if (resolved.tier < tier) {
        this.assets.request(asset, tier);
        continue;
      }
      if (resolved.tier !== tier) this.assets.request(asset, tier);
      this.planted++;
      for (const category of ['wood', 'foliage'] as const) {
        const geometry = this.mergedGeometry(asset, resolved.tier, category);
        if (!geometry) continue;
        const key = `${resolved.tier}|${asset}|${category}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = {
            key,
            tier: resolved.tier,
            asset,
            category,
            geometry: geometry.geometry,
            triangles: geometry.triangles,
            decorations: [],
          };
          batches.set(key, batch);
        }
        batch.decorations.push(decoration);
      }
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const colour = new THREE.Color();
    for (const batch of batches.values()) {
      const material = this.categoryMaterial(batch.category);
      const mesh = new THREE.InstancedMesh(batch.geometry, material, batch.decorations.length);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.userData.triangles = batch.triangles;
      mesh.userData.category = batch.category;
      mesh.userData.asset = batch.asset;
      mesh.userData.tier = batch.tier;
      const shades: number[] = [];
      for (const decoration of batch.decorations) {
        const world = this.worldPosition(decoration);
        position.set(world.x, world.y, world.z);
        quaternion.setFromAxisAngle(UP, decoration.yaw);
        if (decoration.kind === 'deadwood' || decoration.kind === 'rock' || decoration.kind === 'fern' || decoration.kind === 'grass') {
          const h = (x: number, y: number) => this.input.region.heightAt(x, y);
          const x = decoration.x, y = decoration.y;
          const normal = new THREE.Vector3(h(x - 1, y) - h(x + 1, y), 2, h(x, y + 1) - h(x, y - 1)).normalize();
          quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(UP, normal));
          position.y -= decoration.height * .07;
        }
        scale.set(decoration.height, decoration.height, decoration.height);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(mesh.count, matrix);
        const shade = 0.9 + decoration.phase * 0.2;
        shades.push(shade);
        colour.copy(
          batch.category === 'foliage' ? this.foliageColour(batch.asset) : WHITE
        ).multiplyScalar(shade);
        mesh.setColorAt(mesh.count, colour);
        mesh.count++;
      }
      mesh.userData.shades = shades;
      mesh.visible = this.shown;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.instanceTotal += mesh.count;
      this.triangleTotal += batch.triangles * mesh.count;
    }
  }

  /**
   * The normalised, merged geometry for one asset, tier and category.
   *
   * Cached per asset rather than per stand: every copy of an oak shares one
   * buffer, which is what keeps the batch count independent of tree count.
   */
  private mergedGeometry(
    asset: AssetId,
    tier: number,
    category: Category
  ): { geometry: THREE.BufferGeometry; triangles: number } | null {
    const key = `${asset}|${tier}|${category}`;
    if (this.geometry.has(key)) return this.geometry.get(key) ?? null;
    const source = this.assets.batchParts(asset, tier, true);
    if (!source) {
      this.geometry.set(key, null);
      return null;
    }
    const parts: PartGeometry[] = [];
    for (const part of source.parts) {
      if (part.foliage !== (category === 'foliage')) continue;
      parts.push({
        part,
        authoredHeight: source.authoredHeight,
        groundOffset: source.groundOffset,
        colour: part.foliage ? WHITE : part.material.color,
      });
    }
    const merged = mergeParts(parts);
    this.geometry.set(key, merged);
    return merged;
  }

  /** The two shared materials. Wood keeps its vertex colours; foliage is tinted. */
  private categoryMaterial(category: Category): THREE.MeshStandardMaterial {
    const existing = this.materials.get(category);
    if (existing) return existing;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: category === 'foliage' ? 0.85 : 1,
      metalness: 0,
    });
    if (category === 'foliage') attachWind(material, this.time);
    this.materials.set(category, material);
    return material;
  }

  /** What one foliage instance wears this season. */
  private foliageColour(asset: AssetId): THREE.Color {
    return foliageColour(asset, this.season, this.progress);
  }

  /**
   * Rewrite the foliage instance colours for the current tint.
   *
   * The per-instance shade jitter is re-derived from the decoration's own phase,
   * so a re-tint is exactly the same picture in a new colour.
   */
  private applyTint(): void {
    for (const mesh of this.meshes) {
      if (mesh.userData.category !== 'foliage' || mesh.count === 0) continue;
      const asset = mesh.userData.asset as AssetId;
      const shades = (mesh.userData.shades as number[] | undefined) ?? [];
      for (let i = 0; i < mesh.count; i++) {
        const shade = shades[i] ?? 1;
        mesh.setColorAt(i, this.foliageColour(asset).multiplyScalar(shade));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** A part, ready to be normalised into a merged geometry. */
interface PartGeometry {
  readonly part: BatchPart;
  readonly authoredHeight: number;
  readonly groundOffset: number;
  readonly colour: THREE.Color;
}

/**
 * Bake parts into one geometry: unit height, base at the origin, authored colour
 * in a vertex attribute.
 *
 * Normals are transformed by the part's own rotation and renormalised; every
 * part here is uniformly scaled, so no inverse-transpose is needed.
 */
function mergeParts(parts: readonly PartGeometry[]): { geometry: THREE.BufferGeometry; triangles: number } | null {
  let vertices = 0;
  let indices = 0;
  for (const entry of parts) {
    const position = entry.part.geometry.attributes.position;
    if (!position) continue;
    vertices += position.count;
    indices += entry.part.geometry.index?.count ?? position.count;
  }
  if (vertices === 0 || indices === 0) return null;

  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const output = new Uint32Array(indices);
  let vertexAt = 0;
  let indexAt = 0;
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  for (const entry of parts) {
    const geometry = entry.part.geometry;
    const position = geometry.attributes.position;
    if (!position) continue;
    const sourceNormal = geometry.attributes.normal;
    normalMatrix.getNormalMatrix(entry.part.matrix);
    const scale = 1 / entry.authoredHeight;
    for (let i = 0; i < position.count; i++) {
      point.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(entry.part.matrix);
      // Lift the base to y = 0, then normalise the height: the instance matrix
      // then only has to place, turn and scale the decoration.
      positions[(vertexAt + i) * 3] = point.x * scale;
      positions[(vertexAt + i) * 3 + 1] = (point.y + entry.groundOffset) * scale;
      positions[(vertexAt + i) * 3 + 2] = point.z * scale;
      if (sourceNormal) {
        normal
          .set(sourceNormal.getX(i), sourceNormal.getY(i), sourceNormal.getZ(i))
          .applyMatrix3(normalMatrix)
          .normalize();
      } else {
        normal.set(0, 1, 0);
      }
      normals[(vertexAt + i) * 3] = normal.x;
      normals[(vertexAt + i) * 3 + 1] = normal.y;
      normals[(vertexAt + i) * 3 + 2] = normal.z;
      colours[(vertexAt + i) * 3] = entry.colour.r;
      colours[(vertexAt + i) * 3 + 1] = entry.colour.g;
      colours[(vertexAt + i) * 3 + 2] = entry.colour.b;
    }
    const index = geometry.index;
    if (index) {
      for (let i = 0; i < index.count; i++) output[indexAt + i] = vertexAt + (index.getX(i) as number);
      indexAt += index.count;
    } else {
      for (let i = 0; i < position.count; i++) output[indexAt + i] = vertexAt + i;
      indexAt += position.count;
    }
    vertexAt += position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  merged.setIndex(new THREE.BufferAttribute(output, 1));
  merged.computeBoundingSphere();
  return { geometry: merged, triangles: indices / 3 };
}

/** The season's foliage colour, crossfading exactly as the forest does. */
function seasonColour(season: SeasonId, progress: number): THREE.Color {
  const ids: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
  const index = Math.max(0, ids.indexOf(season));
  const next = ids[(index + 1) % ids.length] as SeasonId;
  const fade = THREE.MathUtils.smoothstep(progress, 0.65, 1);
  return new THREE.Color(SEASON_FOLIAGE[season]).lerp(new THREE.Color(SEASON_FOLIAGE[next]), fade);
}

/**
 * Shared wind for the foliage material.
 *
 * The phase comes from the instance's own translation, so no per-instance
 * attribute or per-frame matrix write is needed, and the sway is the same kind
 * of motion the playable trees' procedural crowns already use. The geometry is
 * normalised, so `position.y` is a fraction of the tree's own height.
 */
function attachWind(material: THREE.MeshStandardMaterial, time: { value: number }): void {
  material.userData.windTime = time;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = time;
    shader.vertexShader = `uniform float windTime;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
        ' transformed.x += sin(windTime * 1.6 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z) * 0.06 * position.y;\n' +
        ' transformed.z += cos(windTime * 1.4 + instanceMatrix[3].x * 1.3) * 0.05 * position.y;'
    );
  };
}
