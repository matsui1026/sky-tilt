import { describe, it, expect } from 'vitest';
import { Simulation } from '../../src/sim/sim.js';
import { Combat, segmentHitsSphere, rotateToward } from '../../src/sim/combat.js';
import { ringApproach, modesFor } from '../../src/sim/modes.js';
import { GhostRecorder, GhostPlayer } from '../../src/sim/ghost.js';
import { hoverBurner, airTemp } from '../../src/sim/vehicles/balloon.js';
import { airDensity } from '../../src/sim/world.js';
import { VEHICLES } from '../../src/data/vehicles.js';
import { quatFromAttitude, qrot, FWD, vadd, vscale } from '../../src/sim/math.js';
import { SnapshotBuffer, ClockSync } from '../../src/net/interp.js';
import { Session, loopbackPair, SILENCE_WARN } from '../../src/net/session.js';
import { peerErrorMessage } from '../../src/net/transport.js';
import { encodeState, decodeState } from '../../src/net/protocol.js';

const sim = new Simulation();
const RAD = 180 / Math.PI;

describe('グライダー', () => {
  it('手を離すと最良滑空速度付近で滑空し、滑空比は約 33〜42', () => {
    sim.load('sailplane', 'island', { calm: true, spawn: { pos: { x: 0, y: 1200, z: 3000 }, heading: 0, speed: 29 } });
    sim.step(60 * 30);
    let V = 0, vs = 0, n = 0;
    for (let i = 0; i < 60 * 48; i++) { sim.step(1); const s = sim.getState(); V += s.speed; vs += s.vs; n++; }
    V /= n; vs /= n;
    expect(V).toBeGreaterThan(27);
    expect(V).toBeLessThan(35);
    expect(-vs).toBeGreaterThan(0.6);
    expect(-vs).toBeLessThan(1.0);
    expect(V / -vs).toBeGreaterThan(33);
    expect(V / -vs).toBeLessThan(42);
  });
  it('エンジンが無い（スロットルを上げても推力 0）', () => {
    sim.load('sailplane', 'island', { calm: true, spawn: { pos: { x: 0, y: 1200, z: 3000 }, heading: 0, speed: 29 } });
    sim.setInput({ throttle: 1 });
    sim.step(60);
    expect(sim.vs.thrust).toBe(0);
  });
});

