import { describe, it, expect } from 'vitest';
import { Simulation, getTerrain } from '../../src/sim/sim.js';
import { tyreCurve, DriftScorer, SURFACES } from '../../src/sim/vehicles/car.js';
import { LapTracker, driftGrade } from '../../src/sim/carModes.js';
import { Track, fieldCircuit } from '../../src/sim/track.js';
import { modesFor } from '../../src/sim/modes.js';
import { VEHICLES, VEHICLE_ORDER, VEHICLE_TABS } from '../../src/data/vehicles.js';
import { LOCATION_ORDER, LOCATIONS, WEATHERS } from '../../src/data/locations.js';
import { Progress, ACHIEVEMENTS } from '../../src/game/progress.js';
import { dailyChallenge, dailyScore } from '../../src/game/daily.js';
import { LESSONS, LessonRunner } from '../../src/game/lessons.js';
import { fmtTime } from '../../src/ui/hud.js';

const RAD = 180 / Math.PI;
const CARS = ['driftcar', 'rally', 'hypercar', 'monster', 'kart', 'hover'];
const sim = new Simulation();
const PAD = { pos: { x: 215, y: 120.6, z: 40 }, heading: 0, speed: 0, onGround: true };

/** 中心線に沿って走るドライバー */
function drive(s, st, speedK = 0.75) {
  const t = s.world.terrain.track;
  const n = t.nearest(st.pos.x, st.pos.z, 200, s._botS ?? 0) || t.nearest(st.pos.x, st.pos.z, 2000);
  s._botS = n.s;
  const v = st.groundSpeed;
  const look = t.at(n.s + 8 + v * 0.7);
  const brg = Math.atan2(look.x - st.pos.x, -(look.z - st.pos.z)) * RAD;
  const err = ((brg - st.attitude.heading + 540) % 360) - 180;
  const target = t.speedAt(n.s + v * 0.9) * speedK;
  s.setInput({ roll: Math.max(-1, Math.min(1, err / 25)), gas: v < target ? 1 : 0, brake: v > target + 3 ? 1 : 0 });
}

describe('タイヤ', () => {
  it('横力は滑り角 12° 付近で最大になり、大きく滑ると 76% まで落ちる', () => {
    let best = 0, at = 0;
    for (let a = 0; a < 1.5; a += 0.005) { const f = tyreCurve(a); if (f > best) { best = f; at = a; } }
    expect(best).toBeCloseTo(1, 2);
    expect(at * RAD).toBeGreaterThan(10);
    expect(at * RAD).toBeLessThan(14);
    expect(tyreCurve(1.5)).toBeGreaterThan(0.7);
    expect(tyreCurve(1.5)).toBeLessThan(0.85);
    expect(tyreCurve(-0.1)).toBeLessThan(0);
  });
});

describe('車種ごとの性能', () => {
  const run = (id, sec = 60) => {
    // メインストレート（舗装）の上から
    sim.load(id, 'raceway', { calm: true, spawn: { pos: { x: 0, y: 120.6, z: 490 }, heading: 0, speed: 0, onGround: true } });
    sim.setInput({ gas: 1 });
    let t100 = null, vmax = 0;
    for (let i = 0; i < 60 * sec; i++) {
      sim.step(1);
      const s = sim.getState();
      if (t100 == null && s.car.speedKmh >= 100) t100 = s.t;
      vmax = Math.max(vmax, s.car.speedKmh);
      // 舗装の端まで
      if (sim.vs.pos.z < -490) break;
    }
    return { t100, vmax };
  };
  it('0→100 km/h: ハイパーカーが最速、カートとモンスターも現実的な範囲', () => {
    const r = Object.fromEntries(['driftcar', 'rally', 'hypercar', 'monster', 'kart'].map((id) => [id, run(id)]));
    expect(r.hypercar.t100).toBeLessThan(3.2);
    expect(r.hypercar.t100).toBeLessThan(r.driftcar.t100);
    expect(r.rally.t100).toBeLessThan(6);
    expect(r.driftcar.t100).toBeLessThan(7);
    expect(r.monster.t100).toBeLessThan(7);
    expect(r.kart.t100).toBeLessThan(7);
    // 1 km の直線で出る速度の順
    expect(r.hypercar.vmax).toBeGreaterThan(r.driftcar.vmax);
  });
  it('最高速度: 長い平地で ハイパーカー 350 km/h 超、カート 170 km/h 未満', () => {
    const top = (id) => {
      sim.load(id, 'raceway', { calm: true, spawn: { pos: { x: 0, y: 120.6, z: 0 }, heading: 0, speed: 0, onGround: true } });
      const terr = sim.world.terrain;
      sim.setInput({ gas: 1 });
      let v = 0;
      for (let i = 0; i < 60 * 45; i++) {
        // 地形の影響を除くため同じ場所に戻しながら加速を見る
        sim.vs.pos.x = 0; sim.vs.pos.z = 0; sim.vs.pos.y = terr.heightAt(0, 0) + VEHICLES[id].p.cgHeight; sim.vs.psi = 0; sim.vs.vy = 0; sim.vs.r = 0;
        sim.step(1);
        v = Math.max(v, sim.getState().car.speedKmh);
      }
      return v;
    };
    expect(top('hypercar')).toBeGreaterThan(350);
    expect(top('kart')).toBeLessThan(170);
  });
  it('全車種がブレーキで止まり、止まってから押し続けるとバックする', () => {
    for (const id of CARS) {
      sim.load(id, 'raceway', { calm: true, spawn: PAD });
      sim.setInput({ gas: 1 });
      sim.step(60 * 3);
      sim.setInput({ gas: 0, brake: 1 });
      sim.step(60 * 6);
      const st = sim.getState();
      expect(st.car.gear, id).toBe('R');
      const fx = Math.sin(sim.vs.psi), fz = -Math.cos(sim.vs.psi);
      expect(st.vel.x * fx + st.vel.z * fz, id).toBeLessThan(-0.3);
    }
  });
});

