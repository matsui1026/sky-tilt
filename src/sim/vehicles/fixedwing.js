// 共通の簡易空力モデル（固定翼機）
// 揚力 L = ½ρV²S·CL(α)、抗力 D = ½ρV²S·CD、推力、重力、迎角による失速。
// 角運動は「迎角コマンド」方式: ピッチ入力は目標迎角（＝荷重倍数）を指令し、
// 機首は速度ベクトルの回転＋迎角誤差の補正で回る。ニュートラルで 1G（経路保持）。
import {
  G0, DEG, clamp, lerp, smoothstep, approach,
  vadd, vsub, vscale, vdot, vcross, vlen, vnorm, qrot, qrotInv, qintegrateBody, qmul, qaxis,
  FWD, UP, RIGHT, attitudeOf, quatFromAttitude,
} from '../math.js';

const ZAX = { x: 0, y: 0, z: 1 };

export function liftCoef(P, alpha, flapPos) {
  const fl = P.flaps;
  const aS = P.alphaStall + (fl ? flapPos * fl.dAlphaStall : 0);
  const aN = P.alphaStallNeg;
  const cl0 = P.CL0 + (fl ? flapPos * fl.dCL : 0);
  const lin = cl0 + P.CLa * alpha;
  const plate = 1.25 * Math.sin(2 * alpha);
  if (alpha > aS) {
    const clmax = cl0 + P.CLa * aS;
    const post = lerp(clmax * 0.72, plate, smoothstep(aS + 4 * DEG, aS + 22 * DEG, alpha));
    const s = smoothstep(aS, aS + 3 * DEG, alpha);
    return { CL: lerp(clmax, post, s), stall: s, aS, cl0 };
  }
  if (alpha < aN) {
    const clmin = cl0 + P.CLa * aN;
    const post = lerp(clmin * 0.72, plate, smoothstep(-aN + 4 * DEG, -aN + 22 * DEG, -alpha));
    const s = smoothstep(-aN, -aN + 3 * DEG, -alpha);
    return { CL: lerp(clmin, post, s), stall: s, aS, cl0 };
  }
  return { CL: lin, stall: 0, aS, cl0 };
}

export function dragCoef(P, CL, alpha, stall, s, mach) {
  let CD = P.CD0 + P.k * CL * CL + 1.3 * stall * Math.sin(alpha) ** 2;
  if (P.flaps) CD += s.flapPos * P.flaps.dCD;
  if (P.gear && P.gear.retractable) CD += s.gearPos * P.gear.dCD;
  if (P.spoiler) CD += s.spoilerPos * P.spoiler.dCD;
  if (P.waveDrag) CD += P.waveDrag * smoothstep(0.82, 1.0, mach) * (1 - 0.4 * smoothstep(1.2, 1.8, mach));
  return CD;
}

/** 失速速度（1G、水平飛行、海面） */
export function stallSpeed(P, flapPos = 0, rho = 1.225) {
  const fl = P.flaps;
  const aS = P.alphaStall + (fl ? flapPos * fl.dAlphaStall : 0);
  const clmax = P.CL0 + (fl ? flapPos * fl.dCL : 0) + P.CLa * aS;
  return Math.sqrt((2 * P.mass * G0) / (rho * P.S * clmax));
}

export function createFixedWing(def, spawn) {
  const P = def.p;
  const onGround = !!spawn.onGround;
  const q = quatFromAttitude(spawn.pitch || 0, 0, spawn.heading || 0);
  const fwd = qrot(q, FWD);
  const speed = spawn.speed || 0;
  return {
    kind: 'fixedwing',
    pos: { ...spawn.pos },
    vel: vscale(fwd, speed),
    q,
    p: 0, qr: 0, r: 0,
    throttle: spawn.throttle ?? 0,
    flapPos: spawn.flaps ?? def.initialFlaps ?? 0,
    gearPos: spawn.gear === false ? 0 : 1,
    gearCmd: spawn.gear === false ? 0 : 1,
    spoilerPos: 0,
    ab: false,
    onGround,
    alpha: 0, beta: 0, g: 1, stall: 0, stallWarn: false, airspeed: speed,
    aFloor: false,
    touchdown: null,
    airTime: onGround ? 0 : 99,
    landedEmitted: false,
    liftoffSpeed: null,
  };
}

