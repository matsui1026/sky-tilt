import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Simulation, DT } from '../../src/sim/sim.js';
import { stallSpeed } from '../../src/sim/vehicles/fixedwing.js';
import { hoverCollective } from '../../src/sim/vehicles/heli.js';
import { steadyGlide } from '../../src/sim/vehicles/glider.js';
import { airDensity } from '../../src/sim/world.js';
import { rateLanding } from '../../src/sim/modes.js';
import { VEHICLES, VEHICLE_ORDER } from '../../src/data/vehicles.js';
import { LOCATION_ORDER } from '../../src/data/locations.js';

const RAD = 180 / Math.PI;
const sim = new Simulation();
const air = (id, y, speed, extra = {}) =>
  sim.load(id, 'island', { calm: true, spawn: { pos: { x: 0, y, z: 3000 }, heading: 0, speed, ...extra } });

function maxRollRate(id, speed, throttle) {
  air(id, 2000, speed, { throttle });
  sim.setInput({ roll: 1, throttle });
  let m = 0;
  for (let i = 0; i < 180; i++) {
    sim.step(1);
    m = Math.max(m, Math.abs(sim.vs.p) * RAD);
  }
  return m;
}

describe('固定タイムステップ', () => {
  it('60Hz', () => {
    expect(DT).toBeCloseTo(1 / 60, 12);
  });
  it('同じシード・同じ入力なら結果が完全に一致する（再現性）', () => {
    const run = () => {
      const s = new Simulation();
      s.load('fighter', 'mountains', { seed: 42, weather: 'windy' });
      s.setInput({ throttle: 1, pitch: 0.3 });
      s.step(900);
      s.setInput({ roll: 0.4, pitch: 0.2 });
      s.step(300);
      return s.getState();
    };
    const a = run();
    const b = run();
    expect(a.pos).toEqual(b.pos);
    expect(a.quat).toEqual(b.quat);
  });
});

describe('小型プロペラ機', () => {
  it('離陸速度は約 28〜33 m/s', () => {
    sim.load('prop', 'island', { calm: true });
    expect(sim.getState().onGround).toBe(true);
    sim.setInput({ throttle: 1, pitch: 0.6 });
    for (let i = 0; i < 60 * 40 && sim.getState().onGround; i++) sim.step(1);
    const st = sim.getState();
    expect(st.status).toBe('flying');
    expect(st.onGround).toBe(false);
    expect(st.liftoffSpeed).toBeGreaterThanOrEqual(28);
    expect(st.liftoffSpeed).toBeLessThanOrEqual(33);
  });

  it('フラップなしの失速速度は約 23 m/s（理論値と、1G 減速での実測）', () => {
    const vs = stallSpeed(VEHICLES.prop.p, 0);
    expect(vs).toBeGreaterThan(22);
    expect(vs).toBeLessThan(24);
    // 高度を保ちながらアイドルで減速し、失速した瞬間の速度
    air('prop', 1000, 40, { throttle: 0 });
    let st;
    for (let i = 0; i < 60 * 90; i++) {
      st = sim.getState();
      const cmd = Math.max(-1, Math.min(1, 0.02 * (1000 - st.altitude) - 0.15 * st.vs));
      sim.setInput({ throttle: 0, pitch: cmd });
      sim.step(1);
      st = sim.getState();
      if (st.stalled) break;
    }
    expect(st.stalled).toBe(true);
    expect(st.speed).toBeGreaterThan(21.5);
    expect(st.speed).toBeLessThan(25);
  });

  it('フラップで失速速度が下がる', () => {
    expect(stallSpeed(VEHICLES.prop.p, 2)).toBeLessThan(stallSpeed(VEHICLES.prop.p, 0) - 1.5);
  });

  it('一定の傾けでバンク角が一定値に収束する（練習機の素直さ）', () => {
    for (const [inp, expectBank] of [[0.1, 6], [0.3, 18], [-0.5, -30]]) {
      air('prop', 1500, 50, { throttle: 0.6 });
      sim.setInput({ roll: inp, throttle: 0.6 });
      sim.step(60 * 8);
      const b8 = sim.getState().attitude.roll;
      sim.step(60 * 4);
      const st = sim.getState();
      expect(st.attitude.roll).toBeCloseTo(expectBank, -0.5); // ±1.6°
      expect(Math.abs(st.attitude.roll - b8)).toBeLessThan(1);
      expect(Math.abs(st.altitude - 1500)).toBeLessThan(60); // 旋回補正で高度もほぼ保つ
    }
    // 戻すと水平に戻る
    sim.setInput({ roll: 0 });
    sim.step(60 * 4);
    expect(Math.abs(sim.getState().attitude.roll)).toBeLessThan(2);
  });

  it('入力なしでほぼ水平飛行を保つ（素直さ）', () => {
    air('prop', 1500, 50, { throttle: 0.6 });
    sim.setInput({ throttle: 0.6 });
    sim.step(60 * 20);
    const st = sim.getState();
    expect(Math.abs(st.altitude - 1500)).toBeLessThan(40);
    expect(Math.abs(st.attitude.roll)).toBeLessThan(2);
  });
});

