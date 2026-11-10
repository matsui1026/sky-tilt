// 第 4 弾: 曲技モード・スモーク・スター集め（画面を通した確認）
import { test, expect } from '@playwright/test';
import { openApp, trackErrors, state, shot, layoutIssues } from './helpers.js';

test('曲技モード: メニューから選べて、ロールでコンボ → 時間切れで結果と自己ベスト', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.locator('#btn-start').tap();
  await page.locator('[data-vehicle="fighter"]').tap();
  await page.locator('#btn-vehicle-next').tap();
  await page.locator('[data-test="mode-stunt"]').tap();
  await expect(page.locator('#loc-note')).toContainText('曲技');
  // 車では選べない
  await page.evaluate(() => window.__flight.loadScenario('fighter', 'island', { mode: 'stunt', stuntTime: 12 }));
  expect((await state(page)).stunt.left).toBeCloseTo(12, 1);
  await page.evaluate(() => { const f = window.__flight; f.setInput({ throttle: 1, roll: 1 }); f.step(220); });
  const mid = await state(page);
  expect(mid.stunt.counts.roll).toBeGreaterThanOrEqual(2);
  expect(mid.stunt.combo).toBeGreaterThan(0);
  expect(await layoutIssues(page)).toEqual([]);
  await shot(page, 'r4-stunt-combo');
  await page.evaluate(() => { const f = window.__flight; f.setInput({ roll: 0, pitch: 0.05 }); f.step(520); });
  await expect(page.locator('#scr-result')).toHaveClass(/on/);
  await expect(page.locator('#result-score')).toContainText('点');
  await expect(page.locator('#result-grade')).toHaveText(/[SABC]/);
  await expect(page.locator('#scr-result')).toContainText('新記録');
  await shot(page, 'r4-stunt-result');
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem('skytilt.modeBest.v1'))['stunt:fighter:island']);
  expect(best).toBeGreaterThan(0);
  const prog = await page.evaluate(() => window.__flight.progress());
  expect(prog.stats.rolls).toBeGreaterThanOrEqual(2);
  expect(prog.stats.stuntBest).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('スター集め: 通り抜けると取れて保存され、飛び直しても残る。設定で切れる', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  const star = await page.evaluate(() => {
    const f = window.__flight;
    f.loadScenario('prop', 'island', {});
    return { s: f.stars().list[1], key: f.stars().key };
  });
  expect(star.key).toBe('island:air');
  await page.evaluate((s) => {
    const f = window.__flight;
    f.loadScenario('prop', 'island', { spawn: { pos: { x: s.x, y: s.y, z: s.z + 260 }, heading: 0, speed: 50 } });
    f.setInput({ throttle: 0.7 });
    f.step(20);
  }, star.s);
  await shot(page, 'r4-star');
  await page.evaluate(() => window.__flight.step(400));
  const st = await state(page);
  expect(st.stars.got).toBe(1);
  await expect(page.locator('#toast')).toContainText('スター 1 / 15');
  expect(await page.evaluate(() => localStorage.getItem('skytilt.stars.v1'))).toBe('{"island:air":[1]}');
  // 飛び直しても取った星は残る。車は別の組（地上）
  await page.evaluate(() => window.__flight.loadScenario('heli', 'island', {}));
  expect((await state(page)).stars.got).toBe(1);
  await page.evaluate(() => window.__flight.loadScenario('driftcar', 'island', {}));
  const car = await state(page);
  expect(car.stars).toMatchObject({ got: 0, total: 12 });
  // リング・射撃では出ない
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', { mode: 'rings' }));
  expect((await state(page)).stars).toBeUndefined();
  expect((await page.evaluate(() => window.__flight.progress())).stats.stars).toBe(1);
  expect(errors).toEqual([]);
});

test('スモーク: ボタンで色が切り替わり、車・熱気球には出ない', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', { spawn: { pos: { x: 600, y: 420, z: 2600 }, heading: 350, speed: 55 }, realtime: true }));
  const btn = page.locator('#btn-smoke');
  await expect(btn).toBeVisible();
  await btn.tap();
  await expect(btn).toHaveClass(/on/);
  await expect(btn).toContainText('白');
  await btn.tap();
  await expect(btn).toContainText('赤');
  expect(await page.evaluate(() => window.__flight.smoke())).toBe(1);
  await page.evaluate(() => { const f = window.__flight; f.setInput({ throttle: 1, roll: 0.7, pitch: 0.3 }); f.setCamera('external'); });
  await page.waitForTimeout(3000);
  expect(await layoutIssues(page)).toEqual([]);
  await shot(page, 'r4-smoke');
  await btn.tap();
  await btn.tap();
  await btn.tap();
  await expect(btn).not.toHaveClass(/on/);
  expect(await page.evaluate(() => window.__flight.smoke())).toBe(-1);
  for (const v of ['driftcar', 'balloon']) {
    await page.evaluate((id) => window.__flight.loadScenario(id, 'island', {}), v);
    await expect(btn).toBeHidden();
  }
  // 滑空機は早送り・スモーク・AP・視点が並ぶ（重ならない）
  await page.evaluate(() => window.__flight.loadScenario('sailplane', 'island', {}));
  await expect(btn).toBeVisible();
  expect(await layoutIssues(page)).toEqual([]);
  expect(errors).toEqual([]);
});
