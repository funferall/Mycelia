import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID, SEASONS, type SeasonId } from '../sim/content';
import type { Tree, World } from '../sim/world';
import { mulberry32 } from '../sim/rng';
import { makeGlowTexture } from './textures';
import { makeForestFloorMaterial } from './forest-floor';
import type { ForestFloorField } from './forest-floor-field';
import { foliageColour } from './seasons';
import { type AssetId, type AssetInstance, type AssetLibrary } from './assets';
import { LOD_TIERS, projectedHeightFraction, selectLodTier } from './lod';
import type { QualityPreset } from './quality';

const FLOOR = GRID.rows / 2;
/** One stand is a square of ground this wide, in world units. */
export const TILE_SIZE = GRID.cols;
export const FOREST_DEPTH = TILE_SIZE;
/** The season's foliage colour, shared with the background dressing. */
export const SEASON_FOLIAGE: Record<SeasonId, string> = { spring: '#869b49', summer: '#55703b', autumn: '#bd7833', winter: '#796c4d' };
/** Authored forms of each species; a tree's own seed picks its form. */
const TREE_FORMS: Record<string, readonly AssetId[]> = {
  oak: ['tree.oak-broad', 'tree.oak-tall', 'tree.oak-old'],
  birch: ['tree.birch-single', 'tree.birch-twin', 'tree.birch-leaning'],
  hemlock: ['tree.hemlock-full', 'tree.hemlock-young', 'tree.hemlock-windswept'],
};
function treeAsset(tree: { species: string; seed: number; burned?: { remains?: string } }): AssetId | undefined {
  // Burned remains that have given everything to the soil leave a stump.
  if (tree.burned?.remains === 'stump') return 'prop.charred-stump';
  // A tree the fire killed stands as its species' charred snag.
  if (tree.burned && TREE_FORMS[tree.species]) return `tree.${tree.species}-charred` as AssetId;
  const forms = TREE_FORMS[tree.species];
  return forms?.[(mulberry32(tree.seed ^ 0x3f0a)() * forms.length) | 0];
}
const DEAD_COLOR = new THREE.Color('#6c5840');
/** Evergreen foliage keeps its own colour through every season. */
export const HEMLOCK_LEAF = new THREE.Color('#496448');

/** Release the geometry of a procedural body that an authored model replaced. */
function disposeBody(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
}

/**
 * Release a placed model's own materials.
 *
 * Materials are cloned per instance, so they belong to the instance; geometry
 * is shared with every other copy of that tier and must not be disposed here.
 */
function releaseInstance(instance: AssetInstance): void {
  for (const tint of instance.foliage) tint.material.dispose();
  for (const tint of instance.wood) tint.material.dispose();
}

/**
 * Where a stand sits in the region, and how high the ground is there.
 *
 * `heightAt` takes region coordinates, so every tile's floor is a window onto
 * one continuous surface: two neighbours sample the same line at their shared
 * edge and cannot disagree about it.
 */
export interface ForestTile {
  /** Stand id, so a crown can be traced back to the ground it stands in. */
  id: number;
  originX: number;
  originY: number;
  /** Only the regional perimeter gets a skirt; shared edges stay open. */
  edges?: readonly ('north' | 'south' | 'west' | 'east')[];
  heightAt(x: number, y: number): number;
}

/**
 * Presentation coordinates only. Root IDs and the soil simulation never move.
 *
 * The tree's own column is its position *within the stand*; depth into the tile
 * comes from its seed, so a tree keeps its place as the canopy grows and the
 * region is never a grid of trees in a row.
 */
export function treeSurfacePosition(tree: Tree, tile?: ForestTile): THREE.Vector3 {
  const rng = mulberry32(tree.seed ^ 0x9af2);
  const localX = tree.gx - GRID.cols / 2 + 0.5;
  const localZ = 10 + rng() * (TILE_SIZE - 26);
  const ground = tile ? tile.heightAt(tile.originX + tree.gx, tile.originY + localZ) : 0;
  return new THREE.Vector3(localX, FLOOR + ground, -localZ);
}

