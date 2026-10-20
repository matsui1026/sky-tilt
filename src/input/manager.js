// 入力の統合: 傾き（またはバーチャルスティック）＋キーボード＋ボタン＋スロットル
import { clamp } from '../sim/math.js';
import { TiltInput } from './tilt.js';
import { KeyboardInput } from './keyboard.js';

export class InputManager {
  constructor(settings, { onAction, onUi } = {}) {
    this.tilt = new TiltInput(settings);
    this.keyboard = new KeyboardInput({ onAction, onUi });
    this.stick = null;
    this.mode = 'tilt'; // 'tilt' | 'stick'
    this.yawHold = { rudderL: false, rudderR: false };
    this.throttle = 0;
    this.throttleSlider = null;
    this.out = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
  }

  setMode(m) {
    this.mode = m;
  }

  setSettings(s) {
    this.tilt.setSettings(s);
  }

  hold(id, on) {
    if (id in this.yawHold) this.yawHold[id] = on;
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
    if (kb.active) {
      pitch = kb.pitch;
      roll = kb.roll;
    }
    let yaw = (this.yawHold.rudderR ? 1 : 0) - (this.yawHold.rudderL ? 1 : 0);
    if (kb.yaw) yaw = kb.yaw;
    if (kb.throttleDelta) this.setThrottle(this.throttle + kb.throttleDelta * 0.6 * dt);
    this.out = { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), yaw, throttle: this.throttle };
    return this.out;
  }
}
