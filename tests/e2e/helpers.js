import fs from 'node:fs';
import path from 'node:path';

/** コンソールエラーとページ例外を集める */
export function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function openApp(page, query = '?debug=1') {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => !!window.__flight);
}

export async function state(page) {
  return page.evaluate(() => window.__flight.getState());
}

export const SHOT_DIR = path.resolve('reports/screenshots');
export async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * 画面上の操作要素のレイアウト検査:
 * - 48px 以上 / 画面内に収まる / 互いに重ならない / セーフエリアの内側
 */
export async function layoutIssues(page, { safe = { l: 0, r: 0, t: 0, b: 0 } } = {}) {
  return page.evaluate((safe) => {
    const W = innerWidth, H = innerHeight;
    const issues = [];
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      let p = el.parentElement;
      while (p) {
        const ps = getComputedStyle(p);
        if (ps.display === 'none' || ps.visibility === 'hidden') return false;
        p = p.parentElement;
      }
      return true;
    };
    const els = [...document.querySelectorAll('button, input[type=range], #stick, #throttle')].filter(visible);
    const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.dataset.vehicle ? `[${el.dataset.vehicle}]` : ''}${el.dataset.location ? `[${el.dataset.location}]` : ''}${el.dataset.button ? `[${el.dataset.button}]` : ''} "${(el.textContent || '').trim().slice(0, 14)}"`;
    const inScroller = (el) => !!el.closest('.cards, .settings');
    const rects = els.map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of rects) {
      if (r.width < 47.5 || r.height < 47.5) issues.push(`小さすぎる (${Math.round(r.width)}x${Math.round(r.height)}): ${name(el)}`);
      if (!inScroller(el)) {
        if (r.left < safe.l - 0.5 || r.top < safe.t - 0.5 || r.right > W - safe.r + 0.5 || r.bottom > H - safe.b + 0.5) {
          issues.push(`画面/セーフエリア外 (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}): ${name(el)}`);
        }
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 1 && oy > 1) issues.push(`重なり: ${name(a.el)} と ${name(b.el)}`);
      }
    }
    // スクロール領域自体は画面内に
    for (const sc of document.querySelectorAll('.cards, .settings')) {
      if (!visible(sc)) continue;
      const r = sc.getBoundingClientRect();
      if (r.left < safe.l - 0.5 || r.right > W - safe.r + 0.5 || r.bottom > H - safe.b + 0.5 || r.top < safe.t - 0.5) issues.push(`スクロール領域が画面外: .${sc.className}`);
    }
    // テキストのはみ出し（ボタン内）
    for (const { el } of rects) {
      if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 2) issues.push(`文字がはみ出し: ${name(el)}`);
    }
    return issues;
  }, safe);
}
