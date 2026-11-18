import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';

const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'.sites-runtime','capabilities-check');
await mkdir(out,{recursive:true});
await build({entryPoints:[path.join(root,'lib/design-capabilities.ts'),path.join(root,'lib/plan.ts')],outdir:out,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
const {createDesignTask,applyFurnitureDraft,DESIGN_SKILLS}=await import(pathToFileURL(path.join(out,'design-capabilities.mjs')).href);
const {SAMPLE_PLAN,clonePlan}=await import(pathToFileURL(path.join(out,'plan.mjs')).href);
const original=clonePlan(SAMPLE_PLAN), source=JSON.stringify(original);

// A model response may propose unrelated edits: the website only applies furniture.
const proposed=clonePlan(original);proposed.name='unwanted';proposed.walls[0].height=9;proposed.nodes=[];proposed.routes=[];
proposed.furniture[0].name='新沙发';
const applied=applyFurnitureDraft(original,source,proposed);
assert.equal(applied.name,original.name);
for(const key of ['walls','openings','rooms','nodes','routes','materials'])assert.deepEqual(applied[key],original[key]);
assert.equal(applied.furniture[0].name,'新沙发');assert.equal(applied.verified,false);
assert.equal(JSON.stringify(original),source);

const changed=clonePlan(original);changed.furniture[0].x+=.1;
assert.throws(()=>applyFurnitureDraft(changed,source,proposed),/项目已变化/);
assert.throws(()=>applyFurnitureDraft(original,source,{...proposed,furniture:[{id:'broken'}]}));

for(const skill of DESIGN_SKILLS){
  const task=createDesignTask({...original,IMAGE_API_KEY:'must-not-leak',arbitrary:'extra-secret'},skill.id,'保留门窗，增加收纳','温润极简');
  assert.ok(task.includes(`$${skill.id}`));assert.ok(task.includes('保留门窗，增加收纳'));
  assert.ok(!task.includes('must-not-leak'));assert.ok(!task.includes('extra-secret'));
  const blocks=[...task.matchAll(/~~~json\n([\s\S]*?)\n~~~/g)];
  assert.equal(blocks.length,2);assert.deepEqual(JSON.parse(blocks[1][1]),original);
}
await writeFile(path.join(out,'result.json'),JSON.stringify({mutationBoundary:true,staleRejected:true,invalidRejected:true,skillTasks:3,secretFieldsStripped:true},null,2));
console.log('PASS: furniture-only application, stale protection, invalid draft rejection, 3 portable skill tasks, config fields excluded');
