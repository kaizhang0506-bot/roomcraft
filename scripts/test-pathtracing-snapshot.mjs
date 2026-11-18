import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {BoxGeometry, Color, DataTexture, DirectionalLight, EquirectangularReflectionMapping, Group, InstancedMesh, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Points, Scene} from 'three';
import {PathTracingSceneGenerator} from 'three-gpu-pathtracer';

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.sites-runtime','pathtracing-snapshot-check');
await mkdir(output,{recursive:true});
await build({entryPoints:[path.join(root,'lib/pathtracing-snapshot.ts')],outdir:output,bundle:true,platform:'node',format:'esm',packages:'external',outExtension:{'.js':'.mjs'},logLevel:'silent'});
const {snapshotScene}=await import(pathToFileURL(path.join(output,'pathtracing-snapshot.mjs')).href);
const results=[];
function check(name,run){run();results.push(name);}
const camera=new PerspectiveCamera();camera.position.set(1,1.65,6);
const scene=new Scene(),group=new Group();group.position.set(12,0,-9);group.rotation.y=.6;group.scale.set(1.2,1,1.5);scene.add(group);
const geometry=new BoxGeometry(2,3,4),material=new MeshStandardMaterial({color:'#bba998',roughness:.9});
const instances=new InstancedMesh(geometry,material,2);instances.name='world-city';instances.position.set(3,-18,4);
instances.setMatrixAt(0,new Matrix4().makeTranslation(2,0,5));instances.setMatrixAt(1,new Matrix4().makeTranslation(-4,7,-3));
instances.setColorAt(0,new Color('#87ad77'));instances.setColorAt(1,new Color('#aabcdd'));group.add(instances);
const skyMap=new DataTexture(new Uint8Array([90,130,180,255,140,160,170,255,40,50,70,255,0,0,0,255]),2,2);
const skyMaterial=new MeshBasicMaterial({map:skyMap}),sky=new Mesh(new PlaneGeometry(5,5),skyMaterial);sky.name='world-sky';scene.add(sky);
const sunMap=new DataTexture(new Uint8Array([255,220,190,128]),1,1);
const sunMaterial=new MeshBasicMaterial({map:sunMap,color:'#ffdcab',transparent:true,opacity:.4,alphaTest:.02,depthWrite:false});
const sun=new Mesh(new PlaneGeometry(1,1),sunMaterial);sun.name='world-sun';sun.position.set(0,30,-40);scene.add(sun);
const particles=new Points();particles.name='world-stars';scene.add(particles);const rain=new LineSegments();rain.name='world-rain';scene.add(rain);
const light=new DirectionalLight('#ffe6c1',2.3);light.position.set(10,20,7);light.target.position.set(12,0,-9);scene.add(light,light.target);
scene.environment=skyMap;scene.environmentIntensity=.31;
let sourceDisposals=0;for(const resource of [geometry,material,skyMap,skyMaterial,sunMap,sunMaterial])resource.addEventListener('dispose',()=>sourceDisposals++);
const frozen=snapshotScene(scene,camera),expanded=frozen.scene.getObjectByName('world-city');
check('instance transforms and tint survive conversion to regular meshes',()=>{
  assert.equal(expanded.children.length,2);assert.ok(!expanded.isInstancedMesh);
  for(let i=0;i<2;i++){
    const expected=new Matrix4(),tint=new Color();instances.getMatrixAt(i,expected);expected.premultiply(instances.matrixWorld);instances.getColorAt(i,tint);
    const mesh=expanded.children[i];assert.ok(mesh.isMesh&&!mesh.isInstancedMesh);
    mesh.matrixWorld.elements.forEach((v,j)=>assert.ok(Math.abs(v-expected.elements[j])<1e-9));
    assert.ok(mesh.material.color.equals(material.color.clone().multiply(tint)));
  }
});
check('sky becomes distant background and cannot enclose the room',()=>{
  assert.equal(frozen.scene.getObjectByName('world-sky'),undefined);
  assert.notEqual(frozen.scene.background,skyMap);assert.equal(frozen.scene.background.mapping,EquirectangularReflectionMapping);
  assert.equal(scene.getObjectByName('world-sky'),sky);assert.notEqual(skyMap.mapping,EquirectangularReflectionMapping);
  assert.equal(frozen.scene.environmentIntensity,.31);
});
check('sun and moon cards retain emission and transparent map alpha',()=>{
  const converted=frozen.scene.getObjectByName('world-sun').material;
  assert.ok(converted.isMeshStandardMaterial);assert.ok(converted.emissive.equals(sunMaterial.color));
  assert.equal(converted.transparent,true);assert.equal(converted.opacity,.4);assert.equal(converted.alphaTest,.02);
  assert.equal(converted.map,converted.emissiveMap);assert.notEqual(converted.map,sunMap);
  assert.ok(sun.material.isMeshBasicMaterial);
});
check('raster particles are excluded and direct light intensity remains unchanged',()=>{
  assert.equal(frozen.scene.getObjectByName('world-stars'),undefined);assert.equal(frozen.scene.getObjectByName('world-rain'),undefined);
  const lights=[];frozen.scene.traverse(o=>{if(o.isDirectionalLight)lights.push(o);});assert.equal(lights.length,1);assert.equal(lights[0].intensity,2.3);
});
check('snapshot stays frozen after live scene changes',()=>{
  const before=expanded.children[0].matrixWorld.clone();instances.position.x=80;material.color.set('#ff0000');scene.updateMatrixWorld(true);
  assert.ok(expanded.children[0].matrixWorld.equals(before));assert.equal(frozen.camera.position.y,1.65);
});
check('installed path tracer builds a BVH from the adapted snapshot',()=>{
  const generator=new PathTracingSceneGenerator(frozen.scene),result=generator.generate();
  assert.ok(result.bvh);assert.ok(result.geometry.attributes.position.count>0);
  assert.ok(result.materials.every(item=>item.isMeshStandardMaterial||item.isMeshPhysicalMaterial));
  result.geometry.dispose();
});
check('snapshot disposal is idempotent and leaves live resources intact',()=>{
  let disposed=0;const owned=expanded.children[0].geometry;owned.addEventListener('dispose',()=>disposed++);
  frozen.dispose();frozen.dispose();assert.equal(disposed,1);assert.equal(sourceDisposals,0);
});
console.log(JSON.stringify({passed:results.length,checks:results},null,2));
