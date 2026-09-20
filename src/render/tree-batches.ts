import * as THREE from 'three';
import type { AssetInstance } from './assets';

export interface BatchedTree {
  /** Stable stand:tree identity, independent of tier and batch slot. */
  key: string;
  model: AssetInstance;
  visible: boolean;
}

interface Batch {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  identities: string[];
}

/**
 * Region-wide wood/foliage batches. The existing tree transforms and materials
 * remain the presentation source of truth; their world matrices carry growth,
 * ground correction and wind, and instance colours carry season and health.
 * Picking still uses each tree's stable crown proxy, never a changing slot.
 */
export class TreeBatches {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly parts = new WeakMap<THREE.Object3D, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]>();
  private treeCount = 0;
  private partCount = 0;

  constructor(private readonly capacity: number) {}

  sync(trees: Iterable<BatchedTree>): void {
    this.treeCount = 0;
    this.partCount = 0;
    for (const batch of this.batches.values()) {
      batch.mesh.count = 0;
      batch.identities.length = 0;
    }
    for (const { key, model, visible } of trees) {
      let parts = this.parts.get(model.object);
      if (!parts) {
        parts = [];
        let supported = true;
        model.object.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Unusual replacement assets retain their ordinary rendering path.
          if (Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshStandardMaterial) || (mesh as THREE.SkinnedMesh).isSkinnedMesh) supported = false;
          else parts!.push(mesh as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>);
        });
        if (!supported) parts = [];
        this.parts.set(model.object, parts);
      }
      if (parts.length === 0) { model.object.visible = visible; continue; }
      model.object.visible = false;
      if (!visible) continue;
      this.treeCount++;
      model.object.updateWorldMatrix(true, true);
      // A model may reuse a geometry for several branches: capacity therefore
      // grows per batch, rather than assuming one mesh per tree.
      for (const part of parts) {
        const material = part.material;
        const id = `${model.id}:${model.tier}:${part.geometry.uuid}:${material.name}`;
        let batch = this.batches.get(id);
        if (!batch) {
          const shared = material.clone();
          shared.color.setRGB(1, 1, 1);
          const mesh = new THREE.InstancedMesh(part.geometry, shared, Math.max(1, this.capacity));
          mesh.count = 0;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.frustumCulled = false;
          mesh.castShadow = part.castShadow;
          mesh.receiveShadow = part.receiveShadow;
          batch = { mesh, identities: [] };
          this.batches.set(id, batch);
          this.group.add(mesh);
        }
        if (batch.mesh.count >= batch.mesh.instanceMatrix.count) this.grow(batch);
        const slot = batch.mesh.count++;
        batch.mesh.setMatrixAt(slot, part.matrixWorld);
        batch.mesh.setColorAt(slot, material.color);
        batch.identities[slot] = key;
        this.partCount++;
      }
    }
    for (const batch of this.batches.values()) {
      batch.mesh.visible = batch.mesh.count > 0;
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
  }

  private grow(batch: Batch): void {
    const old = batch.mesh;
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, old.instanceMatrix.count * 2);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    if (old.instanceColor) {
      mesh.setColorAt(0, new THREE.Color());
      mesh.instanceColor!.array.set(old.instanceColor.array);
    }
    mesh.count = old.count;
    mesh.frustumCulled = false;
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    old.removeFromParent();
    old.dispose();
    this.group.add(mesh);
    batch.mesh = mesh;
  }

  report(): { trees: number; parts: number; draws: number; identities: string[] } {
    return {
      trees: this.treeCount,
      parts: this.partCount,
      draws: [...this.batches.values()].filter(batch => batch.mesh.count > 0).length,
      identities: [...new Set([...this.batches.values()].flatMap(batch => batch.identities))].sort(),
    };
  }

  /** Read the stable identity when inspecting an actual instanced hit. */
  identity(mesh: THREE.Object3D, instanceId: number): string | null {
    for (const batch of this.batches.values()) if (batch.mesh === mesh) return batch.identities[instanceId] ?? null;
    return null;
  }
}