describe('操作の安定性（スマホの傾きでも破綻しない）', () => {
  it('全開でハンドルを大きく切っても、サイドを引かなければスピンしない（アシスト中）', () => {
    for (const id of ['driftcar', 'hypercar', 'rally', 'kart']) {
      sim.load(id, 'raceway', { calm: true, carAssist: 'high', spawn: PAD });
      sim.setInput({ gas: 1, roll: 0 });
      sim.step(60 * 3);
      sim.setInput({ roll: 1 });
      let maxB = 0;
      for (let i = 0; i < 60 * 5; i++) { sim.step(1); maxB = Math.max(maxB, Math.abs(sim.getState().car.beta)); }
      // グリップの限界で後軸は最大 27° ほど滑って落ち着く（逆ハンドルで釣り合う）。スピンは 45° 超が続く状態
      expect(maxB, id).toBeLessThan(40);
    }
  });
  it('発進で全開にしても真っすぐ進む', () => {
    sim.load('driftcar', 'raceway', { calm: true, carAssist: 'mid', spawn: PAD });
    sim.setInput({ gas: 1 });
    sim.step(60 * 3);
    const st = sim.getState();
    expect(Math.abs(st.car.beta)).toBeLessThan(2);
    expect(Math.abs(st.pos.x - PAD.pos.x)).toBeLessThan(1);
  });
  it('左右に振っても収束する（尻振りが発散しない）', () => {
    sim.load('driftcar', 'raceway', { calm: true, carAssist: 'mid', spawn: PAD });
    sim.setInput({ gas: 0.6 });
    sim.step(60 * 3);
    for (let i = 0; i < 6; i++) { sim.setInput({ roll: i % 2 ? -0.8 : 0.8, gas: 0.6 }); sim.step(30); }
    sim.setInput({ roll: 0, gas: 0.4 });
    sim.step(60 * 2);
    expect(Math.abs(sim.getState().car.beta)).toBeLessThan(5);
  });
});

