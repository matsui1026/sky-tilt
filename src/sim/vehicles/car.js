// 地上を走る車の物理（二輪モデル + 荷重移動 + タイヤの摩擦円）。空飛ぶ車の走行モードも共有する。
// 座標: 車体の前方 vx、右 vy、ヨーレート r は右回り正（方位 psi は北=0、東=+）。
//
// タイヤ: 横力は滑り角に対して 12° 付近で最大、それ以上は 76% まで落ちる（一度滑ると戻しにくい）。
//   後輪の駆動力やサイドブレーキで摩擦円を使い切ると横力が減り、車の尻が流れる＝ドリフト。
// アシスト: スマホの傾きで逆ハンドルを当てるのは難しいので、前輪を自動で進行方向へ向ける。
import { G0, DEG, clamp, approach, vadd, vscale, vlen, quatFromAttitude, lerp } from '../math.js';

export const SURFACES = {
  asphalt: { name: '舗装', mu: 1.0, roll: 0.012, smoke: 0xd8d8d8 },
  concrete: { name: 'コンクリート', mu: 0.95, roll: 0.013, smoke: 0xd8d8d8 },
  dirt: { name: 'ダート', mu: 0.72, roll: 0.022, smoke: 0xb08a5a },
  grass: { name: '草地', mu: 0.62, roll: 0.03, smoke: 0x8a9a5a },
  park: { name: '芝生', mu: 0.62, roll: 0.028, smoke: 0x8a9a5a },
  sand: { name: '砂地', mu: 0.55, roll: 0.06, smoke: 0xd8b888 },
  rock: { name: '岩場', mu: 0.75, roll: 0.022, smoke: 0x9a9080 },
  snow: { name: '雪', mu: 0.42, roll: 0.025, smoke: 0xf4f8ff },
  ice: { name: '氷', mu: 0.14, roll: 0.008, smoke: 0xeaf6ff },
  water: { name: '水面', mu: 0.2, roll: 0.01, smoke: 0xeaf6ff },
};

const ROLL_VLOW = 2.0; // 滑り角の計算で低速を丸める速度 [m/s]
const SUBSTEPS = 4;
const SCORE_MIN_DEG = 12;
const SCORE_MIN_SPEED = 8;

/** 正規化したタイヤの横力（滑り角 alpha [rad]）。12° で最大 1、大きく滑ると 0.76 */
export function tyreCurve(alpha) {
  return Math.sin(1.45 * Math.atan(9 * alpha));
}

/** ドリフトの採点: 角度と速さで点が入り、続けるほど倍率が上がる。切り返しは猶予時間内ならつながる */
export class DriftScorer {
  constructor() {
    this.active = false;
    this.score = 0; // いまのドリフトの点（確定前）
    this.mult = 1;
    this.t = 0;
    this.grace = 0;
    this.total = 0; // 確定した合計
    this.best = 0; // 1 回の最高点
    this.angle = 0;
  }
  update(angleDeg, speed, onGround, dt, emit) {
    this.angle = angleDeg;
    const on = onGround && angleDeg >= SCORE_MIN_DEG && speed >= SCORE_MIN_SPEED;
    if (on) {
      if (!this.active && this.score === 0) emit('driftStart', {});
      this.active = true;
      this.grace = 1.2;
      this.t += dt;
      this.mult = 1 + Math.min(4, Math.floor(this.t / 2.5));
      this.score += (Math.min(angleDeg, 60) / 30) * (speed / 20) * 100 * this.mult * dt;
    } else if (this.score > 0) {
      this.active = false;
      this.grace -= dt;
      if (this.grace <= 0) this.bank(emit);
    } else {
      this.active = false;
    }
  }
  /** いまのドリフトを確定 */
  bank(emit) {
    if (this.score <= 0) return;
    const pts = Math.round(this.score);
    this.total += pts;
    if (pts > this.best) this.best = pts;
    if (emit) emit('driftEnd', { score: pts, mult: this.mult, total: this.total });
    this.score = 0; this.mult = 1; this.t = 0; this.active = false;
  }
  /** ぶつかったら確定前の点は消える */
  cancel(emit) {
    if (this.score <= 0) return;
    if (emit) emit('driftLost', { score: Math.round(this.score) });
    this.score = 0; this.mult = 1; this.t = 0; this.active = false; this.grace = 0;
  }
}

export function createCarState(def, spawn) {
  const hd = spawn.heading || 0;
  const sp = spawn.speed || 0;
  return {
    pos: { ...spawn.pos },
    vel: { x: Math.sin(hd) * sp, y: 0, z: -Math.cos(hd) * sp },
    psi: hd, vx: sp, vy: 0, r: 0, steer: 0,
    theta: 0, phi: 0,
    q: quatFromAttitude(0, 0, hd),
    gas: 0, brakeIn: 0, handbrake: false,
    gear: 1, rpm: 0.1, shiftT: 0,
    rev: false, stopT: 0,
    nitro: 1, nitroOn: false,
    ax: 0, ay: 0,
    slipF: 0, slipR: 0, wheelSpin: 0, spinAngle: 0,
    beta: 0,
    air: false,
    surface: 'asphalt',
    drift: new DriftScorer(),
    lastSafe: { x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z, psi: hd },
    safeT: 0,
    onGround: true,
    airspeed: sp,
    g: 1,
    thrust: 0,
    bodyPitch: 0, bodyRoll: 0,
  };
}

