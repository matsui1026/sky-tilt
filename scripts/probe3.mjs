// 新しい機体・射撃モードの挙動確認（node scripts/probe3.mjs）
import { Simulation } from '../src/sim/sim.js';
import { steadyGlide } from '../src/sim/vehicles/glider.js';
const sim = new Simulation();
const log = (...a) => console.log(...a);
let st;

// グライダー
sim.load('sailplane', 'island', { calm: true, spawn: { pos: { x: 0, y: 1500, z: 3000 }, heading: 0, speed: 29 } });
sim.step(60 * 40);
st = sim.getState();
log('sailplane V', st.speed.toFixed(1), 'sink', (-st.vs).toFixed(2), 'LD', st.glideRatio?.toFixed(1), st.status);

// ドローン
sim.load('drone', 'island', { calm: true, spawn: { pos: { x: 0, y: 200, z: 3000 }, heading: 0, speed: 0 } });
const thr = sim.getState().throttleCmd;
sim.step(600);
st = sim.getState();
log('drone hover thr', thr.toFixed(3), 'dh', (st.altitude - 200).toFixed(2), 'fuel', st.fuel?.toFixed(3));
sim.setInput({ pitch: -1 });
sim.step(60 * 8);
st = sim.getState();
log('drone full fwd gs', (st.groundSpeed * 3.6).toFixed(0), 'km/h vs', st.vs.toFixed(1));

// 熱気球
sim.load('balloon', 'island', { calm: true, spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
const b0 = sim.getState().throttleCmd;
sim.step(60 * 30);
st = sim.getState();
log('balloon hover burner', b0.toFixed(3), 'dh30s', (st.altitude - 300).toFixed(1), 'temp', st.balloon.temp.toFixed(1));
sim.setInput({ burner: true });
sim.step(60 * 30);
st = sim.getState();
log('balloon burner30s vs', st.vs.toFixed(2), 'alt', st.altitude.toFixed(0), 'temp', st.balloon.temp.toFixed(1));
sim.setInput({ burner: false, vent: true, throttle: 0 });
sim.step(60 * 40);
st = sim.getState();
log('balloon vent40s vs', st.vs.toFixed(2), 'alt', st.altitude.toFixed(0));
sim.load('balloon', 'island', { weather: 'cloudy', thermals: [], spawn: { pos: { x: 0, y: 300, z: 3000 }, heading: 0, speed: 0 } });
sim.step(60 * 20);
st = sim.getState();
log('balloon in wind gs', st.groundSpeed.toFixed(1), 'wind', JSON.stringify(st.wind), 'above', JSON.stringify(st.balloon.windAbove));

// 空飛ぶ車
sim.load('flycar', 'island', { calm: true });
st = sim.getState();
log('flycar spawn', st.carMode, st.onGround, st.altitude.toFixed(1));
sim.setInput({ throttle: 1 });
let t100 = null;
for (let i = 0; i < 60 * 15; i++) { sim.step(1); const s = sim.getState(); if (t100 == null && s.groundSpeed * 3.6 >= 100) t100 = s.t; }
st = sim.getState();
log('flycar 0-100', t100?.toFixed(2), 's  15s speed', (st.groundSpeed * 3.6).toFixed(0), 'status', st.status, st.crashCause);
sim.setInput({ throttle: 0.6, roll: 0.5 });
sim.step(60 * 3);
st = sim.getState();
log('flycar steer heading', st.attitude.heading.toFixed(0), 'status', st.status);
sim.action('carMode');
sim.setInput({ throttle: 0.8, roll: 0 });
sim.step(60 * 5);
st = sim.getState();
log('flycar fly mode', st.carMode, 'agl', st.agl.toFixed(1), 'onGround', st.onGround, st.status, st.crashCause);

// 射撃
sim.load('fighter', 'island', { mode: 'combat', calm: true });
st = sim.getState();
log('combat', JSON.stringify(st.combat));
sim.setInput({ fire: true, throttle: 0.8 });
sim.step(120);
st = sim.getState();
log('after fire', st.combat.shots, st.combat.ammo, 'bullets', sim.combat.bullets.length, 'enemies', sim.combat.enemies.map((e) => Math.round(Math.hypot(e.pos.x - st.pos.x, e.pos.z - st.pos.z))).join(','));
sim.setInput({ fire: false });
for (let i = 0; i < 60 * 30 && sim.getState().status === 'flying'; i++) sim.step(1);
st = sim.getState();
log('30s later health', st.combat.health, st.status, st.crashCause, 'enemyShots?', sim.combat.bullets.filter((b) => b.owner === 'enemy').length);
