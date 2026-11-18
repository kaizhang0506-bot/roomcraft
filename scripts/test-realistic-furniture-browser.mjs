import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const output = path.resolve(import.meta.dirname, '../.sites-runtime/realistic-furniture-check');
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(process.env.ROOMCRAFT_TEST_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const models = await page.evaluate(async () => {
    // Use Vite's actual glTF and helper modules; no WebGL is needed to decode PBR textures.
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const helper = await import('/lib/realistic-furniture.ts');
    const results = [];
    for (const kind of ['sofa', 'chair']) {
      const gltf = await new GLTFLoader().loadAsync('/assets/realistic/' + kind + '.glb');
      const originals = new Map();
      gltf.scene.traverse(node => { if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) originals.set(material.name, { color: material.color?.getHexString(), map: material.map, normalMap: material.normalMap }); });
      const material = { id: 'charcoal', name: 'test', category: 'furniture', color: '#555a57', roughness: .92, pattern: 'carpet' };
      const instance = helper.createFurnitureInstance(gltf.scene, material), fit = helper.furnitureModelFit(instance, kind === 'sofa' ? 2.7 : .6, kind === 'sofa' ? .85 : .9, kind === 'sofa' ? 1 : .6);
      instance.updateWorldMatrix(true, true);
      const meshes = [];
      instance.traverse(node => {
        if (!node.isMesh) return;
        node.geometry.computeBoundingBox();
        const bounds = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
        meshes.push({ name: node.name, min: bounds.min.toArray(), max: bounds.max.toArray(), vertices: node.geometry.attributes.position.count, castShadow: node.castShadow, receiveShadow: node.receiveShadow,
          materials: (Array.isArray(node.material) ? node.material : [node.material]).map(m => ({ name: m.name, color: m.color?.getHexString(), map: !!m.map, normal: !!m.normalMap, sheen: m.sheen, tintable: helper.isUpholsteryMaterial(m.name), originalColor: originals.get(m.name)?.color, sameMap: m.map === originals.get(m.name)?.map, sameNormal: m.normalMap === originals.get(m.name)?.normalMap })) });
      });
      const sourceUntouched = [];
      gltf.scene.traverse(node => { if (node.isMesh) for (const m of Array.isArray(node.material) ? node.material : [node.material]) sourceUntouched.push(m.color?.getHexString() === originals.get(m.name)?.color); });
      helper.disposeFurnitureInstance(instance);
      results.push({ kind, fit, meshes, sourceUntouched: sourceUntouched.every(Boolean) });
    }
    return results;
  });
  const checks = [];
  for (const model of models) {
    assert.ok(model.meshes.length); assert.ok(model.meshes.some(mesh => mesh.vertices > 1000)); assert.ok(model.meshes.some(mesh => mesh.materials.some(m => m.map))); assert.ok(model.meshes.every(mesh => mesh.castShadow && mesh.receiveShadow)); checks.push(model.kind + ' loads detailed geometry and embedded PBR images in an actual browser');
    for (const mesh of model.meshes) for (const material of mesh.materials) {
      assert.equal(material.sameMap, true); assert.equal(material.sameNormal, true);
      if (material.tintable) assert.equal(material.color, '555a57'); else assert.equal(material.color, material.originalColor);
    }
    assert.equal(model.sourceUntouched, true); checks.push(model.kind + ' upholstery selection keeps original maps and independent wood/metal finishes');
    assert.ok(model.fit.scale.every(value => Number.isFinite(value) && value > 0)); checks.push(model.kind + ' has finite physically sized transforms from the actual glTF bounds');
  }
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ passed: checks.length, checks, models }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, models: models.map(model => ({ kind: model.kind, sourceSize: model.fit.sourceSize, materials: [...new Set(model.meshes.flatMap(mesh => mesh.materials.map(m => m.name)))] })) }, null, 2));
} finally { await browser.close(); }
