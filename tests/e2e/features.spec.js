// 追加機能の E2E: 射撃モード、リングの見やすさ、操作ガイド、新しい機体、2 人プレイ（WebRTC）
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state, shot, layoutIssues } from './helpers.js';
import { VEHICLE_ORDER, VEHICLES } from '../../src/data/vehicles.js';

const SAFE = { l: 44, r: 44, t: 0, b: 21 };
async function emulateNotch(page) {
  await page.addStyleTag({ content: `:root { --safe-l: ${SAFE.l}px !important; --safe-r: ${SAFE.r}px !important; --safe-b: ${SAFE.b}px !important; }` });
}

test('射撃モード: 射撃ボタンで撃ち、的を割り、HUD とレーダーが出る', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.click('#btn-start');
  await page.click('[data-vehicle="fighter"]');
  await page.click('#btn-vehicle-next');
  await page.click('[data-test="mode-combat"]');
  await expect(page.locator('#loc-note')).toContainText('機関砲');
  await page.click('#btn-fly');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
  await page.evaluate(() => window.__flight.setRealtime(false));
  await expect(page.locator('#btn-fire')).toBeVisible();
  await expect(page.locator('#btn-missile')).toBeVisible();
  // 射撃ボタンを押している間だけ撃つ
  const fire = await page.locator('#btn-fire').boundingBox();
  await page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
  await page.mouse.down();
  let st = await page.evaluate(() => window.__flight.step(30));
  await page.mouse.up();
  expect(st.combat.shots).toBeGreaterThan(5);
  const shots = st.combat.shots;
  st = await page.evaluate(() => window.__flight.step(30));
  expect(st.combat.shots).toBe(shots);
  // 正面に風船を置いて撃つ → 割れる
  const popped = await page.evaluate(() => {
    const app = window.__app;
    const c = app.sim.combat;
    const vs = app.sim.vs;
    const b = c.targets.find((t) => t.type === 'balloon');
    const f = { x: 0, y: 0, z: -1 };
    // 機首方向
    const q = vs.q;
    const tx = 2 * (q.y * f.z - q.z * f.y), ty = 2 * (q.z * f.x - q.x * f.z), tz = 2 * (q.x * f.y - q.y * f.x);
    const d = { x: f.x + q.w * tx + (q.y * tz - q.z * ty), y: f.y + q.w * ty + (q.z * tx - q.x * tz), z: f.z + q.w * tz + (q.x * ty - q.y * tx) };
    b.pos = { x: vs.pos.x + d.x * 500, y: vs.pos.y + d.y * 500, z: vs.pos.z + d.z * 500 };
    window.__flight.setInput({ fire: true });
    window.__flight.step(60);
    window.__flight.setInput({ fire: false });
    return !b.alive;
  });
  expect(popped).toBe(true);
  await page.waitForTimeout(300);
  await shot(page, 'combat-hud');
  const issues = await layoutIssues(page, { safe: SAFE });
  expect(issues, issues.join(' / ')).toEqual([]);
  expect(errors).toEqual([]);
});

test('射撃モード: 全目標クリアで結果画面（スコア）', async ({ page }) => {
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('heli', 'city', { mode: 'combat' }));
  await page.evaluate(() => {
    const c = window.__app.sim.combat;
    for (const t of c.targets) t.alive = false;
    c.wave = c.maxWaves;
    for (const e of c.enemies) e.alive = false;
    window.__flight.step(2);
  });
  await expect(page.locator('#scr-result')).toBeVisible();
  await expect(page.locator('#result-score')).toContainText('点');
  await page.waitForTimeout(200);
  await shot(page, 'combat-result');
  expect(await layoutIssues(page, { safe: SAFE })).toEqual([]);
});

