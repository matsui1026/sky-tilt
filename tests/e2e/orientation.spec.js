// 合成した deviceorientation イベントで、左右どちらの横向きでも期待どおりに姿勢が変わる
import { test, expect } from '@playwright/test';
import { trackErrors, openApp, state } from './helpers.js';
import { screenPose, eventFor } from '../helpers/pose.js';

for (const angle of [90, -90]) {
  test(`傾き操作: 画面角 ${angle}°`, async ({ page }) => {
    const errors = trackErrors(page);
    await openApp(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true,
      screenOrientation: { type: angle === 90 ? 'landscapePrimary' : 'landscapeSecondary', angle: angle === 90 ? 90 : 270 },
    });
    const reported = await page.evaluate(() => screen.orientation.angle);
    expect(reported).toBe(angle === 90 ? 90 : 270);

    // 合成イベントを 30ms ごとに送り続ける
    await page.evaluate(() => {
      window.__pose = null;
      window.__poseCount = 0;
      setInterval(() => {
        if (window.__pose) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { ...window.__pose, absolute: false })); window.__poseCount++; }
      }, 30);
    });
    const setPose = (p) => page.evaluate((e) => { window.__pose = e; window.__poseCount = 0; }, eventFor(screenPose(p), angle));
    // キャリブレーションは直近 0.3 秒のサンプルの平均。新しい姿勢のイベントが 0.3 秒分以上（30ms × 12 回）届くまで待つ
    // （描画が重いとタイマーが遅れ、固定の待ち時間では前の姿勢が混ざる）
    const settle = () => page.waitForFunction(() => window.__poseCount >= 12, null, { timeout: 20000 });
    await setPose({ tilt: 45 }); // 手前に傾けた自然な持ち方
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__flight.getState().sensorOk === true);
    await settle();
    expect((await state(page)).inputMode).toBe('tilt');

    const spawn = { pos: { x: 0, y: 1500, z: 3000 }, heading: 0, speed: 50, throttle: 0.6 };
    const readInput = () => page.evaluate(() => { let r; for (let i = 0; i < 40; i++) r = window.__flight.readInput(); return r; });

    // ニュートラル（開始時にキャリブレーション）→ 入力 0
    await page.evaluate((sp) => window.__flight.loadScenario('prop', 'island', { calm: true, spawn: sp }), spawn);
    let inp = await readInput();
    expect(Math.abs(inp.pitch)).toBeLessThan(0.01);
    expect(Math.abs(inp.roll)).toBeLessThan(0.01);

    // ハンドルのように右へ回す（右端を下げる）→ 右ロール
    await setPose({ tilt: 45, steer: 20 });
    await settle();
    inp = await readInput();
    expect(inp.roll).toBeGreaterThan(0.3);
    expect(Math.abs(inp.pitch)).toBeLessThan(0.05);
    let st = await page.evaluate(() => window.__flight.step(60));
    expect(st.attitude.roll).toBeGreaterThan(5);

    // 左へ回す → 左ロール
    await setPose({ tilt: 45 });
    await settle();
    await page.evaluate((sp) => window.__flight.loadScenario('prop', 'island', { calm: true, spawn: sp }), spawn);
    await setPose({ tilt: 45, steer: -20 });
    await settle();
    inp = await readInput();
    expect(inp.roll).toBeLessThan(-0.3);
    st = await page.evaluate(() => window.__flight.step(60));
    expect(st.attitude.roll).toBeLessThan(-5);

    // 上端を手前に引く → 機首上げ
    await setPose({ tilt: 45 });
    await settle(); // 開始時のキャリブレーションは直近 0.3 秒の平均なので、その間ニュートラルで静止
    await page.evaluate((sp) => window.__flight.loadScenario('prop', 'island', { calm: true, spawn: sp }), spawn);
    const p0 = (await state(page)).attitude.pitch;
    await setPose({ tilt: 45, pitchDelta: 15 });
    await settle();
    inp = await readInput();
    expect(inp.pitch).toBeGreaterThan(0.3);
    expect(Math.abs(inp.roll)).toBeLessThan(0.05);
    st = await page.evaluate(() => window.__flight.step(60));
    expect(st.attitude.pitch).toBeGreaterThan(p0 + 3);

    // 奥へ倒す → 機首下げ
    await setPose({ tilt: 45 });
    await settle(); // 開始時のキャリブレーションは直近 0.3 秒の平均なので、その間ニュートラルで静止
    await page.evaluate((sp) => window.__flight.loadScenario('prop', 'island', { calm: true, spawn: sp }), spawn);
    await setPose({ tilt: 45, pitchDelta: -15 });
    await settle();
    inp = await readInput();
    expect(inp.pitch).toBeLessThan(-0.3);
    st = await page.evaluate(() => window.__flight.step(60));
    expect(st.attitude.pitch).toBeLessThan(p0 - 3);

    // 再キャリブレーション: 持ち方を変えてから ⟲ で 0 に戻る
    await setPose({ tilt: 30 });
    await settle();
    await page.click('#btn-hud-recal');
    await page.waitForTimeout(900); // 指を離して 0.45 秒後に直近 0.3 秒の平均でキャリブレーション
    inp = await readInput();
    expect(Math.abs(inp.pitch)).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });
}
