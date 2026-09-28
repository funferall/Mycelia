import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
function moduleUrl(file, replacements = {}) {
  let source = stripTypeScriptTypes(readFileSync(new URL(file, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [from, to] of Object.entries({ three: threeUrl, ...replacements })) {
    source = source.replaceAll(`from '${from}'`, `from '${to}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const bodiesUrl = moduleUrl('../src/render/bodies.ts');
const { BODY_ASSET } = await import(bodiesUrl);
const { FruitingView } = await import(moduleUrl('../src/render/fruiting.ts', {
  './bodies': bodiesUrl, './dispose': moduleUrl('../src/render/dispose.ts'),
}));
const models = new Map();
for (const id of Object.values(BODY_ASSET)) {
  const file = readFileSync(new URL(`../public/assets/fungi/${id.slice(7)}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  models.set(id, gltf.scene);
}
const ready = new Set();
const requests = [];
const assets = {
  has: id => ready.has(id),
  instance(id, height) {
    if (!ready.has(id)) return null;
    requests.push(id);
    const object = models.get(id).clone(true);
    object.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
    const box = new THREE.Box3().setFromObject(object);
    object.scale.setScalar(height / (box.max.y - box.min.y));
    return { object };
  },
};
const view = new FruitingView(assets, p => new THREE.Vector3(p.x, p.y, p.z));
const site = { key: 'fixture:0', point: { x: 3, y: 4, z: 5 }, progress: .2, bloomed: false };
view.update(.1, [site]);
assert.equal(view.report().waiting, 1);
ready.add(BODY_ASSET.primordium);
view.update(.1, [site]);
assert.equal(view.report().standing, 1, 'late button load must rebuild');
assert.equal(requests.at(-1), BODY_ASSET.primordium);
for (const id of Object.values(BODY_ASSET)) ready.add(id);
site.progress = 1;
view.update(1, [site]);
assert.equal(requests.at(-1), BODY_ASSET.rising);
site.bloomed = true;
view.update(1, [site]);
assert.equal(requests.at(-1), BODY_ASSET.bloom, 'completion must change mesh at unchanged progress');
view.update(1, [site]);
assert.equal(view.report().triangles, 416);
assert.deepEqual(view.group.children[0].position.toArray(), [3, 4, 5]);
const count = requests.length;
view.update(1, [site], false);
assert.equal(view.group.visible, false);
assert.equal(requests.length, count, 'stable state must reuse instance');
view.dispose();
assert.equal(view.report().standing, 0);
console.log('PASS actual porcini GLBs: delayed button, cap opening, completed bloom, placement, reuse, visibility, disposal.');