describe('旅客機', () => {
  it('バンク角が保護リミット（67°）を超えない', () => {
    air('airliner', 2500, 130, { throttle: 0.7 });
    sim.setInput({ roll: 1, throttle: 0.7 });
    let maxBank = 0;
    for (let i = 0; i < 60 * 30; i++) {
      sim.step(1);
      maxBank = Math.max(maxBank, Math.abs(sim.getState().attitude.roll));
    }
    expect(maxBank).toBeLessThanOrEqual(67.0001);
    expect(maxBank).toBeGreaterThan(60);
    // 離すと 33° 付近まで戻る
    sim.setInput({ roll: 0 });
    sim.step(60 * 20);
    expect(Math.abs(sim.getState().attitude.roll)).toBeLessThan(36);
  });

  it('最大ロールレートは戦闘機の 1/5 以下', () => {
    const f = maxRollRate('fighter', 200, 0.8);
    const a = maxRollRate('airliner', 130, 0.6);
    expect(a).toBeLessThanOrEqual(f / 5);
  });

  it('ピッチ姿勢の保護（+30° / -15°）と失速保護', () => {
    air('airliner', 3000, 110, { throttle: 0.3 });
    sim.setInput({ pitch: 1, throttle: 0.3 });
    let maxPitch = -99, maxAlpha = 0, stalled = false;
    for (let i = 0; i < 60 * 40; i++) {
      sim.step(1);
      const st = sim.getState();
      maxPitch = Math.max(maxPitch, st.attitude.pitch);
      maxAlpha = Math.max(maxAlpha, st.alpha);
      stalled = stalled || st.stalled;
    }
    expect(maxPitch).toBeLessThanOrEqual(30.5);
    expect(stalled).toBe(false);
    expect(maxAlpha).toBeLessThan(VEHICLES.airliner.p.alphaStall * RAD);
    air('airliner', 4000, 130, { throttle: 0.3 });
    sim.setInput({ pitch: -1, throttle: 0.3 });
    let minPitch = 99;
    for (let i = 0; i < 60 * 20; i++) { sim.step(1); minPitch = Math.min(minPitch, sim.getState().attitude.pitch); }
    expect(minPitch).toBeGreaterThanOrEqual(-15.5);
  });

  it('フラップ・ギア・スポイラーが抗力/揚力に効く', () => {
    const p = VEHICLES.airliner.p;
    expect(stallSpeed(p, 2)).toBeLessThan(stallSpeed(p, 0) * 0.85);
    // 比エネルギー高度 h + V²/2g の減り方で比較（FBW が高度と速度をやり取りするため）
    const energy = (st) => st.altitude + st.speed ** 2 / (2 * 9.80665);
    air('airliner', 2500, 120, { throttle: 0.4, gear: false });
    sim.setInput({ throttle: 0.4 });
    const e0 = energy(sim.getState());
    sim.step(60 * 10);
    const clean = e0 - energy(sim.getState());
    air('airliner', 2500, 120, { throttle: 0.4, gear: false });
    sim.setInput({ throttle: 0.4 });
    sim.action('spoiler');
    sim.action('gear');
    sim.step(60 * 10);
    const dirtySt = sim.getState();
    const dirty = e0 - energy(dirtySt);
    expect(dirtySt.gearCmd).toBe(true);
    expect(dirtySt.spoiler).toBe(true);
    expect(dirty).toBeGreaterThan(clean + 20);
  });
});

