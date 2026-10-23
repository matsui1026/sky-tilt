// 空飛ぶスポーツカー: 走行モード（地面を走る車）と飛行モード（4 つのダクトファンで飛ぶ）を切り替える。
// 走行: 駆動力・空気抵抗・転がり抵抗・坂の重力、前輪の舵角からヨーレート（横グリップ上限あり）。
// 飛行: ドローンと同じ姿勢コマンド（傾けた方向に車体が傾き、推力の向きが変わる）。
import { G0, DEG, clamp, approach, smoothstep, vadd, vsub, vscale, vlen, qrot, UP, quatFromAttitude } from '../math.js';
import { heliSurface, landingCheck } from './heli.js';

export function flycarHoverThrottle(P, rho = 1.225) {
  return (P.mass * G0) / (P.fly.thrustMax * (rho / 1.225));
}

export function createFlycar(def, spawn) {
  const hd = spawn.heading || 0;
  const sp = spawn.speed || 0;
  const mode = spawn.onGround ? 'drive' : 'fly';
  return {
    kind: 'flycar',
    mode,
    pos: { ...spawn.pos },
    vel: { x: Math.sin(hd) * sp, y: 0, z: -Math.cos(hd) * sp },
    v: spawn.onGround ? sp : 0, // 走行中の前後速度
    psi: hd, theta: 0, phi: 0, yawRate: 0, steer: 0,
    q: quatFromAttitude(0, 0, hd),
    throttle: spawn.throttle ?? 0,
    fanRpm: mode === 'fly' ? 1 : 0,
    fuel: 1,
    onGround: !!spawn.onGround,
    touchdown: null, landedEmitted: false, airTime: spawn.onGround ? 0 : 99,
    g: 1, airspeed: sp, thrust: 0,
  };
}

/** モード切替。飛行 → 走行は接地中のみ */
export function flycarToggleMode(def, s, env) {
  if (s.mode === 'drive') {
    s.mode = 'fly';
    s.airborne = false;
    env.emit('carMode', { mode: 'fly' });
    return 'fly';
  }
  if (!s.onGround) {
    env.emit('notice', { text: '着地してから走行モードに切り替えてください' });
    return 'fly';
  }
  // 走行へ: 車体の向きの前後速度を引き継ぐ
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  s.v = s.vel.x * fh.x + s.vel.z * fh.z;
  s.mode = 'drive';
  s.theta = 0; s.phi = 0;
  env.emit('carMode', { mode: 'drive' });
  return 'drive';
}

export function stepFlycar(def, s, ctl, env, dt) {
  const P = def.p;
  const world = env.world;
  const terr = world.terrain;
  const empty = s.fuel <= 0;
  s.throttle = approach(s.throttle, empty ? 0 : clamp(ctl.throttle, 0, 1), s.mode === 'fly' ? 0.15 : 0.08, dt);
  s.fanRpm = approach(s.fanRpm, s.mode === 'fly' ? 1 : 0, 0.8, dt);
  s.fuel = Math.max(0, s.fuel - (s.throttle * (s.mode === 'fly' ? 1 : 0.2) / P.battery.burnTime) * dt);
  if (s.fuel <= 0 && !s.fuelOut) { s.fuelOut = true; env.emit('fuelout', {}); }
  if (s.mode === 'drive') (s.airborne ? stepJump : stepDrive)(def, s, ctl, env, dt);
  else stepFly(def, s, ctl, env, dt);
  if (!s.crashed && !s.onGround && terr.buildingHit(s.pos, P.cgHeight * 0.9)) env.crash('ビルに衝突');
}

