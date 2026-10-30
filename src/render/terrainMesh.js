// 地形・水面・滑走路・ビル・木の描画（sim/terrain.js と同じ格子を使う）
import * as THREE from 'three';
import { detailTexture, runwayTexture, targetTexture, glowTexture } from './textures.js';
import { mulberry32, smoothstep, clamp } from '../sim/math.js';
import { fieldMask, fieldLocal } from '../sim/terrainGen.js';

const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();

function terrainColor(loc, terrain, h, slope, x, z, out) {
  const P = loc.palette;
  const maxH = Math.max(terrain.maxH, 1);
  const rel = clamp((h - Math.max(terrain.minH, 0)) / (maxH - Math.max(terrain.minH, 0) + 1), 0, 1);
  const n = (Math.sin(x * 0.0021 + z * 0.0013) + Math.sin(x * 0.0047 - z * 0.0031)) * 0.25 + 0.5;
  out.setHex(P.low).lerp(tmpC2.setHex(P.mid), clamp(n * 0.8 + rel * 0.6, 0, 1));
  switch (loc.generator) {
    case 'island':
    case 'city':
      if (h < 3.5) out.setHex(P.sand);
      // 市街地は舗装（ビルの間を車で走れる）
      if (loc.generator === 'city' && h >= 3.5) out.lerp(tmpC2.setHex(0x5c6066), 1 - smoothstep(2700, 3150, Math.hypot(x, z)));
      if (rel > 0.55) out.lerp(tmpC2.setHex(P.high), smoothstep(0.55, 0.8, rel));
      break;
    case 'mountains':
      out.lerp(tmpC2.setHex(P.high), smoothstep(0.35, 0.6, rel));
      out.lerp(tmpC2.setHex(P.top), smoothstep(0.72, 0.85, rel));
      break;
    case 'desert': {
      const band = Math.sin(h / 23) * 0.5 + 0.5;
      out.setHex(P.low).lerp(tmpC2.setHex(P.mid), band * 0.7).lerp(tmpC2.setHex(P.high), smoothstep(0.2, 0.9, rel) * 0.6);
      if (slope < 0.18) out.lerp(tmpC2.setHex(P.sand), 0.55);
      break;
    }
    case 'snow':
      out.setHex(P.low).lerp(tmpC2.setHex(P.top), smoothstep(0.3, 0.7, rel));
      break;
    case 'raceway':
      out.lerp(tmpC2.setHex(P.high), smoothstep(0.4, 0.8, rel));
      break;
    default:
  }
  // 急斜面は岩肌
  const cliffStart = loc.generator === 'snow' ? 0.75 : 0.6;
  out.lerp(tmpC2.setHex(P.cliff), smoothstep(cliffStart, cliffStart + 0.35, slope));
  // 着陸エリア
  const f = terrain.field;
  const m = fieldMask(f, x, z, 30, 80);
  if (m > 0 && f.type !== 'runway') {
    const surf = { grass: 0x8fbf5f, park: 0x7fb85a, ice: 0xcfe6f5 }[f.surface] || 0x9fbf6f;
    out.lerp(tmpC2.setHex(surf), m * 0.9);
  } else if (m > 0 && f.surface === 'dirt') {
    out.lerp(tmpC2.setHex(0xc9a074), m * 0.6);
  } else if (m > 0) {
    out.lerp(tmpC2.setHex(0x6f9f4f), m * 0.6);
  }
  return out;
}