/** (x,z) の路面の高さ（地形・水面・屋上・ジャンプ台） */
export function roadHeight(terr, x, z) {
  return Math.max(terr.surfaceAt(x, z), terr.roofAt(x, z), terr.rampAt(x, z));
}

/** 路面の μ（車のタイヤの得意不得意と、雨雪を反映） */
function surfaceGrip(D, kind, world) {
  const S = SURFACES[kind] || SURFACES.asphalt;
  const offroad = D.offroad || 0;
  const base = kind === 'ice' ? S.mu : lerp(S.mu, Math.max(S.mu, 0.92), offroad);
  return base * (world.weather.grip ?? 1);
}

/**
 * 入力 inp: { steer(-1..1), gas(0..1), brake(0..1), handbrake, nitro }
 * opts: { assist(0..1), revDelay, waterCrash }
 */
export function stepCarCore(def, s, inp, env, dt, opts = {}) {
  const P = def.p;
  const D = P.drive;
  const world = env.world;
  const terr = world.terrain;
  const K = opts.assist ?? 0.7;
  s.gas = approach(s.gas, inp.gas, inp.gas > s.gas ? 0.08 : 0.05, dt);
  s.brakeIn = approach(s.brakeIn, inp.brake, 0.05, dt);
  s.handbrake = !!inp.handbrake;
  s.throttle = s.gas;

  // ニトロ: 押している間だけ。ドリフト中はよくたまる
  const wantNitro = !!inp.nitro && D.nitro && s.nitro > 0.02 && !s.air;
  if (wantNitro && !s.nitroOn) env.emit('nitro', {});
  s.nitroOn = wantNitro;
  if (D.nitro) {
    if (s.nitroOn) s.nitro = Math.max(0, s.nitro - (dt / D.nitro.time));
    else s.nitro = Math.min(1, s.nitro + dt * (s.drift.active ? 0.14 : 0.025));
  }

  if (s.air) { stepAir(def, s, inp, env, dt, opts); finishAttitude(def, s, env, dt); return; }

  const kind = terr.surfaceKind(s.pos.x, s.pos.z);
  s.surface = kind;
  const mu = surfaceGrip(D, kind, world);
  const rollK = (SURFACES[kind] || SURFACES.asphalt).roll * (D.offroad ? lerp(1, 0.5, D.offroad) : 1);
  const g0 = roadHeight(terr, s.pos.x, s.pos.z);
  const grad = terr.gradient(s.pos.x, s.pos.z, 3);
  const onRamp = terr.rampAt(s.pos.x, s.pos.z) >= g0 - 0.01 && terr.rampAt(s.pos.x, s.pos.z) > -Infinity;
  const onRoof = terr.roofAt(s.pos.x, s.pos.z) >= terr.surfaceAt(s.pos.x, s.pos.z);
  const noSlope = onRamp || onRoof;
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  const slopeF = noSlope ? 0 : grad.x * fh.x + grad.z * fh.z;
  const slopeR = noSlope ? 0 : grad.x * rh.x + grad.z * rh.z;
  const gx = -G0 * Math.sin(Math.atan(slopeF));
  const gy = -G0 * Math.sin(Math.atan(slopeR));

  // 後退: 止まってからブレーキを押し続ける
  const delay = opts.revDelay ?? 0.35;
  if (!s.rev) {
    if (s.brakeIn > 0.3 && Math.abs(s.vx) < 0.6 && s.gas < 0.05) s.stopT += dt; else s.stopT = 0;
    if (s.stopT > delay) { s.rev = true; s.stopT = 0; }
  } else if (s.gas > 0.1 || (s.brakeIn < 0.1 && Math.abs(s.vx) < 0.5)) {
    s.rev = false;
  }

  // ハンドル: 速いほど切れ角を小さく。滑っているときは逆ハンドルの分だけ切れる
  const v = Math.abs(s.vx);
  const beta = Math.atan2(s.vy, Math.max(v, 3)) * (s.vx < -0.5 ? 0 : 1);
  s.beta = beta;
  const lock = D.maxSteer;
  // 普通に曲がるときの上限: その速さで曲がれる舵角（L·μg/v²）＋ タイヤの滑り角の最大（12°）。
  // これ以上切っても前輪が滑るだけ。傾けすぎてもスピンしにくく、スマホの操作に向く
  const sMax = Math.min(lock, (D.wheelBase * mu * (D.gripF ?? 1) * G0) / Math.max(v * v, 1) + 0.2);
  const counter = K * clamp(beta, -lock * 0.95, lock * 0.95);
  const target = clamp(inp.steer * sMax * (1 + Math.abs(beta) * 1.5) + counter, -lock, lock);
  s.steer = approach(s.steer, target, D.steerTau ?? 0.07, dt);

  // 変速とエンジンの力
  gearbox(def, s, env, dt);
  let drive = driveForce(D, s) * (s.shiftT > 0 ? 0.25 : 1);
  // 滑らせる意思: サイドを引いた、または（アシストが弱いとき）大きく切ってアクセル全開。
  // 滑りが収まるまで続く。それ以外はトラクション制御と横滑り防止が効き、踏んだだけではスピンしない
  if (s.handbrake && v > 5) { s.slideT = 0.9; s.driftIntent = true; }
  if (K <= 0.6 && s.gas > 0.9 && Math.abs(inp.steer) > 0.85 && v > 8 && v < 40) s.driftIntent = true;
  s.slideT = Math.max(0, (s.slideT || 0) - dt);
  // 切り返しの途中（一瞬まっすぐ）で終わらないよう、まっすぐの状態が続いてから終わる
  if (s.driftIntent && s.slideT <= 0 && Math.abs(beta) < 0.1 && Math.abs(inp.steer) < 0.3) {
    s.straightT = (s.straightT || 0) + dt;
    if (s.straightT > 0.4) { s.driftIntent = false; s.straightT = 0; }
  } else s.straightT = 0;
  if (s.driftIntent && v < 4) s.driftIntent = false;
  // ドリフトアシスト: 傾きで「滑らせる角度」を決める。右へ傾けると車首が右へ入り、進行方向は左へ流れる（β が負）。
  // アクセルを抜くと角度が浅くなって収まる
  const betaTarget = s.driftIntent ? -inp.steer * (D.driftAngle ?? 0.75) * clamp(0.35 + s.gas, 0, 1) : 0;
  if (K > 0 && !s.driftIntent && !s.rev && drive > 0) {
    // 前後輪が空転しない最大の駆動力（加速で荷重が後ろへ移る分も含む）。
    // 後輪: (1-df)F ≤ μ(mg(1-w) + F·h/L)、前輪: df·F ≤ μ(mg·w − F·h/L) を F について解いたもの
    const w = D.weightFront ?? 0.5, dfr = D.driveFront ?? 0, hL = (D.cgH ?? 0.5) / D.wheelBase;
    const muF0 = mu * (D.gripF ?? 1), muR0 = mu * (D.gripR ?? 1), mg = P.mass * G0;
    const limR0 = dfr < 1 ? (muR0 * mg * (1 - w)) / Math.max((1 - dfr) - muR0 * hL, 0.1) : Infinity;
    const limF0 = dfr > 0 ? (muF0 * mg * w) / (dfr + muF0 * hL) : Infinity;
    // 曲がっている間は横力にタイヤを残す（摩擦円）
    const lat = clamp(Math.abs(s.ay) / (mu * G0), 0, 0.98);
    drive = Math.min(drive, Math.min(limR0, limF0) * 0.95 * Math.sqrt(1 - lat * lat));
  }  if (K > 0 && s.driftIntent && v > (D.driftSpeed ?? 24) && drive > 0) drive *= 0.3;
  if (s.rev) drive = -s.brakeIn * D.reverse;
  if (s.nitroOn && !s.rev) drive = drive * D.nitro.boost + P.mass * D.nitro.accel;
  s.thrust = drive;

  const m = P.mass;
  const L = D.wheelBase;
  const wf = D.weightFront ?? 0.5;
  const a = L * (1 - wf), b = L * wf; // CG から前軸・後軸まで
  const Iz = D.Iz ?? m * a * b * 1.15;
  const h = dt / SUBSTEPS;
  const rho = world.density(s.pos.y);
  const df = D.driveFront ?? 0; // 前輪の駆動力の配分
  const cs = Math.cos(s.steer), sn = Math.sin(s.steer);
  const brakeF = s.rev ? 0 : m * D.brake * s.brakeIn;
  let sumAx = 0, sumAy = 0, slipFMax = 0, slipRMax = 0, spun = 0;
  for (let i = 0; i < SUBSTEPS; i++) {
    const down = 0.5 * rho * (D.ClA || 0) * s.vx * s.vx;
    const trans = clamp(s.ax, -G0, G0) * m * (D.cgH ?? 0.5) / L;
    const FzF = Math.max(50, m * G0 * wf + down * 0.5 - trans);
    const FzR = Math.max(50, m * G0 * (1 - wf) + down * 0.5 + trans);
    const muF = mu * (D.gripF ?? 1);
    const muR = mu * (D.gripR ?? 1);
    // 前輪
    const vyf = s.vy + a * s.r;
    const vwx = s.vx * cs + vyf * sn;
    const vwy = -s.vx * sn + vyf * cs;
    const alphaF = Math.atan2(vwy, Math.max(Math.abs(vwx), ROLL_VLOW));
    let FyF = -muF * FzF * tyreCurve(alphaF);
    // 後輪
    const vyr = s.vy - b * s.r;
    const alphaR = Math.atan2(vyr, Math.max(Math.abs(s.vx), ROLL_VLOW));
    let FyR = -muR * FzR * tyreCurve(alphaR);
    // 駆動・制動（摩擦円）
    let FxF = drive * df;
    let FxR = drive * (1 - df);
    const dir = s.vx >= 0 ? 1 : -1;
    if (brakeF > 0) { FxF -= dir * brakeF * 0.6; FxR -= dir * brakeF * 0.4; }
    const limF = muF * FzF, limR = muR * FzR;
    let spinNow = 0;
    if (Math.abs(FxF) > limF) { spinNow = 1; FxF = Math.sign(FxF) * limF; FyF *= 0.6; } else FyF *= Math.max(0.25, Math.sqrt(1 - (FxF / limF) ** 2));
    if (s.handbrake) {
      // 後輪ロック: 滑る向きと逆向きに摩擦（滑り摩擦は少し小さい）
      const sp = Math.hypot(s.vx, vyr);
      const fr = muR * 0.8 * FzR;
      if (sp > 0.3) { FxR = (-fr * s.vx) / sp; FyR = (-fr * vyr) / sp; } else { FxR = 0; }
      spinNow = 0;
    } else if (Math.abs(FxR) > limR) {
      // 駆動力が多すぎる: ホイールスピンして横力が減る（パワードリフト）
      spinNow = 1;
      FxR = Math.sign(FxR) * limR;
      FyR *= D.spinLat ?? 0.55;
    } else FyR *= Math.max(0.25, Math.sqrt(1 - (FxR / limR) ** 2));
    const drag = 0.5 * rho * D.CdA * s.vx * Math.abs(s.vx);
    const Fx = FxR + FxF * cs - FyF * sn - drag;
    const Fy = FyR + FxF * sn + FyF * cs;
    const Mz = a * (FyF * cs + FxF * sn) - b * FyR;
    const ax = Fx / m + gx;
    const ay = Fy / m + gy;
    s.vx += (ax + s.r * s.vy) * h;
    s.vy += (ay - s.r * s.vx) * h;
    s.r += (Mz / Iz) * h;
    // 転がり抵抗（と止まっているときの保持）
    const hold = (s.brakeIn > 0.1 && !s.rev) || (inp.handbrake) ? 4 : 0;
    const dec = (rollK * G0 + (s.gas < 0.03 && !s.rev ? (D.engineBrake ?? 0.5) : 0) + (Math.abs(s.vx) < 1 ? hold : 0)) * h;
    if (Math.abs(s.vx) <= dec && drive === 0) s.vx = 0;
    else if (Math.abs(s.vx) > dec) s.vx -= Math.sign(s.vx) * dec;
    // 横滑り防止（アシスト）: 滑らせるつもりがないときは、ハンドルどおりの曲がり方へヨーを寄せる
    if (K > 0 && !s.driftIntent && s.vx > 3) {
      const rRef = clamp((s.vx * Math.tan(s.steer)) / L, -(mu * G0) / s.vx, (mu * G0) / s.vx);
      s.r += (rRef - s.r) * (1 - Math.exp(-K * 7 * h));
    }
    if (K > 0 && s.driftIntent && s.vx > 3) {
      const bNow = Math.atan2(s.vy, s.vx);
      s.r += (bNow - betaTarget) * K * (D.driftYaw ?? 10) * h;
      s.r *= Math.exp(-K * 1.6 * h);
    }
    // スピン防止（アシスト）: 滑りすぎたら向きを戻す
    if (K > 0 && s.vx > 4) {
      const bNow = Math.atan2(s.vy, s.vx);
      const limit = lerp(1.25, 0.85, K);
      if (Math.abs(bNow) > limit) s.r += Math.sign(bNow) * (Math.abs(bNow) - limit) * 14 * K * h * 4;
    }
    sumAx += ax; sumAy += ay;
    slipFMax = Math.max(slipFMax, Math.abs(alphaF));
    slipRMax = Math.max(slipRMax, Math.abs(alphaR));
    spun += spinNow;
  }
  // ドリフト中の速度の維持（アシスト）: 横滑りで失う分の一部をアクセルで補う
  // ドリフトの速さの目安を超えたら足さない（速いと大回りになって楽しくない）
  if (K > 0 && Math.abs(beta) > 0.2 && s.gas > 0.3 && s.vx > 5 && s.vx < (D.driftSpeed ?? 24)) {
    const keep = K * (D.driftKeep ?? 3.5) * s.gas * dt;
    const sp = Math.hypot(s.vx, s.vy) || 1;
    s.vx += (s.vx / sp) * keep;
    s.vy += (s.vy / sp) * keep;
  }
  s.ax = approach(s.ax, sumAx / SUBSTEPS, 0.08, dt);
  s.ay = approach(s.ay, sumAy / SUBSTEPS, 0.08, dt);
  s.slipF = slipFMax;
  s.slipR = s.handbrake && Math.abs(s.vx) > 1 ? 0.5 : slipRMax;
  s.wheelSpin = approach(s.wheelSpin, spun > 0 ? 1 : 0, 0.1, dt);

  // 位置の更新・路面・壁
  moveOnGround(def, s, env, dt, g0, opts);
  if (s.air) { finishAttitude(def, s, env, dt); return; }

  // 体勢（路面の傾き）
  const pitch = noSlope ? 0 : Math.atan(slopeF);
  const roll = noSlope ? 0 : -Math.atan(slopeR);
  s.theta = approach(s.theta, pitch, 0.1, dt);
  s.phi = approach(s.phi, roll, 0.1, dt);
  finishAttitude(def, s, env, dt);

  const speed = Math.hypot(s.vx, s.vy);
  s.airspeed = speed;
  s.g = 1 + Math.abs(s.ay) / G0;
  // 滑りの角度は後軸で見る（重心の角度は低速で大きく切っただけでも大きくなり、滑っていなくても点が入ってしまう）
  s.slide = Math.atan2(s.vy - (D.wheelBase * (D.weightFront ?? 0.5)) * s.r, Math.max(Math.abs(s.vx), 1));
  s.drift.update(Math.abs(s.slide) / DEG, speed, true, dt, env.emit);
  // 最後に安全だった場所（水に落ちたときの復帰先）
  s.safeT += dt;
  if (s.safeT > 1 && !terr.isWater(s.pos.x, s.pos.z) && Math.abs(slopeF) < 0.5 && Math.abs(slopeR) < 0.5) {
    s.safeT = 0;
    s.lastSafe = { x: s.pos.x, y: s.pos.y, z: s.pos.z, psi: s.psi };
  }
}