describe('ドリフト', () => {
  const start = (id, assist) => {
    sim.load(id, 'raceway', { calm: true, carAssist: assist, spawn: PAD });
    sim.setInput({ gas: 1 });
    while (sim.getState().groundSpeed < (id === 'kart' ? 16 : 22) && sim.t < 15) sim.step(1);
    sim.setInput({ roll: 0.7, handbrake: true });
    sim.step(24);
    sim.setInput({ handbrake: false, gas: 0.8 });
  };
  it('サイドで滑り出し、アクセルと傾きで保てる。傾きを戻すと収まる（アシスト強・中）', () => {
    for (const assist of ['high', 'mid']) {
      for (const id of ['driftcar', 'rally', 'hypercar', 'flycar']) {
        if (id === 'flycar') sim.load; // 空飛ぶ車も走行モードで同じ
        start(id, assist);
        let n = 0, maxB = 0;
        for (let i = 0; i < 60 * 5; i++) {
          sim.setInput({ throttle: id === 'flycar' ? 0.8 : 0 });
          sim.step(1);
          const b = Math.abs(sim.getState().car.beta);
          if (b > 12) n++;
          maxB = Math.max(maxB, b);
        }
        expect(n / 60, `${id}/${assist}`).toBeGreaterThan(3.5);
        expect(maxB, `${id}/${assist}`).toBeLessThan(80); // スピンしない
        sim.setInput({ roll: 0, gas: 0.4, throttle: id === 'flycar' ? 0.4 : 0 });
        sim.step(60 * 2.5);
        expect(Math.abs(sim.getState().car.beta), `${id}/${assist}`).toBeLessThan(10);
      }
    }
  });
  it('滑る向きは傾けた側へ車首が入る（右に傾ける → 右に曲がる）', () => {
    start('driftcar', 'mid');
    const h0 = sim.getState().attitude.heading;
    sim.step(60 * 2);
    const st = sim.getState();
    expect(st.car.beta).toBeLessThan(-8); // 進行方向は車首の左
    expect(((st.attitude.heading - h0 + 540) % 360) - 180).toBeGreaterThan(5);
  });
  it('アシストなしでは、サイドで滑らせて放置するとスピンする（実車に近い）', () => {
    start('driftcar', 'off');
    let maxB = 0;
    for (let i = 0; i < 60 * 3; i++) { sim.step(1); maxB = Math.max(maxB, Math.abs(sim.getState().car.beta)); }
    expect(maxB).toBeGreaterThan(50);
  });
  it('点数: 角度と速さで増え、続けると倍率が上がり、猶予内の切り返しはつながり、ぶつかると消える', () => {
    const d = new DriftScorer();
    const ev = [];
    const emit = (t, e) => ev.push([t, e]);
    for (let i = 0; i < 60 * 6; i++) d.update(30, 20, true, 1 / 60, emit);
    expect(d.mult).toBe(3);
    const s1 = d.score;
    expect(s1).toBeGreaterThan(800);
    for (let i = 0; i < 30; i++) d.update(0, 20, true, 1 / 60, emit); // 0.5 秒の切り返し
    expect(d.score).toBe(s1);
    for (let i = 0; i < 60; i++) d.update(30, 20, true, 1 / 60, emit);
    expect(d.score).toBeGreaterThan(s1);
    for (let i = 0; i < 90; i++) d.update(0, 20, true, 1 / 60, emit); // 猶予切れで確定
    expect(d.score).toBe(0);
    expect(d.total).toBeGreaterThan(s1);
    expect(ev.some(([t]) => t === 'driftEnd')).toBe(true);
    const total = d.total;
    for (let i = 0; i < 60; i++) d.update(30, 20, true, 1 / 60, emit);
    d.cancel(emit);
    expect(d.score).toBe(0);
    expect(d.total).toBe(total);
    expect(ev.some(([t]) => t === 'driftLost')).toBe(true);
  });
  it('滑らずにゆっくり大回りしても点は入らない（重心の角度が大きいだけ）', () => {
    sim.load('driftcar', 'raceway', { calm: true, carAssist: 'high', spawn: PAD });
    sim.setInput({ gas: 1 });
    sim.step(60 * 2);
    sim.setInput({ gas: 0.15, roll: 1 });
    sim.step(60 * 8);
    sim.vs.drift.bank(() => {});
    expect(sim.vs.drift.total).toBeLessThan(150);
  });
  it('遅いときや空中では点が入らない', () => {
    const d = new DriftScorer();
    for (let i = 0; i < 60; i++) d.update(30, 3, true, 1 / 60, () => {});
    for (let i = 0; i < 60; i++) d.update(30, 20, false, 1 / 60, () => {});
    expect(d.score).toBe(0);
  });
  it('評価の境目', () => {
    expect(driftGrade(20000)).toBe('S');
    expect(driftGrade(10000)).toBe('A');
    expect(driftGrade(5000)).toBe('B');
    expect(driftGrade(100)).toBe('C');
  });
});

describe('路面と天候', () => {
  const brakeDist = (id, loc, opts = {}, surfSpawn = null) => {
    sim.load(id, loc, { calm: true, weather: opts.weather, spawn: surfSpawn || PAD });
    const s = sim.vs;
    s.vx = 22;
    sim.setInput({ brake: 1 });
    const p0 = { ...s.pos };
    for (let i = 0; i < 60 * 30 && Math.abs(s.vx) > 0.3; i++) sim.step(1);
    return Math.hypot(s.pos.x - p0.x, s.pos.z - p0.z);
  };
  it('雨の日はブレーキの距離が伸びる', () => {
    const dry = brakeDist('driftcar', 'raceway', {});
    const wet = brakeDist('driftcar', 'raceway', { weather: 'rain' });
    expect(wet).toBeGreaterThan(dry * 1.25);
    expect(WEATHERS.rain.grip).toBeLessThan(1);
  });
  it('路面の種類: 雪山は雪、砂漠は砂、都市部は舗装、コースは舗装（雪山は雪、砂漠はダート）', () => {
    expect(getTerrain('snow', 1234).surfaceKind(0, 4000)).toMatch(/snow|rock/);
    expect(getTerrain('desert', 1234).surfaceKind(-1000, -3000)).toMatch(/sand|rock/);
    expect(getTerrain('city', 1234).surfaceKind(200, 100)).toMatch(/asphalt|concrete/);
    const t = getTerrain('raceway', 1234);
    const p = t.track.at(100);
    expect(t.surfaceKind(p.x, p.z)).toBe('asphalt');
    const s = getTerrain('snow', 1234);
    const q = s.track.at(100);
    expect(s.surfaceKind(q.x, q.z)).toBe('snow');
    const d = getTerrain('desert', 1234);
    const r = d.track.at(100);
    expect(d.surfaceKind(r.x, r.z)).toBe('dirt');
    for (const k of Object.keys(SURFACES)) expect(SURFACES[k].mu).toBeGreaterThan(0);
  });
  it('雪の上: ラリーカーはドリフトクーペよりよく止まる（未舗装に強い）', () => {
    const terr = getTerrain('snow', 1234);
    const p = terr.track.at(200);
    const spawn = { pos: { x: p.x, y: p.y + 0.6, z: p.z }, heading: p.heading, speed: 0, onGround: true };
    const a = brakeDist('rally', 'snow', {}, spawn);
    const b = brakeDist('driftcar', 'snow', {}, spawn);
    expect(a).toBeLessThan(b);
  });
});

