// 開発用: 第 4 弾の機能（曲技・スモーク・スター）のスクリーンショットを撮る
// node scripts/shot-features.mjs [url] [outDir]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [, , url = 'http://localhost:5173/?debug=1', outDir = 'reports/screenshots'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL === 'chromium' ? undefined : 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__flight);
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };

// 曲技モード: ロール 2 回のコンボ表示
await page.evaluate(() => {
  const f = window.__flight;
  f.loadScenario('fighter', 'island', { mode: 'stunt' });
  f.setInput({ throttle: 1, roll: 1 });
  f.step(200);
  f.setInput({ roll: 0, pitch: 0.1 });
  f.step(30);
});
await shot('r4-stunt-combo');

// スモーク: 実時間で旋回して外部視点から
await page.evaluate(() => {
  const f = window.__flight;
  f.loadScenario('prop', 'island', { spawn: { pos: { x: 600, y: 420, z: 2600 }, heading: 350, speed: 55 }, realtime: true });
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO' }));
  f.setInput({ throttle: 1, roll: 0.7, pitch: 0.3 });
  f.setCamera('external');
});
await page.waitForTimeout(7000);
await shot('r4-smoke');

// スター: 星の手前から
const star = await page.evaluate(() => {
  const f = window.__flight;
  f.loadScenario('prop', 'island', {});
  const s = f.stars().list[1];
  f.loadScenario('prop', 'island', { spawn: { pos: { x: s.x, y: s.y, z: s.z + 260 }, heading: 0, speed: 50 } });
  f.setCamera('chase');
  f.setInput({ throttle: 0.7 });
  f.step(20);
  return f.getState().stars;
});
await shot('r4-star');
const after = await page.evaluate(() => { const f = window.__flight; f.step(400); return { stars: f.getState().stars, saved: localStorage.getItem('skytilt.stars.v1') }; });
await shot('r4-star-got');
console.log(JSON.stringify({ star, after }));

// 結果画面
await page.evaluate(() => {
  const f = window.__flight;
  f.loadScenario('fighter', 'island', { mode: 'stunt', stuntTime: 12 });
  f.setInput({ throttle: 1, roll: 1 });
  f.step(400);
  f.setInput({ roll: 0 });
  f.step(400);
});
await shot('r4-stunt-result');
console.log(logs.join('\n'));
await browser.close();
