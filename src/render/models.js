// 機体の3Dモデル（プリミティブを組み合わせて頂点色で塗り、1メッシュに結合）
// 実在の航空会社の塗装・ロゴ・機種名は使わない汎用デザイン。
// 座標系: 前方 -z, 上 +y, 右 +x（sim と同じ）
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCarModel } from './carModels.js';

export const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function colorize(geo, hex) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** パーツを作って配置 */
export function P(geo, hex, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  const g = geo.clone();
  g.applyMatrix4(m);
  return colorize(g, hex);
}

export const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
/** z 軸方向の円柱（rf: 前側半径, rb: 後側半径） */
export const cylZ = (rf, rb, len, seg = 12) => new THREE.CylinderGeometry(rf, rb, len, seg).rotateX(-Math.PI / 2);
export const cylX = (r, len, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
export const sphere = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);

/** 後退翼（右翼）。root を原点、+x 方向に span */
function sweptWing(span, rootChord, tipChord, thick, sweepDeg, dihedralDeg = 0) {
  const g = new THREE.BoxGeometry(1, thick, 1, 1, 1, 1);
  const pos = g.attributes.position;
  const tanS = Math.tan((sweepDeg * Math.PI) / 180);
  const tanD = Math.tan((dihedralDeg * Math.PI) / 180);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) + 0.5; // 0..1
    const x = t * span;
    const chord = rootChord + (tipChord - rootChord) * t;
    const z = pos.getZ(i) * chord + x * tanS;
    pos.setXYZ(i, x, pos.getY(i) + x * tanD, z);
  }
  g.computeVertexNormals();
  return g;
}
const mirrorX = (g) => {
  const m = (g.index ? g.toNonIndexed() : g.clone());
  m.scale(-1, 1, 1);
  // 鏡像で裏返った三角形の巻き順を戻す（頂点 1 と 2 を入れ替え）
  for (const name of Object.keys(m.attributes)) {
    const a = m.attributes[name];
    const n = a.itemSize;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < n; c++) {
        const t = a.array[(i + 1) * n + c];
        a.array[(i + 1) * n + c] = a.array[(i + 2) * n + c];
        a.array[(i + 2) * n + c] = t;
      }
    }
  }
  m.computeVertexNormals();
  return m;
};

/** 三角翼（右側）: 平面形を XZ で与え厚みを付ける */
function deltaWing(points, thick) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape の y → z、押し出しは -y
  g.translate(0, thick / 2, 0);
  return g;
}

export function merged(parts) {
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, MAT);
  return mesh;
}