describe('戦闘機', () => {
  it('ロールレートは 180°/s 以上', () => {
    expect(maxRollRate('fighter', 200, 0.8)).toBeGreaterThanOrEqual(180);
  });

  it('G 制限が効く（9G）', () => {
    air('fighter', 3000, 260, { throttle: 1 });
    sim.setInput({ pitch: 1, throttle: 1 });
    let maxG = 0;
    for (let i = 0; i < 60 * 5; i++) { sim.step(1); maxG = Math.max(maxG, sim.getState().g); }
    expect(maxG).toBeGreaterThan(8.0);
    expect(maxG).toBeLessThanOrEqual(9.0);
  });

  it('低速で引き続けると高迎角で失速し、離すと回復する', () => {
    air('fighter', 3000, 110, { throttle: 0.3 });
    sim.setInput({ pitch: 1, throttle: 0.3 });
    let stalled = false;
    for (let i = 0; i < 60 * 6; i++) { sim.step(1); stalled = stalled || sim.getState().stalled; }
    expect(stalled).toBe(true);
    sim.setInput({ pitch: 0, throttle: 1 });
    sim.step(60 * 8);
    const st = sim.getState();
    expect(st.stalled).toBe(false);
    expect(st.status).toBe('flying');
  });

  it('アフターバーナーで加速が増す', () => {
    const accel = (ab) => {
      air('fighter', 2000, 150, { throttle: 1 });
      sim.setInput({ throttle: 1 });
      if (ab) sim.action('ab');
      sim.step(60 * 5);
      return sim.getState().speed;
    };
    expect(accel(true)).toBeGreaterThan(accel(false) + 10);
  });
});

describe('ヘリコプター', () => {
  it('ホバリング用の一定コレクティブで 10 秒間の高度変化が ±2 m 以内', () => {
    const y0 = 300;
    const c = hoverCollective(VEHICLES.heli.p, airDensity(y0));
    sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: y0, z: 3000 }, heading: 0, speed: 0, throttle: c } });
    sim.setInput({ throttle: c });
    let maxDev = 0;
    for (let i = 0; i < 600; i++) { sim.step(1); maxDev = Math.max(maxDev, Math.abs(sim.getState().altitude - y0)); }
    expect(maxDev).toBeLessThanOrEqual(2);
  });

  it('地面効果で必要なコレクティブが下がる', () => {
    const eq = (hAgl) => {
      let lo = 0.3, hi = 1.0;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: 6 + 1.2 + hAgl, z: -500 }, heading: 0, speed: 0, throttle: mid } });
        sim.vs.rotorRpm = 1;
        sim.setInput({ throttle: mid });
        sim.step(1);
        if (sim.getState().vs > 0) hi = mid; else lo = mid;
      }
      return (lo + hi) / 2;
    };
    const ige = eq(1);
    const oge = eq(60);
    expect(ige).toBeLessThan(oge * 0.92);
  });

  it('転移揚力: 前進速度があると同じコレクティブでも推力が増す', () => {
    const c = 0.6;
    sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: 400, z: 3000 }, heading: 0, speed: 0, throttle: c } });
    sim.setInput({ throttle: c });
    sim.step(1);
    const t0 = sim.vs.thrust;
    sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: 400, z: 3000 }, heading: 0, speed: 15, throttle: c } });
    sim.setInput({ throttle: c });
    sim.step(1);
    expect(sim.vs.thrust).toBeGreaterThan(t0 * 1.08);
  });

  it('サイクリックを前に倒すと前進する', () => {
    sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
    sim.setInput({ pitch: -0.6 });
    sim.step(60 * 6);
    const st = sim.getState();
    expect(-st.vel.z).toBeGreaterThan(10); // 北（-z）へ
  });
});

