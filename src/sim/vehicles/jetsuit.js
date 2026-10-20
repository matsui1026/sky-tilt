// ジェットスーツ: スロットル＝推力、傾き＝体（推力ベクトル）の向き。燃料制。
import { G0, clamp, approach, smoothstep, vadd, vsub, vscale, vlen, qrot, UP, quatFromAttitude } from '../math.js';
import { heliSurface, landingCheck } from './heli.js';

export function jetsuitHoverThrottle(P, rho = 1.225) {
  return (P.mass * G0) / (P.thrustMax * Math.pow(rho / 1.225, 0.75));
}

export function createJetsuit(def, spawn) {
  const hd = spawn.heading || 0;
  const sp = spawn.speed || 0;
  return {
    kind: 'jetsuit',
    pos: { ...spawn.pos },
    vel: { x: Math.sin(hd) * sp, y: 0, z: -Math.cos(hd) * sp },
    theta: 0, phi: 0, psi: hd, yawRate: 0,
    q: quatFromAttitude(0, 0, hd),
    throttle: spawn.throttle ?? 0,
    fuel: 1,
    onGround: !!spawn.onGround,
    touchdown: null, landedEmitted: false, airTime: spawn.onGround ? 0 : 99,
    g: 1, airspeed: sp, thrust: 0,
  };
}

export function stepJetsuit(def, s, ctl, env, dt) {
  const P = def.p;
  const world = env.world;
  const m = P.mass;
  const thrCmd = s.fuel > 0 ? clamp(ctl.throttle, 0, 1) : 0;
  s.throttle = approach(s.throttle, thrCmd, 0.18, dt);
  s.fuel = Math.max(0, s.fuel - (s.throttle / P.burnTime) * dt);
  if (s.fuel <= 0 && !s.fuelOut) { s.fuelOut = true; env.emit('fuelout', {}); }

  const A = P.att;
  let thT = ctl.pitch * A.maxPitch;
  let phT = ctl.roll * A.maxRoll;
  if (s.onGround) { thT = 0; phT = 0; }
  s.theta = approach(s.theta, thT, A.tau, dt);
  s.phi = approach(s.phi, phT, A.tau, dt);

  const air = world.airVelocity(s.pos, env.t);
  const va = vsub(s.vel, air);
  const V = vlen(va);
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  const vlong = va.x * fh.x + va.z * fh.z;
  const vlat = va.x * rh.x + va.z * rh.z;
  const beta = Math.atan2(vlat, Math.max(Math.abs(vlong), 1));
  // ヨー: ボタン＋バンクによる旋回（体を傾けると向きも変わる）＋風見
  const Y = P.yaw;
  const bankTurn = vlong > 3 ? (G0 * Math.tan(s.phi)) / Math.max(vlong, 6) : s.phi * 0.8;
  let rT = ctl.yaw * Y.maxRate + bankTurn * 0.6 + Y.weathervane * beta * smoothstep(6, 25, vlong);
  if (s.onGround) rT = ctl.yaw * Y.maxRate * 0.5;
  s.yawRate = approach(s.yawRate, rT, Y.tau, dt);
  s.psi += s.yawRate * dt;
  s.q = quatFromAttitude(s.theta, s.phi, s.psi);

  const rho = world.density(s.pos.y);
  const T = s.throttle * P.thrustMax * Math.pow(rho / 1.225, 0.75);
  s.thrust = T;
  const up = qrot(s.q, UP);
  const drag = vscale(va, -0.5 * rho * V * P.dragArea);
  const Faero = vadd(vscale(up, T), drag);
  s.g = (Faero.x * up.x + Faero.y * up.y + Faero.z * up.z) / (m * G0);
  s.airspeed = V;
  let acc = vscale(vadd(Faero, { x: 0, y: -m * G0, z: 0 }), 1 / m);

  const ground0 = heliSurface(world, s.pos.x, s.pos.z);
  if (s.onGround) {
    if (acc.y <= 0) {
      acc = { x: 0, y: 0, z: 0 };
      s.vel = vscale({ x: s.vel.x, y: 0, z: s.vel.z }, Math.exp(-dt / 0.2));
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
  if (!s.onGround && s.pos.y - P.cgHeight <= g2) {
    landingCheck(def, s, env, g2, P.landing, P.cgHeight);
  } else if (s.onGround) {
    s.pos.y = g2 + P.cgHeight;
    if (s.touchdown && !s.landedEmitted && Math.hypot(s.vel.x, s.vel.z) < 0.6 && s.throttle < 0.4) {
      s.landedEmitted = true;
      env.emit('landed', { ...s.touchdown });
    }
  }
  if (!s.crashed && !s.onGround && world.terrain.buildingHit(s.pos, P.cgHeight * 0.8)) env.crash('ビルに衝突');
}
