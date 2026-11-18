import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'.sites-runtime','layout-schema-check');
await mkdir(out,{recursive:true});
await build({entryPoints:['plan','layout','validation','recognition','share'].map(n=>path.join(root,'lib',n+'.ts')),outdir:out,bundle:true,platform:'node',format:'esm',target:'node24',outExtension:{'.js':'.mjs'},logLevel:'silent'});
const load=n=>import(pathToFileURL(path.join(out,n+'.mjs')).href);
const {SAMPLE_PLAN,clonePlan}=await load('plan');
const {normalizePlan,roomPolygon,roomArea,roomLabelPoint,pointInPolygon,polygonContainsPolygon,resizeRoom,scalePlan}=await load('layout');
const {validatePlan}=await load('validation');
const {recognitionToPlan}=await load('recognition');
const {createProjectShareUrl,readSharedProject}=await load('share');
const checks=[];
async function check(name,run){await run();checks.push(name);}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const lShape=[{x:0,y:0},{x:6,y:0},{x:6,y:2},{x:2,y:2},{x:2,y:6},{x:0,y:6}];
const room={id:'l-room',name:'L形房间',x:0,y:0,width:6,depth:6,polygon:lShape};
const base=()=>normalizePlan({...clonePlan(),rooms:[room]});

await check('legacy projects migrate to canonical metre schema with polygons',()=>{
  const p=clonePlan();delete p.schemaVersion;delete p.units;delete p.materials;delete p.ceilingHeight;
  p.rooms=p.rooms.map(({polygon,floorMaterialId,wallMaterialId,...r})=>r);
  const q=validatePlan(p);assert.equal(q.schemaVersion,2);assert.equal(q.units,'m');assert.equal(q.ceilingHeight,2.8);assert.equal(q.rooms[0].polygon.length,4);
});
await check('canonical sample remains stable through validation',()=>assert.deepEqual(validatePlan(SAMPLE_PLAN),SAMPLE_PLAN));
await check('room polygon is authoritative over stale rectangle bounds',()=>{
  const q=validatePlan({...base(),rooms:[{...room,x:100,y:100,width:99,depth:99}]});
  assert.deepEqual([q.rooms[0].x,q.rooms[0].y,q.rooms[0].width,q.rooms[0].depth],[0,0,6,6]);near(roomArea(q.rooms[0]),20);
});
await check('concave cutout is outside and boundary is included',()=>{
  assert.equal(pointInPolygon({x:4,y:4},lShape),false);assert.equal(pointInPolygon({x:2,y:4},lShape),true);assert.equal(pointInPolygon({x:1,y:5},lShape),true);
  assert.equal(pointInPolygon(roomLabelPoint(room),lShape),true);
});
await check('repeated polygon closing point is removed',()=>assert.equal(roomPolygon({...room,polygon:[...lShape,lShape[0]]}).length,6));
await check('furniture corners inside concave arms do not permit an edge through cutout',()=>{
  assert.equal(polygonContainsPolygon(lShape,[{x:1,y:1},{x:5,y:1},{x:1,y:5}]),false);
  assert.equal(polygonContainsPolygon(lShape,[{x:.5,y:.5},{x:1.5,y:.5},{x:1.5,y:5},{x:.5,y:5}]),true);
});
await check('room resize transforms polygon without turning it into rectangle',()=>{
  const q=resizeRoom(room,{x:2,y:3,width:12,depth:9});near(roomArea(q),60);assert.equal(q.polygon.length,6);assert.deepEqual(q.polygon[3],{x:6,y:6});
});
await check('self-intersecting room polygon is rejected',()=>assert.throws(()=>validatePlan({...base(),rooms:[{...room,polygon:[{x:0,y:0},{x:5,y:5},{x:0,y:5},{x:5,y:0}]}]})));
await check('zero area polygon is rejected',()=>assert.throws(()=>validatePlan({...base(),rooms:[{...room,polygon:[{x:0,y:0},{x:1,y:0},{x:2,y:0}]}]})));
await check('future schema and wrong units are rejected',()=>{assert.throws(()=>validatePlan({...base(),schemaVersion:99}));assert.throws(()=>validatePlan({...base(),units:'mm'}));});
await check('unknown material references and duplicate material IDs are rejected',()=>{
  assert.throws(()=>validatePlan({...base(),rooms:[{...room,floorMaterialId:'missing'}]}));
  const p=base();p.materials.push({...p.materials[0]});assert.throws(()=>validatePlan(p));
});
await check('valid custom material survives normalization and validation',()=>{
  const p=base();p.materials.push({id:'custom-floor',name:'自定义',category:'floor',color:'#224466',roughness:.5,pattern:'tile'});p.rooms[0].floorMaterialId='custom-floor';assert.equal(validatePlan(p).rooms[0].floorMaterialId,'custom-floor');
});
await check('globally duplicated IDs and dangling openings are rejected',()=>{
  const p=base();p.walls[0].id=p.rooms[0].id;assert.throws(()=>validatePlan(p));
  const q=base();q.openings[0].wallId='missing';assert.throws(()=>validatePlan(q));
});

