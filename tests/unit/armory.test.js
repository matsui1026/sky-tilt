// 第 5 弾: 改造機・改造（ハンガー）・武装フリー・ロケット弾
import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/sim.js';
import { Combat } from '../../src/sim/combat.js';
import { VEHICLES, VEHICLE_ORDER, visualId } from '../../src/data/vehicles.js';
import { applyMods, modChoices, modStats, isStock, canModify, MOD_SLOTS } from '../../src/data/mods.js';
import { CRUISE, modesFor } from '../../src/sim/modes.js';
import { LOCATION_ORDER } from '../../src/data/locations.js';

const NEW = ['racer', 'warbird', 'rocketplane', 'gunship', 'racedrone'];

/** 高度・姿勢を保つ簡単な自動操縦で secs 秒飛ぶ */
function holdLevel(sim, secs, alt) {
  const ht = sim.hoverThrottleAt(sim.vs.pos.y);
  for (let i = 0; i < secs * 60 && sim.status === 'flying'; i++) {
    const st = sim.getState();
    sim.setInput({ throttle: ht ?? 0.8, pitch: Math.max(-0.4, Math.min(0.4, (alt - st.altitude) * 0.01 - st.vs * 0.05)), roll: Math.max(-0.5, Math.min(0.5, -st.attitude.roll * 0.02)) });
    sim.step(1);
  }
  return sim.getState();
}

describe('改造機（派生した機体）', () => {
  it('5 機が並び順に入り、元の機体の見た目を借りる', () => {
    for (const id of NEW) {
      expect(VEHICLE_ORDER).toContain(id);
      const d = VEHICLES[id];
      expect(d.id).toBe(id);
      expect(VEHICLES[d.base]).toBeTruthy();
      expect(visualId(d)).toBe(d.base);
      expect(CRUISE[id], id).toBeGreaterThan(0);
      expect(d.weapon, id).toBeTruthy();
    }
    expect(new Set(VEHICLE_ORDER).size).toBe(VEHICLE_ORDER.length);
    expect(VEHICLE_ORDER.length).toBe(Object.keys(VEHICLES).length);
  });

  it('元の機体の定義は変わらない（深いコピー）', () => {
    expect(VEHICLES.prop.p.roll.bankCmd).toBeGreaterThan(0);
    expect(VEHICLES.racer.p.roll.bankCmd).toBe(null);
    expect(VEHICLES.prop.p.mass).toBe(850);
    expect(VEHICLES.fighter.weapon.missiles).toBe(4);
    expect(VEHICLES.rocketplane.weapon.missiles).toBe(6);
    expect(VEHICLES.rocketplane.weapon.rate).toBe(VEHICLES.fighter.weapon.rate);
    expect(VEHICLES.warbird.buttons.map((b) => b.id)).toContain('gear');
    expect(VEHICLES.prop.buttons.map((b) => b.id)).not.toContain('gear');
  });

  it('空中で水平飛行を保てて、それぞれ元の機体より速い・強い', () => {
    const top = {};
    for (const id of ['prop', 'racer', 'warbird', 'fighter', 'rocketplane']) {
      const sim = new Simulation();
      sim.load(id, 'island', { calm: true, spawn: { pos: { x: 0, y: 1500, z: 3000 }, heading: 0, speed: id === 'fighter' || id === 'rocketplane' ? 220 : 70 } });
      const st = holdLevel(sim, 30, 1500);
      expect(sim.status, id).toBe('flying');
      expect(Math.abs(st.altitude - 1500), id).toBeLessThan(40);
      top[id] = st.speed;
    }
    expect(top.racer).toBeGreaterThan(top.prop * 1.3);
    expect(top.warbird).toBeGreaterThan(top.prop * 1.4);
    expect(top.rocketplane).toBeGreaterThan(top.fighter);
  });

  it('回転翼の改造機もホバリングできる', () => {
    for (const id of ['gunship', 'racedrone']) {
      const sim = new Simulation();
      sim.load(id, 'island', { calm: true, spawn: { pos: { x: 0, y: 600, z: 3000 }, heading: 0, speed: 0 } });
      const st = holdLevel(sim, 20, 600);
      expect(sim.status, id).toBe('flying');
      expect(Math.abs(st.altitude - 600), id).toBeLessThan(10);
    }
  });

  it('レーサーは練習機と違い、傾けたままならロールし続ける', () => {
    const roll = (id) => {
      const sim = new Simulation();
      sim.load(id, 'island', { calm: true, spawn: { pos: { x: 0, y: 1500, z: 3000 }, heading: 0, speed: 60 } });
      sim.setInput({ throttle: 0.8, roll: 1 });
      let acc = 0, prev = sim.getState().attitude.roll;
      for (let i = 0; i < 120; i++) { sim.step(1); const r = sim.getState().attitude.roll; let d = r - prev; if (d > 180) d -= 360; if (d < -180) d += 360; acc += d; prev = r; }
      return acc;
    };
    expect(roll('racer')).toBeGreaterThan(360);
    expect(Math.abs(roll('prop'))).toBeLessThan(90);
  });

  it('全ロケーション・全モードで読み込める', () => {
    for (const id of NEW) {
      for (const loc of LOCATION_ORDER) {
        for (const mode of modesFor(VEHICLES[id])) {
          const sim = new Simulation();
          sim.load(id, loc, { mode, calm: true });
          sim.step(60);
          expect(Number.isFinite(sim.vs.pos.y), `${id}@${loc}/${mode}`).toBe(true);
        }
      }
    }
  });
});

