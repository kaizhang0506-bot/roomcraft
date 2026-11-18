import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Box3, BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Texture, Vector3 } from 'three';

const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, '.sites-runtime', 'realistic-furniture-check');
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, 'lib/realistic-furniture.ts')], outfile: path.join(output, 'helpers.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
const { furnitureModelFit, createFurnitureInstance, disposeFurnitureInstance, isUpholsteryMaterial } = await import(pathToFileURL(path.join(output, 'helpers.mjs')).href);
const cases = [], near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const check = (name, test) => { test(); cases.push(name); };
const cream = { id: 'linen-cream', name: '亚麻', category: 'furniture', color: '#e2d7c0', roughness: .95, pattern: 'carpet' };
const charcoal = { ...cream, id: 'charcoal', color: '#555a57', roughness: .92 };
const material = new MeshPhysicalMaterial({ color: '#ad7346', roughness: .45, metalness: .1, sheen: .8, clearcoat: .1 }); material.name = 'Leather';
material.map = new Texture(); material.normalMap = new Texture(); material.roughnessMap = new Texture(); material.sheenColorMap = new Texture();
const wood = new MeshPhysicalMaterial({ color: '#725336', roughness: .5 }); wood.name = 'Wood frame'; wood.map = new Texture();
const source = new Group(); source.position.set(7, -4, -3); source.rotation.y = Math.PI / 5; source.scale.set(1.2, 1.1, .8);
const seat = new Mesh(new BoxGeometry(2, 1, .9), material); seat.position.set(.4, .8, -.2); source.add(seat);
const frame = new Mesh(new BoxGeometry(2.2, .18, 1), wood); frame.position.set(.4, .2, -.2); source.add(frame);

check('translated and rotated native model fits exact editable dimensions and floor origin', () => {
  const clone = createFurnitureInstance(source, cream), fit = furnitureModelFit(clone, 2.7, .85, 1.05), scale = new Group(), offset = new Group();
  scale.scale.set(...fit.scale); offset.position.set(...fit.offset); scale.add(offset); offset.add(clone); scale.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scale), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
  near(size.x, 2.7); near(size.y, .85); near(size.z, 1.05); near(box.min.y, 0); near(center.x, 0); near(center.z, 0); disposeFurnitureInstance(clone);
});
check('invalid target dimensions and empty models fail instead of introducing NaN transforms', () => {
  assert.throws(() => furnitureModelFit(source, 0, 1, 1)); assert.throws(() => furnitureModelFit(source, 1, Infinity, 1)); assert.throws(() => furnitureModelFit(new Group(), 1, 1, 1));
});
check('clones share geometry but own materials, preserving every imported PBR texture reference', () => {
  const clone = createFurnitureInstance(source, cream), clonedSeat = clone.children[0];
  assert.equal(clonedSeat.geometry, seat.geometry); assert.notEqual(clonedSeat.material, material);
  for (const key of ['map', 'normalMap', 'roughnessMap', 'sheenColorMap']) assert.equal(clonedSeat.material[key], material[key], key);
  near(clonedSeat.material.sheen, .8); near(clonedSeat.material.clearcoat, .1); assert.equal(clonedSeat.material.color.getHex(), material.color.getHex());
  assert.equal(clonedSeat.castShadow, true); assert.equal(clonedSeat.receiveShadow, true); disposeFurnitureInstance(clone);
});
check('selected upholstery tint keeps leather maps, sheen and wooden frame finish', () => {
  const clone = createFurnitureInstance(source, charcoal), clonedSeat = clone.children[0], clonedFrame = clone.children[1];
  assert.equal(clonedSeat.material.color.getHexString(), '555a57'); near(clonedSeat.material.roughness, .92); near(clonedSeat.material.sheen, .8); assert.equal(clonedSeat.material.normalMap, material.normalMap);
  assert.equal(clonedFrame.material.color.getHex(), wood.color.getHex()); assert.equal(clonedFrame.material.map, wood.map); near(clonedFrame.material.roughness, wood.roughness); disposeFurnitureInstance(clone);
});
check('changing one instance never recolors the glTF cache or another furniture instance', () => {
  const before = material.color.getHex(), first = createFurnitureInstance(source, charcoal), second = createFurnitureInstance(source, cream);
  first.children[0].material.color.set('#ff0000'); assert.equal(second.children[0].material.color.getHex(), before); assert.equal(material.color.getHex(), before); disposeFurnitureInstance(first); disposeFurnitureInstance(second);
});
check('multi-material meshes retain shared per-instance materials without sharing cache mutations', () => {
  const group = new Group(), mesh = new Mesh(seat.geometry, [material, wood, material]); group.add(mesh);
  const clone = createFurnitureInstance(group, charcoal), materials = clone.children[0].material;
  assert.equal(materials[0], materials[2]); assert.notEqual(materials[0], material); assert.notEqual(materials[1], wood); disposeFurnitureInstance(clone);
});
check('cleanup disposes only cloned materials, not reusable textures or geometry', () => {
  let geometryDisposed = false, textureDisposed = false, originalDisposed = false, cloneDisposed = false;
  seat.geometry.addEventListener('dispose', () => { geometryDisposed = true; }); material.map.addEventListener('dispose', () => { textureDisposed = true; }); material.addEventListener('dispose', () => { originalDisposed = true; });
  const clone = createFurnitureInstance(source, cream); clone.children[0].material.addEventListener('dispose', () => { cloneDisposed = true; }); disposeFurnitureInstance(clone);
  assert.equal(cloneDisposed, true); assert.equal(geometryDisposed, false); assert.equal(textureDisposed, false); assert.equal(originalDisposed, false);
});
check('material role matching excludes wood, feet and hardware from upholstery recoloring', () => {
  for (const name of ['Leather', 'Fabric_Cushion', 'velvet-upholstery', 'SheenSeat', 'Brown', 'Paisley', 'Frame_Fabric']) assert.equal(isUpholsteryMaterial(name), true, name);
  for (const name of ['Wood frame', 'Metal leg', 'Chrome frame', 'Wood_Leather_Trim']) assert.equal(isUpholsteryMaterial(name), false, name);
});

if (process.argv.includes('--assets')) {
  for (const kind of ['sofa', 'chair']) {
    const bytes = await readFile(path.join(root, 'public/assets/realistic', kind + '.glb'));
    check(`${kind} is a real glTF binary with embedded PBR materials and geometry`, () => {
      assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
      const length = bytes.readUInt32LE(12); assert.equal(bytes.toString('ascii', 16, 20), 'JSON'); const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + length));
      assert.ok(gltf.meshes.length); assert.ok(gltf.materials.some(m => m.pbrMetallicRoughness)); assert.ok(gltf.images?.length); assert.ok(gltf.materials.some(m => m.normalTexture || m.pbrMetallicRoughness?.baseColorTexture || m.extensions?.KHR_materials_sheen));
      assert.equal(gltf.images.some(image => image.uri?.startsWith('http')), false);
    });
  }
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: cases.length, cases }, null, 2));
console.log(`${cases.length} GLB furniture fitting, PBR preservation and lifecycle checks passed.`);