interface StandingTree {
  tree: Tree;
  group: THREE.Group;
  leaves: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  material: THREE.MeshStandardMaterial;
  /** An authored model, once one is loaded for this species. */
  model: AssetInstance | null;
  /** The asset the model comes from, once one has been asked for. */
  assetId: AssetId | null;
  /** The tier this tree wears, and the projected size that chose it. */
  lod: number;
  projected: number;
  leafCount: number;
  home: THREE.Vector3;
  initialMaturity: number;
  /** Seconds this view has shown the tree falling, once the storm threw it down. */
  fallClock?: number;
  /** True once a burned or parched crown has had its foliage removed. */
  crownBurned?: boolean;
  /** The soft glow a tree wears while the player's mycelium holds a bond with it. */
  glow: THREE.Sprite[];
}

/**
 * True while the player holds a living bond with this tree: one of its root
 * tips is bonded, and not to a rival colony. These are the trees that count
 * toward holding a stand.
 */
export function playerHolds(tree: Tree): boolean {
  if (tree.dead) return false;
  return tree.rootTips.some((tip) => tip.bondedTo !== null && !(tip.bondedColonyId ?? '').startsWith('rival'));
}

/** A tree the wildfire took: blackened bark and a few scorched leaves. */
const CHAR_WOOD = new THREE.Color(0.035, 0.03, 0.026);
const CHAR_LEAF = new THREE.Color(0.07, 0.04, 0.02);
/** A tree the drought killed: grey, sun-bleached, standing bare. */
const BLEACHED_WOOD = new THREE.Color(0.42, 0.39, 0.34);

/** How long a felled tree takes to reach the ground, in seconds. */
const FALL_SECONDS = 2.4;
/** Resting angle of a felled tree: not quite flat, propped on its crown. */
const FALLEN_ANGLE = 1.42;
const leanAxis = new THREE.Vector3();
const leanTurn = new THREE.Quaternion();

/** Tilt `group` by `angle` toward regional `direction` (regional +y is scene -z). */
function leanToward(group: THREE.Object3D, direction: number, angle: number): void {
  if (angle === 0) return;
  // Axis = up × downwind, so a positive turn carries the crown downwind.
  leanAxis.set(-Math.sin(direction), 0, -Math.cos(direction));
  group.quaternion.premultiply(leanTurn.setFromAxisAngle(leanAxis, angle));
}

