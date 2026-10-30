// 車のモード: レース（周回＋ライバル）、ドリフト（制限時間の点数）、駐車（枠の中に止める）。DOM / Three.js 非依存。
import { clamp, mulberry32, hashString, approach, wrapPi } from './math.js';
import { checkpointsFor } from './track.js';

const LAPS = 2;
const RIVAL_NAMES = ['アカネ', 'ハヤテ', 'ミナト'];
const RIVAL_PAINTS = [0x2f7fe8, 0xf0b020, 0x30b868];
/** ライバルの強さ（曲がれる速さに掛ける） */
const RIVAL_PACE = { easy: 0.68, normal: 0.8, hard: 0.92 };

/** 周回とチェックポイント: 順番に通過しないと周回にならない（ショートカット防止） */
export class LapTracker {
  constructor(track, laps = LAPS) {
    this.track = track;
    this.laps = laps;
    this.cps = checkpointsFor(track, 8);
    this.next = 1; // 次に通るチェックポイント（0 がスタート／ゴール）
    this.lap = 1;
    this.progress = 0; // 周回に沿った累積距離
    this.lastS = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = null;
    this.wrongWay = false;
    this._wrongT = 0;
  }
  /** 1 ステップぶん: a → b に動いた */
  update(a, b, t, dt, emit) {
    if (this.finished) return;
    const cp = this.cps[this.next % this.cps.length];
    const d0 = (a.x - cp.x) * cp.tx + (a.z - cp.z) * cp.tz;
    const d1 = (b.x - cp.x) * cp.tx + (b.z - cp.z) * cp.tz;
    if (d0 < 0 && d1 >= 0) {
      const k = d0 / (d0 - d1);
      const hx = a.x + (b.x - a.x) * k, hz = a.z + (b.z - a.z) * k;
      const off = Math.hypot(hx - cp.x, hz - cp.z);
      if (off <= cp.halfWidth && Math.abs(a.y - cp.y) < 60) {
        if (this.next % this.cps.length === 0) {
          // スタート／ゴール線
          const lapTime = t - this.lapStart;
          this.lapTimes.push(lapTime);
          this.lapStart = t;
          emit('lap', { lap: this.lap, time: lapTime, total: this.laps });
          if (this.lap >= this.laps) {
            this.finished = true;
            this.finishTime = t;
            return;
          }
          this.lap++;
        } else emit('checkpoint', { index: this.next });
        this.next = (this.next + 1) % this.cps.length;
      }
    }
    // 進み具合（順位と逆走の判定）
    const n = this.track.nearest(b.x, b.z, 80, this.lastS);
    if (n) {
      let ds = n.s - this.lastS;
      const L = this.track.length;
      if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
      this.progress += ds;
      this.lastS = n.s;
      // 逆走: 中心線の向きと反対へ走っている（距離は 6 m 刻みなので、速度の向きで見る）
      const p = this.track.at(n.s);
      const along = dt > 0 ? ((b.x - a.x) * p.tx + (b.z - a.z) * p.tz) / dt : 0;
      this._wrongT = along < -2 ? this._wrongT + dt : Math.max(0, this._wrongT - dt * 2);
      this.wrongWay = this._wrongT > 1.2;
    }
  }
  nextCheckpoint() { return this.cps[this.next % this.cps.length]; }
}

/** ライバル: 中心線に沿って走る（物理なし）。プレイヤーとは押し合う */
class Rival {
  constructor(i, track, startS, pace, rnd) {
    this.id = i;
    this.name = RIVAL_NAMES[i % RIVAL_NAMES.length];
    this.paint = RIVAL_PAINTS[i % RIVAL_PAINTS.length];
    this.track = track;
    this.s = startS;
    this.pace = pace * (0.97 + rnd() * 0.06);
    this.offset = (i % 2 ? 1 : -1) * track.width * 0.2;
    this.offT = rnd() * 10;
    this.v = 0;
    this.progress = startS;
    this.pos = { x: 0, y: 0, z: 0 };
    this.heading = 0;
    this.steer = 0;
    this.finished = false;
    this.finishTime = null;
    this.spin = 0;
    this.place();
  }
  place() {
    const p = this.track.at(this.s, this.offset);
    this.pos.x = p.x; this.pos.y = p.y; this.pos.z = p.z;
    this.heading = p.heading;
    this.steer = clamp(p.k * 18, -0.5, 0.5);
    this.vel = { x: p.tx * this.v, y: 0, z: p.tz * this.v };
  }
  step(dt, topSpeed, boost) {
    this.offT += dt;
    this.offset = Math.sin(this.offT * 0.13 + this.id * 2) * this.track.width * 0.25;
    const target = Math.min(this.track.speedAt(this.s + this.v * 0.8) * this.pace * (1 + boost), topSpeed * this.pace);
    this.v = target > this.v ? Math.min(target, this.v + 7 * dt) : Math.max(target, this.v - 12 * dt);
    this.s += this.v * dt;
    this.progress += this.v * dt;
    this.spin = (this.spin + (this.v / 0.33) * dt) % (Math.PI * 2);
    this.place();
  }
}

