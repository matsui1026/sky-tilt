// ロケーション別の高さ関数（シード固定）。terrain.js が格子にサンプリングする。
import { createNoise2D, fbm, ridged } from './noise.js';
import { mulberry32, smoothstep, lerp, clamp } from './math.js';

/**
 * 各ジェネレーターは { raw(x,z), fieldPos?(field), buildings?(ctx) } を返す。
 */
export const GENERATORS = {
  island(seed) {
    const n1 = createNoise2D(seed);
    const n2 = createNoise2D(seed + 11);
    const rnd = mulberry32(seed + 5);
    const islands = [{ x: 0, z: 200, rx: 2300, rz: 3300, amp: 1 }];
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 3200 + rnd() * 2000;
      const s = 400 + rnd() * 700;
      islands.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, rx: s, rz: s * (0.7 + rnd() * 0.6), amp: 0.6 + rnd() * 0.6 });
    }
    return {
      raw(x, z) {
        let m = 0;
        let amp = 0;
        const warp = fbm(n2, x / 1500, z / 1500, 3) * 0.28;
        for (const is of islands) {
          const dx = (x - is.x) / is.rx;
          const dz = (z - is.z) / is.rz;
          const d = Math.sqrt(dx * dx + dz * dz) + warp;
          const mm = 1 - smoothstep(0.55, 1.0, d);
          if (mm > m) { m = mm; amp = is.amp; }
        }
        const hills = Math.max(0, fbm(n1, x / 1800 + 7, z / 1800, 5) + 0.25) * 420 * amp;
        const land = 3 + smoothstep(0.15, 0.9, m) * hills + m * 10;
        return lerp(-45, land, smoothstep(0.0, 0.3, m));
      },
    };
  },

  mountains(seed) {
    const n1 = createNoise2D(seed);
    const n2 = createNoise2D(seed + 3);
    const valleyX = (z) => 650 * Math.sin(z / 1700) + 260 * Math.sin(z / 650 + 1.3);
    return {
      raw(x, z) {
        let h = 180 + 1650 * Math.pow(ridged(n1, x / 3600, z / 3600, 6), 1.25);
        h += 120 * fbm(n2, x / 900, z / 900, 3);
        const d = Math.abs(x - valleyX(z));
        const v = 1 - smoothstep(70, 950, d);
        const floor = 140 + 25 * fbm(n2, x / 2000, z / 2000, 2) + z * 0.012;
        h = lerp(h, floor, v * 0.94);
        return h;
      },
      fieldPos(field) {
        return { ...field, x: valleyX(field.z) };
      },
    };
  },

  city(seed) {
    const n1 = createNoise2D(seed);
    const rnd = mulberry32(seed + 7);
    const riverZ = (x) => -2300 + 500 * Math.sin(x / 2100) + 150 * Math.sin(x / 700);
    const gen = {
      raw(x, z) {
        const r = Math.hypot(x, z);
        let h = 6 + 18 * fbm(n1, x / 5000, z / 5000, 3);
        h += 380 * smoothstep(3800, 6000, r) * Math.max(0, fbm(n1, x / 2000 + 3, z / 2000, 4) + 0.35);
        const d = Math.abs(z - riverZ(x));
        h = lerp(h, -6, 1 - smoothstep(60, 140, d));
        return h;
      },
      buildings(ctx) {
        const list = [];
        const block = 115;
        const street = 32;
        const half = 3100;
        for (let bx = -half; bx < half; bx += block) {
          for (let bz = -half; bz < half; bz += block) {
            const cx = bx + block / 2;
            const cz = bz + block / 2;
            const r = Math.hypot(cx, cz);
            if (r > half) continue;
            if (Math.abs(cz - riverZ(cx)) < 230) continue;
            if (ctx.nearField(cx, cz, 220)) continue;
            if (rnd() < 0.08) continue; // 広場・公園
            const usable = block - street;
            const split = rnd() < 0.55 ? 2 : 1;
            const sz = usable / split;
            for (let i = 0; i < split; i++) {
              for (let j = 0; j < split; j++) {
                if (split === 2 && rnd() < 0.2) continue;
                const w = sz * (0.7 + rnd() * 0.28);
                const d = sz * (0.7 + rnd() * 0.28);
                const x = bx + street / 2 + sz * (i + 0.5);
                const z = bz + street / 2 + sz * (j + 0.5);
                const core = Math.exp(-((r / 1350) ** 2));
                const hgt = 12 + 18 * rnd() + core * 290 * Math.pow(rnd(), 1.4) + (1 - core) * 25 * rnd();
                const base = ctx.height(x, z);
                if (base < 1) continue;
                list.push({ x, z, w, d, h: hgt, base: base - 2 });
              }
            }
          }
        }
        return list;
      },
    };
    return gen;
  },

  desert(seed) {
    const n1 = createNoise2D(seed);
    const n2 = createNoise2D(seed + 9);
    const canyonX = (z) => -1300 + 1400 * Math.sin(z / 2300) + 300 * Math.sin(z / 800 + 2);
    return {
      raw(x, z) {
        const t = fbm(n1, x / 2600, z / 2600, 4) * 0.5 + 0.5;
        const step = 0.16;
        const q = t / step;
        const fl = Math.floor(q);
        const fr = q - fl;
        const terr = (fl + smoothstep(0.78, 1.0, fr)) * step;
        let h = 280 + Math.max(0, terr - 0.35) * 900 + 18 * fbm(n2, x / 400, z / 400, 3);
        const d = Math.abs(x - canyonX(z));
        const c = 1 - smoothstep(110, 420, d + 40 * fbm(n2, x / 600, z / 600, 2));
        h -= c * 300;
        return h;
      },
    };
  },

  snow(seed) {
    const n1 = createNoise2D(seed);
    const n2 = createNoise2D(seed + 13);
    return {
      raw(x, z) {
        let h = 700 + 2000 * Math.pow(ridged(n1, x / 5600, z / 5600, 5), 1.35);
        h += 120 * fbm(n2, x / 1500, z / 1500, 3);
        // 着陸エリア周辺（湖のある盆地）をなだらかに
        const bx = x - 500, bz = z - 1500;
        const basin = 1 - smoothstep(600, 2200, Math.hypot(bx, bz));
        h = lerp(h, 820 + 40 * fbm(n2, x / 3000, z / 3000, 2), basin * 0.85);
        return h;
      },
    };
  },
};

/** 滑走路・着陸エリアの矩形に対するローカル座標 */
export function fieldLocal(field, x, z) {
  const hd = (field.heading * Math.PI) / 180;
  const fx = Math.sin(hd); // 進行方向（北=0）
  const fz = -Math.cos(hd);
  const dx = x - field.x;
  const dz = z - field.z;
  const u = dx * fx + dz * fz; // 前方
  const v = dx * -fz + dz * fx; // 右方
  return { u, v };
}

export function fieldMask(field, x, z, margin = 60, falloff = 320) {
  const { u, v } = fieldLocal(field, x, z);
  const du = Math.max(Math.abs(u) - field.length / 2 - margin, 0);
  const dv = Math.max(Math.abs(v) - field.width / 2 - margin, 0);
  const dist = Math.hypot(du, dv);
  return 1 - smoothstep(0, falloff, dist);
}

export { clamp };
