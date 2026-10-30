// 車用の描画: コース（舗装・縁石・白線・スタート）、広場、ジャンプ台、コーン、ゲート、駐車枠、
// タイヤスモークとスキッドマーク、ライバル。降雨・降雪もここ（車以外でも使う）。
import * as THREE from 'three';
import { SURFACES, roadHeight } from '../sim/vehicles/car.js';
import { mulberry32 } from '../sim/math.js';

const ROAD_COL = { asphalt: 0x4c4f55, dirt: 0x8a6a48, snow: 0xc4ccd6 };
const c1 = new THREE.Color();

/** 頂点色つきの四角形を配列に足す（反時計回りで上向き） */
function quad(pos, col, a, b, cc, d, hex) {
  c1.setHex(hex);
  for (const p of [a, b, cc, a, cc, d]) {
    pos.push(p[0], p[1], p[2]);
    col.push(c1.r, c1.g, c1.b);
  }
}

function buildRoadMesh(terrain) {
  const t = terrain.track;
  const pos = [];
  const col = [];
  const h = (x, z) => terrain.heightAt(x, z) + 0.12;
  const W = t.width / 2;
  const base = ROAD_COL[t.surface] || ROAD_COL.asphalt;
  const paved = t.surface === 'asphalt';
  const n = t.n;
  const edge = (p, off) => {
    const x = p.x + -p.tz * off, z = p.z + p.tx * off;
    return [x, h(x, z), z];
  };
  for (let i = 0; i < n; i++) {
    const a = t.pts[i], b = t.pts[(i + 1) % n];
    // 路面（進行方向の左 → 右の順で上向き）
    quad(pos, col, edge(a, -W), edge(a, W), edge(b, W), edge(b, -W), base);
    if (paved) {
      // 端の白線
      for (const s of [-1, 1]) quad(pos, col, edge(a, s > 0 ? W - 0.7 : -W + 0.4), edge(a, s > 0 ? W - 0.4 : -W + 0.7), edge(b, s > 0 ? W - 0.4 : -W + 0.7), edge(b, s > 0 ? W - 0.7 : -W + 0.4), 0xe8e8e8);
      // 中央の破線
      if (i % 5 < 2) quad(pos, col, edge(a, -0.15), edge(a, 0.15), edge(b, 0.15), edge(b, -0.15), 0xd0d0d0);
    }
    // カーブの内外に縁石（赤白）
    if (Math.abs(a.k) > 1 / 140) {
      const stripe = i % 2 === 0 ? 0xd03030 : 0xf0f0f0;
      quad(pos, col, edge(a, W), edge(a, W + 1.3), edge(b, W + 1.3), edge(b, W), stripe);
      quad(pos, col, edge(a, -W - 1.3), edge(a, -W), edge(b, -W), edge(b, -W - 1.3), stripe);
    }
  }
  // スタート／ゴールの市松
  const a = t.pts[0];
  const cols = 12;
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < cols; k++) {
      const v0 = -W + (k / cols) * t.width, v1 = v0 + t.width / cols;
      const u0 = row * 1.5, u1 = u0 + 1.5;
      const pt = (u, v) => { const x = a.x + a.tx * u + -a.tz * v, z = a.z + a.tz * u + a.tx * v; return [x, h(x, z) + 0.01, z]; };
      quad(pos, col, pt(u0, v0), pt(u0, v1), pt(u1, v1), pt(u1, v0), (row + k) % 2 ? 0xffffff : 0x101010);
    }
  }
  // 広場
  for (const p of terrain.pads) {
    const N = 48;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const pt = (ang, r) => { const x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r; return [x, h(x, z), z]; };
      const cc = [p.x, h(p.x, p.z), p.z];
      quad(pos, col, cc, pt(a1, p.r), pt(a0, p.r), cc, 0x44474c);
      quad(pos, col, pt(a0, p.r - 2), pt(a1, p.r - 2), pt(a1, p.r - 1.3), pt(a0, p.r - 1.3), 0xe8e8e8);
      if (i % 4 === 0) quad(pos, col, pt(a0, p.r * 0.5), pt(a1, p.r * 0.5), pt(a1, p.r * 0.5 + 0.5), pt(a0, p.r * 0.5 + 0.5), 0xc8c8c8);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'road';
  return mesh;
}

