// リングコースのゴースト: 自己ベストの飛び方を記録して、次回半透明で再生する（純粋ロジック）
const STEP = 0.1; // 記録間隔 [s]
const r1 = (v) => Math.round(v * 10) / 10;
const r4 = (v) => Math.round(v * 10000) / 10000;

export class GhostRecorder {
  constructor() {
    this.frames = []; // [t, x, y, z, qx, qy, qz, qw]
    this.next = 0;
  }
  record(t, pos, q) {
    if (t + 1e-9 < this.next) return;
    this.next = t + STEP;
    this.frames.push([r1(t), r1(pos.x), r1(pos.y), r1(pos.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w)]);
    if (this.frames.length > 12000) this.frames.shift(); // 20 分まで
  }
  toJSON() { return { v: 1, f: this.frames }; }
}

export class GhostPlayer {
  constructor(data) {
    this.f = data && data.f ? data.f : [];
    this.i = 0;
  }
  get duration() { return this.f.length ? this.f[this.f.length - 1][0] : 0; }
  /** 時刻 t の位置と姿勢（線形補間） */
  sample(t) {
    const f = this.f;
    if (f.length < 2 || t < f[0][0]) return null;
    if (t >= f[f.length - 1][0]) return null;
    if (this.i >= f.length - 1 || f[this.i][0] > t) this.i = 0;
    while (this.i < f.length - 2 && f[this.i + 1][0] <= t) this.i++;
    const a = f[this.i], b = f[this.i + 1];
    const k = (t - a[0]) / Math.max(b[0] - a[0], 1e-6);
    const L = (j) => a[j] + (b[j] - a[j]) * k;
    let qx = L(4), qy = L(5), qz = L(6), qw = L(7);
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    return { pos: { x: L(1), y: L(2), z: L(3) }, q: { x: qx / n, y: qy / n, z: qz / n, w: qw / n } };
  }
}
