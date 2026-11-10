// 第 4 弾: 曲技の採点・スター集め
import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/sim.js';
import { modesFor } from '../../src/sim/modes.js';
import { StuntTracker, stuntEligible, stuntGrade, TRICKS, MAX_MULT } from '../../src/sim/stunts.js';
import { createStars, starKind, starRadius, segmentDist, AIR_STARS, GROUND_STARS } from '../../src/sim/stars.js';
import { VEHICLES, VEHICLE_ORDER } from '../../src/data/vehicles.js';
import { LOCATION_ORDER, MODES, MODE_ORDER } from '../../src/data/locations.js';
import { Progress, ACHIEVEMENTS } from '../../src/game/progress.js';
import { dailyScore } from '../../src/game/daily.js';

/** script: [[秒, 入力], ...] を流して、出たイベントを集める */
function fly(vehicle, script, opts = {}) {
  const sim = new Simulation();
  sim.load(vehicle, opts.location || 'island', { mode: 'stunt', calm: true, ...opts });
  const events = [];
  for (const [secs, inp] of script) {
    sim.setInput(inp);
    for (let i = 0; i < secs * 60; i++) {
      sim.step(1);
      events.push(...sim.drainEvents());
    }
  }
  return { sim, events, tricks: events.filter((e) => e.type === 'stunt').map((e) => e.kind) };
}