// ---------------- 小型プロペラ機 ----------------
function buildProp() {
  const W = 0xf4f4f2, R = 0xd64532, D = 0x23323f, K = 0x222222, G = 0x9a9a9a;
  const parts = [
    P(cylZ(0.62, 0.66, 3.0), W, { pos: [0, 0.05, -0.4] }),
    P(cylZ(0.64, 0.14, 4.2), W, { pos: [0, 0.15, 3.2] }),
    P(cylZ(0.36, 0.62, 1.1), R, { pos: [0, 0, -2.45] }),
    P(cylZ(0.04, 0.22, 0.45, 8), G, { pos: [0, 0, -3.2] }),
    P(box(1.32, 0.42, 1.3), D, { pos: [0, 0.38, -0.7] }),
    P(box(10.6, 0.13, 1.5), W, { pos: [0, 0.82, -0.55] }),
    P(box(1.2, 0.135, 1.52), R, { pos: [4.7, 0.82, -0.55] }),
    P(box(1.2, 0.135, 1.52), R, { pos: [-4.7, 0.82, -0.55] }),
    P(box(0.06, 0.06, 1.7), G, { pos: [1.6, 0.15, -0.3], rot: [0, 0, -0.55] }),
    P(box(0.06, 0.06, 1.7), G, { pos: [-1.6, 0.15, -0.3], rot: [0, 0, 0.55] }),
    P(box(3.6, 0.08, 0.9), W, { pos: [0, 0.2, 4.75] }),
    P(box(0.08, 1.35, 1.0), R, { pos: [0, 0.85, 4.85], rot: [-0.25, 0, 0] }),
    // 固定脚
    P(box(0.08, 0.8, 0.08), G, { pos: [0.8, -0.55, -0.1], rot: [0, 0, 0.5] }),
    P(box(0.08, 0.8, 0.08), G, { pos: [-0.8, -0.55, -0.1], rot: [0, 0, -0.5] }),
    P(cylX(0.26, 0.16), K, { pos: [1.05, -0.94, -0.1] }),
    P(cylX(0.26, 0.16), K, { pos: [-1.05, -0.94, -0.1] }),
    P(box(0.07, 0.7, 0.07), G, { pos: [0, -0.6, -2.1] }),
    P(cylX(0.22, 0.12), K, { pos: [0, -0.98, -2.1] }),
  ];
  const root = new THREE.Group();
  root.add(merged(parts));
  const prop = new THREE.Group();
  prop.position.set(0, 0, -3.35);
  const blade = new THREE.Mesh(colorize(box(0.14, 1.9, 0.05), 0x333333), MAT);
  prop.add(blade);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(disc);
  root.add(prop);
  return {
    root,
    update(vs, dt) {
      const thr = vs.throttle ?? 0;
      prop.rotation.z += dt * (8 + thr * 70);
      blade.visible = thr < 0.25;
      disc.material.opacity = 0.05 + thr * 0.2;
    },
  };
}

// ---------------- 旅客機 ----------------
function buildAirliner() {
  const W = 0xf6f7f9, B = 0x2a5fa8, L = 0xc9ced6, D = 0x1d2733, E = 0xaab2bc;
  const wingR = sweptWing(15.5, 6.2, 1.6, 0.45, 27, 5);
  const stabR = sweptWing(6, 3.2, 1.2, 0.25, 32, 4);
  const parts = [
    P(cylZ(2.0, 2.0, 28, 16), W, { pos: [0, 0, 0] }),
    P(sphere(2.0, 16, 10), W, { pos: [0, -0.05, -14], scale: [1, 0.95, 2.1] }),
    P(cylZ(2.0, 0.45, 9, 16), W, { pos: [0, 0.55, 18.5] }),
    P(box(4.06, 0.3, 26), D, { pos: [0, 0.6, -0.5] }),
    P(box(4.07, 0.28, 29), B, { pos: [0, -0.35, 0.5] }),
    P(box(3.4, 0.6, 1.6), D, { pos: [0, 0.65, -16.1], rot: [0.35, 0, 0] }),
    P(box(3.6, 1.0, 26), L, { pos: [0, -1.55, 0] }),
    P(wingR, W, { pos: [1.8, -1.2, -2.5] }),
    P(mirrorX(wingR), W, { pos: [-1.8, -1.2, -2.5] }),
    P(cylZ(1.05, 0.9, 4.2), E, { pos: [6.2, -2.4, -3.0] }),
    P(cylZ(1.05, 0.9, 4.2), E, { pos: [-6.2, -2.4, -3.0] }),
    P(cylZ(0.75, 0.75, 0.2), D, { pos: [6.2, -2.4, -5.1] }),
    P(cylZ(0.75, 0.75, 0.2), D, { pos: [-6.2, -2.4, -5.1] }),
    P(stabR, W, { pos: [0.8, 1.0, 17.0] }),
    P(mirrorX(stabR), W, { pos: [-0.8, 1.0, 17.0] }),
    P(sweptWing(7.0, 5.0, 2.0, 0.35, 38), B, { pos: [0, 1.6, 15.8], rot: [0, 0, Math.PI / 2] }),
  ];
  const root = new THREE.Group();
  root.add(merged(parts));
  const gear = new THREE.Group();
  const gparts = [];
  for (const x of [-3.2, 3.2]) {
    gparts.push(P(box(0.3, 2.4, 0.3), E, { pos: [x, -2.3, 1.5] }));
    gparts.push(P(cylX(0.6, 0.5), 0x222222, { pos: [x, -3.0, 1.0] }));
    gparts.push(P(cylX(0.6, 0.5), 0x222222, { pos: [x, -3.0, 2.0] }));
  }
  gparts.push(P(box(0.25, 2.2, 0.25), E, { pos: [0, -2.2, -11.5] }));
  gparts.push(P(cylX(0.45, 0.5), 0x222222, { pos: [0, -3.15, -11.5] }));
  gear.add(merged(gparts));
  root.add(gear);
  return {
    root,
    update(vs) {
      const gp = vs.gearPos ?? 1;
      gear.visible = gp > 0.02;
      gear.scale.y = Math.max(0.05, gp);
      gear.position.y = (1 - gp) * 1.5;
    },
  };
}

