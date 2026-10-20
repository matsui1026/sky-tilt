// 雲（低ポリゴンのパフをインスタンス描画）。カメラが雲の中に入ったかも判定する。
import * as THREE from 'three';
import { mulberry32 } from '../sim/math.js';

export function buildClouds(world, skyParams) {
  const rnd = mulberry32(world.seed + 21);
  const puffs = [];
  for (const c of world.clouds) {
    const k = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < k; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * c.r * 0.9;
      const r = c.r * (0.35 + rnd() * 0.4);
      puffs.push({ x: c.x + Math.cos(a) * d, y: c.y + (rnd() - 0.3) * c.r * 0.25, z: c.z + Math.sin(a) * d, r, sy: 0.55 + rnd() * 0.2 });
    }
  }
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const tint = skyParams.horizon.clone().lerp(new THREE.Color(0xffffff), 0.75);
  if (world.time.id === 'night') tint.setHex(0x3a4360);
  else if (world.time.id === 'evening') tint.lerp(new THREE.Color(0xffb38a), 0.35);
  if (world.weather.id === 'cloudy') tint.multiplyScalar(0.88);
  const mat = new THREE.MeshLambertMaterial({ color: tint, flatShading: true, transparent: true, opacity: 0.92, emissive: tint.clone().multiplyScalar(0.35) });
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, puffs.length));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  puffs.forEach((pf, i) => {
    p.set(pf.x, pf.y, pf.z);
    s.set(pf.r, pf.r * pf.sy, pf.r);
    m4.compose(p, q, s);
    im.setMatrixAt(i, m4);
  });
  im.count = puffs.length;
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.name = 'clouds';
  return {
    mesh: im,
    puffs,
    /** 点 p が雲の中にどれだけ深く入っているか（0..1） */
    density(pos) {
      let d = 0;
      for (const pf of puffs) {
        const dx = (pos.x - pf.x) / pf.r;
        const dy = (pos.y - pf.y) / (pf.r * pf.sy);
        const dz = (pos.z - pf.z) / pf.r;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1.2) d = Math.max(d, Math.min(1, (1.2 - r2) * 2.5));
      }
      return d;
    },
  };
}
