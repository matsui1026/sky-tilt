import { Simulation } from '../src/sim/sim.js';
import { hoverCollective } from '../src/sim/vehicles/heli.js';
import { airDensity } from '../src/sim/world.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { steadyGlide } from '../src/sim/vehicles/glider.js';

const sim = new Simulation();
const log = (...a) => console.log(...a);
let st;

// ヘリ ホバリング
const H = VEHICLES.heli.p;
const y0 = 300;
const c = hoverCollective(H, airDensity(y0));
sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: y0, z: 3000 }, heading: 0, speed: 0, throttle: c } });
sim.setInput({ throttle: c });
for (let i = 0; i < 600; i++) sim.step(1);
st = sim.getState();
log('heli hover c', c.toFixed(4), 'dh 10s', (st.altitude - y0).toFixed(3), 'agl', st.agl.toFixed(0));

// 地面効果: 指定高さで垂直加速度 0 になるコレクティブを二分探索
function eqCollective(hAgl) {
  let lo = 0.3, hi = 1.0;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    sim.load('heli', 'island', { calm: true, spawn: { pos: { x: 0, y: 6 + 1.2 + hAgl, z: -500 }, heading: 0, speed: 0, throttle: mid } });
    sim.vs.rotorRpm = 1;
    sim.setInput({ throttle: mid });
    sim.step(1);
    const vy = sim.getState().vs;
    if (vy > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
log('ground at runway', sim.world.terrain.surfaceAt(0, -500));
log('heli collective at 1m', eqCollective(1).toFixed(4), 'at 3m', eqCollective(3).toFixed(4), 'at 60m', eqCollective(60).toFixed(4));

// パラグライダー トリム
sim.load('paraglider', 'mountains', { calm: true, spawn: { pos: { x: 0, y: 3500, z: 0 }, heading: 0, speed: 10 } });
for (let i = 0; i < 60 * 40; i++) sim.step(1);
st = sim.getState();
log('paraglider trim V', st.speed.toFixed(2), 'sink', (-st.vs).toFixed(3), 'LD', st.glideRatio?.toFixed(2), 'status', st.status);
log('paraglider analytic', steadyGlide(VEHICLES.paraglider.p, 95, VEHICLES.paraglider.p.CLtrim, airDensity(3400)));
log('paraglider analytic sea', steadyGlide(VEHICLES.paraglider.p, 95, VEHICLES.paraglider.p.CLtrim));

// サーマル
sim.load('paraglider', 'island', { calm: true, thermals: [{ x: 0, z: 3000, radius: 150, strength: 3, top: 2000, ground: 0 }], spawn: { pos: { x: 0, y: 500, z: 3000 }, heading: 0, speed: 10.5 } });
sim.setInput({ roll: 0.6 }); // 旋回してサーマル内に留まる
const a0 = sim.getState().altitude;
for (let i = 0; i < 60 * 30; i++) sim.step(1);
st = sim.getState();
log('thermal climb 30s', (st.altitude - a0).toFixed(1), 'vs', st.vs.toFixed(2));

// ウイングスーツ
sim.load('wingsuit', 'island', { calm: true, spawn: { pos: { x: 0, y: 3000, z: 3000 }, heading: 0, speed: 30, phase: 'wingsuit' } });
for (let i = 0; i < 60 * 25; i++) sim.step(1);
st = sim.getState();
log('wingsuit V', st.speed.toFixed(1), 'gs', st.groundSpeed.toFixed(1), 'sink', (-st.vs).toFixed(1), 'LD', st.glideRatio?.toFixed(2), st.phase);
sim.setInput({ pitch: -1 });
for (let i = 0; i < 60 * 15; i++) sim.step(1);
st = sim.getState();
log('wingsuit dive V', st.speed.toFixed(1), 'LD', st.glideRatio?.toFixed(2));
sim.setInput({ pitch: 0.6 });
for (let i = 0; i < 60 * 15; i++) sim.step(1);
st = sim.getState();
log('wingsuit flare V', st.speed.toFixed(1), 'LD', st.glideRatio?.toFixed(2));

// スカイダイビング
sim.load('skydive', 'island', { calm: true, spawn: { pos: { x: 0, y: 2500, z: 3000 }, heading: 0, speed: 35, phase: 'freefall' } });
let v1000 = null;
while (sim.getState().altitude > 1000 && sim.getState().status === 'flying') sim.step(1);
st = sim.getState();
log('freefall at', st.altitude.toFixed(0), 'speed', st.speed.toFixed(2), 'vs', st.vs.toFixed(2), 't', st.t.toFixed(1));
sim.action('deploy');
let maxG = 0;
for (let i = 0; i < 60 * 20; i++) { sim.step(1); maxG = Math.max(maxG, sim.getState().g); }
st = sim.getState();
log('canopy', st.phase, 'sink', (-st.vs).toFixed(2), 'speed', st.speed.toFixed(2), 'opening maxG', maxG.toFixed(1));
sim.setInput({ pitch: 1 });
for (let i = 0; i < 60 * 1.5; i++) sim.step(1);
st = sim.getState();
log('flare sink', (-st.vs).toFixed(2), 'gs', st.groundSpeed.toFixed(1));
// 着地まで
sim.setInput({ pitch: 0 });
while (sim.getState().status === 'flying' && sim.getState().agl > 4) sim.step(1);
sim.setInput({ pitch: 1 });
for (let i = 0; i < 60 * 10 && sim.getState().status === 'flying'; i++) sim.step(1);
st = sim.getState();
log('landing status', st.status, st.crashCause, JSON.stringify(st.result));

// ジェットスーツ
const J = VEHICLES.jetsuit.p;
sim.load('jetsuit', 'island', { calm: true, spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
const thr = sim.getState().throttleCmd;
for (let i = 0; i < 600; i++) sim.step(1);
st = sim.getState();
log('jetsuit thr', thr.toFixed(4), 'dh', (st.altitude - 300).toFixed(3), 'fuel', st.fuel.toFixed(4));
sim.setInput({ pitch: -0.75, throttle: 1 });
for (let i = 0; i < 60 * 20; i++) sim.step(1);
st = sim.getState();
log('jetsuit cruise gs', st.groundSpeed.toFixed(1), 'vs', st.vs.toFixed(2), 'fuel', st.fuel.toFixed(3));