export class RaceMode {
  /** opts: { rivals: 台数, difficulty, laps } */
  constructor(world, def, opts = {}) {
    const track = world.terrain.track;
    this.track = track;
    this.tracker = new LapTracker(track, opts.laps ?? world.terrain.laps ?? LAPS);
    this.rivals = [];
    this.time = 0;
    this.finished = false;
    this.countdown = opts.countdown ?? 3;
    const rnd = mulberry32(world.seed + hashString('race'));
    const n = opts.rivals ?? 3;
    // 雨・雪の日はライバルも遅くなる（曲がれる速さは √μ に比例）
    const pace = (RIVAL_PACE[opts.difficulty] || RIVAL_PACE.normal) * Math.sqrt(world.weather.grip ?? 1);
    this.topSpeed = (def.raceTop || 70);
    for (let i = 0; i < n; i++) this.rivals.push(new Rival(i, track, 8 + i * 9, pace, rnd));
  }
  /** 順位（1 が先頭） */
  position() {
    const me = this.tracker.progress + (this.tracker.finished ? 1e6 : 0);
    let pos = 1;
    for (const r of this.rivals) if (r.progress + (r.finished ? 1e6 : 0) > me) pos++;
    return pos;
  }
  step(vs, prev, t, dt, env) {
    if (this.finished) return;
    if (this.countdown > 0) {
      const c0 = Math.ceil(this.countdown);
      this.countdown = Math.max(0, this.countdown - dt);
      if (Math.ceil(this.countdown) !== c0) env.emit('countdown', { n: Math.ceil(this.countdown) });
      return;
    }
    this.time += dt;
    this.tracker.update(prev, vs.pos, this.time, dt, env.emit);
    const L = this.track.length * this.tracker.laps;
    const myProgress = this.tracker.progress;
    for (const r of this.rivals) {
      if (r.finished) continue;
      // 少しだけ追いつき・譲り合い（離れすぎないように）
      const gap = myProgress - r.progress;
      const boost = clamp(gap / 3000, -0.08, 0.08);
      r.step(dt, this.topSpeed, boost);
      if (r.progress >= L) { r.finished = true; r.finishTime = this.time; }
      // 押し合い
      const dx = vs.pos.x - r.pos.x, dz = vs.pos.z - r.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.8 && Math.abs(vs.pos.y - r.pos.y) < 3 && d > 0.01) {
        const nx = dx / d, nz = dz / d;
        const push = (2.8 - d) * 0.5;
        vs.pos.x += nx * push; vs.pos.z += nz * push;
        const fh = { x: Math.sin(vs.psi), z: -Math.cos(vs.psi) };
        const rh = { x: -fh.z, z: fh.x };
        vs.vy += (nx * rh.x + nz * rh.z) * 6 * dt * 10;
        vs.vx += (nx * fh.x + nz * fh.z) * 3 * dt * 10;
        r.v *= 0.995;
        if (!this._bumpT || t - this._bumpT > 0.6) { this._bumpT = t; env.emit('carHit', { impact: 3 }); }
      }
    }
    if (this.tracker.finished) {
      this.finished = true;
      const place = this.position();
      env.emit('modeFinished', {
        result: {
          type: 'race', time: this.tracker.finishTime, place, cars: this.rivals.length + 1,
          lapTimes: this.tracker.lapTimes, bestLap: Math.min(...this.tracker.lapTimes), laps: this.tracker.laps,
        },
      });
    }
  }
  summary() {
    const tr = this.tracker;
    const cp = tr.nextCheckpoint();
    return {
      lap: tr.lap, laps: tr.laps, time: this.time, lapTime: this.time - tr.lapStart,
      place: this.position(), cars: this.rivals.length + 1, countdown: this.countdown,
      wrongWay: tr.wrongWay, next: { x: cp.x, y: cp.y, z: cp.z, heading: cp.heading, halfWidth: cp.halfWidth },
      bestLap: tr.lapTimes.length ? Math.min(...tr.lapTimes) : null,
    };
  }
}

export const DRIFT_TIME = 90;
export function driftGrade(score) {
  return score >= 18000 ? 'S' : score >= 9000 ? 'A' : score >= 4000 ? 'B' : 'C';
}

