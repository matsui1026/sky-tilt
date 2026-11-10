// スター集めの描画: 回る星（InstancedMesh 1 つ）と、遠くからでも分かる光（Points 1 つ）
import * as THREE from 'three';
import { glowTexture } from './textures.js';

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.45;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
  g.translate(0, 0, -0.15);
  return g;
}

/**
 * stars: sim.stars（{ list: [{pos}], got: Set }）、size: 星の半径 [m]
 */
export function createStarsView(stars, size = 6) {
  const group = new THREE.Group();
  group.name = 'stars';
  const n = stars.list.length;
  const mesh = new THREE.InstancedMesh(starGeometry(), new THREE.MeshBasicMaterial({ color: 0xffd23a, fog: false }), n);
  mesh.frustumCulled = false;
  mesh.name = 'starMesh';
  group.add(mesh);
  const gPos = new Float32Array(n * 3);
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  const glow = new THREE.Points(gGeo, new THREE.PointsMaterial({ size: 18, sizeAttenuation: false, map: glowTexture(), color: 0xffd23a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.frustumCulled = false;
  glow.name = 'starGlow';
  group.add(glow);
  // 取った瞬間の演出（大きくなって消える）
  const pop = new Map();
  const dummy = new THREE.Object3D();
  const HIDE = 1e7;
  return {
    group,
    event(ev) {
      if (ev.type === 'star') pop.set(ev.index, 0);
    },
    update(dt, t) {
      for (let i = 0; i < n; i++) {
        const p = stars.list[i].pos;
        let s = size * (1 + 0.08 * Math.sin(t * 3 + i));
        let shown = !stars.got.has(i);
        if (pop.has(i)) {
          const a = pop.get(i) + dt / 0.35;
          if (a >= 1) pop.delete(i);
          else { pop.set(i, a); s = size * (1 + a * 1.6); shown = true; }
        }
        dummy.position.set(p.x, p.y + Math.sin(t * 1.7 + i * 2.1) * size * 0.15, p.z);
        dummy.rotation.set(0, t * 1.8 + i, 0);
        dummy.scale.setScalar(shown ? s : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        gPos[i * 3] = p.x;
        gPos[i * 3 + 1] = stars.got.has(i) ? -HIDE : p.y;
        gPos[i * 3 + 2] = p.z;
      }
      mesh.instanceMatrix.needsUpdate = true;
      gGeo.attributes.position.needsUpdate = true;
    },
  };
}
