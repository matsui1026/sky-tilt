// アプリ本体: 画面遷移、固定タイムステップの物理ループ（60Hz）と requestAnimationFrame の描画、
// 射撃モード・リング・ゴースト・2 人プレイの橋渡し
import * as THREE from 'three';
import { Simulation, DT } from './sim/sim.js';
import { stallSpeed } from './sim/vehicles/fixedwing.js';
import { clamp, vadd, vscale } from './sim/math.js';
import { GhostRecorder, GhostPlayer } from './sim/ghost.js';
import { FlightRenderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { FlightControls } from './ui/controls.js';
import { h, tapButton } from './ui/dom.js';
import { InputManager } from './input/manager.js';
import { haptic } from './input/touch.js';
import { DEFAULT_INPUT_SETTINGS } from './input/pipeline.js';
import { AudioEngine } from './audio/audio.js';
import { VEHICLES, VEHICLE_ORDER } from './data/vehicles.js';
import { LOCATIONS, LOCATION_ORDER, MODES } from './data/locations.js';
import { Session } from './net/session.js';
import { RtcTransport, PeerJsTransport, makeRoomCode, peerErrorMessage } from './net/transport.js';
import { SILENCE_WARN } from './net/session.js';
import { CRUISE, modesFor } from './sim/modes.js';
import { Progress } from './game/progress.js';
import { dailyChallenge, dailyScore, dateKey } from './game/daily.js';
import { LessonRunner, LESSONS } from './game/lessons.js';
import { encodeState, extraToVs, STATE_HZ } from './net/protocol.js';

const SETTINGS_KEY = 'skytilt.settings.v1';
const TUTORIAL_KEY = 'skytilt.tutorialDone.v1';
const BEST_KEY = 'skytilt.best.v1';
const COMBAT_BEST_KEY = 'skytilt.combatBest.v1';
const GHOST_KEY = 'skytilt.ghost.v1.';
const NAME_KEY = 'skytilt.name.v1';
const PROGRESS_KEY = 'skytilt.progress.v1';
const MODE_BEST_KEY = 'skytilt.modeBest.v1';
const DAILY_KEY = 'skytilt.daily.v1';
const CAM_DIST = { near: 0.72, normal: 1, far: 1.45 };
export const DEFAULT_SEED = 1234;

const store = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* プライベートモード・容量超過等 */ }
  },
};

const CAMERA_MODES = ['chase', 'cockpit', 'external'];
const CAMERA_NAMES = { chase: '後方追従', cockpit: 'コックピット', external: '外部視点' };

