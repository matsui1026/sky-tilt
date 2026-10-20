// 一時停止・再キャリブレーション・設定変更・機体変更・リスタート
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state } from './helpers.js';

async function flyFromUi(page, vehicle = 'prop', location = 'island') {
  await page.click('#btn-start');
  await page.click(`[data-vehicle="${vehicle}"]`);
  await page.click('#btn-vehicle-next');
  await page.click(`[data-location="${location}"]`);
  await page.click('#btn-fly');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
}

test('一時停止・再キャリブレーション・設定・機体変更・リスタート', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await flyFromUi(page);

  // 一時停止で物理が止まる
  await page.click('#btn-pause');
  await expect(page.locator('#scr-pause')).toBeVisible();
  let st = await state(page);
  expect(st.paused).toBe(true);
  const t0 = st.t;
  await page.waitForTimeout(500);
  expect((await state(page)).t).toBe(t0);

  // 再キャリブレーション（メニューから）→ 再開する
  await page.click('#btn-recal');
  await expect(page.locator('#scr-pause')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('ニュートラル');
  st = await state(page);
  expect(st.paused).toBe(false);
  await page.waitForTimeout(400);
  expect((await state(page)).t).toBeGreaterThan(t0);

  // HUD の再キャリブレーションボタンと視点切替
  await page.click('#btn-hud-recal');
  await expect(page.locator('#toast')).toContainText('ニュートラル');
  const cam0 = (await state(page)).camera;
  await page.click('#btn-camera');
  expect((await state(page)).camera).not.toBe(cam0);

  // 設定変更（感度・ピッチ反転・操作方式）
  await page.click('#btn-pause');
  await page.click('#btn-settings');
  await expect(page.locator('#scr-settings')).toBeVisible();
  await page.locator('input[data-setting="sensitivity"]').fill('1.5');
  await page.locator('input[data-setting="expo"]').fill('0.6');
  await page.click('button[data-setting="invertPitch"]');
  await page.click('[data-test="control-stick"]');
  let s = await page.evaluate(() => window.__flight.settings());
  expect(s.sensitivity).toBeCloseTo(1.5);
  expect(s.expo).toBeCloseTo(0.6);
  expect(s.invertPitch).toBe(true);
  expect(s.control).toBe('stick');
  expect((await state(page)).inputMode).toBe('stick');
  await expect(page.locator('#stick')).toHaveClass(/on/);
  await page.click('#btn-settings-close');
  await expect(page.locator('#scr-pause')).toBeVisible();

  // リスタート
  await page.click('#btn-restart');
  await expect(page.locator('#scr-pause')).toBeHidden();
  st = await state(page);
  expect(st.t).toBeLessThan(1.0);

  // 機体変更
  await page.click('#btn-pause');
  await page.click('#btn-change-vehicle');
  await expect(page.locator('#scr-vehicle')).toBeVisible();
  await page.click('[data-vehicle="fighter"]');
  await page.click('#btn-vehicle-next');
  await page.click('[data-location="desert"]');
  await page.click('#btn-fly');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
  st = await state(page);
  expect(st.vehicleId).toBe('fighter');
  expect(st.locationId).toBe('desert');
  await expect(page.locator('[data-button="ab"]')).toBeVisible();

  // 設定は保存され、再読み込み後も残る
  await page.reload();
  await page.waitForFunction(() => !!window.__flight);
  s = await page.evaluate(() => window.__flight.settings());
  expect(s.sensitivity).toBeCloseTo(1.5);
  expect(s.invertPitch).toBe(true);
  expect(errors).toEqual([]);
});

test('機体固有ボタンが効き、押下で視覚フィードバックが出る', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('airliner', 'island', { spawn: { pos: { x: 0, y: 1500, z: 3000 }, heading: 0, speed: 120, throttle: 0.5 } }));
  await page.click('[data-button="flaps"]');
  await page.click('[data-button="gear"]');
  await page.click('[data-button="spoiler"]');
  const st = await state(page);
  expect(st.flaps).toBe(2);
  expect(st.gearCmd).toBe(false);
  expect(st.spoiler).toBe(true);
  await expect(page.locator('[data-button="spoiler"]')).toHaveClass(/on/);
  // ホールド型（ラダー）は押している間だけヨー入力
  const rudder = page.locator('[data-button="rudderR"]');
  const box = await rudder.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(rudder).toHaveClass(/pressed/);
  let inp = await page.evaluate(() => window.__flight.readInput());
  expect(inp.yaw).toBe(1);
  await page.mouse.up();
  inp = await page.evaluate(() => window.__flight.readInput());
  expect(inp.yaw).toBe(0);
  // スロットル（縦スライダー）をドラッグ
  const thr = await page.locator('#throttle').boundingBox();
  await page.mouse.move(thr.x + thr.width / 2, thr.y + thr.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(thr.x + thr.width / 2, thr.y + thr.height * 0.3, { steps: 6 });
  await page.mouse.up();
  inp = await page.evaluate(() => window.__flight.readInput());
  expect(inp.throttle).toBeGreaterThan(0.8);
  expect(errors).toEqual([]);
});
