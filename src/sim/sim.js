// シミュレーション本体（固定タイムステップ 60Hz）。DOM / Three.js 非依存。
import { DEG, RAD, clamp, attitudeOf, vlen } from './math.js';
import { World, airDensity } from './world.js';
import { Terrain } from './terrain.js';
import { getVehicle } from '../data/vehicles.js';
import { getLocation } from '../data/locations.js';
import { createFixedWing, stepFixedWing } from './vehicles/fixedwing.js';
import { createHeli, stepHeli, hoverCollective } from './vehicles/heli.js';
import { createParaglider, stepParaglider } from './vehicles/paraglider.js';
import { createJetsuit, stepJetsuit, jetsuitHoverThrottle } from './vehicles/jetsuit.js';
import { createHuman, stepHuman, humanDeploy } from './vehicles/human.js';
import { createBalloon, stepBalloon, hoverBurner, airTemp } from './vehicles/balloon.js';
import { createFlycar, stepFlycar, flycarToggleMode, flycarHoverThrottle } from './vehicles/flycar.js';
import { createRingCourse, RingTracker, rateLanding, ringApproach } from './modes.js';
import { Combat } from './combat.js';
import { fieldLocal } from './terrainGen.js';

export const DT = 1 / 60;

const MODELS = {
  fixedwing: { create: createFixedWing, step: stepFixedWing },
  heli: { create: createHeli, step: stepHeli },
  paraglider: { create: createParaglider, step: stepParaglider },
  jetsuit: { create: createJetsuit, step: stepJetsuit },
  human: { create: createHuman, step: stepHuman },
  balloon: { create: createBalloon, step: stepBalloon },
  flycar: { create: createFlycar, step: stepFlycar },
};

const terrainCache = new Map();
export function getTerrain(locationId, seed) {
  const key = `${locationId}:${seed}`;
  let t = terrainCache.get(key);
  if (!t) {
    t = new Terrain(getLocation(locationId), seed);
    terrainCache.set(key, t);
    if (terrainCache.size > 6) terrainCache.delete(terrainCache.keys().next().value);
  }
  return t;
}

/** 機体の基準点（重心）から接地点までの高さ */
export function contactOffset(def) {
  const P = def.p;
  if (def.model === 'fixedwing') return P.ground.gearHeight;
  if (def.model === 'heli' || def.model === 'jetsuit' || def.model === 'flycar') return P.cgHeight;
  if (def.model === 'balloon') return P.basketHeight;
  return 0.9;
}

export class Simulation {
  constructor() {
    this.world = null;
    this.events = [];
  }

  /**
   * opts: { seed, time, weather, mode, calm, thermals, pvp, rings(リング列を外から与える),
   *         spawn: {pos, heading(deg), speed, onGround, throttle, phase} }
   */
  load(vehicleId, locationId, opts = {}) {
    const def = getVehicle(vehicleId);
    const loc = getLocation(locationId);
    const seed = (opts.seed ?? 1234) >>> 0;
    this.def = def;
    this.loc = loc;
    this.opts = { ...opts };
    this.mode = opts.mode || 'free';
    this.world = new World(loc, { seed, time: opts.time, weather: opts.weather, calm: opts.calm, thermals: opts.thermals, terrain: getTerrain(locationId, seed) });
    this.t = 0;
    this.stepCount = 0;
    this.events = [];
    this.status = 'flying';
    this.crashCause = null;
    this.result = null;
    const spawn = this.computeSpawn(opts.spawn);
    if (opts.spawnOffset) {
      // 2 人プレイのゲスト: ホストの右後ろに並ぶ（地上なら横に 22 m）
      const hd = spawn.heading || 0;
      const rx = Math.cos(hd), rz = Math.sin(hd);
      const fx = Math.sin(hd), fz = -Math.cos(hd);
      const side = spawn.onGround ? 22 : 40;
      const back = spawn.onGround ? 0 : 30;
      spawn.pos = { x: spawn.pos.x + rx * side - fx * back, y: spawn.pos.y + (spawn.onGround ? 0 : 15), z: spawn.pos.z + rz * side - fz * back };
      if (spawn.onGround) spawn.pos.y = this.world.terrain.surfaceAt(spawn.pos.x, spawn.pos.z) + contactOffset(def);
    }
    this.spawn = spawn;
    this.vs = MODELS[def.model].create(def, spawn, this.world);
    this.ctl = {
      pitch: 0, roll: 0, yaw: 0,
      throttle: spawn.throttle ?? 0,
      flaps: spawn.flaps ?? def.initialFlaps ?? 0,
      gear: spawn.gear !== false,
      spoiler: false,
      ab: false,
      fire: false,
      burner: false,
      vent: false,
    };
    this.tracker = null;
    this.rings = [];
    if (this.mode === 'rings') {
      this.rings = opts.rings ? opts.rings.map((r) => ({ pos: { ...r.pos }, normal: { ...r.normal }, radius: r.radius }))
        : createRingCourse(this.world, opts.courseVehicle ? getVehicle(opts.courseVehicle) : def, { pos: spawn.pos, heading: spawn.heading });
      // 2 人プレイ: 遅い方の機体に合わせたコース。輪の大きさは大きい方
      if (opts.ringRadius) for (const r of this.rings) r.radius = Math.max(r.radius, opts.ringRadius);
      this.tracker = new RingTracker(this.rings);
    }
    this.combat = this.mode === 'combat'
      ? new Combat(this.world, def, { pvp: !!opts.pvp, spawn: { pos: { ...spawn.pos }, heading: spawn.heading }, difficulty: opts.difficulty, targets: opts.targets })
      : null;
    this._stillT = 0;
    this._env = {
      world: this.world,
      t: 0,
      emit: (type, data) => this.emit(type, data),
      crash: (cause) => this.crash(cause),
    };
    return this.getState();
  }