test('リングコース: 次のリングの円・距離・秒数・通過予測', async ({ page }) => {
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', { mode: 'rings', calm: true }));
  // 次のリングへ向けて進ませる
  const st = await page.evaluate(() => {
    const app = window.__app;
    const r = app.sim.rings[0];
    const vs = app.sim.vs;
    // 機体をリングの手前 600 m・正面向きに置き直す
    const n = r.normal;
    vs.pos = { x: r.pos.x - n.x * 600, y: r.pos.y - n.y * 600, z: r.pos.z - n.z * 600 };
    vs.vel = { x: n.x * 50, y: n.y * 50, z: n.z * 50 };
    const hd = Math.atan2(n.x, -n.z);
    const h = -hd / 2;
    vs.q = { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
    return window.__flight.step(1);
  });
  expect(st.rings.approach.willPass).toBe(true);
  expect(st.rings.approach.eta).toBeGreaterThan(5);
  await page.waitForTimeout(400);
  await shot(page, 'rings-gate');
  const rects = await page.evaluate(() => window.__flight.hudRects());
  expect(rects.rects.some((r) => r.name === 'minimap')).toBe(true);
  // 描画: リング 10 個分の番号・支柱が出ている
  const info = await page.evaluate(() => window.__flight.renderInfo());
  expect(info.calls).toBeLessThanOrEqual(150);
});

test('操作ガイド: 共通と全機体の説明、ボタンの説明', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.click('#btn-title-guide');
  await expect(page.locator('#scr-guide')).toBeVisible();
  await expect(page.locator('#guide-content')).toContainText('共通の操作');
  await shot(page, 'guide-common');
  expect(await layoutIssues(page, { safe: SAFE })).toEqual([]);
  for (const id of VEHICLE_ORDER) {
    await page.click(`[data-guide="${id}"]`);
    await expect(page.locator('#guide-content')).toContainText(VEHICLES[id].name);
    for (const b of VEHICLES[id].buttons) await expect(page.locator('#guide-content')).toContainText(b.desc.slice(0, 10));
  }
  await page.click('[data-guide="airliner"]');
  await shot(page, 'guide-airliner');
  await page.click('#btn-guide-back');
  await expect(page.locator('#scr-title')).toBeVisible();
  // 一時停止メニューからも開ける（今の機体が選ばれる）
  await page.evaluate(() => window.__flight.loadScenario('flycar', 'island', {}));
  await page.click('#btn-pause');
  await page.click('#btn-pause-guide');
  await expect(page.locator('#guide-content')).toContainText('空飛ぶスポーツカー');
  await page.click('#btn-guide-back');
  await expect(page.locator('#scr-pause')).toBeVisible();
  expect(errors).toEqual([]);
});

