// ゲームモード: リングコース（タイムアタック）と着陸評価
import { DEG, clamp, mulberry32, hashString, vsub, vdot, vlen, vnorm, vadd, vscale } from './math.js';
import { fieldLocal } from './terrainGen.js';
import { stallSpeed } from './vehicles/fixedwing.js';

export const CRUISE = { prop: 50, airliner: 125, fighter: 200, sailplane: 29, heli: 35, drone: 18, flycar: 45, balloon: 0, paraglider: 10.5, jetsuit: 28, wingsuit: 31, skydive: 0, driftcar: 40, rally: 35, hypercar: 60, monster: 30, kart: 25, hover: 40 };
export const RING_PENALTY = 5;

/** 機体ごとに遊べるモード */
export function modesFor(def) {
  if (def.model === 'balloon') return ['free', 'landing'];
  if (def.model === 'car') return ['free', 'race', 'drift', 'parking'];
  if (def.model === 'flycar') return ['free', 'race', 'drift', 'parking', 'rings', 'stunt', 'combat', 'landing'];
  // 曲技: 姿勢を自由に変えられて、飛び続けられる機体
  if (def.model === 'fixedwing' || def.model === 'heli' || def.model === 'jetsuit') return ['free', 'rings', 'stunt', 'combat', 'landing'];
  return ['free', 'rings', 'combat', 'landing'];
}

/**
 * 次のリングへの接近の予測（HUD の距離感の手がかり）。
 * 戻り値: dist（中心まで）, eta（今の速度で通過面に届くまでの秒数, 届かなければ null）,
 *         miss（そのまま進んだときに通過面で中心からどれだけずれるか）, willPass, side（ずれの向き: 機体から見た右/上）
 */
export function ringApproach(ring, pos, vel) {
  const rel = vsub(ring.pos, pos);
  const dist = vlen(rel);
  const vn = vdot(vel, ring.normal);
  const dn = vdot(rel, ring.normal); // 通過面までの距離（法線方向）
  if (vn <= 0.5 || dn <= 0) return { dist, eta: null, miss: null, willPass: false };
  const t = dn / vn;
  const hit = vadd(pos, vscale(vel, t));
  const off = vsub(hit, ring.pos);
  const miss = vlen(off);
  return { dist, eta: t, miss, willPass: miss <= ring.radius * 0.9, offset: off };
}

/** start: { pos, heading(rad) } */
export function createRingCourse(world, def, start) {
  const rnd = mulberry32(world.seed + hashString(def.id));
  const terr = world.terrain;
  const R = def.ringRadius;
  const rings = [];
  if (def.id === 'skydive') {
    let y = start.pos.y - 220;
    let x = start.pos.x, z = start.pos.z;
    const groundAt = () => terr.surfaceAt(x, z);
    while (y > groundAt() + 900 && rings.length < 10) {
      x += (rnd() - 0.5) * 120;
      z += (rnd() - 0.5) * 120;
      rings.push({ pos: { x, y, z }, normal: { x: 0, y: -1, z: 0 }, radius: R });
      y -= 170;
    }
    return rings;
  }
  const spacing = (CRUISE[def.id] || 40) * def.ringSpacingTime;
  const gliding = !!def.ringGlide;
  let p = { ...start.pos };
  let hd = start.heading;
  const slow = def.id === 'heli' || def.id === 'jetsuit';
  let targetAgl = slow ? 60 : 250;
  for (let i = 0; i < 10; i++) {
    hd += (rnd() - 0.5) * 55 * DEG;
    const dist = i === 0 ? spacing * 0.8 : spacing;
    const nx = p.x + Math.sin(hd) * dist;
    const nz = p.z - Math.cos(hd) * dist;
    const g = Math.max(terr.surfaceAt(nx, nz), terr.roofAt(nx, nz));
    let y;
    if (gliding) {
      y = p.y - dist / def.ringGlide;
      if (y < g + R * 2 + 40) break; // これ以上は滑空で届かない
    } else {
      targetAgl = clamp(targetAgl + (rnd() - 0.5) * (slow ? 50 : 220), slow ? 25 : 120, slow ? 140 : 600);
      y = Math.max(g + targetAgl, p.y + (rnd() - 0.5) * dist * 0.15);
      y = Math.max(y, g + R * 2 + 20);
      // 経路上の地形をクリア
      for (let k = 1; k <= 8; k++) {
        const f = k / 8;
        const gx = p.x + (nx - p.x) * f, gz = p.z + (nz - p.z) * f;
        const gh = Math.max(terr.surfaceAt(gx, gz), terr.roofAt(gx, gz));
        y = Math.max(y, gh + R * 2 + 30);
      }
    }
    const np = { x: nx, y, z: nz };
    const normal = vnorm(vsub(np, p));
    rings.push({ pos: np, normal, radius: R });
    p = np;
  }
  return rings;
}

