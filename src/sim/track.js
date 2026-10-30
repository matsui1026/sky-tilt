// 走行コース（閉じた周回路）: 制御点 → Catmull-Rom で中心線 → 距離で引ける形に。
// 路面の判定（コースの上か）、中心線に沿った進み具合、曲率（ライバルの速度計画）に使う。DOM / Three.js 非依存。
import { clamp, lerp } from './math.js';

const SAMPLE_STEP = 6; // 中心線のサンプル間隔 [m]

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

export class Track {
  /**
   * ctrl: 制御点 [{x,z}]（閉じた周回。進行方向の順）
   * opts: { width, surface, heightAt(x,z), grip（路面の μ。ライバルの速度計画に使う） }
   */
  constructor(ctrl, { width = 16, surface = 'asphalt', heightAt = () => 0, grip = 1 } = {}) {
    this.width = width;
    this.surface = surface;
    const N = ctrl.length;
    const raw = [];
    for (let i = 0; i < N; i++) {
      const a = ctrl[(i - 1 + N) % N], b = ctrl[i], c = ctrl[(i + 1) % N], d = ctrl[(i + 2) % N];
      const seg = Math.hypot(c.x - b.x, c.z - b.z);
      const n = Math.max(2, Math.ceil(seg / (SAMPLE_STEP * 0.5)));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        raw.push({ x: catmull(a.x, b.x, c.x, d.x, t), z: catmull(a.z, b.z, c.z, d.z, t) });
      }
    }
    // 等間隔に取り直す
    const pts = [];
    let carry = 0;
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i], b = raw[(i + 1) % raw.length];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      let d = carry;
      while (d < L) {
        const f = d / L;
        pts.push({ x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) });
        d += SAMPLE_STEP;
      }
      carry = d - L;
    }
    this.n = pts.length;
    this.length = this.n * SAMPLE_STEP;
    this.step = SAMPLE_STEP;
    // 高さ・接線・法線・曲率
    for (let i = 0; i < this.n; i++) {
      const p = pts[i];
      const nx = pts[(i + 1) % this.n], pv = pts[(i - 1 + this.n) % this.n];
      const tx = nx.x - pv.x, tz = nx.z - pv.z;
      const l = Math.hypot(tx, tz) || 1;
      p.tx = tx / l; p.tz = tz / l;
      p.y = heightAt(p.x, p.z);
      p.s = i * SAMPLE_STEP;
    }
    for (let i = 0; i < this.n; i++) {
      const p = pts[i], a = pts[(i - 4 + this.n) % this.n], b = pts[(i + 4) % this.n];
      const cross = a.tx * b.tz - a.tz * b.tx;
      const dot = a.tx * b.tx + a.tz * b.tz;
      p.k = Math.atan2(cross, dot) / (8 * SAMPLE_STEP); // 符号付き曲率 [1/m]（正=右カーブ）
    }
    this.pts = pts;
    // 近傍探索用のグリッド
    this.cell = 40;
    this.grid = new Map();
    pts.forEach((p, i) => {
      const k = this._key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(i);
    });
    // ライバルの速度計画: 曲がれる速さ → 手前からブレーキできる速さ（2 周なめる）
    const vmax = pts.map((p) => Math.sqrt((9.8 * grip) / Math.max(Math.abs(p.k), 1e-3)));
    const brake = 9 * grip;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = this.n - 1; i >= 0; i--) {
        const nx = vmax[(i + 1) % this.n];
        vmax[i] = Math.min(vmax[i], Math.sqrt(nx * nx + 2 * brake * SAMPLE_STEP));
      }
    }
    this.speedPlan = vmax;
  }

  _key(i, j) { return i * 100003 + j; }

  /** 中心線上の点（s: 距離、offset: 右へのずらし） */
  at(s, offset = 0) {
    const L = this.length;
    const u = ((s % L) + L) % L;
    const f = u / SAMPLE_STEP;
    const i = Math.floor(f);
    const a = this.pts[i % this.n], b = this.pts[(i + 1) % this.n];
    const k = f - i;
    const tx = lerp(a.tx, b.tx, k), tz = lerp(a.tz, b.tz, k);
    const l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l; // 進行方向の右
    return {
      x: lerp(a.x, b.x, k) + nx * offset,
      y: lerp(a.y, b.y, k),
      z: lerp(a.z, b.z, k) + nz * offset,
      tx: tx / l, tz: tz / l,
      k: lerp(a.k, b.k, k),
      heading: Math.atan2(tx, -tz),
    };
  }

  speedAt(s) {
    const L = this.length;
    const u = ((s % L) + L) % L;
    return this.speedPlan[Math.floor(u / SAMPLE_STEP) % this.n];
  }

  /**
   * 最寄りの中心線の点（maxDist 以内）。hintS があればその近くだけ探す（周回の進み具合を連続に保つ）。
   * 戻り値: { s, dist, side（右が正）} または null
   */
  nearest(x, z, maxDist = 60, hintS = null) {
    const c = this.cell;
    const r = Math.ceil(maxDist / c);
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    let best = -1, bd = maxDist * maxDist;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const list = this.grid.get(this._key(i, j));
        if (!list) continue;
        for (const idx of list) {
          const p = this.pts[idx];
          if (hintS != null) {
            let ds = Math.abs(p.s - ((hintS % this.length) + this.length) % this.length);
            if (ds > this.length / 2) ds = this.length - ds;
            if (ds > 200) continue;
          }
          const dx = p.x - x, dz = p.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = idx; }
        }
      }
    }
    if (best < 0) return null;
    const p = this.pts[best];
    const side = (x - p.x) * -p.tz + (z - p.z) * p.tx;
    return { s: p.s, dist: Math.sqrt(bd), side };
  }

  /** (x,z) がコースの舗装の上か */
  onRoad(x, z) {
    const n = this.nearest(x, z, this.width);
    return !!n && n.dist <= this.width / 2 + 1;
  }

  /** 最も小さい旋回半径 [m]（検査用） */
  minRadius() {
    let m = Infinity;
    for (const p of this.pts) m = Math.min(m, 1 / Math.max(Math.abs(p.k), 1e-5));
    return m;
  }
}