// ---------------- 戦闘機 ----------------
function buildFighter() {
  const G = 0x8d959e, D = 0x5c636b, C = 0x29414f, K = 0x2b2b2b;
  const wingR = deltaWing([[0.8, -2.2], [5.2, 2.6], [5.2, 3.4], [0.8, 4.0]], 0.22);
  const stabR = deltaWing([[0.7, 5.4], [3.0, 7.2], [3.0, 7.8], [0.7, 7.9]], 0.16);
  const finR = deltaWing([[0, 4.0], [2.6, 6.6], [2.6, 7.3], [0, 7.4]], 0.14);
  const parts = [
    P(cylZ(0.95, 1.1, 9, 14), G, { pos: [0, 0, 0.5] }),
    P(cylZ(0.04, 0.95, 4.8, 14), G, { pos: [0, 0, -6.4] }),
    P(cylZ(1.1, 0.85, 3.0, 14), D, { pos: [0, 0, 6.5] }),
    P(cylZ(0.8, 0.7, 1.0, 14), K, { pos: [0, 0, 8.4] }),
    P(sphere(0.75, 14, 10), C, { pos: [0, 0.78, -3.0], scale: [0.8, 0.75, 2.3] }),
    P(box(0.9, 0.9, 4.2), D, { pos: [1.35, -0.2, -0.2] }),
    P(box(0.9, 0.9, 4.2), D, { pos: [-1.35, -0.2, -0.2] }),
    P(wingR, G, { pos: [0, -0.1, 0] }),
    P(mirrorX(wingR), G, { pos: [0, -0.1, 0] }),
    P(stabR, D, { pos: [0, -0.05, 0] }),
    P(mirrorX(stabR), D, { pos: [0, -0.05, 0] }),
    P(finR, D, { pos: [1.0, 0.7, 0], rot: [0, 0, Math.PI / 2 - 0.25] }),
    P(mirrorX(finR), D, { pos: [-1.0, 0.7, 0], rot: [0, 0, -(Math.PI / 2 - 0.25)] }),
  ];
  const root = new THREE.Group();
  root.add(merged(parts));
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.62, 4.5, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 2.25), flameMat);
  flame.position.set(0, 0, 8.9);
  root.add(flame);
  const gear = new THREE.Group();
  const gp = [];
  for (const x of [-1.5, 1.5]) {
    gp.push(P(box(0.15, 1.4, 0.15), 0x777777, { pos: [x, -1.2, 1.2] }));
    gp.push(P(cylX(0.4, 0.3), K, { pos: [x, -1.55, 1.2] }));
  }
  gp.push(P(box(0.12, 1.3, 0.12), 0x777777, { pos: [0, -1.15, -4.5] }));
  gp.push(P(cylX(0.32, 0.25), K, { pos: [0, -1.6, -4.5] }));
  gear.add(merged(gp));
  root.add(gear);
  return {
    root,
    update(vs, dt, t) {
      const thr = vs.throttle ?? 0;
      const ab = vs.ab;
      flame.visible = thr > 0.6 || ab;
      const k = ab ? 1.0 + 0.15 * Math.sin(t * 40) : Math.max(0, (thr - 0.6) / 0.4) * 0.35;
      flame.scale.set(ab ? 1 : 0.7, ab ? 1 : 0.7, k + 0.01);
      flameMat.color.setHex(ab ? 0xff7a2a : 0x6fa8ff);
      const g2 = vs.gearPos ?? 1;
      gear.visible = g2 > 0.02;
      gear.scale.y = Math.max(0.05, g2);
    },
  };
}

