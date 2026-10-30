// 車（ペダル・ドリフト・レース・駐車）と、追加機能（実績・練習・今日のチャレンジ・リプレイ・写真・天候）の E2E
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state, shot, layoutIssues } from './helpers.js';
import { VEHICLES } from '../../src/data/vehicles.js';

const SAFE = { l: 44, r: 44, t: 0, b: 21 };
async function emulateNotch(page) {
  await page.addStyleTag({ content: `:root { --safe-l: ${SAFE.l}px !important; --safe-r: ${SAFE.r}px !important; --safe-b: ${SAFE.b}px !important; }` });
}
async function clean(page, label) {
  const issues = await layoutIssues(page, { safe: SAFE });
  expect(issues, `${label}: ${issues.join(' / ')}`).toEqual([]);
}

// 中心線に沿って走るテスト用のドライバー（ページ内で実行）
const DRIVE = `
  window.__drive = (f, n, speedK = 0.75) => {
    const RAD = 180 / Math.PI;
    const t = window.__app.sim.world.terrain.track;
    let S = window.__driveS || 0;
    for (let i = 0; i < n; i++) {
      const st = f.getState();
      if (st.status !== 'flying') break;
      const nr = t.nearest(st.pos.x, st.pos.z, 200, S) || t.nearest(st.pos.x, st.pos.z, 2000);
      S = nr.s;
      const v = st.groundSpeed;
      const look = t.at(S + 8 + v * 0.7);
      const brg = Math.atan2(look.x - st.pos.x, -(look.z - st.pos.z)) * RAD;
      const err = ((brg - st.attitude.heading + 540) % 360) - 180;
      const target = t.speedAt(S + v * 0.9) * speedK;
      f.setInput({ roll: Math.max(-1, Math.min(1, err / 25)), gas: v < target ? 1 : 0, brake: v > target + 3 ? 1 : 0 });
      f.step(1);
    }
    window.__driveS = S;
    return f.getState();
  };
`;

test('機体選択: タブで絞り込み、車を選ぶと塗り色とモードが変わる', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.click('#btn-start');
  await page.click('[data-tab="car"]');
  await page.waitForTimeout(200);
  await expect(page.locator('[data-vehicle="prop"]')).toBeHidden();
  await expect(page.locator('[data-vehicle="driftcar"]')).toBeVisible();
  expect((await page.evaluate(() => window.__flight.settings())).paints).toEqual({});
  await page.click('[data-vehicle="driftcar"]');
  await expect(page.locator('#paint-row')).toBeVisible();
  await page.click('[data-paint="d62828"]');
  await page.waitForTimeout(200);
  await shot(page, 'car-01-select');
  await clean(page, '車の選択');
  await page.click('#btn-vehicle-next');
  await page.click('[data-location="raceway"]');
  await expect(page.locator('[data-test="mode-race"]')).toBeVisible();
  await expect(page.locator('[data-test="mode-rings"]')).toBeHidden();
  await expect(page.locator('#btn-fly')).toContainText('スタート');
  await page.click('[data-test="mode-drift"]');
  await page.waitForTimeout(200);
  await shot(page, 'car-02-location');
  await clean(page, '車のロケーション');
  await page.click('#btn-fly');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
  const s = await page.evaluate(() => window.__flight.settings());
  expect(s.paints.driftcar).toBe(0xd62828);
  expect(errors).toEqual([]);
});

test('ペダルを押すと走り、離して止まり、ブレーキ長押しでバックする', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('rally', 'raceway', { calm: true }));
  const pedal = async (id, on) => {
    const b = await page.locator(`#${id}`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    if (on) await page.mouse.down(); else await page.mouse.up();
  };
  await expect(page.locator('#throttle')).toBeHidden();
  await pedal('btn-gas', true);
  expect((await page.evaluate(() => window.__flight.readInput())).gas).toBe(1);
  let st = await page.evaluate(() => window.__flight.step(180));
  expect(st.car.speedKmh).toBeGreaterThan(40);
  await pedal('btn-gas', false);
  await pedal('btn-brake', true);
  st = await page.evaluate(() => { const f = window.__flight; for (let i = 0; i < 60 * 4; i++) { f.setInput({ brake: 1, gas: 0 }); f.step(1); } return f.getState(); });
  await pedal('btn-brake', false);
  expect(st.car.gear).toBe('R');
  expect(st.vel.x * Math.sin(st.attitude.heading * Math.PI / 180) - st.vel.z * Math.cos(st.attitude.heading * Math.PI / 180)).toBeLessThan(-0.5);
  expect(errors).toEqual([]);
});