/**
 * ctl: { pitch, roll, yaw, throttle, flaps, gear, spoiler, ab }
 * env: { world, t, emit(type, data), crash(cause) }
 */
export function stepFixedWing(def, s, ctl, env, dt) {
  const P = def.p;
  const world = env.world;
  const terrain = world.terrain;
  const m = P.mass;

  // ---- 操作系の作動（スプール・フラップ・ギア）----
  const spool = P.thrust.type === 'prop' ? 0.25 : def.id === 'airliner' ? 1.8 : 0.7;
  let thrCmd = clamp(ctl.throttle, 0, 1);
  if (s.aFloor) thrCmd = 1;
  s.throttle = approach(s.throttle, thrCmd, spool, dt);
  if (P.flaps) {
    const target = clamp(Math.round(ctl.flaps ?? 0), 0, P.flaps.notches);
    s.flapPos += clamp(target - s.flapPos, -0.35 * dt, 0.35 * dt);
  }
  if (P.gear && P.gear.retractable) {
    s.gearCmd = ctl.gear ? 1 : 0;
    if (s.onGround) s.gearCmd = 1; // 地上ではギアを上げられない
    s.gearPos += clamp(s.gearCmd - s.gearPos, -0.25 * dt, 0.25 * dt);
  }
  if (P.spoiler) s.spoilerPos = approach(s.spoilerPos, ctl.spoiler ? 1 : 0, 0.4, dt);
  s.ab = !!(P.thrust.ab && ctl.ab && s.throttle > 0.85);

  // ---- 空力 ----
  const air = world.airVelocity(s.pos, env.t);
  const va = vsub(s.vel, air);
  const V = vlen(va);
  const vb = qrotInv(s.q, va);
  const u = -vb.z;
  const alpha = V > 0.5 ? Math.atan2(-vb.y, u) : 0;
  const beta = V > 0.5 ? Math.asin(clamp(vb.x / V, -1, 1)) : 0;
  const rho = world.density(s.pos.y);
  const qbar = 0.5 * rho * V * V;
  const mach = V / 340;
  const lc = liftCoef(P, alpha, s.flapPos);
  let CL = lc.CL;
  if (P.spoiler) CL *= lerp(1, s.onGround ? P.spoiler.liftFactorGround : P.spoiler.liftFactorAir, s.spoilerPos);
  const CD = dragCoef(P, CL, alpha, lc.stall, s, mach);

  const right = qrot(s.q, RIGHT);
  const upB = qrot(s.q, UP);
  const fwd = qrot(s.q, FWD);
  const airDir = V > 0.5 ? vscale(va, 1 / V) : fwd;
  let liftDir = vcross(right, airDir);
  const ll = vlen(liftDir);
  liftDir = ll > 1e-6 ? vscale(liftDir, 1 / ll) : upB;
  const sideDir = vnorm(vcross(airDir, liftDir));

  const L = qbar * P.S * CL;
  const D = qbar * P.S * CD;
  const Y = -qbar * P.S * P.CYb * beta;
  const sigma = rho / 1.225;
  let T;
  if (P.thrust.type === 'prop') {
    T = s.throttle * Math.min(P.thrust.static, P.thrust.power / Math.max(V, 1)) * sigma;
  } else {
    T = (s.throttle * P.thrust.mil + (s.ab ? P.thrust.ab - P.thrust.mil : 0)) * Math.pow(sigma, 0.75);
  }
  let F = vscale(liftDir, L);
  F = vadd(F, vscale(airDir, -D));
  F = vadd(F, vscale(sideDir, Y));
  F = vadd(F, vscale(fwd, T));
  const Faero = F;
  F = vadd(F, { x: 0, y: -m * G0, z: 0 });

  s.alpha = alpha;
  s.beta = beta;
  s.stall = lc.stall;
  s.stallWarn = alpha > lc.aS - 2.5 * DEG && V > 5 && !s.onGround;
  s.airspeed = V;
  s.g = vdot(Faero, upB) / (m * G0);
  s.thrust = T;

  const att = attitudeOf(s.q);
  const eff = clamp(qbar / P.qRef, 0, 1);

  if (s.onGround) {
    stepGround(def, s, ctl, env, dt, F, V, att, air);
    return;
  }

  // ---- 角運動（空中）----
  s.airTime += dt;
  const acc = vscale(F, 1 / m);
  const Vs = Math.max(V, 3);
  const pathPitchRate = vdot(acc, liftDir) / Vs;
  const pathYawRate = vdot(acc, sideDir) / Vs;
  const bank = att.roll;
  const gamma = Math.asin(clamp(airDir.y, -1, 1));

  // ロール
  const R = P.roll;
  let pCmd;
  if (R.bankCmd) {
    // 練習機: 傾け量 → 目標バンク角（傾けたまま持てばそのバンク角で安定し、戻せば水平に戻る）
    const lim = R.maxRate * Math.max(eff, 0.15);
    pCmd = clamp(R.bankGain * (ctl.roll * R.bankCmd - bank), -lim, lim);
  } else {
    pCmd = ctl.roll * R.maxRate * eff;
    if (R.autoLevel && Math.abs(ctl.roll) < 0.02 && Math.abs(bank) < 80 * DEG) pCmd += -R.autoLevel * bank;
  }
  const fbw = P.fbw;
  if (fbw) {
    if (Math.abs(ctl.roll) < 0.05 && Math.abs(bank) > fbw.bankNeutral) {
      pCmd = -Math.sign(bank) * Math.min(fbw.rollBackRate, (Math.abs(bank) - fbw.bankNeutral) * 1.0);
    }
    const margin = 10 * DEG;
    if (Math.sign(pCmd) === Math.sign(bank) && Math.abs(bank) > fbw.bankLimit - margin) {
      pCmd *= clamp((fbw.bankLimit - Math.abs(bank)) / margin, 0, 1);
    }
  }
  if (lc.stall > 0 && P.stallRollKick) {
    const sgn = Math.abs(beta) > 0.5 * DEG ? Math.sign(beta) : Math.sin(env.t * 0.9 + 1) >= 0 ? 1 : -1;
    pCmd += P.stallRollKick * lc.stall * sgn;
  }
  s.p = approach(s.p, pCmd, R.tau, dt);

  // ピッチ（迎角コマンド）
  const Pp = P.pitch;
  const absBank = Math.abs(bank);
  // 旋回補正: バンク中も経路を保つ荷重 1/cosφ（60°まで）。それ以上は 1G に戻す
  const turnN = lerp(1 / Math.cos(Math.min(absBank, 60 * DEG)), 1, smoothstep(60 * DEG, 80 * DEG, absBank));
  const nTrim = Math.cos(gamma) * (1 + Pp.turnComp * (turnN - 1));
  const qS = Math.max(qbar * P.S, 1);
  const alphaTrim = clamp((nTrim * m * G0 / qS - lc.cl0) / P.CLa, Pp.alphaMinCmd, Math.min(lc.aS * 0.85, Pp.alphaMaxCmd));
  let alphaCmd = ctl.pitch >= 0
    ? alphaTrim + ctl.pitch * (Pp.alphaMaxCmd - alphaTrim)
    : alphaTrim + ctl.pitch * (alphaTrim - Pp.alphaMinCmd);
  if (P.gLimit) {
    const aMaxG = alphaForLoad(P, s, P.gLimit.pos, qS, mach);
    const aMinG = alphaForLoad(P, s, P.gLimit.neg, qS, mach);
    alphaCmd = clamp(alphaCmd, aMinG, aMaxG);
  }
  if (fbw) alphaCmd = Math.min(alphaCmd, fbw.alphaProt);
  let qDes = pathPitchRate + eff * (alphaCmd - alpha) / Pp.tauAlpha;
  if (fbw) {
    // ピッチレートの遅れ（tauRate）を見込んだ予測姿勢で制限する（行き過ぎ防止）
    const pm = 3 * DEG;
    const th = att.pitch + s.qr * Pp.tauRate;
    if (th > fbw.pitchMax - pm && qDes > 0) qDes *= clamp((fbw.pitchMax - th) / pm, 0, 1);
    if (th > fbw.pitchMax) qDes = Math.min(qDes, (fbw.pitchMax - th) * 1.5);
    if (th < fbw.pitchMin + pm && qDes < 0) qDes *= clamp((th - fbw.pitchMin) / pm, 0, 1);
    if (th < fbw.pitchMin) qDes = Math.max(qDes, (fbw.pitchMin - th) * 1.5);
    // アルファフロア（失速保護の自動推力）
    if (alpha > fbw.alphaFloor && V > 20) s.aFloor = true;
    else if (alpha < fbw.alphaFloor - 3 * DEG) s.aFloor = false;
  }
  qDes = clamp(qDes, -Pp.maxRate * 1.5, Pp.maxRate * 1.5);
  // 失速中は舵が効かず機首が落ちる（速度ベクトルに沿う）
  s.qr = approach(s.qr, qDes, Pp.tauRate, dt);

  // ヨー（横滑りコマンド + 釣り合い旋回）
  const Yw = P.yaw;
  const betaCmd = -ctl.yaw * Yw.betaMax;
  const rDes = pathYawRate + eff * (beta - betaCmd) / Yw.tauBeta;
  s.r = approach(s.r, rDes, 0.15, dt);

  // ---- 積分 ----
  s.vel = vadd(s.vel, vscale(acc, dt));
  s.pos = vadd(s.pos, vscale(s.vel, dt));
  s.q = qintegrateBody(s.q, { x: s.qr, y: -s.r, z: -s.p }, dt);

  // FBW のバンク角ハードリミット
  if (fbw) {
    const a2 = attitudeOf(s.q);
    if (Math.abs(a2.roll) > fbw.bankLimit) {
      const over = Math.abs(a2.roll) - fbw.bankLimit;
      s.q = qmul(s.q, qaxis(ZAX, Math.sign(a2.roll) * over));
      if (Math.sign(s.p) === Math.sign(a2.roll)) s.p = 0;
    }
  }

  // ---- 接地・衝突 ----
  const ground = terrain.surfaceAt(s.pos.x, s.pos.z);
  const gH = P.ground.gearHeight;
  const up2 = qrot(s.q, UP);
  const gearBottom = s.pos.y - gH * Math.max(up2.y, 0);
  const bodyBottom = s.pos.y - P.bodyRadius;
  if (gearBottom <= ground || bodyBottom <= ground) {
    touchdown(def, s, env, ground);
  }
  if (!s.crashed && terrain.buildingHit(s.pos, P.bodyRadius * 2)) env.crash('ビルに衝突');
}

