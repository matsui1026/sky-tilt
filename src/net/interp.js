// 2 人プレイ: 相手の状態のスナップショットを補間・外挿して滑らかに表示する（純粋ロジック）
//
// 相手は自分の物理を自分で計算し、状態（位置・姿勢・速度）を 20Hz で送る。
// 受信側は「相手の時刻で INTERP_DELAY だけ過去」を、前後 2 つのスナップショットから補間して表示する。
// 新しいパケットが遅れた・失われたときは、最後の速度で最大 MAX_EXTRAP 秒だけ外挿する。

export const INTERP_DELAY = 0.1; // [s]
export const MAX_EXTRAP = 0.35; // [s]

function slerp(a, b, t) {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (d > 0.9995) {
    const r = { x: a.x + (bx - a.x) * t, y: a.y + (by - a.y) * t, z: a.z + (bz - a.z) * t, w: a.w + (bw - a.w) * t };
    const l = Math.hypot(r.x, r.y, r.z, r.w);
    return { x: r.x / l, y: r.y / l, z: r.z / l, w: r.w / l };
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
  return { x: a.x * k0 + bx * k1, y: a.y * k0 + by * k1, z: a.z * k0 + bz * k1, w: a.w * k0 + bw * k1 };
}

/** 時計のずれ（相手の時刻 − 自分の時刻）を ping/pong から推定する */
export class ClockSync {
  constructor() {
    this.offset = null;
    this.rtt = null;
    this.samples = [];
  }
  /** t0: 送信時刻（自分）, tr: 相手の時刻, t1: 受信時刻（自分）。単位は秒 */
  add(t0, tr, t1) {
    const rtt = t1 - t0;
    const off = tr - (t0 + rtt / 2);
    this.samples.push({ rtt, off });
    if (this.samples.length > 12) this.samples.shift();
    // RTT が小さいサンプルほど信頼できる
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    this.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
    // 表示用の RTT は中央値（相手が地形の読み込み等で一瞬止まったときの外れ値に強い）
    const r = this.samples.map((x) => x.rtt).sort((a, b) => a - b);
    this.rtt = r[Math.floor(r.length / 2)];
  }
}

export class SnapshotBuffer {
  constructor() {
    this.snaps = []; // { t（相手の時刻）, pos, q, vel, extra }
  }
  push(s) {
    const n = this.snaps.length;
    if (n && s.t <= this.snaps[n - 1].t) {
      // 古い・重複したパケット（順序の入れ替わり）
      if (this.snaps.some((x) => x.t === s.t)) return false;
      this.snaps.push(s);
      this.snaps.sort((a, b) => a.t - b.t);
    } else this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    return true;
  }
  latest() { return this.snaps[this.snaps.length - 1] || null; }

  /** 相手の時刻 tr における状態 */
  sample(tr) {
    const S = this.snaps;
    if (!S.length) return null;
    if (tr <= S[0].t) return { ...S[0], mode: 'clamp' };
    for (let i = S.length - 1; i > 0; i--) {
      const a = S[i - 1], b = S[i];
      if (tr >= a.t && tr <= b.t) {
        const k = (tr - a.t) / Math.max(b.t - a.t, 1e-6);
        // 位置はエルミート補間（速度を使うと急旋回でも滑らか）
        const dt = b.t - a.t;
        const h00 = 2 * k * k * k - 3 * k * k + 1, h10 = k * k * k - 2 * k * k + k, h01 = -2 * k * k * k + 3 * k * k, h11 = k * k * k - k * k;
        const P = (c) => h00 * a.pos[c] + h10 * dt * a.vel[c] + h01 * b.pos[c] + h11 * dt * b.vel[c];
        return {
          t: tr,
          pos: { x: P('x'), y: P('y'), z: P('z') },
          q: slerp(a.q, b.q, k),
          vel: { x: a.vel.x + (b.vel.x - a.vel.x) * k, y: a.vel.y + (b.vel.y - a.vel.y) * k, z: a.vel.z + (b.vel.z - a.vel.z) * k },
          extra: k < 0.5 ? a.extra : b.extra,
          mode: 'interp',
        };
      }
    }
    // 最新より新しい時刻: 外挿（上限あり）
    const L = S[S.length - 1];
    const e = Math.min(tr - L.t, MAX_EXTRAP);
    return {
      t: tr,
      pos: { x: L.pos.x + L.vel.x * e, y: L.pos.y + L.vel.y * e, z: L.pos.z + L.vel.z * e },
      q: L.q, vel: L.vel, extra: L.extra,
      mode: tr - L.t > MAX_EXTRAP ? 'stale' : 'extrap',
    };
  }
}
