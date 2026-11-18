import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/ZhuanZ（无密码）/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.sites-runtime/photo-tour-browser');
await mkdir(output, { recursive: true });
const panorama = 'data:image/png;base64,' + (await readFile(path.join(root, 'public/images/photo-tour-demo-v1.png'))).toString('base64');
const perspective = 'data:image/png;base64,' + (await readFile(path.join(root, 'public/images/living-room.png'))).toString('base64');
const browser = await chromium.launch({ headless: true, args: ['--disable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1550, height: 1050 } });
await page.routeWebSocket(/.*/, () => {});
const errors = [], cases = [];
let submissions = 0, polls = 0, wrongAspect = false;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/generate**', async route => {
  const request = route.request();
  if (request.method() === 'POST') {
    const body = request.postDataJSON(); assert.equal(body.mode, 'panorama'); assert.ok(body.roomId); submissions++;
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'processing', model: 'TEST ONLY', taskId: `mock-panorama-${submissions}`, taskToken: `${Math.floor(Date.now() / 1000)}.${'a'.repeat(43)}` }) });
  } else {
    assert.ok(request.headers()['x-roomcraft-task-token']); polls++;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'succeeded', model: 'TEST ONLY', image: wrongAspect ? perspective : panorama }) });
  }
});
async function openPhoto() {
  await page.getByLabel('可编辑户型平面图').waitFor({ timeout: 90000 });
  await page.waitForFunction(() => !!localStorage.getItem('roomcraft.project.v1'));
  // After a reload SSR and persisted localStorage can appear before hydration.
  // Retry the tab only until the interactive component has actually mounted.
  for (let attempt = 0; attempt < 15 && !await page.getByTestId('photo-tour').isVisible(); attempt++) {
    await page.getByRole('tab', { name: '全景预览', exact: true }).click();
    await page.waitForTimeout(500);
  }
  await page.getByTestId('photo-tour').waitFor({ timeout: 30000 });
}
const viewer = page.getByTestId('panorama-viewer');
try {
  await page.goto(process.env.ROOMCRAFT_TEST_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await openPhoto();
  await page.waitForFunction(() => document.querySelector('[data-testid="panorama-viewer"]')?.getAttribute('data-status') === 'ready', { timeout: 30000 });
  assert.match(await viewer.innerText(), /非当前户型/);
  assert.equal(await page.evaluate(() => document.createElement('canvas').getContext('webgl')), null);
  cases.push('photo demo renders a real perspective projection without WebGL, clearly labeled as unrelated AI sample');
  const before = await viewer.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.getByRole('button', { name: '全景向右看', exact: true }).click();
  await page.waitForTimeout(400);
  assert.notEqual(await viewer.locator('canvas').evaluate(canvas => canvas.toDataURL()), before);
  assert.notEqual(Number(await viewer.getAttribute('data-yaw')), 0);
  cases.push('turning the panorama changes actual photographed pixels');
  await page.screenshot({ path: path.join(output, '01-photo-preview-no-webgl.png') });
  await page.getByRole('button', { name: '生成当前房间全景', exact: true }).click();
  await page.getByText('全景任务已受理，正在查询原任务', { exact: false }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '停止等待', exact: true }).click();
  await page.getByRole('button', { name: '继续等待', exact: true }).waitFor();
  assert.equal(submissions, 1); assert.equal(polls, 0);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('roomcraft.panorama.pending.v1.')).length), 1);
  cases.push('stopping polling keeps the one submitted task and does not resubmit');
  await page.reload({ waitUntil: 'domcontentloaded' }); await openPhoto();
  await page.getByRole('button', { name: '继续等待', exact: true }).waitFor();
  assert.equal(submissions, 1);
  await page.getByRole('button', { name: '继续等待', exact: true }).click();
  await page.getByText('全景已生成；AI 画面需核对门窗与布局，不能用于测量。', { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(submissions, 1); assert.equal(polls, 1);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('roomcraft.panorama.pending.v1.')).length), 0);
  assert.match(await viewer.innerText(), /客餐厅.*AI 生成全景/);
  cases.push('pending panorama survives reload and resumes the same task with owner token, then clears pending');
  await page.getByRole('button', { name: '日式原木', exact: true }).click();
  await page.getByText('户型、材质、风格或设计要求已变化；当前全景是旧版画面，请重新生成。图片不会自动跟随三维几何变化。', { exact: true }).waitFor();
  cases.push('changing design style visibly marks the stored panorama as stale');
  await page.getByRole('combobox', { name: '全景房间节点' }).selectOption('bedroom');
  await page.getByText('主卧还没有全景', { exact: true }).waitFor();
  assert.equal(await viewer.count(), 0);
  cases.push('room navigation never substitutes another room image when the target has no panorama');
  await page.getByRole('combobox', { name: '全景房间节点' }).selectOption('living');
  await page.waitForFunction(() => document.querySelector('[data-testid="panorama-viewer"]')?.getAttribute('data-status') === 'ready');
  await page.reload({ waitUntil: 'domcontentloaded' }); await openPhoto();
  await page.getByRole('combobox', { name: '全景房间节点' }).selectOption('bedroom');
  await page.getByRole('combobox', { name: '全景房间节点' }).selectOption('living');
  await page.waitForFunction(() => document.querySelector('[data-testid="panorama-viewer"]')?.getAttribute('data-status') === 'ready');
  cases.push('panorama remains in its independent IndexedDB store after refresh');
  wrongAspect = true;
  await page.getByRole('button', { name: '重新生成房间全景', exact: true }).click();
  await page.getByText(/未达到 2:1 全景比例/).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '下载生成原图', exact: true }).waitFor();
  assert.equal(submissions, 2); assert.equal(polls, 2);
  assert.match(await viewer.innerText(), /客餐厅.*AI 生成全景/);
  cases.push('ordinary 3:2 generated image is rejected as panorama and retained only for download');
  await page.getByLabel('上传2比1全景图').setInputFiles(path.join(root, 'public/images/living-room.png'));
  await page.getByText('需要 2:1 的等距柱状全景图，例如 4096×2048；普通透视照片无法完整环顾。', { exact: true }).waitFor();
  cases.push('ordinary user photo is rejected instead of stretching it into a fake 360 image');
  await page.getByLabel('上传2比1全景图').setInputFiles(path.join(root, 'public/images/photo-tour-demo-v1.png'));
  await page.getByText('已载入用户上传的全景；来源与拍摄位置由上传者确认，不表示图片自动匹配户型。', { exact: true }).waitFor();
  assert.match(await viewer.innerText(), /用户上传全景 · 来源由上传者确认/);
  cases.push('uploaded panorama has source labeling distinct from AI-generated images');
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota failure', 'QuotaExceededError'); }; });
  await page.getByLabel('上传2比1全景图').setInputFiles(path.join(root, 'public/images/photo-tour-demo-v1.png'));
  await page.getByText('全景保存未完成，请下载原图', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下载全景原图', exact: true }).waitFor();
  cases.push('IndexedDB quota failure stays visible and preserves the in-memory panorama for download');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  await page.screenshot({ path: path.join(output, '02-photo-preview-mobile.png') });
  cases.push('photo controls fit mobile width');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', passed: cases.length, cases, browserErrors: errors, mockedProvider: true, paidRequests: 0 }, null, 2));
  console.log(JSON.stringify({ passed: cases.length, cases, browserErrors: errors, mockedProvider: true, paidRequests: 0 }, null, 2));
} finally { await browser.close(); }