// ---------------- ヘリ ----------------
function buildHeli() {
  const O = 0xd8572a, D = 0x2a3440, K = 0x333333, W = 0xf0f0f0;
  const parts = [
    P(sphere(1.0, 16, 12), O, { pos: [0, 0.35, -0.4], scale: [1.35, 1.25, 2.3] }),
    P(sphere(1.0, 14, 10), D, { pos: [0, 0.55, -1.6], scale: [1.2, 0.95, 1.2] }),
    P(cylZ(0.38, 0.16, 6.2, 10), O, { pos: [0, 0.6, 4.3] }),
    P(box(0.12, 1.5, 0.9), O, { pos: [0, 1.25, 7.3], rot: [-0.3, 0, 0] }),
    P(box(1.8, 0.08, 0.5), W, { pos: [0, 0.7, 6.0] }),
    P(cylZ(0.07, 0.07, 3.8, 6), K, { pos: [1.1, -1.15, -0.2] }),
    P(cylZ(0.07, 0.07, 3.8, 6), K, { pos: [-1.1, -1.15, -0.2] }),
    P(box(0.07, 0.75, 0.07), K, { pos: [0.95, -0.8, -1.0], rot: [0, 0, 0.3] }),
    P(box(0.07, 0.75, 0.07), K, { pos: [-0.95, -0.8, -1.0], rot: [0, 0, -0.3] }),
    P(box(0.07, 0.75, 0.07), K, { pos: [0.95, -0.8, 0.7], rot: [0, 0, 0.3] }),
    P(box(0.07, 0.75, 0.07), K, { pos: [-0.95, -0.8, 0.7], rot: [0, 0, -0.3] }),
    P(cylZ(0.25, 0.25, 0.5, 8).rotateX(Math.PI / 2), K, { pos: [0, 1.25, -0.2] }),
  ];
  const root = new THREE.Group();
  root.add(merged(parts));
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.45, -0.2);
  const bl = [];
  for (let i = 0; i < 4; i++) bl.push(P(box(5.4, 0.05, 0.32), K, { pos: [Math.cos((i * Math.PI) / 2) * 2.75, 0, Math.sin((i * Math.PI) / 2) * 2.75], rot: [0, -(i * Math.PI) / 2, 0] }));
  rotor.add(merged(bl));
  const rdisc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  rotor.add(rdisc);
  root.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(0.18, 1.3, 7.35);
  tail.add(merged([P(box(0.04, 1.4, 0.15), K), P(box(0.04, 0.15, 1.4), K)]));
  root.add(tail);
  return {
    root,
    update(vs, dt) {
      const rpm = vs.rotorRpm ?? 1;
      rotor.rotation.y += dt * 30 * rpm;
      tail.rotation.x += dt * 90 * rpm;
      rdisc.material.opacity = 0.04 + 0.1 * rpm;
    },
  };
}