/** One living stand, unfolded above the transect and folded back onto its roots. */
export class SurfaceForest {
  readonly group = new THREE.Group();
  readonly ground = new THREE.Group();
  readonly trees: StandingTree[] = [];
  readonly pickTargets: THREE.Mesh[] = [];
  private readonly time = { value: 0 };
  private readonly leafDrift: THREE.InstancedMesh;
  private readonly rain: THREE.LineSegments;
  private readonly rainPositions = new Float32Array(360 * 6);
  private readonly dummy = new THREE.Object3D();
  /** Scratch vectors for the per-tree level-of-detail pass. */
  private readonly lodPoint = new THREE.Vector3();
  private readonly lodCamera = new THREE.Vector3();
  private readonly floorSurface = makeForestFloorMaterial();
  private readonly selection: THREE.Mesh;
  /** Baked tree shadows, kept in one group so the QA preset can omit them. */
  private readonly shadows = new THREE.Group();
  private readonly shadowTexture = makeGlowTexture(64);
  /**
   * The bonded-tree glow: one warm halo in the crown and a fainter warmth at
   * the foot, shared by every held tree so it breathes as one network.
   */
  private readonly haloMaterial = new THREE.SpriteMaterial({
    map: makeGlowTexture(64), color: '#ffc46e', transparent: true, opacity: 0.18,
    // Seen through its own leaves: the glow belongs to the whole crown.
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false,
  });
  private readonly footMaterial = new THREE.SpriteMaterial({
    map: makeGlowTexture(64), color: '#ffb04a', transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  private weather = 0;
  private propsPlaced = false;
  selectedId: number | null = null;

  constructor(private readonly world: World, private readonly tile?: ForestTile, private readonly assets?: AssetLibrary, private readonly floorField?: ForestFloorField) {
    const rng = mulberry32(world.seed ^ 0x6f123);
    const floorGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 68, 68);
    floorGeometry.rotateX(-Math.PI / 2);
    floorGeometry.translate(0, FLOOR, -TILE_SIZE / 2);
    const p = floorGeometry.attributes.position;
    const habitat: number[] = [];
    const uv = floorGeometry.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const rx = (this.tile?.originX ?? 0) + x + TILE_SIZE / 2;
      const ry = (this.tile?.originY ?? 0) - z;
      p.setY(i, FLOOR + this.groundHeight(x, z));
      const sample = floorField?.(rx, ry);
      habitat.push(sample?.moss ?? .25, sample?.litter ?? .5, sample?.wet ?? 0, sample?.shade ?? 0);
      uv.setXY(i, rx, ry);
    }
    floorGeometry.setAttribute('habitat', new THREE.Float32BufferAttribute(habitat, 4));
    floorGeometry.computeVertexNormals();
    // Sample normals beyond each tile edge, so adjacent meshes light identically.
    if (this.tile) {
      const normal = floorGeometry.attributes.normal;
      const n = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        const x = uv.getX(i), y = uv.getY(i), h = this.tile.heightAt;
        n.set(h(x - 1, y) - h(x + 1, y), 2, h(x, y + 1) - h(x, y - 1)).normalize();
        normal.setXYZ(i, n.x, n.y, n.z);
      }
    }
    const floor = new THREE.Mesh(floorGeometry, this.floorSurface.material);
    floor.userData.ground = true;
    floor.userData.standId = this.tile?.id ?? 0;
    this.pickTargets.push(floor);
    this.ground.add(floor);
    if (tile?.edges?.length) {
      const positions: number[] = [];
      for (const edge of tile.edges) {
        for (let i = 0; i < 68; i++) {
          const point = (step: number) => {
            const t = step * TILE_SIZE / 68;
            const x = edge === 'west' ? -TILE_SIZE / 2 : edge === 'east' ? TILE_SIZE / 2 : t - TILE_SIZE / 2;
            const z = edge === 'north' ? 0 : edge === 'south' ? -TILE_SIZE : -t;
            return [x, FLOOR + this.groundHeight(x, z), z];
          };
          const a = point(i), b = point(i + 1);
          const bottomA = [a[0]!, FLOOR - 24, a[2]!], bottomB = [b[0]!, FLOOR - 24, b[2]!];
          positions.push(...a, ...bottomA, ...b, ...b, ...bottomA, ...bottomB);
        }
      }
      const skirt = new THREE.BufferGeometry();
      skirt.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      skirt.computeVertexNormals();
      this.ground.add(new THREE.Mesh(skirt, new THREE.MeshStandardMaterial({ color: '#30271c', roughness: 1, side: THREE.DoubleSide })));
    }
    this.ground.add(this.shadows);
    this.group.add(this.ground);

