import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, '.sites-runtime/pathtracing-bridge-browser');
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
await build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas,useFrame} from '@react-three/fiber';import PathTracingBridge from './components/PathTracingBridge';
window.snapshotResult={progress:[],complete:0,error:'',busy:false,frames:0};
function Clock(){useFrame(()=>window.snapshotResult.frames++);return null;}
function App(){const[request,setRequest]=useState(0),[image,setImage]=useState('');return <><button id="start" onClick={()=>setRequest(r=>r+1)}>start</button><button id="cancel" onClick={()=>setRequest(0)}>cancel</button><div style={{width:320,height:240}}><Canvas gl={{preserveDrawingBuffer:true}} camera={{position:[4,3,5],fov:45}} onCreated={({camera})=>camera.lookAt(0,0,0)}><color attach="background" args={['#c9d5dc']}/><directionalLight intensity={4} position={[3,6,4]}/><mesh position={[0,.7,0]}><sphereGeometry args={[.7,24,16]}/><meshStandardMaterial color="#c87532" roughness={.38}/></mesh><mesh rotation={[-Math.PI/2,0,0]}><planeGeometry args={[12,12]}/><meshStandardMaterial color="#d8d3c3" roughness={.8}/></mesh><Clock/><PathTracingBridge request={request} sampleTarget={location.search.includes('cancel')?64:2} maxWidth={512} onProgress={n=>window.snapshotResult.progress.push(n)} onBusy={b=>{window.snapshotResult.busy=b;if(b&&location.search.includes('cancel'))setTimeout(()=>setRequest(0),0)}} onError={e=>window.snapshotResult.error=e} onComplete={data=>{window.snapshotResult.complete++;setImage(data)}}/></Canvas></div>{image&&<img id="snapshot" src={image}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, sourcefile: 'pathtrace-test.tsx', loader: 'tsx' }, outfile: path.join(output, 'viewer.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', minify: true, logLevel: 'silent' });
const server = createServer(async (request, response) => { if(request.url==='/viewer.js'){response.setHeader('Content-Type','application/javascript');response.end(await readFile(path.join(output,'viewer.js')));}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><style>body{font-family:Arial}#snapshot{max-width:640px;display:block}</style></head><body><div id="root"></div><script type="module" src="/viewer.js"></script></body></html>');} });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const address='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1100,height:850}}), errors=[],cases=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(address);await page.waitForFunction(()=>window.snapshotResult?.frames>2);
  const before=await page.evaluate(()=>window.snapshotResult.frames);await page.click('#start');
  await page.waitForFunction(()=>window.snapshotResult.complete>0||window.snapshotResult.error,{},{timeout:170000});
  const result=await page.evaluate(()=>window.snapshotResult);assert.equal(result.error,'');assert.equal(result.complete,1);assert.ok(result.progress.includes(2));assert.equal(result.busy,false);assert.ok(result.frames>before+3);cases.push('real WebGL2 path tracer completes two samples and leaves the R3F frame loop running');
  await page.locator('#snapshot').waitFor();const image=await page.locator('#snapshot').evaluate(async element=>{await element.decode();const c=document.createElement('canvas');c.width=element.naturalWidth;c.height=element.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(element,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;let min=255,max=0;for(let i=0;i<data.length;i+=4){const v=data[i]+data[i+1]+data[i+2];min=Math.min(min,v);max=Math.max(max,v)}return{width:c.width,height:c.height,variance:max-min};});
  assert.equal(image.width,512);assert.equal(image.height,384);assert.ok(image.variance>80);cases.push('completed PNG contains a lit scene with actual image variance at the requested aspect');await page.screenshot({path:path.join(output,'real-pathtrace.png')});
  await page.goto(address+'/?cancel');await page.waitForFunction(()=>window.snapshotResult?.frames>2);await page.click('#start');await page.waitForTimeout(1300);const cancelled=await page.evaluate(()=>window.snapshotResult);assert.equal(cancelled.complete,0);assert.equal(cancelled.error,'');assert.equal(cancelled.busy,false);cases.push('cancellation during initialization releases the job without delivering an ordinary raster screenshot or error');
  await page.goto(address+'/?unsupported');await page.waitForFunction(()=>window.snapshotResult?.frames>2);
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const context=original.call(this,type,...args);if(type==='webgl2'&&context&&!this.isConnected){const extension=context.getExtension.bind(context);context.getExtension=name=>name==='EXT_color_buffer_float'?null:extension(name);}return context;};});
  await page.click('#start');await page.waitForFunction(()=>window.snapshotResult.error);const unsupported=await page.evaluate(()=>window.snapshotResult);assert.match(unsupported.error,/浮点渲染/);assert.equal(unsupported.complete,0);assert.equal(unsupported.busy,false);cases.push('unsupported float framebuffer fails explicitly without claiming a path-traced image');
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:cases.length,cases,browserErrors:errors},null,2));console.log(JSON.stringify({passed:cases.length,cases,browserErrors:errors},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