const envelope=()=>({provider:'test-original',coordinateSpace:'pixel',imageSize:{width:2000,height:2000},metersPerPixel:.01,ceilingHeight:2.9,
  wallSegments:[{id:'w1',start:{x:1200,y:1300},end:{x:1800,y:1300},thickness:18},{id:'w2',start:{x:1800,y:1300},end:{x:1800,y:1900},thickness:18}],
  openings:[{id:'door',wallId:'w1',kind:'door',position:.5,width:90,height:2.1,sill:0}],
  roomPolygons:[{id:'l-room',name:'L形',polygon:lShape.map(p=>({x:p.x*100+1200,y:p.y*100+1300})),floorMaterialId:'oak-natural'}],warnings:[],needsReview:true,mesh:{format:'obj',editable:false,data:'v 0 0 0\nf 1 2 3'}});
await check('pixel recognition converts horizontal geometry while preserving vertical metres',()=>{
  const {plan:p}=recognitionToPlan(envelope());near(p.width,6);near(p.depth,6);near(p.walls[0].thickness,.18);near(p.walls[0].height,2.9);near(p.openings[0].width,.9);near(p.openings[0].height,2.1);near(roomArea(p.rooms[0]),20);assert.equal(p.recognition.needsReview,true);
});
await check('large pixel origin is retained without metre coordinate limit',()=>{
  const p=recognitionToPlan(envelope()).plan;assert.deepEqual(p.recognition.imageTransform.originPixels,{x:1200,y:1300});assert.equal(p.recognition.imageTransform.imageWidth,2000);
});
await check('derived mesh bytes never enter editable project',()=>{
  const p=recognitionToPlan(envelope()).plan;assert.deepEqual(p.recognition.sourceMesh,{format:'obj',editable:false});assert.equal(JSON.stringify(p).includes('v 0 0 0'),false);assert.equal('mesh' in p,false);
});
await check('raw mesh-only output is rejected instead of inventing editable walls',()=>assert.throws(()=>recognitionToPlan({mesh:{format:'obj',data:'v ...'}}),/OBJ\/GLB/));
await check('unknown recognition materials fall back with an explicit warning',()=>{
  const e=envelope();e.roomPolygons[0].floorMaterialId='unavailable';const p=recognitionToPlan(e);assert.equal(p.plan.rooms[0].floorMaterialId,'oak-natural');assert.ok(p.warnings.some(w=>w.includes('材质')));
});
await check('unassociated recognition openings are excluded and reported',()=>{
  const e=envelope();e.openings[0].wallId='lost-wall';const p=recognitionToPlan(e);assert.equal(p.plan.openings.length,0);assert.ok(p.warnings.some(w=>w.includes('未能关联')));
});
await check('calibration scales XY and image transform but preserves vertical heights',()=>{
  const p=recognitionToPlan(envelope()).plan;const q=scalePlan(p,2);near(q.width,12);near(roomArea(q.rooms[0]),80);near(q.openings[0].width,1.8);near(q.openings[0].height,2.1);near(q.ceilingHeight,2.9);near(q.recognition.imageTransform.metersPerPixel,.02);near(q.walls[0].thickness,.36);
});
await check('negative calibration is rejected',()=>assert.throws(()=>scalePlan(base(),-1)));

const oldWindow=globalThis.window;
try{
  globalThis.window={location:{origin:'https://example.test',pathname:'/studio',hash:'',search:'?secret=not-shared'}};
  let link;
  await check('share link roundtrip preserves polygons and materials',async()=>{
    const p=base();link=await createProjectShareUrl(p);const url=new URL(link);assert.equal(url.origin,'https://example.test');assert.equal(url.search,'');assert.ok(url.hash.startsWith('#project=rc2.'));window.location.hash=url.hash;assert.deepEqual(await readSharedProject(),validatePlan(p));
  });
  await check('no project hash returns null',async()=>{window.location.hash='#other';assert.equal(await readSharedProject(),null);});
  await check('unsupported share version and malformed payload are rejected',async()=>{
    window.location.hash='#project=rc99.abc';await assert.rejects(readSharedProject());window.location.hash='#project=rc2.!';await assert.rejects(readSharedProject());
  });
  await check('compressed share payload is bounded after decompression',async()=>{
    window.location.hash='#project=rc2.'+gzipSync(Buffer.alloc(1024*1024+1,32)).toString('base64url');await assert.rejects(readSharedProject(),/过大/);
  });
  await check('invalid project inside an otherwise valid compressed link is rejected',async()=>{
    window.location.hash='#project=rc2.'+gzipSync(JSON.stringify({version:99})).toString('base64url');await assert.rejects(readSharedProject());
  });
}finally{globalThis.window=oldWindow;}

if(process.argv.includes('--live'))await check('live image → CPU service → semantic conversion; never fixture substitution',async()=>{
  const r=await fetch('http://127.0.0.1:8001/sample');assert.equal(r.status,200);const form=new FormData();form.set('file',new Blob([await r.arrayBuffer()],{type:'image/png'}),'floorplan.png');form.set('known_width_m',r.headers.get('x-known-width-m'));
  const response=await fetch('http://127.0.0.1:8001/recognize',{method:'POST',body:form});assert.equal(response.status,200);const result=recognitionToPlan(await response.json());assert.equal(result.plan.rooms.length,3);assert.equal(result.plan.walls.length,7);assert.equal(result.plan.openings.length,4);assert.ok(result.plan.rooms.some(r=>r.polygon.length>4));validatePlan(result.plan);
});
await writeFile(path.join(out,'report.json'),JSON.stringify({passed:checks.length,checks},null,2));
console.log(`${checks.length} semantic schema / recognition / share checks passed.`);