describe('パラグライダー', () => {
  it('トリム速度は約 10〜11 m/s、沈下率は約 1.0〜1.3 m/s（静穏大気・低高度）', () => {
    air('paraglider', 450, 10);
    sim.step(60 * 40);
    const st = sim.getState();
    expect(st.speed).toBeGreaterThanOrEqual(10);
    expect(st.speed).toBeLessThanOrEqual(11);
    expect(-st.vs).toBeGreaterThanOrEqual(1.0);
    expect(-st.vs).toBeLessThanOrEqual(1.3);
  });

  it('サーマル内では上昇する', () => {
    sim.load('paraglider', 'island', { calm: true, thermals: [{ x: 0, z: 3000, radius: 150, strength: 3, top: 2000, ground: 0 }], spawn: { pos: { x: 0, y: 500, z: 3000 }, heading: 0, speed: 10.5 } });
    sim.setInput({ roll: 0.6 });
    const a0 = sim.getState().altitude;
    sim.step(60 * 30);
    expect(sim.getState().altitude).toBeGreaterThan(a0 + 10);
  });

  it('斜面上昇風: 風上の斜面の上では静穏時より機体の沈下が小さい', () => {
    sim.load('paraglider', 'mountains', { weather: 'cloudy', seed: 7, thermals: [] });
    const sp = sim.spawn;
    expect(sim.world.airVelocity(sp.pos, 0).y).toBeGreaterThan(0.5);
    // 尾根に沿って 10 秒飛ぶ（サーマルなし）
    sim.step(60 * 10);
    const ridgeVs = sim.getState().vs;
    sim.load('paraglider', 'mountains', { calm: true, seed: 7, spawn: { pos: sp.pos, heading: sp.heading * 180 / Math.PI, speed: 10.5 } });
    sim.step(60 * 10);
    const calmVs = sim.getState().vs;
    expect(ridgeVs).toBeGreaterThan(calmVs + 0.5);
  });

  it('両ブレークで減速、片側ブレークで旋回', () => {
    air('paraglider', 450, 10.5);
    sim.setInput({ pitch: 0.8 });
    sim.step(60 * 10);
    expect(sim.getState().speed).toBeLessThan(9.5);
    air('paraglider', 450, 10.5);
    sim.setInput({ roll: 0.7 });
    sim.step(60 * 6);
    const h = sim.getState().attitude.heading;
    expect(h).toBeGreaterThan(20);
    expect(h).toBeLessThan(359);
  });
});

describe('ウイングスーツ', () => {
  it('滑空比は約 2〜3', () => {
    sim.load('wingsuit', 'island', { calm: true, spawn: { pos: { x: 0, y: 3000, z: 3000 }, heading: 0, speed: 30, phase: 'wingsuit' } });
    sim.step(60 * 25);
    const st = sim.getState();
    expect(st.phase).toBe('wingsuit');
    expect(st.glideRatio).toBeGreaterThanOrEqual(2);
    expect(st.glideRatio).toBeLessThanOrEqual(3);
  });

  it('速度と滑空比のトレードオフ: 突っ込むと速くなり滑空比が落ちる', () => {
    const W = VEHICLES.wingsuit.p.wingsuit;
    const trim = steadyGlide(W, 85, W.CLtrim);
    const dive = steadyGlide(W, 85, W.CLmin);
    expect(dive.V).toBeGreaterThan(trim.V * 1.2);
    expect(dive.ld).toBeLessThan(trim.ld);
    sim.load('wingsuit', 'island', { calm: true, spawn: { pos: { x: 0, y: 3500, z: 3000 }, heading: 0, speed: 35, phase: 'wingsuit' } });
    sim.setInput({ pitch: -1 });
    sim.step(60 * 25);
    const st = sim.getState();
    expect(st.speed).toBeGreaterThan(trim.V * 1.15);
    expect(st.glideRatio).toBeLessThan(trim.ld);
  });
});

