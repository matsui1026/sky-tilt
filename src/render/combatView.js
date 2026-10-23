// 射撃モードの描画: 風船・地上目標・敵機・曳光弾・ミサイル・爆発
import * as THREE from 'three';
import { buildEnemyModel } from './models.js';
import { glowTexture } from './textures.js';

const BALLOON_COLORS = [0xff3b3b, 0xffc21a, 0x3fa9ff, 0x6fe36f, 0xff6fd8];
const MAX_TRACERS = 400;
const MAX_PARTICLES = 600;

export function createCombatView(combat) {
  const group = new THREE.Group();
  group.name = 'combat';
  const m4 = new THREE.Matrix4();
  const qI = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();

  // 風船（インスタンス）＋ひも
  const balloons = combat.targets.filter((t) => t.type === 'balloon');
  const bGeo = new THREE.SphereGeometry(1, 14, 10);
  bGeo.scale(1, 1.2, 1);
  const bMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x331111 });
  const bMesh = new THREE.InstancedMesh(bGeo, bMat, Math.max(1, balloons.length));
  const col = new THREE.Color();
  balloons.forEach((t, i) => { bMesh.setColorAt(i, col.setHex(BALLOON_COLORS[t.color % BALLOON_COLORS.length])); });
  if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
  bMesh.frustumCulled = false;
  group.add(bMesh);
  const stringPos = new Float32Array(balloons.length * 6);
  const strGeo = new THREE.BufferGeometry();
  strGeo.setAttribute('position', new THREE.BufferAttribute(stringPos, 3));
  const strings = new THREE.LineSegments(strGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  strings.frustumCulled = false;
  group.add(strings);

  // 地上目標（白と赤の的）
  const grounds = combat.targets.filter((t) => t.type === 'ground');
  const gGeo = new THREE.CylinderGeometry(1, 1, 0.5, 20);
  const gMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: bullseye() });
  const gMesh = new THREE.InstancedMesh(gGeo, gMat, Math.max(1, grounds.length));
  gMesh.frustumCulled = false;
  group.add(gMesh);
  // 目印の光の柱（地上目標）
  const pillarGeo = new THREE.CylinderGeometry(0.8, 0.8, 120, 6, 1, true).translate(0, 60, 0);
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, Math.max(1, grounds.length));
  pillars.frustumCulled = false;
  group.add(pillars);

  // 敵機
  const enemyObjs = new Map();

  // 曳光弾
  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  const tracerCol = new Float32Array(MAX_TRACERS * 6);
  const trGeo = new THREE.BufferGeometry();
  trGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  trGeo.setAttribute('color', new THREE.BufferAttribute(tracerCol, 3));
  const tracers = new THREE.LineSegments(trGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  tracers.frustumCulled = false;
  group.add(tracers);

  // ミサイル（本体はスプライト状の光点＋煙の粒子）
  // 爆発・煙の粒子
  const partPos = new Float32Array(MAX_PARTICLES * 3);
  const partCol = new Float32Array(MAX_PARTICLES * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(partCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 6, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  group.add(particles);
  const parts = []; // { p, v, life, max, c: [r,g,b], size }
  const missileMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 2.4, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xeeeeee }), 8);
  missileMesh.frustumCulled = false;
  group.add(missileMesh);

  function burst(pos, kind) {
    const n = kind === 'big' ? 70 : kind === 'pop' ? 24 : 10;
    const sp = kind === 'big' ? 40 : kind === 'pop' ? 14 : 8;
    for (let i = 0; i < n && parts.length < MAX_PARTICLES; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(sp * (0.3 + Math.random()));
      const hot = kind === 'pop' ? [1, 1, 1] : Math.random() < 0.6 ? [1, 0.6, 0.15] : [0.5, 0.45, 0.4];
      parts.push({ p: new THREE.Vector3(pos.x, pos.y, pos.z), v, life: 0, max: kind === 'big' ? 1.6 : 0.6, c: hot });
    }
  }

  return {
    group,
    event(ev) {
      if (ev.type === 'pop') burst(ev.pos, 'pop');
      else if (ev.type === 'kill') burst(ev.pos, 'big');
      else if (ev.type === 'hit' || ev.type === 'impact') burst(ev.pos, 'small');
    },
    update(dt, t) {
      // 風船
      balloons.forEach((b, i) => {
        const bob = Math.sin(t * 1.3 + b.id) * 0.6;
        p.set(b.pos.x, b.pos.y + bob, b.pos.z);
        const r = b.alive ? b.r : 0.001;
        s.set(r, r, r);
        m4.compose(p, qI, s);
        bMesh.setMatrixAt(i, m4);
        stringPos.set([b.pos.x, b.pos.y + bob - r * 1.2, b.pos.z, b.pos.x, b.alive ? b.pos.y + bob - r * 1.2 - 12 : b.pos.y + bob - r * 1.2, b.pos.z], i * 6);
      });
      bMesh.instanceMatrix.needsUpdate = true;
      strGeo.attributes.position.needsUpdate = true;
      // 地上目標
      grounds.forEach((g, i) => {
        p.set(g.pos.x, g.pos.y - 2.2, g.pos.z);
        s.set(g.alive ? g.r : 0.001, 1, g.alive ? g.r : 0.001);
        m4.compose(p, qI, s);
        gMesh.setMatrixAt(i, m4);
        s.set(g.alive ? 1 : 0.001, g.alive ? 1 : 0.001, g.alive ? 1 : 0.001);
        m4.compose(p, qI, s);
        pillars.setMatrixAt(i, m4);
      });
      gMesh.instanceMatrix.needsUpdate = true;
      pillars.instanceMatrix.needsUpdate = true;
      // 敵機
      for (const e of combat.enemies) {
        let o = enemyObjs.get(e.id);
        if (!o) { o = buildEnemyModel(e.type); enemyObjs.set(e.id, o); group.add(o); }
        o.visible = e.alive;
        if (!e.alive) continue;
        o.position.set(e.pos.x, e.pos.y, e.pos.z);
        o.lookAt(e.pos.x + e.dir.x, e.pos.y + e.dir.y, e.pos.z + e.dir.z);
        o.rotateY(Math.PI); // モデルの前方は -z
        if (e.type === 'plane') o.rotateZ(Math.sin(t * 0.8 + e.id) * 0.5);
      }
      // 曳光弾（弾道の短い線分）
      let n = 0;
      for (const b of combat.bullets) {
        if (n >= MAX_TRACERS) break;
        const len = b.owner === 'enemy' ? 0.03 : 0.025;
        tracerPos.set([b.pos.x, b.pos.y, b.pos.z, b.pos.x - b.vel.x * len, b.pos.y - b.vel.y * len, b.pos.z - b.vel.z * len], n * 6);
        const c = b.owner === 'enemy' ? [1, 0.25, 0.2] : [1, 0.85, 0.3];
        tracerCol.set([...c, c[0] * 0.3, c[1] * 0.3, c[2] * 0.3], n * 6);
        n++;
      }
      trGeo.setDrawRange(0, n * 2);
      trGeo.attributes.position.needsUpdate = true;
      trGeo.attributes.color.needsUpdate = true;
      // ミサイル
      let mi = 0;
      for (const m of combat.missiles) {
        if (mi >= 8) break;
        const dir = new THREE.Vector3(m.vel.x, m.vel.y, m.vel.z).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        m4.compose(p.set(m.pos.x, m.pos.y, m.pos.z), q, s.set(1, 1, 1));
        missileMesh.setMatrixAt(mi++, m4);
        if (parts.length < MAX_PARTICLES) parts.push({ p: new THREE.Vector3(m.pos.x, m.pos.y, m.pos.z), v: new THREE.Vector3(0, 1, 0), life: 0, max: 1.4, c: [0.8, 0.8, 0.8] });
      }
      missileMesh.count = mi;
      missileMesh.instanceMatrix.needsUpdate = true;
      // 粒子
      let k = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.life += dt;
        if (q.life >= q.max) { parts.splice(i, 1); continue; }
        q.p.addScaledVector(q.v, dt);
        q.v.multiplyScalar(Math.exp(-dt * 1.5));
        const f = 1 - q.life / q.max;
        partPos.set([q.p.x, q.p.y, q.p.z], k * 3);
        partCol.set([q.c[0] * f, q.c[1] * f, q.c[2] * f], k * 3);
        k++;
      }
      pGeo.setDrawRange(0, k);
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
    },
  };
}

function bullseye() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 6; i >= 1; i--) {
    g.beginPath();
    g.arc(64, 64, i * 10.5, 0, Math.PI * 2);
    g.fillStyle = i % 2 ? '#e8302a' : '#ffffff';
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
