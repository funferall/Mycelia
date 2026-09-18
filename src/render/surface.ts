import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID, SEASONS, type SeasonId } from '../sim/content';
import type { Tree, World } from '../sim/world';
import { mulberry32 } from '../sim/rng';
import { makeGlowTexture } from './textures';

const FLOOR = GRID.rows / 2;
export const FOREST_DEPTH = 76;
const PALETTE: Record<SeasonId, string> = { spring: '#869b49', summer: '#55703b', autumn: '#bd7833', winter: '#796c4d' };

/** Presentation coordinates only. Root IDs and the soil simulation never move. */
export function treeSurfacePosition(tree: Tree): THREE.Vector3 {
  const rng = mulberry32(tree.seed ^ 0x9af2);
  return new THREE.Vector3(tree.gx - GRID.cols / 2 + 0.5, FLOOR, -12 - rng() * 51);
}

interface StandingTree {
  tree: Tree;
  group: THREE.Group;
  leaves: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  material: THREE.MeshStandardMaterial;
  leafCount: number;
  home: THREE.Vector3;
  initialMaturity: number;
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
  private readonly floorMaterial: THREE.MeshStandardMaterial;
  private readonly selection: THREE.Mesh;
  private readonly shadowTexture = makeGlowTexture(64);
  private weather = 0;
  selectedId: number | null = null;

  constructor(private readonly world: World) {
    const rng = mulberry32(world.seed ^ 0x6f123);
    const floorGeometry = new THREE.PlaneGeometry(GRID.cols, FOREST_DEPTH, 68, 38);
    floorGeometry.rotateX(-Math.PI / 2);
    floorGeometry.translate(0, FLOOR, -FOREST_DEPTH / 2);
    const p = floorGeometry.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, FLOOR + relief(x, z));
      const shade = 0.75 + rng() * 0.25;
      const c = new THREE.Color().lerpColors(new THREE.Color('#353b21'), new THREE.Color('#646042'), (Math.sin(x * 0.14 + z * 0.17) + 1) / 2).multiplyScalar(shade);
      colors.push(c.r, c.g, c.b);
    }
    floorGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    floorGeometry.computeVertexNormals();
    this.floorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(floorGeometry, this.floorMaterial);
    floor.userData.ground = true;
    this.pickTargets.push(floor);
    this.ground.add(floor);
    this.group.add(this.ground);

    // Ferns, grass, moss and litter keep the floor legible as a living habitat.
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.65, 0, 0, 0.15, 2.4, 0.3, 0.65, 0, 0, 0, 0, -0.65, -0.3, 1.9, 0.1, 0, 0, 0.65], 3));
    blade.computeVertexNormals();
    const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: '#667448', side: THREE.DoubleSide, roughness: 1 }), 2200);
    const litter = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 2), new THREE.MeshStandardMaterial({ color: '#80704c', roughness: 1 }), 1600);
    for (const mesh of [grass, litter]) {
      for (let i = 0; i < mesh.count; i++) {
        const x = (rng() - 0.5) * (GRID.cols - 2), z = -rng() * FOREST_DEPTH;
        this.dummy.position.set(x, FLOOR + relief(x, z) + 0.1, z);
        this.dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        const s = 0.25 + rng() * 0.65;
        this.dummy.scale.set(s, mesh === litter ? 0.07 : s, mesh === litter ? s * 0.4 : s);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.ground.add(mesh);
    }

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
    const home = treeSurfacePosition(tree);
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
    const woodMaterial = new THREE.MeshStandardMaterial({ color: tree.species === 'birch' ? '#aaa58d' : '#65533d', roughness: 1 });
    const wood = new THREE.Mesh(mergeGeometries(parts), woodMaterial);
    parts.forEach(part => part.dispose());
    group.add(wood);

    const material = new THREE.MeshStandardMaterial({ color: PALETTE.spring, roughness: 0.85, side: THREE.DoubleSide });
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
    group.add(leaves);
    // An invisible volume makes crowns easy to select, even between individual leaves.
    const pick = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = h * 0.72;
    pick.scale.set(h * 0.4, h * 0.45, h * 0.4);
    pick.userData.treeId = tree.id;
    group.add(pick);
    this.pickTargets.push(pick);
    this.group.add(group);
    this.trees.push({ tree, group, leaves, material, leafCount: leaves.count, home, initialMaturity: tree.maturity });

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(h * 1.5, h * 1.5), new THREE.MeshBasicMaterial({ map: this.shadowTexture, color: '#121a0d', transparent: true, opacity: 0.7, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(home.x + 2, FLOOR + relief(home.x, home.z) + 0.15, home.z);
    this.ground.add(shadow);
  }

  crownPosition(treeId: number): THREE.Vector3 | null {
    const v = this.trees.find(entry => entry.tree.id === treeId);
    return v ? v.group.localToWorld(new THREE.Vector3(0, v.tree.height * 0.9, 0)) : null;
  }

  nearestTree(x: number, z: number): Tree | null {
    let best: Tree | null = null, distance = Infinity;
    for (const v of this.trees) {
      const d = Math.hypot(v.home.x - x, v.home.z - z);
      if (d < distance) { best = v.tree; distance = d; }
    }
    return best;
  }

  update(dt: number, blend: number, season: SeasonId, progress: number, reduced: boolean): void {
    this.time.value += reduced ? 0 : dt;
    const t = this.time.value;
    const seasonIndex = SEASONS.findIndex(s => s.id === season);
    const next = SEASONS[(seasonIndex + 1) % SEASONS.length].id;
    const fade = THREE.MathUtils.smoothstep(progress, 0.65, 1);
    const color = new THREE.Color(PALETTE[season]).lerp(new THREE.Color(PALETTE[next]), fade);
    const densities: Record<SeasonId, number> = { spring: 0.85, summer: 1, autumn: 0.7, winter: 0.04 };
    const density = THREE.MathUtils.lerp(densities[season], densities[next], fade);
    this.ground.scale.z = Math.max(0.006, blend);
    this.ground.visible = blend > 0.01;
    this.floorMaterial.roughness = season === 'summer' ? 1 : 0.88;
    for (const v of this.trees) {
      const health = v.tree.dead ? 0 : v.tree.health;
      const growth = (0.7 + v.tree.maturity * 0.5) / (0.7 + v.initialMaturity * 0.5);
      v.group.position.set(v.home.x, FLOOR + relief(v.home.x, v.home.z) * blend, v.home.z * blend);
      v.group.scale.set(growth, growth, growth * (0.22 + 0.78 * blend));
      const gust = Math.sin(t * 0.48 + v.home.x * 0.055) * 0.008 + Math.sin(t * 1.1 + v.home.z) * 0.002;
      v.group.rotation.z = reduced ? 0 : gust;
      v.group.rotation.x = reduced ? 0 : gust * 0.5;
      v.material.color.copy(v.tree.species === 'hemlock' ? new THREE.Color('#496448') : color).lerp(new THREE.Color('#6c5840'), 1 - health);
      v.material.color.multiplyScalar(0.48 + blend * 0.52);
      v.leaves.count = Math.floor(v.leafCount * (v.tree.species === 'hemlock' ? 0.95 : density) * health);
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
      this.rainPositions.set([x, y, z, x - 0.65, y + 2.5, z - 0.25], i * 6);
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
