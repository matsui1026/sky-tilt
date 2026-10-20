// 開発用: 任意のシナリオのスクリーンショットを撮る
// node scripts/shot.mjs <url> <out.png> [vehicle] [location] [steps] [extra-json]
import { chromium } from '@playwright/test';

const [, , url = 'http://localhost:5173/?debug=1', out = 'shot.png', vehicle, location, steps = '0', extra = '{}'] = process.argv;
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__flight);
if (vehicle) {
  const opts = JSON.parse(extra);
  await page.evaluate(([v, l, o]) => window.__flight.loadScenario(v, l, o), [vehicle, location, opts]);
  if (opts.input) await page.evaluate((i) => window.__flight.setInput(i), opts.input);
  await page.evaluate((n) => window.__flight.step(n), Number(steps));
  if (opts.camera) await page.evaluate((c) => window.__flight.setCamera(c), opts.camera);
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => ({ r: window.__flight.renderInfo(), s: window.__flight.getState() }));
  console.log(JSON.stringify({ calls: info.r.calls, tris: info.r.triangles, status: info.s.status, cause: info.s.crashCause, alt: Math.round(info.s.altitude), agl: Math.round(info.s.agl), spd: Math.round(info.s.speed) }));
} else {
  await page.waitForTimeout(500);
}
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
