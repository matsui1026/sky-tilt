// 人体モデル: スカイダイビング（自由落下・トラッキング）とウイングスーツ、
// パラシュート展開 → キャノピー操縦 → 着地 までを 1 つの状態機械で扱う。
// phase: 'freefall' | 'wingsuit' | 'deploying' | 'canopy' | 'landed'
import { G0, DEG, clamp, lerp, smoothstep, vadd, vsub, vscale, vlen, vdot, vnorm, quatFromAttitude } from '../math.js';
import { createGlide, stepGlide } from './glider.js';
import { paragliderBrakes } from './paraglider.js';

const STAND_H = 0.9; // 着地時の重心高さ

export function createHuman(def, spawn) {
  const P = def.p;
  const phase = spawn.phase || def.startPhase || 'freefall';
  const hd = spawn.heading || 0;
  const sp = spawn.speed || 0;
  const s = {
    kind: 'human',
    phase,
    pos: { ...spawn.pos },
    vel: { x: Math.sin(hd) * sp, y: spawn.vy || 0, z: -Math.cos(hd) * sp },
    psi: hd,
    q: quatFromAttitude(0, 0, hd),
    onGround: false,
    deployT: 0,
    glide: null,
    track: 0,
    g: 1,
    airspeed: sp,
    brakes: { left: 0, right: 0, avg: 0, bar: 0 },
  };
  if (phase === 'wingsuit') {
    s.glide = createGlide(spawn.pos, hd, Math.max(sp, 25), -0.35, P.wingsuit.CLtrim);
  } else if (phase === 'canopy') {
    s.glide = createGlide(spawn.pos, hd, Math.max(sp, 9), -0.4, P.canopy.CLtrim);
  }
  return s;
}

export function humanDeploy(def, s, env, auto = false) {
  if (s.phase !== 'freefall' && s.phase !== 'wingsuit') return false;
  if (s.phase === 'wingsuit' && s.glide) {
    s.vel = { ...s.glide.vel };
    s.psi = s.glide.psi;
  }
  s.phase = 'deploying';
  s.deployT = 0;
  s.cdaStart = def.p.freefall.CdA;
  env.emit('deploy', { auto });
  return true;
}

export function stepHuman(def, s, ctl, env, dt) {
  const P = def.p;
  const world = env.world;
  if (s.onGround) return;
  const m = P.mass;
  const ground = Math.max(world.terrain.surfaceAt(s.pos.x, s.pos.z), world.terrain.roofAt(s.pos.x, s.pos.z));
  const agl = s.pos.y - ground;

  // 自動展開装置（AAD）
  if ((s.phase === 'freefall' || s.phase === 'wingsuit') && agl < P.aadAgl && s.vel.y < -20) {
    humanDeploy(def, s, env, true);
    env.emit('aad', {});
  }

  if (s.phase === 'freefall' || s.phase === 'deploying') {
    const air = world.airVelocity(s.pos, env.t);
    const va = vsub(s.vel, air);
    const V = vlen(va);
    const rho = world.density(s.pos.y);
    const ff = P.freefall;
    let CdA, CLA = 0;
    if (s.phase === 'freefall') {
      s.track = clamp(-ctl.pitch, 0, 1);
      const arch = clamp(ctl.pitch, 0, 1);
      CdA = lerp(lerp(ff.CdA, ff.CdAtrack, s.track), ff.CdA * 1.18, arch);
      CLA = ff.CLAtrack * s.track;
      s.psi += ctl.roll * ff.turnRate * dt;
    } else {
      s.deployT += dt;
      const f = clamp(s.deployT / P.deployTime, 0, 1);
      CdA = lerp(s.cdaStart, 9, f * f);
      s.track = 0;
    }
    let F = vscale(va, -0.5 * rho * V * CdA);
    if (CLA > 0 && V > 1) {
      const h = { x: Math.sin(s.psi), y: 0, z: -Math.cos(s.psi) };
      const ad = vscale(va, 1 / V);
      const ld = vnorm(vsub(h, vscale(ad, vdot(h, ad))));
      F = vadd(F, vscale(ld, 0.5 * rho * V * V * CLA));
    }
    s.g = vlen(F) / (m * G0);
    F = vadd(F, { x: 0, y: -m * G0, z: 0 });
    s.vel = vadd(s.vel, vscale(F, dt / m));
    s.pos = vadd(s.pos, vscale(s.vel, dt));
    s.airspeed = V;
    // うつ伏せ姿勢（腹を地面に向け、頭は進行方向）
    s.q = quatFromAttitude(-s.track * 18 * DEG, ctl.roll * 20 * DEG, s.psi);
    if (s.phase === 'deploying' && s.deployT >= P.deployTime) {
      const va2 = vsub(s.vel, world.airVelocity(s.pos, env.t));
      const V2 = vlen(va2);
      const gamma = Math.asin(clamp(va2.y / Math.max(V2, 1e-3), -1, 1));
      s.glide = createGlide(s.pos, s.psi, clamp(V2, 6, 25), Math.max(gamma, -1.4), P.canopy.CLtrim);
      s.phase = 'canopy';
      env.emit('canopy', {});
    }
  } else if (s.phase === 'wingsuit') {
    const W = P.wingsuit;
    const CL = ctl.pitch >= 0 ? lerp(W.CLtrim, W.CLmax, ctl.pitch) : lerp(W.CLtrim, W.CLmin, -ctl.pitch);
    const extraCD = 0.6 * smoothstep(0.92, 1.0, CL) ; // 失速域
    stepGlide(s.glide, W, m, { CL, bank: ctl.roll * W.bankMax, extraCD }, world, env.t, dt);
    syncGlide(s);
    s.stallWarn = CL > 0.93;
    s.q = quatFromAttitude(s.glide.gamma + 10 * DEG * s.glide.CL, s.glide.phi, s.glide.psi);
  } else if (s.phase === 'canopy') {
    const C = P.canopy;
    const b = paragliderBrakes(ctl);
    s.brakes = b;
    const CL = lerp(C.CLtrim, C.CLbrake, b.avg);
    stepGlide(s.glide, C, m, { CL, bank: (b.right - b.left) * C.bankMax, extraCD: 0.05 * b.avg }, world, env.t, dt);
    syncGlide(s);
    s.stallWarn = false;
    s.q = quatFromAttitude(s.glide.gamma + 8 * DEG, s.glide.phi, s.glide.psi);
  }
  humanLanding(def, s, env, 'canopy');
}