/**
 * 着陸エリア・滑走路の平らな範囲に収まる周回路（フィールドのローカル座標 u=前方, v=右）。
 * u はフィールド長の範囲、v はフィールド幅 + 余白（地形が平らにされる範囲）の中に置く。
 */
export function fieldCircuit(field) {
  const hd = (field.heading * Math.PI) / 180;
  const fx = Math.sin(hd), fz = -Math.cos(hd);
  const L = Math.min(field.length / 2 - 20, 560);
  const A = field.width / 2 + 42; // 平らな範囲（幅/2 + 60）の内側
  const toWorld = ([u, v]) => ({ x: field.x + fx * u * L + -fz * v * A, z: field.z + fz * u * L + fx * v * A });
  // 右側を前へ → 奥でカーブ → 左側に戻りながらシケイン → 手前でカーブ
  return [
    [-0.72, 0.85], [-0.2, 0.85], [0.32, 0.85], [0.72, 0.8], [0.95, 0.35], [0.9, -0.35], [0.66, -0.82],
    [0.42, -0.25], [0.2, -0.82], [-0.04, -0.25], [-0.28, -0.82], [-0.62, -0.82], [-0.94, -0.45], [-0.97, 0.3],
  ].map(toWorld);
}

/** 走行距離からチェックポイント番号を作る */
export function checkpointsFor(track, n = 8) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = (i / n) * track.length;
    const p = track.at(s);
    list.push({ s, x: p.x, y: p.y, z: p.z, tx: p.tx, tz: p.tz, heading: p.heading, halfWidth: clamp(track.width * 0.5 + 8, 8, 40) });
  }
  return list;
}
