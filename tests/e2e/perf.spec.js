// 描画予算: 各ロケーションで renderer.info を記録（ドローコール ≤150、三角形 ≤30万、DPR ≤2）
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';
import { LOCATION_ORDER } from '../../src/data/locations.js';

// 各ロケーションで負荷の大きい組み合わせ（旅客機・リング表示・夜間の灯火、および低空の都市）
const SCENARIOS = [
  { vehicle: 'airliner', opts: { mode: 'rings', time: 'night', weather: 'cloudy' }, camera: 'chase' },
  { vehicle: 'prop', opts: { mode: 'free', time: 'noon', weather: 'clear' }, camera: 'external' },
  { vehicle: 'heli', opts: { mode: 'landing', time: 'evening', weather: 'windy' }, camera: 'cockpit' },
  { vehicle: 'fighter', opts: { mode: 'combat', time: 'noon', weather: 'cloudy' }, camera: 'chase' },
  { vehicle: 'balloon', opts: { mode: 'free', time: 'morning', weather: 'clear' }, camera: 'external' },
  // 車: ライバル 3 台・スモーク・コース・雨
  { vehicle: 'driftcar', opts: { mode: 'race', time: 'night', weather: 'rain' }, camera: 'chase' },
  { vehicle: 'monster', opts: { mode: 'drift', time: 'evening', weather: 'snowfall' }, camera: 'external' },
];

test('全ロケーションの描画予算', async ({ page }) => {
  await openApp(page);
  const rows = [];
  for (const loc of LOCATION_ORDER) {
    for (const sc of SCENARIOS) {
      await page.evaluate(([v, l, o, c]) => { window.__flight.loadScenario(v, l, o); window.__flight.setCamera(c); }, [sc.vehicle, loc, sc.opts, sc.camera]);
      await page.evaluate(() => window.__flight.step(30));
      await page.waitForTimeout(350);
      // 数フレーム分の最大値を取る
      let calls = 0, triangles = 0, pr = 0;
      for (let k = 0; k < 5; k++) {
        const info = await page.evaluate(() => window.__flight.renderInfo());
        calls = Math.max(calls, info.calls);
        triangles = Math.max(triangles, info.triangles);
        pr = info.pixelRatio;
        await page.waitForTimeout(60);
      }
      rows.push({ location: loc, vehicle: sc.vehicle, ...sc.opts, camera: sc.camera, calls, triangles, pixelRatio: pr });
    }
  }
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'render-info.json'), JSON.stringify({ date: new Date().toISOString(), budget: { calls: 150, triangles: 300000 }, rows }, null, 2));
  console.table(rows);
  for (const r of rows) {
    expect(r.calls, `${r.location}/${r.vehicle}`).toBeLessThanOrEqual(150);
    expect(r.triangles, `${r.location}/${r.vehicle}`).toBeLessThanOrEqual(300000);
    expect(r.pixelRatio).toBeLessThanOrEqual(2);
    expect(r.calls).toBeGreaterThan(3); // 実際に描画されている
  }
});