describe('ぶつかる・落ちる', () => {
  it('ビルにぶつかっても墜落せず跳ね返る', () => {
    sim.load('driftcar', 'city', { calm: true });
    const terr = sim.world.terrain;
    const b = terr.buildings.filter((x) => x.h > 20 && x.w > 25).sort((p, q) => q.h - p.h)[0];
    const x = b.x - b.w / 2 - 30;
    sim.vs.pos = { x, y: terr.surfaceAt(x, b.z) + 0.5, z: b.z };
    sim.vs.psi = Math.PI / 2;
    sim.vs.vx = 30; sim.vs.vy = 0; sim.vs.r = 0;
    sim.drainEvents();
    sim.setInput({ gas: 0.5 });
    sim.step(60 * 2);
    const ev = sim.drainEvents();
    expect(sim.getState().status).toBe('flying');
    expect(ev.some((e) => e.type === 'carHit')).toBe(true);
    expect(sim.vs.pos.x).toBeLessThan(b.x - b.w / 2);
  });
  it('水に落ちると少し前の場所へ戻る（ゲームオーバーにしない）', () => {
    sim.load('driftcar', 'island', { calm: true });
    const terr = sim.world.terrain;
    // 海岸へ向かって走らせる
    let w = null;
    for (let x = 0; x < 5000 && !w; x += 20) if (terr.isWater(x, 0)) w = x;
    sim.vs.pos = { x: w - 60, y: terr.surfaceAt(w - 60, 0) + 0.5, z: 0 };
    sim.vs.lastSafe = { x: w - 200, y: terr.surfaceAt(w - 200, 0) + 0.5, z: 0, psi: Math.PI / 2 };
    sim.vs.psi = Math.PI / 2;
    sim.vs.vx = 30;
    sim.drainEvents();
    let reset = false;
    for (let i = 0; i < 60 * 6 && !reset; i++) { sim.step(1); reset = sim.drainEvents().some((e) => e.type === 'carReset'); }
    expect(reset).toBe(true);
    expect(sim.getState().status).toBe('flying');
    expect(terr.isWater(sim.vs.pos.x, sim.vs.pos.z)).toBe(false);
  });
  it('ホバーカーは水の上を走れる', () => {
    sim.load('hover', 'island', { calm: true });
    const terr = sim.world.terrain;
    let w = null;
    for (let x = 0; x < 5000 && !w; x += 20) if (terr.isWater(x, 0)) w = x;
    sim.vs.pos = { x: w + 300, y: 1.1, z: 0 };
    sim.vs.psi = Math.PI / 2;
    sim.setInput({ gas: 0.8 });
    sim.step(60 * 4);
    const st = sim.getState();
    expect(st.status).toBe('flying');
    expect(st.car.surface).toBe('water');
    expect(st.groundSpeed).toBeGreaterThan(15);
    expect(st.pos.y).toBeGreaterThan(0.5);
  });
  it('復帰ボタンで止まって戻る', () => {
    sim.load('rally', 'raceway', { calm: true, spawn: PAD });
    sim.setInput({ gas: 1 });
    sim.step(60 * 3);
    const safe = { ...sim.vs.lastSafe };
    expect(sim.action('reset')).toBe(true);
    expect(sim.vs.vx).toBe(0);
    expect(sim.vs.pos.x).toBeCloseTo(safe.x, 3);
    expect(sim.vs.pos.z).toBeCloseTo(safe.z, 3);
  });
  it('ジャンプ台: 走り抜けると飛んで、着地して走り続ける', () => {
    sim.load('rally', 'raceway', { calm: true });
    const r = sim.world.terrain.ramps[0];
    const d = 80;
    sim.vs.pos = { x: r.x - r.fx * d, y: r.base + 0.58, z: r.z - r.fz * d };
    sim.vs.psi = r.heading;
    sim.vs.vx = 30; sim.vs.vy = 0; sim.vs.r = 0;
    sim.setInput({ gas: 0.5 });
    let air = 0, peak = 0;
    for (let i = 0; i < 60 * 6; i++) {
      sim.step(1);
      const st = sim.getState();
      if (st.car.air) { air += 1 / 60; peak = Math.max(peak, st.agl); }
    }
    expect(air).toBeGreaterThan(0.4);
    expect(peak).toBeGreaterThan(1);
    expect(sim.getState().car.air).toBe(false);
    expect(sim.getState().status).toBe('flying');
  });
  it('モンスターは 1 m の段差を越えられるが、普通の車は止められる', () => {
    expect(VEHICLES.monster.p.drive.maxStep).toBeGreaterThan(1);
    expect(VEHICLES.driftcar.p.drive.maxStep ?? 0.6).toBeLessThan(1);
  });
});

