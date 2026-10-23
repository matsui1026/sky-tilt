// 射撃モード: 弾・ミサイル・的（風船・地上目標）・敵機 AI（DOM / Three.js 非依存、シード固定）
// - 武器のある機体: 機銃（＋戦闘機はロックオン式の追尾ミサイル）で的と敵を撃つ
// - 武器の無い機体: 風船に体当たりして割る
import {
  G0, DEG, clamp, mulberry32, hashString,
  vadd, vsub, vscale, vdot, vlen, vnorm, vcross, qrot, FWD,
} from './math.js';
import { CRUISE } from './modes.js';

const BULLET_TTL = 2.6;
const MAX_BULLETS = 400;

/** 線分 a→b と球（中心 c, 半径 r）の交差 */
export function segmentHitsSphere(a, b, c, r) {
  const ab = vsub(b, a);
  const ac = vsub(c, a);
  const L2 = vdot(ab, ab);
  const t = L2 > 1e-9 ? clamp(vdot(ac, ab) / L2, 0, 1) : 0;
  const p = vadd(a, vscale(ab, t));
  const d = vsub(c, p);
  return vdot(d, d) <= r * r;
}

/** ベクトル a を b の方向へ最大 maxAngle だけ回す（単位ベクトル） */
export function rotateToward(a, b, maxAngle) {
  const an = vnorm(a), bn = vnorm(b);
  const cos = clamp(vdot(an, bn), -1, 1);
  const ang = Math.acos(cos);
  if (ang <= maxAngle || ang < 1e-6) return bn;
  let axis = vcross(an, bn);
  if (vlen(axis) < 1e-6) axis = Math.abs(an.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  axis = vnorm(axis);
  // ロドリゲスの回転
  const c = Math.cos(maxAngle), s = Math.sin(maxAngle);
  const k = axis;
  const kxv = vcross(k, an);
  const kdv = vdot(k, an);
  return vnorm(vadd(vadd(vscale(an, c), vscale(kxv, s)), vscale(k, kdv * (1 - c))));
}

const angleBetween = (a, b) => Math.acos(clamp(vdot(vnorm(a), vnorm(b)), -1, 1));

/** 難易度: エイムアシストの円錐（固定翼 / その他）、敵の弾のばらつき・威力、敵の数の追加 */
export const DIFFICULTY = {
  easy: { assistPlane: 7 * DEG, assistOther: 14 * DEG, enemySpread: 0.05, enemyDmg: 3, extraEnemies: 0 },
  normal: { assistPlane: 5 * DEG, assistOther: 10 * DEG, enemySpread: 0.03, enemyDmg: 4, extraEnemies: 0 },
  hard: { assistPlane: 2.5 * DEG, assistOther: 6 * DEG, enemySpread: 0.018, enemyDmg: 6, extraEnemies: 1 },
};

export class Combat {
  /**
   * world: World, def: 機体定義
   * opts: { pvp: 敵 AI を出さない, spawn: { pos, heading(rad) }, difficulty, targets: 的のリストを外から与える（2 人プレイ） }
   */
  constructor(world, def, opts = {}) {
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.spawn = opts.spawn || null;
    this.world = world;
    this.def = def;
    this.armed = !!def.weapon;
    this.weapon = def.weapon || null;
    this.pvp = !!opts.pvp;
    this.rnd = mulberry32(world.seed + hashString('combat'));
    this.time = 0;
    this.score = 0;
    this.health = 100;
    this.ammo = this.weapon ? this.weapon.ammo : 0;
    this.missilesLeft = this.weapon && this.weapon.missiles ? this.weapon.missiles : 0;
    this.shots = 0;
    this.hits = 0;
    this.kills = 0;
    this.fireT = 0;
    this.enemyFireRnd = mulberry32(world.seed + 4242);
    this.bullets = [];
    this.missiles = [];
    this.events = [];
    this.lock = { target: -1, progress: 0, locked: false };
    this.externalTargets = []; // 2 人プレイの相手など { id, pos, r }
    this.finished = false;
    this.wave = 0;
    this.speedClass = CRUISE[def.id] || 30;
    this.targets = opts.targets ? opts.targets.map((t) => ({ ...t, pos: { ...t.pos }, alive: true, hp: t.type === 'balloon' ? 1 : 30 })) : this._makeTargets();
    this.enemies = [];
    this.maxWaves = this.armed && !this.pvp ? 3 : 0;
    if (this.maxWaves) this._spawnWave(null);
  }

  /**
   * 的の配置。機体の実際の出現位置と飛び方に合わせる:
   * - スカイダイビング: 真下に向かって縦に並ぶ
   * - 滑空系（パラグライダー・ウイングスーツ・グライダー）: 滑空比に沿って下っていく通り道
   * - それ以外: 出現位置の前方の範囲に、その高さの前後で散らす（低速機は低く狭く）
   * 大きな機体ほど風船も大きくする（体当たりで割れるように）
   */
  _makeTargets() {
    const w = this.world;
    const terr = w.terrain;
    const loc = w.location;
    const rnd = this.rnd;
    const def = this.def;
    const list = [];
    const sp = this.spawn;
    const a = sp ? { x: sp.pos.x, z: sp.pos.z, y: sp.pos.y, hd: sp.heading || 0 } : { x: loc.airSpawn.x, z: loc.airSpawn.z, y: null, hd: (loc.airSpawn.heading * Math.PI) / 180 };
    const fx = Math.sin(a.hd), fz = -Math.cos(a.hd);
    const slow = this.speedClass < 40;
    const bigR = Math.max(slow ? 4.5 : 7, (def.p.bodyRadius || 1) * 4);
    const ground = (x, z) => Math.max(terr.surfaceAt(x, z), terr.roofAt(x, z));
    let id = 0;
    const push = (x, y, z) => list.push({ id: id++, type: 'balloon', pos: { x, y, z }, r: bigR, hp: 1, alive: true, color: Math.floor(rnd() * 5) });
    if (def.model === 'human' && def.startPhase === 'freefall' && a.y != null) {
      // 自由落下: 落ちながら水平に寄って割る
      let x = a.x, z = a.z, y = a.y - 150;
      while (y > ground(x, z) + 450 && list.length < 14) {
        x += (rnd() - 0.5) * 140; z += (rnd() - 0.5) * 140;
        push(x, y, z);
        y -= 130;
      }
    } else if (def.ringGlide && a.y != null) {
      // 滑空: 滑空比（少し余裕を持たせる）に沿った通り道
      const spacing = (this.speedClass || 10) * 7;
      let x = a.x, z = a.z, y = a.y, hd = a.hd;
      for (let i = 0; i < 14; i++) {
        hd += (rnd() - 0.5) * 0.6;
        const d = i === 0 ? spacing * 0.6 : spacing;
        x += Math.sin(hd) * d; z -= Math.cos(hd) * d;
        y -= d / (def.ringGlide * 0.8);
        const side = (rnd() - 0.5) * spacing * 0.5;
        const px = x + Math.cos(hd) * side, pz = z + Math.sin(hd) * side;
        if (y < ground(px, pz) + 25) break;
        push(px, y, pz);
      }
    }
    // 滑空・落下の通り道に置けなかった（低い所から始めた等）ときは、前方の低い所に散らす
    if (list.length < 5) {
      const spread = slow ? 900 : 2600;
      const ahead0 = slow ? 150 : 500;
      for (let i = list.length; i < 14; i++) {
        const along = ahead0 + rnd() * spread;
        const side = (rnd() - 0.5) * spread * 0.8;
        const x = a.x + fx * along - fz * side;
        const z = a.z + fz * along + fx * side;
        const g = ground(x, z);
        let y;
        if (def.ringGlide || def.startPhase === 'freefall') y = g + 3 + rnd() * 10; // 降りてから届く高さ
        else if (slow || a.y == null) y = g + (slow ? 25 + rnd() * 90 : 80 + rnd() * 300);
        else y = Math.max(g + 60, a.y + (rnd() - 0.5) * 300); // 出現高度の前後
        push(x, y, z);
      }
    }
    if (this.armed) {
      const f = terr.field;
      let tries = 0;
      for (let i = 0; i < 6 && tries < 200; tries++) {
        const ang = rnd() * Math.PI * 2;
        const d = 250 + rnd() * 700;
        const x = f.x + Math.cos(ang) * d;
        const z = f.z + Math.sin(ang) * d;
        if (terr.isWater(x, z) || terr.slopeAt(x, z) > 0.35) continue;
        const g = terr.surfaceAt(x, z);
        list.push({ id: id++, type: 'ground', pos: { x, y: g + 2.5, z }, r: 7, hp: 30, alive: true });
        i++;
      }
    }
    return list;
  }
  _spawnWave(player) {
    this.wave++;
    const n = this.wave + 1 + this.diff.extraEnemies; // 2, 3, 4 機（難しいは +1）
    const terr = this.world.terrain;
    const rnd = this.rnd;
    const type = this.speedClass >= 40 ? 'plane' : 'drone';
    const sp = type === 'plane' ? clamp(this.speedClass * 0.85, 45, 190) : 22;
    const loc = this.world.location;
    const base = player ? player.pos : { x: loc.airSpawn.x, y: 0, z: loc.airSpawn.z };
    // 前方 ±70° の範囲に出して、正面から向かってくる（すぐ交戦になる）
    let fwd;
    if (player && Math.hypot(player.vel.x, player.vel.z) > 3) fwd = Math.atan2(player.vel.z, player.vel.x);
    else { const h = (loc.airSpawn.heading * Math.PI) / 180; fwd = Math.atan2(-Math.cos(h), Math.sin(h)); }
    for (let i = 0; i < n; i++) {
      const ang = fwd + (rnd() - 0.5) * 2.4;
      const d = type === 'plane' ? 1800 + rnd() * 900 : 450 + rnd() * 250;
      const x = base.x + Math.cos(ang) * d;
      const z = base.z + Math.sin(ang) * d;
      const g = Math.max(terr.surfaceAt(x, z), terr.roofAt(x, z));
      const y = Math.max(g + (type === 'plane' ? 350 : 60), (player ? player.pos.y : g + 300) + (rnd() - 0.5) * 150);
      const dir = vnorm({ x: base.x - x, y: 0, z: base.z - z });
      this.enemies.push({
        id: this.enemies.length, type, pos: { x, y, z }, dir, speed: sp, baseSpeed: sp, hp: type === 'plane' ? 36 : 20,
        alive: true, fireT: 0, jinkT: rnd() * 10, r: type === 'plane' ? 7 : 2.8,
        turnRate: type === 'plane' ? (sp > 120 ? 22 : 30) * DEG : 120 * DEG,
        // 1 機ずつ違う位置を狙う（同じ点に集まって 1 機に重ならないように）
        offset: { x: (rnd() - 0.5) * 160, y: (rnd() - 0.5) * 60, z: (rnd() - 0.5) * 160 },
      });
    }
    this.events.push({ type: 'wave', wave: this.wave, count: n });
  }

  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  aliveTargets() { return this.targets.filter((t) => t.alive); }
  aliveEnemies() { return this.enemies.filter((e) => e.alive); }

  /** 他クライアントで割られた等、外部から目標を消す */
  forceKill(targetId) {
    const t = this.targets.find((x) => x.id === targetId);
    if (t && t.alive) { t.alive = false; return true; }
    return false;
  }

  /** 銃口の向き。固定翼は機体前方 */
  gunDirection(vs) {
    const f = qrot(vs.q, FWD);
    if (this.def.model === 'fixedwing') return vnorm(f);
    // 回転翼・人・車: 前傾で常に下を向かないよう、機首の上下は 70% だけ追従
    return vnorm({ x: f.x, y: 0.7 * f.y, z: f.z });
  }

  /** エイムアシスト: 銃口の向きの近くにある目標へ、偏差（未来位置）を見込んで向ける */
  aimAssist(dir, from) {
    const cone = this.def.model === 'fixedwing' ? this.diff.assistPlane : this.diff.assistOther;
    let best = null, bestAng = cone;
    const speed = this.weapon.speed;
    const consider = (pos, vel) => {
      const to = vsub(pos, from);
      const dist = vlen(to);
      if (dist > speed * BULLET_TTL * 0.9) return;
      const t = dist / speed;
      const lead = vadd(pos, vscale(vel || { x: 0, y: 0, z: 0 }, t));
      // 弾の落下を補正
      lead.y += 0.5 * G0 * t * t;
      const ang = angleBetween(dir, vsub(lead, from));
      if (ang < bestAng) { bestAng = ang; best = lead; }
    };
    for (const t of this.targets) if (t.alive) consider(t.pos, null);
    for (const e of this.enemies) if (e.alive) consider(e.pos, vscale(e.dir, e.speed));
    for (const x of this.externalTargets) consider(x.pos, x.vel);
    return best ? vnorm(vsub(best, from)) : dir;
  }

  /**
   * vs: 機体の内部状態（pos, vel, q）、ctl: { fire }
   * env: { world, emit, crash }
   */
  step(vs, ctl, env, dt) {
    if (this.finished) return;
    this.time += dt;
    const player = { pos: vs.pos, vel: vs.vel };
    const bodyR = Math.max(this.def.p.bodyRadius || 1, 1.2);
    const playerR = Math.max(bodyR * 1.6, 3);

    // --- 射撃 ---
    if (this.armed && ctl.fire && this.ammo > 0 && vs.status !== 'crashed') {
      this.fireT += dt;
      const interval = 1 / this.weapon.rate;
      while (this.fireT >= interval && this.ammo > 0) {
        this.fireT -= interval;
        let dir = this.gunDirection(vs);
        const muzzle = vadd(vs.pos, vscale(dir, bodyR + 2));
        dir = this.aimAssist(dir, muzzle);
        const sp = this.weapon.spread;
        dir = vnorm({ x: dir.x + (this.rnd() - 0.5) * sp, y: dir.y + (this.rnd() - 0.5) * sp, z: dir.z + (this.rnd() - 0.5) * sp });
        this.bullets.push({ pos: muzzle, vel: vadd(vs.vel, vscale(dir, this.weapon.speed)), ttl: BULLET_TTL, owner: 'player', dmg: this.weapon.damage });
        this.ammo--;
        this.shots++;
      }
    } else {
      this.fireT = Math.min(this.fireT, 1 / (this.weapon ? this.weapon.rate : 10));
    }

    // --- ロックオン（ミサイル搭載機） ---
    if (this.weapon && this.weapon.missiles) this._updateLock(vs, dt);

    // --- 弾 ---
    const terr = this.world.terrain;
    const keep = [];
    for (const b of this.bullets) {
      const a = b.pos;
      b.vel.y -= G0 * dt;
      const nb = vadd(a, vscale(b.vel, dt));
      b.ttl -= dt;
      let dead = b.ttl <= 0;
      // 目標との当たりを地面より先に見る（地上目標に当たったフレームで地面に先に消されないように）
      if (!dead && b.owner === 'player') {
        for (const t of this.targets) {
          if (t.alive && segmentHitsSphere(a, nb, t.pos, t.r)) { this._damageTarget(t, b.dmg, nb); dead = true; break; }
        }
        if (!dead) for (const e of this.enemies) {
          if (e.alive && segmentHitsSphere(a, nb, e.pos, e.r)) { this._damageEnemy(e, b.dmg, nb); dead = true; break; }
        }
        if (!dead) for (const x of this.externalTargets) {
          if (segmentHitsSphere(a, nb, x.pos, x.r)) { this.hits++; this.emit({ type: 'externalHit', id: x.id, dmg: b.dmg, pos: nb }); dead = true; break; }
        }
      } else if (!dead && b.owner === 'enemy' && segmentHitsSphere(a, nb, vs.pos, playerR)) {
        dead = true;
        this.damagePlayer(b.dmg, env, 'enemy', b.from);
      }
      if (!dead && nb.y < terr.surfaceAt(nb.x, nb.z)) { dead = true; this.emit({ type: 'impact', pos: nb, owner: b.owner }); }
      if (!dead) { b.pos = nb; keep.push(b); }
    }
    this.bullets = keep.length > MAX_BULLETS ? keep.slice(keep.length - MAX_BULLETS) : keep;

    // --- ミサイル ---
    this._updateMissiles(dt);

    // --- 敵 AI ---
    for (const e of this.enemies) if (e.alive) this._updateEnemy(e, player, dt, env, bodyR);
    if (this.maxWaves && this.wave < this.maxWaves && this.enemies.length && this.aliveEnemies().length === 0) this._spawnWave(player);

    // --- 風船への体当たり ---
    for (const t of this.targets) {
      if (t.alive && t.type === 'balloon') {
        const d = vlen(vsub(t.pos, vs.pos));
        if (d < t.r + bodyR + 1) { t.alive = false; this.score += 100; this.emit({ type: 'pop', id: t.id, pos: { ...t.pos }, by: 'ram' }); }
      }
    }

    // --- 終了判定 ---
    const targetsLeft = this.targets.filter((t) => t.alive).length;
    const enemiesLeft = this.aliveEnemies().length;
    const wavesDone = !this.maxWaves || (this.wave >= this.maxWaves && enemiesLeft === 0);
    if (!this.pvp && targetsLeft === 0 && wavesDone) {
      this.finished = true;
      const timeBonus = Math.max(0, Math.round(3000 - this.time * 10));
      this.score += timeBonus;
      this.emit({ type: 'combatFinished', time: this.time, score: this.score, timeBonus, shots: this.shots, hits: this.hits, kills: this.kills, health: this.health });
    }
  }

  /** from: 撃ってきた位置（HUD の被弾方向表示用） */
  /** 着地して飛び直せない機体（滑空機・人）は、その時点のスコアで終わる */
  finishEarly(reason) {
    if (this.finished || this.pvp) return;
    this.finished = true;
    this.emit({ type: 'combatFinished', time: this.time, score: this.score, timeBonus: 0, shots: this.shots, hits: this.hits, kills: this.kills, health: this.health, partial: true, reason, targetsLeft: this.targets.filter((t) => t.alive).length });
  }

  /** 的のリスト（2 人プレイでホストからゲストへ送る） */
  targetList() {
    return this.targets.map((t) => ({ id: t.id, type: t.type, pos: { ...t.pos }, r: t.r, color: t.color }));
  }

  damagePlayer(dmg, env, by = 'enemy', from = null) {
    if (this.health <= 0 || this.invulnerable) return;
    this.health = Math.max(0, this.health - dmg);
    this.emit({ type: 'playerHit', dmg, health: this.health, by, from: from ? { ...from } : null });
    if (this.health <= 0 && env) env.crash(by === 'remote' ? '相手に撃墜されました' : '撃墜されました');
  }

  _damageTarget(t, dmg, pos) {
    this.hits++;
    t.hp -= dmg;
    if (t.hp <= 0 || t.type === 'balloon') {
      t.alive = false;
      this.score += t.type === 'balloon' ? 100 : 250;
      this.emit({ type: t.type === 'balloon' ? 'pop' : 'kill', id: t.id, pos: { ...t.pos }, target: t.type });
    } else this.emit({ type: 'hit', pos, target: t.type });
  }

  _damageEnemy(e, dmg, pos) {
    this.hits++;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.alive = false;
      this.kills++;
      this.score += 500;
      this.emit({ type: 'kill', pos: { ...e.pos }, target: 'enemy', enemy: e.id });
    } else this.emit({ type: 'hit', pos, target: 'enemy' });
  }

  _updateLock(vs, dt) {
    const W = this.weapon;
    const f = qrot(vs.q, FWD);
    let best = -1, bestAng = W.lockCone;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = vsub(e.pos, vs.pos);
      const d = vlen(to);
      if (d > W.lockRange) continue;
      const ang = angleBetween(f, to);
      if (ang < bestAng) { bestAng = ang; best = e.id; }
    }
    const L = this.lock;
    if (best < 0) { L.target = -1; L.progress = 0; L.locked = false; return; }
    if (best !== L.target) { L.target = best; L.progress = 0; L.locked = false; }
    L.progress = Math.min(1, L.progress + dt / W.lockTime);
    if (!L.locked && L.progress >= 1) { L.locked = true; this.emit({ type: 'lock', enemy: best }); }
  }

  /** ミサイル発射（ロック中の敵へ）。戻り値: 発射できたか */
  fireMissile(vs) {
    if (!this.weapon || !this.weapon.missiles || this.missilesLeft <= 0) return false;
    if (!this.lock.locked) { this.emit({ type: 'noLock' }); return false; }
    const f = vnorm(qrot(vs.q, FWD));
    this.missiles.push({ pos: vadd(vs.pos, vscale(f, 4)), vel: vadd(vs.vel, vscale(f, 40)), target: this.lock.target, ttl: 10, alive: true });
    this.missilesLeft--;
    this.emit({ type: 'missile' });
    return true;
  }

  _updateMissiles(dt) {
    for (const m of this.missiles) {
      if (!m.alive) continue;
      m.ttl -= dt;
      const tgt = this.enemies[m.target];
      const sp = Math.min(650, vlen(m.vel) + 250 * dt);
      let dir = vnorm(m.vel);
      if (tgt && tgt.alive) {
        // 比例航法の代わりに未来位置への誘導（旋回率 35°/s 上限）
        const to = vsub(tgt.pos, m.pos);
        const t = vlen(to) / sp;
        const aim = vadd(tgt.pos, vscale(tgt.dir, tgt.speed * t));
        dir = rotateToward(dir, vsub(aim, m.pos), 35 * DEG * dt);
        const prev = m.pos;
        m.vel = vscale(dir, sp);
        m.pos = vadd(m.pos, vscale(m.vel, dt));
        if (segmentHitsSphere(prev, m.pos, tgt.pos, tgt.r + 12)) {
          m.alive = false;
          this._damageEnemy(tgt, 999, m.pos);
          continue;
        }
      } else {
        m.vel = vscale(dir, sp);
        m.pos = vadd(m.pos, vscale(m.vel, dt));
      }
      if (m.ttl <= 0 || m.pos.y < this.world.terrain.surfaceAt(m.pos.x, m.pos.z)) {
        m.alive = false;
        this.emit({ type: 'impact', pos: { ...m.pos }, owner: 'missile' });
      }
    }
    this.missiles = this.missiles.filter((m) => m.alive);
  }

  _updateEnemy(e, player, dt, env, bodyR) {
    const terr = this.world.terrain;
    const to = vsub(player.pos, e.pos);
    const dist = vlen(to);
    e.jinkT += dt;
    let desired;
    if (e.type === 'plane') {
      // 追尾（未来位置）。近すぎたら離脱して上昇
      const t = clamp(dist / 300, 0.3, 2.5);
      // 遠いうちは機ごとのずらしを足し、近づくほど本人を狙う
      const k = clamp((dist - 300) / 900, 0, 1);
      const lead = vadd(vadd(player.pos, vscale(player.vel, t)), vscale(e.offset, k));
      desired = vnorm(vsub(lead, e.pos));
      if (dist < 140) desired = vnorm(vadd(vscale(vnorm(to), -1), { x: 0, y: 0.6, z: 0 }));
      // 回避の揺さぶり
      desired = vnorm(vadd(desired, { x: Math.sin(e.jinkT * 0.7 + e.id) * 0.25, y: 0, z: Math.cos(e.jinkT * 0.9 + e.id) * 0.25 }));
    } else {
      // ドローン: 目標の周りを一定距離で回りながら撃つ
      const standoff = 70;
      const radial = vnorm(to);
      const tangent = vnorm(vcross(radial, { x: 0, y: 1, z: 0 }));
      desired = vnorm(vadd(vscale(radial, (dist - standoff) / 30), vscale(tangent, Math.sin(e.jinkT * 0.5 + e.id) > 0 ? 0.8 : -0.8)));
      desired.y += clamp((player.pos.y + 10 - e.pos.y) / 40, -0.5, 0.5);
      desired = vnorm(desired);
    }
    // 地形回避（3 秒先が低すぎたら引き起こす）
    const look = vadd(e.pos, vscale(e.dir, e.speed * 3));
    const gLook = Math.max(terr.surfaceAt(look.x, look.z), terr.roofAt(look.x, look.z));
    const gHere = Math.max(terr.surfaceAt(e.pos.x, e.pos.z), terr.roofAt(e.pos.x, e.pos.z));
    const minAgl = e.type === 'plane' ? 120 : 25;
    if (look.y - gLook < minAgl || e.pos.y - gHere < minAgl) desired = vnorm({ x: desired.x * 0.5, y: 1.2, z: desired.z * 0.5 });
    e.dir = rotateToward(e.dir, desired, e.turnRate * dt);
    if (e.type === 'drone') e.speed = clamp(Math.abs(dist - 70) * 0.4 + 6, 6, 24);
    else {
      // 遠いときはプレイヤーより少し速く飛んで追いつく（逃げ切れない・置いていかれない）
      const pSpeed = vlen(player.vel);
      e.speed = dist > 1200 ? Math.max(e.baseSpeed * 1.35, pSpeed * 1.05) : Math.max(e.baseSpeed, Math.min(pSpeed * 0.95, e.baseSpeed * 1.6));
    }
    e.pos = vadd(e.pos, vscale(e.dir, e.speed * dt));
    if (e.pos.y < gHere + 3) e.pos.y = gHere + 3;
    // 射撃（前方の狭い円錐に入っていれば）
    e.fireT += dt;
    const range = e.type === 'plane' ? 900 : 350;
    if (dist < range && angleBetween(e.dir, to) < 7 * DEG && e.fireT > 0.33) {
      e.fireT = 0;
      const sp = 650;
      const spread = this.diff.enemySpread;
      const r = this.enemyFireRnd;
      const dir = vnorm({ x: to.x / dist + (r() - 0.5) * spread, y: to.y / dist + (r() - 0.5) * spread, z: to.z / dist + (r() - 0.5) * spread });
      this.bullets.push({ pos: vadd(e.pos, vscale(e.dir, e.r + 2)), vel: vadd(vscale(e.dir, e.speed), vscale(dir, sp)), ttl: 2, owner: 'enemy', dmg: this.diff.enemyDmg, from: { ...e.pos } });
      this.emit({ type: 'enemyFire', pos: { ...e.pos } });
    }
    // 衝突
    if (dist < e.r + bodyR + 1) {
      e.alive = false;
      this.emit({ type: 'kill', pos: { ...e.pos }, target: 'enemy', enemy: e.id });
      this.damagePlayer(100, env, 'collision');
    }
  }

  /** 自分を狙っている（機首がこちらを向いて近い）敵。HUD の警告と方向表示用 */
  threats(pos) {
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = vsub(pos, e.pos);
      const d = vlen(to);
      if (d < (e.type === 'plane' ? 1300 : 400) && angleBetween(e.dir, to) < 20 * DEG) out.push({ pos: { ...e.pos }, dist: d });
    }
    return out;
  }

  summary(pos) {
    return {
      threats: pos ? this.threats(pos) : [],
      score: this.score,
      health: this.health,
      ammo: this.ammo,
      armed: this.armed,
      weaponName: this.weapon ? this.weapon.name : null,
      missiles: this.missilesLeft,
      lock: { ...this.lock },
      targetsLeft: this.targets.filter((t) => t.alive).length,
      targetsTotal: this.targets.length,
      enemiesLeft: this.aliveEnemies().length,
      wave: this.wave,
      maxWaves: this.maxWaves,
      time: this.time,
      shots: this.shots,
      hits: this.hits,
      kills: this.kills,
      finished: this.finished,
    };
  }
}