test('サイドを引くとドリフトになり、点数が HUD に出て、スモークとスキッドマークが描かれる', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('driftcar', 'raceway', { calm: true, mode: 'drift', spawn: { pos: { x: 215, y: 120.6, z: 40 }, heading: 0, speed: 0, onGround: true } }));
  const st = await page.evaluate(() => {
    const f = window.__flight;
    f.setInput({ gas: 1 });
    f.step(60 * 4);
    f.setInput({ roll: 0.7, handbrake: true });
    f.step(24);
    f.setInput({ handbrake: false, gas: 0.8 });
    f.step(60 * 3);
    return f.getState();
  });
  expect(st.car.drift.active).toBe(true);
  expect(Math.abs(st.car.beta)).toBeGreaterThan(12);
  expect(st.car.drift.score).toBeGreaterThan(100);
  await page.waitForTimeout(700);
  await shot(page, 'car-03-drift');
  await clean(page, 'ドリフト');
  const hud = await page.evaluate(() => { window.__flight.hudRects(); return window.__flight.hudRects().rects.map((r) => r.name); });
  expect(hud.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('ドリフトモード: 時間切れで結果（点数・評価）', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('driftcar', 'raceway', { calm: true, mode: 'drift', driftTime: 8, spawn: { pos: { x: 215, y: 120.6, z: 40 }, heading: 0, speed: 0, onGround: true } }));
  await page.evaluate(() => {
    const f = window.__flight;
    f.setInput({ gas: 1 });
    f.step(60 * 3);
    f.setInput({ roll: 0.7, handbrake: true });
    f.step(24);
    f.setInput({ handbrake: false, gas: 0.8 });
    for (let i = 0; i < 60 * 8 && f.getState().status === 'flying'; i++) f.step(1);
  });
  await expect(page.locator('#scr-result')).toBeVisible();
  await expect(page.locator('#result-score')).toContainText('点');
  await page.waitForTimeout(200);
  await shot(page, 'car-04-drift-result');
  const res = (await state(page)).result;
  expect(res.type).toBe('drift');
  expect(res.score).toBeGreaterThan(0);
  expect(['S', 'A', 'B', 'C']).toContain(res.grade);
  // リプレイを開いて閉じると結果に戻る
  await page.click('#btn-result-replay');
  await expect(page.locator('#replay-bar')).toBeVisible();
  await expect(page.locator('#scr-result')).toBeHidden();
  await page.waitForTimeout(600);
  await page.click('#btn-replay-cam');
  await page.click('#btn-replay-cam');
  await page.waitForTimeout(500);
  await shot(page, 'car-05-replay');
  await page.click('#btn-replay-close');
  await expect(page.locator('#scr-result')).toBeVisible();
  expect(errors).toEqual([]);
});

test('レース: カウントダウン → ライバル 3 台と周回 → 順位とタイム（サーキット）', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.addScriptTag({ content: DRIVE });
  await page.evaluate(() => { window.__driveS = 0; window.__flight.loadScenario('rally', 'raceway', { calm: true, mode: 'race', time: 'evening' }); });
  let st = await state(page);
  expect(st.race.countdown).toBeGreaterThan(2);
  expect(st.race.cars).toBe(4);
  await page.evaluate(() => window.__flight.step(60 * 3.2));
  st = await page.evaluate(() => window.__drive(window.__flight, 60 * 12));
  expect(st.race.countdown).toBe(0);
  expect(st.car.speedKmh).toBeGreaterThan(40);
  await page.waitForTimeout(600);
  await shot(page, 'car-06-race');
  await clean(page, 'レース');
  // 完走
  st = await page.evaluate(() => { let s; for (let k = 0; k < 40; k++) { s = window.__drive(window.__flight, 600); if (s.status !== 'flying') break; } return s; });
  expect(st.status).toBe('finished');
  expect(st.result.type).toBe('race');
  expect(st.result.place).toBeGreaterThanOrEqual(1);
  expect(st.result.place).toBeLessThanOrEqual(4);
  await expect(page.locator('#scr-result')).toBeVisible();
  await page.waitForTimeout(200);
  await shot(page, 'car-07-race-result');
  await clean(page, 'レース結果');
  expect(errors).toEqual([]);
});

