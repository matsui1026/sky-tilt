// ヘリコプター: スロットル=コレクティブ（推力）、傾き=サイクリック（姿勢指令）、ボタン=テールロータ（ヨー）
// 地面効果（Cheeseman–Bennett）と転移揚力（前進速度による効率向上）、上昇時のインフロー減衰を含む。
import { G0, DEG, clamp, approach, smoothstep, vadd, vsub, vscale, vlen, qrot, UP, quatFromAttitude } from '../math.js';

export function groundEffectFactor(P, hubAgl) {
  const z = Math.max(hubAgl, P.rotorRadius * 0.3);
  const r = P.rotorRadius / (4 * z);
  return clamp(1 / (1 - r * r), 1, 1.45);
}

export function etlFactor(P, vh) {
  return 1 + P.etl.gain * smoothstep(P.etl.v0, P.etl.v1, vh);
}

/** OGE・無風でホバリングに必要なコレクティブ（理論値） */
export function hoverCollective(P, rho = 1.225) {
  return (P.mass * G0) / (P.thrustMax * (rho / 1.225));
}

export function createHeli(def, spawn) {
  const hd = spawn.heading || 0;
  const sp = spawn.speed || 0;
  return {
    kind: 'heli',
    pos: { ...spawn.pos },
    vel: { x: Math.sin(hd) * sp, y: 0, z: -Math.cos(hd) * sp },
    theta: 0, phi: 0, psi: hd, yawRate: 0,
    q: quatFromAttitude(0, 0, hd),
    collective: spawn.throttle ?? 0,
    onGround: !!spawn.onGround,
    touchdown: null, landedEmitted: false, airTime: spawn.onGround ? 0 : 99,
    g: 1, airspeed: sp, kGE: 1, kETL: 1, thrust: 0, rotorRpm: spawn.onGround ? 0.0 : 1,
    fuel: def.p.battery ? 1 : undefined,
  };
}

export function heliSurface(world, x, z) {
  const t = world.terrain;
  return Math.max(t.surfaceAt(x, z), t.roofAt(x, z));
}

