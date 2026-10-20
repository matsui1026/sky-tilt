// タッチ操作: バーチャルスティック、スロットル（縦スライダー）、機体固有ボタン
import { clamp } from '../sim/math.js';
import { expoCurve } from './pipeline.js';

export function haptic(ms = 12) {
  try {
    if (navigator.vibrate && haptic.enabled !== false) navigator.vibrate(ms);
  } catch (e) { /* 非対応 */ }
}
haptic.enabled = true;

/** 左手のバーチャルスティック。下へ引く＝機首上げ（操縦桿と同じ） */
export class VirtualStick {
  constructor(el, knob) {
    this.el = el;
    this.knob = knob;
    this.x = 0;
    this.y = 0;
    this.pointer = null;
    this.expo = 0.3;
    const down = (e) => {
      if (this.pointer != null) return;
      this.pointer = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント */ }
      this.move(e);
      el.classList.add('pressed');
      e.preventDefault();
    };
    const move = (e) => {
      if (e.pointerId !== this.pointer) return;
      this.move(e);
      e.preventDefault();
    };
    const up = (e) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.x = 0;
      this.y = 0;
      this.render();
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  move(e) {
    const r = this.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const R = r.width / 2;
    let dx = (e.clientX - cx) / R;
    let dy = (e.clientY - cy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    this.x = dx;
    this.y = dy;
    this.render();
  }
  render() {
    this.knob.style.transform = `translate(${this.x * 50}%, ${this.y * 50}%)`;
  }
  value() {
    // 設定の感度・エクスポ・ピッチ反転を反映
    const k = this.sensitivity ?? 1;
    const r = expoCurve(Math.max(-1, Math.min(1, this.x * k)), this.expo);
    const p = expoCurve(Math.max(-1, Math.min(1, this.y * k)), this.expo);
    return { roll: r, pitch: this.invertPitch ? -p : p };
  }
}

/** 右手のスロットル（縦スライダー）。ドラッグ量で相対的に動かす */
export class ThrottleSlider {
  constructor(el, fill, knob, onChange) {
    this.el = el;
    this.fill = fill;
    this.knob = knob;
    this.value = 0;
    this.onChange = onChange;
    this.pointer = null;
    let lastY = 0;
    el.addEventListener('pointerdown', (e) => {
      this.pointer = e.pointerId;
      lastY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント */ }
      el.classList.add('pressed');
      haptic(8);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointer) return;
      const h = el.getBoundingClientRect().height;
      const dy = e.clientY - lastY;
      lastY = e.clientY;
      this.set(this.value - dy / (h * 0.9), true);
      e.preventDefault();
    });
    const up = (e) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  set(v, user = false) {
    const nv = clamp(v, 0, 1);
    // 10% ごとに軽く振動
    if (user && Math.floor(nv * 10) !== Math.floor(this.value * 10)) haptic(5);
    this.value = nv;
    this.fill.style.height = `${nv * 100}%`;
    this.knob.style.bottom = `calc(${nv * 100}% - ${nv * 44}px)`;
    if (this.onChange) this.onChange(nv, user);
  }
}

/**
 * ボタン（hold / toggle / cycle / once / tap）。
 * tap は指を離した時に（ボタンの上なら）実行する。一時停止など誤タッチで困るもの用。
 */
export function bindButton(el, spec, handlers) {
  const press = (e) => {
    e.preventDefault();
    el.classList.add('pressed');
    haptic(spec.type === 'hold' ? 8 : 15);
    if (spec.type === 'hold') handlers.hold(spec.id, true);
    else if (spec.type !== 'tap') handlers.action(spec.id);
  };
  const release = (e, fire) => {
    const was = el.classList.contains('pressed');
    el.classList.remove('pressed');
    if (spec.type === 'hold') handlers.hold(spec.id, false);
    if (spec.type === 'tap' && was && fire) handlers.action(spec.id);
    if (e) e.preventDefault();
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', (e) => release(e, true));
  el.addEventListener('pointercancel', (e) => release(e, false));
  el.addEventListener('pointerleave', (e) => { if (el.classList.contains('pressed')) release(e, false); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
