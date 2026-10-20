// センサーが無い / 許可されない環境ではバーチャルスティックに切り替わる。縦向きでは案内を出す。
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state } from './helpers.js';

async function fly(page) {
  await page.click('[data-vehicle="prop"]');
  await page.click('#btn-vehicle-next');
  await page.click('#btn-fly');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
}

test('センサーのイベントが来ない → スティックに自動切替', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.click('#btn-start');
  await page.waitForTimeout(1600);
  expect((await state(page)).inputMode).toBe('stick');
  await expect(page.locator('#toast')).toContainText('スティック');
  await fly(page);
  await expect(page.locator('#stick')).toHaveClass(/on/);
  // スティックを右下へドラッグ → 右ロール＋機首上げ
  const b = await page.locator('#stick').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.8, { steps: 5 });
  const inp = await page.evaluate(() => window.__flight.readInput());
  expect(inp.roll).toBeGreaterThan(0.2);
  expect(inp.pitch).toBeGreaterThan(0.2);
  await page.mouse.up();
  const inp2 = await page.evaluate(() => window.__flight.readInput());
  expect(inp2.roll).toBe(0);
  expect(errors).toEqual([]);
});

test('DeviceOrientationEvent が存在しない → スティック', async ({ page }) => {
  await page.addInitScript(() => { delete window.DeviceOrientationEvent; });
  const errors = trackErrors(page);
  await openApp(page);
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__flight.getState().inputMode === 'stick');
  await fly(page);
  await expect(page.locator('#stick')).toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test('iOS 方式の許可で拒否された → スティック', async ({ page }) => {
  await page.addInitScript(() => {
    window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied');
  });
  const errors = trackErrors(page);
  await openApp(page);
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__flight.getState().inputMode === 'stick');
  await fly(page);
  await expect(page.locator('#stick')).toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test('iOS 方式の許可がタップの中で要求され、許可されれば傾き操作', async ({ page }) => {
  await page.addInitScript(() => {
    window.__permAsked = 0;
    window.DeviceOrientationEvent.requestPermission = () => { window.__permAsked++; return Promise.resolve('granted'); };
    setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10, beta: 30, gamma: -60 })), 40);
  });
  await openApp(page);
  expect(await page.evaluate(() => window.__permAsked)).toBe(0);
  await page.click('#btn-start');
  expect(await page.evaluate(() => window.__permAsked)).toBe(1);
  await page.waitForFunction(() => window.__flight.getState().inputMode === 'tilt');
});

test.describe('縦向き', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('「横向きにしてください」の案内が出る', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#rotate')).toBeVisible();
    await expect(page.locator('#rotate')).toContainText('横向きにしてください');
  });
});