describe('ドローン', () => {
  it('約 33% でホバリングでき、電池が減る', () => {
    sim.load('drone', 'island', { calm: true, spawn: { pos: { x: 0, y: 200, z: 3000 }, heading: 0, speed: 0 } });
    expect(sim.getState().throttleCmd).toBeCloseTo(1 / 3, 1);
    let maxDev = 0;
    for (let i = 0; i < 600; i++) { sim.step(1); maxDev = Math.max(maxDev, Math.abs(sim.getState().altitude - 200)); }
    expect(maxDev).toBeLessThan(1);
    expect(sim.getState().fuel).toBeLessThan(1);
  });
  it('大きく傾けて推力を上げると 70〜130 km/h で進む', () => {
    sim.load('drone', 'island', { calm: true, spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
    sim.setInput({ pitch: -1, throttle: 0.55 });
    sim.step(60 * 10);
    const kmh = sim.getState().groundSpeed * 3.6;
    expect(kmh).toBeGreaterThan(70);
    expect(kmh).toBeLessThan(130);
  });
});

describe('熱気球', () => {
  it('平衡のバーナー出力で高度を保ち、バーナーで上昇、排気弁で降下する', () => {
    const P = VEHICLES.balloon.p;
    const b = hoverBurner(P, airDensity(300), airTemp(300));
    expect(b).toBeGreaterThan(0.1);
    expect(b).toBeLessThan(0.25);
    sim.load('balloon', 'island', { calm: true, spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
    sim.step(60 * 30);
    expect(Math.abs(sim.getState().altitude - 300)).toBeLessThan(2);
    sim.setInput({ burner: true });
    sim.step(60 * 30);
    expect(sim.getState().vs).toBeGreaterThan(1.5);
    sim.setInput({ burner: false, vent: true, throttle: 0 });
    sim.step(60 * 60);
    expect(sim.getState().vs).toBeLessThan(-1.5);
  });
  it('水平は風に流され、高さで風向が変わる（高さを選んで進む向きを変えられる）', () => {
    sim.load('balloon', 'island', { weather: 'cloudy', thermals: [], spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
    sim.step(60 * 40);
    const st = sim.getState();
    const w = Math.hypot(st.wind.x, st.wind.z);
    expect(st.groundSpeed).toBeGreaterThan(w * 0.7);
    const lo = sim.world.baseWindAt(100), hi = sim.world.baseWindAt(1200);
    const ang = Math.abs(Math.atan2(hi.z, hi.x) - Math.atan2(lo.z, lo.x)) * RAD;
    expect(Math.min(ang, 360 - ang)).toBeGreaterThan(40);
  });
  it('リングコース・射撃は選べない', () => {
    expect(modesFor(VEHICLES.balloon)).toEqual(['free', 'landing']);
  });
});

describe('空飛ぶ車', () => {
  it('滑走路で走行モードから始まり、0→100 km/h は 4〜7 秒、最高速度は 420 km/h 未満', () => {
    sim.load('flycar', 'island', { calm: true });
    expect(sim.getState().carMode).toBe('drive');
    sim.setInput({ throttle: 1 });
    let t100 = null, vmax = 0;
    for (let i = 0; i < 60 * 30; i++) {
      sim.step(1);
      const s = sim.getState();
      if (t100 == null && s.groundSpeed * 3.6 >= 100) t100 = s.t;
      vmax = Math.max(vmax, s.groundSpeed * 3.6);
      if (s.status !== 'flying') break;
    }
    expect(t100).toBeGreaterThan(4);
    expect(t100).toBeLessThan(7);
    expect(vmax).toBeLessThan(420);
  });
  it('ハンドルで曲がり、手前でブレーキ', () => {
    sim.load('flycar', 'island', { calm: true });
    sim.setInput({ throttle: 0.6 });
    sim.step(60 * 4);
    const h0 = sim.getState().attitude.heading;
    sim.setInput({ throttle: 0.4, roll: 0.6 });
    sim.step(60 * 2);
    const dh = ((sim.getState().attitude.heading - h0 + 540) % 360) - 180;
    expect(dh).toBeGreaterThan(10);
    sim.setInput({ throttle: 0, roll: 0, pitch: 1 });
    sim.step(60 * 3);
    expect(sim.getState().groundSpeed).toBeLessThan(0.5);
    // 止まってからブレーキを保ち続けると後退する
    const fwd = qrot(sim.vs.q, FWD);
    sim.step(60 * 3);
    const v = sim.getState().vel;
    expect(v.x * fwd.x + v.z * fwd.z).toBeLessThan(-1);
  });
  it('飛行モードで浮き、空中では走行に戻せず、着地すると戻せる', () => {
    sim.load('flycar', 'island', { calm: true });
    expect(sim.action('carMode')).toBe('fly');
    sim.setInput({ throttle: 0.7 });
    sim.step(60 * 4);
    let st = sim.getState();
    expect(st.onGround).toBe(false);
    expect(st.agl).toBeGreaterThan(5);
    expect(sim.action('carMode')).toBe('fly');
    expect(sim.drainEvents().some((e) => e.type === 'notice')).toBe(true);
    sim.setInput({ throttle: 0.43 }); // ホバリング（約 0.45）より少し下げてゆっくり降りる
    for (let i = 0; i < 60 * 40 && !sim.getState().onGround; i++) sim.step(1);
    st = sim.getState();
    expect(st.status).toBe('flying');
    expect(st.onGround).toBe(true);
    expect(sim.action('carMode')).toBe('drive');
  });
});

describe('射撃', () => {
  it('線分と球の当たり判定', () => {
    expect(segmentHitsSphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, { x: 0.5, y: 0, z: -5 }, 1)).toBe(true);
    expect(segmentHitsSphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, { x: 3, y: 0, z: -5 }, 1)).toBe(false);
    expect(segmentHitsSphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: -12 }, 1)).toBe(false);
  });
  it('向きを最大角度だけ回す', () => {
    const r = rotateToward({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, Math.PI / 4);
    expect(r.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(r.z).toBeCloseTo(-Math.SQRT1_2, 5);
  });
  it('正面の風船を撃つと割れて得点が入る', () => {
    sim.load('prop', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 800, z: 3000 }, heading: 0, speed: 50, throttle: 0.6 } });
    const c = sim.combat;
    const f = qrot(sim.vs.q, FWD);
    const b = c.targets.find((t) => t.type === 'balloon');
    b.pos = vadd(sim.vs.pos, vscale(f, 300));
    sim.setInput({ fire: true, throttle: 0.6 });
    sim.step(90);
    expect(b.alive).toBe(false);
    expect(c.score).toBeGreaterThanOrEqual(100);
    expect(c.shots).toBeGreaterThan(5);
    expect(c.ammo).toBe(VEHICLES.prop.weapon.ammo - c.shots);
  });
  it('戦闘機: 敵を正面に入れ続けるとロックオンし、ミサイルで撃墜できる', () => {
    sim.load('fighter', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 2000, z: 3000 }, heading: 0, speed: 200, throttle: 0.8 } });
    const c = sim.combat;
    expect(sim.action('missile')).toBe(false); // ロックなし
    const e = c.enemies[0];
    const f = qrot(sim.vs.q, FWD);
    e.pos = vadd(sim.vs.pos, vscale(f, 1500));
    e.dir = f;
    e.speed = 150;
    e.turnRate = 0;
    for (const o of c.enemies.slice(1)) o.alive = false;
    sim.step(70);
    expect(c.lock.locked).toBe(true);
    expect(sim.action('missile')).toBe(true);
    for (let i = 0; i < 60 * 8 && e.alive; i++) sim.step(1);
    expect(e.alive).toBe(false);
    expect(c.kills).toBe(1);
    expect(c.missilesLeft).toBe(VEHICLES.fighter.weapon.missiles - 1);
  });
  it('敵機は追ってきて撃ち、当たると体力が減る。0 で撃墜', () => {
    sim.load('prop', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 800, z: 3000 }, heading: 0, speed: 50, throttle: 0.6 } });
    const c = sim.combat;
    let hit = false;
    for (let i = 0; i < 60 * 120 && sim.getState().status === 'flying'; i++) {
      sim.step(1);
      if (c.health < 100) { hit = true; break; }
    }
    expect(hit).toBe(true);
    c.damagePlayer(200, sim._env);
    expect(sim.getState().status).toBe('crashed');
    expect(sim.getState().crashCause).toContain('撃墜');
  });
  it('武器の無い機体は風船に体当たりして割る', () => {
    sim.load('paraglider', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 600, z: 3000 }, heading: 0, speed: 10.5 } });
    const c = sim.combat;
    expect(c.armed).toBe(false);
    expect(c.enemies.length).toBe(0);
    const b = c.targets[0];
    b.pos = vadd(sim.vs.pos, vscale(qrot(sim.vs.q, FWD), 30));
    b.pos.y = sim.vs.pos.y - 2;
    sim.step(60 * 5);
    expect(b.alive).toBe(false);
  });
  it('全ての目標を倒すと結果が出る（スコアにタイムボーナス）', () => {
    sim.load('paraglider', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 600, z: 3000 }, heading: 0, speed: 10.5 } });
    for (const t of sim.combat.targets) t.alive = false;
    sim.step(2);
    const st = sim.getState();
    expect(st.status).toBe('finished');
    expect(st.result.type).toBe('combat');
    expect(st.result.timeBonus).toBeGreaterThan(0);
  });
  it('2 人プレイ（PvP）では敵 AI を出さず、外部目標（相手）への命中を通知する', () => {
    const world = sim.load('fighter', 'island', { mode: 'combat', calm: true, pvp: true, spawn: { pos: { x: 0, y: 2000, z: 3000 }, heading: 0, speed: 200, throttle: 0.8 } }) && sim.world;
    const c = sim.combat;
    expect(c.enemies.length).toBe(0);
    c.externalTargets = [{ id: 'remote', pos: vadd(sim.vs.pos, vscale(qrot(sim.vs.q, FWD), 400)), vel: sim.vs.vel, r: 5 }];
    sim.setInput({ fire: true });
    let got = false;
    for (let i = 0; i < 60 && !got; i++) {
      c.externalTargets[0].pos = vadd(c.externalTargets[0].pos, vscale(sim.vs.vel, 1 / 60));
      sim.step(1);
      got = sim.drainEvents().some((e) => e.type === 'externalHit');
    }
    expect(got).toBe(true);
    void world;
    expect(new Combat(sim.world, VEHICLES.fighter, { pvp: true }).maxWaves).toBe(0);
  });
});