// ---------------- 人体 ----------------
function humanParts({ suit = 0x2f3a4a, skin = 0xe0b89a, spread = 0, armUp = 0, wing = null } = {}) {
  // 直立姿勢（+y が頭、-z が顔の向き）
  const parts = [
    P(box(0.44, 0.62, 0.26), suit, { pos: [0, 0.25, 0] }),
    P(sphere(0.14, 10, 8), 0xf2f2f2, { pos: [0, 0.73, 0] }),
    P(box(0.2, 0.08, 0.05), 0x223344, { pos: [0, 0.74, -0.12] }),
  ];
  const armA = 0.25 + spread * 1.1 + armUp;
  for (const s of [-1, 1]) {
    parts.push(P(box(0.11, 0.6, 0.11), suit, { pos: [s * (0.27 + Math.sin(armA) * 0.3), 0.5 - Math.cos(armA) * 0.3, 0], rot: [0, 0, s * armA] }));
    const legA = 0.05 + spread * 0.45;
    parts.push(P(box(0.15, 0.85, 0.15), suit, { pos: [s * (0.12 + Math.sin(legA) * 0.42), -0.48, 0], rot: [0, 0, s * legA] }));
  }
  if (wing) {
    // 腕と体の間・脚の間の膜
    for (const s of [-1, 1]) {
      parts.push(P(box(0.62, 0.7, 0.03), wing, { pos: [s * 0.5, 0.35, 0.02], rot: [0, 0, s * 0.35] }));
    }
    parts.push(P(box(0.55, 0.75, 0.03), wing, { pos: [0, -0.5, 0.02] }));
  }
  return parts;
}

function canopyRig(colors = [0xff5533, 0xffcc33, 0x33aaff], span = 7, cells = 7, height = 5.5, arc = 0.9) {
  const g = new THREE.Group();
  const parts = [];
  const R = span / (2 * Math.sin(arc / 2));
  const lineTargets = [];
  for (let i = 0; i < cells; i++) {
    const a = -arc / 2 + (arc * (i + 0.5)) / cells;
    const x = Math.sin(a) * R;
    const y = height + (Math.cos(a) * R - R);
    parts.push(P(box(span / cells * 1.02, 0.28, 2.6), colors[i % colors.length], { pos: [x, y, 0], rot: [0, 0, -a] }));
    lineTargets.push([x * 0.95, y - 0.1, -0.9], [x * 0.95, y - 0.1, 0.9]);
  }
  g.add(merged(parts));
  const lp = [];
  for (const t of lineTargets) lp.push(0, 0.55, 0, ...t);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 })));
  return g;
}

function buildParaglider() {
  const root = new THREE.Group();
  const pilot = merged([...humanParts({ suit: 0x3a4f2a }), P(box(0.5, 0.35, 0.7), 0x222222, { pos: [0, -0.15, 0.1] })]);
  root.add(pilot);
  const canopy = canopyRig([0xff5533, 0xffffff, 0x2a7fff], 10.5, 11, 7.2, 1.6);
  root.add(canopy);
  return { root, update() {} };
}

function buildJetsuit() {
  const root = new THREE.Group();
  const parts = humanParts({ suit: 0x22262c, armUp: -0.15 });
  parts.push(P(box(0.36, 0.5, 0.22), 0x666b72, { pos: [0, 0.3, 0.24] }));
  for (const s of [-1, 1]) {
    parts.push(P(cylZ(0.07, 0.07, 0.35, 8).rotateX(Math.PI / 2), 0x9aa0a8, { pos: [s * 0.36, 0.1, -0.05] }));
    parts.push(P(cylZ(0.06, 0.06, 0.3, 8).rotateX(Math.PI / 2), 0x9aa0a8, { pos: [s * 0.13, 0.12, 0.3] }));
  }
  root.add(merged(parts));
  const fm = new THREE.MeshBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  const fg = new THREE.ConeGeometry(0.07, 1, 8, 1, true).rotateX(Math.PI).translate(0, -0.5, 0);
  for (const [x, z] of [[-0.36, -0.05], [0.36, -0.05], [-0.13, 0.3], [0.13, 0.3]]) {
    const f = new THREE.Mesh(fg, fm);
    f.position.set(x, -0.08, z);
    root.add(f);
    flames.push(f);
  }
  return {
    root,
    update(vs, dt, t) {
      const thr = vs.throttle ?? 0;
      for (const f of flames) {
        f.visible = thr > 0.02;
        f.scale.set(1, 0.2 + thr * 1.4 * (1 + 0.1 * Math.sin(t * 50)), 1);
      }
    },
  };
}

