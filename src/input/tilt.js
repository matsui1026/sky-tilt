// DeviceOrientationEvent による傾き入力
import { OrientationTracker, normalizeScreenAngle } from './orientation.js';
import { InputPipeline } from './pipeline.js';

export function getScreenAngle() {
  try {
    if (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  } catch (e) { /* 古いブラウザ */ }
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

export class TiltInput {
  constructor(settings) {
    this.tracker = new OrientationTracker();
    this.pipeline = new InputPipeline(settings);
    this.listening = false;
    this.validEvents = 0;
    this.lastEventAt = 0;
    this._onEvent = (e) => this.onEvent(e);
    this._waiters = [];
  }

  static supported() {
    return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
  }

  /**
   * iOS 13+ では許可ダイアログが必要。必ずユーザー操作（タップ）のハンドラ内から呼ぶこと。
   * 戻り値: 'granted' | 'denied' | 'unavailable'
   */
  requestPermission() {
    if (!TiltInput.supported()) return Promise.resolve('unavailable');
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      return DOE.requestPermission().then((r) => (r === 'granted' ? 'granted' : 'denied')).catch(() => 'denied');
    }
    return Promise.resolve('granted');
  }

  start() {
    if (!this.listening && TiltInput.supported()) {
      window.addEventListener('deviceorientation', this._onEvent);
      this.listening = true;
    }
  }

  stop() {
    if (this.listening) window.removeEventListener('deviceorientation', this._onEvent);
    this.listening = false;
  }

  /** 有効なセンサー値が timeout ms 以内に届くか */
  waitForSensor(timeout = 1200) {
    if (this.validEvents > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.validEvents > 0), timeout);
      this._waiters.push(() => { clearTimeout(timer); resolve(true); });
    });
  }

  onEvent(e) {
    if (e.beta == null || e.gamma == null) return;
    const ang = normalizeScreenAngle(getScreenAngle());
    // 画面の向きが変わった（180° 持ち替えなど）→ 基準が無効になるので知らせる
    if (this.lastAngle != null && ang !== this.lastAngle && this.onAngleChange) this.onAngleChange(ang);
    this.lastAngle = ang;
    this.tracker.update(e.alpha, e.beta, e.gamma, ang);
    this.validEvents++;
    this.lastEventAt = performance.now();
    if (this._waiters.length) {
      const w = this._waiters;
      this._waiters = [];
      w.forEach((f) => f());
    }
  }

  hasData() {
    return this.tracker.hasData();
  }

  calibrate(windowMs = 0) {
    this.tracker.calibrate(windowMs);
    this.pipeline.reset();
  }

  setSettings(s) {
    this.pipeline.setSettings(s);
  }

  rawAngles() {
    return this.tracker.angles();
  }

  read(dt) {
    const a = this.tracker.angles();
    return this.pipeline.process(a.pitch, a.roll, dt);
  }
}