describe('リングの接近予測', () => {
  const ring = { pos: { x: 0, y: 100, z: -500 }, normal: { x: 0, y: 0, z: -1 }, radius: 20 };
  it('まっすぐ向かっていれば通過、ずれていれば通過しない', () => {
    const a = ringApproach(ring, { x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: -50 });
    expect(a.willPass).toBe(true);
    expect(a.eta).toBeCloseTo(10, 5);
    expect(a.dist).toBeCloseTo(500, 5);
    const b = ringApproach(ring, { x: 0, y: 100, z: 0 }, { x: 5, y: 0, z: -50 });
    expect(b.willPass).toBe(false);
    expect(b.miss).toBeCloseTo(50, 3);
    const c = ringApproach(ring, { x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 50 });
    expect(c.eta).toBe(null);
  });
  it('リングコースの状態に接近予測が入る', () => {
    sim.load('prop', 'island', { mode: 'rings', calm: true });
    const st = sim.getState();
    expect(st.rings.approach.dist).toBeGreaterThan(0);
    expect(st.rings.nextRadius).toBe(VEHICLES.prop.ringRadius);
  });
});

describe('ゴースト', () => {
  it('記録して再生すると同じ軌跡になる', () => {
    const rec = new GhostRecorder();
    for (let i = 0; i <= 600; i++) {
      const t = i / 60;
      rec.record(t, { x: t * 50, y: 100 + Math.sin(t), z: 0 }, quatFromAttitude(0, 0.3, 0));
    }
    const p = new GhostPlayer(JSON.parse(JSON.stringify(rec.toJSON())));
    const s = p.sample(5.05);
    expect(s.pos.x).toBeCloseTo(252.5, 0);
    expect(p.sample(20)).toBe(null);
  });
});