describe('曲技の判定', () => {
  it('戦闘機: ロールを続けると 1 回転ごとに数え、繰り返すと点が下がる', () => {
    const { events, tricks } = fly('fighter', [[2, { throttle: 1 }], [4, { roll: 1, throttle: 1 }]]);
    const rolls = events.filter((e) => e.type === 'stunt' && e.kind === 'roll');
    expect(rolls.length).toBeGreaterThanOrEqual(2);
    expect(rolls[0].points).toBe(TRICKS.roll.points);
    expect(rolls[1].points).toBeLessThan(rolls[0].points);
    expect(tricks).not.toContain('loop');
  });

  it('戦闘機・小型機・グライダー: 引き続けると宙返りが決まる', () => {
    expect(fly('fighter', [[2, { throttle: 1 }], [20, { pitch: 0.6, throttle: 1 }]]).tricks).toContain('loop');
    expect(fly('prop', [[4, { throttle: 1, pitch: -0.4 }], [12, { pitch: 1, throttle: 1 }]]).tricks).toContain('loop');
    expect(fly('sailplane', [[5, { pitch: -0.6 }], [11, { pitch: 1 }]]).tricks).toContain('loop');
  });

  it('普通の旋回（360° 以上回り続ける）は技にならない', () => {
    const { tricks, sim } = fly('prop', [[2, { throttle: 1 }], [40, { roll: 0.6, pitch: 0.2, throttle: 1 }]]);
    expect(tricks).toEqual([]);
    expect(sim.getState().stunt.total).toBe(0);
  });

  it('コンボ: 最後の技から 4 秒で確定して合計に入る', () => {
    const { events, sim } = fly('fighter', [[2, { throttle: 1 }], [3, { roll: 1, throttle: 1 }], [6, { roll: 0, throttle: 1 }]]);
    const banked = events.filter((e) => e.type === 'stuntCombo');
    expect(banked.length).toBeGreaterThanOrEqual(1);
    const st = sim.getState().stunt;
    expect(st.total).toBe(banked.reduce((a, e) => a + e.score, 0));
    expect(st.bestCombo).toBe(Math.max(...banked.map((e) => e.score)));
  });

  it('技の種類が増えると倍率が上がり、上限は ×5', () => {
    const sim = new Simulation();
    sim.load('fighter', 'island', { mode: 'stunt', calm: true });
    const tr = new StuntTracker(sim.def, sim.world, {});
    const out = [];
    const emit = (type, d) => out.push({ type, ...d });
    for (const k of ['roll', 'loop', 'inverted', 'knife', 'low', 'gap', 'touchgo']) tr._award(k, emit);
    expect(tr.mult).toBe(MAX_MULT);
    const sum = tr.combo.sum;
    expect(tr.bank(emit)).toBe(sum * MAX_MULT);
    expect(tr.total).toBe(sum * MAX_MULT);
    expect(tr.summary().count).toBe(0);
  });

  it('墜落すると確定前のコンボは失う', () => {
    const sim = new Simulation();
    sim.load('fighter', 'island', { mode: 'stunt', calm: true });
    sim.setInput({ throttle: 1, roll: 1 });
    sim.step(200);
    expect(sim.getState().stunt.combo).toBeGreaterThan(0);
    sim.crash('テスト');
    const st = sim.getState().stunt;
    expect(st.combo).toBe(0);
    expect(st.total).toBe(0);
  });

  it('超低空: 一度高く上がってから、地面すれすれを速く飛ぶと点が入る', () => {
    const sim = new Simulation();
    sim.load('fighter', 'island', { mode: 'free', calm: true });
    const tr = sim.stunts;
    const terr = sim.world.terrain;
    const out = [];
    const emit = (type, d) => out.push({ type, ...d });
    // 海の上を水平に進む状態を直接与える
    const x = -4000, z = 4000;
    const g = terr.surfaceAt(x, z);
    const q = { ...sim.vs.q };
    for (let i = 0; i < 60; i++) tr.step({ pos: { x, y: g + 300, z: z - i }, vel: { x: 0, y: 0, z: -150 }, q, onGround: false }, 1 / 60, emit);
    expect(out.filter((e) => e.kind === 'low')).toEqual([]);
    for (let i = 0; i < 200; i++) tr.step({ pos: { x, y: g + 8, z: z - 60 - i }, vel: { x: 0, y: 0, z: -150 }, q, onGround: false }, 1 / 60, emit);
    expect(out.filter((e) => e.kind === 'low').length).toBe(3);
  });

  it('曲技モードは制限時間で終わり、評価つきの結果が出る', () => {
    const { sim, events } = fly('fighter', [[2, { throttle: 1 }], [3, { roll: 1, throttle: 1 }], [4, { roll: 0, throttle: 1 }]], { stuntTime: 8 });
    expect(sim.status).toBe('finished');
    const res = events.find((e) => e.type === 'result').result;
    expect(res.type).toBe('stunt');
    expect(res.score).toBeGreaterThan(0);
    expect(res.score).toBe(sim.getState().stunt.total);
    expect(res.counts.roll).toBeGreaterThanOrEqual(1);
    expect(['S', 'A', 'B', 'C']).toContain(res.grade);
    expect(dailyScore(res)).toBe(res.score);
  });

  it('評価のしきい値', () => {
    expect(stuntGrade(0)).toBe('C');
    expect(stuntGrade(3000)).toBe('B');
    expect(stuntGrade(7000)).toBe('A');
    expect(stuntGrade(12000)).toBe('S');
  });

  it('遊べる機体: 固定翼・回転翼・ジェットスーツ・空飛ぶ車。車・気球・滑空する人は対象外', () => {
    for (const id of VEHICLE_ORDER) {
      const def = VEHICLES[id];
      expect(modesFor(def).includes('stunt'), id).toBe(stuntEligible(def));
    }
    expect(stuntEligible(VEHICLES.prop)).toBe(true);
    expect(stuntEligible(VEHICLES.drone)).toBe(true);
    expect(stuntEligible(VEHICLES.driftcar)).toBe(false);
    expect(stuntEligible(VEHICLES.balloon)).toBe(false);
    expect(stuntEligible(VEHICLES.paraglider)).toBe(false);
    expect(MODES.stunt.name).toBe('曲技');
    expect(MODE_ORDER).toContain('stunt');
  });

  it('フリーでも採点し、練習（stunts: false）・リングでは採点しない', () => {
    const sim = new Simulation();
    expect(sim.load('prop', 'island', { mode: 'free' }).stunt.left).toBe(null);
    expect(sim.load('prop', 'island', { mode: 'free', stunts: false }).stunt).toBeUndefined();
    expect(sim.load('prop', 'island', { mode: 'rings' }).stunt).toBeUndefined();
    expect(sim.load('driftcar', 'raceway', { mode: 'free' }).stunt).toBeUndefined();
  });

  it('曲技モードは全ロケーション・全対象機体で空中から始まり、5 秒は墜落しない', () => {
    for (const loc of LOCATION_ORDER) {
      for (const id of VEHICLE_ORDER.filter((v) => stuntEligible(VEHICLES[v]))) {
        const sim = new Simulation();
        const st = sim.load(id, loc, { mode: 'stunt', calm: true });
        expect(st.onGround, `${id}@${loc}`).toBe(false);
        sim.step(300);
        expect(sim.status, `${id}@${loc}`).toBe('flying');
      }
    }
  });
});

