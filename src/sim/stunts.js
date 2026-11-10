// 曲技（スタント）の判定と採点。DOM / Three.js 非依存。
// 技: ロール・宙返り・背面飛行・ナイフエッジ・超低空・すり抜け（谷やビルの間）・タッチ＆ゴー
// コンボ: 技が途切れずに続くと 1 つのコンボになり、技の種類が増えるほど倍率が上がる（最大 ×5）。
//         最後の技から COMBO_HOLD 秒で確定して合計に入る。墜落すると確定前のコンボは失う。
import { qmul, qconj, qrot, FWD, UP, RIGHT, clamp } from './math.js';

export const TRICKS = {
  roll: { name: 'ロール', points: 300 },
  loop: { name: '宙返り', points: 700 },
  inverted: { name: '背面飛行', points: 120, sustain: true },
  knife: { name: 'ナイフエッジ', points: 110, sustain: true },
  low: { name: '超低空', points: 90, sustain: true },
  gap: { name: 'すり抜け', points: 160, sustain: true },
  touchgo: { name: 'タッチ＆ゴー', points: 500 },
};
export const COMBO_HOLD = 4; // 最後の技からコンボ確定までの秒数
export const MAX_MULT = 5;
const SUSTAIN_CAP = 10; // 続ける技は 1 コンボにつき 10 秒分まで
const TWO_PI = Math.PI * 2;

/** 曲技を採点する機体か */
export function stuntEligible(def) {
  return def.model === 'fixedwing' || def.model === 'heli' || def.model === 'jetsuit' || def.model === 'flycar';
}

/** 曲技モードの評価 */
export function stuntGrade(score) {
  return score >= 12000 ? 'S' : score >= 7000 ? 'A' : score >= 3000 ? 'B' : 'C';
}

export class StuntTracker {
  /** opts: { timeLimit（秒。曲技モード）, cruise（巡航速度 m/s）, contact（重心から接地点までの高さ） } */
  constructor(def, world, opts = {}) {
    this.def = def;
    this.world = world;
    this.timeLimit = opts.timeLimit ?? null;
    this.contact = opts.contact ?? 1;
    const fixed = def.model === 'fixedwing';
    const cruise = opts.cruise || (fixed ? 50 : 20);
    this.minSpeed = fixed ? Math.max(12, cruise * 0.35) : 3;
    this.lowSpeed = fixed ? cruise * 0.55 : 7;
    this.lowAgl = fixed ? clamp((def.ringRadius || 25) * 0.6, 12, 30) : 6;
    this.gapDist = fixed ? [30, 55, 85] : [12, 25, 45];
    this.t = 0;
    this.total = 0;
    this.bestCombo = 0;
    this.counts = {};
    this.finished = false;
    this.prevQ = null;
    this.rollAcc = 0; this.rollMark = 0; this.rollIdle = 0;
    this.loopAcc = 0; this.loopMark = 0; this.loopIdle = 0; this.loopPrev = null; this.loopGap = 0;
    this.hold = { inverted: 0, knife: 0, low: 0, gap: 0 };
    this.armedLow = false;
    this.airT = 0;
    this.gapOn = false;
    this.tick = 0;
    this.tg = null; // タッチ＆ゴーの途中 { t }
    this._resetCombo();
    this.last = null;
  }

  _resetCombo() {
    this.combo = { sum: 0, kinds: {}, count: 0, lastT: -99 };
  }

  get mult() {
    return clamp(Object.keys(this.combo.kinds).length, 1, MAX_MULT);
  }

  _award(kind, emit) {
    const tr = TRICKS[kind];
    const c = this.combo;
    const rep = c.kinds[kind] || 0;
    if (tr.sustain && rep >= SUSTAIN_CAP) return;
    // 同じ技の繰り返しは点が下がる（いろいろな技をつなぐ方が高得点）
    const pts = Math.round(tr.points * (tr.sustain ? 1 : Math.max(0.3, 1 - 0.2 * rep)));
    c.kinds[kind] = rep + 1;
    c.sum += pts;
    c.count++;
    c.lastT = this.t;
    this.counts[kind] = (this.counts[kind] || 0) + 1;
    this.last = { kind, name: tr.name, points: pts, t: this.t };
    emit('stunt', { kind, name: tr.name, points: pts, mult: this.mult, combo: c.sum });
  }

  /** コンボを確定して合計へ */
  bank(emit) {
    const c = this.combo;
    if (c.count === 0) return 0;
    const score = Math.round(c.sum * this.mult);
    this.total += score;
    if (score > this.bestCombo) this.bestCombo = score;
    emit('stuntCombo', { score, mult: this.mult, count: c.count, total: this.total });
    this._resetCombo();
    return score;
  }

  /** 墜落: 確定前のコンボを失う */
  lose() {
    const lost = Math.round(this.combo.sum * this.mult);
    this._resetCombo();
    return lost;
  }

