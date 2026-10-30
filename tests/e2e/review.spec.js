// 独立レビューの指摘に対応した検証:
// HUD と操作 UI の重なり（3 種類の画面サイズ）、高 G の視界暗転、バリオ音、
// 画面の向き変化・バックグラウンド移行での自動一時停止、メニュー表示中のトースト
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state, layoutIssues, shot } from './helpers.js';
import { VEHICLE_ORDER, VEHICLES } from '../../src/data/vehicles.js';

const VIEWPORTS = [
  { width: 667, height: 375 }, // iPhone SE 等（横）
  { width: 844, height: 390 },
  { width: 932, height: 430 },
];

async function hudVsControls(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const { rects } = window.__flight.hudRects();
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const ctrls = [...document.querySelectorAll('#controls button, #stick, #throttle')].filter(vis).map((el) => ({ el, r: el.getBoundingClientRect() }));
    const out = [];
    for (const h of rects) {
      if (h.left < -0.5 || h.top < -0.5 || h.right > W + 0.5 || h.bottom > H + 0.5) out.push(`HUD がはみ出し: ${h.name} (${Math.round(h.left)},${Math.round(h.top)},${Math.round(h.right)},${Math.round(h.bottom)})`);
      for (const { el, r } of ctrls) {
        const ox = Math.min(h.right, r.right) - Math.max(h.left, r.left);
        const oy = Math.min(h.bottom, r.bottom) - Math.max(h.top, r.top);
        if (ox > 1 && oy > 1) out.push(`HUD(${h.name} ${Math.round(h.left)}-${Math.round(h.right)}) と ${el.id || el.dataset.button || el.textContent.trim()} が重なり`);
      }
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`画面 ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });
    test('全機体の HUD が操作 UI（スティック表示時）と重ならない', async ({ page }) => {
      const errors = trackErrors(page);
      await openApp(page);
      const cases = [...VEHICLE_ORDER.map((v) => [v, 'landing']), ...VEHICLE_ORDER.filter((v) => VEHICLES[v].weapon).map((v) => [v, 'combat']), ['prop', 'rings'], ['sailplane', 'rings']];
      for (const [v, mode] of cases) {
        await page.evaluate(([id, m]) => window.__flight.loadScenario(id, 'island', { mode: m }), [v, mode]);
        await page.evaluate(() => window.__flight.step(30));
        await page.waitForTimeout(250);
        expect((await state(page)).inputMode).toBe('stick');
        const issues = await hudVsControls(page);
        expect(issues, `${v}/${mode}: ${issues.join(' / ')}`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  });
}

test('高 G が続くと視界が暗くなり、戻すと回復する', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('fighter', 'island', { calm: true, spawn: { pos: { x: 0, y: 3000, z: 3000 }, heading: 0, speed: 260, throttle: 1 } }));
  await page.evaluate(() => { window.__flight.setInput({ pitch: 1, throttle: 1 }); window.__flight.step(60); });
  const g = (await state(page)).g;
  expect(g).toBeGreaterThan(7);
  // 暗転は実時間で進む（時定数 1.2 秒）。この環境はフレームが遅いので、進むまで待つ
  await page.waitForFunction(() => window.__flight.fx().gDark > 0.3, null, { timeout: 20000, polling: 250 });
  await page.waitForTimeout(300);
  const dark = (await page.evaluate(() => window.__flight.fx())).gDark;
  expect(dark).toBeGreaterThan(0.3);
  expect(Number(await page.locator('#fx-vignette').evaluate((e) => getComputedStyle(e).opacity))).toBeGreaterThan(0.3);
  await page.evaluate(() => { window.__flight.setInput({ pitch: 0 }); window.__flight.step(120); });
  await page.waitForFunction(() => window.__flight.fx().gDark < 0.1, null, { timeout: 20000, polling: 250 });
  expect((await page.evaluate(() => window.__flight.fx())).gDark).toBeLessThan(0.1);
});

test('サーマルで上昇中はバリオ音が鳴る', async ({ page }) => {
  await openApp(page);
  await page.click('#btn-start'); // ユーザー操作で AudioContext を開始
  await page.evaluate(() => window.__flight.loadScenario('paraglider', 'island', {
    realtime: true, calm: false,
    spawn: { pos: { x: 1200, y: 600, z: 3000 }, heading: 0, speed: 10.5 },
  }));
  // 強いサーマルを真下に置く
  await page.evaluate(() => {
    const w = window.__app.sim.world;
    w.thermals.length = 0;
    w.thermals.push({ x: 1200, z: 3000, radius: 200, strength: 4, top: 2500, ground: 0 });
    window.__flight.setInput({ roll: 0.5 });
  });
  const before = (await page.evaluate(() => window.__flight.audioStats())).vario;
  // ビープはフレームごとに判定するので、フレームの遅いこの環境では回数が揃うまで待つ（実時間 3 秒以上）
  await page.waitForTimeout(3000);
  await page.waitForFunction((b) => window.__flight.audioStats().vario - b > 3, before, { timeout: 30000, polling: 500 });
  const st = await state(page);
  const after = await page.evaluate(() => window.__flight.audioStats());
  expect(after.ready).toBe(true);
  expect(st.vs).toBeGreaterThan(0.2);
  expect(after.vario - before).toBeGreaterThan(3);
});

test('画面の向きが変わると自動で一時停止し、再開時に再キャリブレーションする', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', { realtime: true }));
  await page.waitForTimeout(300);
  // 縦向きにする
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#scr-pause')).toBeVisible();
  await expect(page.locator('#pause-msg')).toContainText('向き');
  expect((await state(page)).paused).toBe(true);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.click('#btn-resume');
  await expect(page.locator('#toast')).toContainText('そのまま構えて');
  await expect(page.locator('#toast')).toContainText('ニュートラル');
  expect((await state(page)).paused).toBe(false);
  expect(errors).toEqual([]);
});

test('バックグラウンドに回ると一時停止する／メニュー表示中はトーストを出さない', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('heli', 'island', { realtime: true }));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#scr-pause')).toBeVisible();
  expect((await state(page)).paused).toBe(true);
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
});

test('A/B を入れるとスロットルが最大になり加速する', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('fighter', 'island', { calm: true, spawn: { pos: { x: 0, y: 2000, z: 3000 }, heading: 0, speed: 150, throttle: 0.5 } }));
  await page.click('[data-button="ab"]');
  const inp = await page.evaluate(() => window.__flight.readInput());
  expect(inp.throttle).toBe(1);
  await expect(page.locator('#throttle-knob')).toHaveText('100%');
  const st = await page.evaluate(() => window.__flight.step(120));
  expect(st.ab).toBe(true);
});

test.describe('左利き配置', () => {
  test.use({ viewport: { width: 667, height: 375 } });
  test('スティック・機体ボタンが右、スロットル・射撃が左に移り、HUD・操作 UI が重ならない', async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => localStorage.setItem('skytilt.settings.v1', JSON.stringify({ lefty: true })));
    await openApp(page);
    const cases = [['prop', 'landing'], ['airliner', 'landing'], ['heli', 'combat'], ['fighter', 'combat'], ['flycar', 'free'], ['balloon', 'free'], ['paraglider', 'combat'], ['skydive', 'free']];
    for (const [v, mode] of cases) {
      await page.evaluate(([id, m]) => window.__flight.loadScenario(id, 'island', { mode: m }), [v, mode]);
      await page.evaluate(() => window.__flight.step(30));
      await page.waitForTimeout(250);
      const pos = await page.evaluate(() => {
        const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return b.width ? (b.left + b.right) / 2 : null; };
        return { left: r('left-zone'), thr: r('throttle'), W: innerWidth };
      });
      if (pos.left != null) expect(pos.left, v).toBeGreaterThan(pos.W / 2);
      if (pos.thr != null) expect(pos.thr, v).toBeLessThan(pos.W / 2);
      const issues = await hudVsControls(page);
      expect(issues, `${v}/${mode}: ${issues.join(' / ')}`).toEqual([]);
      expect(await layoutIssues(page), `${v}/${mode}`).toEqual([]);
    }
    await shot(page, 'lefty-skydive');
    expect(errors).toEqual([]);
  });
});

test('早送り: 熱気球・滑空機の自由飛行だけ。押すたびに ×2 → ×4 → ×1、地面が近いと戻る', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', {}));
  await expect(page.locator('#btn-warp')).toBeHidden();
  // タイムを競うモードでは使えない（熱気球はリングを選べないので、滑空機で確認）
  await page.evaluate(() => window.__flight.loadScenario('sailplane', 'island', { mode: 'rings' }));
  await expect(page.locator('#btn-warp')).toBeHidden();
  await page.evaluate(() => window.__flight.loadScenario('balloon', 'island', { realtime: true, calm: true, spawn: { pos: { x: 0, y: 900, z: 3000 }, heading: 0, speed: 0 } }));
  await expect(page.locator('#btn-warp')).toBeVisible();
  // 進み方（シミュレーション時間 / 実時間）を ×1 と ×4 で比べる（この環境はフレームが遅いので比で見る）
  const rate = async () => {
    const t0 = (await state(page)).t, w0 = Date.now();
    await page.waitForTimeout(2500);
    return ((await state(page)).t - t0) / ((Date.now() - w0) / 1000);
  };
  const r1 = await rate();
  await page.click('#btn-warp');
  expect(await page.evaluate(() => window.__flight.warp())).toBe(2);
  await page.click('#btn-warp');
  expect(await page.evaluate(() => window.__flight.warp())).toBe(4);
  await expect(page.locator('#btn-warp')).toHaveText('▶▶×4');
  const r4 = await rate();
  expect(r4).toBeGreaterThan(r1 * 2.5);
  // 地面の近くでは自動で通常に戻る
  await page.evaluate(() => { const s = window.__app.sim; s.vs.pos.y = s.world.terrain.surfaceAt(s.vs.pos.x, s.vs.pos.z) + 40; });
  await page.waitForFunction(() => window.__flight.warp() === 1, null, { timeout: 10000 });
  await expect(page.locator('#btn-warp')).toHaveText('▶×1');
  // 低い所では早送りにできない
  await page.click('#btn-warp');
  expect(await page.evaluate(() => window.__flight.warp())).toBe(1);
  await expect(page.locator('#toast')).toContainText('地面が近い');
});

test('設定: 射撃の難易度と左利き配置を選べて保存される', async ({ page }) => {
  await openApp(page);
  await page.click('#btn-title-settings');
  await page.click('[data-test="difficulty-hard"]');
  await page.click('[data-setting="lefty"]');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('skytilt.settings.v1')));
  expect(s.difficulty).toBe('hard');
  expect(s.lefty).toBe(true);
  expect(await page.evaluate(() => document.body.classList.contains('lefty'))).toBe(true);
  await page.click('#btn-settings-close');
  // 難易度は 1 人プレイの射撃に反映される
  await page.evaluate(() => window.__app.onFly({ vehicle: 'fighter', location: 'island', time: 'noon', weather: 'clear', mode: 'combat' }));
  expect(await page.evaluate(() => window.__app.sim.combat.diff.assistPlane)).toBeLessThan(3 * Math.PI / 180);
});