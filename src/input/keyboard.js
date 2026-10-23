// PC デバッグ用キーボード操作
// W/↑: 機首下げ  S/↓: 機首上げ  A/←, D/→: ロール  Q/E: ヨー  Shift/Ctrl: スロットル増減
// F: フラップ  G: ギア  X: スポイラー  B: アフターバーナー  Space: パラシュート  T: 飛行⇄走行  C: カメラ  R: 再キャリブレーション  Esc/P: 一時停止
// K / Enter: 射撃（押している間）  M: ミサイル  H: バーナー（押している間）  J: 排気弁（押している間）
import { approach } from '../sim/math.js';

const ACTION_KEYS = { KeyF: 'flaps', KeyG: 'gear', KeyX: 'spoiler', KeyB: 'ab', Space: 'deploy', KeyT: 'carMode', KeyM: 'missile' };
const UI_KEYS = { KeyC: 'camera', KeyR: 'recalibrate', Escape: 'pause', KeyP: 'pause', KeyY: 'warp' };

export class KeyboardInput {
  constructor({ onAction, onUi } = {}) {
    this.keys = new Set();
    this.pitch = 0;
    this.roll = 0;
    this.used = false;
    this.onAction = onAction;
    this.onUi = onUi;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!e.repeat) {
        if (ACTION_KEYS[e.code] && this.onAction) this.onAction(ACTION_KEYS[e.code]);
        if (UI_KEYS[e.code] && this.onUi) this.onUi(UI_KEYS[e.code]);
      }
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }
  update(dt) {
    const k = this;
    let tp = 0, tr = 0;
    if (k.has('KeyW', 'ArrowUp')) tp -= 1;
    if (k.has('KeyS', 'ArrowDown')) tp += 1;
    if (k.has('KeyA', 'ArrowLeft')) tr -= 1;
    if (k.has('KeyD', 'ArrowRight')) tr += 1;
    this.pitch = approach(this.pitch, tp, 0.12, dt);
    this.roll = approach(this.roll, tr, 0.08, dt);
    this.active = tp !== 0 || tr !== 0 || Math.abs(this.pitch) > 0.02 || Math.abs(this.roll) > 0.02;
    if (this.active) this.used = true;
    this.yaw = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    this.throttleDelta = (k.has('ShiftLeft', 'ShiftRight') ? 1 : 0) - (k.has('ControlLeft', 'ControlRight') ? 1 : 0);
    this.fire = k.has('KeyK', 'Enter', 'NumpadEnter');
    this.burner = k.has('KeyH');
    this.vent = k.has('KeyJ');
  }
}