function stepDrive(def, s, ctl, env, dt) {
  const P = def.p;
  const D = P.drive;
  const world = env.world;
  const terr = world.terrain;
  const m = P.mass;
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  const g = terr.gradient(s.pos.x, s.pos.z, 2);
  const slopeF = g.x * fh.x + g.z * fh.z;
  const slopeR = g.x * rh.x + g.z * rh.z;
  const pitch = Math.atan(slopeF);
  const roll = -Math.atan(slopeR);
  const rho = world.density(s.pos.y);
  const v = s.v;
  // アクセル・ブレーキ（手前に引く）・後退（止まってから手前に引き続ける）
  // モーター: 低速では最大駆動力、高速では出力（パワー）で頭打ち
  let F = s.throttle * Math.min(D.force, D.power / Math.max(Math.abs(v), 1));
  const pull = Math.max(0, ctl.pitch);
  let brakeDecel = 0;
  // 止まってからさらに 1 秒ブレーキを保つと後退（止まった瞬間にバックしないように）
  if (pull > 0.3 && Math.abs(v) <= 0.5 && s.throttle < 0.05) s.stopT = (s.stopT || 0) + dt; else if (pull <= 0.3 || v > 0.5) s.stopT = 0;
  if (pull > 0.1 && v > 0.5) brakeDecel = pull * D.brake;
  else if (s.stopT > 1.0) F = -pull * D.reverse;
  if (ctl.throttle < 0.03 && pull <= 0.1) brakeDecel += Math.abs(v) < 1 ? 3 : 0.4; // エンジンブレーキ・停止保持
  if (pull > 0.1 && v > -0.5 && s.stopT <= 1.0) brakeDecel = Math.max(brakeDecel, Math.abs(v) < 0.6 ? 6 : 0); // 停止中はその場に保持
  const drag = 0.5 * rho * D.CdA * v * Math.abs(v);
  let a = (F - drag) / m - D.rolling * G0 * Math.sign(v) - G0 * Math.sin(pitch);
  let nv = v + a * dt;
  if (brakeDecel > 0) {
    const dv = Math.min(Math.abs(nv), brakeDecel * dt);
    nv -= Math.sign(nv) * dv;
  }
  s.v = nv;
  // ステアリング（速度が上がるほど切れ角を小さく）
  const steerT = ctl.roll * D.maxSteer / (1 + Math.abs(nv) / 25);
  s.steer = approach(s.steer, steerT, 0.12, dt);
  let r = (nv / D.wheelBase) * Math.tan(s.steer);
  const rMax = D.gripLat / Math.max(Math.abs(nv), 1);
  r = clamp(r, -rMax, rMax);
  s.yawRate = r;
  s.psi += r * dt;
  // 路面はビルの屋上も含む（屋上に着地してそのまま走れる）
  const g0 = heliSurface(world, s.pos.x, s.pos.z);
  const nx = s.pos.x + Math.sin(s.psi) * nv * dt;
  const nz = s.pos.z - Math.cos(s.psi) * nv * dt;
  const g1 = heliSurface(world, nx, nz);
  const onRoof = terr.roofAt(nx, nz) >= terr.surfaceAt(nx, nz);
  // 急斜面・水・ビルの壁（1 ステップで 0.6 m 以上の段差は壁）
  const steep = !onRoof && Math.hypot(g.x, g.z) > Math.tan(32 * DEG);
  if (!onRoof && terr.isWater(nx, nz)) { env.crash('水に突っ込みました'); return; }
  const wall = g1 - g0 > 0.6;
  if (wall || (steep && slopeF > 0 && nv > 0)) {
    if (Math.abs(nv) > 12) { env.crash(steep ? '急斜面に激突' : 'ビルに激突'); return; }
    s.v = 0;
    // 押し付けている間ずっと出さない（2 秒に 1 回）
    if (!(env.t - (s.noticeT ?? -9) < 2)) { s.noticeT = env.t; env.emit('notice', { text: '進めません' }); }
    s.vel = { x: 0, y: 0, z: 0 };
  } else {
    const vyRoad = (g1 - g0) / dt;
    // 路面の下がり方が重力で落ちるより急なら（屋上の縁・尾根の頂上）、タイヤが浮いて飛び出す
    const needAy = (vyRoad - (s.vel.y || 0)) / dt;
    if (g1 < g0 - 0.6 || (Math.abs(nv) > 8 && needAy < -G0)) {
      s.pos = { x: nx, y: s.pos.y + (s.vel.y || 0) * dt, z: nz };
      s.vel = { x: Math.sin(s.psi) * s.v, y: s.vel.y || 0, z: -Math.cos(s.psi) * s.v };
      s.onGround = false;
      s.airborne = true;
      return;
    }
    s.pos = { x: nx, y: g1 + P.cgHeight, z: nz };
    s.vel = { x: Math.sin(s.psi) * s.v, y: vyRoad, z: -Math.cos(s.psi) * s.v };
  }
  if (onRoof) { s.theta = 0; s.phi = 0; } else { s.theta = pitch; s.phi = roll; }
  s.q = quatFromAttitude(s.theta, s.phi, s.psi);
  s.onGround = true;
  s.airspeed = Math.abs(s.v);
  s.g = 1 + (Math.abs(s.v * r)) / G0;
  s.thrust = F;
}

