// 目視チェック用スクリーンショットの保存と、レイアウトの自動検査
// （48px 以上 / 重なりなし / はみ出しなし / セーフエリア内 / 親指の届く位置）
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state, shot, layoutIssues } from './helpers.js';

// iPhone 横向き相当のノッチ（左右 44px、下 21px）を CSS 変数で再現する
const SAFE = { l: 44, r: 44, t: 0, b: 21 };
async function emulateNotch(page) {
  await page.addStyleTag({ content: `:root { --safe-l: ${SAFE.l}px !important; --safe-r: ${SAFE.r}px !important; --safe-b: ${SAFE.b}px !important; }` });
}

async function expectCleanLayout(page, label) {
  const issues = await layoutIssues(page, { safe: SAFE });
  expect(issues, `${label}: ${issues.join(' / ')}`).toEqual([]);
}

async function thumbReach(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const out = [];
    for (const b of document.querySelectorAll('#vbuttons button')) {
      const r = b.getBoundingClientRect();
      if (r.right > W * 0.42) out.push(`左手ボタンが中央寄り: ${b.textContent}`);
      if (r.top < H * 0.2) out.push(`左手ボタンが上すぎる: ${b.textContent}`);
    }
    const t = document.getElementById('throttle');
    if (getComputedStyle(t).display !== 'none') {
      const r = t.getBoundingClientRect();
      if (r.left < W * 0.75) out.push('スロットルが右端にない');
      if (r.bottom < H * 0.8) out.push('スロットルが下にない');
    }
    return out;
  });
}

const HUD_SCENES = [
  ['prop', 'island', { time: 'morning' }, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ throttle: 1, pitch: 0.5 }); window.__flight.step(60 * 14); window.__flight.setInput({ pitch: 0.1 }); window.__flight.step(120); });
  }],
  ['airliner', 'island', { spawn: { pos: { x: 800, y: 900, z: 4000 }, heading: 340, speed: 120, throttle: 0.55 } }, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ roll: 0.4, throttle: 0.55 }); window.__flight.step(120); });
  }],
  ['fighter', 'mountains', {}, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ roll: 0.5, throttle: 1 }); window.__flight.step(40); window.__flight.setInput({ roll: 0, pitch: 0.9 }); window.__flight.step(90); });
  }],
  ['heli', 'city', { spawn: { pos: { x: -200, y: 160, z: 600 }, heading: 0, speed: 10 } }, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ pitch: -0.3 }); window.__flight.step(90); });
  }],
  ['paraglider', 'mountains', { weather: 'cloudy' }, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ roll: 0.3 }); window.__flight.step(240); });
  }],
  ['jetsuit', 'desert', { time: 'evening' }, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ throttle: 0.8 }); window.__flight.step(120); window.__flight.setInput({ pitch: -0.4, throttle: 0.85 }); window.__flight.step(120); });
  }],
  ['wingsuit', 'snow', {}, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ roll: -0.2 }); window.__flight.step(300); });
  }],
  ['skydive', 'island', {}, async (page) => {
    await page.evaluate(() => { window.__flight.setInput({ pitch: -0.6 }); window.__flight.step(400); });
  }],
];

test('メニュー画面のスクリーンショットとレイアウト', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await shot(page, '01-title');
  await expectCleanLayout(page, 'タイトル');
  await page.click('#btn-start');
  await expect(page.locator('#scr-vehicle')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '02-vehicle-select');
  await expectCleanLayout(page, '機体選択');
  await page.click('[data-vehicle="fighter"]');
  await page.click('#btn-vehicle-next');
  await page.click('[data-location="mountains"]');
  await page.click('[data-test="time-evening"]');
  await page.waitForTimeout(200);
  await shot(page, '03-location-select');
  await expectCleanLayout(page, 'ロケーション選択');
  await page.click('#btn-fly');
  await page.waitForFunction(() => window.__flight.getState().flying === true);
  await page.click('#btn-pause');
  await page.waitForTimeout(200);
  await shot(page, '05-pause');
  await expectCleanLayout(page, '一時停止');
  await page.click('#btn-settings');
  await page.waitForTimeout(200);
  await shot(page, '06-settings');
  await expectCleanLayout(page, '設定');
  expect(errors).toEqual([]);
});