describe('2 人プレイの通信', () => {
  it('状態の符号化・復号', () => {
    const st = { pos: { x: 1.234, y: 2, z: 3 }, quat: { x: 0, y: 0.7071, z: 0, w: 0.7071 }, vel: { x: 1, y: 2, z: 3 }, throttle: 0.5, status: 'flying', rings: { index: 3 }, combat: { health: 80, score: 300 }, phase: 'canopy', carMode: null };
    const d = decodeState(JSON.parse(JSON.stringify(encodeState(12.3456, st, { rotorRpm: 1 }))));
    expect(d.t).toBeCloseTo(12.346, 3);
    expect(d.pos.x).toBeCloseTo(1.23, 2);
    expect(d.extra.ringIndex).toBe(3);
    expect(d.extra.health).toBe(80);
    expect(d.extra.phase).toBe('canopy');
  });
  it('時計のずれを ping/pong から推定する', () => {
    const c = new ClockSync();
    // 相手の時計は +5 秒、片道 30ms
    for (let i = 0; i < 6; i++) c.add(i, i + 0.03 + 5, i + 0.06);
    expect(c.offset).toBeCloseTo(5, 3);
    expect(c.rtt).toBeCloseTo(0.06, 3);
  });
  it('補間: 前後のスナップショットの間を滑らかにつなぎ、途切れたら外挿して止まる', () => {
    const b = new SnapshotBuffer();
    const q = { x: 0, y: 0, z: 0, w: 1 };
    b.push({ t: 1, pos: { x: 0, y: 0, z: 0 }, q, vel: { x: 10, y: 0, z: 0 } });
    b.push({ t: 1.05, pos: { x: 0.5, y: 0, z: 0 }, q, vel: { x: 10, y: 0, z: 0 } });
    expect(b.sample(1.025).pos.x).toBeCloseTo(0.25, 5);
    expect(b.sample(1.15).pos.x).toBeCloseTo(1.5, 5);
    expect(b.sample(1.15).mode).toBe('extrap');
    expect(b.sample(3).mode).toBe('stale');
    expect(b.push({ t: 1.05, pos: { x: 0, y: 0, z: 0 }, q, vel: { x: 0, y: 0, z: 0 } })).toBe(false); // 重複は捨てる
  });
  it('遅延 50±15ms・損失 10% の回線でも、旋回する相手の表示誤差は小さい', () => {
    // 疑似時計と手動スケジューラで決定的に再現
    let now = 0;
    const queue = [];
    const schedule = (fn, ms) => queue.push({ at: now + ms / 1000, fn });
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const [ta, tb] = loopbackPair({ latency: 0.05, jitter: 0.015, loss: 0.1, rnd, schedule });
    const A = new Session(ta, { role: 'host', name: 'A', now: () => now + 1000 });
    const B = new Session(tb, { role: 'guest', name: 'B', now: () => now });
    // A の飛行機: 半径 400 m を 60 m/s で旋回
    const R = 400, V = 60, w = V / R;
    const truth = (t) => ({ pos: { x: R * Math.cos(w * t), y: 500, z: R * Math.sin(w * t) }, vel: { x: -V * Math.sin(w * t), y: 0, z: V * Math.cos(w * t) } });
    const errors = [];
    let nextSend = 0, nextPing = 0;
    for (let i = 0; i < 60 * 30; i++) {
      now = i / 60;
      while (queue.length) {
        queue.sort((a, b) => a.at - b.at);
        if (queue[0].at > now) break;
        queue.shift().fn();
      }
      if (now >= nextPing) { B.ping(); nextPing += 1; }
      if (now >= nextSend) {
        const s = truth(now);
        A.sendState(encodeState(now + 1000, { pos: s.pos, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: s.vel, throttle: 1, status: 'flying' }, {}));
        nextSend += 0.05;
      }
      if (now > 3) {
        const r = B.sampleRemote();
        // 表示は INTERP_DELAY 遅れた時刻の真値と比べる
        const tr = now + B.remote.clock.offset - 0.1 - 1000;
        const tv = truth(tr);
        errors.push(Math.hypot(r.pos.x - tv.pos.x, r.pos.z - tv.pos.z));
      }
    }
    errors.sort((a, b) => a - b);
    const p95 = errors[Math.floor(errors.length * 0.95)];
    expect(B.remote.clock.offset).toBeCloseTo(1000, 1);
    expect(p95).toBeLessThan(1.5);
  });
});