function buildHuman(def) {
  const root = new THREE.Group();
  const wingsuit = def.id === 'wingsuit';
  const flatGeo = mergeGeometries(humanParts({ suit: wingsuit ? 0x1f2a3a : 0xc0392b, spread: wingsuit ? 0.6 : 1, armUp: wingsuit ? 0.2 : 0.4, wing: wingsuit ? 0xff8c1a : null }), false);
  flatGeo.rotateX(-Math.PI / 2); // 頭を前方、腹を下に
  const flat = new THREE.Mesh(flatGeo, MAT);
  root.add(flat);
  const upright = new THREE.Group();
  upright.add(merged(humanParts({ suit: wingsuit ? 0x1f2a3a : 0xc0392b })));
  const canopy = canopyRig([0x2a7fff, 0xffffff, 0xff3355], 7.2, 7, 5.6, 0.95);
  upright.add(canopy);
  root.add(upright);
  return {
    root,
    update(vs) {
      const ph = vs.phase;
      const under = ph === 'canopy' || ph === 'deploying' || ph === 'landed';
      flat.visible = !under || (ph === 'deploying' && vs.deployT < 0.6);
      upright.visible = under && !(ph === 'deploying' && vs.deployT < 0.6);
      if (ph === 'deploying') {
        const f = Math.min(1, vs.deployT / (def.p.deployTime || 2.5));
        canopy.scale.set(0.2 + 0.8 * f, 0.3 + 0.7 * f, 0.2 + 0.8 * f);
      } else canopy.scale.set(1, 1, 1);
      canopy.visible = ph !== 'landed';
    },
  };
}

// ---------------- グライダー ----------------
function buildSailplane() {
  const W = 0xf7f7f7, R = 0x2f7de0, D = 0x23323f, K = 0x333333;
  const wingR = sweptWing(8.5, 1.1, 0.45, 0.12, 2, 3);
  const parts = [
    P(cylZ(0.42, 0.5, 2.6, 12), W, { pos: [0, 0, -1.6] }),
    P(sphere(0.42, 12, 8), W, { pos: [0, 0, -2.9], scale: [1, 1, 1.6] }),
    P(cylZ(0.5, 0.1, 5.2, 10), W, { pos: [0, 0.05, 2.3] }),
    P(sphere(0.4, 12, 8), D, { pos: [0, 0.3, -2.1], scale: [0.85, 0.6, 2.0] }),
    P(wingR, W, { pos: [0.3, 0.35, -0.9] }),
    P(mirrorX(wingR), W, { pos: [-0.3, 0.35, -0.9] }),
    P(box(1.0, 0.13, 0.32), R, { pos: [8.5, 0.82, -0.75] }),
    P(box(1.0, 0.13, 0.32), R, { pos: [-8.5, 0.82, -0.75] }),
    P(box(0.08, 1.3, 0.9), R, { pos: [0, 0.7, 4.6], rot: [-0.3, 0, 0] }),
    P(box(2.6, 0.06, 0.55), W, { pos: [0, 1.35, 4.85] }),
    P(cylX(0.22, 0.12), K, { pos: [0, -0.5, -0.9] }),
  ];
  const root = new THREE.Group();
  root.add(merged(parts));
  return { root, update() {} };
}

// ---------------- ドローン ----------------
function buildDrone() {
  const K = 0x22262b, O = 0xff6a1a, G = 0x7a8590;
  const parts = [
    P(box(0.14, 0.05, 0.22), K, { pos: [0, 0, 0] }),
    P(box(0.09, 0.04, 0.06), O, { pos: [0, 0.035, -0.09] }),
    P(box(0.04, 0.03, 0.03), 0x111111, { pos: [0, 0.02, -0.125] }),
  ];
  const arms = [[0.11, -0.11], [-0.11, -0.11], [0.11, 0.11], [-0.11, 0.11]];
  for (const [x, z] of arms) {
    parts.push(P(box(0.025, 0.015, 0.17), G, { pos: [x / 2, 0, z / 2], rot: [0, Math.atan2(x, z), 0] }));
    parts.push(P(cylZ(0.022, 0.022, 0.03, 8).rotateX(Math.PI / 2), K, { pos: [x, 0.02, z] }));
  }
  const root = new THREE.Group();
  root.add(merged(parts));
  const props = [];
  const discMat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
  for (const [x, z] of arms) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.065, 16).rotateX(-Math.PI / 2), discMat);
    d.position.set(x, 0.04, z);
    root.add(d);
    props.push(d);
  }
  return {
    root,
    update(vs) {
      discMat.opacity = 0.08 + 0.3 * (vs.rotorRpm ?? 1) * (0.4 + (vs.collective ?? 0.5));
    },
  };
}

