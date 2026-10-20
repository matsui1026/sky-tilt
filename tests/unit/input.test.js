import { describe, it, expect } from 'vitest';
import {
  deviceEulerToQuat, quatToDeviceEuler, toScreenQuat, relativeControlAngles, OrientationTracker, normalizeScreenAngle,
} from '../../src/input/orientation.js';
import { InputPipeline, lowpass, deadzone, expoCurve, applySensitivity, FULL_SCALE_DEG } from '../../src/input/pipeline.js';
import { screenPose, eventFor } from '../helpers/pose.js';

function anglesFromEvents(refEvt, curEvt, angle) {
  const qr = toScreenQuat(deviceEulerToQuat(refEvt.alpha, refEvt.beta, refEvt.gamma), angle);
  const qc = toScreenQuat(deviceEulerToQuat(curEvt.alpha, curEvt.beta, curEvt.gamma), angle);
  return relativeControlAngles(qr, qc);
}

describe('端末姿勢 → 操縦角', () => {
  it('Euler ↔ クォータニオンの往復が一致する', () => {
    const q = deviceEulerToQuat(30, 40, -20);
    const e = quatToDeviceEuler(q);
    const q2 = deviceEulerToQuat(e.alpha, e.beta, e.gamma);
    const dot = Math.abs(q.x * q2.x + q.y * q2.y + q.z * q2.z + q.w * q2.w);
    expect(dot).toBeCloseTo(1, 9);
  });

  it('screen.orientation.angle の 270 は -90 として扱う', () => {
    expect(normalizeScreenAngle(270)).toBe(-90);
    expect(normalizeScreenAngle(-90)).toBe(-90);
    expect(normalizeScreenAngle(90)).toBe(90);
  });

  it('キャリブレーション後のニュートラル姿勢で入力が 0 になる（手前に傾けた持ち方）', () => {
    for (const angle of [90, -90]) {
      for (const tilt of [20, 45, 60]) {
        const tr = new OrientationTracker();
        const e = eventFor(screenPose({ tilt }), angle);
        tr.update(e.alpha, e.beta, e.gamma, angle);
        tr.calibrate();
        const a = tr.angles();
        expect(Math.abs(a.pitch)).toBeLessThan(1e-6);
        expect(Math.abs(a.roll)).toBeLessThan(1e-6);
        const p = new InputPipeline();
        const out = p.process(a.pitch, a.roll, 1 / 60);
        expect(out.pitch).toBe(0);
        expect(out.roll).toBe(0);
      }
    }
  });

  it('ハンドルのように回す: 構えの角度によらずロール角がそのまま入り、ピッチに漏れない', () => {
    for (const angle of [90, -90]) {
      for (const tilt of [20, 45, 60]) {
        for (const steer of [-30, -10, 10, 30]) {
          const ref = eventFor(screenPose({ tilt }), angle);
          const cur = eventFor(screenPose({ tilt, steer }), angle);
          const a = anglesFromEvents(ref, cur, angle);
          expect(a.roll).toBeCloseTo(steer, 1);
          expect(Math.abs(a.pitch)).toBeLessThan(1);
        }
      }
    }
  });

  it('地面に水平な軸まわりに傾けても同じ向きのロールになる', () => {
    for (const angle of [90, -90]) {
      const ref = eventFor(screenPose({ tilt: 45 }), angle);
      const r = anglesFromEvents(ref, eventFor(screenPose({ tilt: 45, roll: 20 }), angle), angle);
      const l = anglesFromEvents(ref, eventFor(screenPose({ tilt: 45, roll: -20 }), angle), angle);
      expect(r.roll).toBeGreaterThan(15);
      expect(l.roll).toBeLessThan(-15);
    }
  });

  it('ピッチ操作はロールに漏れない', () => {
    for (const tilt of [20, 45, 60]) {
      const ref = eventFor(screenPose({ tilt }), 90);
      for (const d of [-20, 20]) {
        const a = anglesFromEvents(ref, eventFor(screenPose({ tilt, pitchDelta: d }), 90), 90);
        expect(a.pitch).toBeCloseTo(d, 1);
        expect(Math.abs(a.roll)).toBeLessThan(0.01);
      }
    }
  });

  it('キャリブレーションは直近の平均を使える（タップの揺れを拾わない）', () => {
    const tr = new OrientationTracker();
    const feed = (p, t) => { const e = eventFor(screenPose(p), 90); tr.update(e.alpha, e.beta, e.gamma, 90, t); };
    for (let i = 0; i < 15; i++) feed({ tilt: 45 }, i * 20);
    feed({ tilt: 45, steer: 8, pitchDelta: 6 }, 300); // タップの瞬間の揺れ
    tr.calibrate(300);
    feed({ tilt: 45 }, 320);
    const a = tr.angles();
    expect(Math.abs(a.roll)).toBeLessThan(1);
    expect(Math.abs(a.pitch)).toBeLessThan(1);
  });

  it('横向き 90 / -90 のどちらでも同じ傾けで同じ操作になる', () => {
    const cases = [
      { steer: 15, expectRoll: +1, expectPitch: 0 },
      { steer: -12, expectRoll: -1, expectPitch: 0 },
      { pitchDelta: 10, expectRoll: 0, expectPitch: +1 }, // 上端を手前へ引く → 機首上げ
      { pitchDelta: -10, expectRoll: 0, expectPitch: -1 },
    ];
    for (const c of cases) {
      const results = [];
      for (const angle of [90, -90]) {
        const ref = eventFor(screenPose({ tilt: 45 }), angle);
        const cur = eventFor(screenPose({ tilt: 45, steer: c.steer || 0, pitchDelta: c.pitchDelta || 0 }), angle);
        const a = anglesFromEvents(ref, cur, angle);
        results.push(a);
        if (c.expectRoll) expect(Math.sign(a.roll)).toBe(c.expectRoll);
        else expect(Math.abs(a.roll)).toBeLessThan(0.5);
        if (c.expectPitch) expect(Math.sign(a.pitch)).toBe(c.expectPitch);
        else expect(Math.abs(a.pitch)).toBeLessThan(0.5);
      }
      expect(results[0].roll).toBeCloseTo(results[1].roll, 6);
      expect(results[0].pitch).toBeCloseTo(results[1].pitch, 6);
      if (c.steer) expect(results[0].roll).toBeCloseTo(c.steer, 1);
      if (c.pitchDelta) expect(results[0].pitch).toBeCloseTo(c.pitchDelta, 1);
    }
  });

  it('画面角の補正をしないと 90 と -90 で操作が逆転する（補正の必要性の確認）', () => {
    const ref90 = eventFor(screenPose({ tilt: 45 }), 90);
    const cur90 = eventFor(screenPose({ tilt: 45, steer: 15 }), 90);
    const refm = eventFor(screenPose({ tilt: 45 }), -90);
    const curm = eventFor(screenPose({ tilt: 45, steer: 15 }), -90);
    // 誤って両方 90 として解釈した場合
    const a = anglesFromEvents(ref90, cur90, 90);
    const b = anglesFromEvents(refm, curm, 90);
    expect(Math.sign(a.pitch || a.roll)).not.toBe(0);
    expect(Math.abs(b.roll - a.roll) + Math.abs(b.pitch - a.pitch)).toBeGreaterThan(5);
  });

  it('体の向き（ヨー）を変えても入力は変化しない', () => {
    const angle = 90;
    const ref = eventFor(screenPose({ tilt: 45 }), angle);
    const cur = eventFor(screenPose({ tilt: 45, yaw: 70 }), angle);
    const a = anglesFromEvents(ref, cur, angle);
    expect(Math.abs(a.pitch)).toBeLessThan(1e-6);
    expect(Math.abs(a.roll)).toBeLessThan(1e-6);
  });

  it('再キャリブレーションで新しい持ち方が基準になる', () => {
    const tr = new OrientationTracker();
    let e = eventFor(screenPose({ tilt: 45 }), 90);
    tr.update(e.alpha, e.beta, e.gamma, 90);
    tr.calibrate();
    e = eventFor(screenPose({ tilt: 60 }), 90);
    tr.update(e.alpha, e.beta, e.gamma, 90);
    expect(tr.angles().pitch).toBeCloseTo(-15, 4);
    tr.calibrate();
    expect(Math.abs(tr.angles().pitch)).toBeLessThan(1e-6);
  });
});