function syncGlide(s) {
  s.pos = s.glide.pos;
  s.vel = s.glide.vel;
  s.psi = s.glide.psi;
  s.airspeed = s.glide.V;
  s.g = s.glide.loadFactor;
}

/** 人体系（パラグライダー含む）の着地判定。okPhase の時だけ安全に着地できる */
export function humanLanding(def, s, env, okPhase) {
  const world = env.world;
  const t = world.terrain;
  const roof = t.roofAt(s.pos.x, s.pos.z);
  const surf = t.surfaceAt(s.pos.x, s.pos.z);
  const ground = Math.max(surf, roof);
  if (s.pos.y - STAND_H > ground) {
    if (t.buildingHit(s.pos, 0.4)) env.crash('ビルに衝突');
    return;
  }
  const vs = s.vel.y;
  const gs = Math.hypot(s.vel.x, s.vel.z);
  // 足が地面を擦る速さは対気速度で評価（追い風での着地を即墜落にしない。人は走って止まれる）
  const air = world.airVelocity(s.pos, env.t);
  const hs = Math.hypot(s.vel.x - air.x, s.vel.z - air.z);
  const lim = def.p.landing;
  const phase = s.phase === 'glide' ? 'canopy' : s.phase;
  let cause = null;
  if (roof < ground - 0.01 && t.isWater(s.pos.x, s.pos.z)) cause = '着水しました';
  else if (phase !== okPhase) cause = phase === 'deploying' ? 'パラシュートが開ききる前に地面に到達' : 'パラシュート未展開で地面に到達';
  else if (vs < -lim.maxSink) cause = `降下率が大きすぎます（${(-vs).toFixed(1)} m/s）`;
  else if (hs > lim.maxSpeed) cause = `着地速度が速すぎます（${hs.toFixed(1)} m/s）`;
  if (cause) { env.crash(cause); return; }
  s.onGround = true;
  s.pos.y = ground + STAND_H;
  s.phase = 'landed';
  s.touchdown = { vs, speed: hs, groundSpeed: gs, surface: roof >= ground - 0.01 && roof > -Infinity ? 'roof' : t.surfaceType(s.pos.x, s.pos.z), x: s.pos.x, z: s.pos.z, t: env.t };
  s.vel = { x: 0, y: 0, z: 0 };
  env.emit('touchdown', s.touchdown);
  env.emit('landed', s.touchdown);
}
