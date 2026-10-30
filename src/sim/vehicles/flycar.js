// 空飛ぶスポーツカー: 走行モード（地面を走る車）と飛行モード（4 つのダクトファンで飛ぶ）を切り替える。
// 走行: car.js の車の物理を共有（タイヤの摩擦円・ドリフト・ジャンプ・壁で跳ね返る）。
// 飛行: ドローンと同じ姿勢コマンド（傾けた方向に車体が傾き、推力の向きが変わる）。
import { G0, clamp, approach, smoothstep, vadd, vsub, vscale, vlen, qrot, UP, quatFromAttitude } from '../math.js';
import { heliSurface, landingCheck } from './heli.js';
import { createCarState, stepCarCore } from './car.js';

export function flycarHoverThrottle(P, rho = 1.225) {
  return (P.mass * G0) / (P.fly.thrustMax * (rho / 1.225));
}

export function createFlycar(def, spawn) {
  const hd = spawn.heading || 0;
  const sp = spawn.speed || 0;
  const mode = spawn.onGround ? 'drive' : 'fly';
  const s = createCarState(def, spawn);
  return Object.assign(s, {
    kind: 'flycar',
    mode,
    vx: spawn.onGround ? sp : 0, // 走行中の前後速度
    yawRate: 0,
    throttle: spawn.throttle ?? 0,
    fanRpm: mode === 'fly' ? 1 : 0,
    fuel: 1,
    onGround: !!spawn.onGround,
    touchdown: null, landedEmitted: false, airTime: spawn.onGround ? 0 : 99,
    g: 1, airspeed: sp, thrust: 0,
    psi: hd,
  });
}
/** モード切替。飛行 → 走行は接地中のみ */
export function flycarToggleMode(def, s, env) {
  if (s.mode === 'drive') {
    s.mode = 'fly';
    s.air = false;
    s.yawRate = s.r;
    env.emit('carMode', { mode: 'fly' });
    return 'fly';
  }
  if (!s.onGround) {
    env.emit('notice', { text: '着地してから走行モードに切り替えてください' });
    return 'fly';
  }
  // 走行へ: 車体の向きの前後速度を引き継ぐ
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  s.vx = s.vel.x * fh.x + s.vel.z * fh.z;
  s.vy = s.vel.x * rh.x + s.vel.z * rh.z;
  s.r = 0;
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
  if (s.mode === 'drive') stepDrive(def, s, ctl, env, dt);
  else stepFly(def, s, ctl, env, dt);
  if (!s.crashed && !s.onGround && terr.buildingHit(s.pos, P.cgHeight * 0.9)) env.crash('ビルに衝突');
}

/** 走行は車と同じタイヤの物理（ドリフトもできる）。アクセルはスライダー、ブレーキは手前に傾ける */
function stepDrive(def, s, ctl, env, dt) {
  stepCarCore(def, s, {
    steer: ctl.roll,
    gas: Math.max(ctl.throttle, ctl.gas || 0),
    brake: Math.max(ctl.pitch > 0.1 ? ctl.pitch : 0, ctl.brake || 0),
    handbrake: !!ctl.handbrake,
    nitro: false,
  }, env, dt, { assist: env.carAssist, revDelay: 1.0, waterCrash: true, fallCrash: true });
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
