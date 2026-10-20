// 手続き的に生成するテクスチャ（外部アセットなし）
import * as THREE from 'three';
import { mulberry32 } from '../sim/math.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 地表の細部（明暗のまだら）。頂点色に乗算して低空での速度感を出す */
export function detailTexture(seed = 1) {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  const rnd = mulberry32(seed);
  // 値ノイズを数オクターブ重ねる（タイル可能）
  const layers = [8, 16, 32, 64];
  const grids = layers.map((n) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return { n, a };
  });
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      let v = 0, amp = 0.5, norm = 0;
      for (const { n, a } of grids) {
        const fx = (x / 256) * n, fy = (y / 256) * n;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i, j) => a[((j + n) % n) * n + ((i + n) % n)];
        const v0 = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
        const v1 = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
        v += amp * (v0 * (1 - sy) + v1 * sy);
        norm += amp;
        amp *= 0.6;
      }
      v /= norm;
      const l = Math.round(255 * (0.78 + 0.32 * (v - 0.5) * 2 * 0.7));
      const k = (y * 256 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.max(0, Math.min(255, l));
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 滑走路（舗装 or 未舗装）。長さ方向が V。 */
export function runwayTexture(field) {
  const W = 128, H = 2048;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const dirt = field.surface === 'dirt';
  g.fillStyle = dirt ? '#a87b52' : '#3b3d40';
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(99);
  for (let i = 0; i < 5000; i++) {
    const v = dirt ? 120 + rnd() * 70 : 45 + rnd() * 30;
    g.fillStyle = dirt ? `rgba(${v + 30},${v},${v - 30},0.35)` : `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 3, 2 + rnd() * 6);
  }
  const mpp = field.length / H; // 1px あたりの m
  const px = (m) => m / mpp;
  g.fillStyle = dirt ? 'rgba(255,255,255,0.75)' : '#e8e8e8';
  if (!dirt) {
    // センターラインの破線
    for (let y = px(120); y < H - px(120); y += px(60)) g.fillRect(W / 2 - 2, y, 4, px(30));
    // 末端のスレッショルドマーク
    for (const end of [0, 1]) {
      const y0 = end === 0 ? px(6) : H - px(6) - px(30);
      for (let i = 0; i < 6; i++) {
        const x = 8 + i * 9;
        g.fillRect(x, y0, 5, px(30));
        g.fillRect(W - x - 5, y0, 5, px(30));
      }
      // 接地帯マーク
      const yt = end === 0 ? px(300) : H - px(300) - px(45);
      g.fillRect(W / 2 - 30, yt, 10, px(45));
      g.fillRect(W / 2 + 20, yt, 10, px(45));
    }
    // 端線
    g.fillRect(2, 0, 2, H);
    g.fillRect(W - 4, 0, 2, H);
    // 数字（方位）
    const hd = Math.round((((field.heading % 360) + 360) % 360) / 10) || 36;
    const opp = ((hd + 18 - 1) % 36) + 1;
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.save();
    g.translate(W / 2, H - px(60));
    g.fillText(String(hd).padStart(2, '0'), 0, 0);
    g.restore();
    g.save();
    g.translate(W / 2, px(60));
    g.rotate(Math.PI);
    g.fillText(String(opp).padStart(2, '0'), 0, 0);
    g.restore();
  } else {
    // 未舗装: 端のマーカー
    for (let y = 0; y < H; y += px(80)) {
      g.fillRect(2, y, 6, px(8));
      g.fillRect(W - 8, y, 6, px(8));
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 着陸ターゲット（同心円） */
export function targetTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  const rings = [['#ffffff', 124], ['#ff5a2a', 104], ['#ffffff', 80], ['#ff5a2a', 58], ['#ffffff', 34], ['#ff5a2a', 14]];
  for (const [col, r] of rings) {
    g.beginPath();
    g.arc(128, 128, r, 0, Math.PI * 2);
    g.fillStyle = col;
    g.globalAlpha = 0.85;
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 影（ぼかした円） */
export function blobTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** 光点（スプライト） */
export function glowTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
