// 車の 3D モデル（オリジナルデザイン。実在の車種・メーカーの形やロゴは使わない）
// 座標: 前方 -z, 上 +y, 右 +x。原点は重心（sim の pos）。
// ドローコールを抑えるため: 車体 1、タイヤ 1（インスタンス 4）、灯火 1、炎 1。
import * as THREE from 'three';
import { P, box, cylZ, cylX, sphere, merged, MAT } from './models.js';
import { glowTexture } from './textures.js';

const DARK = 0x15181e, GLASS = 0x1c2a38, METAL = 0x8a929c, TYRE = 0x101114;

const STYLES = {
  // wheel: [x, 前の z, 後の z, 半径, 幅]。y は cg から計算
  coupe: { wheel: [0.86, -1.32, 1.28, 0.33, 0.26], flame: [[0.45, -0.1, 2.25], [-0.45, -0.1, 2.25]], lightF: [0.6, 0.05, -2.2], lightR: [0.62, 0.12, 2.2], size: 5.5 },
  rally: { wheel: [0.85, -1.25, 1.25, 0.34, 0.26], flame: [[0.5, -0.1, 2.05]], lightF: [0.55, 0.15, -2.03], lightR: [0.62, 0.3, 2.02], size: 5.5 },
  hyper: { wheel: [0.92, -1.42, 1.28, 0.35, 0.32], flame: [[0.3, 0.05, 2.32], [-0.3, 0.05, 2.32]], lightF: [0.68, 0, -2.3], lightR: [0.65, 0.12, 2.3], size: 6 },
  monster: { wheel: [1.3, -1.6, 1.6, 0.8, 0.66], flame: [[0.5, 0.1, 2.6], [-0.5, 0.1, 2.6]], lightF: [0.7, 0.75, -2.42], lightR: [0.7, 0.72, 2.42], size: 8 },
  kart: { wheel: [0.58, -0.56, 0.5, 0.13, 0.16], flame: [[0, 0.02, 0.92]], lightF: null, lightR: null, size: 2.8 },
  hover: { wheel: null, flame: [[0.5, 0.0, 2.3], [-0.5, 0.0, 2.3]], lightF: [0.55, 0.05, -2.28], lightR: [0.6, 0.12, 2.2], size: 7 },
};

