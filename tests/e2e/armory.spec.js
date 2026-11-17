// 第 5 弾: 改造（ハンガー）・武装フリー・改造機（画面を通した確認）
import { test, expect } from '@playwright/test';
import { openApp, trackErrors, state, shot, layoutIssues } from './helpers.js';

test('ハンガー: プロペラ機をフル装備に改造 → 武装フリー（的＋敵機）でミサイル・ロケットが使える', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.locator('#btn-start').tap();
  await page.locator('[data-vehicle="prop"]').tap();
  await page.locator('#btn-vehicle-hangar').tap();
  await expect(page.locator('#scr-hangar')).toHaveClass(/on/);
  await page.locator('[data-test="mod-arms-full"]').tap();
  await page.locator('[data-test="mod-engine-turbo"]').tap();
  await page.locator('[data-test="mod-body-armor"]').tap();
  await expect(page.locator('#hangar-stats')).toContainText('ミサイル 4');
  await expect(page.locator('#hangar-stats')).toContainText('ロケット 12');
  await expect(page.locator('#hangar-stats')).toContainText('60%');
  expect(await layoutIssues(page)).toEqual([]);
  await shot(page, 'r5-hangar');
  const saved = await page.evaluate(() => window.__flight.settings().mods.prop);
  expect(saved).toEqual({ arms: 'full', engine: 'turbo', body: 'armor' });
  await page.locator('#btn-hangar-back').tap();
  await expect(page.locator('#btn-vehicle-hangar')).toContainText('改造中');
  await page.locator('#btn-vehicle-next').tap();
  // 武装の選択はフリーのときだけ
  await page.locator('[data-test="mode-rings"]').tap();
  await expect(page.locator('[data-test="armed-battle"]')).toBeHidden();
  await page.locator('[data-test="mode-free"]').tap();
  await page.locator('[data-test="armed-battle"]').tap();
  await expect(page.locator('#loc-note')).toContainText('武装フリー');
  await page.locator('#btn-fly').tap();
  await page.waitForFunction(() => window.__flight.getState().flying);
  // 説明カードが出たら閉じる
  for (let i = 0; i < 4 && await page.locator('#scr-tutorial.on').count(); i++) await page.locator('#scr-tutorial button.primary').last().tap();
  const st = await state(page);
  expect(st.mode).toBe('free');
  expect(st.combat).toMatchObject({ sandbox: 'battle', hasRockets: true, hasMissiles: true, rockets: 12, missiles: 4 });
  // 両方積んでいるときは 1 つのボタン（ロックしていなければロケット）
  await expect(page.locator('#btn-rocket')).toBeHidden();
  await expect(page.locator('#btn-missile')).toBeVisible();
  await expect(page.locator('#btn-fire')).toBeVisible();
  // ロケットを撃つ（地上では撃てる。地上で止まっていると補給されるので空中で確かめる）
  await page.evaluate(() => { const f = window.__flight; f.setRealtime(false); f.loadScenario('prop', 'island', { mode: 'free', armed: 'battle', spawn: { pos: { x: 600, y: 500, z: 2600 }, heading: 350, speed: 55 } }); f.setInput({ throttle: 1 }); f.step(30); });
  await expect(page.locator('#btn-missile')).toContainText('ロケット');
  await page.locator('#btn-missile').tap();
  const after = await state(page);
  expect(after.combat.rockets).toBe(11);
  await page.evaluate(() => window.__flight.step(60));
  expect(await layoutIssues(page)).toEqual([]);
  await shot(page, 'r5-armed-free');
  expect(errors).toEqual([]);
});

test('改造機: 5 機が選べて、それぞれ飛べる', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.locator('#btn-start').tap();
  for (const id of ['racer', 'warbird', 'rocketplane', 'gunship', 'racedrone']) await expect(page.locator(`[data-vehicle="${id}"]`)).toHaveCount(1);
  await page.locator('[data-vehicle="gunship"]').tap();
  await page.locator('#btn-vehicle-next').tap();
  await page.locator('[data-test="mode-combat"]').tap();
  await expect(page.locator('#loc-note')).toContainText('ミサイル');
  await page.evaluate(() => { const f = window.__flight; f.loadScenario('warbird', 'island', { spawn: { pos: { x: 600, y: 420, z: 2600 }, heading: 350, speed: 110 } }); f.setInput({ throttle: 0.8 }); f.step(30); });
  for (const id of ['racer', 'warbird', 'rocketplane', 'gunship', 'racedrone']) {
    const s = await page.evaluate((v) => { const f = window.__flight; f.loadScenario(v, 'island', { mode: 'combat' }); f.setInput({ throttle: 0.8 }); return f.step(120); }, id);
    expect(s.status, id).toBe('flying');
    expect(await layoutIssues(page), id).toEqual([]);
  }
  expect(errors).toEqual([]);
});