test('駐車: 枠の中に止めると次へ進み、結果が出る', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('kart', 'island', { calm: true, mode: 'parking' }));
  await page.waitForTimeout(500);
  await shot(page, 'car-08-parking');
  await clean(page, '駐車');
  // 枠の中へ置いて止める（ドライバーの代わりに位置を指定）
  const st = await page.evaluate(() => {
    const f = window.__flight;
    const app = window.__app;
    for (let k = 0; k < 3; k++) {
      const b = f.getState().parking.box;
      const s = app.sim.vs;
      s.pos.x = b.x; s.pos.z = b.z; s.psi = b.heading; s.vx = 0; s.vy = 0; s.r = 0;
      f.setInput({ gas: 0, brake: 0, roll: 0 });
      f.step(90);
    }
    return f.getState();
  });
  expect(st.result.type).toBe('parking');
  expect(st.result.scores.length).toBe(3);
  expect(st.result.scores[0]).toBeGreaterThan(90);
  await expect(page.locator('#scr-result')).toBeVisible();
  await expect(page.locator('#scr-result')).toContainText('駐車完了');
  expect(errors).toEqual([]);
});

test('車の HUD と操作 UI: 全車種で表示され、ボタンが重ならない（ノッチあり）', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  for (const id of Object.keys(VEHICLES).filter((v) => VEHICLES[v].model === 'car')) {
    await page.evaluate((v) => window.__flight.loadScenario(v, 'raceway', { calm: true, time: v === 'hover' ? 'night' : 'noon' }), id);
    await page.evaluate(() => { window.__flight.setInput({ gas: 1 }); window.__flight.step(120); });
    await page.waitForTimeout(500);
    await shot(page, `car-model-${id}`);
    await clean(page, id);
  }
  expect(errors).toEqual([]);
});

test('操作の選択肢: 傾きペダル・自動アクセル・◀▶ ハンドル', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => localStorage.setItem('skytilt.settings.v1', JSON.stringify({ carPedal: 'auto', carSteer: 'buttons' })));
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('driftcar', 'raceway', { calm: true }));
  await expect(page.locator('#btn-gas')).toBeHidden();
  await expect(page.locator('#btn-brake')).toBeVisible();
  await expect(page.locator('#steer-row')).toBeVisible();
  await expect(page.locator('#stick')).toBeHidden();
  expect((await page.evaluate(() => window.__flight.readInput())).gas).toBe(1);
  const b = await page.locator('#btn-steer-r').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const inp = await page.evaluate(() => { let r; for (let i = 0; i < 30; i++) r = window.__flight.readInput(); return r; });
  await page.mouse.up();
  expect(inp.roll).toBeGreaterThan(0.5);
  await page.waitForTimeout(300);
  await shot(page, 'car-09-buttons');
  await clean(page, 'ボタン操作');
  expect(errors).toEqual([]);
});

test('天候: 雨と雪と霧で描画が増えてもエラーなし、雨の日は滑りやすい', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  for (const [w, t] of [['rain', 'noon'], ['snowfall', 'morning'], ['fog', 'evening']]) {
    await page.evaluate(([wx, tm]) => window.__flight.loadScenario('prop', 'island', { weather: wx, time: tm, spawn: { pos: { x: 0, y: 500, z: 3000 }, heading: 0, speed: 50, throttle: 0.6 } }), [w, t]);
    await page.evaluate(() => window.__flight.step(30));
    await page.waitForTimeout(600);
    await shot(page, `weather-${w}`);
    expect((await state(page)).precip).toBe(w === 'fog' ? null : w === 'rain' ? 'rain' : 'snow');
  }
  expect(errors).toEqual([]);
});

test('オートパイロット: ボタンで入り、高度と方位を保ち、操作すると解除', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', { calm: true, spawn: { pos: { x: 0, y: 800, z: 3000 }, heading: 30, speed: 50, throttle: 0.6 } }));
  await page.evaluate(() => { window.__flight.setInput({ roll: 0, pitch: 0, throttle: 0.6 }); window.__flight.step(60); });
  await page.click('#btn-ap');
  await expect(page.locator('#btn-ap')).toHaveClass(/on/);
  const s0 = await state(page);
  const s1 = await page.evaluate(() => window.__flight.step(60 * 20));
  expect(s1.autopilot).toBe(true);
  expect(Math.abs(s1.altitude - s0.altitude)).toBeLessThan(25);
  expect(Math.abs(s1.attitude.roll)).toBeLessThan(5);
  const s2 = await page.evaluate(() => { window.__flight.setInput({ roll: 0.8 }); return window.__flight.step(5); });
  expect(s2.autopilot).toBe(false);
  expect(errors).toEqual([]);
});

