// Three.js による描画のまとめ役
import * as THREE from 'three';
import { buildTerrain } from './terrainMesh.js';
import { createSky } from './sky.js';
import { buildClouds } from './clouds.js';
import { buildVehicleModel } from './models.js';
import { createSpeedLines, createRings, createShadow, CameraRig } from './effects.js';
import { createCombatView } from './combatView.js';
import { clamp } from '../sim/math.js';
import { getVehicle } from '../data/vehicles.js';

export const MAX_DPR = 2;

/** 名前の札（2 人プレイの相手・ゴースト） */
function labelSprite(text, color = '#3affb0') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.roundRect(4, 4, 248, 56, 14); g.fill();
  g.fillStyle = color;
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.slice(0, 12), 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, depthTest: false, fog: false, transparent: true }));
  s.renderOrder = 20;
  return s;
}

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
    this.qualityScale = 1; // 自動画質で下げる解像度の倍率
    this.ghosts = new Map();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, MAX_DPR) * this.qualityScale;
  }

  setQualityScale(k) {
    const nk = clamp(k, 0.5, 1);
    if (Math.abs(nk - this.qualityScale) < 1e-3) return;
    this.qualityScale = nk;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** ワールドと機体を構築（前回分は破棄） */
  load(world, def, rings, mode = 'free', combat = null) {
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
    this.rings = rings && rings.length ? createRings(rings, world) : null;
    if (this.rings) scene.add(this.rings.group);
    this.combatView = combat ? createCombatView(combat) : null;
    if (this.combatView) scene.add(this.combatView.group);
    this.speedLines = createSpeedLines();
    this.camera.add(this.speedLines.object);
    scene.add(this.camera);
    const night = world.time.id === 'night';
    const dusk = world.time.id === 'evening';
    this.terrain.lights.visible = night || dusk;
    if (this.terrain.buildings) this.terrain.buildings.material.userData.night.value = night ? 1 : dusk ? 0.5 : 0;
    // 着陸ターゲットは人・ヘリ系と着陸チャレンジで表示
    const showTarget = (def.model !== 'fixedwing' || mode === 'landing') && mode !== 'combat';
    this.terrain.target.visible = showTarget;
    this.baseFog = scene.fog.density;
    this.rig.setMode(this.rig.mode);
    this.rig.initialized = false;
    this._vPos = new THREE.Vector3();
    this._vQ = new THREE.Quaternion();
    this.ghosts = new Map();
  }

  /**
   * 2 人プレイの相手やゴーストの機体。key ごとに 1 つ。
   * opts: { label, color, opacity }
   */
  setGhost(key, vehicleId, opts = {}) {
    if (!this.scene) return null;
    let g = this.ghosts.get(key);
    if (g && g.vehicleId === vehicleId) return g;
    if (g) { this.scene.remove(g.group); this.ghosts.delete(key); }
    const def = getVehicle(vehicleId);
    const model = buildVehicleModel(def);
    const group = new THREE.Group();
    group.add(model.root);
    if (opts.opacity != null && opts.opacity < 1) {
      model.root.traverse((o) => {
        if (o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = opts.opacity;
          o.material.depthWrite = false;
        }
      });
    }
    let label = null;
    if (opts.label) {
      label = labelSprite(opts.label, opts.color);
      group.add(label);
    }
    this.scene.add(group);
    g = { key, vehicleId, def, model, group, label, vs: {} };
    this.ghosts.set(key, g);
    return g;
  }

  removeGhost(key) {
    const g = this.ghosts.get(key);
    if (g && this.scene) this.scene.remove(g.group);
    this.ghosts.delete(key);
  }

  /** ゴーストの姿勢を更新（pos, q と、描画用の付帯情報 vs） */
  updateGhost(key, pos, q, vs = {}, dt = 0) {
    const g = this.ghosts.get(key);
    if (!g) return;
    g.group.visible = !!pos;
    if (!pos) return;
    g.model.root.position.set(0, 0, 0);
    g.group.position.set(pos.x, pos.y, pos.z);
    g.model.root.quaternion.set(q.x, q.y, q.z, q.w);
    g.model.update(vs, dt, this.t);
    if (g.label) {
      const d = this.camera.position.distanceTo(g.group.position);
      const s = clamp(d * 0.05, 4, 400);
      g.label.scale.set(s, s / 4, 1);
      g.label.position.set(0, s * 0.4 + 4, 0);
    }
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

  combatEvent(ev) {
    if (this.combatView) this.combatView.event(ev);
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
    m.root.visible = this.rig.mode !== 'cockpit' || this.def.model === 'paraglider' || this.def.model === 'balloon';

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
    const shakeBase = { prop: 0.0012, airliner: 0.0006, fighter: 0.0014, heli: 0.0022, jetsuit: 0.002, drone: 0.0008, flycar: 0.0012 }[this.def.id] || 0;
    const turb = this.world.turbulence * 0.0012 * clamp(state.speed / 60, 0, 1);
    const shake = state.onGround ? shakeBase * 0.5 + clamp(state.groundSpeed / 60, 0, 1) * 0.002 : shakeBase * (state.throttle ?? 0) + turb + (state.ab ? 0.0015 : 0);
    this.rig.update(dt, this.def, vq, vp, {
      heading: att.heading * D2R, pitch: att.pitch * D2R, roll: att.roll * D2R, flightPath,
      speed: state.speed, ab: state.ab, shake, ground, phase: state.phase, carMode: state.carMode,
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
    if (this.combatView) this.combatView.update(dt, this.t);
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
  return { prop: 11, airliner: 36, fighter: 12, sailplane: 17, heli: 10, drone: 0.6, flycar: 5, balloon: 14, paraglider: 4, jetsuit: 2, wingsuit: 3, skydive: 2.5 }[def.id] || 5;
}