test('操作説明オーバーレイ（初回のみ・スキップ可）', async ({ page }) => {
  await page.goto('/?debug=1&tutorial=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__flight);
  await emulateNotch(page);
  await page.click('#btn-start');
  await page.click('[data-vehicle="prop"]');
  await page.click('#btn-vehicle-next');
  await page.click('#btn-fly');
  await expect(page.locator('#scr-tutorial')).toBeVisible();
  await shot(page, '04-tutorial-1');
  await expectCleanLayout(page, '操作説明1');
  await page.click('#btn-tut-next');
  await shot(page, '04-tutorial-2');
  await page.click('#btn-tut-next');
  await shot(page, '04-tutorial-3');
  await expectCleanLayout(page, '操作説明3');
  await page.click('#btn-tut-next');
  await expect(page.locator('#scr-tutorial')).toBeHidden();
  expect((await state(page)).paused).toBe(false);
  // 2 回目は表示されない
  await page.click('#btn-pause');
  await page.click('#btn-restart');
  await page.click('#btn-pause');
  await page.click('#btn-title');
  await page.click('#btn-start');
  await page.click('#btn-vehicle-next');
  await page.click('#btn-fly');
  await page.waitForTimeout(300);
  await expect(page.locator('#scr-tutorial')).toBeHidden();
});

for (const [vehicle, loc, opts, act] of HUD_SCENES) {
  test(`HUD: ${vehicle}`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page);
    await emulateNotch(page);
    await page.evaluate(([v, l, o]) => window.__flight.loadScenario(v, l, o), [vehicle, loc, opts]);
    await act(page);
    await page.waitForTimeout(500);
    const st = await state(page);
    expect(st.status, st.crashCause || '').not.toBe('crashed');
    await shot(page, `hud-${vehicle}`);
    await expectCleanLayout(page, `HUD ${vehicle}`);
    expect(await thumbReach(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('HUD: スカイダイビング（キャノピー）とスティック表示', async ({ page }) => {
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('skydive', 'island', { time: 'evening' }));
  await page.evaluate(() => { window.__flight.step(240); window.__flight.action('deploy'); window.__flight.step(600); window.__flight.setInput({ roll: 0.4 }); window.__flight.step(60); });
  await page.waitForTimeout(400);
  expect((await state(page)).phase).toBe('canopy');
  await shot(page, 'hud-skydive-canopy');
  await expectCleanLayout(page, 'キャノピー');
});

test('墜落画面', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', { spawn: { pos: { x: 2500, y: 200, z: 4500 }, heading: 90, speed: 50, throttle: 1 } }));
  await page.evaluate(() => { window.__flight.setInput({ pitch: -1, throttle: 1 }); for (let i = 0; i < 60 * 30 && window.__flight.getState().status === 'flying'; i++) window.__flight.step(1); });
  await expect(page.locator('#scr-crash')).toBeVisible();
  await expect(page.locator('#scr-crash')).toContainText('墜落');
  await page.waitForTimeout(300);
  await shot(page, '07-crash');
  await expectCleanLayout(page, '墜落');
  await page.click('#btn-retry');
  await expect(page.locator('#scr-crash')).toBeHidden();
  expect((await state(page)).status).toBe('flying');
  expect(errors).toEqual([]);
});

test('着陸評価画面（小型機・滑走路）', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  // 滑走路の上、低高度・低速から接地させる
  await page.evaluate(() => window.__flight.loadScenario('prop', 'island', { calm: true, spawn: { pos: { x: 0, y: 6 + 1.2 + 4, z: 800 }, heading: 0, speed: 31, throttle: 0.15 } }));
  await page.evaluate(() => {
    const f = window.__flight;
    for (let i = 0; i < 60 * 40 && f.getState().status === 'flying'; i++) {
      const s = f.getState();
      if (!s.onGround) {
        // 降下率 0.8 m/s を目標に姿勢を作る簡易オートパイロット
        const p = Math.max(-1, Math.min(1, 0.25 * (-0.8 - s.vs)));
        f.setInput({ pitch: p, throttle: 0.15, roll: Math.max(-1, Math.min(1, -0.05 * s.attitude.roll)) });
      } else f.setInput({ pitch: 0, throttle: 0, roll: 0 });
      f.step(1);
    }
  });
  await expect(page.locator('#scr-result')).toBeVisible();
  await expect(page.locator('#scr-result')).toContainText('着陸成功');
  await page.waitForTimeout(300);
  await shot(page, '08-landing-result');
  await expectCleanLayout(page, '着陸評価');
  const st = await state(page);
  expect(st.result.type).toBe('landing');
  expect(['S', 'A', 'B', 'C']).toContain(st.result.grade);
  // 続ける
  await page.click('#btn-continue');
  await expect(page.locator('#scr-result')).toBeHidden();
  expect(errors).toEqual([]);
});

test('リングコース完走 → 結果画面', async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await emulateNotch(page);
  await page.evaluate(() => window.__flight.loadScenario('heli', 'island', { mode: 'rings', calm: true }));
  // ヘリの簡易オートパイロットで次のリングへ向かう
  const done = await page.evaluate(() => {
    const f = window.__flight;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    for (let i = 0; i < 60 * 400; i++) {
      const s = f.getState();
      if (s.status !== 'flying' || !s.rings.next) break;
      const n = s.rings.next;
      const dx = n.x - s.pos.x, dz = n.z - s.pos.z;
      const brg = Math.atan2(dx, -dz) * 180 / Math.PI;
      const err = ((brg - s.attitude.heading + 540) % 360) - 180;
      const dist = Math.hypot(dx, dz);
      const dy = n.y - s.pos.y;
      const fwd = Math.cos(err * Math.PI / 180);
      f.setInput({
        yaw: clamp(err / 25),
        pitch: clamp(-Math.min(0.55, dist / 250) * Math.max(0, fwd) + 0.04 * s.groundSpeed * (fwd < 0.5 ? 1 : 0)),
        roll: 0,
        throttle: Math.max(0, Math.min(1, 0.65 + 0.03 * dy - 0.06 * s.vs)),
      });
      f.step(1);
    }
    return f.getState();
  });
  expect(done.status, `rings=${JSON.stringify(done.rings)}`).toBe('finished');
  await expect(page.locator('#scr-result')).toBeVisible();
  await expect(page.locator('#scr-result')).toContainText('ゴール');
  await page.waitForTimeout(300);
  await shot(page, '09-ring-result');
  await expectCleanLayout(page, 'リング結果');
  expect(errors).toEqual([]);
});

test.describe('縦向きのスクリーンショット', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('縦向き案内', async ({ page }) => {
    await openApp(page);
    await shot(page, '10-portrait');
    await expect(page.locator('#rotate')).toBeVisible();
  });
});
