// 練習モード: 実際に操作しながら一歩ずつ進む（判定は sim の状態だけを見る純粋ロジック）
// check(st, ctx): この段階を達成したら true。ctx はレッスン中に使える置き場（ctx.mark でこの段階の開始時の値など）

const headingDelta = (st, ctx) => {
  if (ctx.h0 == null) ctx.h0 = st.attitude.heading;
  return Math.abs(((st.attitude.heading - ctx.h0 + 540) % 360) - 180);
};
const levelFor = (st, ctx, sec) => {
  const ok = Math.abs(st.attitude.roll) < 8;
  ctx.t = ok ? (ctx.t || 0) + ctx.dt : 0;
  return ctx.t >= sec;
};

export const LESSONS = [
  {
    id: 'plane',
    name: '飛行機: 離陸と旋回',
    desc: 'スロットル → 離陸 → 旋回 → 水平飛行',
    vehicle: 'prop',
    location: 'island',
    steps: [
      { text: '右のスロットルを一番上までドラッグして加速しましょう', check: (st) => st.throttleCmd > 0.8 && st.speed > 15 },
      { text: '時速 90 km を超えたら、画面の上端を手前に引いて機首を上げます', check: (st) => !st.onGround && st.agl > 8 },
      { text: 'そのまま上昇。高度（対地）150 m まで', check: (st) => st.agl > 150 },
      { text: 'ハンドルのように右か左へ傾けて、大きく曲がりましょう（60° 以上）', check: (st, ctx) => headingDelta(st, ctx) > 60 },
      { text: '傾きを戻すと水平に戻ります。水平のまま 2 秒', check: (st, ctx) => levelFor(st, ctx, 2) },
    ],
  },
  {
    id: 'heli',
    name: 'ヘリ: ホバリングと移動',
    desc: '浮く → その場で止まる → 前進',
    vehicle: 'heli',
    location: 'island',
    steps: [
      { text: '右のスライダーをゆっくり上げて浮かびましょう（対地 5 m まで）', check: (st) => !st.onGround && st.agl > 5 },
      { text: 'スライダーを少し戻して、上昇を止めます（昇降率 ±1 m/s を 2 秒）', check: (st, ctx) => { ctx.t = Math.abs(st.vs) < 1 ? (ctx.t || 0) + ctx.dt : 0; return ctx.t > 2; } },
      { text: '奥へ少し傾けて前進（時速 40 km まで）', check: (st) => st.groundSpeed * 3.6 > 40 },
      { text: '手前に傾けて減速（時速 10 km 以下へ）', check: (st) => st.groundSpeed * 3.6 < 10 },
    ],
  },
  {
    id: 'car',
    name: '車: 基本の運転',
    desc: 'アクセル → カーブ → ブレーキ → バック',
    vehicle: 'rally',
    location: 'raceway',
    steps: [
      { text: '右の「アクセル」を押し続けて、時速 60 km まで', check: (st) => st.car.speedKmh > 60 },
      { text: 'ハンドルのように傾けて曲がりましょう（45° 以上）', check: (st, ctx) => headingDelta(st, ctx) > 45 },
      { text: '「ブレーキ」で止まります', check: (st) => st.car.speedKmh < 4 },
      { text: '止まったままブレーキを押し続けるとバックします', check: (st) => st.car.gear === 'R' && st.car.speedKmh > 4 },
    ],
  },
  {
    id: 'drift',
    name: '車: ドリフト',
    desc: 'サイド → 角度の調整 → つなげて高得点',
    vehicle: 'driftcar',
    location: 'raceway',
    steps: [
      { text: 'アクセルを踏んで、時速 70 km まで', check: (st) => st.car.speedKmh > 70 },
      { text: '左右どちらかへ傾けながら、左の「サイド」を一瞬押します', check: (st) => st.car.drift.active },
      { text: 'アクセルは踏んだまま、傾きで滑る角度を調整。500 点を目指しましょう', check: (st) => st.car.drift.score >= 500 || st.car.drift.total >= 500 },
      { text: '滑り続けると倍率が上がります。×2 まで続けましょう', check: (st) => st.car.drift.mult >= 2 },
    ],
  },
];

export class LessonRunner {
  constructor(id) {
    this.lesson = LESSONS.find((l) => l.id === id);
    this.index = 0;
    this.ctx = {};
    this.done = false;
    this.holdT = 0;
  }
  get current() { return this.lesson.steps[this.index] || null; }
  /** 戻り値: 段階が進んだら 'next'、全部終わったら 'done'、それ以外 null */
  update(st, dt) {
    if (this.done) return null;
    const step = this.current;
    this.ctx.dt = dt;
    if (!step.check(st, this.ctx)) return null;
    this.index++;
    this.ctx = {};
    if (this.index >= this.lesson.steps.length) {
      this.done = true;
      return 'done';
    }
    return 'next';
  }
  view() {
    const s = this.current;
    return s ? { text: s.text, step: this.index + 1, total: this.lesson.steps.length } : null;
  }
}