describe('入力パイプライン', () => {
  it('ローパス: 時定数 τ 経過で約 63% に到達し、dt の刻み方に依存しない', () => {
    const tau = 0.1;
    let a = 0;
    for (let i = 0; i < 6; i++) a = lowpass(a, 1, 1 / 60, tau);
    expect(a).toBeCloseTo(1 - Math.exp(-1), 6);
    let b = 0;
    for (let i = 0; i < 12; i++) b = lowpass(b, 1, 1 / 120, tau);
    expect(b).toBeCloseTo(a, 9);
    expect(lowpass(0.3, 1, 1 / 60, 0)).toBe(1);
  });

  it('デッドゾーン: 範囲内は 0、範囲外は境界から連続', () => {
    expect(deadzone(1.5, 2)).toBe(0);
    expect(deadzone(-2, 2)).toBe(0);
    expect(deadzone(3, 2)).toBeCloseTo(1, 9);
    expect(deadzone(-5, 2)).toBeCloseTo(-3, 9);
    expect(deadzone(2.0001, 2)).toBeCloseTo(0.0001, 6);
  });

  it('感度: 倍率に比例しフルスケールでクランプ', () => {
    expect(applySensitivity(15, 1, 30)).toBeCloseTo(0.5, 9);
    expect(applySensitivity(15, 2, 30)).toBeCloseTo(1, 9);
    expect(applySensitivity(-90, 1, 30)).toBe(-1);
  });

  it('エクスポ: 端点は不変、中央付近は鈍く、奇関数', () => {
    expect(expoCurve(1, 0.5)).toBeCloseTo(1, 9);
    expect(expoCurve(-1, 0.5)).toBeCloseTo(-1, 9);
    expect(expoCurve(0.5, 0)).toBeCloseTo(0.5, 9);
    expect(expoCurve(0.5, 0.5)).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.125, 9);
    expect(expoCurve(0.3, 0.6)).toBeLessThan(0.3);
    expect(expoCurve(-0.3, 0.6)).toBeCloseTo(-expoCurve(0.3, 0.6), 9);
  });

  it('処理順: ローパス → デッドゾーン → 感度 → エクスポ', () => {
    const p = new InputPipeline({ smoothing: 0, deadzone: 2, sensitivity: 1, expo: 0.5 });
    const out = p.process(12, -2 - FULL_SCALE_DEG.roll * 0.5, 1 / 60);
    const pe = (12 - 2) / FULL_SCALE_DEG.pitch;
    expect(out.pitch).toBeCloseTo(0.5 * pe + 0.5 * pe ** 3, 9);
    expect(out.roll).toBeCloseTo(-(0.5 * 0.5 + 0.5 * 0.125), 9);
  });

  it('スムージングで急な変化がなまる', () => {
    const p = new InputPipeline({ smoothing: 0.1, deadzone: 0, expo: 0 });
    p.process(0, 0, 1 / 60);
    const out = p.process(25, 0, 1 / 60);
    expect(out.pitch).toBeGreaterThan(0);
    expect(out.pitch).toBeLessThan(0.3);
  });

  it('ピッチ反転オプション', () => {
    const p = new InputPipeline({ smoothing: 0, deadzone: 0, expo: 0, invertPitch: true });
    expect(p.process(10, 0, 1 / 60).pitch).toBeCloseTo(-10 / FULL_SCALE_DEG.pitch, 9);
  });
});
