// ゲームパッド（Gamepad API, 標準マッピング）
// 左スティック: ロール / ピッチ（手前に倒す＝機首上げ）  右スティック上下: スロットル増減
// LB / RB: ヨー  A / RT: 射撃・バーナー（押している間）  LT: 排気弁  B: 機体ボタン1（押し続ける種類のボタンは押している間）
// X: ミサイル  Y: 視点  Back: 早送り  Start: 一時停止
import { expoCurve } from './pipeline.js';

const DEAD = 0.12;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class GamepadInput {
  constructor({ onAction, onUi } = {}) {
    this.onAction = onAction;
    this.onUi = onUi;
    this.prev = [];
    this.state = { active: false, pitch: 0, roll: 0, yaw: 0, throttleDelta: 0, fire: false, burner: false, vent: false };
    this.primaryAction = null; // 機体ボタン1 の id（B ボタン）
    this.primaryHold = false; // 機体ボタン1 が押し続ける種類か
    this.onHold = null;
  }

  update() {
    const s = this.state;
    s.active = false; s.pitch = 0; s.roll = 0; s.yaw = 0; s.throttleDelta = 0; s.fire = false; s.burner = false; s.vent = false;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return s;
    let pads;
    try { pads = navigator.getGamepads(); } catch (e) { return s; }
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (!gp) return s;
    const ax = gp.axes || [];
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const pressedNow = (i) => btn(i) && !this.prev[i];
    s.roll = expoCurve(dz(ax[0] || 0), 0.3);
    s.pitch = expoCurve(dz(ax[1] || 0), 0.3);
    s.throttleDelta = -dz(ax[3] || 0);
    s.yaw = (btn(5) ? 1 : 0) - (btn(4) ? 1 : 0);
    s.fire = btn(0) || btn(7);
    s.burner = btn(0) || btn(7);
    s.vent = btn(6);
    s.active = Math.abs(s.roll) > 0 || Math.abs(s.pitch) > 0;
    if (this.primaryAction && this.primaryHold) {
      if (btn(1) !== !!this.prev[1] && this.onHold) this.onHold(this.primaryAction, btn(1));
    } else if (pressedNow(1) && this.primaryAction && this.onAction) this.onAction(this.primaryAction);
    if (pressedNow(2) && this.onAction) this.onAction('missile');
    if (pressedNow(3) && this.onUi) this.onUi('camera');
    if (pressedNow(9) && this.onUi) this.onUi('pause');
    if (pressedNow(8) && this.onUi) this.onUi('warp');
    this.prev = gp.buttons.map((b) => b.pressed);
    return s;
  }
}