export function stepHeli(def, s, ctl, env, dt) {
  const P = def.p;
  const world = env.world;
  const m = P.mass;
  // バッテリー（ドローン）: 推力に比例して減り、切れると推力を失う
  const bat = P.battery;
  const cmd = bat && s.fuel <= 0 ? 0 : clamp(ctl.throttle, 0, 1);
  s.collective = approach(s.collective, cmd, bat ? 0.05 : 0.12, dt);
  if (bat) {
    s.fuel = Math.max(0, s.fuel - (s.collective / bat.burnTime) * dt);
    if (s.fuel <= 0 && !s.fuelOut) { s.fuelOut = true; env.emit('fuelout', {}); }
  }
  // ローター回転（起動演出用）
  s.rotorRpm = approach(s.rotorRpm, s.onGround && s.collective < 0.05 ? 0.6 : 1, 2.0, dt);

  // サイクリック → 目標姿勢
  const A = P.att;
  let thT = ctl.pitch * A.maxPitch;
  let phT = ctl.roll * A.maxRoll;
  if (s.onGround) { thT = clamp(thT, -3 * DEG, 3 * DEG); phT = clamp(phT, -3 * DEG, 3 * DEG); }
  s.theta = approach(s.theta, thT, A.tau, dt);
  s.phi = approach(s.phi, phT, A.tau, dt);

  const air = world.airVelocity(s.pos, env.t);
  const va = vsub(s.vel, air);
  const fh = { x: Math.sin(s.psi), z: -Math.cos(s.psi) };
  const rh = { x: -fh.z, z: fh.x };
  const vlong = va.x * fh.x + va.z * fh.z;
  const vlat = va.x * rh.x + va.z * rh.z;
  const vh = Math.hypot(va.x, va.z);

  // ヨー: テールロータ＋前進飛行時の風見安定
  const Y = P.yaw;
  const beta = Math.atan2(vlat, Math.max(Math.abs(vlong), 1));
  let rT = ctl.yaw * Y.maxRate + Y.weathervane * beta * smoothstep(8, 30, vlong);
  if (s.onGround) rT *= clamp((s.thrust / (m * G0) - 0.4) * 2, 0, 1);
  s.yawRate = approach(s.yawRate, rT, Y.tau, dt);
  s.psi += s.yawRate * dt;
  s.q = quatFromAttitude(s.theta, s.phi, s.psi);

  // 推力
  const rho = world.density(s.pos.y);
  const ground = heliSurface(world, s.pos.x, s.pos.z);
  const hubAgl = s.pos.y - P.cgHeight + P.hubHeight - ground;
  s.kGE = groundEffectFactor(P, hubAgl);
  s.kETL = etlFactor(P, vh);
  const inflow = clamp(1 - P.inflowDamping * va.y, 0.5, 1.5);
  const T = s.collective * P.thrustMax * (rho / 1.225) * s.kGE * s.kETL * inflow * Math.min(1, s.rotorRpm / 0.95);
  s.thrust = T;
  const up = qrot(s.q, UP);
  const vhh = { x: va.x, y: 0, z: va.z };
  const dragH = vscale(vhh, -0.5 * rho * vh * P.dragArea);
  const dragV = { x: 0, y: -0.5 * rho * Math.abs(va.y) * va.y * P.dragAreaVertical, z: 0 };
  const Faero = vadd(vadd(vscale(up, T), dragH), dragV);
  const F = vadd(Faero, { x: 0, y: -m * G0, z: 0 });
  s.g = (Faero.x * up.x + Faero.y * up.y + Faero.z * up.z) / (m * G0);
  s.airspeed = vlen(va);

  let acc = vscale(F, 1 / m);
  if (s.onGround) {
    if (acc.y <= 0) {
      acc = { x: 0, y: 0, z: 0 };
      // スキッドの摩擦で停止
      s.vel = vscale({ x: s.vel.x, y: 0, z: s.vel.z }, Math.exp(-dt / 0.25));
      s.pos.y = ground + P.cgHeight;
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

  // 接地判定
  const g2 = heliSurface(world, s.pos.x, s.pos.z);
  if (!s.onGround && s.pos.y - P.cgHeight <= g2) {
    landingCheck(def, s, env, g2, P.landing, P.cgHeight);
  } else if (s.onGround) {
    s.pos.y = g2 + P.cgHeight;
    const gs = Math.hypot(s.vel.x, s.vel.z);
    if (s.touchdown && !s.landedEmitted && gs < 0.6 && s.collective < 0.5) {
      s.landedEmitted = true;
      env.emit('landed', { ...s.touchdown });
    }
  }
  if (!s.crashed && !s.onGround && world.terrain.buildingHit(s.pos, P.cgHeight * 0.9)) env.crash('ビルに衝突');
  // メインローターが地形に当たる（斜面に突っ込む）
  if (!s.crashed && !s.onGround && P.rotorRadius) {
    const ahead = { x: s.pos.x + fh.x * P.rotorRadius * 0.9, z: s.pos.z + fh.z * P.rotorRadius * 0.9 };
    const gh = world.terrain.surfaceAt(ahead.x, ahead.z);
    if (s.pos.y + P.hubHeight - P.cgHeight < gh) env.crash('ローターが地形に接触');
  }
}

/** 垂直着陸系（ヘリ・ジェットスーツ）共通の接地評価 */
export function landingCheck(def, s, env, ground, lim, cg) {
  const world = env.world;
  const vs = s.vel.y;
  const gs = Math.hypot(s.vel.x, s.vel.z);
  const roof = world.terrain.roofAt(s.pos.x, s.pos.z);
  const surface = roof > -Infinity && roof >= ground - 0.01 ? 'roof' : world.terrain.surfaceType(s.pos.x, s.pos.z);
  const slope = surface === 'roof' ? 0 : world.terrain.slopeAt(s.pos.x, s.pos.z);
  let cause = null;
  if (surface === 'water') cause = '着水しました';
  else if (vs < -lim.maxSink) cause = `降下率が大きすぎます（${(-vs).toFixed(1)} m/s）`;
  else if (gs > lim.maxSpeed) cause = `接地速度が速すぎます（${gs.toFixed(1)} m/s）`;
  else if (Math.abs(s.theta) > lim.maxTilt || Math.abs(s.phi) > lim.maxTilt) cause = '傾いたまま接地';
  else if (slope > 14 * DEG) cause = '急斜面に接触';
  if (cause) { env.crash(cause); return false; }
  s.onGround = true;
  s.pos.y = ground + cg;
  if (!(s.touchdown && s.airTime < 2)) {
    s.touchdown = { vs, speed: gs, surface, x: s.pos.x, z: s.pos.z, t: env.t };
    env.emit('touchdown', s.touchdown);
  }
  s.vel = { x: s.vel.x * 0.5, y: 0, z: s.vel.z * 0.5 };
  return true;
}
