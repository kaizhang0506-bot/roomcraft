import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { homedir } from 'node:os';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, '.sites-runtime/panorama-viewer-browser');
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import PanoramaViewer from './components/PanoramaViewer';
const fixture=document.createElement('canvas');fixture.width=1024;fixture.height=location.search.includes('flat')?1024:512;const ctx=fixture.getContext('2d');
const gradient=ctx.createLinearGradient(0,0,1024,0);gradient.addColorStop(0,'#e23e1b');gradient.addColorStop(.33,'#2b8d50');gradient.addColorStop(.66,'#3d6cb5');gradient.addColorStop(1,'#e23e1b');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,fixture.height);ctx.fillStyle='#c4ac68';ctx.fillRect(0,fixture.height*.65,1024,fixture.height*.35);ctx.fillStyle='#263a39';for(let i=0;i<8;i++)ctx.fillRect(i*128+30,130,35,100);
const image=location.search.includes('broken')?'/not-found.png':location.search.includes('photo')?'/photo.png':fixture.toDataURL();
createRoot(document.getElementById('root')).render(<PanoramaViewer image={image} label="投影测试图"/>);`, resolveDir: root, loader: 'tsx', sourcefile: 'pano-test.tsx' }, outfile: path.join(output, 'viewer.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', minify: true, logLevel: 'silent' });
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/viewer.css"><style>html,body{margin:0;font-family:Arial}#root{height:600px;width:100vw}button{cursor:pointer;border:0;background:none}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/viewer.js"></script></body></html>';
const server = http.createServer(async (request, response) => {
  if (request.url?.startsWith('/not-found')) { response.writeHead(404).end(); return; }
  if (request.url === '/photo.png') { response.setHeader('Content-Type', 'image/png'); response.end(await readFile(path.join(root, 'public/images/photo-tour-demo-v1.png'))); return; }
  if (request.url === '/viewer.js' || request.url === '/viewer.css') { response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'application/javascript'); response.end(await readFile(path.join(output, request.url.slice(1)))); return; }
  response.setHeader('Content-Type', 'text/html'); response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--disable-webgl'] });
const cases = [], errors = [], page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { const original=HTMLCanvasElement.prototype.getContext;window.webglRequests=0;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type.includes('webgl')){window.webglRequests++;return null;}return original.call(this,type,...args);}; });
const scene = page.getByTestId('panorama-viewer'), canvas = scene.locator('canvas');
const screenshotPixels = () => canvas.evaluate(element => element.toDataURL('image/png'));
const settle = () => page.waitForTimeout(250);
try {
  await page.goto(address + (process.argv.includes('--photo') ? '/?photo' : '')); await page.waitForFunction(() => document.querySelector('[data-testid="panorama-viewer"]')?.dataset.status === 'ready'); await settle();
  assert.equal(await page.evaluate(() => window.webglRequests), 0); const initial = await screenshotPixels(); cases.push('real 2D spherical canvas loads with WebGL explicitly disabled');
  const bounds = await canvas.boundingBox(); await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .6, { steps: 8 }); await page.mouse.up(); await settle();
  assert.notEqual(await screenshotPixels(), initial); assert.ok(Number(await scene.getAttribute('data-yaw')) < -.5); assert.ok(Number(await scene.getAttribute('data-pitch')) > 0); cases.push('pointer drag changes actual perspective pixels, yaw and pitch');
  await page.getByRole('button', { name: '全景放大', exact: true }).click(); await settle(); assert.equal(await scene.getAttribute('data-fov'), '67.0'); cases.push('zoom button changes the actual perspective field of view');
  await canvas.focus(); await page.keyboard.press('ArrowLeft'); await settle(); const yaw = Number(await scene.getAttribute('data-yaw')); await page.keyboard.press('ArrowUp'); await settle(); assert.ok(Number(await scene.getAttribute('data-yaw')) === yaw); assert.ok(Number(await scene.getAttribute('data-pitch')) > .1); cases.push('focused arrow keys rotate the fixed image view');
  await page.getByRole('button', { name: '重置全景视角', exact: true }).click(); await settle(); assert.equal(await screenshotPixels(), initial); cases.push('reset restores the original camera and pixels');
  await page.screenshot({ path: path.join(output, 'desktop-projection.png') });
  await page.goto(address + '/?flat'); await page.getByRole('alert').waitFor(); assert.ok((await page.getByRole('alert').textContent()).includes('不是 2:1')); cases.push('ordinary non-panorama images fail clearly instead of pretending to be 360');
  await page.goto(address + '/?broken'); await page.getByRole('alert').waitFor(); assert.ok((await page.getByRole('alert').textContent()).includes('加载失败')); cases.push('broken image shows a retryable error rather than an empty canvas');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true }); await mobile.goto(address); await mobile.waitForFunction(() => document.querySelector('[data-testid="panorama-viewer"]')?.dataset.status === 'ready');
  mobile.on('pageerror', error => errors.push(error.message));
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 230, y: 280 }] });
  for (let i = 1; i <= 5; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 230 - 24 * i, y: 280 + 7 * i }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(250); assert.ok(Number(await mobile.getByTestId('panorama-viewer').getAttribute('data-yaw')) > .3);
  await touch.detach(); await mobile.reload(); await mobile.waitForFunction(() => document.querySelector('[data-testid="panorama-viewer"]')?.dataset.status === 'ready'); const beforeTap = Number(await mobile.getByTestId('panorama-viewer').getAttribute('data-yaw'));
  await mobile.getByRole('button', { name: '全景向右看', exact: true }).tap(); await mobile.waitForTimeout(250); const afterTap = Number(await mobile.getByTestId('panorama-viewer').getAttribute('data-yaw')); assert.ok(afterTap > beforeTap + .1, `${beforeTap} -> ${afterTap}`); assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await mobile.screenshot({ path: path.join(output, 'mobile-projection.png') }); await mobile.close(); cases.push('390px native touch drag and touch controls rotate without horizontal overflow');
  assert.deepEqual(errors, []); await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: cases.length, cases, browserErrors: errors }, null, 2)); console.log(JSON.stringify({ passed: cases.length, cases, browserErrors: errors }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