export class RingTracker {
  constructor(rings) {
    this.rings = rings;
    this.index = 0;
    this.passed = 0;
    this.missed = 0;
    this.finished = false;
    this.finishTime = null;
  }
  get penalty() { return this.missed * RING_PENALTY; }
  /** 前ステップ位置 a → 現在位置 b の線分でリング通過を判定 */
  update(a, b, t, emit) {
    if (this.finished || this.index >= this.rings.length) return;
    const ring = this.rings[this.index];
    const d0 = vdot(vsub(a, ring.pos), ring.normal);
    const d1 = vdot(vsub(b, ring.pos), ring.normal);
    if (d0 < 0 && d1 >= 0) {
      const s = d0 / (d0 - d1);
      const hit = vadd(a, vscale(vsub(b, a), s));
      const r = vlen(vsub(hit, ring.pos));
      if (r <= ring.radius) {
        this.passed++;
        this.index++;
        emit('ring', { index: this.index - 1, total: this.rings.length });
      } else if (r < Math.max(ring.radius * 12, 400)) {
        // 輪の外を通り過ぎた（次の輪へ進む）。遠く離れた所で通過面を横切っただけなら数えない
        this.missed++;
        this.index++;
        emit('ringMiss', { index: this.index - 1, total: this.rings.length });
      }
      if (this.index >= this.rings.length) {
        this.finished = true;
        this.finishTime = t + this.penalty;
        emit('courseFinished', { time: t, penalty: this.penalty, total: this.finishTime, passed: this.passed, missed: this.missed });
      }
    }
  }
}

const GRADE_TABLE = {
  fixedwing: [0.8, 1.6, 2.5],
  heli: [0.5, 1.0, 1.8],
  jetsuit: [0.6, 1.2, 2.0],
  human: [1.5, 2.5, 4.0],
  paraglider: [0.8, 1.6, 2.6],
  balloon: [0.5, 1.0, 2.0],
  flycar: [0.8, 1.6, 2.6],
};

/** 着陸評価（接地速度と降下率、精度） */
export function rateLanding(def, td, field) {
  const model = def.model;
  const vsAbs = Math.max(0, -td.vs);
  const th = GRADE_TABLE[model] || GRADE_TABLE.fixedwing;
  const GR = ['S', 'A', 'B', 'C'];
  const vsGrade = vsAbs <= th[0] ? 0 : vsAbs <= th[1] ? 1 : vsAbs <= th[2] ? 2 : 3;
  const { u, v } = fieldLocal(field, td.x, td.z);
  const dist = Math.hypot(u, v);
  const maxSink = def.p.ground?.maxSink ?? def.p.landing?.maxSink ?? 3;
  const descentPts = 1 - clamp(vsAbs / maxSink, 0, 1);
  let speedPts, accPts, idealSpeed = null;
  let weights;
  if (model === 'fixedwing') {
    idealSpeed = 1.12 * stallSpeed(def.p, td.flaps ?? 0);
    speedPts = 1 - clamp((Math.abs((td.airspeed ?? td.speed) - idealSpeed) / idealSpeed) * 3, 0, 1);
    accPts = (td.surface === 'runway' || td.surface === 'field') ? 1 - clamp(Math.abs(v) / (field.width / 2), 0, 1) : 0;
    weights = [50, 25, 25];
  } else if (model === 'human' || model === 'paraglider') {
    speedPts = 1 - clamp(td.speed / (def.p.landing.maxSpeed), 0, 1);
    accPts = 1 - clamp(dist / 150, 0, 1);
    weights = [25, 15, 60];
  } else {
    speedPts = 1 - clamp(td.speed / (def.p.landing.maxSpeed), 0, 1);
    accPts = 1 - clamp(dist / 120, 0, 1);
    weights = [50, 20, 30];
  }
  // 評価記号は「降下率」と「接地速度」の悪い方で決める
  let spGrade;
  if (model === 'fixedwing') {
    const dev = (td.airspeed ?? td.speed) / idealSpeed - 1;
    spGrade = Math.abs(dev) <= 0.12 ? 0 : Math.abs(dev) <= 0.25 ? 1 : Math.abs(dev) <= 0.4 ? 2 : 3;
  } else {
    const r = td.speed / def.p.landing.maxSpeed;
    spGrade = r <= 0.3 ? 0 : r <= 0.55 ? 1 : r <= 0.8 ? 2 : 3;
  }
  const grade = GR[Math.max(vsGrade, spGrade)];
  const score = Math.round(weights[0] * descentPts + weights[1] * speedPts + weights[2] * accPts);
  let comment = { S: 'バターのような接地！', A: 'きれいな着陸', B: 'やや硬い着陸', C: 'ハードランディング' }[grade];
  if (spGrade > vsGrade) comment = model === 'fixedwing' && (td.airspeed ?? td.speed) > idealSpeed ? '接地速度が速すぎます' : model === 'fixedwing' ? '速度が遅すぎます' : '接地時の速度が大きい';
  return { grade, score, vsGrade: GR[vsGrade], speedGrade: GR[spGrade], vs: vsAbs, speed: td.speed, airspeed: td.airspeed, idealSpeed, dist, centerline: v, surface: td.surface, comment };
}
