// パラグライダー: 推力なし。左右に傾ける＝片側ブレーク、手前に傾ける＝両ブレーク、奥へ＝スピードバー
import { DEG, clamp, smoothstep, lerp, quatFromAttitude } from '../math.js';
import { createGlide, stepGlide } from './glider.js';
import { humanLanding } from './human.js';

export function paragliderBrakes(ctl) {
  const sym = Math.max(0, ctl.pitch);
  const bar = Math.max(0, -ctl.pitch);
  const left = clamp(sym + Math.max(0, -ctl.roll), 0, 1);
  const right = clamp(sym + Math.max(0, ctl.roll), 0, 1);
  return { left, right, bar, avg: (left + right) / 2 };
}

export function paragliderCmd(P, ctl) {
  const b = paragliderBrakes(ctl);
  const CL = b.bar > 0 ? lerp(P.CLtrim, P.CLbar, b.bar) : lerp(P.CLtrim, P.CLbrake, b.avg);
  const bank = (b.right - b.left) * P.bankMax;
  const extraCD = P.brakeCD * b.avg + P.stallCD * smoothstep(0.85, 1, b.avg) + 0.015 * Math.abs(b.right - b.left);
  return { CL, bank, extraCD, brakes: b };
}

export function createParaglider(def, spawn) {
  const P = def.p;
  const g = createGlide(spawn.pos, spawn.heading || 0, spawn.speed || 10.5, -0.1, P.CLtrim);
  return { kind: 'paraglider', glide: g, pos: g.pos, vel: g.vel, q: quatFromAttitude(0, 0, g.psi), onGround: false, phase: 'glide', brakes: { left: 0, right: 0, avg: 0, bar: 0 } };
}

export function stepParaglider(def, s, ctl, env, dt) {
  const P = def.p;
  if (s.onGround) return;
  const cmd = paragliderCmd(P, ctl);
  s.brakes = cmd.brakes;
  stepGlide(s.glide, { S: P.S, CD0: P.CD0, k: P.k, tauCL: P.tauCL, tauBank: P.tauBank }, P.mass, cmd, env.world, env.t, dt);
  const g = s.glide;
  s.pos = g.pos;
  s.vel = g.vel;
  s.airspeed = g.V;
  s.g = g.loadFactor;
  s.stallWarn = s.brakes.avg > 0.85;
  // 描画用の姿勢（翼はほぼ経路方向、パイロットは振り子でバンク）
  s.q = quatFromAttitude(g.gamma + 6 * DEG + s.brakes.avg * 8 * DEG, g.phi, g.psi);
  humanLanding(def, s, env, 'canopy');
}