function gearbox(def, s, env, dt) {
  const D = def.p.drive;
  s.shiftT = Math.max(0, s.shiftT - dt);
  const v = Math.abs(s.vx) + s.wheelSpin * 6;
  if (!D.gears) {
    s.gear = 1;
    s.rpm = clamp(0.12 + v / (D.vTop ?? 90), 0.1, 1);
    return;
  }
  const wr = (v / D.wheelR) * (60 / (2 * Math.PI));
  let n = (wr * D.gears[s.gear - 1] * D.final) / D.rpmMax;
  if (s.gear < D.gears.length && n > 0.94 && s.gas > 0.1 && s.shiftT <= 0) {
    s.gear++;
    s.shiftT = 0.12;
    env.emit('shift', { gear: s.gear });
  } else if (s.gear > 1 && n < 0.42 && s.shiftT <= 0) {
    s.gear--;
    s.shiftT = 0.05;
  }
  n = (wr * D.gears[s.gear - 1] * D.final) / D.rpmMax;
  s.rpm = approach(s.rpm, clamp(0.13 + n * 0.87, 0.13, 1.02), 0.05, dt);
}

function driveForce(D, s) {
  if (s.gas <= 0) return 0;
  const v = Math.max(Math.abs(s.vx), 3);
  const boostP = s.nitroOn ? 1.5 : 1;
  if (!D.gears) return s.gas * Math.min(D.force, (D.power * boostP) / v);
  const ratio = D.gears[s.gear - 1] * D.final;
  const fmax = (D.torque * ratio) / D.wheelR;
  // レブリミッター（最上段で回り切ったら力が出ない）
  if (s.rpm >= 1.0 && s.gear === D.gears.length) return 0;
  return s.gas * Math.min(fmax, (D.power * boostP) / v);
}