function bodyParts(style, A, B) {
  switch (style) {
    case 'coupe':
      return [
        P(box(1.82, 0.42, 4.4), A, { pos: [0, -0.06, 0] }),
        P(box(1.74, 0.2, 1.5), A, { pos: [0, 0.2, -1.32], rot: [0.12, 0, 0] }),
        P(box(1.5, 0.42, 1.8), A, { pos: [0, 0.34, 0.25] }),
        P(box(1.42, 0.34, 1.86), GLASS, { pos: [0, 0.36, 0.25] }),
        P(box(1.5, 0.06, 1.1), A, { pos: [0, 0.57, 0.3] }),
        P(box(1.6, 0.18, 0.9), A, { pos: [0, 0.2, 1.75] }),
        // 太いストライプと大きなリアウイング
        P(box(0.42, 0.02, 4.42), B, { pos: [0, 0.16, 0.02] }),
        P(box(1.7, 0.05, 0.34), B, { pos: [0, 0.62, 2.0] }),
        P(box(0.06, 0.34, 0.2), DARK, { pos: [0.7, 0.45, 2.0] }),
        P(box(0.06, 0.34, 0.2), DARK, { pos: [-0.7, 0.45, 2.0] }),
        P(box(1.84, 0.1, 4.42), DARK, { pos: [0, -0.28, 0] }),
      ];
    case 'rally':
      return [
        P(box(1.84, 0.5, 4.0), A, { pos: [0, 0.02, 0] }),
        P(box(1.6, 0.56, 2.1), A, { pos: [0, 0.5, 0.25] }),
        P(box(1.52, 0.42, 2.14), GLASS, { pos: [0, 0.5, 0.25] }),
        P(box(1.56, 0.05, 1.7), A, { pos: [0, 0.79, 0.25] }),
        P(box(0.5, 0.1, 0.5), DARK, { pos: [0, 0.85, 0.0] }), // ルーフの吸気口
        P(box(1.86, 0.2, 1.2), B, { pos: [0, 0.08, 1.3] }),
        P(box(1.86, 0.03, 0.9), B, { pos: [0, 0.28, -1.4] }),
        P(box(1.5, 0.06, 0.3), B, { pos: [0, 0.85, 1.45] }),
        P(box(0.05, 0.2, 0.2), DARK, { pos: [0.6, 0.76, 1.45] }),
        P(box(0.05, 0.2, 0.2), DARK, { pos: [-0.6, 0.76, 1.45] }),
        P(box(1.3, 0.24, 0.14), DARK, { pos: [0, 0.06, -2.02] }),
        P(box(0.02, 0.3, 0.4), DARK, { pos: [0.93, -0.28, 1.0] }),
        P(box(0.02, 0.3, 0.4), DARK, { pos: [-0.93, -0.28, 1.0] }),
      ];
    case 'hyper':
      return [
        P(box(2.02, 0.3, 4.6), A, { pos: [0, -0.1, 0] }),
        P(box(1.8, 0.14, 1.6), A, { pos: [0, 0.07, -1.5], rot: [0.14, 0, 0] }),
        P(sphere(1, 16, 8), GLASS, { pos: [0, 0.2, 0.05], scale: [0.72, 0.36, 1.25] }),
        P(box(1.8, 0.28, 1.5), A, { pos: [0, 0.14, 1.45] }),
        P(box(0.6, 0.26, 2.6), B, { pos: [0, 0.18, 1.2] }),
        P(box(0.26, 0.2, 1.2), B, { pos: [1.0, 0.0, 0.1] }),
        P(box(0.26, 0.2, 1.2), B, { pos: [-1.0, 0.0, 0.1] }),
        P(box(2.0, 0.05, 0.44), B, { pos: [0, 0.5, 2.1] }),
        P(box(0.06, 0.32, 0.3), B, { pos: [0.8, 0.32, 2.05] }),
        P(box(0.06, 0.32, 0.3), B, { pos: [-0.8, 0.32, 2.05] }),
        P(box(2.0, 0.08, 0.6), DARK, { pos: [0, -0.26, -2.25] }),
      ];
    case 'monster':
      return [
        // フレーム
        P(box(1.2, 0.3, 4.2), DARK, { pos: [0, -0.2, 0] }),
        P(box(2.5, 0.12, 0.2), DARK, { pos: [0, -0.3, -1.6] }),
        P(box(2.5, 0.12, 0.2), DARK, { pos: [0, -0.3, 1.6] }),
        // 車体（ピックアップ）
        P(box(2.1, 0.7, 4.7), A, { pos: [0, 0.55, 0] }),
        P(box(1.9, 0.72, 1.7), A, { pos: [0, 1.15, -0.25] }),
        P(box(1.82, 0.56, 1.74), GLASS, { pos: [0, 1.14, -0.25] }),
        P(box(2.14, 0.14, 4.74), B, { pos: [0, 0.42, 0] }),
        P(box(1.9, 0.08, 1.4), B, { pos: [0, 1.53, -0.25] }),
        P(box(1.6, 0.3, 0.2), DARK, { pos: [0, 0.68, -2.42] }),
        // 荷台の中
        P(box(1.8, 0.1, 1.9), DARK, { pos: [0, 0.91, 1.3] }),
      ];
    case 'kart':
      return [
        P(box(0.84, 0.05, 1.6), DARK, { pos: [0, -0.14, 0] }),
        P(box(0.5, 0.12, 0.6), A, { pos: [0, -0.06, -0.72], rot: [0.12, 0, 0] }),
        P(box(1.06, 0.06, 0.1), A, { pos: [0, -0.1, -0.92] }),
        P(box(0.2, 0.12, 0.9), B, { pos: [0.46, -0.08, -0.02] }),
        P(box(0.2, 0.12, 0.9), B, { pos: [-0.46, -0.08, -0.02] }),
        P(box(0.42, 0.42, 0.1), DARK, { pos: [0, 0.1, 0.36], rot: [-0.25, 0, 0] }),
        P(box(0.38, 0.1, 0.42), DARK, { pos: [0, -0.06, 0.16] }),
        // ドライバー（ヘルメットは塗り色）
        P(box(0.34, 0.42, 0.26), 0x30364a, { pos: [0, 0.16, 0.16] }),
        P(sphere(0.15, 12, 8), A, { pos: [0, 0.48, 0.12] }),
        P(box(0.2, 0.05, 0.03), 0x101010, { pos: [0, 0.5, -0.03] }),
        P(box(0.3, 0.03, 0.03), 0x222222, { pos: [0, 0.08, -0.22] }), // ハンドル
        P(box(0.6, 0.14, 0.14), METAL, { pos: [0, -0.06, 0.72] }),
        P(box(1.1, 0.03, 0.06), METAL, { pos: [0, -0.12, 0.5] }),
        P(box(1.1, 0.03, 0.06), METAL, { pos: [0, -0.12, -0.56] }),
      ];
    case 'hover':
      return [
        P(box(2.5, 0.28, 4.2), DARK, { pos: [0, -0.5, 0] }), // スカート
        P(box(2.1, 0.46, 4.4), A, { pos: [0, -0.16, 0] }),
        P(box(1.5, 0.2, 1.2), A, { pos: [0, 0.14, -1.45], rot: [0.14, 0, 0] }),
        P(sphere(1, 16, 8), GLASS, { pos: [0, 0.22, 0.0], scale: [0.72, 0.34, 1.15] }),
        P(box(0.3, 0.08, 4.42), B, { pos: [0.72, 0.09, 0] }),
        P(box(0.3, 0.08, 4.42), B, { pos: [-0.72, 0.09, 0] }),
        P(box(0.08, 0.6, 0.7), A, { pos: [0.78, 0.36, 1.9] }),
        P(box(0.08, 0.6, 0.7), A, { pos: [-0.78, 0.36, 1.9] }),
        P(cylZ(0.34, 0.34, 0.5, 14), DARK, { pos: [0.5, 0.05, 2.1] }),
        P(cylZ(0.34, 0.34, 0.5, 14), DARK, { pos: [-0.5, 0.05, 2.1] }),
      ];
    default:
      return [P(box(1.8, 0.5, 4.2), A)];
  }
}