/** ジャンプ台（1 メッシュに結合） */
function buildRamps(terrain) {
  if (!terrain.ramps.length) return null;
  const pos = [];
  const col = [];
  for (const r of terrain.ramps) {
    const P = (u, v, y) => [r.x + r.fx * u + -r.fz * v, r.base + y, r.z + r.fz * u + r.fx * v];
    const L = r.len / 2, W = r.width / 2, H = r.height;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const u0 = -L + (i / N) * r.len, u1 = -L + ((i + 1) / N) * r.len;
      const y0 = (H * (u0 + L)) / r.len, y1 = (H * (u1 + L)) / r.len;
      quad(pos, col, P(u0, -W, y0), P(u0, W, y0), P(u1, W, y1), P(u1, -W, y1), i % 2 ? 0xf4b020 : 0x202020);
    }
    // 側面と裏
    quad(pos, col, P(-L, W, 0), P(L, W, 0), P(L, W, H), P(-L, W, 0), 0x555555);
    quad(pos, col, P(L, -W, 0), P(-L, -W, 0), P(L, -W, H), P(L, -W, 0), 0x555555);
    quad(pos, col, P(L, W, 0), P(L, -W, 0), P(L, -W, H), P(L, W, H), 0x444444);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
}

function buildGate() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x3affb0, transparent: true, opacity: 0.85 });
  const pole = new THREE.CylinderGeometry(0.3, 0.3, 8, 8);
  const l = new THREE.Mesh(pole, mat);
  const r = new THREE.Mesh(pole, mat);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 0.3), mat);
  g.add(l, r, top);
  g.userData = { l, r, top };
  return g;
}

/**
 * ダイナミックな要素をまとめたビュー。
 * world, def, opts: { race, parking }
 */
