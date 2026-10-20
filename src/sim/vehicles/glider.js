// 点質量の滑空モデル（パラグライダー・ウイングスーツ・キャノピーで共有）
// 状態: 対気速度 V、経路角 γ、方位 ψ、バンク φ、揚力係数 CL（遅れあり）
//   m dV/dt  = -D - m g sinγ
//   m V dγ/dt = L cosφ - m g cosγ
//   m V cosγ dψ/dt = L sinφ
// 地面に対する速度 = 対気速度ベクトル + 空気の速度（風・サーマル・斜面上昇風）
import { G0, clamp, approach } from '../math.js';

export function createGlide(pos, heading, V, gamma = 0, CL = 0.5) {
  return { pos: { ...pos }, V, gamma, psi: heading, phi: 0, CL, vel: airVector(V, gamma, heading) };
}

export function airVector(V, gamma, psi) {
  const c = Math.cos(gamma);
  return { x: V * c * Math.sin(psi), y: V * Math.sin(gamma), z: -V * c * Math.cos(psi) };
}

/**
 * A: { S, CD0, k, tauCL, tauBank }
 * cmd: { CL, bank, extraCD }
 */
export function stepGlide(g, A, mass, cmd, world, t, dt) {
  g.CL = approach(g.CL, cmd.CL, A.tauCL, dt);
  g.phi = approach(g.phi, cmd.bank, A.tauBank, dt);
  const rho = world.density(g.pos.y);
  const V = Math.max(g.V, 1);
  const qS = 0.5 * rho * V * V * A.S;
  const L = qS * g.CL;
  const CD = A.CD0 + A.k * g.CL * g.CL + (cmd.extraCD || 0);
  const D = qS * CD;
  const cg = Math.cos(g.gamma);
  const dV = -D / mass - G0 * Math.sin(g.gamma);
  const dGamma = (L * Math.cos(g.phi) / mass - G0 * cg) / V;
  const dPsi = (L * Math.sin(g.phi)) / (mass * V * Math.max(cg, 0.15));
  g.V = Math.max(1, g.V + dV * dt);
  g.gamma = clamp(g.gamma + dGamma * dt, -1.45, 1.2);
  g.psi += dPsi * dt;
  g.L = L;
  g.D = D;
  g.loadFactor = L / (mass * G0);
  const av = airVector(g.V, g.gamma, g.psi);
  const wind = world.airVelocity(g.pos, t);
  g.vel = { x: av.x + wind.x, y: av.y + wind.y, z: av.z + wind.z };
  g.pos = { x: g.pos.x + g.vel.x * dt, y: g.pos.y + g.vel.y * dt, z: g.pos.z + g.vel.z * dt };
  return g;
}

/** 定常滑空の理論値（静穏大気） */
export function steadyGlide(A, mass, CL, rho = 1.225, extraCD = 0) {
  const CD = A.CD0 + A.k * CL * CL + extraCD;
  const gamma = -Math.atan(CD / CL);
  const V = Math.sqrt((2 * mass * G0 * Math.cos(gamma)) / (rho * A.S * CL));
  return { V, sink: -V * Math.sin(gamma), ld: CL / CD, horiz: V * Math.cos(gamma) };
}