describe('コース', () => {
  for (const loc of LOCATION_ORDER) {
    it(`${loc}: 周回路が平らで、水・ビルにかからず、急すぎない`, () => {
      const t = getTerrain(loc, 1234);
      const tr = t.track;
      expect(tr.length).toBeGreaterThan(1500);
      expect(tr.minRadius()).toBeGreaterThan(15);
      for (const p of tr.pts) {
        expect(Math.abs(p.y - t.field.elevation)).toBeLessThan(1.5);
        expect(t.isWater(p.x, p.z)).toBe(false);
        expect(t.buildingHit({ x: p.x, y: p.y + 2, z: p.z }, 6)).toBe(null);
      }
    });
  }
  it('別のシードでも周回路は成り立つ', () => {
    for (const loc of LOCATION_ORDER) for (const seed of [7, 99999]) {
      const t = getTerrain(loc, seed);
      for (const p of t.track.pts) {
        expect(Math.abs(p.y - t.field.elevation), `${loc}/${seed}`).toBeLessThan(2);
        expect(t.isWater(p.x, p.z), `${loc}/${seed}`).toBe(false);
      }
    }
  });
  it('進み具合と最寄り判定: 中心線の点を入れると同じ s が返る', () => {
    const tr = getTerrain('raceway', 1234).track;
    for (const s of [0, 500, 1500, 3000]) {
      const p = tr.at(s);
      const n = tr.nearest(p.x, p.z, 30);
      expect(Math.abs(n.s - s)).toBeLessThan(10);
      expect(n.dist).toBeLessThan(5);
    }
  });
  it('フィールドの周回路は曲率の符号が左右両方ある（単なる楕円でない）', () => {
    const tr = new Track(fieldCircuit(LOCATIONS.island.field), { heightAt: () => 0 });
    expect(tr.pts.some((p) => p.k > 0.005)).toBe(true);
    expect(tr.pts.some((p) => p.k < -0.005)).toBe(true);
  });
});