export function createTrackView(world, def, opts = {}) {
  const terrain = world.terrain;
  const group = new THREE.Group();
  group.name = 'trackView';
  group.add(buildRoadMesh(terrain));
  const ramps = buildRamps(terrain);
  if (ramps) group.add(ramps);

  // コーン（1 ドローコール）
  const cones = terrain.cones;
  const coneGeo = new THREE.ConeGeometry(0.28, 0.75, 8).translate(0, 0.375, 0);
  const coneMesh = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0xff6a1a }), Math.max(cones.length, 1));
  const m4 = new THREE.Matrix4();
  const flying = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3(1, 1, 1);
  const vp = new THREE.Vector3();
  cones.forEach((c, i) => { m4.compose(vp.set(c.x, c.y + 0.12, c.z), q.identity(), sc); coneMesh.setMatrixAt(i, m4); });
  coneMesh.count = cones.length;
  coneMesh.instanceMatrix.needsUpdate = true;
  coneMesh.frustumCulled = false;
  group.add(coneMesh);

  // 次のチェックポイントのゲート
  let gate = null;
  if (opts.race) {
    gate = buildGate();
    group.add(gate);
  }
  // 駐車枠
  let parkBox = null;
  if (opts.parking) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const fill = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    parkBox = new THREE.Group();
    const line = new THREE.Mesh(new THREE.RingGeometry(0.965, 1.0, 4, 1).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2), mat);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), fill);
    parkBox.add(line, inner);
    parkBox.userData = { line, inner, mat, fill };
    group.add(parkBox);
  }

  // ライバル（renderer が作ったモデルを受け取る）
  const rivals = [];

  // スモーク（Points 1 つ）
  const SMOKE = 160;
  const sPos = new Float32Array(SMOKE * 3);
  const sCol = new Float32Array(SMOKE * 4);
  const particles = [];
  for (let i = 0; i < SMOKE; i++) particles.push({ life: 0, max: 1, x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
  let sIdx = 0;
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 4));
  const smoke = new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 2.8, map: puffTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
  smoke.frustumCulled = false;
  smoke.name = 'smoke';
  group.add(smoke);
  let spawnAcc = 0;
  const rnd = mulberry32(world.seed + 3);
  const tmpColor = new THREE.Color();
  const emit = (x, y, z, vx, vy, vz, hex, life) => {
    const p = particles[sIdx];
    sIdx = (sIdx + 1) % SMOKE;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life;
    tmpColor.setHex(hex);
    p.r = tmpColor.r; p.g = tmpColor.g; p.b = tmpColor.b;
  };

  // スキッドマーク（1 ドローコール。古いものから上書き）
  const SKID = 500;
  const kPos = new Float32Array(SKID * 6 * 3);
  const kGeo = new THREE.BufferGeometry();
  kGeo.setAttribute('position', new THREE.BufferAttribute(kPos, 3));
  kGeo.setDrawRange(0, 0);
  const skid = new THREE.Mesh(kGeo, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
  skid.frustumCulled = false;
  skid.name = 'skid';
  group.add(skid);
  let kIdx = 0, kCount = 0;
  const lastMark = [null, null];

  const addSkid = (i, x, y, z, nx, nz) => {
    const w = 0.13;
    const L = [x + nx * w, y, z + nz * w], R = [x - nx * w, y, z - nz * w];
    const prev = lastMark[i];
    lastMark[i] = { L, R };
    if (!prev) return;
    const o = kIdx * 18;
    const put = (off, p) => { kPos[o + off] = p[0]; kPos[o + off + 1] = p[1]; kPos[o + off + 2] = p[2]; };
    put(0, prev.L); put(3, prev.R); put(6, R); put(9, prev.L); put(12, R); put(15, L);
    kIdx = (kIdx + 1) % SKID;
    kCount = Math.min(SKID, kCount + 1);
    kGeo.setDrawRange(0, kCount * 6);
    kGeo.attributes.position.needsUpdate = true;
  };

  return {
    group,
    coneMesh,
    rivals,
    addRival(model) { rivals.push(model); group.add(model.root); },
    event(ev) {
      if (ev.type === 'cone') {
        const c = cones[ev.index];
        if (!c) return;
        const sp = Math.hypot(ev.vel.x, ev.vel.z);
        flying.push({ i: ev.index, x: c.x, y: c.y + 0.12, z: c.z, vx: ev.vel.x * 0.8 + (rnd() - 0.5) * 3, vy: 3 + sp * 0.25, vz: ev.vel.z * 0.8 + (rnd() - 0.5) * 3, rot: 0, t: 0 });
      }
    },
    /** state: sim.getState()、vs: 車の内部状態 */
    update(state, vs, dt, simRace, simParking) {
      // 飛ばされたコーン
      for (let k = flying.length - 1; k >= 0; k--) {
        const f = flying[k];
        f.t += dt;
        f.vy -= 9.8 * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        f.rot += dt * 9;
        const g = terrain.heightAt(f.x, f.z) + 0.1;
        if (f.y < g) { f.y = g; f.vy *= -0.3; f.vx *= 0.7; f.vz *= 0.7; }
        e.set(f.rot, 0, f.rot * 0.6);
        q.setFromEuler(e);
        m4.compose(vp.set(f.x, f.y, f.z), q, sc);
        coneMesh.setMatrixAt(f.i, m4);
        coneMesh.instanceMatrix.needsUpdate = true;
        if (f.t > 4) flying.splice(k, 1);
      }
      // ゲート
      if (gate && state.race) {
        const n = state.race.next;
        const hw = n.halfWidth;
        const { l, r, top } = gate.userData;
        gate.position.set(n.x, n.y, n.z);
        gate.rotation.y = -n.heading;
        l.position.set(-hw, 4, 0);
        r.position.set(hw, 4, 0);
        top.position.set(0, 8, 0);
        top.scale.set(hw * 2 + 0.6, 1, 1);
      }
      // 駐車枠
      if (parkBox) {
        const pk = state.parking;
        parkBox.visible = !!(pk && pk.box);
        if (pk && pk.box) {
          const b = pk.box;
          parkBox.position.set(b.x, b.y + 0.2, b.z);
          parkBox.rotation.y = -b.heading;
          // リング（正方形）は対角 √2 を 1 として作ってある
          parkBox.userData.line.scale.set(b.w / Math.SQRT2, 1, b.l / Math.SQRT2);
          parkBox.userData.inner.scale.set(b.w, 1, b.l);
          const col = pk.inside ? 0x3affb0 : 0xffc23a;
          parkBox.userData.mat.color.setHex(col);
          parkBox.userData.fill.color.setHex(col);
        }
      }
      // ライバルの位置
      if (simRace) {
        simRace.rivals.forEach((r, i) => {
          const m = rivals[i];
          if (!m) return;
          m.root.position.set(r.pos.x, r.pos.y + m.cg, r.pos.z);
          m.root.rotation.set(0, -r.heading, 0);
          m.update({ vx: r.v, steer: r.steer, spinAngle: r.spin }, dt, 0);
        });
      }
      // スモークとスキッド
      const car = state.car;
      const driving = car && !car.air && vs && (state.carMode == null || state.carMode === 'drive');
      const hover = this.hover;
      if (driving && !hover) {
        const slipping = car.slip > 0.16 || car.handbrake;
        const speed = state.groundSpeed;
        const on = slipping && speed > 3;
        const S = SURFACES[car.surface] || SURFACES.asphalt;
        const fh = { x: Math.sin(vs.psi), z: -Math.cos(vs.psi) };
        const rh = { x: -fh.z, z: fh.x };
        const D = def.p.drive;
        const b = D.wheelBase * (D.weightFront ?? 0.5);
        const hw = (def.body && def.body.style === 'monster') ? 1.3 : def.body && def.body.style === 'kart' ? 0.58 : 0.86;
        const roughGround = ['dirt', 'sand', 'snow', 'grass', 'park'].includes(car.surface);
        for (let i = 0; i < 2; i++) {
          const side = i ? 1 : -1;
          const x = vs.pos.x - fh.x * b + rh.x * side * hw;
          const z = vs.pos.z - fh.z * b + rh.z * side * hw;
          if (on) addSkid(i, x, roadHeight(terrain, x, z) + 0.15, z, rh.x, rh.z);
          else lastMark[i] = null;
        }
        // 舗装ではスリップ時だけ、未舗装では走るだけで砂ぼこり
        const rate = on ? 40 : roughGround && speed > 6 ? Math.min(speed * 1.0, 25) : 0;
        spawnAcc += rate * dt;
        while (spawnAcc > 1) {
          spawnAcc -= 1;
          const side = rnd() < 0.5 ? -1 : 1;
          const x = vs.pos.x - fh.x * b + rh.x * side * hw;
          const z = vs.pos.z - fh.z * b + rh.z * side * hw;
          emit(x, roadHeight(terrain, x, z) + 0.3, z, vs.vel.x * 0.25 + (rnd() - 0.5) * 2, 0.8 + rnd() * 1.2, vs.vel.z * 0.25 + (rnd() - 0.5) * 2, S.smoke, 1.1 + rnd() * 0.9);
        }
      } else { lastMark[0] = null; lastMark[1] = null; }
      // 粒の更新
      const pa = sGeo.attributes.position.array;
      const ca = sGeo.attributes.color.array;
      for (let i = 0; i < SMOKE; i++) {
        const p = particles[i];
        if (p.life > 0) {
          p.life -= dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          p.vx *= Math.exp(-dt * 1.5); p.vz *= Math.exp(-dt * 1.5);
        }
        pa[i * 3] = p.x; pa[i * 3 + 1] = p.life > 0 ? p.y : -9999; pa[i * 3 + 2] = p.z;
        ca[i * 4] = p.r; ca[i * 4 + 1] = p.g; ca[i * 4 + 2] = p.b;
        ca[i * 4 + 3] = p.life > 0 ? 0.32 * (p.life / p.max) : 0;
      }
      sGeo.attributes.position.needsUpdate = true;
      sGeo.attributes.color.needsUpdate = true;
    },
    hover: !!(def.p.drive && def.p.drive.hover),
  };
}

