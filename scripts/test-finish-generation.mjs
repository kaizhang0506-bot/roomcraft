import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const outfile=path.resolve('.sites-runtime/finishes-check.mjs');
await build({stdin:{contents:"export * from './lib/ai-server'; export * from './lib/server-env'; export * from './lib/plan'; export * from './lib/validation';",resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {validatePlan,SAMPLE_PLAN,designInterior,runWithAppEnv}=await import(pathToFileURL(outfile));
const plan=validatePlan(SAMPLE_PLAN),org=globalThis.fetch;
let mock={finishes:[{id:'oak-natural',color:'#a86742',roughness:.63}],furniture:[]};
try{globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify(mock)}}]});
const run=()=>runWithAppEnv({CONFLUX_API_KEY:'fixture'},()=>designInterior({plan,mode:'finishes',style:'japandi'}));
const result=await run();assert.deepEqual(result.plan.furniture,plan.furniture);assert.deepEqual(result.plan.openings,plan.openings);assert.equal(result.plan.materials.find(m=>m.id==='oak-natural').color,'#a86742');mock.finishes[0].id='unknown';await assert.rejects(run,/校验/);console.log('Material-only service preserves geometry and rejects invalid material IDs');
}finally{globalThis.fetch=org;}