function moveOnGround(def, s, env, dt, g0, opts) {
  const P = def.p;
  const D = P.drive;
  const terr = env.world.terrain;
  const cg = P.cgHeight;
  const R = P.bodyRadius || 1;
  s.psi += s.r * dt;
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  let vwx = fh.x * s.vx + rh.x * s.vy;
  let vwz = fh.z * s.vx + rh.z * s.vy;
  let nx = s.pos.x + vwx * dt;
  let nz = s.pos.z + vwz * dt;

  // ビル・壁: 跳ね返る（ゲームオーバーにしない）
  const hit = terr.buildingHit({ x: nx, y: g0 + R + 0.4, z: nz }, R);
  if (hit) {
    const ox = (nx - hit.x) / (hit.w / 2 + R);
    const oz = (nz - hit.z) / (hit.d / 2 + R);
    const nrm = Math.abs(ox) > Math.abs(oz) ? { x: Math.sign(ox), z: 0 } : { x: 0, z: Math.sign(oz) };
    const vn = vwx * nrm.x + vwz * nrm.z;
    if (vn < 0) {
      const e = 0.3;
      vwx -= (1 + e) * vn * nrm.x;
      vwz -= (1 + e) * vn * nrm.z;
      vwx *= 0.92; vwz *= 0.92;
      s.vx = vwx * fh.x + vwz * fh.z;
      s.vy = vwx * rh.x + vwz * rh.z;
      s.r *= 0.5;
      notifyHit(s, env, -vn);
    }
    if (nrm.x) nx = hit.x + nrm.x * (hit.w / 2 + R + 0.05);
    else nz = hit.z + nrm.z * (hit.d / 2 + R + 0.05);
    if (Math.abs(vn) < 3 && s.gas > 0.2 && !(env.t - (s.noticeT ?? -9) < 2)) {
      s.noticeT = env.t;
      env.emit('notice', { text: '進めません（ブレーキ長押しでバック）' });
    }
  }

  // 地形の端
  const lim = terr.half - 20;
  if (Math.abs(nx) > lim || Math.abs(nz) > lim) {
    const impact = Math.hypot(vwx, vwz);
    nx = clamp(nx, -lim, lim);
    nz = clamp(nz, -lim, lim);
    s.vx *= -0.3; s.vy *= 0.3;
    notifyHit(s, env, impact * 0.5);
  }

  const g1 = roadHeight(terr, nx, nz);
  if (terr.isWater(nx, nz) && terr.roofAt(nx, nz) === -Infinity && !D.hover) {
    if (opts.waterCrash) { env.crash('水に突っ込みました'); return; }
    carRecover(def, s, env, 'water');
    return;
  }
  const step = g1 - g0;
  // 急な段差（登れない壁）
  if (step > (D.maxStep ?? 0.6)) {
    const onRamp = terr.rampAt(nx, nz) >= g1 - 0.01;
    if (!onRamp) {
      const impact = Math.hypot(s.vx, s.vy);
      s.vx *= -0.3; s.vy *= -0.3;
      notifyHit(s, env, impact);
      return;
    }
  }
  const vyRoad = step / dt;
  const dvy = vyRoad - (s.vel.y || 0);
  // 路面が急に下がる（ジャンプ台の先・屋上の縁・尾根）: タイヤが浮く
  const speed = Math.hypot(s.vx, s.vy);
  if (step < -0.6 || (speed > 8 && dvy < -3)) {
    s.pos = { x: nx, y: s.pos.y + (s.vel.y || 0) * dt, z: nz };
    s.vel = { x: vwx, y: s.vel.y || 0, z: vwz };
    s.air = true;
    s.onGround = false;
    s.airT = 0;
    env.emit('carAir', {});
    return;
  }
  s.pos = { x: nx, y: g1 + cg, z: nz };
  s.vel = { x: vwx, y: clamp(vyRoad, -30, 30), z: vwz };
  s.onGround = true;
}

