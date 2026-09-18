import * as THREE from 'three';
import { GRID, type SeasonId } from '../sim/content';
import type { World } from '../sim/world';
import { mulberry32 } from '../sim/rng';
import { makeGlowTexture } from './textures';

/** Seeded botanical geometry: tapered branches, individual leaves, ferns and suspended pollen. */
export class Canopy {
  readonly group = new THREE.Group();
  private readonly leaves: THREE.InstancedMesh;
  private readonly leafTrees: number[] = [];
  private readonly leafTints: number[] = [];
  private readonly pollen: THREE.Points;
  private readonly rays: THREE.Mesh;
  private readonly positions = new Float32Array(220 * 3);
  private time = 0;
  private colorClock = 1;
  private readonly matrix = new THREE.Object3D();

  constructor(private readonly world: World) {
    const rng = mulberry32(world.seed ^ 0x43ab);
    const branches: Array<{ a: THREE.Vector3; b: THREE.Vector3; radius: number }> = [];
    const foliage: Array<{ position: THREE.Vector3; scale: number; angle: number; tree: number }> = [];
    for (const tree of world.trees) {
      const x = tree.gx - GRID.cols / 2 + 0.5;
      const y = GRID.rows / 2;
      const h = tree.height * (0.7 + tree.maturity * 0.5);
      const branch = (a: THREE.Vector3, angle: number, length: number, radius: number, depth: number): void => {
        const b = a.clone().add(new THREE.Vector3(Math.sin(angle) * length, Math.cos(angle) * length, (rng() - 0.5) * length * 0.3));
        branches.push({ a, b, radius });
        if (depth > 0) {
          branch(b, angle - 0.35 - rng() * 0.5, length * 0.7, radius * 0.58, depth - 1);
          branch(b, angle + 0.35 + rng() * 0.5, length * 0.73, radius * 0.6, depth - 1);
        }
        if (depth < 2) {
          for (let i = 0; i < 28; i++) {
            const p = a.clone().lerp(b, rng());
            const theta = rng() * Math.PI * 2;
            const r = Math.sqrt(rng()) * (depth ? 2 : 2.8);
            p.add(new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r * 0.65, (rng() - 0.5) * 3));
            foliage.push({ position: p, scale: 0.35 + rng() * 0.6, angle: rng() * Math.PI, tree: tree.id });
          }
        }
      };
      for (let i = 0; i < 7; i++) {
        const side = i % 2 ? -1 : 1;
        branch(new THREE.Vector3(x, y + h * (0.48 + i * 0.066), 0), side * (0.5 + rng() * 0.6), h * (0.16 + rng() * 0.08), 0.22, 3);
      }
    }
    const wood = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 1, 1, 6), new THREE.MeshStandardMaterial({ color: '#64513a', roughness: 0.95 }), branches.length);
    const up = new THREE.Vector3(0, 1, 0);
    branches.forEach((branch, i) => {
      this.matrix.position.copy(branch.a).lerp(branch.b, 0.5);
      const direction = branch.b.clone().sub(branch.a);
      this.matrix.quaternion.setFromUnitVectors(up, direction.clone().normalize());
      this.matrix.scale.set(branch.radius, direction.length(), branch.radius);
      this.matrix.updateMatrix();
      wood.setMatrixAt(i, this.matrix.matrix);
    });
    this.group.add(wood);
    const leafMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
    leafMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.forestTime = { value: 0 };
      leafMaterial.userData.shader = shader;
      shader.vertexShader = 'uniform float forestTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.x += sin(forestTime * 0.65 + instanceMatrix[3].x * 0.4 + instanceMatrix[3].y * 0.3) * 0.14;');
    };
    this.leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 3), leafMaterial, foliage.length);
    foliage.forEach((leaf, i) => {
      this.matrix.position.copy(leaf.position);
      this.matrix.rotation.set(rng(), rng(), leaf.angle);
      this.matrix.scale.set(leaf.scale, leaf.scale * 0.38, 0.035);
      this.matrix.updateMatrix();
      this.leaves.setMatrixAt(i, this.matrix.matrix);
      this.leafTrees.push(leaf.tree);
      this.leafTints.push(0.65 + rng() * 0.65);
    });
    this.group.add(this.leaves);
    // Moss cushions and fern fronds bind the forest to the cut earth.
    const moss = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#414b27', roughness: 1 }), 650);
    for (let i = 0; i < 650; i++) {
      this.matrix.position.set((rng() - 0.5) * GRID.cols, GRID.rows / 2 + rng() * 0.6, rng() * 3);
      this.matrix.rotation.set(rng(), rng(), rng());
      this.matrix.scale.set(0.3 + rng() * 0.6, 0.2 + rng() * 0.5, 0.3);
      this.matrix.updateMatrix();
      moss.setMatrixAt(i, this.matrix.matrix);
    }
    this.group.add(moss);
    const fernPositions: number[] = [];
    for (let i = 0; i < 42; i++) {
      const x = (rng() - 0.5) * GRID.cols;
      for (let f = 0; f < 4; f++) {
        const lean = (f - 1.5) * 0.45;
        const h = 1.2 + rng() * 2;
        for (let j = 0; j < 8; j++) {
          const t = j / 8;
          const px = x + lean * t * h;
          const py = GRID.rows / 2 + Math.sin(t * 1.5) * h;
          for (const side of [-1, 1]) fernPositions.push(px, py, 2, px + side * (1 - t) * 0.65, py + 0.25, 2);
        }
      }
    }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(fernPositions, 3)), new THREE.LineBasicMaterial({ color: '#84915b' })));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.pollen = new THREE.Points(geometry, new THREE.PointsMaterial({ map: makeGlowTexture(), color: '#d8c59a', size: 0.55, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.pollen.frustumCulled = false;
    this.group.add(this.pollen);
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(GRID.cols + 6, 50), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec2 vUv; uniform float uTime; void main(){float beam=pow(max(0.,sin((vUv.x+vUv.y*.23)*48.+sin(uTime*.12)*.3)),18.);float fade=sin(vUv.x*3.14159)*pow(1.-vUv.y,1.5);gl_FragColor=vec4(.64,.52,.31,beam*fade*.13);}',
    }));
    this.rays.position.set(0, GRID.rows / 2 + 24, 5);
    this.group.add(this.rays);
    this.update(0, 'spring', false);
  }

  update(dt: number, season: SeasonId, reduced: boolean): void {
    this.time += reduced ? 0 : dt;
    const shader = (this.leaves.material as THREE.MeshStandardMaterial).userData.shader;
    if (shader) shader.uniforms.forestTime.value = this.time;
    (this.rays.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    for (let i = 0; i < 220; i++) {
      this.positions[i * 3] = Math.sin(i * 128.4 + this.time * 0.014) * GRID.cols * 0.51;
      this.positions[i * 3 + 1] = GRID.rows / 2 + ((i * 0.713 + this.time * 0.35) % 43);
      this.positions[i * 3 + 2] = 2 + Math.sin(i * 97.2) * 6;
    }
    this.pollen.geometry.attributes.position.needsUpdate = true;
    this.colorClock += dt;
    if (this.colorClock < 0.8) return;
    this.colorClock = 0;
    const base = new THREE.Color({ spring: '#64754a', summer: '#465b36', autumn: '#a77a38', winter: '#464839' }[season]);
    const color = new THREE.Color();
    this.leafTrees.forEach((id, i) => {
      const tree = this.world.trees[id];
      color.copy(base).multiplyScalar(this.leafTints[i] * (tree.dead ? 0.12 : 0.35 + tree.health * 0.65));
      this.leaves.setColorAt(i, color);
    });
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
  }
}
