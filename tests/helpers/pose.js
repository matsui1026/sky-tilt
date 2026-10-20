// テスト用: 「画面座標系での持ち方」から実機が送る deviceorientation の値を合成する
import { quatToDeviceEuler } from '../../src/input/orientation.js';
import { DEG, qaxis, qmul, qnorm } from '../../src/sim/math.js';

/**
 * 地球座標（x=東, y=北, z=上）。北を向いて横向きの端末を持つ。
 * tilt: 0°=画面を垂直に立てて正対, 90°=水平に寝かせて上向き（手前に傾けた自然な持ち方は 30〜60°）
 * steer: ハンドルのように画面の法線まわりに回して右端を下げる角度
 * roll: 地面に水平な前後軸（視線方向）まわりに右端を下げる角度
 * pitchDelta: 上端を手前に引く角度, yaw: 体の向き
 */
export function screenPose({ tilt = 45, steer = 0, roll = 0, pitchDelta = 0, yaw = 0 } = {}) {
  const base = qaxis({ x: 1, y: 0, z: 0 }, (90 - (tilt - pitchDelta)) * DEG);
  const steerQ = qaxis({ x: 0, y: 0, z: 1 }, -steer * DEG); // 画面座標系（機体側）で回す
  const rollQ = qaxis({ x: 0, y: 1, z: 0 }, roll * DEG);
  const yawQ = qaxis({ x: 0, y: 0, z: 1 }, yaw * DEG);
  return qnorm(qmul(yawQ, qmul(rollQ, qmul(base, steerQ))));
}

/** 画面姿勢と画面の向き（screen.orientation.angle）から alpha/beta/gamma を作る */
export function eventFor(screenQ, angle) {
  const qDev = qnorm(qmul(screenQ, qaxis({ x: 0, y: 0, z: 1 }, angle * DEG)));
  return quatToDeviceEuler(qDev);
}
