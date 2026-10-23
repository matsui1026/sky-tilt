// 入力の統合: 傾き（またはバーチャルスティック）＋キーボード＋ゲームパッド＋ボタン＋スロットル
import { clamp } from '../sim/math.js';
import { TiltInput } from './tilt.js';
import { KeyboardInput } from './keyboard.js';
import { GamepadInput } from './gamepad.js';

export class InputManager {
  constructor(settings, { onAction, onUi } = {}) {
    this.tilt = new TiltInput(settings);
    this.keyboard = new KeyboardInput({ onAction, onUi });
    this.gamepad = new GamepadInput({ onAction, onUi });
    this.gamepad.onHold = (id, on) => this.hold(id, on);
    this.stick = null;
    this.mode = 'tilt'; // 'tilt' | 'stick'
    // 押している間だけ有効なボタン（ラダー、射撃、バーナー、排気弁）
    this.holds = { rudderL: false, rudderR: false, fire: false, burner: false, vent: false };
    this.throttle = 0;
    this.throttleSlider = null;
    this.out = { pitch: 0, roll: 0, yaw: 0, throttle: 0, fire: false, burner: false, vent: false };
  }

  // 旧 API との互換
  get yawHold() { return this.holds; }

  setMode(m) {
    this.mode = m;
  }

  setSettings(s) {
    this.tilt.setSettings(s);
  }

  hold(id, on) {
    if (id in this.holds) this.holds[id] = on;
  }

  releaseAll() {
    for (const k of Object.keys(this.holds)) this.holds[k] = false;
  }

  setThrottle(v, fromUser = false) {
    this.throttle = clamp(v, 0, 1);
    if (!fromUser && this.throttleSlider) this.throttleSlider.set(this.throttle, false);
  }

  calibrate(windowMs = 0) {
    this.tilt.calibrate(windowMs);
  }

  update(dt) {
    const kb = this.keyboard;
    kb.update(dt);
    const gp = this.gamepad.update(dt);
    let pitch = 0, roll = 0;
    if (this.mode === 'tilt' && this.tilt.hasData()) {
      const t = this.tilt.read(dt);
      pitch = t.pitch;
      roll = t.roll;
    } else if (this.mode === 'stick' && this.stick) {
      const v = this.stick.value();
      pitch = v.pitch;
      roll = v.roll;
    }
    if (gp.active) {
      pitch = gp.pitch;
      roll = gp.roll;
    }
    if (kb.active) {
      pitch = kb.pitch;
      roll = kb.roll;
    }
    const h = this.holds;
    let yaw = (h.rudderR ? 1 : 0) - (h.rudderL ? 1 : 0);
    if (gp.yaw) yaw = gp.yaw;
    if (kb.yaw) yaw = kb.yaw;
    if (kb.throttleDelta) this.setThrottle(this.throttle + kb.throttleDelta * 0.6 * dt);
    if (gp.throttleDelta) this.setThrottle(this.throttle + gp.throttleDelta * 0.6 * dt);
    this.out = {
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      yaw,
      throttle: this.throttle,
      fire: h.fire || kb.fire || gp.fire,
      burner: h.burner || kb.burner || gp.burner,
      vent: h.vent || kb.vent || gp.vent,
    };
    return this.out;
  }
}