function alphaForLoad(P, s, n, qS, mach) {
  // 法線力係数 CN = CL cosα + CD sinα が n·mg/(qS) になる迎角（2 回のニュートン反復）
  const target = (n * P.mass * G0) / qS;
  let a = (target - (P.CL0 + (P.flaps ? s.flapPos * P.flaps.dCL : 0))) / P.CLa;
  for (let i = 0; i < 2; i++) {
    const lc = liftCoef(P, a, s.flapPos);
    const cd = dragCoef(P, lc.CL, a, lc.stall, s, mach);
    const cn = lc.CL * Math.cos(a) + cd * Math.sin(a);
    a += (target - cn) / P.CLa;
  }
  return a;
}

function touchdown(def, s, env, ground) {
  const P = def.p;
  const terrain = env.world.terrain;
  const att = attitudeOf(s.q);
  const surface = terrain.surfaceType(s.pos.x, s.pos.z);
  const slope = terrain.slopeAt(s.pos.x, s.pos.z);
  const vs = s.vel.y;
  const gs = Math.hypot(s.vel.x, s.vel.z);
  const G = P.ground;
  let cause = null;
  if (surface === 'water') cause = '着水しました';
  else if (P.gear && P.gear.retractable && s.gearPos < 0.95) cause = 'ギアが出ていません（胴体着陸）';
  else if (s.airspeed > 2.2 * stallSpeed(P, s.flapPos)) cause = `速度超過のまま接地（${Math.round(s.airspeed * 3.6)} km/h）`;
  else if (vs < -G.maxSink) cause = `降下率が大きすぎます（${(-vs).toFixed(1)} m/s）`;
  else if (Math.abs(att.roll) > G.maxBank) cause = '翼端が地面に接触';
  else if (att.pitch < -3 * DEG) cause = '機首から接地';
  else if (att.pitch > G.tailStrike + 2 * DEG) cause = '尾部が地面に接触';
  else if (slope > 7 * DEG) cause = '地形に衝突';
  if (cause) {
    env.crash(cause);
    return;
  }
  s.onGround = true;
  s.pos.y = ground + G.gearHeight;
  s.vel.y = 0;
  s.p = 0; s.r = 0;
  // 短時間のバウンドは最初の接地を評価に使う
  if (s.touchdown && s.airTime < 3) return;
  s.touchdown = { vs, speed: gs, airspeed: s.airspeed, flaps: Math.round(s.flapPos), surface, x: s.pos.x, z: s.pos.z, pitch: att.pitch, bank: att.roll, t: env.t };
  env.emit('touchdown', s.touchdown);
}