describe('射撃（第 2 回レビュー対応）', () => {
  it('地上目標に当たった弾は、地面に消される前に命中として数える', () => {
    sim.load('prop', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 800, z: 3000 }, heading: 0, speed: 50, throttle: 0.6 } });
    const c = sim.combat;
    const g = c.targets.find((t) => t.type === 'ground');
    const terr = sim.world.terrain;
    // 地上目標の手前・上から、地面すれすれに当たる弾を 1 発置く（このステップで地面の下まで進む）
    const a = { x: g.pos.x, y: g.pos.y + 3, z: g.pos.z + 10 };
    c.bullets.push({ pos: a, vel: { x: 0, y: -(a.y - terr.surfaceAt(g.pos.x, g.pos.z) + 2) * 60, z: -600 }, ttl: 1, owner: 'player', dmg: 10 });
    const hp = g.hp;
    c.step(sim.vs, { fire: false }, sim._env, 1 / 60);
    expect(g.hp).toBeLessThan(hp);
  });
  it('敵機は 1 機ずつ違う所を狙い、遠いときはプレイヤーより速く飛ぶ', () => {
    sim.load('fighter', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 2000, z: 3000 }, heading: 0, speed: 250, throttle: 1 } });
    const c = sim.combat;
    const offs = c.enemies.map((e) => `${e.offset.x.toFixed(1)},${e.offset.z.toFixed(1)}`);
    expect(new Set(offs).size).toBe(c.enemies.length);
    sim.step(10);
    const far = c.enemies.filter((e) => Math.hypot(e.pos.x - sim.vs.pos.x, e.pos.z - sim.vs.pos.z) > 1300);
    expect(far.length).toBeGreaterThan(0);
    for (const e of far) expect(e.speed).toBeGreaterThanOrEqual(Math.hypot(sim.vs.vel.x, sim.vs.vel.y, sim.vs.vel.z) * 1.05 - 1e-6);
  });
  it('滑空する機体の的は、滑空で届く高さ（出現位置からの滑空線より下）に並ぶ', () => {
    for (const id of ['paraglider', 'wingsuit', 'sailplane']) {
      const st = sim.load(id, 'island', { mode: 'combat', calm: true });
      const L = VEHICLES[id].ringGlide;
      const balloons = sim.combat.targets.filter((t) => t.type === 'balloon');
      expect(balloons.length, id).toBeGreaterThan(5);
      for (const b of balloons) {
        const d = Math.hypot(b.pos.x - st.pos.x, b.pos.z - st.pos.z);
        expect(b.pos.y, id).toBeLessThanOrEqual(st.pos.y - d / L + 1e-6);
      }
    }
  });
  it('スカイダイビングの的は真下に縦に並び、速い機体の的は出現高度の前後', () => {
    let st = sim.load('skydive', 'island', { mode: 'combat', calm: true });
    for (const b of sim.combat.targets.filter((t) => t.type === 'balloon')) {
      expect(b.pos.y).toBeLessThan(st.pos.y);
      expect(Math.hypot(b.pos.x - st.pos.x, b.pos.z - st.pos.z)).toBeLessThan(900);
    }
    st = sim.load('airliner', 'island', { mode: 'combat', calm: true });
    for (const b of sim.combat.targets.filter((t) => t.type === 'balloon')) {
      expect(Math.abs(b.pos.y - st.pos.y)).toBeLessThan(160);
      expect(b.r).toBeGreaterThanOrEqual(VEHICLES.airliner.p.bodyRadius * 4);
    }
  });
  it('飛び直せない機体は、着地して止まるとその時点の点数で終わる', () => {
    // 着陸エリアの真上の低い所から（平らな所に降りる）
    const fld = sim.load('paraglider', 'island', { calm: true }) && sim.world.terrain.field;
    sim.load('paraglider', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: fld.x, y: fld.elevation + 25, z: fld.z }, heading: fld.heading, speed: 10.5 } });
    sim.combat.score = 300;
    for (let i = 0; i < 60 * 400 && sim.getState().status === 'flying'; i++) sim.step(1);
    const st = sim.getState();
    expect(st.status).toBe('finished');
    expect(st.result.partial).toBe(true);
    expect(st.result.score).toBe(300);
    expect(st.result.timeBonus).toBe(0);
  });
  it('難易度でエイムアシストの範囲と敵の数が変わる', () => {
    const e = new Combat(sim.world, VEHICLES.fighter, { difficulty: 'easy' });
    const h = new Combat(sim.world, VEHICLES.fighter, { difficulty: 'hard' });
    expect(e.diff.assistPlane).toBeGreaterThan(h.diff.assistPlane);
    expect(h.enemies.length).toBe(e.enemies.length + 1);
  });
  it('機首をこちらに向けて近づく敵を「脅威」として返す', () => {
    sim.load('prop', 'island', { mode: 'combat', calm: true, spawn: { pos: { x: 0, y: 800, z: 3000 }, heading: 0, speed: 50, throttle: 0.6 } });
    const c = sim.combat;
    const e = c.enemies[0];
    e.pos = vadd(sim.vs.pos, { x: 0, y: 0, z: 600 });
    e.dir = { x: 0, y: 0, z: -1 };
    expect(c.threats(sim.vs.pos).length).toBeGreaterThan(0);
    e.dir = { x: 0, y: 0, z: 1 };
    expect(c.threats(sim.vs.pos).length).toBe(0);
  });
  it('2 人プレイ: ホストの的の配置をそのまま使える', () => {
    sim.load('prop', 'island', { mode: 'combat', calm: true, pvp: true });
    const list = sim.combat.targetList();
    const s2 = new Simulation();
    s2.load('heli', 'island', { mode: 'combat', calm: true, pvp: true, targets: JSON.parse(JSON.stringify(list)) });
    expect(s2.combat.targets.map((t) => t.pos)).toEqual(list.map((t) => t.pos));
  });
});

