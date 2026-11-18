import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/ZhuanZ（无密码）/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(import.meta.dirname, '../.sites-runtime/walkthrough-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
// Keep this run on its loaded module graph while other agents work on the dev server.
// The tested app uses HTTP for model jobs; suppress only this test context's HMR sockets.
await page.routeWebSocket(/.*/, () => {});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const cases = [];
const position = async () => page.getByTestId('walkthrough-position').evaluate(element => ({ x: Number(element.dataset.x), y: Number(element.dataset.y), yaw: Number(element.dataset.yaw) }));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const settle = () => page.waitForTimeout(300);
const hold = async (key, ms = 650) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await settle(); };

try {
  await page.goto(process.env.ROOMCRAFT_TEST_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  // SSR buttons exist before hydration; the first automatic local save proves listeners are live.
  await page.waitForFunction(() => Boolean(localStorage.getItem('roomcraft.project.v1')), null, { timeout: 60000 });
  await page.getByRole('tab', { name: '三维空间', exact: true }).click();
  await page.getByRole('button', { name: '进入漫游', exact: true }).waitFor({ timeout: 90000 });
  const canvas = page.getByTestId('scene-view').locator('canvas');
  await canvas.waitFor(); await page.waitForTimeout(1500);
  const orbitBefore = await canvas.evaluate(element => element.toDataURL('image/png'));
  await canvas.screenshot({ path: path.join(output, '01-orbit-before.png') });

  await page.getByRole('button', { name: '进入漫游', exact: true }).click();
  await page.getByTestId('walkthrough-position').waitFor(); await settle();
  const start = await position();
  assert.ok(Number.isFinite(start.x) && Number.isFinite(start.y));
  assert.equal(await page.getByTestId('scene-view').getAttribute('data-walkthrough-active'), 'true');
  cases.push({ case: 'explicit enter switches to a safe first-person camera', start });
  await hold('w');
  const moved = await position();
  assert.ok(distance(start, moved) > .3, `W did not move real camera: ${JSON.stringify({ start, moved })}`);
  cases.push({ case: 'W changes actual camera position', meters: distance(start, moved) });

  const box = await canvas.boundingBox(); assert.ok(box);
  const startX = box.x + box.width * .5, startY = box.y + box.height * .5;
  await page.mouse.move(startX, startY); await page.mouse.down();
  await page.mouse.move(startX + 100, startY - 22, { steps: 8 }); await page.mouse.up(); await settle();
  const looked = await position();
  assert.ok(Math.abs(looked.yaw - moved.yaw) > .15);
  cases.push({ case: 'mouse dragging changes real camera yaw', radians: looked.yaw - moved.yaw });
  await canvas.screenshot({ path: path.join(output, '02-first-person.png') });

  const input = page.locator('#design-prompt');
  await input.focus();
  const focused = await position();
  await page.keyboard.type('wasd'); await page.waitForTimeout(500);
  const typed = await position();
  assert.ok(distance(focused, typed) < .001);
  assert.ok((await input.inputValue()).includes('wasd'));
  cases.push({ case: 'typing WASD in a prompt does not move the camera' });

  await page.getByRole('button', { name: '重置安全出生点' }).click(); await settle();
  await canvas.focus();
  await page.keyboard.down('w'); await page.waitForTimeout(200);
  await input.focus(); await settle();
  const focusedWhileHeld = await position();
  await page.waitForTimeout(500);
  assert.ok(distance(focusedWhileHeld, await position()) < .001);
  await page.keyboard.up('w');
  cases.push({ case: 'moving focus into a text field clears already-held movement keys' });

  await page.getByRole('combobox', { name: '进入指定房间' }).selectOption('bedroom'); await settle();
  const bedroom = await position();
  assert.ok(bedroom.x >= 6.6 && bedroom.x <= 11.4 && bedroom.y <= 4.4);
  cases.push({ case: 'room selector relocates to safe space in the chosen room', position: bedroom });
  const forwardButton = page.getByRole('button', { name: '向前移动', exact: true });
  const buttonBox = await forwardButton.boundingBox(); assert.ok(buttonBox);
  await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
  await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up(); await settle();
  const buttonMoved = await position();
  assert.ok(distance(bedroom, buttonMoved) > .2);
  cases.push({ case: 'on-screen direction control moves the real camera', meters: distance(bedroom, buttonMoved) });
  await page.getByRole('button', { name: '重置安全出生点' }).click(); await settle();
  assert.ok(distance(bedroom, await position()) < .01);
  cases.push({ case: 'reset returns to a safe room standing point' });

  await canvas.focus(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '进入漫游', exact: true }).waitFor(); await page.waitForTimeout(800);
  assert.equal(await page.getByTestId('scene-view').getAttribute('data-walkthrough-active'), 'false');
  assert.equal(await page.evaluate(() => document.pointerLockElement === null), true);
  const orbitAfter = await canvas.evaluate(element => element.toDataURL('image/png'));
  await canvas.screenshot({ path: path.join(output, '03-orbit-restored.png') });
  assert.equal(orbitAfter, orbitBefore, 'orbit camera pixels did not return to the saved view');
  cases.push({ case: 'Escape exits, releases pointer lock and restores the previous orbit view exactly' });

  await page.getByRole('button', { name: '进入漫游', exact: true }).click(); await settle();
  await page.getByRole('button', { name: '锁定鼠标看向', exact: true }).click(); await settle();
  const pointerLockAcquired = await page.evaluate(() => document.pointerLockElement?.tagName === 'CANVAS');
  if (pointerLockAcquired) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '进入漫游', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.pointerLockElement === null), true);
    cases.push({ case: 'explicit pointer lock works and Escape releases it and exits' });
  } else {
    await page.getByRole('button', { name: '退出漫游', exact: true }).click();
    cases.push({ case: 'pointer lock unavailable in this browser; drag-look fallback remains available' });
  }

  await page.getByRole('button', { name: '进入漫游', exact: true }).click(); await settle();
  await page.keyboard.down('w'); await page.waitForTimeout(150);
  await page.getByRole('tab', { name: '平面设计', exact: true }).click(); await page.keyboard.up('w');
  await page.getByRole('tab', { name: '三维空间', exact: true }).click();
  await page.getByRole('button', { name: '进入漫游', exact: true }).waitFor(); await page.waitForTimeout(500);
  assert.equal(await page.getByTestId('scene-view').getAttribute('data-walkthrough-active'), 'false');
  cases.push({ case: 'switching views unmounts walking controls and does not retain held keys' });
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  const report = { status: 'passed', checks: cases.length, cases, browserErrors: errors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), cases, browserErrors: errors }, null, 2));
  throw error;
} finally { await browser.close(); }
