// 改造（ハンガー）: 機体ごとに 武装・エンジン・機体 を選んで性能を変える。
// applyMods は元の定義を変えずに、改造を反映した新しい定義を返す。
const deg = (d) => (d * Math.PI) / 180;

export const MOD_SLOTS = {
  arms: {
    name: '武装',
    options: {
      stock: { name: '標準', desc: 'その機体の標準装備' },
      gun: { name: '機銃のみ', desc: '機銃だけ。弾が 1.5 倍' },
      missile: { name: 'ミサイル', desc: '機銃＋誘導ミサイル 4 発（敵や地上の的を正面に入れ続けてロック）' },
      rocket: { name: 'ロケット', desc: '機銃＋ロケット弾 12 発（真っすぐ飛んで周りもまとめて壊す）' },
      full: { name: 'フル装備', desc: '機銃＋ミサイル 4＋ロケット 12。重くなる（質量 +10%）' },
      none: { name: '非武装', desc: '武器を外して軽く（質量 −8%）。風船は体当たりで割る' },
    },
  },
  engine: {
    name: 'エンジン',
    options: {
      stock: { name: '標準', desc: '標準の推力' },
      tuned: { name: 'チューン', desc: '推力 +25%' },
      turbo: { name: 'ターボ', desc: '推力 +55%。燃料・バッテリーの減りが 1.4 倍' },
      eco: { name: 'エコ', desc: '推力 −20%。燃料・バッテリーが 1.6 倍もつ' },
    },
  },
  body: {
    name: '機体',
    options: {
      stock: { name: '標準', desc: '標準の機体' },
      light: { name: '軽量化', desc: '質量 −15%。受けるダメージ 1.3 倍' },
      armor: { name: '装甲', desc: '質量 +15%。受けるダメージ 0.6 倍' },
      agile: { name: '高機動', desc: 'ロール・ピッチの効きが 1.3 倍、G 制限 +2' },
    },
  },
};

export const DEFAULT_MODS = { arms: 'stock', engine: 'stock', body: 'stock' };

/** 改造できる機体か（車は対象外） */
export function canModify(def) {
  return def.model !== 'car';
}

/** その機体で選べる改造 { arms: [...], engine: [...], body: [...] } */
export function modChoices(def) {
  const all = (k) => Object.keys(MOD_SLOTS[k].options);
  const noEngine = def.model === 'paraglider' || def.model === 'human' || (def.p.thrust && def.p.thrust.type === 'none');
  return {
    arms: all('arms'),
    engine: noEngine ? ['stock'] : all('engine'),
    body: all('body'),
  };
}

/** 改造が標準のままか */
export function isStock(mods) {
  return !mods || (['arms', 'engine', 'body'].every((k) => !mods[k] || mods[k] === 'stock'));
}

/** 機体の種類に合った基本の機銃 */
function baseGun(def) {
  if (def.weapon) return { ...def.weapon, missiles: 0, rockets: 0 };
  const fast = def.model === 'fixedwing' && def.p.thrust && def.p.thrust.type === 'jet';
  return { name: '機銃', rate: fast ? 20 : 12, speed: fast ? 950 : 750, damage: 10, ammo: 600, spread: 0.005 };
}

const MISSILE = { missiles: 4, lockRange: 2500, lockCone: deg(16), lockTime: 1.1 };

/** 改造を反映した機体の定義（元の定義は変えない） */
export function applyMods(def, mods) {
  if (!canModify(def) || isStock(mods)) return def;
  const m = { ...DEFAULT_MODS, ...mods };
  const ok = modChoices(def);
  for (const k of Object.keys(m)) if (!ok[k] || !ok[k].includes(m[k])) m[k] = 'stock';
  if (isStock(m)) return def;
  const d = structuredClone(def);
  d.mods = m;
  const P = d.p;
  let massK = 1;
  // ---- 武装 ----
  if (m.arms !== 'stock') {
    if (m.arms === 'none') { d.weapon = null; massK *= 0.92; }
    else {
      const g = baseGun(def);
      if (m.arms === 'gun') d.weapon = { ...g, ammo: Math.round(g.ammo * 1.5) };
      if (m.arms === 'missile') d.weapon = { ...g, ...MISSILE, lockRange: Math.max(def.weapon?.lockRange || 0, MISSILE.lockRange) };
      if (m.arms === 'rocket') d.weapon = { ...g, rockets: 12 };
      if (m.arms === 'full') { d.weapon = { ...g, ...MISSILE, rockets: 12 }; massK *= 1.1; }
    }
  }
  // ---- エンジン ----
  const thrustK = { stock: 1, tuned: 1.25, turbo: 1.55, eco: 0.8 }[m.engine];
  const burnK = { stock: 1, tuned: 1, turbo: 1 / 1.4, eco: 1.6 }[m.engine];
  if (thrustK !== 1) {
    if (P.thrust && P.thrust.type === 'prop') { P.thrust.static *= thrustK; P.thrust.power *= thrustK; }
    if (P.thrust && P.thrust.type === 'jet') { P.thrust.mil *= thrustK; if (P.thrust.ab) P.thrust.ab *= thrustK; }
    if (P.thrustMax) P.thrustMax *= thrustK;
    if (P.fly && P.fly.thrustMax) P.fly.thrustMax *= thrustK;
    if (P.burnerHeat) P.burnerHeat *= thrustK;
    if (P.drive) { if (P.drive.force) P.drive.force *= thrustK; if (P.drive.power) P.drive.power *= thrustK; }
  }
  if (burnK !== 1) {
    if (P.battery) P.battery = { ...P.battery, burnTime: P.battery.burnTime * burnK };
    if (P.burnTime) P.burnTime *= burnK;
  }
  // ---- 機体 ----
  d.armor = def.armor ?? 1;
  if (m.body === 'light') { massK *= 0.85; d.armor *= 1.3; }
  if (m.body === 'armor') { massK *= 1.15; d.armor *= 0.6; }
  if (m.body === 'agile') {
    if (P.roll) P.roll.maxRate *= 1.3;
    if (P.pitch) { P.pitch.maxRate *= 1.3; P.pitch.tauAlpha *= 0.77; }
    if (P.att) { P.att.tau *= 0.77; P.att.maxPitch = Math.min(P.att.maxPitch * 1.2, deg(75)); P.att.maxRoll = Math.min(P.att.maxRoll * 1.2, deg(75)); }
    if (P.gLimit) P.gLimit = { ...P.gLimit, pos: P.gLimit.pos + 2 };
  }
  if (massK !== 1 && P.mass) P.mass *= massK;
  return d;
}

/** 改造後の主な数値（ハンガー画面の比較用） */
export function modStats(def) {
  const P = def.p;
  let thrust = null;
  if (P.thrust && P.thrust.type === 'prop') thrust = P.thrust.static;
  else if (P.thrust && P.thrust.type === 'jet') thrust = P.thrust.ab || P.thrust.mil;
  else if (P.thrustMax) thrust = P.thrustMax;
  else if (P.fly && P.fly.thrustMax) thrust = P.fly.thrustMax;
  const w = def.weapon;
  return {
    mass: P.mass ?? null,
    thrust,
    twr: thrust && P.mass ? thrust / (P.mass * 9.80665) : null,
    armor: def.armor ?? 1,
    roll: P.roll ? P.roll.maxRate : P.att ? P.att.maxRoll : null,
    weapon: w ? [w.name, w.missiles ? `ミサイル ${w.missiles}` : null, w.rockets ? `ロケット ${w.rockets}` : null].filter(Boolean).join('・') : 'なし',
  };
}
