// 物理の挙動確認用スクリプト（node scripts/probe.mjs）
import { Simulation } from '../src/sim/sim.js';
import { stallSpeed } from '../src/sim/vehicles/fixedwing.js';
import { VEHICLES } from '../src/data/vehicles.js';

const sim = new Simulation();
const log = (...a) => console.log(...a);

// 小型機 離陸
sim.load('prop', 'island', { calm: true });
sim.setInput({ throttle: 1, pitch: 0.6 });
let st;
for (let i = 0; i < 60 * 40; i++) {
  sim.step(1);
  st = sim.getState();
  if (!st.onGround) break;
}
log('prop liftoff', st.liftoffSpeed?.toFixed(2), 't', st.t.toFixed(1), 'status', st.status, st.crashCause);
log('prop Vs analytic', stallSpeed(VEHICLES.prop.p).toFixed(2));

// 小型機 失速（1G 減速）
sim.load('prop', 'island', { calm: true, spawn: { pos: { x: 0, y: 1000, z: 3000 }, heading: 0, speed: 40, throttle: 0 } });
const alt0 = 1000;
for (let i = 0; i < 60 * 90; i++) {
  st = sim.getState();
  const cmd = Math.max(-1, Math.min(1, 0.02 * (alt0 - st.altitude) - 0.15 * st.vs));
  sim.setInput({ throttle: 0, pitch: cmd });
  sim.step(1);
  st = sim.getState();
  if (st.stalled) break;
}
log('prop stall at', st.speed.toFixed(2), 'alpha', st.alpha.toFixed(1), 't', st.t.toFixed(1), 'g', st.g.toFixed(2));

// 戦闘機 ロールレート
function rollRate(id, speed) {
  sim.load(id, 'island', { calm: true, spawn: { pos: { x: 0, y: 2000, z: 3000 }, heading: 0, speed, throttle: 0.8 } });
  sim.setInput({ roll: 1 });
  let maxP = 0, prev = sim.getState().attitude.roll;
  for (let i = 0; i < 60 * 3; i++) {
    sim.step(1);
    maxP = Math.max(maxP, Math.abs(sim.vs.p) * 180 / Math.PI);
  }
  return maxP;
}
log('fighter roll rate', rollRate('fighter', 200).toFixed(1));
log('airliner roll rate', rollRate('airliner', 130).toFixed(1));
log('prop roll rate', rollRate('prop', 50).toFixed(1));

// 旅客機 バンク保護
sim.load('airliner', 'island', { calm: true, spawn: { pos: { x: 0, y: 2000, z: 3000 }, heading: 0, speed: 130, throttle: 0.6 } });
sim.setInput({ roll: 1 });
let maxBank = 0;
for (let i = 0; i < 60 * 30; i++) { sim.step(1); maxBank = Math.max(maxBank, Math.abs(sim.getState().attitude.roll)); }
log('airliner max bank', maxBank.toFixed(2), 'alt', sim.getState().altitude.toFixed(0));
sim.setInput({ roll: 0 });
for (let i = 0; i < 60 * 20; i++) sim.step(1);
log('airliner bank after release', sim.getState().attitude.roll.toFixed(1));

// 戦闘機 G 制限
sim.load('fighter', 'island', { calm: true, spawn: { pos: { x: 0, y: 3000, z: 3000 }, heading: 0, speed: 250, throttle: 1 } });
sim.setInput({ pitch: 1, throttle: 1 });
let maxG = 0;
for (let i = 0; i < 60 * 5; i++) { sim.step(1); maxG = Math.max(maxG, sim.getState().g); }
log('fighter max G', maxG.toFixed(3), 'speed', sim.getState().speed.toFixed(0));

// 戦闘機 低速で引き続けると失速 → 離すと回復
sim.load('fighter', 'island', { calm: true, spawn: { pos: { x: 0, y: 3000, z: 3000 }, heading: 0, speed: 110, throttle: 0.3 } });
sim.setInput({ pitch: 1, throttle: 0.3 });
let stalledOnce = false;
for (let i = 0; i < 60 * 6; i++) { sim.step(1); if (sim.getState().stalled) stalledOnce = true; }
log('fighter stalled', stalledOnce, 'alpha', sim.getState().alpha.toFixed(1));
sim.setInput({ pitch: 0, throttle: 1 });
for (let i = 0; i < 60 * 8; i++) sim.step(1);
st = sim.getState();
log('fighter after release stalled', st.stalled, 'alpha', st.alpha.toFixed(1), 'speed', st.speed.toFixed(0));

// 水平飛行のトリム保持（入力なしで 20 秒）
for (const id of ['prop', 'airliner', 'fighter']) {
  const sp = { prop: 50, airliner: 130, fighter: 200 }[id];
  const thr = { prop: 0.6, airliner: 0.55, fighter: 0.6 }[id];
  sim.load(id, 'island', { calm: true, spawn: { pos: { x: 0, y: 1500, z: 3000 }, heading: 0, speed: sp, throttle: thr } });
  sim.setInput({ throttle: thr });
  for (let i = 0; i < 60 * 20; i++) sim.step(1);
  st = sim.getState();
  log(id, 'trim20s alt', st.altitude.toFixed(0), 'spd', st.speed.toFixed(1), 'pitch', st.attitude.pitch.toFixed(1), 'vs', st.vs.toFixed(2));
}

// 性能
const t0 = performance.now();
sim.load('fighter', 'island', { spawn: { pos: { x: 0, y: 3000, z: 3000 }, heading: 0, speed: 200, throttle: 0.7 } });
sim.setInput({ roll: 0.2, pitch: 0.1 });
sim.step(10000);
log('10000 steps ms', (performance.now() - t0).toFixed(1));