describe('レース', () => {
  it('全ロケーションで、ドライバーがコースを外れず完走でき、ライバルも走る', () => {
    for (const loc of LOCATION_ORDER) {
      for (const id of loc === 'snow' || loc === 'desert' ? ['rally'] : ['rally', 'driftcar', 'hypercar']) {
        sim.load(id, loc, { calm: true, mode: 'race', countdown: 0 });
        sim._botS = 0;
        let off = 0, n = 0;
        for (let i = 0; i < 60 * 400; i++) {
          const st = sim.getState();
          if (st.status !== 'flying') break;
          drive(sim, st);
          sim.step(1);
          const near = sim.world.terrain.track.nearest(sim.vs.pos.x, sim.vs.pos.z, 100);
          n++;
          if (!near || near.dist > 16) off++;
        }
        const st = sim.getState();
        expect(st.status, `${loc}/${id}`).toBe('finished');
        expect(st.result.type).toBe('race');
        expect(off / n, `${loc}/${id}`).toBeLessThan(0.08);
        expect(sim.race.rivals.every((r) => r.progress > 500), `${loc}/${id}`).toBe(true);
      }
    }
  }, 120000); // 何台も完走させるので時間がかかる
  it('チェックポイントを順に通らないと周回にならない（ショートカット不可）', () => {
    const tr = getTerrain('raceway', 1234).track;
    const lap = new LapTracker(tr, 1);
    const ev = [];
    const emit = (t, e) => ev.push([t, e]);
    // いきなりゴール線をまたいでも進まない
    const cp0 = lap.cps[0];
    lap.update({ x: cp0.x - cp0.tx, y: cp0.y, z: cp0.z - cp0.tz }, { x: cp0.x + cp0.tx, y: cp0.y, z: cp0.z + cp0.tz }, 1, 1 / 60, emit);
    expect(lap.finished).toBe(false);
    expect(lap.lapTimes.length).toBe(0);
    // 順に通るとゴールになる
    for (let i = 1; i <= lap.cps.length; i++) {
      const c = lap.cps[i % lap.cps.length];
      lap.update({ x: c.x - c.tx, y: c.y, z: c.z - c.tz }, { x: c.x + c.tx, y: c.y, z: c.z + c.tz }, 10 + i, 1 / 60, emit);
    }
    expect(lap.finished).toBe(true);
    expect(ev.filter(([t]) => t === 'checkpoint').length).toBe(lap.cps.length - 1);
    expect(ev.some(([t]) => t === 'lap')).toBe(true);
  });
  it('チェックポイントの横を遠く外れて通っても数えない', () => {
    const tr = getTerrain('raceway', 1234).track;
    const lap = new LapTracker(tr, 1);
    const c = lap.cps[1];
    const nx = -c.tz, nz = c.tx;
    lap.update({ x: c.x - c.tx + nx * 100, y: c.y, z: c.z - c.tz + nz * 100 }, { x: c.x + c.tx + nx * 100, y: c.y, z: c.z + c.tz + nz * 100 }, 1, 1 / 60, () => {});
    expect(lap.next).toBe(1);
  });
  it('カウントダウン中はライバルも動かず、終わると走り出す。順位が計算される', () => {
    sim.load('rally', 'raceway', { calm: true, mode: 'race' });
    const p0 = sim.race.rivals.map((r) => r.progress);
    expect(sim.getState().race.countdown).toBeGreaterThan(2);
    sim.step(60);
    expect(sim.race.rivals.map((r) => r.progress)).toEqual(p0);
    sim.step(60 * 3);
    expect(sim.race.rivals[0].progress).toBeGreaterThan(p0[0]);
    expect(sim.getState().race.place).toBe(4); // 止まっている自分が最後
  });
  it('ライバルの速さは難易度で変わり、雨の日は遅くなる', () => {
    const speed = (o) => { sim.load('rally', 'raceway', { calm: true, mode: 'race', countdown: 0, ...o }); sim.step(60 * 40); return sim.race.rivals[0].progress; };
    const e = speed({ difficulty: 'easy' });
    const h = speed({ difficulty: 'hard' });
    const r = speed({ difficulty: 'hard', weather: 'rain' });
    expect(h).toBeGreaterThan(e * 1.1);
    expect(r).toBeLessThan(h);
  });
  it('逆走すると警告', () => {
    sim.load('rally', 'raceway', { calm: true, mode: 'race', countdown: 0, rivals: 0 });
    const tr = sim.world.terrain.track;
    const p = tr.at(300);
    sim.race.tracker.lastS = 300;
    sim.vs.pos = { x: p.x, y: p.y + 0.58, z: p.z };
    sim.vs.psi = p.heading + Math.PI;
    sim.vs.vx = 20; sim.vs.vy = 0; sim.vs.r = 0;
    sim.setInput({ gas: 0.5 });
    sim.step(60 * 3);
    expect(sim.getState().race.wrongWay).toBe(true);
  });
});

describe('駐車', () => {
  it('枠の中で 1 秒止まると次へ。ぴったりだと高得点、3 か所で結果', () => {
    sim.load('kart', 'island', { calm: true, mode: 'parking' });
    const pk = sim.parking;
    expect(pk.boxes.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const b = pk.current();
      sim.vs.pos.x = b.x; sim.vs.pos.z = b.z; sim.vs.psi = b.heading + (i === 1 ? Math.PI : 0); sim.vs.vx = 0; sim.vs.vy = 0; sim.vs.r = 0;
      sim.step(80);
    }
    const st = sim.getState();
    expect(st.status).toBe('finished');
    expect(st.result.type).toBe('parking');
    expect(st.result.scores.every((s) => s > 90)).toBe(true); // 後ろ向きでもよい
    expect(['S', 'A']).toContain(st.result.grade);
  });
  it('枠の外や、動いている間は数えない', () => {
    sim.load('kart', 'island', { calm: true, mode: 'parking' });
    const pk = sim.parking;
    const b = pk.current();
    sim.vs.pos.x = b.x + 20; sim.vs.pos.z = b.z; sim.vs.vx = 0; sim.vs.vy = 0;
    sim.step(120);
    expect(pk.index).toBe(0);
    expect(sim.getState().parking.inside).toBe(false);
  });
  it('枠は全ロケーションで平らな所にある', () => {
    for (const loc of LOCATION_ORDER) {
      sim.load('kart', loc, { calm: true, mode: 'parking' });
      const f = sim.world.terrain.field;
      for (const b of sim.parking.boxes) {
        expect(Math.abs(b.y - f.elevation), loc).toBeLessThan(2);
        expect(sim.world.terrain.isWater(b.x, b.z), loc).toBe(false);
        expect(sim.world.terrain.buildingHit({ x: b.x, y: b.y + 1, z: b.z }, 4), loc).toBe(null);
      }
    }
  });
});

