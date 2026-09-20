import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
// Data module imports the repository's installed Three, without a renderer.
const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const source = stripTypeScriptTypes(readFileSync(new URL('../src/render/tree-batches.ts', import.meta.url), 'utf8'), { mode: 'transform' }).replace("from 'three'", `from '${threeUrl}'`);
const { TreeBatches } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const geometry = new THREE.BoxGeometry(1, 2, 1);
function model(tier = 0) {
  const object = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: '#556622' });
  material.name = 'foliage';
  object.add(new THREE.Mesh(geometry, material));
  return { id: 'tree.oak', tier, object, foliage: [], wood: [], height: 2 };
}
const a = model(), b = model();
a.object.position.set(3, 4, 5);
b.object.position.set(-8, 2, 9);
b.object.rotation.z = 0.2;
b.object.scale.set(2, 3, 4);
b.object.children[0].material.color.set('#999999');
const batches = new TreeBatches(1);
const rows = [{ key: '1:0', model: a, visible: true }, { key: '2:0', model: b, visible: true }];
batches.sync(rows);
assert.deepEqual(batches.report(), { trees: 2, parts: 2, draws: 1, identities: ['1:0', '2:0'] });
const mesh = batches.group.children[0];
const matrix = new THREE.Matrix4(), color = new THREE.Color();
mesh.getMatrixAt(1, matrix);
assert.ok(matrix.elements.every((v, i) => Math.abs(v - b.object.children[0].matrixWorld.elements[i]) < 1e-6));
mesh.getColorAt(1, color);
assert.ok(Math.abs(color.r - b.object.children[0].material.color.r) < 1e-6);
assert.equal(batches.identity(mesh, 1), '2:0');
console.log('PASS one draw preserves distinct transforms, colours and stand:tree IDs across buffer growth');

rows[1].model = model(2);
batches.sync(rows);
assert.equal(batches.report().draws, 2);
assert.deepEqual(batches.report().identities, ['1:0', '2:0']);
rows[0].visible = false;
batches.sync(rows);
assert.equal(batches.report().draws, 1);
assert.deepEqual(batches.report().identities, ['2:0']);
assert.equal(mesh.count, 0);
assert.equal(batches.identity(mesh, 0), null);
console.log('PASS tier migration and stand hiding remove old slots without losing identity');

rows.reverse();
rows[1].visible = true;
batches.sync(rows);
assert.deepEqual(batches.report().identities, ['1:0', '2:0']);
assert.equal(a.object.visible, false);
console.log('PASS re-entry restores hidden stands without drawing original copies');
