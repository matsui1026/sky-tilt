// 2 人プレイの通信内容（小さな配列にして送る）
export const STATE_HZ = 20;

const r = (v, k = 100) => Math.round(v * k) / k;

/** 自機の状態 → 送信用の配列 */
export function encodeState(t, st, vs) {
  return [
    r(t, 1000),
    r(st.pos.x), r(st.pos.y), r(st.pos.z),
    r(st.quat.x, 10000), r(st.quat.y, 10000), r(st.quat.z, 10000), r(st.quat.w, 10000),
    r(st.vel.x), r(st.vel.y), r(st.vel.z),
    r(st.throttle ?? 0, 100),
    st.status === 'crashed' ? 1 : 0,
    st.rings ? st.rings.index : -1,
    st.combat ? st.combat.health : -1,
    st.combat ? st.combat.score : -1,
    st.phase || '',
    st.carMode || '',
    r(vs.fanRpm ?? vs.rotorRpm ?? 1, 100),
    r(vs.burner ?? 0, 100),
    vs.ab ? 1 : 0,
    r(vs.gearPos ?? 1, 100),
  ];
}

/** 受信した配列 → スナップショット */
export function decodeState(a) {
  if (!Array.isArray(a) || a.length < 22) return null;
  const n = (i) => (Number.isFinite(a[i]) ? a[i] : 0);
  return {
    t: n(0),
    pos: { x: n(1), y: n(2), z: n(3) },
    q: { x: n(4), y: n(5), z: n(6), w: n(7) || 1 },
    vel: { x: n(8), y: n(9), z: n(10) },
    extra: {
      throttle: n(11), crashed: a[12] === 1, ringIndex: n(13), health: n(14), score: n(15),
      phase: typeof a[16] === 'string' ? a[16] : '', carMode: typeof a[17] === 'string' ? a[17] : '',
      rpm: n(18), burner: n(19), ab: a[20] === 1, gearPos: n(21),
    },
  };
}

/** 描画用の vs ライクな情報（モデルのアニメーション用） */
export function extraToVs(e) {
  if (!e) return {};
  return {
    throttle: e.throttle, collective: e.throttle, rotorRpm: e.rpm, fanRpm: e.rpm, burner: e.burner,
    ab: e.ab, gearPos: e.gearPos, phase: e.phase || null, deployT: 99,
  };
}