function notifyHit(s, env, impact) {
  if (impact < 2) return;
  env.emit('carHit', { impact });
  if (impact > 5) s.drift.cancel(env.emit);
}

/** 空中: 放物線。少しだけ向きを変えられる */
function stepAir(def, s, inp, env, dt, opts) {
  const P = def.p;
  const D = P.drive;
  const world = env.world;
  const terr = world.terrain;
  const rho = world.density(s.pos.y);
  const sp = vlen(s.vel);
  const k = (0.5 * rho * D.CdA * sp) / P.mass;
  s.vel = { x: s.vel.x - s.vel.x * k * dt, y: s.vel.y - G0 * dt - s.vel.y * k * dt, z: s.vel.z - s.vel.z * k * dt };
  s.pos = vadd(s.pos, vscale(s.vel, dt));
  s.airT = (s.airT || 0) + dt;
  s.airspeed = sp;
  s.g = 0;
  s.r = approach(s.r, inp.steer * 0.8, 0.5, dt);
  s.psi += s.r * dt;
  // 機首は飛んでいく向きへ少しずつ
  const hs = Math.hypot(s.vel.x, s.vel.z);
  s.theta = approach(s.theta, clamp(Math.atan2(s.vel.y, Math.max(hs, 5)), -0.6, 0.5), 0.5, dt);
  s.drift.update(0, sp, false, dt, env.emit);
  const g = roadHeight(terr, s.pos.x, s.pos.z);
  if (s.pos.y - P.cgHeight <= g) {
    if (terr.isWater(s.pos.x, s.pos.z) && terr.roofAt(s.pos.x, s.pos.z) === -Infinity && !D.hover) {
      if (opts.waterCrash) { env.crash('水に突っ込みました'); return; }
      carRecover(def, s, env, 'water');
      return;
    }
    const vs = s.vel.y;
    if (opts.fallCrash && vs < -P.landing.maxSink * 2) { env.crash(`落下の衝撃が大きすぎます（${(-vs).toFixed(1)} m/s）`); return; }
    const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
    const rh = { x: -fh.z, z: fh.x };
    s.vx = s.vel.x * fh.x + s.vel.z * fh.z;
    s.vy = s.vel.x * rh.x + s.vel.z * rh.z;
    s.air = false;
    s.onGround = true;
    s.pos.y = g + P.cgHeight;
    s.vel.y = 0;
    env.emit('touchdown', { vs, speed: Math.abs(s.vx), car: true, airTime: s.airT });
    if (vs < -7) env.emit('carHit', { impact: -vs * 0.8 });
  }
}

