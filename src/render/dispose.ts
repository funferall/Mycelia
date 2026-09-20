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
