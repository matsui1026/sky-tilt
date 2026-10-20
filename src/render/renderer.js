// Three.js による描画のまとめ役
import * as THREE from 'three';
import { buildTerrain } from './terrainMesh.js';
import { createSky } from './sky.js';
import { buildClouds } from './clouds.js';
import { buildVehicleModel } from './models.js';
import { createSpeedLines, createRings, createShadow, CameraRig } from './effects.js';
import { clamp } from '../sim/math.js';

export const MAX_DPR = 2;

export class FlightRenderer {
  constructor(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 1.5, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.setPixelRatio(dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 30000);
    this.rig = new CameraRig(this.camera);
    this.scene = null;
    this.cloudDensity = 0;
    this.t = 0;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** ワールドと機体を構築（前回分は破棄） */
  load(world, def, rings, mode = 'free') {
    this.disposeScene();
    const scene = new THREE.Scene();
    this.scene = scene;
    this.world = world;
    this.def = def;
    this.sky = createSky(scene, world);
    this.terrain = buildTerrain(world);
    scene.add(this.terrain.group);
    this.clouds = buildClouds(world, this.sky.params);
    scene.add(this.clouds.mesh);
    this.model = buildVehicleModel(def);
    scene.add(this.model.root);
    this.shadow = createShadow();
    scene.add(this.shadow);
    this.rings = rings && rings.length ? createRings(rings) : null;
    if (this.rings) scene.add(this.rings.group);
    this.speedLines = createSpeedLines();
    this.camera.add(this.speedLines.object);
    scene.add(this.camera);
    const night = world.time.id === 'night';
    const dusk = world.time.id === 'evening';
    this.terrain.lights.visible = night || dusk;
    if (this.terrain.buildings) this.terrain.buildings.material.userData.night.value = night ? 1 : dusk ? 0.5 : 0;
    // 着陸ターゲットは人・ヘリ系と着陸チャレンジで表示
    const showTarget = def.model !== 'fixedwing' || mode === 'landing';
    this.terrain.target.visible = showTarget;
    this.baseFog = scene.fog.density;
    this.rig.setMode(this.rig.mode);
    this.rig.initialized = false;
    this._vPos = new THREE.Vector3();
    this._vQ = new THREE.Quaternion();
  }

  disposeScene() {
    if (!this.scene) return;
    if (this.speedLines) this.camera.remove(this.speedLines.object);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const k of ['map', 'emissiveMap']) if (m[k]) m[k].dispose();
          m.dispose();
        }
      }
    });
    this.renderer.renderLists.dispose();
    this.scene = null;
  }

  setCameraMode(m) {
    this.rig.setMode(m);
  }

  /**
   * prev/cur: { pos, q } のスナップショット、alpha: 補間係数
   * state: sim.getState()、vs: 機体の内部状態
   */
  render(dt, prev, cur, alpha, state, vs) {
    if (!this.scene) return;
    this.t += dt;
    const vp = this._vPos.set(
      prev.pos.x + (cur.pos.x - prev.pos.x) * alpha,
      prev.pos.y + (cur.pos.y - prev.pos.y) * alpha,
      prev.pos.z + (cur.pos.z - prev.pos.z) * alpha,
    );
    const qa = new THREE.Quaternion(prev.q.x, prev.q.y, prev.q.z, prev.q.w);
    const qb = new THREE.Quaternion(cur.q.x, cur.q.y, cur.q.z, cur.q.w);
    const vq = this._vQ.copy(qa).slerp(qb, alpha);
    const m = this.model;
    m.root.position.copy(vp);
    m.root.quaternion.copy(vq);
    m.update(vs, dt, this.t);
    m.root.visible = this.rig.mode !== 'cockpit' || this.def.model === 'paraglider';

    const terr = this.world.terrain;
    const ground = Math.max(terr.surfaceAt(vp.x, vp.z), terr.roofAt(vp.x, vp.z));
    const agl = vp.y - ground;
    this.shadow.visible = agl < 220 && state.status !== 'crashed';
    if (this.shadow.visible) {
      const size = (this.model.root.userData.size || sizeOf(this.def)) * (1 + agl * 0.01);
      this.shadow.position.set(vp.x, ground + 0.2, vp.z);
      this.shadow.scale.set(size, 1, size);
      this.shadow.material.opacity = clamp(1 - agl / 220, 0, 1);
    }

    const att = state.attitude;
    const D2R = Math.PI / 180;
    const flightPath = Math.atan2(state.vs, Math.max(state.groundSpeed, 0.1));
    const shakeBase = { prop: 0.0012, airliner: 0.0006, fighter: 0.0014, heli: 0.0022, jetsuit: 0.002 }[this.def.id] || 0;
    const turb = this.world.turbulence * 0.0012 * clamp(state.speed / 60, 0, 1);
    const shake = state.onGround ? shakeBase * 0.5 + clamp(state.groundSpeed / 60, 0, 1) * 0.002 : shakeBase * (state.throttle ?? 0) + turb + (state.ab ? 0.0015 : 0);
    this.rig.update(dt, this.def, vq, vp, {
      heading: att.heading * D2R, pitch: att.pitch * D2R, roll: att.roll * D2R, flightPath,
      speed: state.speed, ab: state.ab, shake, ground, phase: state.phase,
    });
    this.sky.follow(this.camera.position);

    // 雲の中
    const cd = this.clouds.density(this.camera.position);
    this.cloudDensity += (cd - this.cloudDensity) * (1 - Math.exp(-dt / 0.15));
    this.scene.fog.density = this.baseFog * (1 + this.cloudDensity * 60);

    // スピードライン
    const sl = clamp((state.speed - 45) / 160, 0, 1) * (state.onGround ? 0.3 : 1);
    this.speedLines.update(dt, state.speed, sl);

    if (this.rings) this.rings.update(state, this.t);
    const beacon = this.terrain.target.getObjectByName('beacon');
    if (beacon) beacon.material.opacity = 0.12 + 0.1 * (0.5 + 0.5 * Math.sin(this.t * 2));

    this.renderer.render(this.scene, this.camera);
  }

  info() {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, pixelRatio: this.renderer.getPixelRatio() };
  }
}

function sizeOf(def) {
  return { prop: 11, airliner: 36, fighter: 12, heli: 10, paraglider: 4, jetsuit: 2, wingsuit: 3, skydive: 2.5 }[def.id] || 5;
}