function stepGround(def, s, ctl, env, dt, F, V, att, air) {
  const P = def.p;
  const G = P.ground;
  const m = P.mass;
  const terrain = env.world.terrain;
  // 揚力が重量を超えたら離陸
  if (F.y > 0 && V > G.rotateSpeed * 0.85) {
    s.onGround = false;
    if (s.liftoffSpeed == null) s.liftoffSpeed = V;
    s.airTime = 0;
    s.landedEmitted = false;
    env.emit('liftoff', { speed: V });
    s.vel = vadd(s.vel, vscale(F, dt / m));
    s.pos = vadd(s.pos, vscale(s.vel, dt));
    return;
  }
  const N = Math.max(0, -F.y); // 垂直抗力
  const acc = { x: F.x / m, y: 0, z: F.z / m };
  s.vel = vadd(s.vel, vscale(acc, dt));
  s.vel.y = 0;

  // タイヤ: 前後は転がり抵抗＋ブレーキ、横方向は強いグリップ
  const fh = vnorm({ x: Math.sin(att.heading), y: 0, z: -Math.cos(att.heading) });
  const rh = { x: -fh.z, y: 0, z: fh.x };
  let vl = vdot(s.vel, fh);
  let vlat = vdot(s.vel, rh);
  const braking = ctl.throttle < 0.05;
  let decel = 0.025 * N / m;
  if (braking) decel += G.brake * (N / (m * G0));
  if (P.spoiler && s.spoilerPos > 0.5) decel += P.spoiler.brakeGround * s.spoilerPos;
  const dv = Math.min(Math.abs(vl), decel * dt);
  vl -= Math.sign(vl) * dv;
  vlat *= Math.exp(-dt / 0.15);
  s.vel = { x: fh.x * vl + rh.x * vlat, y: 0, z: fh.z * vl + rh.z * vlat };
  s.pos = vadd(s.pos, vscale(s.vel, dt));

  // 姿勢: ピッチは機首上げ（ローテーション）のみ、ロールは水平、ヨーは前輪ステアリング
  const gs = Math.abs(vl);
  const vlong = -qrotInv(s.q, vsub(s.vel, air)).z;
  const authority = clamp((vlong - G.rotateSpeed) / 6, 0, 1);
  let theta = att.pitch;
  let thetaRate;
  if (ctl.pitch > 0.05 && authority > 0) thetaRate = ctl.pitch * G.rotateRate * authority;
  else thetaRate = -Math.min(3 * DEG, theta / Math.max(dt, 1e-3)) * (theta > 0 ? 1 : 0);
  theta = clamp(theta + thetaRate * dt, 0, G.tailStrike);
  s.qr = thetaRate;
  const steer = clamp(ctl.yaw + ctl.roll * 0.6, -1, 1);
  const yawRate = (steer * G.steerRate * clamp(gs / 4, 0, 1)) / (1 + gs / 40);
  const heading = att.heading + yawRate * dt;
  s.q = quatFromAttitude(theta, 0, heading);
  s.p = 0; s.r = yawRate;

  const ground = terrain.surfaceAt(s.pos.x, s.pos.z);
  s.pos.y = ground + G.gearHeight;
  const surface = terrain.surfaceType(s.pos.x, s.pos.z);
  if (surface === 'water') { env.crash('水面に突っ込みました'); return; }
  if (terrain.slopeAt(s.pos.x, s.pos.z) > 10 * DEG && gs > 3) { env.crash('地形に衝突'); return; }
  if (terrain.buildingHit(s.pos, P.bodyRadius * 2)) { env.crash('ビルに衝突'); return; }

  if (s.touchdown && !s.landedEmitted && gs < 1.5) {
    s.landedEmitted = true;
    env.emit('landed', { ...s.touchdown, stopX: s.pos.x, stopZ: s.pos.z });
  }
}