describe('スカイダイビング', () => {
  it('終端速度は約 50〜56 m/s（高度 1000 m）', () => {
    sim.load('skydive', 'island', { calm: true, spawn: { pos: { x: 0, y: 2500, z: 3000 }, heading: 0, speed: 35, phase: 'freefall' } });
    while (sim.getState().altitude > 1000) sim.step(1);
    const st = sim.getState();
    expect(st.speed).toBeGreaterThanOrEqual(50);
    expect(st.speed).toBeLessThanOrEqual(56);
  });

  it('トラッキングで水平に移動する', () => {
    sim.load('skydive', 'island', { calm: true, spawn: { pos: { x: 0, y: 3000, z: 3000 }, heading: 0, speed: 0, phase: 'freefall' } });
    sim.setInput({ pitch: -1 });
    sim.step(60 * 15);
    expect(sim.getState().groundSpeed).toBeGreaterThan(20);
  });

  it('パラシュート展開後の降下率は約 4〜6 m/s、着地で精度スコア', () => {
    sim.load('skydive', 'island', { calm: true, spawn: { pos: { x: 0, y: 1500, z: 300 }, heading: 180, speed: 0, phase: 'freefall' } });
    sim.step(60 * 5);
    expect(sim.action('deploy')).toBe(true);
    sim.step(60 * 20);
    const st = sim.getState();
    expect(st.phase).toBe('canopy');
    expect(-st.vs).toBeGreaterThanOrEqual(4);
    expect(-st.vs).toBeLessThanOrEqual(6);
    while (sim.getState().status === 'flying' && sim.getState().agl > 5) sim.step(1);
    sim.setInput({ pitch: 1 }); // フレア
    for (let i = 0; i < 600 && sim.getState().status === 'flying'; i++) sim.step(1);
    const end = sim.getState();
    expect(end.status).toBe('landed');
    expect(end.result.type).toBe('landing');
    expect(typeof end.result.score).toBe('number');
    expect(end.result.dist).toBeGreaterThanOrEqual(0);
  });

  it('展開が間に合わないまま地面に到達すると墜落', () => {
    // 対地 60 m を 50 m/s で落下: AAD は作動するが開ききる前に地面に到達する
    sim.load('skydive', 'island', { calm: true, spawn: { pos: { x: 0, y: 60, z: 3000 }, heading: 0, speed: 0, phase: 'freefall', vy: -50 } });
    for (let i = 0; i < 60 * 30 && sim.getState().status === 'flying'; i++) sim.step(1);
    expect(sim.getState().status).toBe('crashed');
  });

  it('自動展開装置（AAD）が低高度で展開する', () => {
    sim.load('skydive', 'island', { calm: true, spawn: { pos: { x: 0, y: 1200, z: 3000 }, heading: 0, speed: 0, phase: 'freefall' } });
    let aad = false;
    for (let i = 0; i < 60 * 60 && sim.getState().status === 'flying'; i++) {
      sim.step(1);
      if (sim.drainEvents().some((e) => e.type === 'aad')) aad = true;
    }
    expect(aad).toBe(true);
  });
});