describe('改造（ハンガー）', () => {
  it('標準のままなら元の定義をそのまま返す', () => {
    expect(applyMods(VEHICLES.prop, null)).toBe(VEHICLES.prop);
    expect(applyMods(VEHICLES.prop, { arms: 'stock', engine: 'stock', body: 'stock' })).toBe(VEHICLES.prop);
    expect(isStock({})).toBe(true);
    expect(isStock({ engine: 'turbo' })).toBe(false);
  });

  it('プロペラ機にミサイルとロケットを積める。元の定義は変わらない', () => {
    const d = applyMods(VEHICLES.prop, { arms: 'full' });
    expect(d.weapon.missiles).toBe(4);
    expect(d.weapon.rockets).toBe(12);
    expect(d.weapon.lockTime).toBeGreaterThan(0);
    expect(d.p.mass).toBeCloseTo(850 * 1.1);
    expect(VEHICLES.prop.weapon.missiles).toBeUndefined();
    expect(VEHICLES.prop.p.mass).toBe(850);
  });

  it('武器の無い機体（旅客機・パラグライダー）にも武器を付けられる。非武装にもできる', () => {
    expect(applyMods(VEHICLES.airliner, { arms: 'gun' }).weapon.ammo).toBeGreaterThan(0);
    expect(applyMods(VEHICLES.paraglider, { arms: 'rocket' }).weapon.rockets).toBe(12);
    expect(applyMods(VEHICLES.fighter, { arms: 'none' }).weapon).toBe(null);
  });

  it('エンジンで推力、機体で質量・装甲・機動性が変わる', () => {
    const b = modStats(VEHICLES.fighter);
    const t = modStats(applyMods(VEHICLES.fighter, { engine: 'turbo' }));
    expect(t.thrust / b.thrust).toBeCloseTo(1.55);
    const a = applyMods(VEHICLES.heli, { body: 'armor' });
    expect(a.armor).toBeCloseTo(0.6);
    expect(a.p.mass).toBeCloseTo(2500 * 1.15);
    const ag = applyMods(VEHICLES.fighter, { body: 'agile' });
    expect(ag.p.roll.maxRate).toBeCloseTo(VEHICLES.fighter.p.roll.maxRate * 1.3);
    expect(ag.p.gLimit.pos).toBe(11);
    const eco = applyMods(VEHICLES.drone, { engine: 'eco' });
    expect(eco.p.battery.burnTime).toBeCloseTo(600 * 1.6);
    // 攻撃ヘリは元から装甲。軽量化で 1.3 倍
    expect(applyMods(VEHICLES.gunship, { body: 'light' }).armor).toBeCloseTo(0.6 * 1.3);
  });

  it('エンジンの無い機体はエンジンを選べず、車は改造できない', () => {
    expect(modChoices(VEHICLES.paraglider).engine).toEqual(['stock']);
    expect(modChoices(VEHICLES.sailplane).engine).toEqual(['stock']);
    expect(modChoices(VEHICLES.prop).engine.length).toBe(Object.keys(MOD_SLOTS.engine.options).length);
    expect(applyMods(VEHICLES.paraglider, { engine: 'turbo' })).toBe(VEHICLES.paraglider);
    expect(canModify(VEHICLES.driftcar)).toBe(false);
    expect(applyMods(VEHICLES.driftcar, { engine: 'turbo' })).toBe(VEHICLES.driftcar);
  });

  it('ターボのプロペラ機は標準より速く上昇する', () => {
    const climb = (mods) => {
      const sim = new Simulation();
      sim.load('prop', 'island', { calm: true, mods, spawn: { pos: { x: 0, y: 800, z: 3000 }, heading: 0, speed: 45 } });
      sim.setInput({ throttle: 1, pitch: 0.25 });
      sim.step(60 * 15);
      return sim.getState().altitude;
    };
    expect(climb({ engine: 'turbo' })).toBeGreaterThan(climb(null) + 40);
  });

  it('装甲は受けるダメージを減らす', () => {
    const sim = new Simulation();
    sim.load('heli', 'island', { mode: 'combat', mods: { body: 'armor' } });
    sim.combat.damagePlayer(50, sim._env);
    expect(sim.combat.health).toBeCloseTo(70);
  });
});