function finishAttitude(def, s, env, dt) {
  const D = def.p.drive;
  // 車体の沈み込み（描画用）: 加速で尻下がり、曲がると外へ傾く
  const k = D.bodyLean ?? 0.012;
  s.bodyPitch = approach(s.bodyPitch, clamp(s.ax * k, -0.12, 0.12), 0.12, dt);
  s.bodyRoll = approach(s.bodyRoll, clamp(-s.ay * k, -0.14, 0.14), 0.12, dt);
  s.spinAngle = (s.spinAngle + ((s.vx + s.wheelSpin * 25 * Math.sign(s.gas || 1)) / (D.wheelR || 0.33)) * dt) % (Math.PI * 2);
  s.q = quatFromAttitude(s.theta, s.phi, s.psi);
}

/** 「復帰」: 最後に安全だった場所へ戻す（立ち往生・水没のとき） */
export function carRecover(def, s, env, reason = 'button') {
  const terr = env.world.terrain;
  const safe = s.lastSafe;
  const y = roadHeight(terr, safe.x, safe.z) + def.p.cgHeight;
  s.pos = { x: safe.x, y, z: safe.z };
  s.psi = safe.psi;
  s.vx = 0; s.vy = 0; s.r = 0; s.steer = 0;
  s.vel = { x: 0, y: 0, z: 0 };
  s.theta = 0; s.phi = 0; s.air = false; s.onGround = true; s.rev = false; s.stopT = 0;
  s.drift.cancel(env.emit);
  s.q = quatFromAttitude(0, 0, s.psi);
  env.emit('carReset', { reason });
}

