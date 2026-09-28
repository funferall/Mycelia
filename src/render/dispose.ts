import * as THREE from 'three';

/** Release a wholly owned local view. Never use on shared authored assets. */
export function disposeView(root: THREE.Object3D): void {
  root.removeFromParent();
  const resources = new Set<{ dispose(): void }>();
  root.traverse(object => {
    const drawable = object as THREE.Mesh;
    if (drawable.geometry) resources.add(drawable.geometry);
    if ((object as THREE.InstancedMesh).isInstancedMesh) resources.add(object as THREE.InstancedMesh);
    const materials = drawable.material ? (Array.isArray(drawable.material) ? drawable.material : [drawable.material]) : [];
    for (const material of materials) {
      resources.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
  root.clear();
}

/**
 * Release one copy made by `AssetLibrary.instance()`.
 *
 * An instance clones its materials but borrows its geometry from the library,
 * so disposing the geometry would blank every other copy of that model. This
 * releases the materials alone and detaches the copy from its parent.
 *
 * A procedural fallback built by the caller is wholly owned, and a caller that
 * draws one should release it with `disposeView()` instead. There are three
 * fallbacks in the game and they are rebuilt only when authored art arrives, so
 * leaving their small geometries to the page is deliberate rather than a leak
 * worth a second code path.
 */
export function disposeInstance(root: THREE.Object3D): void {
  root.removeFromParent();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    if (!drawable.material) return;
    for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
      materials.add(material);
    }
  });
  for (const material of materials) material.dispose();
  root.clear();
}
