// 純粋な数学ユーティリティ（DOM / Three.js 非依存）
// 座標系: ワールド x=東, y=上, z=南（北は -z）。
// 機体座標: 前方 -z, 上 +y, 右 +x（Three.js と同じ）。クォータニオンは機体→ワールドの回転。

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G0 = 9.80665;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapPi = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
/** 目標値へ一次遅れで近づける（dt 依存を正しく扱う） */
export const approach = (cur, target, tau, dt) => (tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau)));

// ---------- vec3 ----------
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vcopy = (a) => ({ x: a.x, y: a.y, z: a.z });
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vlen = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vnorm = (a) => {
  const l = vlen(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
};
export const vaddScaled = (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });

// ---------- quaternion {x,y,z,w} ----------
export const qident = () => ({ x: 0, y: 0, z: 0, w: 1 });
export const qcopy = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
export const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const qnorm = (q) => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};
export const qaxis = (axis, angle) => {
  const h = angle / 2;
  const s = Math.sin(h);
  const n = vnorm(axis);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(h) };
};
/** ベクトルを回転: q v q* */
export const qrot = (q, v) => {
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
};
/** 逆回転（ワールド→機体） */
export const qrotInv = (q, v) => qrot(qconj(q), v);
/** 機体座標の角速度 w (rad/s) で dt だけ積分 */
export const qintegrateBody = (q, w, dt) => {
  const ang = vlen(w) * dt;
  if (ang < 1e-12) return q;
  const dq = qaxis(w, ang);
  return qnorm(qmul(q, dq));
};

export const FWD = Object.freeze({ x: 0, y: 0, z: -1 });
export const UP = Object.freeze({ x: 0, y: 1, z: 0 });
export const RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });

/**
 * 姿勢（ピッチ・ロール・方位）を取り出す。
 * heading: 北(-z)=0, 東(+x)=90°。pitch: 機首上げ正。roll: 右バンク正。
 */
export function attitudeOf(q) {
  const f = qrot(q, FWD);
  const r = qrot(q, RIGHT);
  const u = qrot(q, UP);
  const pitch = Math.asin(clamp(f.y, -1, 1));
  const heading = Math.atan2(f.x, -f.z);
  // roll: 右翼が下がる（右バンク）を正。真上/真下を向いたときは不定なので 0。
  const roll = Math.abs(f.y) > 0.999 ? 0 : Math.atan2(-r.y, u.y);
  return { pitch, roll, heading: heading < 0 ? heading + 2 * Math.PI : heading };
}

/** heading(北=0,東=+), pitch, roll からクォータニオン（Y→X→Z の順） */
export function quatFromAttitude(pitch, roll, heading) {
  const qy = qaxis(UP, -heading);
  const qx = qaxis(RIGHT, pitch);
  const qz = qaxis({ x: 0, y: 0, z: 1 }, -roll);
  return qnorm(qmul(qmul(qy, qx), qz));
}

// ---------- 決定的な疑似乱数 ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