describe('背面での姿勢保持（練習機）', () => {
  it('引いていないときは、背面から水平へ戻る', () => {
    const sim = new Simulation();
    sim.load('prop', 'island', { mode: 'free', calm: true, spawn: { pos: { x: 0, y: 1500, z: 3000 }, heading: 0, speed: 55 } });
    // 宙返りの頂点（背面）まで引いてから手を離す
    sim.setInput({ throttle: 1, pitch: 1 });
    let n = 0;
    while (Math.abs(sim.getState().attitude.roll) < 150 && n++ < 900) sim.step(1);
    expect(Math.abs(sim.getState().attitude.roll)).toBeGreaterThan(150);
    sim.setInput({ pitch: 0 });
    sim.step(60 * 8);
    expect(Math.abs(sim.getState().attitude.roll)).toBeLessThan(25);
    expect(sim.status).toBe('flying');
  });
});

describe('スター集め', () => {
  it('全ロケーションに空 15 個・地上 12 個。毎回同じ場所で、地面やビルにめり込まない', () => {
    for (const loc of LOCATION_ORDER) {
      const sim = new Simulation();
      sim.load('prop', loc, { mode: 'free', stars: [] });
      const terr = sim.world.terrain;
      const air = createStars(sim.world, 'air');
      const ground = createStars(sim.world, 'ground');
      expect(air.length, loc).toBe(AIR_STARS);
      expect(ground.length, loc).toBe(GROUND_STARS);
      expect(createStars(sim.world, 'air')).toEqual(air);
      for (const s of air) {
        const top = Math.max(terr.surfaceAt(s.pos.x, s.pos.z), terr.roofAt(s.pos.x, s.pos.z));
        expect(s.pos.y - top, `${loc} ${s.tier}`).toBeGreaterThanOrEqual(15);
        expect(Math.abs(s.pos.x), loc).toBeLessThan(terr.half);
        expect(Math.abs(s.pos.z), loc).toBeLessThan(terr.half);
      }
      for (const s of ground) expect(s.pos.y - terr.heightAt(s.pos.x, s.pos.z), loc).toBeCloseTo(1.3, 5);
      // 星どうしが重ならない
      for (let i = 0; i < air.length; i++) for (let j = i + 1; j < air.length; j++) expect(Math.hypot(air[i].pos.x - air[j].pos.x, air[i].pos.z - air[j].pos.z), loc).toBeGreaterThan(100);
    }
  });

  it('星を通り抜けると取れて、イベントと状態に反映される', () => {
    const sim = new Simulation();
    sim.load('prop', 'island', { mode: 'free', stars: [] });
    const s = sim.stars.list[1].pos;
    sim.load('prop', 'island', { mode: 'free', calm: true, stars: [], spawn: { pos: { x: s.x, y: s.y, z: s.z + 260 }, heading: 0, speed: 50 } });
    expect(sim.getState().stars).toMatchObject({ total: AIR_STARS, got: 0 });
    expect(sim.getState().stars.nearest.index).toBe(1);
    sim.setInput({ throttle: 0.7 });
    const evs = [];
    for (let i = 0; i < 420; i++) { sim.step(1); evs.push(...sim.drainEvents()); }
    const got = evs.filter((e) => e.type === 'star');
    expect(got.length).toBe(1);
    expect(got[0]).toMatchObject({ index: 1, got: 1, total: AIR_STARS, complete: false });
    expect(sim.getState().stars.got).toBe(1);
    expect(sim.getState().stars.nearest.index).not.toBe(1);
  });

  it('集め済みの星は出ない。最後の 1 個で complete になる', () => {
    const sim = new Simulation();
    sim.load('prop', 'island', { mode: 'free', stars: [] });
    const s = sim.stars.list[1].pos;
    const others = sim.stars.list.map((_, i) => i).filter((i) => i !== 1);
    sim.load('prop', 'island', { mode: 'free', calm: true, stars: [...others, 99, -1, 'x'], spawn: { pos: { x: s.x, y: s.y, z: s.z + 200 }, heading: 0, speed: 50 } });
    expect(sim.getState().stars.got).toBe(AIR_STARS - 1);
    sim.setInput({ throttle: 0.7 });
    const evs = [];
    for (let i = 0; i < 360; i++) { sim.step(1); evs.push(...sim.drainEvents()); }
    expect(evs.find((e) => e.type === 'star')).toMatchObject({ complete: true, got: AIR_STARS });
    expect(sim.getState().stars.nearest).toBe(null);
  });

  it('フリー以外・stars を渡さないときは出ない', () => {
    const sim = new Simulation();
    expect(sim.load('prop', 'island', { mode: 'free' }).stars).toBeUndefined();
    expect(sim.load('prop', 'island', { mode: 'rings', stars: [] }).stars).toBeUndefined();
  });

  it('車は地上の星（コース上）を走って取れる', () => {
    const sim = new Simulation();
    sim.load('driftcar', 'raceway', { mode: 'free', stars: [] });
    expect(starKind(sim.def)).toBe('ground');
    expect(sim.stars.list.length).toBe(GROUND_STARS);
    const track = sim.world.terrain.track;
    for (const s of sim.stars.list) expect(track.onRoad(s.pos.x, s.pos.z)).toBeTruthy();
    expect(starRadius(sim.def)).toBeGreaterThan(3);
    expect(starRadius(VEHICLES.airliner)).toBeGreaterThan(starRadius(VEHICLES.drone));
  });

  it('segmentDist: 線分と点の最短距離', () => {
    expect(segmentDist({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 3, z: 0 })).toBeCloseTo(3);
    expect(segmentDist({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 14, y: 3, z: 0 })).toBeCloseTo(5);
    expect(segmentDist({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 5, z: 1 })).toBeCloseTo(4);
  });
});

describe('実績（曲技・スター）', () => {
  it('宙返り・コンボ・スターの実績が解除される', () => {
    const mem = {};
    const store = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
    const p = new Progress(store, 'k', { vehicleCount: 18, locationCount: 6, lessonCount: 5 });
    p.add('loops');
    p.max('stuntBest', 3200);
    p.add('stars', 10);
    p.add('starSets');
    const ids = p.drain().map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['loop', 'combo_3k', 'stars_10', 'stars_set']));
    expect(ids).not.toContain('rolls_20');
    for (const id of ['loop', 'rolls_20', 'low_60', 'combo_3k', 'stunt_s', 'stars_10', 'stars_set']) expect(ACHIEVEMENTS.some((a) => a.id === id), id).toBe(true);
    // 古い保存データ（新しい項目が無い）でも落ちない
    mem.old = { stats: { takeoffs: 1 }, unlocked: {} };
    const p2 = new Progress(store, 'old', { vehicleCount: 18, locationCount: 6, lessonCount: 5 });
    expect(p2.stats.loops).toBe(0);
    expect(p2.stats.stars).toBe(0);
  });
});
