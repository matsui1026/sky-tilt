// 熱気球: 浮力 = 球皮体積 × 外気密度 × (1 − 外気温/球皮内温度) × g
// バーナーで球皮内の空気を温め、放熱・排気弁で冷える。水平方向は風に流される（操縦できない）。
// 球皮内の空気の質量も一緒に加速するため、上下の動きはとても重い。
import { G0, clamp, quatFromAttitude } from '../math.js';

export const T_STD = 288.15; // 海面の標準気温 [K]

/** 高度 h の外気温（ISA） */
export function airTemp(h) {
  return T_STD - 0.0065 * clamp(h, -200, 11000);
}

/** 高度 h で浮力と重さが釣り合う球皮内温度 [K] */
export function equilibriumTemp(P, rho, Tair) {
  const k = P.mass / (rho * P.envelopeVolume); // 1 - Ta/Ti
  return Tair / (1 - k);
}

/** 平衡温度を保つのに必要なバーナー出力（0..1） */
export function hoverBurner(P, rho, Tair) {
  const Ti = equilibriumTemp(P, rho, Tair);
  return clamp((P.heatLoss * (Ti - Tair)) / P.burnerHeat, 0, 1);
}

export function createBalloon(def, spawn, world) {
  const P = def.p;
  const rho = world ? world.density(spawn.pos.y) : 1.225;
  const Ta = airTemp(spawn.pos.y);
  return {
    kind: 'balloon',
    pos: { ...spawn.pos },
    vel: { x: 0, y: 0, z: 0 },
    q: quatFromAttitude(0, 0, spawn.heading || 0),
    heading: spawn.heading || 0,
    temp: equilibriumTemp(P, rho, Ta),
    burner: 0,
    throttle: spawn.throttle ?? hoverBurner(P, rho, Ta),
    onGround: !!spawn.onGround,
    touchdown: null,
    airTime: 99,
    g: 1,
    airspeed: 0,
  };
}

export function stepBalloon(def, s, ctl, env, dt) {
  const P = def.p;
  const world = env.world;
  const terr = world.terrain;
  // バーナー: スロットル（パイロット火の強さ）＋ボタンで全開
  s.burner = ctl.burner ? 1 : clamp(ctl.throttle, 0, 1);
  s.throttle = s.burner;
  s.venting = !!ctl.vent;
  const Ta = airTemp(s.pos.y);
  const rho = world.density(s.pos.y);
  let dT = s.burner * P.burnerHeat - P.heatLoss * (s.temp - Ta);
  if (s.venting) dT -= P.ventRate * (s.temp - Ta);
  s.temp = clamp(s.temp + dT * dt, Ta, 400);

  const V = P.envelopeVolume;
  const buoyancy = V * rho * (1 - Ta / s.temp) * G0;
  const innerMass = V * rho * (Ta / s.temp);   // 球皮内の空気の質量
  const effMass = P.mass + innerMass * 1.0 + 0.5 * V * rho; // 付加質量も含めて重く
  const air = world.airVelocity(s.pos, env.t);
  const relY = s.vel.y - air.y;
  const drag = -0.5 * rho * P.CdA * relY * Math.abs(relY);
  let ay = (buoyancy - P.mass * G0 + drag) / effMass;
  s.lift = buoyancy;

  // 水平は風に追従
  const k = 1 - Math.exp(-P.windCoupling * dt);
  s.vel.x += (air.x - s.vel.x) * k;
  s.vel.z += (air.z - s.vel.z) * k;

  const ground = Math.max(terr.surfaceAt(s.pos.x, s.pos.z), terr.roofAt(s.pos.x, s.pos.z));
  if (s.onGround) {
    // 地上: 浮力が重さを超えるまで止まっている（風で少し引きずられる）
    s.vel.x *= Math.exp(-dt / 0.4);
    s.vel.z *= Math.exp(-dt / 0.4);
    if (ay > 0.02) { s.onGround = false; env.emit('liftoff', {}); } else { ay = 0; s.vel.y = 0; }
  }
  s.vel.y += ay * dt;
  s.pos = { x: s.pos.x + s.vel.x * dt, y: s.pos.y + s.vel.y * dt, z: s.pos.z + s.vel.z * dt };
  // ゆっくり回る（見た目）
  s.heading += 0.02 * dt;
  s.q = quatFromAttitude(0, 0, s.heading);
  s.airspeed = Math.hypot(s.vel.x - air.x, s.vel.y - air.y, s.vel.z - air.z);
  s.g = 1 + ay / G0;

  const g2 = Math.max(terr.surfaceAt(s.pos.x, s.pos.z), terr.roofAt(s.pos.x, s.pos.z));
  if (!s.onGround && s.pos.y - P.basketHeight <= g2) {
    const vs = s.vel.y;
    const gs = Math.hypot(s.vel.x, s.vel.z);
    if (terr.isWater(s.pos.x, s.pos.z) && terr.roofAt(s.pos.x, s.pos.z) === -Infinity) { env.crash('着水しました'); return; }
    if (vs < -P.landing.maxSink) { env.crash(`降下率が大きすぎます（${(-vs).toFixed(1)} m/s）`); return; }
    s.onGround = true;
    s.pos.y = g2 + P.basketHeight;
    s.vel.y = 0;
    const td = { vs, speed: gs, surface: terr.surfaceType(s.pos.x, s.pos.z), x: s.pos.x, z: s.pos.z, t: env.t };
    s.touchdown = td;
    env.emit('touchdown', td);
    if (gs < P.landing.maxSpeed) env.emit('landed', td);
  } else if (s.onGround) {
    s.pos.y = g2 + P.basketHeight;
  }
  // 球皮が地形・ビルに当たる
  const top = { x: s.pos.x, y: s.pos.y + 14, z: s.pos.z };
  if (!s.onGround && (terr.buildingHit(top, 8) || top.y < terr.surfaceAt(top.x, top.z))) env.crash('球皮が障害物に接触');
}