let _puff = null;
function puffTexture() {
  if (_puff) return _puff;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _puff = new THREE.CanvasTexture(c);
  return _puff;
}

/** 雨・雪（カメラの周りの箱の中を降り続ける。1 ドローコール） */
export function createPrecip(kind) {
  const rnd = mulberry32(99);
  const BOX = 70;
  if (kind === 'rain') {
    const N = 520;
    const pos = new Float32Array(N * 6);
    const seeds = [];
    for (let i = 0; i < N; i++) seeds.push({ x: rnd() * BOX, y: rnd() * BOX, z: rnd() * BOX });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xbfd4e8, transparent: true, opacity: 0.4, depthWrite: false }));
    lines.frustumCulled = false;
    lines.name = 'precip';
    return {
      object: lines,
      update(dt, cam, vel) {
        const a = geo.attributes.position.array;
        const vx = -(vel ? vel.x : 0) * 0.04, vz = -(vel ? vel.z : 0) * 0.04;
        for (let i = 0; i < N; i++) {
          const s = seeds[i];
          s.y -= 26 * dt;
          if (s.y < 0) s.y += BOX;
          const x = cam.x - BOX / 2 + ((s.x - cam.x) % BOX + BOX) % BOX;
          const y = cam.y - BOX / 2 + ((s.y - cam.y) % BOX + BOX) % BOX;
          const z = cam.z - BOX / 2 + ((s.z - cam.z) % BOX + BOX) % BOX;
          a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z;
          a[i * 6 + 3] = x + vx; a[i * 6 + 4] = y + 1.1; a[i * 6 + 5] = z + vz;
        }
        geo.attributes.position.needsUpdate = true;
      },
    };
  }
  const N = 650;
  const pos = new Float32Array(N * 3);
  const seeds = [];
  for (let i = 0; i < N; i++) seeds.push({ x: rnd() * BOX, y: rnd() * BOX, z: rnd() * BOX, p: rnd() * 6 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.9, depthWrite: false, map: puffTexture() }));
  pts.frustumCulled = false;
  pts.name = 'precip';
  let t = 0;
  return {
    object: pts,
    update(dt, cam) {
      t += dt;
      const a = geo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        s.y -= 2.4 * dt;
        if (s.y < 0) s.y += BOX;
        const wob = Math.sin(t * 0.9 + s.p) * 0.8;
        a[i * 3] = cam.x - BOX / 2 + ((s.x + wob - cam.x) % BOX + BOX) % BOX;
        a[i * 3 + 1] = cam.y - BOX / 2 + ((s.y - cam.y) % BOX + BOX) % BOX;
        a[i * 3 + 2] = cam.z - BOX / 2 + ((s.z - cam.z) % BOX + BOX) % BOX;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