export class App {
  constructor(root, { debug = false, forceTutorial = false } = {}) {
    this.root = root;
    this.debug = debug;
    this.forceTutorial = forceTutorial;
    this.settings = {
      ...DEFAULT_INPUT_SETTINGS, control: 'auto', volume: 0.8, vibrate: true, cameraShake: true,
      minimap: true, ghost: true, quality: 'auto', difficulty: 'normal', lefty: false,
      uiSize: 'normal', hudOpacity: 1, camDist: 'normal',
      carAssist: 'mid', carPedal: 'buttons', carSteer: 'tilt', carSens: 1, paints: {},
      ...store.get(SETTINGS_KEY, {}),
    };
    this.warp = 1;
    this.hitDirs = []; // 被弾方向の表示 { from, t }
    this.renderPaused = false;
    this.replay = null;
    this.photo = null;
    this.lesson = null;
    this.progress = new Progress(store, PROGRESS_KEY, { vehicleCount: VEHICLE_ORDER.length, locationCount: LOCATION_ORDER.length, lessonCount: LESSONS.length });
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
    this.hitFlash = 0;
    this.frameEma = 1 / 60;
    this.slowT = 0;
    this.fastT = 0;
    this.mp = null; // { session, role, transport }
    this.inputInited = false;

    // DOM
    this.gl = h('canvas', { id: 'gl' });
    this.hudCanvas = h('canvas', { id: 'hud' });
    this.fxVignette = h('div', { class: 'fx', id: 'fx-vignette' });
    this.fxRed = h('div', { class: 'fx', id: 'fx-red' });
    this.fxCloud = h('div', { class: 'fx', id: 'fx-cloud' });
    this.fxFlash = h('div', { class: 'fx', id: 'fx-flash' });
    this.fxHit = h('div', { class: 'fx', id: 'fx-hit' });
    this.toastEl = h('div', { id: 'toast' });
    this.safeProbe = h('div', { id: 'safe-probe' });
    root.append(this.gl, this.fxCloud, this.hudCanvas, this.fxVignette, this.fxRed, this.fxHit, this.fxFlash, this.safeProbe);

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
      onWarp: () => this.cycleWarp(),
      onHold: (id, on) => this.input.hold(id, on),
      onAction: (id) => this.doAction(id),
      onThrottle: (v, user) => { if (user) this.input.setThrottle(v, true); },
    });
    this.input.stick = this.controls.stick;
    this.input.throttleSlider = this.controls.throttle;
    root.append(this.toastEl);

    this.screens = new Screens(root, {
      onStart: () => this.onStartTap(),
      onMultiplayer: () => this.openLobby(),
      onVehicleNext: () => this.onVehicleNext(),
      onVehicleBack: () => (this.mp ? this.openLobby() : this.screens.show('title')),
      currentVehicle: () => (this.def ? this.def.id : null),
      onDaily: () => this.openDaily(),
      onRecords: () => { this.progress.flush(); this.screens.showRecords(this.progress); },
      onLesson: (id) => this.startLesson(id),
      lessonsDone: () => this.progress.stats.lessons,
      onPhoto: () => this.startPhoto(),
      getPaint: (id) => this.settings.paints[id] ?? null,
      setPaint: (id, col) => { this.settings.paints[id] = col; store.set(SETTINGS_KEY, this.settings); },
      onFly: (cfg) => this.onFly(cfg),
      onResume: () => this.resume(),
      onRecalibrate: () => { this.recalibrate(); this.resume(); },
      onOpenSettings: (from) => this.openSettings(from),
      onChangeVehicle: () => this.toMenu('vehicle'),
      onRestart: () => this.restart(),
      onTitle: () => { this.leaveMultiplayer(); this.toMenu('title'); },
      // メニューを開いている間は飛行用の操作 UI とトーストを隠す
      onScreen: (name) => {
        this.controls.show(this.flying && !name);
        if (name) { this.toastEl.classList.remove('show'); this.input.releaseAll(); }
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
        if (this.flying && !this.paused && !this.mp) this.pause();
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
  /** 傾きセンサーの許可と音の開始（ユーザー操作の中で 1 回） */
  initInput() {
    // iOS: requestPermission はタップのハンドラ内で同期的に呼び出す必要がある
    const perm = this.input.tilt.requestPermission();
    this.audio.init();
    if (this.inputInited) return;
    this.inputInited = true;
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

  onStartTap() {
    this.initInput();
    this.screens.show('vehicle');
  }

  applyControlMode(announce = false) {
    const c = this.settings.control;
    const mode = c === 'stick' ? 'stick' : c === 'tilt' ? 'tilt' : this.sensorOk ? 'tilt' : 'stick';
    const changed = mode !== this.input.mode;
    this.input.setMode(mode);
    this.controls.setStickVisible(mode === 'stick' && !(this.def && this.def.model === 'car' && this.settings.carSteer === 'buttons'));
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
    this.hud.showMinimap = s.minimap !== false;
    if (s.quality === 'high') this.renderer.setQualityScale(1);
    else if (s.quality === 'low') this.renderer.setQualityScale(0.6);
    // 左利き: スティック・機体ボタンを右、スロットル・射撃を左へ
    document.body.classList.toggle('lefty', !!s.lefty);
    this.hud.mirror = !!s.lefty;
    document.body.classList.toggle('btn-large', s.uiSize === 'large');
    this.hudCanvas.style.opacity = String(s.hudOpacity ?? 1);
    this.renderer.rig.distScale = CAM_DIST[s.camDist] ?? 1;
    this.applyCarSettings();
    this.applyControlMode(false);
  }

  /** 車の操作設定を入力と操作 UI へ */
  applyCarSettings() {
    const d = this.def;
    const s = this.settings;
    const isCar = !!d && d.model === 'car';
    this.input.car = {
      active: !!d && d.category === 'car',
      pedal: isCar ? s.carPedal : 'buttons',
      steer: isCar ? s.carSteer : 'tilt',
      sensitivity: isCar ? s.carSens : 1,
    };
    if (this.sim._env) this.sim._env.carAssist = { high: 0.9, mid: 0.55, off: 0 }[s.carAssist] ?? 0.55;
    if (d && this.flying) {
      this.controls.setVehicle(d, { combat: this.sim.mode === 'combat', warp: this.canWarp(), car: { pedal: this.input.car.pedal, steer: this.input.car.steer } });
      this.controls.setWarp(this.warp);
      this.controls.setStickVisible(this.input.mode === 'stick' && !(isCar && s.carSteer === 'buttons'));
      this.updateHudBounds();
    }
  }

  openSettings(from) {
    this.settingsFrom = from;
    this.screens.showSettings(this.settings, (s) => {
      this.settings = s;
      this.applySettings();
      store.set(SETTINGS_KEY, s);
    }, () => this.screens.show(this.settingsFrom === 'pause' ? 'pause' : 'title'));
  }

  onVehicleNext() {
    const v = this.screens.state.vehicle;
    if (this.mp) {
      this.mp.session.setVehicle(v);
      if (this.mp.role === 'guest') {
        this.screens.showWait('ホストが場所とモードを選んでいます…', () => this.screens.show('vehicle'));
        return;
      }
    }
    this.screens.show('location');
  }

  onFly(cfg) {
    if (this.mp && this.mp.role === 'host') {
      const seed = (Math.random() * 1e9) >>> 0;
      const mode = cfg.mode === 'landing' ? 'free' : cfg.mode;
      // リングは遅い方の機体に合わせたコース・大きい方の輪（速い機体は大回りすれば通れるが、遅い機体は速い機体のコースを回れない）
      const other = this.mp.session.remote.vehicle;
      const opts = { time: cfg.time, weather: cfg.weather, mode, seed, pvp: mode === 'combat', rivals: 0 };
      if (mode === 'rings' && other && VEHICLES[other]) {
        const mine = VEHICLES[cfg.vehicle];
        const theirs = VEHICLES[other];
        const slower = (CRUISE[theirs.id] || 0) > 0 && (CRUISE[theirs.id] < (CRUISE[mine.id] || 0)) && mine.id !== 'skydive' ? theirs : mine;
        opts.courseVehicle = slower.id;
        opts.ringRadius = Math.max(mine.ringRadius, theirs.ringRadius);
      }
      this.mpStartFlight(cfg.vehicle, cfg.location, opts);
      return;
    }
    this.startFlight(cfg.vehicle, cfg.location, { time: cfg.time, weather: cfg.weather, mode: cfg.mode, difficulty: this.settings.difficulty });
  }

  // ---------- 今日のチャレンジ・練習 ----------
  openDaily() {
    this.initInput();
    const ch = dailyChallenge();
    const best = store.get(DAILY_KEY, {})[ch.key] ?? null;
    this.screens.showDaily(ch, best, () => {
      this.leaveMultiplayer();
      this.startFlight(ch.vehicle, ch.location, { time: ch.time, weather: ch.weather, mode: ch.mode, seed: ch.seed, difficulty: 'normal', daily: ch.key });
    });
  }

  startLesson(id) {
    this.initInput();
    const l = LESSONS.find((x) => x.id === id);
    if (!l) return;
    this.leaveMultiplayer();
    this.startFlight(l.vehicle, l.location, { time: 'noon', weather: 'clear', mode: 'free', calm: true, skipTutorial: true, lesson: id });
  }

  /** ホスト: 飛行を始めて、同じ条件（リング・的の配置まで）をゲストへ送る */
  mpStartFlight(vehicleId, locationId, opts) {
    this.startFlight(vehicleId, locationId, opts);
    this.mp.remoteFinish = null;
    this.mp.session.sendStart({
      location: locationId, time: opts.time, weather: opts.weather, mode: opts.mode, seed: opts.seed,
      rings: opts.mode === 'rings' ? this.sim.rings : null,
      targets: this.sim.combat ? this.sim.combat.targetList() : null,
    });
  }

  // ---------- 飛行 ----------
  startFlight(vehicleId, locationId, opts = {}) {
    this.cfg = { vehicleId, locationId, opts: { ...opts } };
    const sim = this.sim;
    // その機体で遊べないモード（2 人プレイで相手と機体の種類が違うときなど）はフリーにする
    const mode0 = opts.mode || 'free';
    const mode1 = modesFor(VEHICLES[vehicleId]).includes(mode0) ? mode0 : 'free';
    sim.load(vehicleId, locationId, {
      seed: opts.seed ?? DEFAULT_SEED, time: opts.time || 'noon', weather: opts.weather || 'clear', mode: mode1,
      calm: opts.calm, spawn: opts.spawn, rings: opts.rings || null, pvp: opts.pvp, spawnOffset: opts.spawnOffset,
      difficulty: opts.difficulty, targets: opts.targets || null, courseVehicle: opts.courseVehicle, ringRadius: opts.ringRadius,
      carAssist: this.settings.carAssist, rivals: opts.rivals ?? (this.mp ? 0 : 3), countdown: opts.countdown, laps: opts.laps, driftTime: opts.driftTime,
    });
    const def = sim.def;
    this.def = def;
    this.renderer.load(sim.world, def, sim.rings, sim.mode, sim.combat, { paint: this.settings.paints[def.id], race: sim.race });
    this.renderer.setCameraMode(CAMERA_MODES[this.cameraIdx]);
    this.hud.setVehicle(def);
    this.warp = 1;
    this.hitDirs = [];
    this.lesson = opts.lesson ? new LessonRunner(opts.lesson) : null;
    this.replay = null;
    this.closePhoto();
    this.input.car = { active: def.category === 'car', pedal: def.model === 'car' ? this.settings.carPedal : 'buttons', steer: def.model === 'car' ? this.settings.carSteer : 'tilt', sensitivity: def.model === 'car' ? this.settings.carSens : 1 };
    this.controls.setVehicle(def, { combat: sim.mode === 'combat', warp: this.canWarp(), car: { pedal: this.input.car.pedal, steer: this.input.car.steer } });
    this.controls.show(true);
    this.updateHudBounds(); // 操作 UI が変わったら HUD の配置範囲もすぐ更新
    this.input.setThrottle(sim.ctl.throttle);
    this.input.releaseAll();
    // B ボタン: ラダー（LB/RB にある）以外の最初の機体ボタン
    const primary = def.buttons.find((b) => b.id !== 'rudderL' && b.id !== 'rudderR') || null;
    this.input.gamepad.primaryAction = primary ? primary.id : null;
    this.input.gamepad.primaryHold = !!(primary && primary.type === 'hold');
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
    this.progress.addUnique('vehicles', def.id);
    this.progress.addUnique('locations', locationId);
    this._wasGround = sim.vs.onGround;
    // ゴースト（リングコース・レースの自己ベスト）。記録はリプレイにも使う
    this.ghostRec = new GhostRecorder();
    this.ghost = null;
    if ((sim.mode === 'rings' || sim.mode === 'race') && this.settings.ghost !== false && !this.mp) {
      const data = store.get(GHOST_KEY + this.ghostKey(), null);
      if (data) {
        this.ghost = new GhostPlayer(data);
        this.renderer.setGhost('ghost', vehicleId, { label: 'ベスト', color: '#ffffff', opacity: 0.35 });
      }
    }
    // 2 人プレイの相手
    if (this.mp && this.mp.session.remote.vehicle) this.renderer.setGhost('remote', this.mp.session.remote.vehicle, { label: this.mp.session.remote.name || '相手', color: '#6fd8ff' });
    this.mpSendT = 0;
    const loc = LOCATIONS[locationId];
    // 操作説明は機体ごとに初回だけ（機体によって操作の意味が違うため）
    const tut = store.get(TUTORIAL_KEY, {});
    const tutSeen = tut === true || (tut && tut[def.id]);
    // 射撃モードの説明は、射撃を初めて遊ぶときに 1 回（機体の説明を見たことがあれば射撃の 1 枚だけ）
    const combatTut = sim.mode === 'combat' && !(tut && tut.combat);
    if (!opts.skipTutorial && (!this.debug || this.forceTutorial) && (!tutSeen || combatTut) && !this.mp) {
      this.paused = true;
      this.screens.showTutorial(def, () => {
        const t2 = store.get(TUTORIAL_KEY, {});
        // 旧形式（true = 全機体を見た）も引き継ぐ
        const base = t2 === true ? Object.fromEntries(Object.keys(VEHICLES).map((k) => [k, true])) : typeof t2 === 'object' && t2 ? t2 : {};
        store.set(TUTORIAL_KEY, { ...base, [def.id]: true, ...(sim.mode === 'combat' ? { combat: true } : {}) });
        this.screens.hideAll();
        this.paused = false;
        this.last = performance.now();
        this.input.calibrate(300);
      }, { combat: combatTut, combatOnly: tutSeen && combatTut });
    } else {
      this.toast(`${def.short} ／ ${loc.name} ／ ${MODES[sim.mode].name}`);
    }
  }

  ghostKey() {
    if (this.sim.mode === 'race') return `race:${this.cfg.vehicleId}:${this.cfg.locationId}`;
    return `${this.cfg.vehicleId}:${this.cfg.locationId}`;
  }

  restart() {
    if (!this.cfg) return;
    // 2 人プレイのホスト: 相手も一緒にやり直す（同じ条件をもう一度送る）
    if (this.mp && this.mp.role === 'host') { this.mpStartFlight(this.cfg.vehicleId, this.cfg.locationId, { ...this.cfg.opts, skipTutorial: true }); return; }
    this.startFlight(this.cfg.vehicleId, this.cfg.locationId, { ...this.cfg.opts, skipTutorial: true });
  }

  /** 早送りできるのは、ゆっくり移動する機体の 1 人プレイ（射撃・リングはタイムを競うので不可） */
  canWarp() {
    const d = this.def;
    if (!d || this.mp || this.sim.mode === 'rings' || this.sim.mode === 'combat') return false;
    return d.model === 'balloon' || d.model === 'paraglider' || d.id === 'sailplane';
  }

  cycleWarp() {
    if (!this.flying || !this.canWarp()) return;
    if (this.warp === 1 && this.sim.getState().agl < 80) { this.toast('地面が近いので早送りできません'); return; }
    this.warp = this.warp === 1 ? 2 : this.warp === 2 ? 4 : 1;
    this.controls.setWarp(this.warp);
    this.toast(this.warp > 1 ? `早送り ×${this.warp}` : '通常の速さ');
  }

  toMenu(name) {
    this.progress.flush();
    this.flying = false;
    this.replay = null;
    this.closePhoto();
    this.closeOverlay();
    this.paused = false;
    this.controls.show(false);
    this.audio.silence();
    this.hud.clear();
    this.fxVignette.style.opacity = this.fxRed.style.opacity = this.fxCloud.style.opacity = this.fxHit.style.opacity = 0;
    this.screens.show(name);
  }

  pause(message) {
    if (!this.flying || this.screens.current) return;
    this.paused = true;
    this.screens.show('pause');
    this.screens.setPauseMessage(message || (this.mp ? '2人プレイ中は相手の飛行は止まりません' : ''));
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
    if (id === 'carMode' && r === 'fly' && this.sim.vs.onGround) this.input.setThrottle(Math.max(this.input.throttle, 0.5));
    if (id === 'autopilot' && r && this.def.model !== 'fixedwing') this.input.setThrottle(this.sim.hoverThrottleAt(this.sim.vs.pos.y) ?? this.input.throttle);
  }

  uiKey(id) {
    if (id === 'pause') { if (this.paused && this.screens.current === 'pause') this.resume(); else this.pause(); }
    else if (id === 'camera' && this.flying) this.cycleCamera();
    else if (id === 'recalibrate' && this.flying) this.recalibrate();
    else if (id === 'warp') this.cycleWarp();
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
    // 2 人プレイ: 相手を射撃の的として登録（補間位置）
    if (this.sim.combat && this.mp) {
      const r = this.remoteSample;
      this.sim.combat.externalTargets = r && r.mode !== 'stale' && !r.extra.crashed ? [{ id: 'remote', pos: r.pos, vel: r.vel, r: 5 }] : [];
    }
    this.snapPrev = this.snapCur;
    this.sim.step(1);
    this.snapCur = this.snapshot();
    if (this.ghostRec && this.sim.status === 'flying') this.ghostRec.record(this.sim.t, this.sim.vs.pos, this.sim.vs.q);
  }

  handleEvents() {
    for (const ev of this.sim.drainEvents()) {
      this.audio.event(ev);
      this.renderer.combatEvent(ev);
      switch (ev.type) {
        case 'crash':
          haptic(250);
          this.renderer.rig.bump(0.03);
          this.flash = 0.8;
          // 撃墜されたことを相手に伝える（相手側で「撃墜！」と点数）
          if (this.mp) this.mp.session.sendEvent({ type: 'crash', downed: /相手に撃墜/.test(ev.cause || '') });
          this.warp = 1;
          this.progress.add('crashes');
          clearTimeout(this.crashTimer);
          this.crashTimer = setTimeout(() => {
            if (this.sim.status === 'crashed' && this.flying) {
              this.controls.show(false);
              this.screens.showCrash(this.sim.crashCause, {
                retry: () => this.restart(),
                vehicle: () => this.toMenu('vehicle'),
                location: () => this.toMenu(this.mp && this.mp.role === 'guest' ? 'vehicle' : 'location'),
                replay: () => this.startReplay(() => this.screens.show('crash')),
              });
            }
          }, this.manual ? 0 : 1300);
          break;
        case 'touchdown':
          haptic(clamp(Math.round(20 + Math.abs(ev.vs || 0) * 25), 20, 120));
          if (ev.car) this.progress.max('bestAir', ev.airTime || 0);
          this.renderer.rig.bump(clamp(Math.abs(ev.vs || 0) * 0.004, 0.002, 0.02));
          break;
        case 'ring':
          haptic(15);
          this.progress.add('rings');
          break;
        case 'ringMiss':
          this.toast('リングを外した（+5秒）');
          break;
        case 'aad':
          this.toast('自動展開装置が作動しました');
          break;
        case 'fuelout':
          this.toast(this.def.p.battery ? 'バッテリー切れ！' : '燃料切れ！');
          break;
        case 'notice':
          this.toast(ev.text);
          break;
        case 'carMode':
          this.toast(ev.mode === 'fly' ? '飛行モード: 推力を上げると浮きます' : '走行モード');
          break;
        case 'pop':
          haptic(12);
          this.progress.add('balloons');
          if (this.mp && ev.by !== 'remote') this.mp.session.sendEvent({ type: 'pop', id: ev.id });
          break;
        case 'kill':
          haptic(40);
          if (ev.target === 'enemy') { this.toast('撃墜！'); this.progress.add('kills'); }
          break;
        case 'playerHit':
          haptic(60);
          this.hitFlash = 0.6;
          this.renderer.rig.bump(0.01);
          // 撃ってきた方向を画面の縁に出す（2 人プレイは相手の位置）
          {
            const from = ev.from || (ev.by === 'remote' && this.remoteSample ? this.remoteSample.pos : null);
            if (from) this.hitDirs.push({ from: { ...from }, t: performance.now() });
            if (this.hitDirs.length > 4) this.hitDirs.shift();
          }
          break;
        case 'externalHit':
          if (this.mp) this.mp.session.sendEvent({ type: 'hit', dmg: ev.dmg });
          haptic(10);
          break;
        // 車
        case 'carHit':
          haptic(clamp(Math.round(20 + (ev.impact || 0) * 6), 20, 120));
          this.renderer.rig.bump(clamp((ev.impact || 0) * 0.002, 0.003, 0.03));
          break;
        case 'cone':
          haptic(10);
          this.progress.add('cones');
          break;
        case 'nitro':
          haptic(30);
          break;
        case 'driftStart':
          haptic(15);
          break;
        case 'driftEnd':
          this.progress.max('driftBest', ev.score);
          this.progress.add('driftTotal', ev.score);
          if (ev.score >= 200) this.toast(`ドリフト +${ev.score.toLocaleString()}（×${ev.mult}）`, 1400);
          break;
        case 'driftLost':
          this.toast(`ぶつかって ${ev.score.toLocaleString()} 点を失いました`, 1400);
          break;
        case 'carReset':
          if (ev.reason === 'water') this.toast('水に落ちたので、少し前の場所に戻しました');
          break;
        case 'countdown':
          haptic(ev.n > 0 ? 15 : 60);
          break;
        case 'lap':
          this.toast(`${ev.lap} 周目 ${fmtTimeS(ev.time)}`, 1600);
          haptic(25);
          break;
        case 'parked':
          this.toast(`駐車 ${ev.score} 点`, 1600);
          haptic(30);
          break;
        case 'lock':
          haptic(25);
          break;
        case 'noLock':
          this.toast('ロックオンしていません（敵を正面の円に入れ続ける）');
          break;
        case 'wave':
          if (ev.wave > 1) this.toast(`第${ev.wave}波 — 敵 ${ev.count} 機`);
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
      const key = this.ghostKey();
      // 記録は「通過数が多い方」→「タイムが短い方」の順で比較する
      const best = store.get(BEST_KEY, {});
      const prev = best[key] && typeof best[key] === 'object' ? best[key] : null;
      const cur = { passed: res.passed, total: res.total };
      // 2 人プレイのコースは機体の組み合わせで変わるので自己ベストには数えない
      res.newBest = !this.mp && (!prev || cur.passed > prev.passed || (cur.passed === prev.passed && cur.total < prev.total));
      if (res.newBest) {
        best[key] = cur;
        store.set(BEST_KEY, best);
        if (this.ghostRec && !this.cfg.opts.rings) store.set(GHOST_KEY + key, this.ghostRec.toJSON());
      }
      const b = res.newBest ? cur : prev;
      res.best = b ? b.total : null;
      res.bestPassed = b ? b.passed : null;
      if (this.mp) {
        this.mp.session.sendEvent({ type: 'finish', total: res.total, passed: res.passed });
        const o = this.mp.remoteFinish;
        res.opponent = o ? `${fmtTimeS(o.total)}（${o.passed} 個）${o.total < res.total ? ' — 相手の勝ち' : ' — あなたの勝ち！'}` : 'まだ飛行中';
      }
    }
    if (res.type === 'landing') {
      this.progress.add('landings');
      if (res.grade === 'S') this.progress.add('landingS');
    }
    if (res.type === 'race' || res.type === 'drift' || res.type === 'parking') {
      const bkey = `${res.type}:${this.cfg.vehicleId}:${this.cfg.locationId}`;
      const best = store.get(MODE_BEST_KEY, {});
      const val = res.type === 'race' ? res.time : res.score;
      const prev = best[bkey];
      const better = prev == null || (res.type === 'race' ? val < prev : val > prev);
      res.newBest = !this.mp && better;
      if (res.newBest) {
        best[bkey] = val;
        store.set(MODE_BEST_KEY, best);
        if (res.type === 'race' && this.ghostRec) store.set(GHOST_KEY + this.ghostKey(), this.ghostRec.toJSON());
      }
      res.best = best[bkey] ?? null;
      if (res.type === 'race') {
        this.progress.add('races');
        if (res.place === 1 && res.cars > 1) {
          this.progress.add('raceWins');
          if (this.cfg.opts.difficulty === 'hard') this.progress.add('raceWinsHard');
        }
        if (this.mp) {
          this.mp.session.sendEvent({ type: 'finish', total: res.time, passed: res.place, race: true });
          const o = this.mp.remoteFinish;
          res.opponent = o ? `${fmtTimeS(o.total)}${o.total < res.time ? ' — 相手の勝ち' : ' — あなたの勝ち！'}` : 'まだ走行中';
        }
      }
      if (res.type === 'parking' && res.grade === 'S') this.progress.add('parkS');
    }
    if (this.cfg.opts.daily) {
      const d = store.get(DAILY_KEY, {});
      const v = dailyScore(res);
      if (d[this.cfg.opts.daily] == null || v > d[this.cfg.opts.daily]) { d[this.cfg.opts.daily] = v; store.set(DAILY_KEY, d); }
      this.progress.addUnique('dailyDays', this.cfg.opts.daily);
      this.toast(`今日のチャレンジ: ${v.toLocaleString()} 点`, 3000);
    }
    this.progress.flush();
    if (res.type === 'combat') {
      const key = this.ghostKey();
      // 難易度ごとに別の記録。途中終了（着地）の点数も記録には残す
      const bkey = `${key}:${this.cfg.opts.difficulty || 'normal'}`;
      const best = store.get(COMBAT_BEST_KEY, {});
      res.newBest = !this.mp && (best[bkey] == null || res.score > best[bkey]);
      if (res.newBest) { best[bkey] = res.score; store.set(COMBAT_BEST_KEY, best); }
      res.best = best[bkey] ?? null;
      res.difficulty = this.cfg.opts.difficulty || 'normal';
    }
    const canContinue = res.type === 'landing' && this.sim.mode === 'free' && ['fixedwing', 'heli', 'jetsuit', 'flycar', 'balloon'].includes(def.model);
    const show = () => {
      if (!this.flying) return;
      this.paused = true;
      this.controls.show(false);
      this.screens.showResult(res, def, {
        continue: canContinue ? () => { this.sim.status = 'flying'; this.sim.result = null; this.controls.show(true); this.resume(); } : null,
        retry: () => this.restart(),
        vehicle: () => this.toMenu('vehicle'),
        location: () => this.toMenu(this.mp && this.mp.role === 'guest' ? 'vehicle' : 'location'),
        share: () => this.share(res),
        replay: () => this.startReplay(show),
      });
    };
    if (this.manual) show();
    else this.resultTimer = setTimeout(show, 900);
  }

  share(res) {
    const loc = LOCATIONS[this.cfg.locationId].name;
    const text = res.type === 'rings' ? `SKY TILT リングコース（${this.def.short}・${loc}）${fmtTimeS(res.total)} / ${res.passed}個通過`
      : res.type === 'combat' ? `SKY TILT 射撃（${this.def.short}・${loc}）${res.score}点`
      : res.type === 'race' ? `SKY TILT レース（${this.def.short}・${loc}）${res.place}位 ${fmtTimeS(res.time)}`
      : res.type === 'drift' ? `SKY TILT ドリフト（${this.def.short}・${loc}）${res.score}点 評価 ${res.grade}`
      : res.type === 'parking' ? `SKY TILT 駐車（${this.def.short}・${loc}）${res.score}点 評価 ${res.grade}`
        : `SKY TILT 着陸（${this.def.short}・${loc}）評価 ${res.grade} / ${res.score}点`;
    const url = location.href.split('?')[0];
    if (navigator.share) navigator.share({ title: 'SKY TILT', text, url }).catch(() => {});
    else {
      try { navigator.clipboard.writeText(`${text} ${url}`); this.toast('結果をコピーしました'); } catch (e) { this.toast(text); }
    }
  }

  // ---------- 2 人プレイ ----------
  openLobby() {
    this.initInput();
    const name = store.get(NAME_KEY, '') || `パイロット${Math.floor(Math.random() * 90 + 10)}`;
    const setName = (n) => { const v = String(n || name).trim().slice(0, 10) || name; store.set(NAME_KEY, v); return v; };
    const fail = (e) => this.screens.setLobbyStatus(`接続できませんでした: ${peerErrorMessage(e)}`);
    this.screens.showLobby({
      host: async (n) => {
        this.leaveMultiplayer();
        const nm = setName(n);
        const code = makeRoomCode();
        const t = new PeerJsTransport();
        this.screens.setLobbyStatus('ルームを準備中…');
        try {
          await t.host(code);
          this.pendingT = t;
          t.onopen = () => this.mpConnected(t, 'host', nm);
          this.screens.setLobbyStatus('このコードを相手に伝えて、相手が「参加」するのを待っています', { code });
        } catch (e) { fail(e); }
      },
      join: async (n, code) => {
        this.leaveMultiplayer();
        const nm = setName(n);
        if (!code || code.trim().length < 4) { this.screens.setLobbyStatus('4 文字のコードを入力してください'); return; }
        const t = new PeerJsTransport();
        this.screens.setLobbyStatus('ルームに接続中…');
        try {
          await t.join(code);
          this.mpConnected(t, 'guest', nm);
        } catch (e) { fail(e); }
      },
      manualHost: async (n) => {
        this.leaveMultiplayer();
        const nm = setName(n);
        const t = new RtcTransport();
        this.pendingT = t;
        t.onopen = () => this.mpConnected(t, 'host', nm);
        try {
          const code = await t.createOffer();
          this.screens.setLobbyStatus('① この接続コードを相手に送り、② 相手から返ってきたコードを右に貼って「接続」', { manualCode: code });
        } catch (e) { fail(e); }
      },
      manualJoin: async (n, offer) => {
        this.leaveMultiplayer();
        const nm = setName(n);
        const t = new RtcTransport();
        this.pendingT = t;
        t.onopen = () => this.mpConnected(t, 'guest', nm);
        try {
          const ans = await t.createAnswer(offer);
          this.screens.setLobbyStatus('この接続コードをホストへ送り返してください（つながると自動で進みます）', { manualCode: ans });
        } catch (e) { fail(e); }
      },
      manualAccept: async (text) => {
        if (!(this.pendingT instanceof RtcTransport)) { this.screens.setLobbyStatus('先に「作成（ホスト）」を押してください'); return; }
        try { await this.pendingT.acceptAnswer(text); this.screens.setLobbyStatus('接続中…'); } catch (e) { fail(e); }
      },
      back: () => { this.leaveMultiplayer(); this.screens.show('title'); },
      proceed: () => this.screens.show('vehicle'),
    }, { name, connected: !!this.mp });
  }

  mpConnected(transport, role, name) {
    if (this.mp && this.mp.transport === transport) return;
    const session = new Session(transport, { role, name });
    this.mp = { session, role, transport, remoteFinish: null };
    this.pendingT = null;
    session.on('hello', (r) => {
      this.screens.setLobbyStatus(`接続しました！ 相手: ${r.name}${r.vehicle ? `（${VEHICLES[r.vehicle].short}）` : ''}`, { connected: true });
      if (this.flying && r.vehicle) this.renderer.setGhost('remote', r.vehicle, { label: r.name, color: '#6fd8ff' });
    });
    session.on('start', (cfg) => {
      if (role !== 'guest') return;
      this.mp.remoteFinish = null;
      this.startFlight(this.screens.state.vehicle, cfg.location, {
        time: cfg.time, weather: cfg.weather, mode: cfg.mode, seed: cfg.seed, rings: cfg.rings, targets: cfg.targets, pvp: cfg.mode === 'combat', spawnOffset: true, skipTutorial: true,
      });
    });
    session.on('event', (e) => this.onRemoteEvent(e));
    session.on('close', () => {
      if (!this.mp || this.mp.session !== session) return;
      this.toast('相手との接続が切れました');
      this.renderer.removeGhost('remote');
      this.mp = null;
      this.remoteSample = null;
      if (this.sim.combat) { this.sim.combat.externalTargets = []; this.sim.combat.invulnerable = false; }
      this.screens.setMultiplayer(null);
      if (this.screens.current === 'wait' || this.screens.current === 'lobby') this.openLobby();
    });
    session.start();
    session.setVehicle(this.screens.state.vehicle);
    this.screens.setMultiplayer({ role });
    this.screens.setLobbyStatus('接続しました！ 相手の情報を待っています…', { connected: true });
  }

  onRemoteEvent(e) {
    if (!e || !this.flying) {
      if (e && e.type === 'finish' && this.mp) this.mp.remoteFinish = e;
      return;
    }
    switch (e.type) {
      case 'pop':
        if (this.sim.combat && this.sim.combat.forceKill(e.id)) {
          const t = this.sim.combat.targets.find((x) => x.id === e.id);
          if (t) this.renderer.combatEvent({ type: 'pop', pos: t.pos });
        }
        break;
      case 'hit':
        if (this.sim.combat && this.sim.status === 'flying') {
          this.sim.combat.damagePlayer(clamp(+e.dmg || 0, 0, 30), this.sim._env, 'remote');
          for (const ev of this.sim.combat.drainEvents()) this.sim.emit(ev.type, ev);
        }
        break;
      case 'finish':
        this.mp.remoteFinish = e;
        this.toast(`${this.mp.session.remote.name} がゴール: ${fmtTimeS(e.total)}`);
        break;
      case 'crash':
        if (e.downed && this.sim.combat) {
          // 自分の弾で相手を撃墜した
          this.sim.combat.score += 1000;
          this.sim.combat.kills++;
          this.toast(`${this.mp.session.remote.name} を撃墜！ +1000`);
          haptic(40);
        } else this.toast(`${this.mp.session.remote.name} が墜落`);
        break;
      default:
    }
  }

  leaveMultiplayer() {
    if (this.mp) { try { this.mp.session.close(); } catch (e) { /* 閉じ済み */ } }
    if (this.pendingT) { try { this.pendingT.close(); } catch (e) { /* 閉じ済み */ } }
    this.mp = null;
    this.pendingT = null;
    this.remoteSample = null;
    if (this.sim.combat) this.sim.combat.externalTargets = [];
    this.screens.setMultiplayer(null);
    this.renderer.removeGhost('remote');
  }

  // ---------- フレーム ----------
  frame(now) {
    // 画面効果（G の暗転など）は実時間で進める。物理は 1 フレーム最大 0.1 秒（重い端末で一気に進めない）
    const realDt = clamp((now - this.last) / 1000, 0, 1);
    const dt = Math.min(realDt, 0.1);
    this.last = now;
    if (this.photo) { this.renderer.renderOrbit(realDt, this.photo.target, this.photo.yaw, this.photo.pitch, this.photo.dist); return; }
    if (this.replay) { this.stepReplay(realDt); return; }
    if (!this.flying) return;
    this.adaptQuality(dt);
    if (this.mp) this.remoteSample = this.mp.session.sampleRemote();
    // 2 人の射撃: 一時停止中は撃たれない（相手の画面では飛び続けているように見えるため）
    if (this.sim.combat && this.mp) this.sim.combat.invulnerable = this.paused;
    if (this.warp > 1 && this.sim.status === 'flying' && this.sim.getState().agl < 80) {
      this.warp = 1;
      this.controls.setWarp(1);
      this.toast('地面が近いので通常の速さに戻しました');
    }
    if (!this.paused && !this.manual) {
      this.acc += dt * this.warp;
      let n = 0;
      const maxN = 6 * this.warp;
      while (this.acc >= DT && n < maxN) {
        this.stepOnce();
        this.acc -= DT;
        n++;
      }
      if (n >= maxN) this.acc = 0;
    } else if (this.paused) {
      // 一時停止中も入力フィルタは更新しておく（再開時の飛びを防ぐ）
      this.input.update(dt);
    }
    this.handleEvents();
    const st = this.sim.getState();
    st.abCmd = this.sim.ctl.ab;
    // 2 人プレイ: 状態を送る（20Hz）
    if (this.mp) {
      this.mpSendT += dt;
      if (this.mpSendT >= 1 / STATE_HZ) {
        // 余りを持ち越して平均 20Hz を保つ（遅いフレームが続いても 2 回分以上はまとめない）
        this.mpSendT = Math.min(this.mpSendT - 1 / STATE_HZ, 1 / STATE_HZ);
        this.mp.session.sendState(encodeState(this.mp.session.now(), st, this.sim.vs));
      }
      const r = this.remoteSample;
      if (r && this.renderer.ghosts.has('remote')) this.renderer.updateGhost('remote', r.mode === 'stale' && r.extra.crashed ? null : r.pos, r.q, { ...extraToVs(r.extra), vx: Math.hypot(r.vel.x, r.vel.z) }, dt);
    }
    // ゴースト
    if (this.ghost) {
      const g = this.ghost.sample(this.sim.t);
      this.renderer.updateGhost('ghost', g ? g.pos : null, g ? g.q : null, {}, dt);
    }
    const alpha = this.manual || this.paused ? 1 : clamp(this.acc / DT, 0, 1);
    // テスト用: 描画を止めて通信の遅延だけを測る（?debug=1 の setRenderPaused）
    this.tickProgress(st, dt);
    if (this.renderPaused) return;
    this.renderer.render(dt, this.snapPrev, this.snapCur, alpha, st, this.sim.vs);
    if ((this._bf = (this._bf || 0) + 1) % 15 === 1) this.updateHudBounds();
    this.hud.draw(st, this.hudExtra(st));
    this.audio.update(st, this.sim.vs, this.def, this.paused);
    this.controls.sync(st);
    this.updateFx(realDt, st);
  }

  /** 実績の累計と、練習モードの進行 */
  tickProgress(st, dt) {
    if (this.paused || st.status !== 'flying') return;
    const def = this.def;
    this.progress.tick(st, def, this.sim.world.weather.id, this.sim.world.time.id, this.manual ? 0 : dt * this.warp);
    if (this._wasGround && !st.onGround && (def.model === 'fixedwing' || def.model === 'heli')) this.progress.add('takeoffs');
    this._wasGround = st.onGround;
    for (const a of this.progress.drain()) this.toast(`🏆 実績「${a.name}」`, 3000);
    if (this.lesson) {
      const r = this.lesson.update(st, dt);
      if (r === 'next') { haptic(20); this.audio.event({ type: 'checkpoint' }); }
      if (r === 'done') {
        this.progress.addUnique('lessons', this.lesson.lesson.id);
        this.toast('練習完了！ このまま自由に操作できます', 3500);
        this.audio.event({ type: 'lap' });
        this.lesson = null;
      }
    }
  }

  // ---------- リプレイ ----------
  /** back: 閉じたあとに戻る画面を出す関数 */
  startReplay(back) {
    if (!this.ghostRec || this.ghostRec.frames.length < 5) { this.toast('リプレイの記録がありません'); return; }
    const player = new GhostPlayer(this.ghostRec.toJSON());
    const STYLES = ['chase', 'external', 'trackside'];
    const NAMES = { chase: '後方', external: '周回', trackside: '定点' };
    const r = { player, t: player.f[0][0], speed: 1, style: 0, styles: STYLES, prev: null, back };
    this.replay = r;
    this.screens.hideAll();
    this.controls.show(false);
    this.hud.clear();
    this.renderer.setRivalsVisible(false);
    const camBtn = tapButton(`視点: ${NAMES[STYLES[0]]}`, () => { r.style = (r.style + 1) % STYLES.length; camBtn.textContent = `視点: ${NAMES[STYLES[r.style]]}`; }, 'btn', { id: 'btn-replay-cam' });
    const spBtn = tapButton('速さ ×1', () => { r.speed = r.speed === 1 ? 2 : r.speed === 2 ? 0.5 : 1; spBtn.textContent = `速さ ×${r.speed}`; }, 'btn', { id: 'btn-replay-speed' });
    const close = tapButton('閉じる', () => this.closeReplay(), 'btn primary', { id: 'btn-replay-close' });
    this.overlayEl = h('div', { class: 'overlay-bar', id: 'replay-bar' }, camBtn, spBtn, close);
    this.root.append(this.overlayEl);
  }

  stepReplay(dt) {
    const r = this.replay;
    r.t += dt * r.speed;
    if (r.t >= r.player.duration) { r.t = r.player.f[0][0]; r.player.i = 0; r.prev = null; }
    const g = r.player.sample(r.t);
    if (!g) return;
    const sp = r.prev && dt > 0 ? Math.hypot(g.pos.x - r.prev.x, g.pos.y - r.prev.y, g.pos.z - r.prev.z) / Math.max(dt * r.speed, 1e-3) : 0;
    r.prev = g.pos;
    this.renderer.renderPose(dt, g.pos, g.q, { speed: sp, vx: sp, throttle: 0.5, rotorRpm: 1, fanRpm: this.sim.vs.fanRpm ?? 1, deployT: 99, phase: this.sim.vs.phase ?? null, gearPos: this.sim.vs.gearPos ?? 1, carMode: this.sim.vs.mode ?? 'drive' }, r.styles[r.style]);
  }

  closeReplay() {
    const r = this.replay;
    this.replay = null;
    this.closeOverlay();
    this.renderer.setRivalsVisible(true);
    this.renderer.setCameraMode(CAMERA_MODES[this.cameraIdx]);
    if (r && r.back) r.back();
  }

  closeOverlay() {
    if (this.overlayEl) { this.overlayEl.remove(); this.overlayEl = null; }
    if (this.overlayHint) { this.overlayHint.remove(); this.overlayHint = null; }
  }

  // ---------- 写真モード ----------
  startPhoto() {
    if (!this.flying || !this.sim.vs) return;
    const p = this.sim.vs.pos;
    const size = this.renderer.model.root.userData.size || 8;
    const att = this.sim.getState().attitude;
    this.photo = { target: { x: p.x, y: p.y, z: p.z }, yaw: ((att.heading + 150) * Math.PI) / 180, pitch: 0.18, dist: Math.max(6, size * 1.2) };
    this.screens.hideAll();
    this.paused = true;
    this.controls.show(false);
    this.hud.clear();
    const ph = this.photo;
    const surface = h('div', { id: 'photo-surface' });
    const pointers = new Map();
    let pinch0 = 0, dist0 = 0;
    surface.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { surface.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント */ }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        dist0 = ph.dist;
      }
    });
    surface.addEventListener('pointermove', (e) => {
      const o = pointers.get(e.pointerId);
      if (!o) return;
      if (pointers.size === 1) {
        ph.yaw -= (e.clientX - o.x) * 0.008;
        ph.pitch = clamp(ph.pitch + (e.clientY - o.y) * 0.006, -0.15, 1.4);
      }
      o.x = e.clientX; o.y = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) ph.dist = clamp((dist0 * pinch0) / Math.max(d, 1), 3, 120);
      }
    });
    const up = (e) => pointers.delete(e.pointerId);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
    surface.addEventListener('wheel', (e) => { ph.dist = clamp(ph.dist * (1 + e.deltaY * 0.001), 3, 120); e.preventDefault(); }, { passive: false });
    this.photoSurface = surface;
    const shoot = tapButton('📷 撮影', () => this.takePhoto(), 'btn primary', { id: 'btn-photo-shoot' });
    const close = tapButton('戻る', () => { this.closePhoto(); this.screens.show('pause'); }, 'btn', { id: 'btn-photo-close' });
    this.overlayEl = h('div', { class: 'overlay-bar', id: 'photo-bar' }, shoot, close);
    this.overlayHint = h('div', { class: 'overlay-hint' }, 'ドラッグで回転・2 本指（PC はホイール）で拡大縮小');
    this.root.append(surface, this.overlayEl, this.overlayHint);
  }

  async takePhoto() {
    const ph = this.photo;
    if (!ph) return null;
    // 描いた直後でないと画面の内容が取れないので、ここで描いてすぐ PNG にする
    this.renderer.renderOrbit(0, ph.target, ph.yaw, ph.pitch, ph.dist);
    const blob = await this.renderer.capture();
    if (!blob) { this.toast('写真を保存できませんでした'); return null; }
    this.lastPhotoSize = blob.size;
    const file = new File([blob], `skytilt-${Date.now()}.png`, { type: 'image/png' });
    if (!this.debug && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'SKY TILT' }).catch(() => {});
    } else if (!this.debug) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    this.toast('写真を保存しました');
    return blob.size;
  }

  closePhoto() {
    this.photo = null;
    if (this.photoSurface) { this.photoSurface.remove(); this.photoSurface = null; }
    this.closeOverlay();
    if (this.renderer && this.flying) this.renderer.setCameraMode(CAMERA_MODES[this.cameraIdx]);
  }

  /** HUD に渡す付加情報（射撃の照準・目標、レーダー、相手プレイヤー） */
  hudExtra(st) {
    const cam = this.renderer.camera;
    const W = this.hud.W, H = this.hud.H;
    const project = (p) => projectPoint(cam, p, W, H);
    const extra = {
      fov: cam.fov, camera: cam, stallKmh: this.stallKmh, project,
      projectRadius: (center, radius) => {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const a = project(center);
        const b = project({ x: center.x + right.x * radius, y: center.y + right.y * radius, z: center.z + right.z * radius });
        return Math.hypot(b.x - a.x, b.y - a.y);
      },
    };
    const vs = this.sim.vs;
    const items = [];
    const field = this.sim.world.terrain.field;
    items.push({ x: field.x, z: field.z, color: '#ffb040', shape: 'square', r: 3 });
    let range = ['heli', 'jetsuit', 'paraglider', 'balloon'].includes(this.def.model) || this.def.id === 'drone' ? 1500 : 4000;
    if (st.rings && st.rings.next) {
      const idx = st.rings.index;
      this.sim.rings.slice(idx, idx + 4).forEach((r, i) => items.push({ x: r.pos.x, z: r.pos.z, color: i === 0 ? '#3affb0' : '#ffc23a', r: i === 0 ? 4 : 2.5 }));
      range = clamp(Math.ceil((st.rings.approach ? st.rings.approach.dist : 1000) * 1.4 / 250) * 250, 500, 5000);
    }
    const c = this.sim.combat;
    if (c) {
      const targets = [];
      let nearest = null, nd = Infinity;
      for (const t of c.targets) {
        if (!t.alive) continue;
        const d = Math.hypot(t.pos.x - vs.pos.x, t.pos.y - vs.pos.y, t.pos.z - vs.pos.z);
        items.push({ x: t.pos.x, z: t.pos.z, color: t.type === 'balloon' ? '#ffb8f0' : '#ffb040', r: 2, shape: t.type === 'ground' ? 'square' : 'dot' });
        const entry = { pos: t.pos, kind: t.type, dist: d };
        if (d < 2500) targets.push(entry);
        if (d < nd) { nd = d; nearest = entry; }
      }
      // いちばん近い目標は遠くても矢印で示す（2.5 km より遠い目標しか残っていないときに迷わないように）
      if (nearest) { nearest.nearest = true; if (!targets.includes(nearest)) targets.push(nearest); }
      // 風船の印は近い 5 個まで（画面が印だらけにならないように）
      const balloons = targets.filter((t) => t.kind === 'balloon' && !t.nearest).sort((a, b) => a.dist - b.dist);
      for (const b of balloons.slice(5)) targets.splice(targets.indexOf(b), 1);
      for (const e of c.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - vs.pos.x, e.pos.y - vs.pos.y, e.pos.z - vs.pos.z);
        const lk = c.lock.target === e.id ? c.lock.progress : null;
        targets.push({ pos: e.pos, kind: 'enemy', dist: d, lock: lk, locked: lk != null && c.lock.locked });
        items.push({ x: e.pos.x, z: e.pos.z, color: '#ff4a3a', r: 3.5, shape: 'tri' });
      }
      extra.combatTargets = targets;
      if (c.armed) {
        const dir = c.gunDirection(vs);
        extra.aim = project(vadd(vs.pos, vscale(dir, 400)));
        // 偏差照準（リード）: エイムアシストが狙う未来位置。照準をここに重ねれば当たる
        const muzzle = vadd(vs.pos, vscale(dir, 3));
        const ad = c.aimAssist(dir, muzzle);
        if (ad !== dir) extra.pipper = project(vadd(muzzle, vscale(ad, 400)));
      }
      extra.threats = st.combat.threats;
      const nowMs = performance.now();
      this.hitDirs = this.hitDirs.filter((x) => nowMs - x.t < 1500);
      extra.hitDirs = this.hitDirs.map((x) => ({ from: x.from, age: (nowMs - x.t) / 1500 }));
      range = this.def.id === 'drone' || this.def.model === 'jetsuit' || this.def.model === 'heli' ? 800 : 2500;
    }
    if (this.mp && this.remoteSample) {
      const r = this.remoteSample;
      const d = Math.hypot(r.pos.x - vs.pos.x, r.pos.y - vs.pos.y, r.pos.z - vs.pos.z);
      const ring = r.extra.ringIndex >= 0 && st.rings ? ` R${Math.min(r.extra.ringIndex + 1, st.rings.total)}` : '';
      extra.remotes = [{ pos: r.pos, name: (this.mp.session.remote.name || '相手') + ring, dist: d }];
      items.push({ x: r.pos.x, z: r.pos.z, color: '#6fd8ff', r: 4 });
    }
    if (this.mp) {
      // 通信の状態（往復の遅延、途切れ）
      const s = this.mp.session;
      extra.net = { rtt: s.rtt(), weak: s.silence() > SILENCE_WARN };
    }
    if (this.ghost) {
      const g = this.ghost.sample(this.sim.t);
      if (g) items.push({ x: g.pos.x, z: g.pos.z, color: '#ffffff', r: 2.5 });
    }
    if (this.def.category === 'car' && (st.carMode == null || st.carMode === 'drive')) {
      const t = this.sim.world.terrain.track;
      if (!this._mapTrackFor || this._mapTrackFor !== t) {
        this._mapTrackFor = t;
        const stepN = Math.max(1, Math.floor(t.n / 80));
        this._mapTrack = t.pts.filter((_, i) => i % stepN === 0);
      }
      extra.mapTrack = this._mapTrack;
      range = clamp(300 + st.groundSpeed * 8, 300, 900);
      if (st.race) {
        items.push({ x: st.race.next.x, z: st.race.next.z, color: '#3affb0', r: 4 });
        for (const rv of this.sim.race.rivals) items.push({ x: rv.pos.x, z: rv.pos.z, color: `#${rv.paint.toString(16).padStart(6, '0')}`, r: 3.5, shape: 'tri' });
      }
      if (st.parking && st.parking.box) { items.push({ x: st.parking.box.x, z: st.parking.box.z, color: '#ffc23a', r: 4, shape: 'square' }); range = 200; }
    }
    if (this.lesson) extra.lesson = this.lesson.view();
    extra.mapItems = items;
    extra.mapRange = range;
    return extra;
  }

  /** 自動画質: フレーム時間が長い状態が続いたら解像度を下げ、余裕があれば戻す */
  adaptQuality(dt) {
    if (this.settings.quality !== 'auto' || this.manual) return;
    this.frameEma += (dt - this.frameEma) * 0.05;
    if (this.frameEma > 1 / 38) { this.slowT += dt; this.fastT = 0; } else if (this.frameEma < 1 / 55) { this.fastT += dt; this.slowT = 0; } else { this.slowT = 0; this.fastT = 0; }
    if (this.slowT > 2) { this.slowT = 0; this.renderer.setQualityScale(this.renderer.qualityScale - 0.15); }
    if (this.fastT > 6) { this.fastT = 0; this.renderer.setQualityScale(this.renderer.qualityScale + 0.1); }
  }

  /** HUD を置ける横方向の範囲（左手の操作 UI の右端〜スロットル・射撃ボタンの左端） */
  updateHudBounds() {
    // 下側の操作 UI（左右どちらに置かれていても）の内側を HUD の範囲にする
    const W = this.hud.W;
    const rects = [this.controls.leftZone, this.controls.thrEl, this.controls.weaponZone, this.controls.pedalZone]
      .filter((e) => e.style.display !== 'none').map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const lefts = rects.filter((r) => r.left + r.right < W);
    const rights = rects.filter((r) => r.left + r.right >= W);
    const l = lefts.length ? Math.max(...lefts.map((x) => x.right)) + 6 : this.hud.safe.l + 8;
    // 右側に操作 UI が無いときは、右上のレーダーの左端までを使う
    const r = rights.length ? Math.min(...rights.map((x) => x.left)) - 6 : W - this.hud.safe.r - (this.hud.showMinimap !== false ? 116 : 8);
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
    this.hitFlash *= Math.exp(-dt / 0.2);
    this.fxHit.style.opacity = this.hitFlash.toFixed(3);
    // 透明なオーバーレイは合成コストがかかるので、見えないときは隠す
    for (const el of [this.fxVignette, this.fxRed, this.fxCloud, this.fxFlash, this.fxHit]) el.style.visibility = parseFloat(el.style.opacity) > 0.004 ? 'visible' : 'hidden';
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
      version: 2,
      setInput(o = {}) {
        const c = app.sim.ctl || {};
        app.override = { pitch: c.pitch ?? 0, roll: c.roll ?? 0, yaw: c.yaw ?? 0, throttle: c.throttle ?? 0, ...(app.override || {}), ...o };
        return app.override;
      },
      clearInput() { app.override = null; },
      step(n = 1) {
        for (let i = 0; i < n; i++) app.stepOnce();
        app.handleEvents();
        return app.sim.getState();
      },
      getState() {
        if (!app.sim.vs) return { screen: app.screens.current, flying: false, inputMode: app.input.mode, sensorOk: app.sensorOk, mp: app.mpStatus() };
        return { ...app.sim.getState(), screen: app.screens.current, flying: app.flying, paused: app.paused, inputMode: app.input.mode, sensorOk: app.sensorOk, processedInput: { ...app.input.out }, rawTilt: app.input.tilt.rawAngles(), camera: CAMERA_MODES[app.cameraIdx], mp: app.mpStatus() };
      },
      loadScenario(vehicleId, locationId, opts = {}) {
        app.override = null;
        app.manual = !opts.realtime;
        app.startFlight(vehicleId, locationId, { ...opts, skipTutorial: true });
        return app.sim.getState();
      },
      setRealtime(on) { app.manual = !on; app.last = performance.now(); },
      progress() { app.progress.flush(); return { stats: app.progress.stats, unlocked: app.progress.unlocked }; },
      lesson() { return app.lesson ? app.lesson.view() : null; },
      async photo() { return app.takePhoto(); },
      /** 描画を止める（物理・送受信は続く）。描画の重い環境で通信遅延だけを測るため */
      setRenderPaused(on) { app.renderPaused = !!on; },
      warp() { return app.warp; },
      cycleWarp() { app.cycleWarp(); return app.warp; },
      action(id) { const r = app.sim.action(id); app.handleEvents(); return r; },
      calibrate() { app.input.calibrate(); },
      readInput() { return app.input.update(DT); },
      renderInfo() { return app.renderer.info(); },
      hudRects() {
        // 最新の状態と配置で描き直してから返す（描画の遅い環境で前の機体の HUD が残っていないように）
        app.updateHudBounds();
        if (app.flying && app.sim.vs) { const st = app.sim.getState(); app.hud.draw(st, app.hudExtra(st)); }
        return { rects: app.hud.rects || [], bounds: app.hud.bounds };
      },
      audioStats() { return { ...app.audio.stats, ready: !!app.audio.ctx }; },
      fx() { return { gDark: app.gDark, gRed: app.gRed, cloud: app.renderer.cloudDensity, hit: app.hitFlash, quality: app.renderer.qualityScale }; },
      combat() {
        const c = app.sim.combat;
        if (!c) return null;
        return { targets: c.targets.map((t) => ({ id: t.id, type: t.type, pos: { ...t.pos }, alive: t.alive })), enemies: c.enemies.map((e) => ({ id: e.id, pos: { ...e.pos }, alive: e.alive })), bullets: c.bullets.length, ...c.summary() };
      },
      ghosts() { return [...app.renderer.ghosts.keys()]; },
      setCamera(m) { app.cameraIdx = CAMERA_MODES.indexOf(m); app.renderer.setCameraMode(m); },
      settings() { return { ...app.settings }; },
      vehicles: Object.keys(VEHICLES),
      locations: Object.keys(LOCATIONS),
    };
  }

  mpStatus() {
    if (!this.mp) return null;
    const s = this.mp.session;
    const r = s.sampleRemote();
    return { role: this.mp.role, remoteName: s.remote.name, remoteVehicle: s.remote.vehicle, rtt: s.rtt(), offset: s.remote.clock.offset, silence: s.silence(), remote: r ? { pos: r.pos, mode: r.mode, extra: r.extra } : null, stats: { ...s.stats } };
  }
}

function fmtTimeS(t) {
  const tenths = Math.round(t * 10);
  const m = Math.floor(tenths / 600);
  t = m * 60 + (tenths - m * 600) / 10;
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
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