describe('モードと機体', () => {
  it('車は走るモードだけ、空飛ぶ車はすべて、飛行機は飛ぶモードだけ', () => {
    expect(modesFor(VEHICLES.driftcar)).toEqual(['free', 'race', 'drift', 'parking']);
    expect(modesFor(VEHICLES.flycar)).toContain('race');
    expect(modesFor(VEHICLES.flycar)).toContain('rings');
    expect(modesFor(VEHICLES.prop)).not.toContain('race');
  });
  it('全機体がタブのどれかに入る', () => {
    const cats = VEHICLE_TABS.filter((t) => t.cats).flatMap((t) => t.cats);
    for (const id of VEHICLE_ORDER) expect(cats, id).toContain(VEHICLES[id].category);
  });
  it('空飛ぶ車も走行中はサイドでドリフトできる', () => {
    sim.load('flycar', 'raceway', { calm: true, spawn: PAD });
    sim.setInput({ throttle: 1 });
    sim.step(60 * 4);
    sim.setInput({ roll: 0.7, handbrake: true });
    sim.step(24);
    sim.setInput({ handbrake: false, throttle: 0.8 });
    sim.step(60);
    expect(sim.getState().car.drift.active).toBe(true);
    expect(sim.getState().carMode).toBe('drive');
  });
});

describe('オートパイロット・警告', () => {
  it('固定翼: 高度と方位を保つ', () => {
    sim.load('prop', 'island', { calm: true, spawn: { pos: { x: 0, y: 900, z: 3000 }, heading: 40, speed: 50, throttle: 0.6 } });
    sim.setInput({ pitch: 0, roll: 0.3, throttle: 0.6 });
    sim.step(60 * 3);
    sim.setInput({ roll: 0 });
    expect(sim.action('autopilot')).toBe(true);
    const h0 = sim.getState().attitude.heading, a0 = sim.getState().altitude;
    sim.step(60 * 40);
    const st = sim.getState();
    expect(st.autopilot).toBe(true);
    expect(Math.abs(st.altitude - a0)).toBeLessThan(20);
    expect(Math.abs(((st.attitude.heading - h0 + 540) % 360) - 180)).toBeLessThan(5);
    expect(Math.abs(st.attitude.roll)).toBeLessThan(4);
  });
  it('ヘリ: 浮いたまま止まる', () => {
    sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: 400, z: 3000 }, heading: 0, speed: 0 } });
    sim.setInput({ pitch: -0.3 });
    sim.step(60 * 3);
    sim.setInput({ pitch: 0 });
    expect(sim.action('autopilot')).toBe(true);
    const a0 = sim.getState().altitude;
    sim.step(60 * 30);
    const st = sim.getState();
    expect(Math.abs(st.altitude - a0)).toBeLessThan(10);
    expect(Math.abs(st.vs)).toBeLessThan(0.5);
    expect(st.groundSpeed).toBeLessThan(2);
  });
  it('大きく操作すると解除。地上では入らない', () => {
    sim.load('prop', 'island', { calm: true, spawn: { pos: { x: 0, y: 900, z: 3000 }, heading: 40, speed: 50, throttle: 0.6 } });
    sim.action('autopilot');
    sim.setInput({ roll: 0.9 });
    sim.step(2);
    expect(sim.getState().autopilot).toBe(false);
    sim.load('prop', 'island', { calm: true });
    expect(sim.action('autopilot')).toBe(false);
  });
  it('地形の警告: 山に向かって低空で飛ぶと出る。上空では出ない', () => {
    sim.load('prop', 'mountains', { calm: true, spawn: { pos: { x: 0, y: 5000, z: 3000 }, heading: 0, speed: 60, throttle: 0.6 } });
    expect(sim.getState().terrainWarn).toBe(false);
    // 真下に地面が迫る
    const terr = sim.world.terrain;
    sim.vs.pos.y = terr.surfaceAt(0, 3000) + 60;
    sim.vs.vel.y = -40;
    expect(sim.getState().terrainWarn).toBe(true);
  });
  it('着陸の誘導: 3° のコースからのずれが分かる', () => {
    // 山の無いサーキットの滑走路で、コース上の点へ置く
    sim.load('prop', 'raceway', { calm: true, mode: 'landing' });
    const f = sim.world.terrain.field;
    expect(sim.getState().landingGuide).not.toBe(null);
    const aim = f.length / 2 - 300;
    const d = 300;
    sim.vs.pos = { x: f.x, y: f.elevation + VEHICLES.prop.p.ground.gearHeight + d * Math.tan((3 * Math.PI) / 180) + 80, z: f.z + aim + d };
    // 山が無くても地面から 80 m は最低限の目標（地面すれすれを勧めない）
    const g = sim.getState().landingGuide;
    expect(g.dist).toBeCloseTo(d, 0);
    expect(Math.abs(g.locDev)).toBeLessThan(1);
    expect(g.gsDev).toBeGreaterThan(-5);
    sim.vs.pos.y += 100;
    expect(sim.getState().landingGuide.gsDev).toBeGreaterThan(70);
  });
});