/** opts: { paint, night（ヘッドライトの光を出す） } */
export function buildCarModel(def, opts = {}) {
  const b = def.body || { style: 'coupe', paint: 0xcc2222, accent: 0x222222 };
  const S = STYLES[b.style] || STYLES.coupe;
  const paint = opts.paint ?? b.paint;
  const cg = def.p.cgHeight;
  const root = new THREE.Group();
  root.userData.size = S.size;
  const body = new THREE.Group();
  root.add(body);
  body.add(merged(bodyParts(b.style, paint, b.accent)));

  // タイヤ（1 ドローコール、インスタンスで 4 本）
  let wheels = null;
  const wheelPos = [];
  if (S.wheel) {
    const [wx, zf, zr, wr, ww] = S.wheel;
    const geo = merged([P(cylX(wr, ww, 16), TYRE), P(cylX(wr * 0.62, ww + 0.02, 10), METAL), P(box(ww + 0.03, wr * 1.5, wr * 0.22), 0x444a52)]).geometry;
    wheels = new THREE.InstancedMesh(geo, MAT, 4);
    wheels.frustumCulled = false;
    const wy = -cg + wr;
    wheelPos.push([wx, wy, zf, true], [-wx, wy, zf, true], [wx, wy, zr, false], [-wx, wy, zr, false]);
    root.add(wheels);
  }

  // 灯火（ブレーキで明るくなるテールランプ、ヘッドライト）
  const lightGeos = [];
  if (S.lightF) {
    const [x, y, z] = S.lightF;
    lightGeos.push(P(box(0.42, 0.1, 0.05), 0xfff4c8, { pos: [x, y, z] }), P(box(0.42, 0.1, 0.05), 0xfff4c8, { pos: [-x, y, z] }));
  }
  let tail = null;
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x701010 });
  if (S.lightR) {
    const [x, y, z] = S.lightR;
    tail = new THREE.Mesh(merged([P(box(0.5, 0.1, 0.04), 0xffffff, { pos: [x, y, z] }), P(box(0.5, 0.1, 0.04), 0xffffff, { pos: [-x, y, z] })]).geometry, tailMat);
    body.add(tail);
  }
  if (lightGeos.length) {
    const head = new THREE.Mesh(merged(lightGeos).geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
    body.add(head);
  }
  // 夜のヘッドライト: 路面の前方に光の帯（加算）
  if (opts.night && S.lightF) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 26).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xfff0c0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    beam.position.set(0, -cg + 0.16, S.lightF[2] - 11);
    root.add(beam);
  }

  // ニトロの炎
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const flameGeo = merged(S.flame.map(([x, y, z]) => P(new THREE.ConeGeometry(0.14, 1.1, 8).rotateX(-Math.PI / 2).translate(0, 0, 0.55), 0xffffff, { pos: [x, y, z] }))).geometry;
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.visible = false;
  body.add(flame);

  // ホバーのふわふわ
  const hoverGlow = b.style === 'hover'
    ? new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: b.accent, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))
    : null;
  if (hoverGlow) { hoverGlow.position.y = -cg + 0.1; root.add(hoverGlow); }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qs = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisY = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const s1 = new THREE.Vector3(1, 1, 1);
  let spin = 0;
  return {
    root,
    update(vs, dt, t) {
      // 車体の傾き（サスペンション）
      body.rotation.x = vs.bodyPitch ?? 0;
      body.rotation.z = vs.bodyRoll ?? 0;
      const fwd = vs.vx ?? (vs.speed ?? 0);
      spin = vs.spinAngle != null ? vs.spinAngle : (spin + (fwd / (S.wheel ? S.wheel[3] : 0.33)) * dt) % (Math.PI * 2);
      if (wheels) {
        for (let i = 0; i < 4; i++) {
          const [x, y, z, front] = wheelPos[i];
          // 前方が -z なので、前進でタイヤの上側が前へ回る向きは -x 軸まわり
          q.setFromAxisAngle(axisX, -spin);
          if (front) { qs.setFromAxisAngle(axisY, -(vs.steer ?? 0)); q.premultiply(qs); }
          m4.compose(v.set(x, y, z), q, s1);
          wheels.setMatrixAt(i, m4);
        }
        wheels.instanceMatrix.needsUpdate = true;
      }
      if (tail) tailMat.color.setHex((vs.brakeIn ?? 0) > 0.1 || vs.handbrake ? 0xff2a1a : 0x701010);
      const on = !!vs.nitroOn;
      flame.visible = on;
      if (on) { flame.scale.set(1 + 0.2 * Math.sin(t * 61), 1 + 0.2 * Math.sin(t * 47), 1 + 0.35 * Math.sin(t * 53)); }
      if (hoverGlow) hoverGlow.material.opacity = 0.35 + 0.2 * (vs.throttle ?? 0.2) + 0.05 * Math.sin(t * 9);
    },
  };
}
