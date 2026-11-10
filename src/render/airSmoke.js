// 曲技用のスモーク（機体の後ろに残る煙の帯）。Points 1 つ・古い粒から上書き
import * as THREE from 'three';

export const SMOKE_COLORS = [
  { id: 'white', name: '白', hex: 0xf4f6f8 },
  { id: 'red', name: '赤', hex: 0xff4a4a },
  { id: 'blue', name: '青', hex: 0x4aa8ff },
  { id: 'green', name: '緑', hex: 0x4ae08a },
];

function puff() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAirSmoke({ count = 1400, life = 10, spacing = 3 } = {}) {
  const pos = new Float32Array(count * 3).fill(-1e7);
  const col = new Float32Array(count * 4);
  const born = new Float32Array(count).fill(-1e9);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: Math.max(3, spacing * 2.4), map: puff(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
  points.frustumCulled = false;
  points.name = 'airSmoke';
  points.renderOrder = 3;
  let idx = 0;
  let lastP = null;
  let active = 0; // 生きている粒があるか（無いときは描かない）
  const color = new THREE.Color();
  return {
    object: points,
    /** on: 出しているか、hex: 色、p: 出す位置（機体の後ろ）、t: 経過時間 */
    update(t, on, hex, p) {
      if (on && p) {
        if (!lastP) lastP = { x: p.x, y: p.y, z: p.z };
        const d = Math.hypot(p.x - lastP.x, p.y - lastP.y, p.z - lastP.z);
        if (d > 400) lastP = { x: p.x, y: p.y, z: p.z }; // 飛び直しなどで離れたらつながない
        else if (d >= spacing) {
          const n = Math.min(120, Math.floor(d / spacing)); // 描画が遅い端末でも帯が途切れないように
          color.setHex(hex);
          for (let k = 1; k <= n; k++) {
            const f = k / n;
            pos[idx * 3] = lastP.x + (p.x - lastP.x) * f;
            pos[idx * 3 + 1] = lastP.y + (p.y - lastP.y) * f;
            pos[idx * 3 + 2] = lastP.z + (p.z - lastP.z) * f;
            col[idx * 4] = color.r; col[idx * 4 + 1] = color.g; col[idx * 4 + 2] = color.b;
            born[idx] = t;
            idx = (idx + 1) % count;
          }
          lastP = { x: p.x, y: p.y, z: p.z };
          active = life;
          geo.attributes.position.needsUpdate = true;
        }
      } else lastP = null;
      if (active <= 0) { points.visible = false; return; }
      points.visible = true;
      let newest = -1e9;
      for (let i = 0; i < count; i++) {
        const age = t - born[i];
        col[i * 4 + 3] = age < life ? 0.7 * Math.min(1, age * 4 + 0.3) * (1 - age / life) : 0;
        if (born[i] > newest) newest = born[i];
      }
      active = life - (t - newest);
      geo.attributes.color.needsUpdate = true;
    },
    clear() {
      born.fill(-1e9);
      lastP = null;
      active = 0;
      points.visible = false;
    },
  };
}
