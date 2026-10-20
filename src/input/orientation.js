// 端末姿勢（DeviceOrientationEvent）→ 操縦入力の角度。DOM 非依存の純粋関数。
//
// 地球座標系（W3C）: x=東, y=北, z=上。端末座標: ナチュラル（縦）向きで x=右, y=上, z=画面手前。
// alpha/beta/gamma は R = Rz(α)·Rx(β)·Ry(γ)（intrinsic Z-X'-Y''）。
import { DEG, RAD, qaxis, qmul, qconj, qnorm, qrot, wrapPi, clamp } from '../sim/math.js';

const AX = { x: 1, y: 0, z: 0 };
const AY = { x: 0, y: 1, z: 0 };
const AZ = { x: 0, y: 0, z: 1 };
const EARTH_UP = { x: 0, y: 0, z: 1 };

/** W3C の Euler 角（度）→ 端末→地球の回転クォータニオン */
export function deviceEulerToQuat(alpha, beta, gamma) {
  const qz = qaxis(AZ, (alpha || 0) * DEG);
  const qx = qaxis(AX, (beta || 0) * DEG);
  const qy = qaxis(AY, (gamma || 0) * DEG);
  return qnorm(qmul(qmul(qz, qx), qy));
}

/** 逆変換（テストや合成イベント用）。クォータニオン → {alpha, beta, gamma}（度） */
export function quatToDeviceEuler(q) {
  // 回転行列の必要要素
  const { x, y, z, w } = q;
  const m01 = 2 * (x * y - w * z);
  const m11 = 1 - 2 * (x * x + z * z);
  const m20 = 2 * (x * z - w * y);
  const m21 = 2 * (y * z + w * x);
  const m22 = 1 - 2 * (x * x + y * y);
  const beta = Math.asin(clamp(m21, -1, 1));
  const gamma = Math.atan2(-m20, m22);
  const alpha = Math.atan2(-m01, m11);
  let a = alpha * RAD;
  if (a < 0) a += 360;
  return { alpha: a, beta: beta * RAD, gamma: gamma * RAD };
}

/** 画面の向き（度）を正規化。90 / -90(=270) / 0 / 180 */
export function normalizeScreenAngle(angle) {
  let a = Number(angle) || 0;
  a = ((a % 360) + 360) % 360;
  return a > 180 ? a - 360 : a; // 270 → -90
}

/** 端末クォータニオンを画面座標系（x=画面右, y=画面上, z=画面手前）に補正 */
export function toScreenQuat(qDevice, screenAngleDeg) {
  const a = normalizeScreenAngle(screenAngleDeg) * DEG;
  return qnorm(qmul(qDevice, qaxis(AZ, -a)));
}

/** 画面座標系での「上」方向（重力の逆）ベクトル */
export function upInScreen(qScreen) {
  return qrot(qconj(qScreen), EARTH_UP);
}

/**
 * 画面座標系の上ベクトルから、傾きの絶対角（度）を求める。
 * bank: 画面の面内での回転（ハンドルのように回す角度）。右端が上がると正。
 *       画面が寝ているほど面内成分が小さくなるので、分母に下限を設けて水平持ちでも暴れないようにする。
 * tilt: 画面の起き具合（上ベクトルが画面の面からどれだけ手前に出ているか）。
 *       0°=垂直に立てて正対, 90°=水平に寝かせて上向き。面内の回転（bank）では変化しない。
 */
export function tiltOfUp(u) {
  return {
    bank: Math.atan2(u.x, Math.max(u.y, 0.3)) * RAD,
    tilt: Math.atan2(u.z, Math.hypot(u.x, u.y)) * RAD,
  };
}

/**
 * 基準姿勢からの相対回転として操縦角を算出する。
 * qRel = conj(qRef) ⊗ qCur（基準画面座標系で表した現在姿勢）。
 * 重力ベクトルを qRel で現在の画面座標系に移し、ピッチ・ロールを分離する。
 * 方位（ヨー）の回転は重力ベクトルを変えないので、体の向きを変えても入力は変化しない。
 * 戻り値（度）: pitch 正 = 機首上げ（画面の上端を手前に引く）, roll 正 = 右（画面の右端を下げる）
 */
export function relativeControlAngles(qRefScreen, qCurScreen) {
  const qRel = qnorm(qmul(qconj(qRefScreen), qCurScreen));
  const uRef = upInScreen(qRefScreen);
  const uCur = qrot(qconj(qRel), uRef); // 現在の画面座標系での上ベクトル
  const ref = tiltOfUp(uRef);
  const cur = tiltOfUp(uCur);
  const pitch = wrapPi((ref.tilt - cur.tilt) * DEG) * RAD;
  const roll = -(cur.bank - ref.bank);
  return { pitch, roll, qRel };
}

/** キャリブレーション状態を持つ小さなクラス */
export class OrientationTracker {
  constructor() {
    this.qRef = null;
    this.qCur = null;
    this.samples = 0;
    this.history = []; // 直近のサンプル { t, q }
  }
  /** 生のイベント値を取り込む（t: ミリ秒のタイムスタンプ） */
  update(alpha, beta, gamma, screenAngle, t = Date.now()) {
    if (beta == null || gamma == null) return false;
    this.qCur = toScreenQuat(deviceEulerToQuat(alpha || 0, beta, gamma), screenAngle);
    this.samples++;
    this.history.push({ t, q: this.qCur });
    while (this.history.length > 60 || (this.history.length > 1 && t - this.history[0].t > 1000)) this.history.shift();
    return true;
  }
  hasData() { return this.qCur != null; }
  /** 直近 windowMs ミリ秒の平均姿勢（符号をそろえて足し合わせ、正規化） */
  averageRecent(windowMs, now = this.history.length ? this.history[this.history.length - 1].t : 0) {
    const ref = this.qCur;
    let x = 0, y = 0, z = 0, w = 0, n = 0;
    for (const s of this.history) {
      if (now - s.t > windowMs) continue;
      const q = s.q;
      const sg = q.x * ref.x + q.y * ref.y + q.z * ref.z + q.w * ref.w < 0 ? -1 : 1;
      x += q.x * sg; y += q.y * sg; z += q.z * sg; w += q.w * sg;
      n++;
    }
    return n ? qnorm({ x, y, z, w }) : { ...ref };
  }
  /**
   * 現在の持ち方をニュートラルとして記録。
   * windowMs > 0 なら直近の平均を使う（タップした瞬間の揺れをニュートラルにしないため）
   */
  calibrate(windowMs = 0) {
    if (this.qCur) this.qRef = windowMs > 0 ? this.averageRecent(windowMs) : { ...this.qCur };
    return this.qRef != null;
  }
  /** 基準からの相対角（度）。未キャリブレーションなら最初のサンプルを基準にする */
  angles() {
    if (!this.qCur) return { pitch: 0, roll: 0 };
    if (!this.qRef) this.calibrate();
    const { pitch, roll } = relativeControlAngles(this.qRef, this.qCur);
    return { pitch, roll };
  }
}
