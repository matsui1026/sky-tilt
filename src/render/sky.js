// 空・光・フォグ（時間帯と天候で雰囲気を変える）
import * as THREE from 'three';
import { mulberry32 } from '../sim/math.js';

const PRESETS = {
  morning: { top: 0x5a8fd6, horizon: 0xf2c8a2, sun: 0xffd2a0, sunI: 1.7, hemiSky: 0xbcd0f0, hemiGround: 0x6a5a48, hemiI: 0.75, fog: 0xe9cdb5, stars: 0 },
  noon: { top: 0x2f6fd0, horizon: 0xbcd7f0, sun: 0xffffff, sunI: 2.4, hemiSky: 0xcfe3ff, hemiGround: 0x5d5a4a, hemiI: 0.9, fog: 0xc4dbf0, stars: 0 },
  evening: { top: 0x2f3f78, horizon: 0xff925a, sun: 0xff8a4a, sunI: 1.5, hemiSky: 0x9a8fb8, hemiGround: 0x5a3a2a, hemiI: 0.6, fog: 0xe8a080, stars: 0.15 },
  night: { top: 0x040818, horizon: 0x18213e, sun: 0x8ea6d8, sunI: 0.45, hemiSky: 0x2a3a66, hemiGround: 0x101018, hemiI: 0.35, fog: 0x141c34, stars: 1 },
};

const FOG = { clear: 0.000085, cloudy: 0.00019, windy: 0.00012 };

export function skyParams(timeId, weatherId) {
  const p = { ...PRESETS[timeId] || PRESETS.noon };
  const grey = new THREE.Color(0x9aa3ad);
  const c = (hex) => new THREE.Color(hex);
  p.top = c(p.top); p.horizon = c(p.horizon); p.sun = c(p.sun); p.hemiSky = c(p.hemiSky); p.hemiGround = c(p.hemiGround); p.fog = c(p.fog);
  if (weatherId === 'cloudy') {
    const k = timeId === 'night' ? 0.25 : 0.6;
    p.top.lerp(grey.clone().multiplyScalar(timeId === 'night' ? 0.15 : 0.85), k);
    p.horizon.lerp(grey.clone().multiplyScalar(timeId === 'night' ? 0.2 : 1.0), k);
    p.fog.lerp(grey.clone().multiplyScalar(timeId === 'night' ? 0.2 : 0.95), k);
    p.sunI *= 0.45;
    p.hemiI *= 1.1;
    p.stars *= 0.2;
  } else if (weatherId === 'windy') {
    p.top.lerp(grey, 0.2);
    p.horizon.lerp(grey, 0.25);
    p.fog.lerp(grey, 0.25);
    p.sunI *= 0.8;
  }
  p.fogDensity = (FOG[weatherId] || FOG.clear) * (timeId === 'night' ? 1.3 : 1);
  return p;
}

export function createSky(scene, world) {
  const time = world.time;
  const p = skyParams(time.id, world.weather.id);
  const el = (time.sunElev * Math.PI) / 180;
  const az = (time.sunAzim * Math.PI) / 180;
  // 天体の方向（北 = -z, 東 = +x）
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  // 夜は月を光源にする
  const lightDir = time.id === 'night' ? new THREE.Vector3(-0.4, 0.6, 0.5).normalize() : sunDir.clone();

  const geo = new THREE.SphereGeometry(20000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: p.top },
      uHorizon: { value: p.horizon },
      uSunDir: { value: sunDir.clone() },
      uSunCol: { value: p.sun.clone() },
      uSunVis: { value: time.id === 'night' ? 0 : 1 },
      uMoonDir: { value: lightDir.clone() },
      uMoon: { value: time.id === 'night' ? 1 : 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunVis; uniform vec3 uMoonDir; uniform float uMoon; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        float t = pow(clamp(h, 0.0, 1.0), 0.45);
        vec3 col = mix(uHorizon, uTop, t);
        col = mix(col, uHorizon * 0.8, clamp(-h * 4.0, 0.0, 1.0));
        float sd = max(dot(normalize(vDir), uSunDir), 0.0);
        col += uSunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.35) * uSunVis;
        float md = max(dot(normalize(vDir), uMoonDir), 0.0);
        col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, md) * uMoon;
        col += vec3(0.2, 0.25, 0.4) * pow(md, 30.0) * 0.4 * uMoon;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = 'sky';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  let stars = null;
  if (p.stars > 0) {
    const rnd = mulberry32(world.seed + 5);
    const N = 1400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 18000;
      pos[i * 3 + 1] = y * 18000;
      pos[i * 3 + 2] = Math.sin(th) * r * 18000;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sm = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: p.stars * 0.9, fog: false, depthWrite: false });
    stars = new THREE.Points(sg, sm);
    stars.frustumCulled = false;
    stars.name = 'stars';
    scene.add(stars);
  }

  const sun = new THREE.DirectionalLight(p.sun, p.sunI);
  sun.position.copy(lightDir).multiplyScalar(1000);
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiI);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
  scene.background = p.fog.clone();

  return {
    params: p, dome, stars, sun, hemi, sunDir, isNight: time.id === 'night', isDusk: time.id === 'evening' || time.id === 'night',
    follow(camPos) {
      dome.position.copy(camPos);
      if (stars) stars.position.copy(camPos);
    },
  };
}