export class DriftMode {
  constructor(opts = {}) {
    this.left = opts.time ?? DRIFT_TIME;
    this.finished = false;
    this.time = 0;
  }
  step(vs, env, dt) {
    if (this.finished) return;
    this.time += dt;
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.finished = true;
      vs.drift.bank(env.emit);
      const score = vs.drift.total;
      env.emit('modeFinished', { result: { type: 'drift', score, bestRun: vs.drift.best, grade: driftGrade(score), time: this.time } });
    }
  }
  summary(vs) {
    return { left: this.left, total: vs.drift.total, best: vs.drift.best };
  }
}

/** 駐車: 枠の中に止める（3 か所）。枠の中心からのずれ・向き・時間で採点 */
export class ParkingMode {
  constructor(world, opts = {}) {
    const terr = world.terrain;
    const f = terr.field;
    const rnd = mulberry32(world.seed + hashString('parking'));
    const hd = (f.heading * Math.PI) / 180;
    const fx = Math.sin(hd), fz = -Math.cos(hd);
    const rx = -fz, rz = fx;
    const n = opts.count ?? 3;
    this.boxes = [];
    const start = terr.startPoint;
    for (let i = 0; i < n; i++) {
      // フィールドの平らな範囲に、前へ少しずつ離して置く
      const u = (i + 1) * Math.min(f.length * 0.12, 90) + rnd() * 25;
      const v = (i % 2 ? 1 : -1) * (f.width * 0.5 + 16 + rnd() * 12);
      const startU = (start.x - f.x) * fx + (start.z - f.z) * fz;
      // 建物や水の上に置かない（反対側 → 中央寄りの順に試す）
      let x = 0, z = 0;
      for (const vv of [v, -v, v * 0.15]) {
        x = f.x + fx * (startU + u) + rx * vv;
        z = f.z + fz * (startU + u) + rz * vv;
        if (!terr.buildingHit({ x, y: terr.heightAt(x, z) + 1, z }, 5) && !terr.isWater(x, z)) break;
      }
      const heading = hd + (Math.floor(rnd() * 4) * Math.PI) / 2;
      this.boxes.push({ x, z, y: terr.heightAt(x, z), heading, w: 3.6, l: 6.4 });
    }
    this.index = 0;
    this.time = 0;
    this.holdT = 0;
    this.scores = [];
    this.finished = false;
  }
  current() { return this.boxes[this.index] || null; }
  /** ボックスに対するずれ: 中心からの距離・枠に入っているか・向きのずれ（前後どちらでも可） */
  check(vs) {
    const b = this.current();
    if (!b) return null;
    const dx = vs.pos.x - b.x, dz = vs.pos.z - b.z;
    const fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
    const u = dx * fx + dz * fz;
    const v = dx * -fz + dz * fx;
    const ang = Math.abs(wrapPi(vs.psi - b.heading));
    const angErr = Math.min(ang, Math.PI - ang);
    const inside = Math.abs(u) <= b.l / 2 && Math.abs(v) <= b.w / 2;
    return { u, v, dist: Math.hypot(dx, dz), angErr, inside };
  }
  step(vs, env, dt) {
    if (this.finished) return;
    this.time += dt;
    const c = this.check(vs);
    if (!c) return;
    const stopped = Math.hypot(vs.vx, vs.vy) < 0.4;
    if (c.inside && stopped) {
      this.holdT += dt;
      if (this.holdT > 1) {
        // 位置（50 点）と向き（50 点）
        const posPts = 50 * (1 - clamp(c.dist / 3.2, 0, 1));
        const angPts = 50 * (1 - clamp(c.angErr / 0.6, 0, 1));
        const pts = Math.round(posPts + angPts);
        this.scores.push(pts);
        env.emit('parked', { score: pts, index: this.index });
        this.index++;
        this.holdT = 0;
        if (this.index >= this.boxes.length) {
          this.finished = true;
          const precision = this.scores.reduce((a, b) => a + b, 0) / this.scores.length;
          const timeBonus = clamp(1 - this.time / 240, 0, 1) * 30;
          const score = Math.round(precision * 0.7 + timeBonus);
          const grade = score >= 80 ? 'S' : score >= 62 ? 'A' : score >= 45 ? 'B' : 'C';
          env.emit('modeFinished', { result: { type: 'parking', score, grade, time: this.time, scores: this.scores } });
        }
      }
    } else this.holdT = approach(this.holdT, 0, 0.3, dt);
  }
  summary(vs) {
    const c = this.check(vs);
    const b = this.current();
    return {
      index: this.index, total: this.boxes.length, time: this.time, hold: this.holdT,
      box: b ? { x: b.x, y: b.y, z: b.z, heading: b.heading, w: b.w, l: b.l } : null,
      inside: !!(c && c.inside), dist: c ? c.dist : null, angErr: c ? c.angErr : null,
    };
  }
}
