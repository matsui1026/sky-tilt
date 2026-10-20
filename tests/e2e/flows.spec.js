// タイトル → 機体選択 → ロケーション選択 → 飛行 を全 8 機体 × 全 5 ロケーションで完走（コンソールエラー 0 件）
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state } from './helpers.js';
import { VEHICLE_ORDER } from '../../src/data/vehicles.js';
import { LOCATION_ORDER, TIME_ORDER, WEATHER_ORDER } from '../../src/data/locations.js';

for (const [vi, vehicle] of VEHICLE_ORDER.entries()) {
  test(`UI フロー: ${vehicle} × 全ロケーション`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page);
    await expect(page.locator('#scr-title')).toBeVisible();
    await page.click('#btn-start');
    await expect(page.locator('#scr-vehicle')).toBeVisible();
    for (const [li, loc] of LOCATION_ORDER.entries()) {
      await page.click(`[data-vehicle="${vehicle}"]`);
      await page.click('#btn-vehicle-next');
      await expect(page.locator('#scr-location')).toBeVisible();
      await page.click(`[data-location="${loc}"]`);
      const time = TIME_ORDER[(li + vi) % TIME_ORDER.length];
      const weather = WEATHER_ORDER[(li + vi) % WEATHER_ORDER.length];
      await page.click(`[data-test="time-${time}"]`);
      await page.click(`[data-test="weather-${weather}"]`);
      await page.click('#btn-fly');
      await page.waitForFunction(() => window.__flight.getState().flying === true);
      await expect(page.locator('#controls')).toHaveClass(/on/);
      // 実時間で少し飛ばし、さらに物理を進める
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => window.__flight.step(60));
      expect(st.vehicleId).toBe(vehicle);
      expect(st.locationId).toBe(loc);
      expect(Number.isFinite(st.altitude)).toBe(true);
      expect((await state(page)).screen).toBe(null);
      // HUD が描かれている
      const drawn = await page.evaluate(() => {
        const c = document.getElementById('hud');
        const g = c.getContext('2d');
        const d = g.getImageData(0, 0, c.width, c.height / 4).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
        return n;
      });
      expect(drawn).toBeGreaterThan(50);
      // 一時停止 → 機体変更
      if ((await state(page)).screen === 'crash') await page.click('#btn-crash-vehicle');
      else {
        await page.click('#btn-pause');
        await expect(page.locator('#scr-pause')).toBeVisible();
        await page.click('#btn-change-vehicle');
      }
      await expect(page.locator('#scr-vehicle')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