describe('ジェットスーツ', () => {
  it('ホバリングでき、燃料が減る', () => {
    sim.load('jetsuit', 'island', { calm: true, spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
    const f0 = sim.getState().fuel;
    let maxDev = 0;
    for (let i = 0; i < 600; i++) { sim.step(1); maxDev = Math.max(maxDev, Math.abs(sim.getState().altitude - 300)); }
    const st = sim.getState();
    expect(maxDev).toBeLessThan(2);
    expect(st.fuel).toBeLessThan(f0);
    expect(st.fuel).toBeGreaterThan(0.9);
  });

  it('前傾で巡航でき、燃料切れで推力を失う', () => {
    sim.load('jetsuit', 'island', { calm: true, spawn: { pos: { x: 0, y: 600, z: 3000 }, heading: 0, speed: 0 } });
    sim.setInput({ pitch: -0.7, throttle: 1 });
    sim.step(60 * 10);
    expect(sim.getState().groundSpeed).toBeGreaterThan(25);
    sim.vs.fuel = 0.0005;
    sim.step(60 * 3);
    expect(sim.getState().fuel).toBe(0);
    expect(sim.vs.thrust).toBeLessThan(50);
  });
});

describe('着陸評価', () => {
  const field = { x: 0, z: 0, heading: 0, length: 2400, width: 45 };
  it('評価記号は降下率と接地速度の悪い方で決まる（速すぎる接地は S にならない）', () => {
    const def = VEHICLES.prop;
    const ideal = 1.12 * stallSpeed(def.p, 0);
    const good = rateLanding(def, { vs: -0.5, speed: ideal, airspeed: ideal, flaps: 0, surface: 'runway', x: 0, z: 0 }, field);
    expect(good.grade).toBe('S');
    const fast = rateLanding(def, { vs: -0.5, speed: ideal * 1.5, airspeed: ideal * 1.5, flaps: 0, surface: 'runway', x: 0, z: 0 }, field);
    expect(fast.grade).toBe('C');
    expect(fast.score).toBeLessThan(good.score);
    const hard = rateLanding(def, { vs: -2.4, speed: ideal, airspeed: ideal, flaps: 0, surface: 'runway', x: 0, z: 0 }, field);
    expect(hard.grade).toBe('B');
  });

  it('失速速度の 2.2 倍を超える速度での接地は墜落', () => {
    sim.load('prop', 'island', { calm: true, spawn: { pos: { x: 0, y: 6 + 1.2 + 3, z: 600 }, heading: 0, speed: 58, throttle: 1 } });
    sim.setInput({ pitch: -0.15, throttle: 1 });
    for (let i = 0; i < 600 && sim.getState().status === 'flying' && !sim.getState().onGround; i++) sim.step(1);
    const st = sim.getState();
    expect(st.status).toBe('crashed');
    expect(st.crashCause).toContain('速度超過');
  });

  it('キャノピーはフレアしなくても着地はできる（評価は低い）。フレアすると評価が上がる', () => {
    const land = (flare) => {
      sim.load('skydive', 'island', { calm: true, spawn: { pos: { x: 0, y: 300, z: 300 }, heading: 180, speed: 10, phase: 'canopy' } });
      sim.step(60 * 10);
      while (sim.getState().status === 'flying' && sim.getState().agl > 5) sim.step(1);
      if (flare) sim.setInput({ pitch: 1 });
      for (let i = 0; i < 600 && sim.getState().status === 'flying'; i++) sim.step(1);
      return sim.getState();
    };
    const plain = land(false);
    expect(plain.status).toBe('landed');
    const flared = land(true);
    expect(flared.status).toBe('landed');
    expect(flared.result.vs).toBeLessThan(plain.result.vs);
    expect('SABC'.indexOf(flared.result.grade)).toBeLessThanOrEqual('SABC'.indexOf(plain.result.grade));
  });

  it('追い風で着地しても、対気速度が小さければ墜落にならない', () => {
    sim.load('paraglider', 'island', { weather: 'cloudy', thermals: [], spawn: { pos: { x: 0, y: 40, z: 300 }, heading: 0, speed: 10.5 } });
    // 風下へ向けて降りる
    const wd = sim.world.windDir;
    sim.load('paraglider', 'island', { weather: 'cloudy', thermals: [], spawn: { pos: { x: 0, y: 40, z: 300 }, heading: Math.atan2(wd.x, -wd.z) * 180 / Math.PI, speed: 10.5 } });
    sim.setInput({ pitch: 0 });
    for (let i = 0; i < 60 * 60 && sim.getState().status === 'flying' && sim.getState().agl > 4; i++) sim.step(1);
    sim.setInput({ pitch: 1 });
    for (let i = 0; i < 600 && sim.getState().status === 'flying'; i++) sim.step(1);
    expect(sim.getState().status).toBe('landed');
  });
});

describe('全機体 × 全ロケーションで出現・数秒の飛行ができる', () => {
  for (const loc of LOCATION_ORDER) {
    for (const id of VEHICLE_ORDER) {
      it(`${id} @ ${loc}`, () => {
        const s = new Simulation();
        s.load(id, loc, { seed: 1234, weather: 'clear', time: 'noon' });
        s.step(120);
        const st = s.getState();
        expect(st.status).not.toBe('crashed');
        expect(Number.isFinite(st.altitude)).toBe(true);
      });
    }
  }
});

describe('性能', () => {
  it('物理 10,000 ステップの処理時間を測定・記録する', () => {
    const rows = [];
    for (const id of VEHICLE_ORDER) {
      const s = new Simulation();
      s.load(id, 'city', { seed: 1234, weather: 'windy' });
      // 実際に実行されたステップだけを数える（墜落したら再開。再開の時間は含めない）
      let done = 0, ms = 0, restarts = 0;
      while (done < 10000 && restarts < 100) {
        if (s.status === 'crashed' || s.status === 'finished') { s.restart(); restarts++; }
        s.setInput({ throttle: 0.7, pitch: 0.05, roll: 0.1 });
        const before = s.stepCount;
        const t0 = performance.now();
        s.step(Math.min(500, 10000 - done));
        ms += performance.now() - t0;
        done += s.stepCount - before;
      }
      rows.push({ vehicle: id, steps: done, ms: +ms.toFixed(2), usPerStep: +((ms * 1000) / done).toFixed(2), restarts });
    }
    const dir = path.resolve('reports');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'physics-perf.json'), JSON.stringify({ date: new Date().toISOString(), node: process.version, rows }, null, 2));
    console.log('physics 10k steps:', rows.map((r) => `${r.vehicle}=${r.ms}ms`).join(' '));
    for (const r of rows) {
      expect(r.steps).toBe(10000);
      expect(r.ms).toBeLessThan(2000);
    }
    // 18 機体 × 10,000 ステップ。既定の 5 秒では、他のテストと並んで走ると時間切れになる
  }, 60_000);
});
