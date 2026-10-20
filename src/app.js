// アプリ本体: 画面遷移、固定タイムステップの物理ループ（60Hz）と requestAnimationFrame の描画
import * as THREE from 'three';
import { Simulation, DT } from './sim/sim.js';
import { stallSpeed } from './sim/vehicles/fixedwing.js';
import { clamp } from './sim/math.js';
import { FlightRenderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { FlightControls } from './ui/controls.js';
import { h, tapButton } from './ui/dom.js';
import { InputManager } from './input/manager.js';
import { haptic } from './input/touch.js';
import { DEFAULT_INPUT_SETTINGS } from './input/pipeline.js';
import { AudioEngine } from './audio/audio.js';
import { VEHICLES } from './data/vehicles.js';
import { LOCATIONS } from './data/locations.js';

const SETTINGS_KEY = 'skytilt.settings.v1';
const TUTORIAL_KEY = 'skytilt.tutorialDone.v1';
const BEST_KEY = 'skytilt.best.v1';
export const DEFAULT_SEED = 1234;

const store = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* プライベートモード等 */ }
  },
};

const CAMERA_MODES = ['chase', 'cockpit', 'external'];
const CAMERA_NAMES = { chase: '後方追従', cockpit: 'コックピット', external: '外部視点' };

export class App {
  constructor(root, { debug = false, forceTutorial = false } = {}) {
    this.root = root;
    this.debug = debug;
    this.forceTutorial = forceTutorial;
    this.settings = { ...DEFAULT_INPUT_SETTINGS, control: 'auto', volume: 0.8, vibrate: true, cameraShake: true, ...store.get(SETTINGS_KEY, {}) };
    this.sensorOk = false;
    this.flying = false;
    this.paused = false;
    this.manual = false;
    this.override = null;
    this.acc = 0;
    this.last = performance.now();
    this.cameraIdx = 0;
    this.gDark = 0;
    this.gRed = 0;
    this.flash = 0;

    // DOM
    this.gl = h('canvas', { id: 'gl' });
    this.hudCanvas = h('canvas', { id: 'hud' });
    this.fxVignette = h('div', { class: 'fx', id: 'fx-vignette' });
    this.fxRed = h('div', { class: 'fx', id: 'fx-red' });
    this.fxCloud = h('div', { class: 'fx', id: 'fx-cloud' });
    this.fxFlash = h('div', { class: 'fx', id: 'fx-flash' });
    this.toastEl = h('div', { id: 'toast' });
    this.safeProbe = h('div', { id: 'safe-probe' });
    root.append(this.gl, this.fxCloud, this.hudCanvas, this.fxVignette, this.fxRed, this.fxFlash, this.safeProbe);

    this.sim = new Simulation();
    this.renderer = new FlightRenderer(this.gl);
    this.hud = new Hud(this.hudCanvas);
    this.audio = new AudioEngine();
    this.input = new InputManager(this.settings, {
      onAction: (id) => this.doAction(id),
      onUi: (id) => this.uiKey(id),
    });
    this.controls = new FlightControls(root, {
      onPause: () => this.pause(),
      onRecalibrate: () => this.recalibrate(),
      onCamera: () => this.cycleCamera(),
      onHold: (id, on) => this.input.hold(id, on),
      onAction: (id) => this.doAction(id),
      onThrottle: (v, user) => { if (user) this.input.setThrottle(v, true); },
    });
    this.input.stick = this.controls.stick;
    this.input.throttleSlider = this.controls.throttle;
    root.append(this.toastEl);

    this.screens = new Screens(root, {
      onStart: () => this.onStartTap(),
      onFly: (cfg) => this.startFlight(cfg.vehicle, cfg.location, { time: cfg.time, weather: cfg.weather, mode: cfg.mode }),
      onResume: () => this.resume(),
      onRecalibrate: () => { this.recalibrate(); this.resume(); },
      onOpenSettings: (from) => this.openSettings(from),
      onChangeVehicle: () => this.toMenu('vehicle'),
      onRestart: () => this.restart(),
      onTitle: () => this.toMenu('title'),
      // メニューを開いている間は飛行用の操作 UI とトーストを隠す
      onScreen: (name) => {
        this.controls.show(this.flying && !name);
        if (name) this.toastEl.classList.remove('show');
      },
    });
    // 縦向き・持ち替え（画面角の変化）・バックグラウンド移行で自動一時停止。
    // 持ち替え中は旧い画面角のまま姿勢を解釈してしまうので、再開時に再キャリブレーションする。
    const onOrient = () => {
      if (!this.flying) return;
      this.needRecal = true;
      if (!this.paused) this.pause('画面の向きが変わったので一時停止しました。持ち直して「再開」');
    };
    if (window.screen && screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', onOrient);
    else window.addEventListener('orientationchange', onOrient);
    this.input.tilt.onAngleChange = onOrient;
    matchMedia('(orientation: portrait)').addEventListener('change', (e) => { if (e.matches) onOrient(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.flying && !this.paused) this.pause();
        this.audio.suspend();
      } else if (!this.paused || !this.flying) this.audio.resume();
    });
    root.append(h('div', { id: 'rotate' }, h('div', { class: 'phone' }), h('p', {}, '横向きにしてください'), h('div', { class: 'hint' }, 'このゲームは横向き専用です')));
    this.screens.show('title');
    this.applySettings();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    if (debug) this.exposeDebug();
    const loop = (now) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------- 開始・入力モード ----------
  onStartTap() {
    // iOS: requestPermission はタップのハンドラ内で同期的に呼び出す必要がある
    const perm = this.input.tilt.requestPermission();
    this.audio.init();
    if (!this.debug && matchMedia('(pointer: coarse)').matches) {
      try {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
          }).catch(() => {});
        }
      } catch (e) { /* 非対応 */ }
    }
    this.screens.show('vehicle');
    perm.then((r) => {
      this.permission = r;
      if (r !== 'granted') {
        this.sensorOk = false;
        this.applyControlMode(true);
        return;
      }
      this.input.tilt.start();
      this.input.tilt.waitForSensor(1200).then((ok) => {
        this.sensorOk = ok;
        this.applyControlMode(true);
      });
    });
  }

  applyControlMode(announce = false) {
    const c = this.settings.control;
    const mode = c === 'stick' ? 'stick' : c === 'tilt' ? 'tilt' : this.sensorOk ? 'tilt' : 'stick';
    const changed = mode !== this.input.mode;
    this.input.setMode(mode);
    this.controls.setStickVisible(mode === 'stick');
    this.updateHudBounds();
    if (announce && mode === 'stick' && c === 'auto') this.toast('傾きセンサーが使えないため、スティック操作に切り替えました');
    if (mode === 'tilt' && c === 'tilt' && !this.input.tilt.hasData() && this.input.tilt.listening) this.toast('傾きセンサーの値が届いていません。設定でスティックに切り替えてください');
    if (changed && mode === 'tilt') this.input.calibrate();
  }

  applySettings() {
    const s = this.settings;
    this.input.setSettings({ smoothing: s.smoothing, deadzone: s.deadzone, sensitivity: s.sensitivity, expo: s.expo, invertPitch: s.invertPitch });
    // バーチャルスティックにも感度・エクスポ・ピッチ反転を反映
    this.controls.stick.expo = s.expo;
    this.controls.stick.sensitivity = s.sensitivity;
    this.controls.stick.invertPitch = s.invertPitch;
    this.audio.setVolume(s.volume);
    haptic.enabled = s.vibrate;
    tapButton.vibrate = s.vibrate;
    this.applyControlMode(false);
  }

  openSettings(from) {
    this.settingsFrom = from;
    this.screens.showSettings(this.settings, (s) => {
      this.settings = s;
      this.applySettings();
      store.set(SETTINGS_KEY, s);
    }, () => this.screens.show(this.settingsFrom === 'pause' ? 'pause' : 'title'));
  }

  // ---------- 飛行 ----------
  startFlight(vehicleId, locationId, opts = {}) {
    this.cfg = { vehicleId, locationId, opts: { ...opts } };
    const sim = this.sim;
    sim.load(vehicleId, locationId, { seed: opts.seed ?? DEFAULT_SEED, time: opts.time || 'noon', weather: opts.weather || 'clear', mode: opts.mode || 'free', calm: opts.calm, spawn: opts.spawn });
    const def = sim.def;
    this.def = def;
    this.renderer.load(sim.world, def, sim.rings, sim.mode);
    this.renderer.setCameraMode(CAMERA_MODES[this.cameraIdx]);
    this.hud.setVehicle(def);
    this.controls.setVehicle(def);
    this.controls.show(true);
    this.updateHudBounds(); // 操作 UI が変わったら HUD の配置範囲もすぐ更新
    this.input.setThrottle(sim.ctl.throttle);
    this.input.yawHold.rudderL = this.input.yawHold.rudderR = false;
    this.audio.setVehicle(def);
    this.stallKmh = def.model === 'fixedwing' ? stallSpeed(def.p, 0) * 3.6 : 0;
    this.snapPrev = this.snapshot();
    this.snapCur = this.snapshot();
    this.acc = 0;
    this.last = performance.now();
    this.flying = true;
    this.paused = false;
    this.crashTimer = null;
    this.resultTimer = null;
    this.gDark = this.gRed = 0;
    this.screens.hideAll();
    this.needRecal = false;
    this.input.calibrate(300);
    this.applyControlMode(false);
    const loc = LOCATIONS[locationId];
    // 操作説明は機体ごとに初回だけ（機体によって操作の意味が違うため）
    const tut = store.get(TUTORIAL_KEY, {});
    const tutSeen = tut === true || (tut && tut[def.id]);
    if (!opts.skipTutorial && (!this.debug || this.forceTutorial) && !tutSeen) {
      this.paused = true;
      this.screens.showTutorial(def, () => {
        const t2 = store.get(TUTORIAL_KEY, {});
        store.set(TUTORIAL_KEY, { ...(typeof t2 === 'object' && t2 ? t2 : {}), [def.id]: true });
        this.screens.hideAll();
        this.paused = false;
        this.last = performance.now();
        this.input.calibrate(300);
      });
    } else {
      this.toast(`${def.short} ／ ${loc.name}`);
    }
  }

  restart() {
    if (!this.cfg) return;
    this.startFlight(this.cfg.vehicleId, this.cfg.locationId, { ...this.cfg.opts, skipTutorial: true });
  }

  toMenu(name) {
    this.flying = false;
    this.paused = false;
    this.controls.show(false);
    this.audio.silence();
    this.hud.clear();
    this.fxVignette.style.opacity = this.fxRed.style.opacity = this.fxCloud.style.opacity = 0;
    this.screens.show(name);
  }

  pause(message) {
    if (!this.flying || this.screens.current) return;
    this.paused = true;
    this.screens.show('pause');
    this.screens.setPauseMessage(message || '');
  }

  resume() {
    this.screens.hideAll();
    this.paused = false;
    this.last = performance.now();
    this.audio.resume();
    if (this.needRecal) {
      this.needRecal = false;
      this.recalibrate();
    }
  }

  /**
   * 再キャリブレーション。タップした瞬間の揺れを拾わないよう、
   * 指を離してから少し待って直近 300ms の平均姿勢をニュートラルにする。
   */
  recalibrate() {
    clearTimeout(this._recalT);
    this.toast('そのまま構えて…');
    this._recalT = setTimeout(() => {
      this.input.calibrate(300);
      this.toast('今の持ち方をニュートラルにしました');
      haptic(20);
    }, 450);
  }

  cycleCamera() {
    this.cameraIdx = (this.cameraIdx + 1) % CAMERA_MODES.length;
    const m = CAMERA_MODES[this.cameraIdx];
    this.renderer.setCameraMode(m);
    this.toast(CAMERA_NAMES[m]);
  }

  doAction(id) {
    if (!this.flying || this.paused) return;
    const r = this.sim.action(id);
    if (id === 'deploy' && r) this.toast('パラシュート展開！');
    // A/B は推力 85% 以上で作動するので、入れたらスロットルを最大にする
    if (id === 'ab' && r === true) this.input.setThrottle(1);
  }

  uiKey(id) {
    if (id === 'pause') { if (this.paused && this.screens.current === 'pause') this.resume(); else this.pause(); }
    else if (id === 'camera' && this.flying) this.cycleCamera();
    else if (id === 'recalibrate' && this.flying) this.recalibrate();
  }

  snapshot() {
    const s = this.sim.vs;
    return { pos: { ...s.pos }, q: { ...s.q } };
  }

  stepOnce() {
    if (this.override) {
      this.sim.setInput(this.override);
      // 表示（スライダー）も上書き値に合わせる
      if (this.override.throttle != null && this.override.throttle !== this.input.throttle) this.input.setThrottle(this.override.throttle);
    } else {
      const c = this.input.update(DT);
      this.sim.setInput(c);
    }
    this.snapPrev = this.snapCur;
    this.sim.step(1);
    this.snapCur = this.snapshot();
  }

  handleEvents() {
    for (const ev of this.sim.drainEvents()) {
      this.audio.event(ev);
      switch (ev.type) {
        case 'crash':
          haptic(250);
          this.renderer.rig.bump(0.03);
          this.flash = 0.8;
          clearTimeout(this.crashTimer);
          this.crashTimer = setTimeout(() => {
            if (this.sim.status === 'crashed' && this.flying) {
              this.controls.show(false);
              this.screens.showCrash(this.sim.crashCause, {
                retry: () => this.restart(),
                vehicle: () => this.toMenu('vehicle'),
                location: () => this.toMenu('location'),
              });
            }
          }, this.manual ? 0 : 1300);
          break;
        case 'touchdown':
          haptic(clamp(Math.round(20 + Math.abs(ev.vs || 0) * 25), 20, 120));
          this.renderer.rig.bump(clamp(Math.abs(ev.vs || 0) * 0.004, 0.002, 0.02));
          break;
        case 'ring':
          haptic(15);
          break;
        case 'ringMiss':
          this.toast('リングを外した（+5秒）');
          break;
        case 'aad':
          this.toast('自動展開装置が作動しました');
          break;
        case 'fuelout':
          this.toast('燃料切れ！');
          break;
        case 'result':
          this.onResult(ev.result);
          break;
        default:
      }
    }
  }

  onResult(res) {
    const def = this.def;
    if (res.type === 'rings') {
      const key = `${this.cfg.vehicleId}:${this.cfg.locationId}`;
      // 記録は「通過数が多い方」→「タイムが短い方」の順で比較する
      const best = store.get(BEST_KEY, {});
      const prev = best[key] && typeof best[key] === 'object' ? best[key] : null;
      const cur = { passed: res.passed, total: res.total };
      res.newBest = !prev || cur.passed > prev.passed || (cur.passed === prev.passed && cur.total < prev.total);
      if (res.newBest) {
        best[key] = cur;
        store.set(BEST_KEY, best);
      }
      const b = res.newBest ? cur : prev;
      res.best = b.total;
      res.bestPassed = b.passed;
    }
    const canContinue = res.type === 'landing' && this.sim.mode === 'free' && (def.model === 'fixedwing' || def.model === 'heli' || def.model === 'jetsuit');
    const show = () => {
      if (!this.flying) return;
      this.paused = true;
      this.controls.show(false);
      this.screens.showResult(res, def, {
        continue: canContinue ? () => { this.sim.status = 'flying'; this.sim.result = null; this.controls.show(true); this.resume(); } : null,
        retry: () => this.restart(),
        vehicle: () => this.toMenu('vehicle'),
        location: () => this.toMenu('location'),
      });
    };
    if (this.manual) show();
    else this.resultTimer = setTimeout(show, 900);
  }

  // ---------- フレーム ----------
  frame(now) {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    if (!this.flying) return;
    if (!this.paused && !this.manual) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 6) {
        this.stepOnce();
        this.acc -= DT;
        n++;
      }
      if (n >= 6) this.acc = 0;
    } else if (this.paused) {
      // 一時停止中も入力フィルタは更新しておく（再開時の飛びを防ぐ）
      this.input.update(dt);
    }
    this.handleEvents();
    const st = this.sim.getState();
    st.abCmd = this.sim.ctl.ab;
    const alpha = this.manual || this.paused ? 1 : clamp(this.acc / DT, 0, 1);
    this.renderer.render(dt, this.snapPrev, this.snapCur, alpha, st, this.sim.vs);
    if ((this._bf = (this._bf || 0) + 1) % 15 === 1) this.updateHudBounds();
    const cam = this.renderer.camera;
    this.hud.draw(st, {
      fov: cam.fov,
      camera: cam,
      stallKmh: this.stallKmh,
      project: (p) => projectPoint(cam, p, this.hud.W, this.hud.H),
      recalHint: null,
    });
    this.audio.update(st, this.sim.vs, this.def, this.paused);
    this.controls.sync(st);
    this.updateFx(dt, st);
  }

  /** HUD を置ける横方向の範囲（左手の操作 UI の右端〜スロットルの左端） */
  updateHudBounds() {
    const lz = this.controls.leftZone.getBoundingClientRect();
    const th = this.controls.thrEl;
    const tr = th.style.display === 'none' ? null : th.getBoundingClientRect();
    const l = lz.width > 0 ? lz.right + 6 : this.hud.safe.l + 8;
    const r = tr && tr.width > 0 ? tr.left - 6 : this.hud.W - this.hud.safe.r - 8;
    this.hud.setBounds(l, r);
  }

  updateFx(dt, st) {
    // 高 G で視界が暗くなる（G-LOC の手前のグレーアウト）。負 G では赤くなる
    const g = st.g || 1;
    const tDark = clamp((g - 5.5) / 4, 0, 0.92);
    this.gDark += (tDark - this.gDark) * (1 - Math.exp(-dt / (tDark > this.gDark ? 1.2 : 0.7)));
    const tRed = clamp((-g - 1.5) / 2.5, 0, 0.7);
    this.gRed += (tRed - this.gRed) * (1 - Math.exp(-dt / 0.6));
    this.fxVignette.style.opacity = this.gDark.toFixed(3);
    this.fxRed.style.opacity = this.gRed.toFixed(3);
    this.fxCloud.style.opacity = clamp(this.renderer.cloudDensity * 0.9, 0, 0.92).toFixed(3);
    this.flash *= Math.exp(-dt / 0.25);
    this.fxFlash.style.opacity = this.flash.toFixed(3);
    this.renderer.rig.shakeEnabled = this.settings.cameraShake;
  }

  onResize() {
    this.renderer.resize();
    this.hud.resize();
    const cs = getComputedStyle(this.safeProbe);
    this.hud.setSafe({ t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 });
    this.updateHudBounds();
  }

  toast(msg, ms = 2200) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  // ---------- テスト用 API（?debug=1 のときだけ） ----------
  exposeDebug() {
    const app = this;
    window.__flight = {
      version: 1,
      setInput(o = {}) {
        const c = app.sim.ctl || {};
        app.override = { pitch: c.pitch ?? 0, roll: c.roll ?? 0, yaw: c.yaw ?? 0, throttle: c.throttle ?? 0, ...(app.override || {}), ...o };
        return app.override;
      },
      clearInput() { app.override = null; },
      step(n = 1) {
        for (let i = 0; i < n; i++) app.stepOnce();
        return app.sim.getState();
      },
      getState() {
        if (!app.sim.vs) return { screen: app.screens.current, flying: false, inputMode: app.input.mode, sensorOk: app.sensorOk };
        return { ...app.sim.getState(), screen: app.screens.current, flying: app.flying, paused: app.paused, inputMode: app.input.mode, sensorOk: app.sensorOk, processedInput: { ...app.input.out }, rawTilt: app.input.tilt.rawAngles(), camera: CAMERA_MODES[app.cameraIdx] };
      },
      loadScenario(vehicleId, locationId, opts = {}) {
        app.override = null;
        app.manual = !opts.realtime;
        app.startFlight(vehicleId, locationId, { ...opts, skipTutorial: true });
        return app.sim.getState();
      },
      setRealtime(on) { app.manual = !on; app.last = performance.now(); },
      action(id) { return app.sim.action(id); },
      calibrate() { app.input.calibrate(); },
      readInput() { return app.input.update(DT); },
      renderInfo() { return app.renderer.info(); },
      hudRects() { app.updateHudBounds(); return { rects: app.hud.rects || [], bounds: app.hud.bounds }; },
      audioStats() { return { ...app.audio.stats, ready: !!app.audio.ctx }; },
      fx() { return { gDark: app.gDark, gRed: app.gRed, cloud: app.renderer.cloudDensity }; },
      setCamera(m) { app.cameraIdx = CAMERA_MODES.indexOf(m); app.renderer.setCameraMode(m); },
      settings() { return { ...app.settings }; },
      vehicles: Object.keys(VEHICLES),
      locations: Object.keys(LOCATIONS),
    };
  }
}

const _v = new THREE.Vector3();
function projectPoint(cam, p, W, H) {
  _v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
  const behind = _v.z > 0;
  _v.applyMatrix4(cam.projectionMatrix);
  const x = (_v.x * 0.5 + 0.5) * W;
  const y = (-_v.y * 0.5 + 0.5) * H;
  const onScreen = !behind && x > 40 && x < W - 40 && y > 40 && y < H - 40;
  return { x, y, behind, onScreen };
}
