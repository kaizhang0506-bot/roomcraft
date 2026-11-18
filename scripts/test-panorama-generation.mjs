import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.sites-runtime', 'panorama-generation-check');
await mkdir(output, { recursive: true });
await build({ stdin: { contents: "export * from './lib/ai-server'; export * from './lib/server-env'; export * from './lib/plan'; export * from './lib/panorama';", resolveDir: root, loader: 'ts' }, outfile: path.join(output, 'test-bundle.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' });
const { generateInterior, runWithAppEnv, clonePlan, getPanoramaSceneKey, getPanoramaProjectKey, isPanoramaImageAspect } = await import(pathToFileURL(path.join(output, 'test-bundle.mjs')).href);
const originalFetch = globalThis.fetch;
const config = { IMAGE_API_KEY: 'fake-unit-test-key-no-real-credentials', IMAGE_BASE_URL: 'https://relay.example/v1', IMAGE_MODEL: 'gpt-image-2', IMAGE_PROTOCOL: 'conflux_async' };
const plan = clonePlan();
const request = (changes = {}) => ({ plan, mode: 'panorama', roomId: 'living', style: 'chinese', prompt: '保留木格栅', ...changes });
const send = body => runWithAppEnv(config, () => generateInterior(body, 'user-test'));
const checks = [];
async function check(name, test) { await test(); checks.push(name); }
let calls, payload, pathUsed;
function mockAsync() {
  calls = 0; payload = undefined; pathUsed = '';
  globalThis.fetch = async (url, options) => {
    calls++; pathUsed = String(url); payload = JSON.parse(options.body);
    return Response.json({ id: 'img_pano_unit_123', status: 'processing', model: 'gpt-image-2' });
  };
}

try {
  await check('ordinary generation keeps its existing dimensions, quality and perspective instruction', async () => {
    mockAsync(); const result = await send({ plan, style: 'chinese' });
    assert.equal(calls, 1); assert.equal(payload.size, '1536x1024'); assert.equal(payload.quality, 'medium'); assert.match(payload.prompt, /reference view's camera/); assert.equal(result.mode, undefined);
  });
  await check('panorama request uses controlled 2:1 high-quality preset and full spherical projection', async () => {
    mockAsync(); const result = await send(request());
    assert.equal(calls, 1); assert.equal(pathUsed, 'https://relay.example/v1/images/generations/async'); assert.equal(payload.size, '2048x1024'); assert.equal(payload.quality, 'high'); assert.equal(payload.n, 1);
    for (const phrase of ['360 x 180', 'EQUIRECTANGULAR', 'Left and right edges must join seamlessly', '1.65', 'NOT a wide-angle perspective', 'not a site photograph', 'fixed camera node']) assert.ok(payload.prompt.includes(phrase), phrase);
    assert.equal(result.status, 'processing'); assert.ok(result.taskToken); assert.equal(result.mode, 'panorama'); assert.equal(result.projection, 'equirectangular'); assert.equal(result.roomId, 'living'); assert.equal(result.sourceKey, getPanoramaSceneKey(plan, 'living', 'chinese', '保留木格栅'));
  });
  await check('prompt carries semantic room polygon, openings, material assignments and furniture', async () => {
    mockAsync(); await send(request());
    for (const field of ['"polygon"', '"ceilingHeight":2.8', '"openings"', '"sill"', '"floorMaterialId"', '"materials"', '"furniture"', 'f1']) assert.ok(payload.prompt.includes(field), field);
    assert.equal(payload.prompt.includes(config.IMAGE_API_KEY), false); assert.equal('input_fidelity' in payload, false);
  });
  await check('panorama rejects missing, all-space and unknown room IDs before submitting', async () => {
    mockAsync(); for (const roomId of [undefined, 'all', 'missing']) await assert.rejects(() => send(request({ roomId })), error => error.status === 400);
    assert.equal(calls, 0);
  });
  await check('unsupported generation modes and mesh-only plans cannot submit', async () => {
    mockAsync(); await assert.rejects(() => send(request({ mode: 'fake-3d' })), error => error.status === 400);
    await assert.rejects(() => send(request({ plan: { mesh: 'obj' } })), error => error.status === 400); assert.equal(calls, 0);
  });
  await check('references guide the full sphere without preserving a perspective camera', async () => {
    mockAsync(); const referenceImage = 'data:image/png;base64,' + Buffer.from('unit reference').toString('base64'); await send(request({ referenceImage }));
    assert.equal(pathUsed, 'https://relay.example/v1/images/edits/async'); assert.equal(payload.image_base64, referenceImage); assert.equal(payload.size, '2048x1024'); assert.match(payload.prompt, /rather than preserving its perspective camera/);
  });
  await check('standard synchronous generation protocol receives panorama dimensions and metadata', async () => {
    let standardPayload;
    globalThis.fetch = async (url, options) => { assert.equal(String(url), 'https://relay.example/v1/images/generations'); standardPayload = JSON.parse(options.body); return Response.json({ data: [{ b64_json: 'dW5pdC1pbWFnZQ==' }] }); };
    const result = await runWithAppEnv({ ...config, IMAGE_PROTOCOL: 'openai' }, () => generateInterior(request(), 'user-test'));
    assert.equal(standardPayload.size, '2048x1024'); assert.equal(standardPayload.quality, 'high'); assert.equal(result.projection, 'equirectangular'); assert.ok(result.image.startsWith('data:image/png;base64,'));
  });
  await check('standard reference edit protocol uses multipart panorama preset', async () => {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://relay.example/v1/images/edits'); assert.ok(options.body instanceof FormData); assert.equal(options.body.get('size'), '2048x1024'); assert.equal(options.body.get('quality'), 'high'); assert.ok(options.body.get('image[]') instanceof Blob);
      return Response.json({ data: [{ b64_json: 'dW5pdC1pbWFnZQ==' }] });
    };
    await runWithAppEnv({ ...config, IMAGE_PROTOCOL: 'openai' }, () => generateInterior(request({ referenceImage: 'data:image/png;base64,dW5pdA==' }), 'user-test'));
  });
  const key = getPanoramaSceneKey(plan, 'living', 'chinese', 'brief');
  await check('scene key is stable through object key ordering and semantic array reordering', () => {
    const q = clonePlan(plan); q.rooms.reverse(); q.walls.reverse(); q.openings.reverse(); q.furniture.reverse(); q.materials.reverse();
    assert.equal(getPanoramaSceneKey(q, 'living', 'chinese', 'brief'), key);
  });
  await check('wall and polygon edits invalidate cached panorama even with unchanged bounds', () => {
    const q = clonePlan(plan); q.walls[0].start.x += .1; assert.notEqual(getPanoramaSceneKey(q, 'living', 'chinese', 'brief'), key);
    const r = clonePlan(plan); r.rooms[0].polygon[1].y += .1; assert.notEqual(getPanoramaSceneKey(r, 'living', 'chinese', 'brief'), key);
  });
  await check('furniture placement and material changes invalidate cached panorama', () => {
    const q = clonePlan(plan); q.furniture[0].rotation = 90; assert.notEqual(getPanoramaSceneKey(q, 'living', 'chinese', 'brief'), key);
    const r = clonePlan(plan); r.materials[0].color = '#123456'; assert.notEqual(getPanoramaSceneKey(r, 'living', 'chinese', 'brief'), key);
  });
  await check('room, style, prompt and ceiling height participate in scene signature', () => {
    assert.notEqual(getPanoramaSceneKey(plan, 'bedroom', 'chinese', 'brief'), key); assert.notEqual(getPanoramaSceneKey(plan, 'living', 'modern', 'brief'), key); assert.notEqual(getPanoramaSceneKey(plan, 'living', 'chinese', 'new'), key);
    const q = clonePlan(plan); q.ceilingHeight += .2; assert.notEqual(getPanoramaSceneKey(q, 'living', 'chinese', 'brief'), key);
  });
  await check('verification flags and recognition warnings do not invalidate a visual snapshot', () => {
    const q = clonePlan(plan); q.verified = !q.verified; q.recognition = { provider: 'manual', needsReview: false, warnings: ['metadata only'] }; assert.equal(getPanoramaSceneKey(q, 'living', 'chinese', 'brief'), key);
  });
  await check('legacy rectangles normalize into the same scene signature', () => {
    const q = clonePlan(plan); q.rooms = q.rooms.map(({ polygon, ...room }) => room); delete q.materials; delete q.schemaVersion; delete q.units; delete q.ceilingHeight;
    assert.equal(getPanoramaSceneKey(q, 'living', 'chinese', 'brief'), key);
  });
  await check('local project namespace survives geometry, wall addition and material changes', () => {
    const key = getPanoramaProjectKey(plan), q = clonePlan(plan); q.rooms[0].polygon[0].x -= .1; q.materials[0].roughness = .5; q.walls.push({ ...q.walls[0], id: 'new-wall' }); assert.equal(getPanoramaProjectKey(q), key);
    q.name += ' copy'; assert.notEqual(getPanoramaProjectKey(q), key);
  });
  await check('panorama aspect check rejects perspective renders and invalid dimensions', () => {
    assert.equal(isPanoramaImageAspect(2048, 1024), true); assert.equal(isPanoramaImageAspect(2000, 1001), true);
    for (const [w, h] of [[1536, 1024], [1024, 1024], [0, 0], [-2, -1], [Infinity, 100], [2000, NaN]]) assert.equal(isPanoramaImageAspect(w, h), false);
  });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: checks.length, checks, livePaidCalls: 0 }, null, 2));
  console.log(`${checks.length} panorama generation, protocol and staleness checks passed; no live model calls.`);
} finally { globalThis.fetch = originalFetch; }
