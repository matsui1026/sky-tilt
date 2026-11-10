// スター集め（フリーの収集要素）。ロケーションごとに決まった場所へ置く。DOM / Three.js 非依存。
// 空の機体用（'air'）と車用（'ground'）の 2 組。集めた番号は呼び出し側が保存する。
import { mulberry32, hashString, clamp, DEG } from './math.js';

export const AIR_STARS = 15;
export const GROUND_STARS = 12;

/** 機体が集めるスターの組 */
export function starKind(def) {
  return def.model === 'car' ? 'ground' : 'air';
}

/** 取れる距離（速い・大きい機体ほど広い） */
export function starRadius(def) {
  if (def.model === 'car') return 3.2 + (def.p.bodyRadius || 1);
  return clamp((def.ringRadius || 20) * 0.8, 16, 45);
}

/** スターの位置の一覧 [{ pos: {x,y,z}, tier }]。同じロケーション・同じ地形なら毎回同じ */
export function createStars(world, kind) {
  const terr = world.terrain;
  const rnd = mulberry32(hashString(`stars:${terr.location.id}:${kind}`));
  const top = (x, z) => Math.max(terr.surfaceAt(x, z), terr.roofAt(x, z));
  const list = [];
  if (kind === 'ground') {
    const t = terr.track;
    for (let i = 0; i < GROUND_STARS; i++) {
      const s = ((i + 0.3 + rnd() * 0.4) / GROUND_STARS) * t.length;
      const p = t.at(s, (rnd() - 0.5) * t.width * 0.6);
      list.push({ pos: { x: p.x, y: terr.heightAt(p.x, p.z) + 1.3, z: p.z }, tier: 'road' });
    }
    return list;
  }
  const span = terr.half * 0.55;
  const farEnough = (x, z, d) => list.every((s) => Math.hypot(s.pos.x - x, s.pos.z - z) >= d);
  const place = (tier, yOf, sep = 380) => {
    for (let k = 0; k < 40; k++) {
      const x = (rnd() * 2 - 1) * span, z = (rnd() * 2 - 1) * span;
      if (!farEnough(x, z, sep)) continue;
      list.push({ pos: { x, y: yOf(x, z), z }, tier });
      return;
    }
  };
  // 滑走路・着陸エリアの両端の上（最初に見つけやすい）
  const field = terr.field;
  const fh = field.heading * DEG;
  for (const k of [-0.35, 0.35]) {
    const x = field.x + Math.sin(fh) * field.length * k, z = field.z - Math.cos(fh) * field.length * k;
    list.push({ pos: { x, y: Math.max(field.elevation, top(x, z)) + 35, z }, tier: 'field' });
  }
  // 山頂・高いビルの上: 候補の中でいちばん高い所
  for (let i = 0; i < 3; i++) {
    let best = null;
    for (let k = 0; k < 40; k++) {
      const x = (rnd() * 2 - 1) * span, z = (rnd() * 2 - 1) * span;
      const h = top(x, z);
      if ((!best || h > best.h) && farEnough(x, z, 600)) best = { x, z, h };
    }
    if (best) list.push({ pos: { x: best.x, y: best.h + 45, z: best.z }, tier: 'peak' });
  }
  // 地面すれすれ・中くらいの高さ
  for (let i = 0; i < 5; i++) place('low', (x, z) => top(x, z) + 20 + rnd() * 18);
  while (list.length < AIR_STARS) {
    const before = list.length;
    place('mid', (x, z) => top(x, z) + 90 + rnd() * 200);
    if (list.length === before) break;
  }
  return list;
}

/** 線分 a→b と点 p の最短距離（速い機体が 1 ステップで通り過ぎても取れるように） */
export function segmentDist(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-9 ? ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.z + dz * t - p.z);
}