  restart() {
    return this.load(this.def.id, this.loc.id, this.opts);
  }

  emit(type, data = {}) {
    this.events.push({ ...data, type, t: this.t });
    // 空飛ぶ車は自由飛行で着地しても走り続けられるので評価を出さない（着陸モードのみ）
    const rateIt = this.mode !== 'combat' && !(this.def.model === 'flycar' && this.mode !== 'landing');
    if (type === 'landed' && this.status === 'flying' && rateIt) {
      const r = rateLanding(this.def, data, this.world.terrain.field);
      this.result = { type: 'landing', mode: this.mode, ...r };
      this.status = 'landed';
      this.events.push({ type: 'result', t: this.t, result: this.result });
    }
    if (type === 'courseFinished') {
      this.result = { type: 'rings', ...data };
      this.status = 'finished';
      this.events.push({ type: 'result', t: this.t, result: this.result });
    }
    if (type === 'combatFinished') {
      this.result = { ...data, type: 'combat' };
      this.status = 'finished';
      this.events.push({ type: 'result', t: this.t, result: this.result });
    }
  }

  crash(cause) {
    if (this.status === 'crashed') return;
    this.status = 'crashed';
    this.crashCause = cause;
    this.vs.crashed = true;
    this.events.push({ type: 'crash', t: this.t, cause, pos: { ...this.vs.pos } });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- 入力 ----------
  setInput(inp = {}) {
    const c = this.ctl;
    if (inp.pitch != null) c.pitch = clamp(+inp.pitch, -1, 1);
    if (inp.roll != null) c.roll = clamp(+inp.roll, -1, 1);
    if (inp.yaw != null) c.yaw = clamp(+inp.yaw, -1, 1);
    if (inp.throttle != null) c.throttle = clamp(+inp.throttle, 0, 1);
    if (inp.fire != null) c.fire = !!inp.fire;
    if (inp.burner != null) c.burner = !!inp.burner;
    if (inp.vent != null) c.vent = !!inp.vent;
  }

  /** 機体固有ボタン */
  action(id) {
    const def = this.def;
    const P = def.p;
    const c = this.ctl;
    switch (id) {
      case 'flaps':
        if (P.flaps) c.flaps = (Math.round(c.flaps) + 1) % (P.flaps.notches + 1);
        return c.flaps;
      case 'gear':
        if (P.gear && P.gear.retractable && !this.vs.onGround) c.gear = !c.gear;
        return c.gear;
      case 'spoiler':
        if (P.spoiler) c.spoiler = !c.spoiler;
        return c.spoiler;
      case 'ab':
        if (P.thrust && P.thrust.ab) c.ab = !c.ab;
        return c.ab;
      case 'deploy':
        if (def.model === 'human') return humanDeploy(def, this.vs, this._env, false);
        return false;
      case 'carMode':
        if (def.model === 'flycar') return flycarToggleMode(def, this.vs, this._env);
        return null;
      case 'missile':
        if (this.combat && this.status === 'flying') return this.combat.fireMissile(this.vs);
        return false;
      default:
        return null;
    }
  }

  // ---------- 物理 ----------
  step(n = 1) {
    const model = MODELS[this.def.model];
    for (let i = 0; i < n; i++) {
      if (this.status === 'crashed' || this.status === 'finished') break;
      const prev = { ...this.vs.pos };
      this._env.t = this.t;
      model.step(this.def, this.vs, this.ctl, this._env, DT);
      if (this.combat && this.status !== 'crashed') {
        this.combat.step(this.vs, this.ctl, this._env, DT);
        for (const e of this.combat.drainEvents()) this.emit(e.type, e);
        // 着地して止まり、自力で飛び直せない機体はその時点で終了
        if (!this.canRelaunch() && this.vs.onGround && vlen(this.vs.vel) < 1.5) {
          this._stillT += DT;
          if (this._stillT > 1.5) {
            this.combat.finishEarly('landed');
            for (const e of this.combat.drainEvents()) this.emit(e.type, e);
          }
        } else this._stillT = 0;
      }
      this.t += DT;
      this.stepCount++;
      if (this.tracker && this.status === 'flying') this.tracker.update(prev, this.vs.pos, this.t, (ty, d) => this.emit(ty, d));
      if (!Number.isFinite(this.vs.pos.x + this.vs.pos.y + this.vs.pos.z)) this.crash('数値エラー');
    }
    return this;
  }

  /** 着地したあと自力で飛び立てるか */
  canRelaunch() {
    const m = this.def.model;
    if (m === 'heli' || m === 'jetsuit' || m === 'flycar' || m === 'balloon') return true;
    return m === 'fixedwing' && this.def.p.thrust.type !== 'none';
  }

  // ---------- 出現位置 ----------
  computeSpawn(override) {
    const def = this.def;
    const world = this.world;
    const terr = world.terrain;
    const field = terr.field;
    const fh = field.heading * DEG;
    const fF = { x: Math.sin(fh), z: -Math.cos(fh) };
    const loc = this.loc;
    if (override && override.pos) {
      const sp = { ...override, heading: (override.heading ?? 0) * DEG };
      if (sp.throttle == null) sp.throttle = this.hoverThrottleAt(sp.pos.y) ?? def.spawnAir?.throttle ?? 0;
      return sp;
    }
    if (this.mode === 'landing') return this.approachSpawn();
    const airOnly = this.mode === 'rings' || this.mode === 'combat';
    if (!airOnly && def.groundStart && (field.type === 'runway' || def.groundStartAnywhere)) {
      const along = def.model === 'fixedwing' ? -(field.length / 2 - 80) : -(field.length / 2 - 30);
      return {
        pos: { x: field.x + fF.x * along, y: field.elevation + contactOffset(def), z: field.z + fF.z * along },
        heading: fh, speed: 0, onGround: true, throttle: 0, gear: true,
      };
    }
    const sa = def.spawnAir;
    if (def.model === 'paraglider' && !airOnly) {
      const r = this.ridgeSpawn();
      if (r) return r;
    }
    if (def.model === 'human' && def.startPhase === 'freefall' && this.mode !== 'combat') {
      const wd = world.windDir;
      const x = field.x - wd.x * 600, z = field.z - wd.z * 600;
      const hd = Math.atan2(field.x - x, -(field.z - z));
      return { pos: { x, y: field.elevation + sa.agl, z }, heading: hd, speed: sa.speed, phase: 'freefall' };
    }
    const hd = loc.airSpawn.heading * DEG;
    const x = loc.airSpawn.x, z = loc.airSpawn.z;
    const gmax = this.maxTerrainAhead(x, z, hd, def.model === 'human' ? 3500 : 2000);
    const y = gmax + sa.agl;
    return {
      pos: { x, y, z }, heading: hd, speed: sa.speed, onGround: false,
      throttle: this.hoverThrottleAt(y) ?? sa.throttle ?? 0,
      gear: sa.gear,
      phase: def.startPhase,
    };
  }

  hoverThrottleAt(y) {
    const def = this.def;
    const rho = airDensity(y);
    if (def.model === 'heli') return hoverCollective(def.p, rho);
    if (def.model === 'jetsuit') return jetsuitHoverThrottle(def.p, rho);
    if (def.model === 'flycar') return flycarHoverThrottle(def.p, rho);
    if (def.model === 'balloon') return hoverBurner(def.p, rho, airTemp(y));
    return null;
  }

  maxTerrainAhead(x, z, hd, dist) {
    const terr = this.world.terrain;
    let m = terr.surfaceAt(x, z);
    for (let d = 0; d <= dist; d += 100) {
      for (const off of [-300, 0, 300]) {
        const px = x + Math.sin(hd) * d + Math.cos(hd) * off;
        const pz = z - Math.cos(hd) * d + Math.sin(hd) * off;
        m = Math.max(m, terr.surfaceAt(px, pz), terr.roofAt(px, pz));
      }
    }
    return m;
  }

  /** パラグライダー: 風上斜面（斜面上昇風が最も強い所）の上から開始 */
  ridgeSpawn() {
    const world = this.world;
    const terr = world.terrain;
    const wd = world.windDir;
    const a = this.loc.airSpawn;
    let best = null;
    for (let i = -18; i <= 18; i++) {
      for (let j = -18; j <= 18; j++) {
        const x = a.x * 0.4 + i * 130;
        const z = a.z * 0.4 + j * 130;
        const h = terr.heightAt(x, z);
        if (terr.water && h < 20) continue;
        const g = terr.gradient(x, z, 40);
        const up = wd.x * g.x + wd.z * g.z;
        const score = up * Math.min(1, (h - terr.minH) / 250);
        if (!best || score > best.score) best = { x, z, h, score };
      }
    }
    if (!best || best.score <= 0.02) return null;
    const hd = Math.atan2(-wd.z, -wd.x); // 尾根に沿う向き（風に直交）
    const y = best.h + this.def.spawnAir.agl;
    return { pos: { x: best.x, y, z: best.z }, heading: hd, speed: this.def.spawnAir.speed, onGround: false };
  }

  approachSpawn() {
    const def = this.def;
    const world = this.world;
    const terr = world.terrain;
    const field = terr.field;
    const fh = field.heading * DEG;
    const fF = { x: Math.sin(fh), z: -Math.cos(fh) };
    const ap = def.approach || {};
    const wd = world.windDir;
    if (def.model === 'fixedwing' && def.p.thrust.type !== 'none') {
      const aimAlong = -(field.length / 2 - 300);
      const aim = { x: field.x + fF.x * aimAlong, z: field.z + fF.z * aimAlong };
      const d = ap.dist;
      const x = aim.x - fF.x * d, z = aim.z - fF.z * d;
      let y = field.elevation + d * Math.tan(3 * DEG) + contactOffset(def);
      // 経路上の地形クリアランス
      for (let k = 0; k <= 20; k++) {
        const f = k / 20;
        const px = x + (aim.x - x) * f, pz = z + (aim.z - z) * f;
        const need = terr.surfaceAt(px, pz) + 60;
        const yAt = y - (y - field.elevation) * f;
        if (yAt < need) y += need - yAt;
      }
      return { pos: { x, y, z }, heading: fh, speed: ap.speed, throttle: ap.throttle, flaps: ap.flaps ?? 0, gear: ap.gear !== false, pitch: 1 * DEG, onGround: false };
    }
    let dir;
    const d = ap.dist;
    if (def.model === 'heli' || def.model === 'jetsuit' || def.model === 'flycar' || def.model === 'fixedwing') dir = fF;
    else if (def.model === 'balloon') {
      // 熱気球: その高さの風に乗って目標の上を通る位置から
      const w = world.baseWindAt(ap.agl || 300);
      const ws = Math.hypot(w.x, w.z);
      dir = ws > 0.3 ? { x: w.x / ws, z: w.z / ws } : fF;
    } else dir = { x: wd.x, z: wd.z }; // 追い風で目標へ向かう
    const x = field.x - dir.x * d, z = field.z - dir.z * d;
    const hd = Math.atan2(dir.x, -dir.z);
    let y = Math.max(field.elevation, terr.surfaceAt(x, z)) + (ap.agl || 100);
    if (def.model === 'human' || def.model === 'fixedwing') y = Math.max(y, this.maxTerrainAhead(x, z, hd, d) + (def.model === 'human' ? 400 : 120));
    return {
      pos: { x, y, z }, heading: hd, speed: ap.speed ?? def.spawnAir.speed, onGround: false,
      throttle: this.hoverThrottleAt(y) ?? ap.throttle ?? 0,
      phase: def.startPhase,
    };
  }

  // ---------- 状態 ----------
  getState() {
    const s = this.vs;
    const def = this.def;
    const terr = this.world.terrain;
    const att = attitudeOf(s.q);
    const ground = Math.max(terr.surfaceAt(s.pos.x, s.pos.z), terr.roofAt(s.pos.x, s.pos.z));
    const agl = Math.max(0, s.pos.y - ground - contactOffset(def));
    const gs = Math.hypot(s.vel.x, s.vel.z);
    const vs = s.vel.y;
    const field = terr.field;
    const fl = fieldLocal(field, s.pos.x, s.pos.z);
    let rings = null;
    if (this.tracker) {
      const tr = this.tracker;
      const nextRing = tr.rings[tr.index];
      rings = {
        index: tr.index, total: tr.rings.length, passed: tr.passed, missed: tr.missed,
        penalty: tr.penalty, time: tr.finished ? tr.finishTime : this.t + tr.penalty, finished: tr.finished,
        next: nextRing ? { ...nextRing.pos } : null,
        nextRadius: nextRing ? nextRing.radius : null,
        approach: nextRing ? ringApproach(nextRing, s.pos, s.vel) : null,
      };
    }
    const wind = this.world.baseWindAt(agl);
    const res = {
      t: this.t,
      step: this.stepCount,
      vehicleId: def.id,
      locationId: this.loc.id,
      mode: this.mode,
      status: this.status,
      crashCause: this.crashCause,
      pos: { ...s.pos },
      vel: { ...s.vel },
      quat: { ...s.q },
      speed: s.airspeed ?? vlen(s.vel),
      groundSpeed: gs,
      altitude: s.pos.y,
      agl,
      vs,
      attitude: { pitch: att.pitch * RAD, roll: att.roll * RAD, heading: att.heading * RAD },
      g: s.g ?? 1,
      alpha: (s.alpha ?? 0) * RAD,
      stalled: (s.stall ?? 0) > 0.3,
      stallWarn: !!s.stallWarn,
      onGround: !!s.onGround,
      throttle: s.throttle ?? s.collective ?? 0,
      throttleCmd: this.ctl.throttle,
      input: { pitch: this.ctl.pitch, roll: this.ctl.roll, yaw: this.ctl.yaw, fire: this.ctl.fire },
      flaps: this.ctl.flaps,
      flapPos: s.flapPos ?? 0,
      gear: s.gearPos ?? null,
      gearCmd: this.ctl.gear,
      spoiler: this.ctl.spoiler,
      ab: !!s.ab,
      aFloor: !!s.aFloor,
      fuel: s.fuel ?? null,
      phase: s.phase ?? null,
      carMode: s.mode ?? null,
      brakes: s.brakes ?? null,
      glideRatio: vs < -0.2 ? gs / -vs : null,
      kGE: s.kGE ?? null,
      liftoffSpeed: s.liftoffSpeed ?? null,
      wind,
      target: { x: field.x, z: field.z, elevation: field.elevation, dist: Math.hypot(s.pos.x - field.x, s.pos.z - field.z), u: fl.u, v: fl.v },
      rings,
      combat: this.combat ? this.combat.summary(s.pos) : null,
      result: this.result,
      outOfBounds: Math.abs(s.pos.x) > terr.half || Math.abs(s.pos.z) > terr.half,
    };
    if (def.model === 'balloon') {
      res.balloon = {
        temp: s.temp - 273.15,
        burner: s.burner,
        venting: !!s.venting,
        windAbove: this.world.baseWindAt(agl + 300),
        windBelow: this.world.baseWindAt(Math.max(0, agl - 300)),
      };
    }
    return res;
  }
}
