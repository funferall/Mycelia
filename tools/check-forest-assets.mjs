/** Validate the shipped pack through the same Three.js glTF parser as the game.
 * This is pack QA, not the future general-purpose artist intake validator.
 * Usage: node tools/check-forest-assets.mjs [asset-directory]
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3, DoubleSide } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../public/assets', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root, 'forest-manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.upAxis, 'Y');
assert.equal(manifest.units, 'metres');
assert.equal(manifest.seasonMode, 'procedural-tint');
const loader = new GLTFLoader();
let files = 0, bytes = 0;
const ids = new Set(), paths = new Set();
for (const asset of manifest.assets) {
  assert(!ids.has(asset.id), `duplicate ID ${asset.id}`);
  ids.add(asset.id);
  let referenceHeight = null, previousTriangles = Infinity;
  assert.equal(asset.lods.length, asset.anchorCrown ? 3 : 1, asset.id);
  for (const [level, tier] of asset.lods.entries()) {
    assert(!paths.has(tier.file), `duplicate file ${tier.file}`);
    paths.add(tier.file);
    const path = resolve(root, tier.file);
    assert(!relative(root, path).startsWith('..') && !isAbsolute(relative(root, path)), tier.file);
    const data = await readFile(path);
    assert.equal(data.readUInt32LE(0), 0x46546c67, `${tier.file}: GLB magic`);
    assert.equal(data.readUInt32LE(4), 2, `${tier.file}: glTF 2`);
    assert.equal(data.readUInt32LE(8), data.length, `${tier.file}: complete container`);
    const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8'));
    assert.equal(json.meshes.length, 1, `${tier.file}: one authored mesh`);
    assert(!(json.images?.length || json.textures?.length), `${tier.file}: self-contained, no textures`);
    assert(json.buffers.every(buffer => !buffer.uri), `${tier.file}: embedded buffer`);
    const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    gltf.scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(gltf.scene);
    assert(Math.abs(bounds.min.y) < 1e-4, `${tier.file}: ground contact ${bounds.min.y}`);
    const height = bounds.max.y - bounds.min.y;
    assert(height > .01 && height < 20, `${tier.file}: metre scale ${height}`);
    if (referenceHeight === null) referenceHeight = height;
    assert(Math.abs(height - referenceHeight) < 1e-4, `${tier.file}: LOD height ${height} differs from ${referenceHeight}`);
    if (asset.anchorCrown) {
      const anchor = gltf.scene.getObjectByName('anchor_crown');
      assert(anchor && !anchor.isMesh, `${tier.file}: crown empty`);
      const position = anchor.getWorldPosition(new Vector3());
      assert(position.distanceTo(new Vector3(...asset.anchorCrown)) < 1e-4, `${tier.file}: anchor consistency`);
      assert(bounds.containsPoint(position), `${tier.file}: anchor inside bounds`);
    }
    let triangles = 0, primitives = 0, foliage = 0;
    gltf.scene.traverse(obj => {
      if (!obj.isMesh) return;
      primitives++;
      const geometry = obj.geometry;
      triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      assert(geometry.attributes.normal, `${tier.file}: normals`);
      for (const attribute of Object.values(geometry.attributes)) {
        assert(attribute.array.every(Number.isFinite), `${tier.file}: finite attributes`);
      }
      if (geometry.index) {
        assert(geometry.index.array.every(index => index < geometry.attributes.position.count), `${tier.file}: indices in range`);
      }
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        assert(mat.isMeshStandardMaterial, `${tier.file}: standard lighting`);
        assert(!mat.transparent && mat.opacity === 1, `${tier.file}: opaque`);
        assert.equal(mat.emissive.getHex(), 0, `${tier.file}: no emissive lighting`);
        if (/leaf|needle|foliage/.test(mat.name)) {
          foliage++;
          assert.equal(mat.side, DoubleSide, `${tier.file}: foliage visible from below`);
        }
      }
    });
    assert(primitives <= 3, `${tier.file}: material/draw-call budget`);
    assert.equal(triangles, tier.triangles, `${tier.file}: exported triangle count`);
    assert(triangles <= tier.maxTriangles && triangles > 0, `${tier.file}: triangle budget`);
    assert(triangles < previousTriangles, `${tier.file}: decreasing LOD cost`);
    previousTriangles = triangles;
    assert.equal(data.length, tier.bytes, `${tier.file}: byte count`);
    if (asset.variant === 'dead-hollow') assert.equal(foliage, 0, `${tier.file}: dead tree has no foliage`);
    else if (asset.anchorCrown) assert(foliage > 0, `${tier.file}: living tree retains foliage`);
    files++;
    bytes += data.length;
  }
  console.log(`PASS ${asset.id}: ${asset.lods.map(t => t.triangles).join(' / ')} triangles`);
}
for (const id of ['tree.oak', 'tree.birch', 'tree.hemlock', 'prop.stump', 'prop.log', 'fungus.fruitingBody']) {
  assert(ids.has(id), `existing registry asset ${id}`);
}
console.log(`PASS ${ids.size} assets, ${files} GLBs, ${(bytes / 1024).toFixed(1)} KiB; Three.js load, bounds, anchors, geometry, materials, budgets.`);