test('新しい機体: 熱気球はリング・射撃を選べない／機体カード 18 枚', async ({ page }) => {
  await openApp(page);
  await page.click('#btn-start');
  await expect(page.locator('[data-vehicle]')).toHaveCount(18);
  await page.click('[data-vehicle="balloon"]');
  await page.click('#btn-vehicle-next');
  await expect(page.locator('[data-test="mode-rings"]')).toBeDisabled();
  await expect(page.locator('[data-test="mode-combat"]')).toBeDisabled();
  await page.click('#btn-fly');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
  // バーナーボタンを押している間は燃焼
  const b = await page.locator('[data-button="burner"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const inp = await page.evaluate(() => window.__flight.readInput());
  await page.mouse.up();
  expect(inp.burner).toBe(true);
});

for (const [v, opts, act, name] of [
  ['flycar', {}, (p) => p.evaluate(() => { window.__flight.setInput({ throttle: 0.7 }); window.__flight.step(180); }), 'hud-flycar-drive'],
  ['flycar', { mode: 'rings' }, (p) => p.evaluate(() => window.__flight.step(60)), 'hud-flycar-fly'],
  ['balloon', { time: 'morning', weather: 'cloudy' }, (p) => p.evaluate(() => window.__flight.step(120)), 'hud-balloon'],
  ['drone', { mode: 'combat' }, (p) => p.evaluate(() => { window.__flight.setInput({ pitch: -0.2, fire: true }); window.__flight.step(90); }), 'hud-drone-combat'],
  ['sailplane', { mode: 'rings' }, (p) => p.evaluate(() => window.__flight.step(120)), 'hud-sailplane-rings'],
]) {
  test(`HUD: ${name}`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page);
    await emulateNotch(page);
    await page.evaluate(([vv, o]) => window.__flight.loadScenario(vv, 'mountains', o), [v, opts]);
    await act(page);
    await page.waitForTimeout(500);
    expect((await state(page)).status).not.toBe('crashed');
    await shot(page, name);
    expect(await layoutIssues(page, { safe: SAFE })).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test.describe('2 人プレイ（WebRTC・サーバーなし接続）', () => {
  test('接続 → 同じ場所でリングコース → 相手が見え、位置が届く', async ({ browser }) => {
    // 2 ページ同時にソフトウェア描画するとフレームが極端に遅くなり、通信の処理まで遅れる。
    // 通信の遅延を正しく測るため、このテストは小さな画面で描画の負荷を下げる。
    const ctxOpts = { viewport: { width: 520, height: 260 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
    const ca = await browser.newContext(ctxOpts);
    const cb = await browser.newContext(ctxOpts);
    const A = await ca.newPage();
    const B = await cb.newPage();
    const errA = trackErrors(A), errB = trackErrors(B);
    await openApp(A); await openApp(B);
    await A.click('#btn-title-mp');
    await B.click('#btn-title-mp');
    await A.fill('#mp-name', 'ホスト');
    await B.fill('#mp-name', 'ゲスト');
    await A.click('#btn-mp-manual');
    await B.click('#btn-mp-manual');
    await A.click('#btn-mp-manual-host');
    await expect(A.locator('#mp-manual-out')).not.toHaveValue('', { timeout: 15000 });
    const offer = await A.locator('#mp-manual-out').inputValue();
    await B.fill('#mp-manual-in', offer);
    await B.click('#btn-mp-manual-join');
    await expect(B.locator('#mp-manual-out')).not.toHaveValue('', { timeout: 15000 });
    const answer = await B.locator('#mp-manual-out').inputValue();
    await A.fill('#mp-manual-in', answer);
    await A.click('#btn-mp-manual-accept');
    await expect(A.locator('#btn-mp-proceed')).toBeVisible({ timeout: 20000 });
    await expect(B.locator('#btn-mp-proceed')).toBeVisible({ timeout: 20000 });
    await shot(A, 'mp-lobby-small');
    // ゲストは機体を選んで待機、ホストが場所とモードを選んで開始
    await B.click('#btn-mp-proceed');
    await B.click('[data-vehicle="heli"]');
    await B.click('#btn-vehicle-next');
    await expect(B.locator('#scr-wait')).toBeVisible();
    await A.click('#btn-mp-proceed');
    await A.click('[data-vehicle="prop"]');
    await A.click('#btn-vehicle-next');
    await A.click('[data-location="island"]');
    await A.click('[data-test="mode-rings"]');
    await A.click('#btn-fly');
    await A.waitForFunction(() => window.__flight.getState().flying === true);
    await B.waitForFunction(() => window.__flight.getState().flying === true, null, { timeout: 15000 });
    const sa = await state(A), sb = await state(B);
    expect(sa.locationId).toBe('island');
    expect(sb.locationId).toBe('island');
    expect(sb.mode).toBe('rings');
    expect(sb.rings.total).toBe(sa.rings.total);
    // 相手の状態が届き、補間位置が実際の位置と近い（実時間で数秒飛ばす）。
    // この環境はソフトウェア描画で 1 フレームが数百 ms〜1 秒かかり、その間は通信の処理も待たされる（実機の 16 ms とは別物）。
    // 通信そのものの遅延を測るため、描画だけを止める（物理・送受信は動かしたまま）。RTT は直近 12 回の中央値なので、入れ替わるまで待つ。
    await A.evaluate(() => window.__flight.setRenderPaused(true));
    await B.evaluate(() => window.__flight.setRenderPaused(true));
    await A.waitForFunction(() => { const m = window.__flight.getState().mp; return m && m.rtt != null && m.rtt < 0.2; }, null, { timeout: 30000, polling: 500 });
    await A.waitForTimeout(1000);
    const [ma, mb, pa, pb] = await Promise.all([
      A.evaluate(() => window.__flight.getState().mp), B.evaluate(() => window.__flight.getState().mp),
      A.evaluate(() => window.__flight.getState().pos), B.evaluate(() => window.__flight.getState().pos),
    ]);
    expect(ma.remoteName).toBe('ゲスト');
    expect(mb.remoteName).toBe('ホスト');
    expect(ma.remoteVehicle).toBe('heli');
    expect(ma.rtt).toBeLessThan(0.2);
    expect(ma.remote).not.toBe(null);
    expect(mb.remote).not.toBe(null);
    // 表示は 0.1 秒遅れ。プロペラ機は約 50 m/s なので、誤差は 15 m 以内
    expect(Math.hypot(mb.remote.pos.x - pa.x, mb.remote.pos.z - pa.z)).toBeLessThan(15);
    expect(Math.hypot(ma.remote.pos.x - pb.x, ma.remote.pos.z - pb.z)).toBeLessThan(15);
    expect(await A.evaluate(() => window.__flight.ghosts())).toContain('remote');
    expect(ma.silence).toBeLessThan(3);
    // ホストがやり直すと、ゲストも同じ条件でやり直す
    const tB0 = (await state(B)).t;
    await A.evaluate(() => window.__app.restart());
    await B.waitForFunction((t0) => window.__flight.getState().t < t0, tB0, { timeout: 15000 });
    // 射撃（撃ち合い）: 的の配置がホストと同じ、敵 AI は出ない、記録（ベスト）は残さない
    await A.evaluate(() => window.__app.onFly({ vehicle: 'prop', location: 'island', time: 'noon', weather: 'clear', mode: 'combat' }));
    await B.waitForFunction(() => window.__flight.getState().mode === 'combat', null, { timeout: 15000 });
    const [tA, tBb] = await Promise.all([A.evaluate(() => window.__flight.combat()), B.evaluate(() => window.__flight.combat())]);
    expect(tBb.targets.map((t) => t.pos)).toEqual(tA.targets.map((t) => t.pos));
    expect(tA.enemies.length).toBe(0);
    expect(tBb.enemies.length).toBe(0);
    await A.evaluate(() => window.__flight.setRenderPaused(false));
    await B.evaluate(() => window.__flight.setRenderPaused(false));
    await A.waitForTimeout(800);
    await shot(A, 'mp-flight-host');
    await shot(B, 'mp-flight-guest');
    expect(errA).toEqual([]);
    expect(errB).toEqual([]);
    await ca.close(); await cb.close();
  });
});