// ---------- 車（モデル 'car'） ----------
export function createCar(def, spawn) {
  const s = createCarState(def, spawn);
  s.kind = 'car';
  s.fuel = null;
  if (spawn.onGround === false) { s.air = true; s.onGround = false; }
  return s;
}

export function stepCar(def, s, ctl, env, dt) {
  const inp = carInput(ctl);
  if (def.p.drive.hover) { stepHover(def, s, inp, env, dt); return; }
  stepCarCore(def, s, inp, env, dt, { assist: env.carAssist });
}

/** sim の操作入力 → 車の入力。キーボードのピッチ（W/S）はペダルとしても効く */
export function carInput(ctl) {
  return {
    steer: ctl.roll,
    gas: Math.max(ctl.gas || 0, 0),
    brake: Math.max(ctl.brake || 0, 0),
    handbrake: !!ctl.handbrake,
    nitro: !!ctl.nitro,
  };
}

// ---------- ホバーカー: 浮いて進む（水の上も走れる。横滑りが大きい） ----------
function stepHover(def, s, inp, env, dt) {
  const P = def.p;
  const D = P.drive;
  const world = env.world;
  const terr = world.terrain;
  s.gas = approach(s.gas, inp.gas, 0.15, dt);
  s.brakeIn = approach(s.brakeIn, inp.brake, 0.1, dt);
  s.handbrake = !!inp.handbrake;
  s.throttle = s.gas;
  const wantNitro = !!inp.nitro && s.nitro > 0.02;
  if (wantNitro && !s.nitroOn) env.emit('nitro', {});
  s.nitroOn = wantNitro;
  if (s.nitroOn) s.nitro = Math.max(0, s.nitro - dt / D.nitro.time);
  else s.nitro = Math.min(1, s.nitro + dt * (s.drift.active ? 0.14 : 0.025));
  s.surface = terr.isWater(s.pos.x, s.pos.z) ? 'water' : terr.surfaceKind(s.pos.x, s.pos.z);

  const m = P.mass;
  const grad = terr.gradient(s.pos.x, s.pos.z, 8);
  const fh0 = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh0 = { x: -fh0.z, z: fh0.x };
  const slopeF = terr.isWater(s.pos.x, s.pos.z) ? 0 : grad.x * fh0.x + grad.z * fh0.z;
  const slopeR = terr.isWater(s.pos.x, s.pos.z) ? 0 : grad.x * rh0.x + grad.z * rh0.z;

  // 後退
  if (!s.rev) {
    if (s.brakeIn > 0.3 && Math.abs(s.vx) < 0.8 && s.gas < 0.05) s.stopT += dt; else s.stopT = 0;
    if (s.stopT > 0.35) { s.rev = true; s.stopT = 0; }
  } else if (s.gas > 0.1 || s.brakeIn < 0.1) s.rev = false;

  const v = Math.max(Math.abs(s.vx), 3);
  let F = s.gas * Math.min(D.force, (D.power * (s.nitroOn ? 1.5 : 1)) / v);
  if (s.rev) F = -s.brakeIn * D.reverse;
  if (s.nitroOn && !s.rev) F = F * D.nitro.boost + m * D.nitro.accel;
  s.thrust = F;
  const rho = world.density(s.pos.y);
  const drag = 0.5 * rho * D.CdA * s.vx * Math.abs(s.vx);
  const brakeA = s.rev ? 0 : s.brakeIn * D.brake;
  const lat = s.handbrake ? D.latDrag * 0.25 : D.latDrag;
  // 向き: 浮いているので向きは直接変わる（速いほど緩やか）
  const rT = inp.steer * D.maxYaw * (s.handbrake ? 1.5 : 1) * clamp(1.15 - Math.abs(s.vx) / 140, 0.5, 1);
  s.r = approach(s.r, rT, 0.22, dt);
  const ax = F / m - drag / m - G0 * Math.sin(Math.atan(slopeF));
  const ay = -G0 * Math.sin(Math.atan(slopeR));
  s.vx += (ax + s.r * s.vy) * dt;
  s.vy += (ay - s.r * s.vx) * dt;
  s.vy *= Math.exp(-lat * dt);
  if (brakeA > 0) {
    const dv = Math.min(Math.abs(s.vx), brakeA * dt);
    s.vx -= Math.sign(s.vx) * dv;
  }
  s.ax = approach(s.ax, ax, 0.1, dt);
  s.ay = approach(s.ay, s.r * s.vx, 0.1, dt);
  s.beta = Math.atan2(s.vy, Math.max(Math.abs(s.vx), 3));
  s.slipF = 0;
  s.slipR = Math.abs(s.beta);
  s.psi += s.r * dt;
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  let vwx = fh.x * s.vx + rh.x * s.vy;
  let vwz = fh.z * s.vx + rh.z * s.vy;
  let nx = s.pos.x + vwx * dt;
  let nz = s.pos.z + vwz * dt;
  const g0 = Math.max(terr.surfaceAt(s.pos.x, s.pos.z), terr.roofAt(s.pos.x, s.pos.z));
  const hit = terr.buildingHit({ x: nx, y: g0 + 2, z: nz }, P.bodyRadius);
  if (hit) {
    const ox = (nx - hit.x) / (hit.w / 2 + P.bodyRadius);
    const oz = (nz - hit.z) / (hit.d / 2 + P.bodyRadius);
    const nrm = Math.abs(ox) > Math.abs(oz) ? { x: Math.sign(ox), z: 0 } : { x: 0, z: Math.sign(oz) };
    const vn = vwx * nrm.x + vwz * nrm.z;
    if (vn < 0) {
      vwx -= 1.4 * vn * nrm.x; vwz -= 1.4 * vn * nrm.z;
      s.vx = vwx * fh.x + vwz * fh.z;
      s.vy = vwx * rh.x + vwz * rh.z;
      notifyHit(s, env, -vn);
    }
    if (nrm.x) nx = hit.x + nrm.x * (hit.w / 2 + P.bodyRadius + 0.05);
    else nz = hit.z + nrm.z * (hit.d / 2 + P.bodyRadius + 0.05);
  }
  const lim = terr.half - 20;
  if (Math.abs(nx) > lim || Math.abs(nz) > lim) {
    nx = clamp(nx, -lim, lim); nz = clamp(nz, -lim, lim);
    s.vx *= -0.3; s.vy *= 0.3;
    notifyHit(s, env, 5);
  }
  const g1 = Math.max(terr.surfaceAt(nx, nz), terr.roofAt(nx, nz));
  const targetY = g1 + P.cgHeight;
  const prevY = s.pos.y;
  // 地面に沿って浮く（ばねのように遅れて追う）
  const y = targetY > prevY + 1.5 ? targetY - 1.5 : approach(prevY, targetY, 0.18, dt);
  s.pos = { x: nx, y, z: nz };
  s.vel = { x: vwx, y: (y - prevY) / dt, z: vwz };
  s.onGround = true;
  s.air = false;
  s.theta = approach(s.theta, Math.atan(slopeF) + clamp(ax * 0.006, -0.06, 0.06), 0.25, dt);
  s.phi = approach(s.phi, -Math.atan(slopeR) + clamp(s.r * s.vx * 0.012, -0.45, 0.45), 0.2, dt);
  s.q = quatFromAttitude(s.theta, s.phi, s.psi);
  s.bodyPitch = 0; s.bodyRoll = 0;
  const speed = Math.hypot(s.vx, s.vy);
  s.airspeed = speed;
  s.g = 1 + Math.abs(s.ay) / G0;
  s.rpm = clamp(0.2 + s.gas * 0.5 + speed / 200, 0.1, 1);
  s.gear = 1;
  s.drift.update(Math.abs(Math.atan2(s.vy, Math.max(Math.abs(s.vx), 1))) / DEG, speed, true, dt, env.emit);
  s.safeT += dt;
  if (s.safeT > 1) { s.safeT = 0; s.lastSafe = { x: s.pos.x, y: s.pos.y, z: s.pos.z, psi: s.psi }; }
}