describe('実績', () => {
  const memStore = () => { const m = {}; return { get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
  const ctx = { vehicleCount: 18, locationCount: 6, lessonCount: 4 };
  it('条件を満たすと 1 回だけ解除され、保存される', () => {
    const st = memStore();
    const p = new Progress(st, 'k', ctx);
    p.max('driftBest', 1500);
    expect(p.drain().map((a) => a.id)).toEqual(['drift_1k']);
    p.max('driftBest', 1600);
    expect(p.drain()).toEqual([]);
    p.flush();
    const q = new Progress(st, 'k', ctx);
    expect(q.unlocked.drift_1k).toBe(true);
    expect(q.stats.driftBest).toBe(1600);
    q.max('driftBest', 1700);
    expect(q.drain()).toEqual([]);
  });
  it('全機体・全ロケーション: 数が揃うと解除', () => {
    const p = new Progress(memStore(), 'k', { vehicleCount: 2, locationCount: 1, lessonCount: 1 });
    p.addUnique('vehicles', 'a');
    p.addUnique('vehicles', 'a');
    expect(p.stats.vehicles.length).toBe(1);
    expect(p.unlocked.all_vehicles).toBeUndefined();
    p.addUnique('vehicles', 'b');
    expect(p.unlocked.all_vehicles).toBe(true);
  });
  it('実績の id は重複しない', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('今日のチャレンジ', () => {
  it('同じ日は同じ内容、日が変わると変わる。遊べる組み合わせになる', () => {
    expect(dailyChallenge('2026-10-30')).toEqual(dailyChallenge('2026-10-30'));
    const set = new Set();
    for (let d = 1; d <= 28; d++) {
      const key = `2026-11-${String(d).padStart(2, '0')}`;
      const ch = dailyChallenge(key);
      set.add(`${ch.vehicle}:${ch.location}:${ch.mode}`);
      expect(modesFor(VEHICLES[ch.vehicle]), key).toContain(ch.mode);
      expect(ch.mode).not.toBe('free');
      sim.load(ch.vehicle, ch.location, { mode: ch.mode, time: ch.time, weather: ch.weather, seed: ch.seed });
      sim.step(30);
      expect(Number.isFinite(sim.vs.pos.y), key).toBe(true);
    }
    expect(set.size).toBeGreaterThan(15);
  });
  it('点数は良い結果ほど大きい', () => {
    expect(dailyScore({ type: 'race', time: 60, place: 1 })).toBeGreaterThan(dailyScore({ type: 'race', time: 90, place: 1 }));
    expect(dailyScore({ type: 'rings', total: 60 })).toBeGreaterThan(dailyScore({ type: 'rings', total: 90 }));
    expect(dailyScore({ type: 'drift', score: 100 })).toBe(100);
  });
});

describe('練習モード', () => {
  it('車のレッスン: 操作どおりに段階が進む', () => {
    const r = new LessonRunner('car');
    sim.load('rally', 'raceway', { calm: true, spawn: PAD });
    const tick = (n) => { for (let i = 0; i < n; i++) { sim.step(1); r.update(sim.getState(), 1 / 60); } };
    expect(r.view().step).toBe(1);
    sim.setInput({ gas: 1 });
    tick(60 * 5);
    expect(r.view().step).toBe(2);
    sim.setInput({ roll: 0.8, gas: 0.5 });
    tick(60 * 4);
    expect(r.view().step).toBe(3);
    sim.setInput({ roll: 0, gas: 0, brake: 1 });
    tick(60 * 5);
    expect(r.done).toBe(true);
  });
  it('どのレッスンも機体とロケーションが存在する', () => {
    for (const l of LESSONS) {
      expect(VEHICLES[l.vehicle], l.id).toBeTruthy();
      expect(LOCATIONS[l.location], l.id).toBeTruthy();
      expect(l.steps.length).toBeGreaterThan(2);
    }
  });
});

describe('時間の表示', () => {
  it('繰り上がりで 60.0 秒にならない', () => {
    expect(fmtTime(59.96)).toBe('01:00.0');
    expect(fmtTime(119.97)).toBe('02:00.0');
    expect(fmtTime(65.3)).toBe('01:05.3');
    expect(fmtTime(0)).toBe('00:00.0');
  });
});
