import * as THREE from 'three';
import { GRID, SPECIES, type SeasonId } from '../sim/content';
import { mulberry32 } from '../sim/rng';
import type { Tree, World } from '../sim/world';
import { makeGlowTexture } from './textures';

/**
 * Everything above the soil line, plus the roots that reach down into it.
 *
 * Trees are agents, not scenery: their canopy colour tracks the season, their
 * trunks thin as they lose health, and a bonded root tip goes from a cold
 * speck to a lit junction. The player should be able to read the health of the
 * whole forest from across the room.
 */

const SEASON_FOLIAGE: Record<SeasonId, THREE.Color> = {
  // The canopy is a near-silhouette, not a bright mass. Against the lit paper
  // above the mount it should read as the dark edge of a forest, and a dying
  // stand goes fully to black.
  spring: new THREE.Color('#151c0f'),
  summer: new THREE.Color('#0e1309'),
  autumn: new THREE.Color('#1d1308'),
  winter: new THREE.Color('#0c0b08'),
};

const BONDED = new THREE.Color('#ffd489');
const UNBONDED = new THREE.Color('#bcae86');

interface TreeVisual {
  tree: Tree;
  trunk: THREE.Mesh;
  base: THREE.Vector3;
  blobs: number[];
}

export class ForestView {
  readonly group = new THREE.Group();

  private readonly world: World;
  private readonly visuals: TreeVisual[] = [];
  private readonly trunkMesh: THREE.InstancedMesh;
  private readonly foliageMesh: THREE.InstancedMesh;
  private readonly rootLines: THREE.LineSegments;
  private readonly tipPoints: THREE.Points;
  private readonly tipCapacity: number;
  private readonly rng: () => number;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private season: SeasonId = 'spring';