// ---------------- 空飛ぶスポーツカー（オリジナルデザイン） ----------------
function buildFlycar(paint) {
  const R = paint ?? 0xc8102e, D = 0x1a1f26, G = 0x8a929c, L = 0xfff2c0, T = 0xff3030;
  const parts = [
    P(box(1.9, 0.42, 4.3), R, { pos: [0, 0.02, 0] }),
    P(box(1.86, 0.16, 1.5), R, { pos: [0, 0.26, -1.45], rot: [0.16, 0, 0] }),
    P(sphere(1, 16, 10), 0x2a3a4a, { pos: [0, 0.36, 0.25], scale: [0.72, 0.3, 1.0] }),
    P(box(1.8, 0.05, 0.9), D, { pos: [0, 0.3, -0.75], rot: [0.35, 0, 0] }),
    P(box(1.92, 0.12, 1.2), R, { pos: [0, 0.38, 1.5], rot: [-0.1, 0, 0] }),
    P(box(1.6, 0.06, 0.3), D, { pos: [0, 0.48, 2.1] }),
    P(box(0.5, 0.08, 0.06), L, { pos: [0.62, 0.12, -2.16] }),
    P(box(0.5, 0.08, 0.06), L, { pos: [-0.62, 0.12, -2.16] }),
    P(box(1.6, 0.06, 0.05), T, { pos: [0, 0.2, 2.16] }),
  ];
  // ホイール
  for (const [x, z] of [[0.92, -1.35], [-0.92, -1.35], [0.92, 1.35], [-0.92, 1.35]]) {
    parts.push(P(cylX(0.34, 0.26, 14), 0x111111, { pos: [x, -0.21, z] }));
    parts.push(P(cylX(0.2, 0.27, 10), G, { pos: [x, -0.21, z] }));
  }
  const root = new THREE.Group();
  root.add(merged(parts));
  // ダクトファン（飛行モードで車体の外へ展開）
  const fans = [];
  const ductGeo = merged([P(new THREE.TorusGeometry(0.42, 0.07, 6, 18).rotateX(Math.PI / 2), D), P(box(0.8, 0.03, 0.05), G)]).geometry;
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (const [x, z] of [[1.0, -1.35], [-1.0, -1.35], [1.0, 1.35], [-1.0, 1.35]]) {
    const g = new THREE.Group();
    const duct = new THREE.Mesh(ductGeo, MAT);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 18).rotateX(Math.PI / 2), glowMat);
    glow.position.y = -0.05;
    g.add(duct, glow);
    g.userData = { x, z };
    root.add(g);
    fans.push(g);
  }
  return {
    root,
    update(vs, dt, t) {
      const k = vs.fanRpm ?? 0;
      for (const f of fans) {
        const { x, z } = f.userData;
        f.position.set(x * (0.75 + 0.55 * k), 0.15 + 0.1 * k, z);
        f.rotation.z = (x > 0 ? -1 : 1) * 0.3 * k;
        f.visible = k > 0.05;
        f.children[1].rotation.y += dt * 40;
      }
      glowMat.opacity = k * (0.15 + 0.5 * (vs.throttle ?? 0)) * (1 + 0.1 * Math.sin(t * 30));
    },
  };
}