    // Small fragments gather in litter pockets; authored ferns/grass are batched regionally.
    const litter = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 2), new THREE.MeshStandardMaterial({ color: '#80704c', roughness: 1 }), 700);
    let fragments = 0;
    for (let i = 0; i < 1400 && fragments < 700; i++) {
      const x = (rng() - .5) * TILE_SIZE, z = -rng() * TILE_SIZE;
      const sample = floorField?.((this.tile?.originX ?? 0) + x + TILE_SIZE / 2, (this.tile?.originY ?? 0) - z);
      if (sample && (sample.wet > .4 || rng() > sample.litter * .7)) continue;
      this.dummy.position.set(x, FLOOR + this.groundHeight(x, z) + .035, z);
      this.dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      const size = .12 + rng() * .32;
      this.dummy.scale.set(size, .025, size * .5);
      this.dummy.updateMatrix();
      litter.setMatrixAt(fragments++, this.dummy.matrix);
    }
    litter.count = fragments;
    this.ground.add(litter);

    for (const tree of world.trees) this.addTree(tree);
    const ring = new THREE.RingGeometry(2.5, 2.65, 64);
    ring.rotateX(-Math.PI / 2);
    this.selection = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#e7d2a0', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.selection.visible = false;
    this.group.add(this.selection);

    this.leafDrift = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 2), new THREE.MeshStandardMaterial({ color: '#b49750', side: THREE.DoubleSide, roughness: 0.9 }), 90);
    this.leafDrift.frustumCulled = false;
    this.group.add(this.leafDrift);
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#b4c3b8', transparent: true, opacity: 0.15, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  private addTree(tree: Tree): void {
    const rng = mulberry32(tree.seed);
    const home = treeSurfacePosition(tree, this.tile);
    const group = new THREE.Group();
    const h = tree.height * (0.7 + tree.maturity * 0.5);
    const evergreen = tree.species === 'hemlock';
    const parts: THREE.BufferGeometry[] = [];
    const leafPositions: THREE.Vector3[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const addBranch = (a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
      const direction = b.clone().sub(a);
      const part = new THREE.CylinderGeometry(radius * 0.48, radius, direction.length(), 6);
      part.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()));
      part.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      parts.push(part);
    };
    addBranch(new THREE.Vector3(), new THREE.Vector3(0, h, 0), 0.7 + tree.maturity * 0.3);
    const twig = (a: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, depth: number) => {
      const b = a.clone().addScaledVector(direction, length);
      addBranch(a, b, radius);
      if (depth > 0) {
        for (let j = 0; j < 3; j++) {
          const d = direction.clone().add(new THREE.Vector3((rng() - 0.5) * 1.5, 0.25 + rng() * 0.45, (rng() - 0.5) * 1.5)).normalize();
          twig(b, d, length * (0.5 + rng() * 0.22), radius * 0.48, depth - 1);
        }
      } else {
        for (let j = 0; j < 34; j++) {
          const theta = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (evergreen ? 1.6 : 2.3);
          leafPositions.push(a.clone().lerp(b, rng()).add(new THREE.Vector3(Math.cos(theta) * r, (rng() - 0.5) * 2, Math.sin(theta) * r)));
        }
      }
    };
    for (let i = 0; i < 14; i++) {
      const fraction = 0.38 + i / 14 * 0.57;
      const angle = i * 2.399 + rng() * 0.4;
      const length = evergreen ? h * (1 - fraction) * 0.65 : h * (0.2 + Math.sin(fraction * Math.PI) * 0.13);
      twig(new THREE.Vector3(0, h * fraction, 0), new THREE.Vector3(Math.cos(angle), evergreen ? 0.12 : 0.55, Math.sin(angle)).normalize(), length, 0.23 * (1 - fraction) + 0.08, 2);
    }
    // Root flares stay anchored when the crown moves.
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 0.4;
      addBranch(new THREE.Vector3(Math.cos(a) * 2, 0.05, Math.sin(a) * 2), new THREE.Vector3(0, 1.7, 0), 0.22);
    }
    // The procedural body keeps its own group so an authored model can replace
    // it wholesale without disturbing the selector volume or the tree's anchors.
    const body = new THREE.Group();
    body.userData.proceduralBody = true;
    const woodMaterial = new THREE.MeshStandardMaterial({ color: tree.species === 'birch' ? '#aaa58d' : '#65533d', roughness: 1 });
    const wood = new THREE.Mesh(mergeGeometries(parts), woodMaterial);
    parts.forEach(part => part.dispose());
    body.add(wood);

    const material = new THREE.MeshStandardMaterial({ color: SEASON_FOLIAGE.spring, roughness: 0.85, side: THREE.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.uniforms.windTime = this.time;
      shader.vertexShader = 'uniform float windTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.z += sin(windTime * 1.8 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z) * .22 * abs(position.x);');
    };
    const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 2), material, leafPositions.length);
    leafPositions.forEach((position, i) => {
      this.dummy.position.copy(position);
      this.dummy.rotation.set(rng() * 2, rng() * 6.28, rng() * 6.28);
      const s = 0.35 + rng() * 0.4;
      this.dummy.scale.set(s, 0.045, s * (evergreen ? 0.32 : 0.58));
      this.dummy.updateMatrix();
      leaves.setMatrixAt(i, this.dummy.matrix);
      leaves.setColorAt(i, new THREE.Color().setScalar(0.65 + rng() * 0.5));
    });
    body.add(leaves);
    group.add(body);
    // An invisible volume makes crowns easy to select, even between individual leaves.
    const pick = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = h * 0.72;
    pick.scale.set(h * 0.4, h * 0.45, h * 0.4);
    pick.userData.treeId = tree.id;
    pick.userData.standId = this.tile?.id ?? 0;
    group.add(pick);
    this.pickTargets.push(pick);
    // Hidden until the player bonds with this tree.
    const halo = new THREE.Sprite(this.haloMaterial);
    halo.position.y = h * 0.7;
    halo.scale.set(h * 0.9, h * 0.8, 1);
    const foot = new THREE.Sprite(this.footMaterial);
    foot.position.y = h * 0.04;
    foot.scale.set(h * 0.42, h * 0.16, 1);
    for (const sprite of [halo, foot]) {
      sprite.visible = false;
      sprite.renderOrder = 2;
      sprite.raycast = () => {};
      group.add(sprite);
    }
    this.group.add(group);
    const entry: StandingTree = {
      tree,
      group,
      leaves,
      material,
      model: null,
      assetId: null,
      lod: 0,
      projected: 0,
      leafCount: leaves.count,
      home,
      initialMaturity: tree.maturity,
      glow: [halo, foot],
    };
    this.trees.push(entry);
    // If art is already loaded, the stand opens with it rather than swapping a
    // frame later in front of the player.
    this.dress(entry);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(h * 1.5, h * 1.5), new THREE.MeshBasicMaterial({ map: this.shadowTexture, color: '#121a0d', transparent: true, opacity: 0.7, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(home.x + 2, FLOOR + this.groundHeight(home.x, home.z) + 0.15, home.z);
    this.shadows.add(shadow);
  }

  /**
   * Ground height at a point in this stand, in world units above the soil line.
   * Without a tile the stand is its own little world and the ground is the
   * prototype's own relief; with one it is a window onto the region.
   */
  private groundHeight(localX: number, localZ: number): number {
    if (!this.tile) return relief(localX, localZ);
    return this.tile.heightAt(this.tile.originX + localX + GRID.cols / 2, this.tile.originY - localZ);
  }

  /**
   * Dress one tree in the authored model for its species, if there is one.
   *
   * The same path serves a stand built after art has loaded and a stand built
   * before it, so a model arriving late swaps in rather than requiring a reload.
   * Scale comes from the simulation's own tree height, which is what keeps art
   * and simulation the same picture across both views.
   */
  private dress(entry: StandingTree, tier = entry.lod): void {
    if (!this.assets) return;
    const id = treeAsset(entry.tree);
    if (!id) return;
    // A different model (a burned tree becoming its charred snag), not just a
    // different tier of the same one.
    const swapped = entry.assetId !== null && entry.assetId !== id;
    entry.assetId = id;
    // Resolve before cloning: a request that would fall back to the tier
    // already on screen must not build and throw away a copy of it.
    const available = this.assets.resolveTier(id, tier);
    if (available === null) return;
    if (entry.model && entry.model.tier === available && !swapped) return;
    // A stump is its own size, not the tree's.
    const height = id === 'prop.charred-stump' ? 1.3 : entry.tree.height * (0.7 + entry.tree.maturity * 0.5);
    const model = this.assets.instance(id, height, available);
    if (!model) return;
    // A tier swap changes geometry only: the placed copy keeps the exact
    // ground contact, scale and rotation it already had, so refining a tree
    // never moves it or pops its roots out of the soil.
    const previous = entry.model;
    if (previous) {
      // A new model keeps its own fit to the tree; only a tier swap of the
      // same model copies the placed transform.
      if (!swapped) {
        model.object.position.copy(previous.object.position);
        model.object.quaternion.copy(previous.object.quaternion);
        model.object.scale.copy(previous.object.scale);
      }
      entry.group.remove(previous.object);
      releaseInstance(previous);
    } else {
      const body = entry.group.children.find((child) => child.userData.proceduralBody);
      if (body) {
        entry.group.remove(body);
        disposeBody(body);
      }
    }
    entry.group.add(model.object);
    entry.model = model;
    entry.lod = model.tier;
  }

  /**
   * Take delivery of art that finished loading after this stand was built.
   *
   * Idempotent by construction: a tree already wearing a model is skipped, and
   * the floor props are laid out once.
   */
  adoptAssets(): void {
    if (!this.assets) return;
    for (const entry of this.trees) this.dress(entry, entry.lod);
    if (!this.propsPlaced) {
      this.propsPlaced = true;
      this.addProps();
    }
  }

  /**
   * Give every tree the tier its own size on screen deserves.
   *
   * Projected height is a fraction of the viewport rather than a pixel count,
   * so the fast QA preset's half-resolution buffer does not change which meshes
   * load. The hysteresis itself lives in `selectLodTier`, where it is testable
   * without a renderer.
   */
  updateLod(camera: THREE.PerspectiveCamera): void {
    if (!this.assets) return;
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.lodCamera);
    for (const entry of this.trees) {
      const id = entry.assetId ?? treeAsset(entry.tree);
      if (!id) continue;
      entry.assetId = id;
      const height = entry.tree.height * (0.7 + entry.tree.maturity * 0.5);
      entry.group.updateWorldMatrix(true, false);
      entry.group.getWorldPosition(this.lodPoint);
      const distance = Math.hypot(
        this.lodPoint.x - this.lodCamera.x,
        this.lodPoint.y + height / 2 - this.lodCamera.y,
        this.lodPoint.z - this.lodCamera.z
      );
      const projected = projectedHeightFraction(height, distance, camera.fov);
      entry.projected = projected;
      const tier = selectLodTier(projected, entry.lod);
      if (entry.model && entry.model.tier === tier) continue;
      this.dress(entry, tier);
      // If the tier is not in the library yet, ask for it and keep drawing the
      // nearest one that is until it lands.
      if (!entry.model || entry.model.tier !== tier) this.assets.request(id, tier);
    }
  }

  /** How many trees currently wear each tier, finest first. */
  lodTiers(): number[] {
    const counts = new Array<number>(LOD_TIERS).fill(0);
    for (const entry of this.trees) {
      if (!entry.model) continue;
      counts[entry.model.tier] = (counts[entry.model.tier] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Where one tree's authored model sits, for the browser checks that prove a
   * tier swap changes geometry and nothing else. Returns null while the tree is
   * still wearing the procedural body.
   */
  modelRecord(treeId: number): {
    tier: number;
    assetId: AssetId;
    position: number[];
    quaternion: number[];
    scale: number[];
    world: number[];
  } | null {
    const entry = this.trees.find((candidate) => candidate.tree.id === treeId);
    if (!entry?.model) return null;
    entry.model.object.updateWorldMatrix(true, false);
    entry.model.object.getWorldPosition(this.lodPoint);
    return {
      tier: entry.model.tier,
      assetId: entry.model.id,
      position: entry.model.object.position.toArray(),
      quaternion: entry.model.object.quaternion.toArray(),
      scale: entry.model.object.scale.toArray(),
      world: this.lodPoint.toArray(),
    };
  }

  /** Apply the rendering preset's presentation-only switches. */
  setQuality(quality: Pick<QualityPreset, 'surfaceShadows'>): void {
    this.shadows.visible = quality.surfaceShadows;
  }

  /**
   * Scatter the authored deadwood a forest floor is missing.
   *
   * Seeded and presentation-only. A stand with no art is the procedural stand,
   * not a stand with holes in it, so every prop is skipped when its model is
   * absent rather than replaced with a stand-in.
   */
  private addProps(): void {
    if (this.floorField) return; // Regional dressing owns masked, grounded deadwood.
    const rng = mulberry32(this.world.seed ^ 0x5eed1);
    for (let i = 0; i < 3; i++) {
      const id: AssetId = rng() < 0.6 ? 'prop.stump' : 'prop.log';
      const instance = this.assets?.instance(id, id === 'prop.stump' ? 1.5 : 1.1);
      if (!instance) continue;
      instance.object.userData.assetProp = id;
      const x = (rng() - 0.5) * (GRID.cols - 14);
      const z = -6 - rng() * (TILE_SIZE - 18);
      // The instance carries its own ground-contact correction in `position.y`,
      // so the terrain height is added to it rather than replacing it.
      instance.object.position.x += x;
      instance.object.position.y += FLOOR + this.groundHeight(x, z);
      instance.object.position.z += z;
      instance.object.rotation.y = rng() * Math.PI * 2;
      this.ground.add(instance.object);
    }
  }

  crownPosition(treeId: number): THREE.Vector3 | null {
    const v = this.trees.find(entry => entry.tree.id === treeId);
    return v ? v.group.localToWorld(new THREE.Vector3(0, v.tree.height * 0.9, 0)) : null;
  }

  /** Which stand this surface is. */
  get standId(): number {
    return this.tile?.id ?? 0;
  }

  /** Where one of this stand's crowns stands, in this surface's own frame. */
  surfacePosition(treeId: number): THREE.Vector3 | null {
    const entry = this.trees.find((tree) => tree.tree.id === treeId);
    return entry ? treeSurfacePosition(entry.tree, this.tile) : null;
  }

  nearestTree(x: number, z: number): Tree | null {
    let best: Tree | null = null, distance = Infinity;
    for (const v of this.trees) {
      const d = Math.hypot(v.home.x - x, v.home.z - z);
      if (d < distance) { best = v.tree; distance = d; }
    }
    return best;
  }

  update(dt: number, blend: number, season: SeasonId, progress: number, reduced: boolean, wind?: { direction: number; strength: number; storm?: number }): void {
    this.time.value += reduced ? 0 : dt;
    const t = this.time.value;
    const seasonIndex = SEASONS.findIndex(s => s.id === season);
    const next = SEASONS[(seasonIndex + 1) % SEASONS.length].id;
    const fade = THREE.MathUtils.smoothstep(progress, 0.65, 1);
    const densities: Record<SeasonId, number> = { spring: 0.85, summer: 1, autumn: 0.7, winter: 0.04 };
    const density = THREE.MathUtils.lerp(densities[season], densities[next], fade);
    this.ground.scale.z = Math.max(0.006, blend);
    this.ground.visible = blend > 0.01;
    this.floorSurface.update(season, progress, this.world.rainfall);
    for (const v of this.trees) {
      const health = v.tree.dead ? 0 : v.tree.health;
      const growth = (0.7 + v.tree.maturity * 0.5) / (0.7 + v.initialMaturity * 0.5);
      v.group.position.set(v.home.x, FLOOR + (v.home.y - FLOOR) * blend, v.home.z * blend);
      v.group.scale.set(growth, growth, growth * (0.22 + 0.78 * blend));
      const gust = Math.sin(t * 0.48 + v.home.x * 0.055) * 0.008 + Math.sin(t * 1.1 + v.home.z) * 0.002;
      v.group.rotation.set(reduced ? 0 : gust * 0.5, 0, reduced ? 0 : gust);
      // Only the forest view leans or topples: the folded underground view keeps
      // its trees upright over the roots they belong to.
      const unfold = THREE.MathUtils.smoothstep(blend, 0.3, 0.9);
      if (v.tree.fallen && v.tree.burned?.remains !== 'stump') {
        v.fallClock = (v.fallClock ?? 0) + (reduced ? FALL_SECONDS : dt);
        // Slow at first, then gathering speed as it goes over.
        const f = Math.min(1, v.fallClock / FALL_SECONDS);
        leanToward(v.group, v.tree.fallen.direction, FALLEN_ANGLE * f * f * unfold);
      } else if (wind?.storm && !v.tree.dead) {
        const phase = v.home.x * 0.13 + v.home.z * 0.07;
        const buffet = reduced ? 0 : Math.sin(t * 2.3 + phase) * 0.045 + Math.sin(t * 5.1 + phase * 3) * 0.018;
        leanToward(v.group, wind.direction, wind.storm * (0.1 + buffet) * unfold);
      }
      const dim = 0.48 + blend * 0.52;
      // The fire's kill: swap to the charred snag the moment it is recorded.
      if (v.tree.burned && v.assetId && v.assetId !== treeAsset(v.tree)) this.dress(v, v.lod);
      const charred = (v.assetId?.endsWith('-charred') || v.assetId === 'prop.charred-stump') ?? false;
      if (v.model) {
        // Authored foliage takes the season's colour; bark keeps the artist's
        // and only browns as the tree's health falls.
        const leaf = foliageColour(v.tree.species, season, progress);
        // A burned crown has lost its leaves: collapse the foliage meshes once.
        // The batches read world matrices, so a zero scale draws nothing.
        if ((v.tree.burned || v.tree.parched) && !v.crownBurned) {
          v.crownBurned = true;
          const burnt = new Set(v.model.foliage.map((tint) => tint.material));
          v.model.object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh && burnt.has(mesh.material as THREE.MeshStandardMaterial)) mesh.scale.setScalar(1e-4);
          });
        }
        for (const tint of v.model.foliage) {
          if (v.tree.burned) tint.material.color.copy(CHAR_LEAF).multiplyScalar(dim);
          else tint.material.color.copy(leaf).lerp(DEAD_COLOR, 1 - health).multiplyScalar(dim);
        }
        for (const tint of v.model.wood) {
          // A charred model carries its own char, scorch and ember colours.
          if (charred) tint.material.color.copy(tint.base).multiplyScalar(dim);
          else if (v.tree.burned) tint.material.color.copy(CHAR_WOOD).multiplyScalar(dim);
          else if (v.tree.parched) tint.material.color.copy(tint.base).lerp(BLEACHED_WOOD, 0.75).multiplyScalar(dim);
          else tint.material.color.copy(tint.base).lerp(DEAD_COLOR, (1 - health) * 0.7).multiplyScalar(dim);
        }
      } else {
        if (v.tree.burned) v.material.color.copy(CHAR_WOOD);
        else if (v.tree.parched) v.material.color.copy(BLEACHED_WOOD);
        else v.material.color.copy(foliageColour(v.tree.species, season, progress)).lerp(DEAD_COLOR, 1 - health);
        v.material.color.multiplyScalar(dim);
        v.leaves.count = Math.floor(v.leafCount * (v.tree.species === 'hemlock' ? 0.95 : density) * health);
      }
    }
    // The held trees glow above ground only, and breathe slowly together.
    const shown = blend > 0.3;
    const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.1);
    this.haloMaterial.opacity = (0.2 + 0.1 * breath) * THREE.MathUtils.smoothstep(blend, 0.3, 0.9);
    this.footMaterial.opacity = (0.3 + 0.12 * breath) * THREE.MathUtils.smoothstep(blend, 0.3, 0.9);
    for (const v of this.trees) {
      const held = shown && !v.tree.fallen && playerHolds(v.tree);
      for (const sprite of v.glow) sprite.visible = held;
    }
    const selected = this.trees.find(v => v.tree.id === this.selectedId);
    this.selection.visible = !!selected && blend > 0.8;
    if (selected) this.selection.position.copy(selected.group.position).add(new THREE.Vector3(0, 0.2, 0));

    // Cosmetic weather follows the existing rainfall model, never mutating it.
    const wet = Math.max(0, Math.min(1, (this.world.rainfall - 0.6) * 0.8));
    this.weather += (wet - this.weather) * Math.min(1, dt * 0.3);
    this.rain.visible = blend > 0.5 && !reduced && this.weather > 0.05;
    (this.rain.material as THREE.LineBasicMaterial).opacity = this.weather * blend * 0.2;
    for (let i = 0; i < 360; i++) {
      const x = Math.sin(i * 124.7) * GRID.cols * 0.49;
      const z = -(0.5 + 0.5 * Math.sin(i * 31.9)) * FOREST_DEPTH;
      const y = FLOOR + 2 + ((i * 1.37 - t * 22) % 48 + 48) % 48;
      const lean = wind ? .65 + wind.strength : .7;
      const dx = Math.cos(wind?.direction ?? .37) * lean;
      const dz = -Math.sin(wind?.direction ?? .37) * lean;
      this.rainPositions.set([x, y, z, x - dx, y + 2.5, z - dz], i * 6);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.leafDrift.visible = !reduced;
    this.leafDrift.count = season === 'autumn' ? 90 : season === 'winter' ? 5 : 22;
    for (let i = 0; i < this.leafDrift.count; i++) {
      const v = this.trees[i % this.trees.length];
      if (!v) break;
      const phase = (t * 0.75 + i * 3.17) % 30;
      this.dummy.position.set(v.home.x + Math.sin(i * 1.3 + phase * 0.3) * 3 + phase * 0.12, FLOOR + 30 - phase, v.home.z * blend + Math.sin(i + phase * 0.2) * 2);
      this.dummy.rotation.set(phase * 0.8, i + phase * 0.3, phase);
      this.dummy.scale.set(0.33, 0.04, 0.18);
      this.dummy.updateMatrix();
      this.leafDrift.setMatrixAt(i, this.dummy.matrix);
    }
    this.leafDrift.instanceMatrix.needsUpdate = true;
  }
}

function relief(x: number, z: number): number {
  return Math.min(1, -z / 8) * (0.6 + Math.sin(x * 0.1 + z * 0.08) * 0.5 + Math.sin(z * 0.23 - x * 0.15) * 0.3);
}
