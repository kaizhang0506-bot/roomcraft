import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const output = path.resolve(import.meta.dirname, '../.sites-runtime/pascal-browser');
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const shaderErrors = [];
try {
  // A new browser context has its own storage: never alter the user's project.
  const page = await browser.newPage({ viewport: { width: 1536, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE\.TSL|render failed|Render pass failed|WebGPURenderer init failed/i.test(message.text())) shaderErrors.push(message.text());
  });
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(process.env.ROOMCRAFT_TEST_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByLabel('可编辑户型平面图').waitFor({ timeout: 90000 });
  await page.getByRole('tab', { name: '专业编辑', exact: true }).click();
  const panel = page.getByRole('region', { name: '专业空间建模' });
  async function ready() {
    await page.waitForFunction(() => {
      const panel = document.querySelector('[aria-label="专业空间建模"]');
      return panel?.querySelector('[role="alert"]') || [...(panel?.querySelectorAll('button') || [])].some(button => button.textContent === '导入当前户型' && !button.disabled);
    }, null, { timeout: 90000 });
    assert.equal(await panel.getByRole('alert').count(), 0, await panel.innerText());
  }
  const readScene = () => page.evaluate(() => JSON.parse(localStorage.getItem('roomcraft:professional-scene:v1')));
  const readBackups = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('roomcraft:professional-backup:')).sort().map(key => JSON.parse(localStorage.getItem(key))));
  await ready();
  await panel.getByRole('button', { name: '导入当前户型', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: '已导入当前户型的墙体' }).waitFor();
  await ready();
  const converted = await readScene();
  const counts = {};
  for (const node of Object.values(converted.nodes)) counts[node.type] = (counts[node.type] || 0) + 1;
  for (const [kind, count] of [['wall', 9], ['door', 6], ['window', 3], ['zone', 6], ['slab', 6]]) assert.equal(counts[kind], count, kind);
  assert.equal((await readBackups()).length, 1);
  assert.ok(await panel.locator('canvas').count(), 'Pascal viewer canvas exists');
  // Canvas existence and populated labels previously passed while the sky
  // overlay erased every wall. Verify pixels from the actual lower room area.
  const canvas = panel.locator('canvas').first();
  let roomColorCount = 0;
  for (let attempt = 0; attempt < 12 && roomColorCount < 20; attempt++) {
    const capture = await canvas.screenshot();
    roomColorCount = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const sample = document.createElement('canvas'); sample.width = bitmap.width; sample.height = bitmap.height;
      const context = sample.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      const { data } = context.getImageData(0, 0, sample.width, sample.height);
      const colors = new Set();
      for (let y = Math.floor(sample.height * .66); y < sample.height * .82; y += 3) {
        for (let x = Math.floor(sample.width * .56); x < sample.width * .78; x += 3) {
          const offset = (y * sample.width + x) * 4;
          colors.add(`${data[offset] >> 3},${data[offset + 1] >> 3},${data[offset + 2] >> 3}`);
        }
      }
      return colors.size;
    }, [...capture]);
    if (roomColorCount < 20) await page.waitForTimeout(1000);
  }
  assert.ok(roomColorCount >= 20, `Expected textured room pixels, got ${roomColorCount} quantized colors (possible blank sky overlay).`);
  await page.screenshot({ path: path.join(output, 'sample-import.png'), fullPage: true });

  const imported = structuredClone(converted);
  imported.nodes[imported.rootNodeIds[0]].name = 'JSON 导入回滚校验';
  await panel.locator('input[type="file"]').setInputFiles({ name: 'pascal-import-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await panel.getByRole('status').filter({ hasText: '原专业场景已备份' }).waitFor();
  await ready();
  const afterImport = await readScene();
  assert.equal(afterImport.nodes[afterImport.rootNodeIds[0]].name, 'JSON 导入回滚校验');
  const backups = await readBackups();
  assert.equal(backups.length, 2);
  assert.equal(backups.at(-1).nodes[converted.rootNodeIds[0]].name, converted.nodes[converted.rootNodeIds[0]].name);
  await panel.getByRole('button', { name: '恢复备份', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: '已恢复上一次备份' }).waitFor();
  await ready();
  const restored = await readScene();
  assert.equal(restored.nodes[restored.rootNodeIds[0]].name, converted.nodes[converted.rootNodeIds[0]].name);
  assert.equal((await readBackups()).length, 3);
  assert.deepEqual(errors, []);
  assert.deepEqual(shaderErrors, []);
  const report = { counts, viewerCanvas: true, roomColorCount, priorSceneBackedUp: true, jsonImportBackedUp: true, restorePassed: true, pageErrors: errors, shaderErrors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