describe('武装フリー', () => {
  it('フリーで armed を指定すると的が出て、射撃できる。終わらない', () => {
    const sim = new Simulation();
    const st = sim.load('fighter', 'island', { mode: 'free', armed: 'targets' });
    expect(st.combat).toBeTruthy();
    expect(st.combat.sandbox).toBe('targets');
    expect(st.combat.maxWaves).toBe(0);
    expect(sim.load('fighter', 'island', { mode: 'free' }).combat).toBe(null);
    expect(sim.load('driftcar', 'raceway', { mode: 'free', armed: 'battle' }).combat).toBe(null);
  });

  it('的を全部壊すと出し直す（同じ物を使い回す）', () => {
    const sim = new Simulation();
    sim.load('prop', 'island', { mode: 'free', armed: 'targets' });
    const c = sim.combat;
    const n = c.targets.length;
    for (const t of c.targets) t.alive = false;
    sim.step(1);
    expect(c.targets.length).toBe(n);
    expect(c.targets.every((t) => t.alive)).toBe(true);
    expect(sim.status).toBe('flying');
    expect(sim.drainEvents().some((e) => e.type === 'notice')).toBe(true);
  });

  it('「的＋敵機」は敵を全滅させても次の波が来る', () => {
    const sim = new Simulation();
    sim.load('fighter', 'island', { mode: 'free', armed: 'battle', calm: true });
    sim.step(1);
    const c = sim.combat;
    expect(c.wave).toBe(1);
    for (let w = 1; w <= 4; w++) {
      for (const e of c.enemies) e.alive = false;
      sim.step(60 * 7);
    }
    expect(c.wave).toBe(5);
    expect(c.finished).toBe(false);
    expect(c.aliveEnemies().length).toBe(Math.min(6, c.wave + 1));
  });

  it('地上で止まると弾・ミサイル・ロケット・体力を補給する', () => {
    const sim = new Simulation();
    sim.load('prop', 'island', { mode: 'free', armed: 'targets', mods: { arms: 'full' } });
    expect(sim.vs.onGround).toBe(true);
    const c = sim.combat;
    c.ammo = 0; c.missilesLeft = 0; c.rocketsLeft = 0; c.health = 20;
    sim.step(2);
    expect(c.ammo).toBe(sim.def.weapon.ammo);
    expect(c.missilesLeft).toBe(4);
    expect(c.rocketsLeft).toBe(12);
    expect(c.health).toBe(100);
    expect(sim.drainEvents().some((e) => e.type === 'rearm')).toBe(true);
  });

  it('空中ではしばらく撃たれないと体力が少しずつ戻る', () => {
    const sim = new Simulation();
    sim.load('heli', 'island', { mode: 'free', armed: 'targets', calm: true, spawn: { pos: { x: 0, y: 500, z: 3000 }, heading: 0, speed: 0 } });
    const c = sim.combat;
    c.damagePlayer(50, sim._env);
    holdLevel(sim, 4, 500);
    expect(c.health).toBeCloseTo(50, 0);
    holdLevel(sim, 6, 500);
    expect(c.health).toBeGreaterThan(55);
  });

  it('着地しても着陸評価は出ず、滑空機も途中で終わらない', () => {
    const sim = new Simulation();
    sim.load('paraglider', 'island', { mode: 'free', armed: 'targets', calm: true });
    for (let i = 0; i < 60 * 300 && !sim.vs.onGround && sim.status === 'flying'; i++) sim.step(1);
    sim.step(60 * 3);
    expect(sim.result).toBe(null);
    expect(sim.combat.finished).toBe(false);
  });
});

