// 入力処理: ローパスフィルタ → デッドゾーン → 感度 → エクスポネンシャルカーブ（純粋ロジック）
import { clamp } from '../sim/math.js';

export const DEFAULT_INPUT_SETTINGS = Object.freeze({
  smoothing: 0.08,    // ローパスの時定数 [s]（0 で無効）
  deadzone: 2.0,      // デッドゾーン [度]
  sensitivity: 1.0,   // 感度倍率
  expo: 0.35,         // エクスポ量 0..1（0=線形）
  invertPitch: false, // ピッチ反転
});

// 感度 1.0 のとき、この角度でフル入力になる
export const FULL_SCALE_DEG = Object.freeze({ pitch: 25, roll: 30 });

/** 一次ローパス。dt に依存しない時定数で動く */
export function lowpass(prev, x, dt, tau) {
  if (!(tau > 0)) return x;
  const a = 1 - Math.exp(-dt / tau);
  return prev + (x - prev) * a;
}

/** デッドゾーン（範囲外は境界から連続に立ち上がる） */
export function deadzone(x, dz) {
  const ax = Math.abs(x);
  if (ax <= dz) return 0;
  return Math.sign(x) * (ax - dz);
}

/** 感度: 角度 → 正規化入力（±1 にクランプ） */
export function applySensitivity(deg, sensitivity, fullScaleDeg) {
  return clamp((deg * sensitivity) / fullScaleDeg, -1, 1);
}

/** エクスポネンシャルカーブ: y = (1-e)x + e x^3 */
export function expoCurve(x, e) {
  const k = clamp(e, 0, 1);
  return (1 - k) * x + k * x * x * x;
}

export class InputPipeline {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_INPUT_SETTINGS, ...settings };
    this.reset();
  }
  reset() {
    this.fPitch = 0;
    this.fRoll = 0;
    this.primed = false;
  }
  setSettings(s) {
    this.settings = { ...this.settings, ...s };
  }
  /** rawPitchDeg / rawRollDeg: 基準姿勢からの相対角（度） */
  process(rawPitchDeg, rawRollDeg, dt) {
    const s = this.settings;
    if (!this.primed) {
      this.fPitch = rawPitchDeg;
      this.fRoll = rawRollDeg;
      this.primed = true;
    } else {
      this.fPitch = lowpass(this.fPitch, rawPitchDeg, dt, s.smoothing);
      this.fRoll = lowpass(this.fRoll, rawRollDeg, dt, s.smoothing);
    }
    let p = deadzone(this.fPitch, s.deadzone);
    let r = deadzone(this.fRoll, s.deadzone);
    p = applySensitivity(p, s.sensitivity, FULL_SCALE_DEG.pitch);
    r = applySensitivity(r, s.sensitivity, FULL_SCALE_DEG.roll);
    p = expoCurve(p, s.expo);
    r = expoCurve(r, s.expo);
    if (s.invertPitch) p = -p;
    return { pitch: p, roll: r };
  }
}