test('記録・練習・今日のチャレンジの画面', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.waitForTimeout(100);
  await shot(page, 'menu-title');
  await clean(page, 'タイトル');
  await page.click('#btn-title-records');
  await expect(page.locator('#scr-records')).toBeVisible();
  await page.waitForTimeout(100);
  await shot(page, 'menu-records');
  await clean(page, '記録');
  await page.click('#btn-records-back');
  await page.click('#btn-title-lessons');
  await expect(page.locator('#scr-lessons')).toBeVisible();
  await page.waitForTimeout(100);
  await shot(page, 'menu-lessons');
  await clean(page, '練習');
  await page.click('#btn-lessons-back');
  await page.click('#btn-title-daily');
  await expect(page.locator('#scr-daily')).toBeVisible();
  await page.waitForTimeout(100);
  await shot(page, 'menu-daily');
  await clean(page, '今日のチャレンジ');
  await page.click('#btn-daily-start');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
  expect(errors).toEqual([]);
});

test('練習モード（ドリフト）: 操作すると段階が進み、完了で記録される', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.click('#btn-title-lessons');
  await page.click('[data-lesson="drift"]');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
  await page.evaluate(() => window.__flight.setRealtime(false));
  let v = await page.evaluate(() => window.__flight.lesson());
  expect(v.step).toBe(1);
  await page.waitForTimeout(500);
  await shot(page, 'car-10-lesson');
  await clean(page, '練習中');
  // 速度を出す → 滑らせる → 点と倍率。判定は app のフレームで行われるので、少しずつ進めて待つ
  const run = (input, steps) => page.evaluate(([i, n]) => { window.__flight.setInput(i); return window.__flight.step(n); }, [input, steps]);
  await run({ gas: 1 }, 60 * 6);
  await page.waitForFunction(() => { const l = window.__flight.lesson(); return l && l.step >= 2; }, null, { timeout: 15000 });
  await run({ roll: 0.7, handbrake: true }, 24);
  await page.waitForFunction(() => { const l = window.__flight.lesson(); return l && l.step >= 3; }, null, { timeout: 15000 });
  await run({ handbrake: false, gas: 0.8 }, 60 * 6);
  await page.waitForFunction(() => window.__flight.lesson() === null, null, { timeout: 20000 });
  const p = await page.evaluate(() => window.__flight.progress());
  expect(p.stats.lessons).toContain('drift');
  expect(errors).toEqual([]);
});

test('写真モード: 一時停止から開き、撮影して戻れる', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('hypercar', 'raceway', { calm: true, realtime: true }));
  await page.click('#btn-pause');
  await page.click('#btn-photo');
  await expect(page.locator('#photo-bar')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'menu-photo');
  const size = await page.evaluate(() => window.__flight.photo());
  expect(size).toBeGreaterThan(5000);
  await page.click('#btn-photo-close');
  await expect(page.locator('#scr-pause')).toBeVisible();
  await expect(page.locator('#photo-bar')).toHaveCount(0);
  await page.click('#btn-resume');
  expect((await state(page)).paused).toBe(false);
  expect(errors).toEqual([]);
});

test('実績: 条件を満たすと解除され、記録画面に出る', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => { const a = window.__app; a.progress.max('driftBest', 1200); a.progress.add('raceWins'); a.progress.flush(); });
  const p = await page.evaluate(() => window.__flight.progress());
  expect(p.unlocked.drift_1k).toBe(true);
  expect(p.unlocked.race_win).toBe(true);
  await page.evaluate(() => window.__app.toMenu('title'));
  await page.click('#btn-title-records');
  await expect(page.locator('[data-ach="drift_1k"]')).toHaveClass(/on/);
  await expect(page.locator('[data-ach="drift_5k"]')).not.toHaveClass(/on/);
  expect(errors).toEqual([]);
});