  constructor(world: World, radiusScale = 1) {
    this.world = world;
    this.rng = mulberry32(world.seed ^ 0x7a11f00d);

    const trees = world.trees;
    const trunkGeometry = new THREE.CylinderGeometry(0.42, 0.85, 1, 7, 1, true);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      // White base colour: the per-instance colour carries the real value, and
      // a tinted base would multiply against it a second time.
      color: '#ffffff',
      roughness: 0.88,
      metalness: 0,
      flatShading: true,
    });
    this.trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, Math.max(1, trees.length));
    this.trunkMesh.frustumCulled = false;

    const foliageGeometry = new THREE.IcosahedronGeometry(1, 1);
    const foliageMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    this.foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, Math.max(1, trees.length * 5));
    this.foliageMesh.frustumCulled = false;

    this.group.add(this.trunkMesh, this.foliageMesh);

    // Roots: polylines from each trunk base down to every root tip.
    const rootSegments: number[] = [];
    let tipTotal = 0;
    for (const tree of trees) tipTotal += tree.rootTips.length;

    // One running index across the canopy, so every blob's matrix and colour
    // stay attached to the same instance. (Deriving the slot from the array
    // length inside the loop gave every blob of a tree the same index.)
    let foliageIndex = 0;

    for (const tree of trees) {
      const spec = SPECIES[tree.species];
      const baseX = tree.gx - GRID.cols / 2 + 0.5;
      const baseY = GRID.rows / 2;
      const base = new THREE.Vector3(baseX, baseY, 0);
      const blobs: number[] = [];

      // Trunk. Height and girth both follow the tree's maturity.
      const height = tree.height * (0.7 + tree.maturity * 0.5);
      this.dummy.position.set(baseX, baseY + height / 2, 0);
      this.dummy.rotation.set(0, this.rng() * Math.PI, 0);
      this.dummy.scale.set(
        (0.5 + tree.maturity * 0.7) * radiusScale,
        height,
        (0.5 + tree.maturity * 0.7) * radiusScale
      );
      this.dummy.updateMatrix();
      this.trunkMesh.setMatrixAt(this.visuals.length, this.dummy.matrix);

      // Canopy blobs clustered around the crown.
      const crownY = baseY + height;
      const blobCount = 3 + Math.floor(this.rng() * 3);
      for (let i = 0; i < blobCount; i++) {
        const slot = foliageIndex++;
        blobs.push(slot);
        const spread = 3 + this.rng() * 6;
        this.dummy.position.set(
          baseX + (this.rng() - 0.5) * spread * 2,
          crownY + (this.rng() - 0.5) * spread * 1.1,
          (this.rng() - 0.5) * 4
        );
        this.dummy.rotation.set(this.rng() * Math.PI, this.rng() * Math.PI, this.rng() * Math.PI);
        const s = (1.5 + this.rng() * 2.1) * (0.7 + tree.maturity * 0.5);
        this.dummy.scale.set(s, s * (0.6 + this.rng() * 0.5), s);
        this.dummy.updateMatrix();
        this.foliageMesh.setMatrixAt(slot, this.dummy.matrix);
      }

      // Root polylines, wobbling as they descend.
      for (const tip of tree.rootTips) {
        const tipX = tip.gx - GRID.cols / 2 + 0.5;
        const tipY = -(tip.gy + 0.5) + GRID.rows / 2;
        const steps = 5;
        let px = baseX;
        let py = baseY;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const wobble = Math.sin(t * Math.PI) * (this.rng() - 0.5) * 3.2;
          const nx = baseX + (tipX - baseX) * t + wobble;
          const ny = baseY + (tipY - baseY) * t;
          rootSegments.push(px, py, 0, nx, ny, 0);
          px = nx;
          py = ny;
        }
      }

      this.visuals.push({ tree, trunk: this.trunkMesh, base, blobs });
      void spec;
    }

    this.trunkMesh.count = this.visuals.length;
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.foliageMesh.count = this.visuals.reduce((n, v) => n + v.blobs.length, 0);
    this.foliageMesh.visible = false; // Fine botanical foliage is supplied by Canopy.
    this.foliageMesh.instanceMatrix.needsUpdate = true;

    const rootGeometry = new THREE.BufferGeometry();
    rootGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(rootSegments), 3)
    );
    this.rootLines = new THREE.LineSegments(
      rootGeometry,
      new THREE.LineBasicMaterial({
        color: '#88734f',
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.rootLines.frustumCulled = false;
    this.group.add(this.rootLines);

    // Root tips: the only places a symbiosis can form.
    // Trees extend new root tips as they mature, so the buffer is sized for
    // growth rather than for the stand as it stands at minute zero.
    this.tipCapacity = Math.max(32, tipTotal * 5);
    const tipGeometry = new THREE.BufferGeometry();
    tipGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.tipCapacity * 3), 3)
    );
    tipGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(this.tipCapacity * 3), 3)
    );
    this.tipPoints = new THREE.Points(
      tipGeometry,
      new THREE.PointsMaterial({
        size: 1.8,
        map: makeGlowTexture(),
        depthTest: false,
        sizeAttenuation: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
        toneMapped: false,
      })
    );
    this.tipPoints.frustumCulled = false;
    this.group.add(this.tipPoints);

    this.refresh();
  }

  setSeason(season: SeasonId): void {
    this.season = season;
    this.refresh();
  }

  /** Re-derive colours and sizes from tree state. Cheap enough to run on a beat. */
  refresh(): void {
    const foliageBase = SEASON_FOLIAGE[this.season];
    let tipIndex = 0;
    const tipPos = this.tipPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tipCol = this.tipPoints.geometry.getAttribute('color') as THREE.BufferAttribute;

    for (let v = 0; v < this.visuals.length; v++) {
      const visual = this.visuals[v] as TreeVisual;
      const tree = visual.tree;
      const health = Math.max(0.05, tree.health);

      // A dying tree gets thinner and greyer; a dead one is a snag.
      const height = tree.height * (0.7 + tree.maturity * 0.5);
      this.dummy.position.set(visual.base.x, visual.base.y + height / 2, 0);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(
        (0.5 + tree.maturity * 0.7) * (0.55 + health * 0.5),
        height,
        (0.5 + tree.maturity * 0.7) * (0.55 + health * 0.5)
      );
      this.dummy.updateMatrix();
      this.trunkMesh.setMatrixAt(v, this.dummy.matrix);
      this.color.set(tree.species === 'birch' ? '#8c8770' : '#594a36').lerp(new THREE.Color('#5a5348'), 1 - health);
      this.trunkMesh.setColorAt(v, this.color);

      for (const blobIndex of visual.blobs) {
        this.color.copy(foliageBase).multiplyScalar(0.25 + health * 0.55);
        // Winter thins the canopy rather than greying it.
        this.foliageMesh.setColorAt(blobIndex, this.color);
      }

      for (const tip of tree.rootTips) {
        if (tipIndex >= this.tipCapacity) break;
        tipPos.setXYZ(
          tipIndex,
          tip.gx - GRID.cols / 2 + 0.5,
          -(tip.gy + 0.5) + GRID.rows / 2,
          0
        );
        this.color.copy(tip.bondedTo === null ? UNBONDED : BONDED);
        if (tip.bondedTo !== null) this.color.multiplyScalar(0.6 + tree.health * 0.6);
        tipCol.setXYZ(tipIndex, this.color.r, this.color.g, this.color.b);
        tipIndex++;
      }
    }

    this.trunkMesh.instanceMatrix.needsUpdate = true;
    if (this.trunkMesh.instanceColor) this.trunkMesh.instanceColor.needsUpdate = true;
    if (this.foliageMesh.instanceColor) this.foliageMesh.instanceColor.needsUpdate = true;
    tipPos.needsUpdate = true;
    tipCol.needsUpdate = true;
    this.tipPoints.geometry.setDrawRange(0, tipIndex);
  }

  update(dt: number): void {
    this.refreshAccumulator += dt;
    if (this.refreshAccumulator < 0.4) return;
    this.refreshAccumulator = 0;
    this.refresh();
  }

  private refreshAccumulator = 0;

  /** Nearest unbonded root tip to a point, for click-to-bond. */
  nearestTip(gx: number, gy: number, maxDist = 4): { treeId: number; tipId: number } | null {
    let best: { treeId: number; tipId: number } | null = null;
    let bestDist = maxDist;
    for (const tree of this.world.trees) {
      if (tree.dead) continue;
      for (const tip of tree.rootTips) {
        if (tip.bondedTo !== null) continue;
        const d = Math.hypot(tip.gx - gx, tip.gy - gy);
        if (d < bestDist) {
          bestDist = d;
          best = { treeId: tree.id, tipId: tip.id };
        }
      }
    }
    return best;
  }
}