/** 走行中に段差・尾根から飛び出したとき: 放物線で落ちて、着地で走行に戻る（強く落ちたら墜落） */
function stepJump(def, s, ctl, env, dt) {
  const P = def.p;
  const world = env.world;
  const rho = world.density(s.pos.y);
  const sp = vlen(s.vel);
  const k = (0.5 * rho * P.drive.CdA * sp) / P.mass;
  s.vel = { x: s.vel.x - s.vel.x * k * dt, y: s.vel.y - G0 * dt - s.vel.y * k * dt, z: s.vel.z - s.vel.z * k * dt };
  s.pos = vadd(s.pos, vscale(s.vel, dt));
  s.airspeed = sp;
  s.g = 0;
  s.q = quatFromAttitude(s.theta, s.phi, s.psi);
  const g = heliSurface(world, s.pos.x, s.pos.z);
  if (s.pos.y - P.cgHeight <= g) {
    if (world.terrain.isWater(s.pos.x, s.pos.z) && world.terrain.roofAt(s.pos.x, s.pos.z) === -Infinity) { env.crash('水に突っ込みました'); return; }
    if (s.vel.y < -P.landing.maxSink * 2) { env.crash(`落下の衝撃が大きすぎます（${(-s.vel.y).toFixed(1)} m/s）`); return; }
    const vs = s.vel.y;
    s.airborne = false;
    s.onGround = true;
    s.pos.y = g + P.cgHeight;
    s.vel.y = 0;
    env.emit('touchdown', { vs, speed: Math.abs(s.v) });
  }
}
function stepFly(def, s, ctl, env, dt) {
  const P = def.p;
  const Fp = P.fly;
  const world = env.world;
  const m = P.mass;
  const A = Fp.att;
  let thT = ctl.pitch * A.maxPitch;
  let phT = ctl.roll * A.maxRoll;
  if (s.onGround) { thT = 0; phT = 0; }
  s.theta = approach(s.theta, thT, A.tau, dt);
  s.phi = approach(s.phi, phT, A.tau, dt);

  const air = world.airVelocity(s.pos, env.t);
  const va = vsub(s.vel, air);
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  const vlong = va.x * fh.x + va.z * fh.z;
  const vlat = va.x * rh.x + va.z * rh.z;
  const beta = Math.atan2(vlat, Math.max(Math.abs(vlong), 1));
  const Y = Fp.yaw;
  const bankTurn = vlong > 5 ? (G0 * Math.tan(s.phi)) / Math.max(vlong, 8) : 0;
  let rT = ctl.yaw * Y.maxRate + bankTurn * 0.7 + Y.weathervane * beta * smoothstep(8, 30, vlong);
  if (s.onGround) rT = ctl.yaw * Y.maxRate * 0.3 + (ctl.roll * 0.6 * vlong) / P.drive.wheelBase * 0.3;
  s.yawRate = approach(s.yawRate, rT, Y.tau, dt);
  s.psi += s.yawRate * dt;
  s.q = quatFromAttitude(s.theta, s.phi, s.psi);

  const rho = world.density(s.pos.y);
  const inflow = clamp(1 - Fp.inflowDamping * va.y, 0.6, 1.4);
  const T = s.throttle * Fp.thrustMax * (rho / 1.225) * inflow * Math.min(1, s.fanRpm / 0.9);
  s.thrust = T;
  const up = qrot(s.q, UP);
  const vh = Math.hypot(va.x, va.z);
  const dragH = vscale({ x: va.x, y: 0, z: va.z }, -0.5 * rho * vh * Fp.dragArea);
  const dragV = { x: 0, y: -0.5 * rho * Math.abs(va.y) * va.y * Fp.dragAreaVertical, z: 0 };
  const Faero = vadd(vadd(vscale(up, T), dragH), dragV);
  s.g = (Faero.x * up.x + Faero.y * up.y + Faero.z * up.z) / (m * G0);
  s.airspeed = vlen(va);
  let acc = vscale(vadd(Faero, { x: 0, y: -m * G0, z: 0 }), 1 / m);
  const ground0 = heliSurface(world, s.pos.x, s.pos.z);
  if (s.onGround) {
    if (acc.y <= 0) {
      acc = { x: acc.x * 0.3, y: 0, z: acc.z * 0.3 };
      // 車輪で転がる（減速はゆるやか）
      const sp = Math.hypot(s.vel.x, s.vel.z);
      const dec = Math.min(sp, 0.6 * dt);
      if (sp > 1e-6) { s.vel.x -= (s.vel.x / sp) * dec; s.vel.z -= (s.vel.z / sp) * dec; }
      s.vel.y = 0;
      s.pos.y = ground0 + P.cgHeight;
    } else {
      s.onGround = false;
      s.airTime = 0;
      s.landedEmitted = false;
      env.emit('liftoff', {});
    }
  }
  s.vel = vadd(s.vel, vscale(acc, dt));
  s.pos = vadd(s.pos, vscale(s.vel, dt));
  if (!s.onGround) s.airTime += dt;
  const g2 = heliSurface(world, s.pos.x, s.pos.z);
  if (!s.onGround && s.vel.y <= 0 && s.pos.y - P.cgHeight <= g2) {
    // 車輪があるので速度があっても着地できる
    const saved = { x: s.vel.x, z: s.vel.z };
    if (landingCheck(def, s, env, g2, P.landing, P.cgHeight)) { s.vel.x = saved.x; s.vel.z = saved.z; }
  } else if (s.onGround) {
    s.pos.y = g2 + P.cgHeight;
    if (terr0(world).isWater(s.pos.x, s.pos.z) && terr0(world).roofAt(s.pos.x, s.pos.z) === -Infinity) env.crash('水に突っ込みました');
    if (s.touchdown && !s.landedEmitted && Math.hypot(s.vel.x, s.vel.z) < 0.8 && s.throttle < 0.4) {
      s.landedEmitted = true;
      env.emit('landed', { ...s.touchdown });
    }
  }
}

const terr0 = (world) => world.terrain;
