// 演出: スピードライン、リング、影、カメラ（コックピット / 後方追従 / 外部）
import * as THREE from 'three';
import { blobTexture } from './textures.js';
import { mulberry32, clamp } from '../sim/math.js';

/** カメラ空間に置くスピードライン（1 ドローコール） */
export function createSpeedLines() {
  const N = 90;
  const rnd = mulberry32(7);
  const seeds = [];
  const pos = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2.2 + rnd() * 5;
    seeds.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, z: -rnd() * 60, len: 2 + rnd() * 5 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  lines.name = 'speedLines';
  return {
    object: lines,
    update(dt, speed, intensity) {
      mat.opacity = intensity * 0.45;
      lines.visible = intensity > 0.01;
      if (!lines.visible) return;
      const a = geo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        s.z += speed * dt * 0.5;
        if (s.z > 0) s.z -= 60;
        const len = s.len * (0.5 + intensity * 2);
        a[i * 6] = s.x; a[i * 6 + 1] = s.y; a[i * 6 + 2] = s.z;
        a[i * 6 + 3] = s.x; a[i * 6 + 4] = s.y; a[i * 6 + 5] = s.z - len;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/** 数字のスプライト用テクスチャ */
function numberTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 72px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * リングコースの描画。見やすさと距離感のために:
 * - 太く光るリング（次のリングは緑で点滅し、膜と外側の光輪つき）
 * - 番号の札、地面まで下ろした支柱と地面の影（高さと距離の手がかり）
 * - 次のリング以降をつなぐ案内線
 */
export function createRings(rings, world) {
  const group = new THREE.Group();
  group.name = 'rings';
  const terr = world ? world.terrain : null;
  const items = rings.map((r, i) => {
    const g = new THREE.Group();
    g.position.set(r.pos.x, r.pos.y, r.pos.z);
    const orient = new THREE.Object3D();
    orient.lookAt(r.normal.x, r.normal.y, r.normal.z);
    const tube = Math.max(0.8, r.radius * 0.1);
    const torus = new THREE.Mesh(new THREE.TorusGeometry(r.radius, tube, 10, 48), new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.9, fog: false }));
    torus.quaternion.copy(orient.quaternion);
    g.add(torus);
    // 外側の光輪（遠くからでも見える）
    const halo = new THREE.Mesh(new THREE.TorusGeometry(r.radius, tube * 3.2, 8, 48), new THREE.MeshBasicMaterial({ color: 0x3affb0, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.quaternion.copy(orient.quaternion);
    g.add(halo);
    // 通過面の薄い膜
    const film = new THREE.Mesh(new THREE.CircleGeometry(r.radius * 0.97, 40), new THREE.MeshBasicMaterial({ color: 0x3affb0, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    film.quaternion.copy(orient.quaternion);
    g.add(film);
    // 番号
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(i + 1), depthWrite: false, fog: false, transparent: true }));
    sprite.scale.setScalar(Math.max(6, r.radius * 0.7));
    sprite.position.set(0, r.radius + tube + sprite.scale.y * 0.6, 0);
    g.add(sprite);
    group.add(g);
    // 支柱と地面の影
    let pole = null, shadow = null;
    if (terr && r.normal.y > -0.9) {
      const gy = Math.max(terr.surfaceAt(r.pos.x, r.pos.z), terr.roofAt(r.pos.x, r.pos.z));
      const h = r.pos.y - r.radius - gy;
      if (h > 2) {
        pole = new THREE.Mesh(new THREE.CylinderGeometry(tube * 0.35, tube * 0.35, h, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
        pole.position.set(r.pos.x, gy + h / 2, r.pos.z);
        group.add(pole);
      }
      shadow = new THREE.Mesh(new THREE.RingGeometry(r.radius * 0.8, r.radius * 1.1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
      shadow.position.set(r.pos.x, gy + 0.3, r.pos.z);
      group.add(shadow);
    }
    return { g, torus, halo, film, sprite, pole, shadow };
  });
  // 案内線（次のリングから先へ）
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(2, rings.length) * 3), 3));
  const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 12, gapSize: 10, transparent: true, opacity: 0.55, fog: false }));
  line.frustumCulled = false;
  group.add(line);
  let lastIdx = -1;
  return {
    group,
    update(state, t) {
      const idx = state.rings ? state.rings.index : 0;
      items.forEach((it, i) => {
        const vis = i >= idx && i < idx + 5;
        it.g.visible = vis;
        if (it.pole) it.pole.visible = vis;
        if (it.shadow) it.shadow.visible = vis;
        if (!vis) return;
        const next = i === idx;
        it.torus.material.color.setHex(next ? 0x3affb0 : 0xffc23a);
        it.torus.material.opacity = next ? 0.8 + 0.2 * Math.sin(t * 6) : 0.6 - (i - idx) * 0.08;
        it.halo.visible = next;
        it.halo.material.opacity = 0.14 + 0.1 * Math.sin(t * 6);
        it.film.visible = next;
        it.sprite.material.opacity = next ? 1 : 0.6;
      });
      if (idx !== lastIdx) {
        lastIdx = idx;
        const arr = lineGeo.attributes.position.array;
        let n = 0;
        for (let i = idx; i < rings.length; i++) { arr[n * 3] = rings[i].pos.x; arr[n * 3 + 1] = rings[i].pos.y; arr[n * 3 + 2] = rings[i].pos.z; n++; }
        lineGeo.setDrawRange(0, n);
        lineGeo.attributes.position.needsUpdate = true;
        line.computeLineDistances();
        line.visible = n >= 2;
      }
    },
  };
}

export function createShadow() {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'shadow';
  m.renderOrder = 2;
  return m;
}

/** カメラの制御 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.q = new THREE.Quaternion();
    this.pos = new THREE.Vector3();
    this.orbit = 0;
    this.fov = 70;
    this.shakeT = 0;
    this.initialized = false;
    this.impulse = 0;
  }
  setMode(m) {
    this.mode = m;
    this.initialized = false;
  }
  bump(k) {
    this.impulse = Math.max(this.impulse, k);
  }
  update(dt, def, vq, vpos, info) {
    const cam = this.camera;
    const C = def.camera;
    const tmpQ = new THREE.Quaternion();
    // 人や回転翼は水平を保った追従（酔いにくい）、固定翼は姿勢に追従
    const heading = info.heading;
    const levelQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
    let followQ;
    const isCar = def.model === 'car' || (def.model === 'flycar' && info.carMode !== 'fly');
    if (isCar) {
      // 車: 進む向きへ少し寄せて、ドリフト中は車体の横が見える。路面の上り下りに少し追従
      const yaw = heading + clamp(info.beta || 0, -0.9, 0.9) * 0.55;
      followQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), info.pitch * 0.6));
    } else if (def.model === 'fixedwing') {
      followQ = vq.clone();
      // ロールは半分だけ追従
      followQ.slerp(levelQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), info.pitch * 0.9)), 0.45);
    } else {
      followQ = levelQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), clamp(info.flightPath, -1.2, 0.6) * 0.6));
    }
    if (!this.initialized) {
      this.q.copy(followQ);
      this.orbit = heading + Math.PI * 0.75;
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt / (def.model === 'fixedwing' ? 0.12 : isCar ? 0.16 : 0.35));
    this.q.slerp(followQ, k);

    if (this.mode === 'cockpit') {
      const off = new THREE.Vector3(...C.cockpit).applyQuaternion(vq);
      cam.position.copy(vpos).add(off);
      if (def.model === 'human' && (info.phase === 'freefall' || info.phase === 'wingsuit')) {
        // うつ伏せの視点: 少し下を見る
        cam.quaternion.copy(vq).multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.35));
      } else if (def.model === 'paraglider' || (def.model === 'human')) {
        cam.quaternion.copy(levelQ).multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -info.roll * 0.7)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.25));
      } else {
        cam.quaternion.copy(vq);
      }
      cam.near = 0.15;
    } else if (this.mode === 'external') {
      this.orbit += dt * 0.12;
      const d = C.chaseDist * 1.7;
      cam.position.set(vpos.x + Math.sin(this.orbit) * d, vpos.y + C.chaseHeight * 1.2 + d * 0.15, vpos.z - Math.cos(this.orbit) * d);
      if (cam.position.y < info.ground + 2) cam.position.y = info.ground + 2;
      cam.up.set(0, 1, 0);
      cam.lookAt(vpos);
      cam.near = 0.5;
    } else {
      const ds = this.distScale ?? 1;
      const back = new THREE.Vector3(0, C.chaseHeight * ds, C.chaseDist * ds).applyQuaternion(this.q);
      const target = vpos.clone().add(back);
      if (target.y < info.ground + 1.5) target.y = info.ground + 1.5;
      cam.position.copy(target);
      // lookY: 注視点の上下オフセット（負にすると機体が画面の上寄りに映る）
      const ahead = new THREE.Vector3(0, C.chaseHeight * 0.35 + (C.lookY || 0), -C.chaseDist * 0.8).applyQuaternion(this.q).add(vpos);
      cam.up.set(0, 1, 0).applyQuaternion(this.q);
      cam.lookAt(ahead);
      cam.near = 0.5;
    }

    // 揺れ: エンジン出力・乱気流・接地の衝撃
    this.shakeT += dt;
    const amp = (this.shakeEnabled === false ? 0 : info.shake || 0) + this.impulse;
    this.impulse *= Math.exp(-dt / 0.25);
    if (amp > 1e-4) {
      const t = this.shakeT;
      const e = new THREE.Euler(
        amp * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.3) * 0.4),
        amp * (Math.sin(t * 29.7) * 0.5 + Math.sin(t * 41.9) * 0.5),
        amp * 0.5 * Math.sin(t * 33.3),
      );
      cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(e));
    }

    // FOV: 速度に応じて広げる
    const target = isCar
      ? C.fovBase + clamp((info.speed - 8) / 80, 0, 1) * 16 + (info.nitro ? 7 : 0)
      : C.fovBase + clamp((info.speed - 25) / 230, 0, 1) * 16 + (info.ab ? 4 : 0);
    this.fov += (target - this.fov) * (1 - Math.exp(-dt / 0.5));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