describe('リング（第 2 回レビュー対応）', () => {
  it('輪の外側を大きく外れて通過面を横切っても「外した」として次へ進む', () => {
    sim.load('prop', 'island', { mode: 'rings', calm: true });
    const tr = sim.tracker;
    const r = tr.rings[0];
    const off = vadd(r.pos, { x: r.normal.z * r.radius * 8, y: 0, z: -r.normal.x * r.radius * 8 });
    tr.update(vadd(off, vscale(r.normal, -1)), vadd(off, vscale(r.normal, 1)), 1, () => {});
    expect(tr.index).toBe(1);
    expect(tr.missed).toBe(1);
  });
  it('2 人プレイ: 遅い方の機体のコースと大きい方の輪', () => {
    const a = sim.load('fighter', 'island', { mode: 'rings', calm: true, courseVehicle: 'prop', ringRadius: 40 }) && sim.rings;
    const d = Math.hypot(a[1].pos.x - a[0].pos.x, a[1].pos.z - a[0].pos.z);
    expect(d).toBeLessThan(50 * VEHICLES.prop.ringSpacingTime * 1.3);
    expect(a.every((r) => r.radius >= 40)).toBe(true);
  });
});

describe('空飛ぶ車（第 2 回レビュー対応）', () => {
  it('自由飛行で着地しても評価画面にしない（そのまま走れる）', () => {
    const fld = sim.load('flycar', 'island', { calm: true }) && sim.world.terrain.field;
    sim.load('flycar', 'island', { calm: true, spawn: { pos: { x: fld.x, y: fld.elevation + 6, z: fld.z }, heading: fld.heading, speed: 0 } });
    sim.setInput({ throttle: 0.4 });
    for (let i = 0; i < 60 * 30 && !sim.getState().onGround; i++) sim.step(1);
    sim.setInput({ throttle: 0 });
    sim.step(60 * 3);
    expect(sim.getState().onGround).toBe(true);
    expect(sim.getState().result).toBe(null);
    expect(sim.getState().status).toBe('flying');
  });
  it('ビルの屋上を走れて、縁から走り出ると飛び出して落ちる', () => {
    sim.load('flycar', 'city', { calm: true });
    const terr = sim.world.terrain;
    // 十分広い屋上を探す
    const b = terr.buildings.filter((x) => x.w > 30 && x.d > 30 && x.h > 6).sort((p, q) => q.w * q.d - p.w * p.d)[0];
    expect(b).toBeTruthy();
    const top = b.base + b.h;
    sim.vs.mode = 'drive';
    sim.vs.onGround = true;
    sim.vs.psi = Math.PI / 2; // +x 向き
    sim.vs.pos = { x: b.x - b.w / 2 + 3, y: top + VEHICLES.flycar.p.cgHeight, z: b.z };
    sim.vs.v = 12;
    sim.setInput({ throttle: 0.3, pitch: 0, roll: 0 });
    sim.step(30);
    expect(sim.getState().status).toBe('flying');
    expect(sim.vs.pos.y).toBeCloseTo(top + VEHICLES.flycar.p.cgHeight, 1);
    let air = false;
    for (let i = 0; i < 60 * 10 && sim.getState().status === 'flying'; i++) {
      sim.step(1);
      if (sim.vs.airborne) air = true;
    }
    expect(air).toBe(true);
  });
  it('壁に押し付けても「進めません」は 2 秒に 1 回', () => {
    sim.load('flycar', 'city', { calm: true });
    const terr = sim.world.terrain;
    const b = terr.buildings.filter((x) => x.h > 10 && x.w > 20).sort((p, q) => q.h - p.h)[0];
    sim.vs.mode = 'drive';
    sim.vs.onGround = true;
    sim.vs.psi = Math.PI / 2;
    const x = b.x - b.w / 2 - 1.2;
    sim.vs.pos = { x, y: terr.surfaceAt(x, b.z) + VEHICLES.flycar.p.cgHeight, z: b.z };
    sim.vs.v = 0;
    sim.drainEvents();
    sim.setInput({ throttle: 0.3 });
    sim.step(60 * 4);
    const n = sim.drainEvents().filter((e) => e.type === 'notice').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(2);
  });
});

