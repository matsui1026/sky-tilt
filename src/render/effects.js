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

export function createRings(rings) {
  const group = new THREE.Group();
  group.name = 'rings';
  const meshes = rings.map((r, i) => {
    const geo = new THREE.TorusGeometry(r.radius, Math.max(0.6, r.radius * 0.07), 8, 40);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.85, fog: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(r.pos.x, r.pos.y, r.pos.z);
    m.lookAt(r.pos.x + r.normal.x, r.pos.y + r.normal.y, r.pos.z + r.normal.z);
    m.userData.index = i;
    group.add(m);
    return m;
  });
  return {
    group,
    update(state, t) {
      const idx = state.rings ? state.rings.index : 0;
      meshes.forEach((m, i) => {
        if (i < idx) { m.visible = false; return; }
        m.visible = i < idx + 4;
        const next = i === idx;
        m.material.color.setHex(next ? 0x3affb0 : 0xffc23a);
        m.material.opacity = next ? 0.75 + 0.2 * Math.sin(t * 6) : 0.5;
      });
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
    if (def.model === 'fixedwing') {
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
    const k = 1 - Math.exp(-dt / (def.model === 'fixedwing' ? 0.12 : 0.35));
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
      const back = new THREE.Vector3(0, C.chaseHeight, C.chaseDist).applyQuaternion(this.q);
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
    const target = C.fovBase + clamp((info.speed - 25) / 230, 0, 1) * 16 + (info.ab ? 4 : 0);
    this.fov += (target - this.fov) * (1 - Math.exp(-dt / 0.5));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