// ---------------- 熱気球 ----------------
function buildBalloon() {
  const root = new THREE.Group();
  // 球皮: 縦縞のゴア（頂点色）
  const geo = new THREE.SphereGeometry(8.5, 24, 16);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const palette = [new THREE.Color(0xff4d2e), new THREE.Color(0xffd23a), new THREE.Color(0x2fa3ff), new THREE.Color(0xffffff)];
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    // 下すぼまりの形
    const k = y < 0 ? 0.55 + 0.45 * (1 + y / 8.5) : 1;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
    if (y < 0) pos.setY(i, y * 1.25);
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const c = palette[Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 12) % palette.length];
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const env = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  env.position.y = 16.5;
  root.add(env);
  const parts = [
    P(box(1.3, 1.0, 1.3), 0x8a5a2b, { pos: [0, 0, 0] }),
    P(box(1.36, 0.12, 1.36), 0x5a3a1b, { pos: [0, 0.5, 0] }),
    P(cylZ(0.12, 0.12, 0.5, 8).rotateX(Math.PI / 2), 0x666666, { pos: [0, 1.6, 0] }),
  ];
  for (const [x, z] of [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) parts.push(P(box(0.03, 6.2, 0.03), 0x333333, { pos: [x * 2.3, 3.6, z * 2.3], rot: [z * -0.38, 0, x * 0.38] }));
  root.add(merged(parts));
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 10, 1, true).translate(0, 1.1, 0), flameMat);
  flame.position.y = 1.8;
  root.add(flame);
  return {
    root,
    update(vs, dt, t) {
      const b = vs.burner ?? 0;
      flame.visible = b > 0.05;
      flame.scale.set(1, 0.4 + b * 1.4 * (1 + 0.15 * Math.sin(t * 37)), 1);
    },
  };
}

/** opts: { paint（車の塗り色）, night（ヘッドライト） } */
export function buildVehicleModel(def, opts = {}) {
  if (def.model === 'car') return buildCarModel(def, opts);
  switch (def.id) {
    case 'prop': return buildProp();
    case 'airliner': return buildAirliner();
    case 'fighter': return buildFighter();
    case 'sailplane': return buildSailplane();
    case 'heli': return buildHeli();
    case 'drone': return buildDrone();
    case 'flycar': return buildFlycar(opts.paint);
    case 'balloon': return buildBalloon();
    case 'paraglider': return buildParaglider();
    case 'jetsuit': return buildJetsuit();
    default: return buildHuman(def);
  }
}

// ---------------- 敵機・的（射撃モード） ----------------
export function buildEnemyModel(type) {
  if (type === 'drone') {
    const parts = [P(box(1.4, 0.4, 1.4), 0x3a3f46), P(sphere(0.45, 10, 8), 0xff3030, { pos: [0, -0.3, -0.5] })];
    for (const [x, z] of [[1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]]) {
      parts.push(P(box(0.12, 0.1, 1.6), 0x2a2e33, { pos: [x / 2, 0, z / 2], rot: [0, Math.atan2(x, z), 0] }));
      parts.push(P(cylZ(0.6, 0.6, 0.06, 12).rotateX(Math.PI / 2), 0x555555, { pos: [x, 0.25, z] }));
    }
    const m = merged(parts);
    m.scale.setScalar(1.6);
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  // 敵の飛行機: 黒と赤の無人機（オリジナル）
  const D = 0x2b2f36, Rr = 0xd23030;
  const wingR = deltaWing([[0.4, -1.2], [4.2, 1.6], [4.2, 2.3], [0.4, 2.6]], 0.18);
  const parts = [
    P(cylZ(0.05, 0.8, 4, 12), D, { pos: [0, 0, -4] }),
    P(cylZ(0.8, 0.6, 6, 12), D, { pos: [0, 0, 1] }),
    P(wingR, D, {}),
    P(mirrorX(wingR), D, {}),
    P(box(0.12, 1.6, 1.4), Rr, { pos: [0, 0.9, 3.4], rot: [-0.4, 0, 0] }),
    P(box(1.2, 0.2, 0.6), Rr, { pos: [0, 0, -2.2] }),
  ];
  const g = new THREE.Group();
  g.add(merged(parts));
  return g;
}