describe('2 人プレイの切断', () => {
  it('相手から 12 秒以上何も届かなければ切断扱いにする（3 秒で不安定）。自分が止まっていた分は数えない', () => {
    let now = 0;
    const [ta] = loopbackPair({ schedule: () => {} });
    const A = new Session(ta, { role: 'host', now: () => now });
    let closed = false;
    A.on('close', () => { closed = true; });
    // 1 秒ごとに確認（通常のタイマー）
    for (now = 1; now <= 4; now++) A.checkAlive();
    expect(A.silence()).toBeGreaterThan(SILENCE_WARN);
    expect(closed).toBe(false);
    for (; now <= 13; now++) A.checkAlive();
    expect(closed).toBe(true);
    // 自分が 20 秒止まっていた（タイマーが来なかった）だけなら切らない
    const [tb] = loopbackPair({ schedule: () => {} });
    now = 0;
    const B = new Session(tb, { role: 'host', now: () => now });
    let closedB = false;
    B.on('close', () => { closedB = true; });
    B.checkAlive();
    now = 20;
    B.checkAlive();
    expect(closedB).toBe(false);
  });
  it('PeerJS のエラーを分かる言葉にする', () => {
    expect(peerErrorMessage({ type: 'peer-unavailable' })).toContain('ルームが見つかりません');
    expect(peerErrorMessage({ type: 'ice-timeout' })).toContain('Wi-Fi');
    expect(peerErrorMessage({ type: 'network' })).toContain('インターネット');
  });
});