export function buildTerrain(world, opts = {}) {
  const terrain = world.terrain;
  const loc = world.location;
  const group = new THREE.Group();
  group.name = 'terrain';
  const n = terrain.n;
  const n1 = n + 1;
  const pos = new Float32Array(n1 * n1 * 3);
  const col = new Float32Array(n1 * n1 * 3);
  const uv = new Float32Array(n1 * n1 * 2);
  for (let j = 0; j < n1; j++) {
    for (let i = 0; i < n1; i++) {
      const k = j * n1 + i;
      const x = -terrain.half + i * terrain.cell;
      const z = -terrain.half + j * terrain.cell;
      const h = terrain.heights[k];
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      const hx = terrain._h(i + 1, j) - terrain._h(i - 1, j);
      const hz = terrain._h(i, j + 1) - terrain._h(i, j - 1);
      const slope = Math.hypot(hx, hz) / (2 * terrain.cell);
      terrainColor(loc, terrain, h, slope, x, z, tmpC);
      col[k * 3] = tmpC.r;
      col[k * 3 + 1] = tmpC.g;
      col[k * 3 + 2] = tmpC.b;
      uv[k * 2] = x / 60;
      uv[k * 2 + 1] = z / 60;
    }
  }
  // 三角形分割は Terrain.heightAt と同じ: (i,j)-(i,j+1)-(i+1,j) と (i,j+1)-(i+1,j+1)-(i+1,j)
  const idx = new Uint32Array(n * n * 6);
  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n1 + i;
      const b = (j + 1) * n1 + i;
      const c = (j + 1) * n1 + i + 1;
      const d = j * n1 + i + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = d;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const detail = detailTexture(world.seed);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrainMesh';
  group.add(mesh);

  // 外周（地平線までの地面 or 海）
  const edgeH = loc.water ? -40 : Math.max(terrain.minH, edgeAverage(terrain)) - 5;
  if (!loc.water) {
    const skirtGeo = new THREE.RingGeometry(terrain.half * 0.98, 60000, 8, 1);
    skirtGeo.rotateX(-Math.PI / 2);
    const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(loc.palette.low).multiplyScalar(0.85) }));
    skirt.position.y = edgeH;
    skirt.name = 'skirt';
    group.add(skirt);
  }
  let water = null;
  if (loc.water) {
    const wgeo = new THREE.PlaneGeometry(120000, 120000, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = new THREE.MeshPhongMaterial({ color: loc.palette.water, specular: 0x9fb8cc, shininess: 60, map: detail });
    detail.repeat.set(1, 1);
    water = new THREE.Mesh(wgeo, wmat);
    water.name = 'water';
    water.position.y = 0;
    // 水面のテクスチャは別スケール
    const wtex = detail.clone();
    wtex.needsUpdate = true;
    wtex.repeat.set(900, 900);
    wmat.map = wtex;
    group.add(water);
  }

  // 滑走路
  const f = terrain.field;
  if (f.type === 'runway') {
    const rgeo = new THREE.PlaneGeometry(f.width, f.length, 1, 1);
    rgeo.rotateX(-Math.PI / 2);
    const rmat = new THREE.MeshLambertMaterial({ map: runwayTexture(f), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const rw = new THREE.Mesh(rgeo, rmat);
    rw.position.set(f.x, f.elevation + 0.08, f.z);
    rw.rotation.y = -f.heading * (Math.PI / 180);
    rw.name = 'runway';
    group.add(rw);
  }

  const buildings = terrain.buildings.length ? buildBuildings(terrain, loc) : null;
  if (buildings) group.add(buildings);
  const trees = buildTrees(world);
  if (trees) group.add(trees);
  const lights = buildFieldLights(terrain);
  group.add(lights);
  const target = buildTarget(terrain);
  group.add(target);

  return { group, terrainMesh: mesh, water, buildings, trees, lights, target, detail };
}

function edgeAverage(t) {
  let s = 0, c = 0;
  for (let i = 0; i <= t.n; i += 8) {
    s += t._h(i, 0) + t._h(i, t.n) + t._h(0, i) + t._h(t.n, i);
    c += 4;
  }
  return s / c;
}

function buildBuildings(terrain, loc) {
  const list = terrain.buildings;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.userData.night = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = mat.userData.night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);\nvWPos = wp4.xyz;\nvWNorm = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nuniform float uNight;\nfloat hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (abs(vWNorm.y) < 0.5) {
          float hc = abs(vWNorm.x) > 0.5 ? vWPos.z : vWPos.x;
          vec2 cell = vec2(hc / 3.2, vWPos.y / 3.6);
          vec2 f = fract(cell);
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.85);
          float rnd = hash21(floor(cell) + floor(vWPos.xz / 40.0));
          diffuseColor.rgb *= mix(1.0, 0.55 + 0.25 * rnd, win);
          totalEmissiveRadiance += uNight * win * step(0.45, rnd) * vec3(1.0, 0.82, 0.5) * (0.6 + 0.4 * rnd);
        }`);
  };
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const rnd = mulberry32(terrain.seed + 3);
  const base = new THREE.Color(loc.palette.building || 0x9aa4ae);
  list.forEach((b, i) => {
    p.set(b.x, b.base, b.z);
    s.set(b.w, b.h, b.d);
    m4.compose(p, q, s);
    im.setMatrixAt(i, m4);
    const tint = 0.75 + rnd() * 0.35;
    tmpC.copy(base).multiplyScalar(tint);
    if (rnd() < 0.25) tmpC.lerp(tmpC2.setHex(0x6f8fb0), 0.4);
    if (rnd() < 0.15) tmpC.lerp(tmpC2.setHex(0xc8b89a), 0.4);
    im.setColorAt(i, tmpC);
  });
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.name = 'buildings';
  return im;
}

function buildTrees(world) {
  const terrain = world.terrain;
  const loc = world.location;
  const counts = { island: 2600, mountains: 4200, city: 700, desert: 0, snow: 1800, raceway: 1500 };
  const N = counts[loc.generator] ?? 0;
  if (!N) return null;
  const geo = new THREE.ConeGeometry(1, 1, 5, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const im = new THREE.InstancedMesh(geo, mat, N);
  const rnd = mulberry32(world.seed + 77);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let k = 0;
  let tries = 0;
  const maxH = terrain.maxH;
  while (k < N && tries < N * 12) {
    tries++;
    // 群生させる: 林の中心を選んでその周りに
    const cx = (rnd() - 0.5) * terrain.size * 0.9;
    const cz = (rnd() - 0.5) * terrain.size * 0.9;
    const clump = 6 + Math.floor(rnd() * 14);
    for (let c = 0; c < clump && k < N; c++) {
      const x = cx + (rnd() - 0.5) * 260;
      const z = cz + (rnd() - 0.5) * 260;
      const h = terrain.heightAt(x, z);
      if (terrain.water && h < 4) continue;
      if (terrain.slopeAt(x, z) > 0.6) continue;
      if (loc.generator === 'mountains' && h > maxH * 0.62) continue;
      if (loc.generator === 'snow' && h > maxH * 0.5) continue;
      if (fieldMask(terrain.field, x, z, 60, 1) > 0.2) continue;
      if (loc.generator === 'raceway' && Math.hypot(x, z) < 1000) continue;
      if (terrain.buildings.length) {
        if (terrain.roofAt(x, z) > -Infinity) continue;
        if (Math.hypot(x, z) < 3200 && terrain.buildingHit({ x, y: h + 5, z }, 30)) continue;
      }
      const sc = 0.7 + rnd() * 0.7;
      p.set(x, h - 0.5, z);
      s.set(3.2 * sc, 11 * sc, 3.2 * sc);
      m4.compose(p, q, s);
      im.setMatrixAt(k, m4);
      tmpC.setHex(loc.generator === 'snow' ? 0x2f5a44 : 0x2f6a2c).multiplyScalar(0.75 + rnd() * 0.45);
      im.setColorAt(k, tmpC);
      k++;
    }
  }
  im.count = k;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.name = 'trees';
  return im;
}

function buildFieldLights(terrain) {
  const f = terrain.field;
  const pts = [];
  const cols = [];
  const hd = (f.heading * Math.PI) / 180;
  const fx = Math.sin(hd), fz = -Math.cos(hd);
  const rx = -fz, rz = fx;
  if (f.type === 'runway') {
    for (let u = -f.length / 2; u <= f.length / 2; u += 60) {
      for (const side of [-1, 1]) {
        const v = side * (f.width / 2 + 2);
        pts.push(f.x + fx * u + rx * v, f.elevation + 0.6, f.z + fz * u + rz * v);
        const end = Math.abs(Math.abs(u) - f.length / 2) < 1;
        cols.push(1, end ? 0.3 : 0.92, end ? 0.25 : 0.7);
      }
    }
    // 進入灯
    for (let d = 60; d <= 600; d += 60) {
      const u = -f.length / 2 - d;
      for (const v of [-6, 0, 6]) {
        pts.push(f.x + fx * u + rx * v, f.elevation + 1, f.z + fz * u + rz * v);
        cols.push(1, 1, 1);
      }
    }
  } else {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      pts.push(f.x + Math.cos(ang) * 60, f.elevation + 0.8, f.z + Math.sin(ang) * 60);
      cols.push(1, 0.85, 0.4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const m = new THREE.PointsMaterial({ size: 3.2, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts3 = new THREE.Points(g, m);
  pts3.name = 'fieldLights';
  pts3.visible = false;
  return pts3;
}

function buildTarget(terrain) {
  const f = terrain.field;
  const group = new THREE.Group();
  group.name = 'target';
  const tg = new THREE.PlaneGeometry(60, 60);
  tg.rotateX(-Math.PI / 2);
  const tm = new THREE.MeshBasicMaterial({ map: targetTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, fog: true });
  const t = new THREE.Mesh(tg, tm);
  const ground = terrain.heightAt(f.x, f.z);
  t.position.set(f.x, ground + 0.15, f.z);
  group.add(t);
  // 遠くから見える光の柱
  const bg = new THREE.CylinderGeometry(4, 4, 900, 8, 1, true);
  bg.translate(0, 450, 0);
  const bm = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(bg, bm);
  beam.position.set(f.x, ground, f.z);
  beam.name = 'beacon';
  group.add(beam);
  return group;
}

export { fieldLocal };