describe('ロケット弾・地上ロック', () => {
  it('ロケット弾は真っすぐ飛んで、周りの的もまとめて壊す', () => {
    const sim = new Simulation();
    sim.load('warbird', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 600, z: 3000 }, heading: 0, speed: 120 } });
    const c = sim.combat;
    const f = c.gunDirection(sim.vs);
    // 正面 400 m に風船を 3 個まとめて置く
    const at = { x: sim.vs.pos.x + f.x * 400, y: sim.vs.pos.y + f.y * 400, z: sim.vs.pos.z + f.z * 400 };
    const bs = c.targets.filter((t) => t.type === 'balloon').slice(0, 3);
    bs.forEach((b, i) => { b.pos = { x: at.x + (i - 1) * 12, y: at.y, z: at.z }; });
    const n0 = c.rocketsLeft;
    expect(sim.action('rocket')).toBe(true);
    expect(c.rocketsLeft).toBe(n0 - 1);
    sim.step(150);
    expect(bs.filter((b) => !b.alive).length).toBe(3);
  });

  it('両方積んでいると、ミサイルの操作はロックしていなければロケットを撃つ', () => {
    const sim = new Simulation();
    sim.load('prop', 'island', { mode: 'free', armed: 'targets', mods: { arms: 'full' }, spawn: { pos: { x: 0, y: 500, z: 3000 }, heading: 0, speed: 50 } });
    expect(sim.action('missile')).toBe(true);
    expect(sim.combat.rocketsLeft).toBe(11);
    expect(sim.combat.missilesLeft).toBe(4);
  });

  it('ロケットが無い機体では撃てない', () => {
    const sim = new Simulation();
    sim.load('fighter', 'island', { mode: 'combat' });
    expect(sim.action('rocket')).toBe(false);
  });

  it('敵機がいなければ地上の的をロックしてミサイルで壊せる', () => {
    const sim = new Simulation();
    sim.load('gunship', 'island', { mode: 'free', armed: 'targets', calm: true });
    const c = sim.combat;
    const g = c.targets.find((t) => t.type === 'ground');
    // 的の手前上空から機首を向ける
    const p = { x: g.pos.x, y: g.pos.y + 300, z: g.pos.z + 700 };
    sim.load('gunship', 'island', { mode: 'free', armed: 'targets', calm: true, targets: c.targetList(), spawn: { pos: p, heading: 0, speed: 0 } });
    const c2 = sim.combat;
    const g2 = c2.targets.find((t) => t.id === g.id);
    // 機首を的へ向ける（真上から見て北、少し下）
    const dir = { x: g2.pos.x - p.x, y: g2.pos.y - p.y, z: g2.pos.z - p.z };
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    const h = Math.sin(pitch / 2), cq = Math.cos(pitch / 2);
    sim.vs.q = { x: h, y: 0, z: 0, w: cq };
    let locked = false;
    for (let i = 0; i < 120; i++) {
      c2._updateLock(sim.vs, 1 / 60);
      if (c2.lock.locked) { locked = true; break; }
    }
    expect(locked).toBe(true);
    expect(c2.lock.target).toBe(`t${g2.id}`);
    expect(c2.fireMissile(sim.vs)).toBe(true);
    for (let i = 0; i < 600 && g2.alive; i++) c2._updateMissiles(1 / 60);
    expect(g2.alive).toBe(false);
  });

  it('Combat: 要約にロケットと武装フリーの情報が入る', () => {
    const sim = new Simulation();
    sim.load('warbird', 'island', { mode: 'free', armed: 'battle' });
    const s = sim.combat.summary(sim.vs.pos);
    expect(s).toMatchObject({ hasRockets: true, rockets: 10, sandbox: 'battle', maxWaves: Infinity });
    expect(new Combat(sim.world, VEHICLES.prop, {}).sandbox).toBe(null);
  });
});