  /** vs: 機体の状態（pos, vel, q, onGround） */
  step(vs, dt, emit) {
    if (this.finished) return;
    this.t += dt;
    const q = vs.q;
    const f = qrot(q, FWD), u = qrot(q, UP), r = qrot(q, RIGHT);
    const speed = Math.hypot(vs.vel.x, vs.vel.y, vs.vel.z);
    const terr = this.world.terrain;
    const ground = Math.max(terr.surfaceAt(vs.pos.x, vs.pos.z), terr.roofAt(vs.pos.x, vs.pos.z));
    const agl = vs.pos.y - ground - this.contact;
    const flying = !vs.onGround && speed > this.minSpeed && !(this.def.model === 'flycar' && vs.mode === 'drive');
    this.airT = vs.onGround ? 0 : this.airT + dt;

    // --- ロール・宙返り（姿勢の変化を積算） ---
    if (this.prevQ && flying) {
      const dq = qmul(qconj(this.prevQ), q);
      const sgn = dq.w < 0 ? -1 : 1;
      this.rollAcc += 2 * dq.z * sgn;
      // 宙返り: 翼がほぼ水平（回る面が鉛直）なときだけ、機首の上下の角度を積算する。急旋回は数えない
      if (Math.abs(r.y) < 0.5) {
        const th = Math.atan2(f.y, u.y);
        if (this.loopPrev != null && this.loopGap < 0.7) {
          let d = th - this.loopPrev;
          if (d > Math.PI) d -= TWO_PI; else if (d < -Math.PI) d += TWO_PI;
          if (Math.abs(d) < 0.5) this.loopAcc += d;
        } else if (this.loopGap >= 0.7) this.loopAcc = 0;
        this.loopPrev = th;
        this.loopGap = 0;
      } else {
        this.loopGap += dt;
        if (this.loopGap >= 0.7) { this.loopPrev = null; this.loopAcc = 0; }
      }
      // 進みが止まったら積算を捨てる（普段の旋回の出入りを数えない）
      if (Math.abs(this.rollAcc - this.rollMark) > 0.5) { this.rollMark = this.rollAcc; this.rollIdle = 0; } else if ((this.rollIdle += dt) > 1.5) { this.rollAcc = this.rollMark = 0; this.rollIdle = 0; }
      if (Math.abs(this.loopAcc - this.loopMark) > 0.3) { this.loopMark = this.loopAcc; this.loopIdle = 0; } else if ((this.loopIdle += dt) > 1.5) { this.loopAcc = this.loopMark = 0; this.loopIdle = 0; }
      if (Math.abs(this.rollAcc) >= TWO_PI - 0.3) {
        this.rollAcc = this.rollMark = 0;
        this._award('roll', emit);
      }
      if (Math.abs(this.loopAcc) >= TWO_PI - 0.4) {
        this.loopAcc = this.loopMark = 0;
        this._award('loop', emit);
      }
    } else if (!flying) {
      this.rollAcc = this.rollMark = this.loopAcc = this.loopMark = 0;
      this.loopPrev = null;
    }
    this.prevQ = { x: q.x, y: q.y, z: q.z, w: q.w };

    // --- 続ける技（1 秒保ったら最初の点、その後 1 秒ごと） ---
    if (flying && agl > this.lowAgl * 3) this.armedLow = true;
    if (vs.onGround) this.armedLow = false;
    if ((this.tick++ % 6) === 0) this.gapOn = flying && this._inGap(vs, ground);
    const cond = {
      inverted: flying && u.y < -0.6 && Math.abs(f.y) < 0.6,
      knife: flying && Math.abs(r.y) > 0.94 && Math.abs(f.y) < 0.5,
      low: flying && this.armedLow && agl < this.lowAgl && speed > this.lowSpeed,
      gap: this.gapOn,
    };
    for (const k of Object.keys(cond)) {
      if (cond[k]) {
        this.hold[k] += dt;
        if (this.hold[k] >= 1) { this.hold[k] -= 1; this._award(k, emit); }
      } else this.hold[k] = 0;
    }

    // --- タッチ＆ゴー（固定翼: 接地してから止まらずにもう一度浮く） ---
    if (this.def.model === 'fixedwing') {
      if (vs.onGround) {
        if (!this.tg && this._wasAir > 4) this.tg = { t: this.t };
        if (this.tg && (speed < this.minSpeed * 0.8 || this.t - this.tg.t > 25)) this.tg = { dead: true };
        this._wasAir = 0;
      } else {
        this._wasAir = (this._wasAir || 0) + dt;
        if (this.tg && agl > 4) {
          if (!this.tg.dead) this._award('touchgo', emit);
          this.tg = null;
        }
      }
    }

    // --- コンボの確定・制限時間 ---
    if (this.combo.count > 0 && this.t - this.combo.lastT > COMBO_HOLD) this.bank(emit);
    if (this.timeLimit != null && this.t >= this.timeLimit) {
      this.bank(emit);
      this.finished = true;
      emit('modeFinished', { result: { type: 'stunt', score: this.total, bestCombo: this.bestCombo, counts: { ...this.counts }, grade: stuntGrade(this.total), time: this.timeLimit } });
    }
  }

  /** 左右の両側が自分より高い（谷・ビルの間を抜けている）か */
  _inGap(vs, ground) {
    const hs = Math.hypot(vs.vel.x, vs.vel.z);
    if (hs < 1 || vs.pos.y - ground < 2) return false;
    const rx = -vs.vel.z / hs, rz = vs.vel.x / hs;
    const terr = this.world.terrain;
    const top = (x, z) => Math.max(terr.surfaceAt(x, z), terr.roofAt(x, z));
    for (const d of this.gapDist) {
      if (top(vs.pos.x + rx * d, vs.pos.z + rz * d) > vs.pos.y + 4 && top(vs.pos.x - rx * d, vs.pos.z - rz * d) > vs.pos.y + 4) return true;
    }
    return false;
  }

  summary() {
    const c = this.combo;
    return {
      combo: c.sum,
      mult: this.mult,
      count: c.count,
      hold: c.count ? clamp(1 - (this.t - c.lastT) / COMBO_HOLD, 0, 1) : 0,
      last: this.last ? { kind: this.last.kind, name: this.last.name, points: this.last.points, age: this.t - this.last.t } : null,
      total: this.total,
      bestCombo: this.bestCombo,
      left: this.timeLimit != null ? Math.max(0, this.timeLimit - this.t) : null,
      counts: { ...this.counts },
    };
  }
}
