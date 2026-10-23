// 環境: 地形・大気密度・風・乱気流・サーマル・斜面上昇風・雲（すべてシード固定）
import { Terrain } from './terrain.js';
import { createNoise2D } from './noise.js';
import { mulberry32, smoothstep, clamp, DEG } from './math.js';
import { TIMES, WEATHERS } from '../data/locations.js';

export const RHO0 = 1.225;

/** ISA 大気密度 [kg/m^3] */
export function airDensity(alt) {
  const h = clamp(alt, -200, 11000);
  return RHO0 * Math.pow(1 - 2.25577e-5 * h, 4.2559);
}

export class World {
  /**
   * opts: { seed, time, weather, calm, thermals(上書き) }
   */
  constructor(location, opts = {}) {
    this.location = location;
    this.seed = (opts.seed ?? 1234) >>> 0;
    this.time = TIMES[opts.time] || TIMES.noon;
    this.weather = WEATHERS[opts.weather] || WEATHERS.clear;
    this.calm = !!opts.calm;
    this.terrain = opts.terrain || new Terrain(location, this.seed);

    // 風（吹いていく方向の単位ベクトル）。windFrom は風が吹いてくる方位。
    const from = (location.windFrom ?? 270) * DEG;
    this.windDir = { x: -Math.sin(from), z: Math.cos(from) };
    this.windSpeed = this.calm ? 0 : this.weather.wind;
    this.turbulence = this.calm ? 0 : this.weather.turbulence;
    this.turbNoise = [createNoise2D(this.seed + 101), createNoise2D(this.seed + 102), createNoise2D(this.seed + 103)];

    this.thermals = opts.thermals ? opts.thermals.map((t) => ({ ...t })) : this.calm ? [] : this._genThermals();
    this.clouds = this._genClouds();
  }

  _genThermals() {
    const loc = this.location;
    const rnd = mulberry32(this.seed + 31);
    const strengthScale = this.time.thermal * this.weather.thermal;
    const list = [];
    const spawn = loc.airSpawn;
    let tries = 0;
    while (list.length < loc.thermals && tries < 400) {
      tries++;
      const a = rnd() * Math.PI * 2;
      const r = 300 + rnd() * 4200;
      const cx = (list.length % 2 === 0 ? spawn.x * 0.5 : 0) + Math.cos(a) * r;
      const cz = (list.length % 2 === 0 ? spawn.z * 0.5 : 0) + Math.sin(a) * r;
      if (Math.abs(cx) > 5500 || Math.abs(cz) > 5500) continue;
      const g = this.terrain.heightAt(cx, cz);
      if (this.terrain.water && g < 2) continue;
      const strength = (2.2 + rnd() * 2.6) * strengthScale;
      const radius = 110 + rnd() * 120;
      const top = g + loc.cloudBase * (0.8 + rnd() * 0.3) + 300;
      list.push({ x: cx, z: cz, radius, strength, top, ground: g });
    }
    return list;
  }

  _genClouds() {
    const loc = this.location;
    const rnd = mulberry32(this.seed + 57);
    const cover = this.weather.cloudCover;
    const list = [];
    // サーマルの上には積雲
    for (const t of this.thermals) {
      if (t.strength < 0.8) continue;
      list.push({ x: t.x, y: t.top - 150, z: t.z, r: 140 + t.radius * 0.9, thermal: true });
    }
    const n = Math.round(loc.clouds * (0.5 + cover));
    const base = this.terrain.minH > 0 ? this.terrain.minH : 0;
    for (let i = 0; i < n; i++) {
      list.push({
        x: (rnd() - 0.5) * 11000,
        z: (rnd() - 0.5) * 11000,
        y: base + loc.cloudBase * (0.85 + rnd() * 0.5) + (this.weather.id === 'cloudy' ? -250 : 0),
        r: 120 + rnd() * 260,
        thermal: false,
      });
    }
    return list;
  }

  density(alt) {
    return airDensity(alt);
  }

  /** 位置 p・時刻 t の空気の速度（風＋乱気流＋上昇気流） */
  airVelocity(p, t) {
    const terr = this.terrain;
    const ground = terr.surfaceAt(p.x, p.z);
    const agl = Math.max(0, p.y - ground);
    let wx = 0, wy = 0, wz = 0;
    if (this.windSpeed > 0) {
      const prof = 0.55 + 0.45 * smoothstep(0, 300, agl) + 0.35 * smoothstep(300, 1500, agl);
      const ws = this.windSpeed * prof;
      // 高さによる風向の変化（上空ほど時計回りに最大 100°）。熱気球はこれを使って進む向きを選ぶ
      const veer = this.windVeerAt(agl);
      const c = Math.cos(veer), sn = Math.sin(veer);
      wx = (this.windDir.x * c - this.windDir.z * sn) * ws;
      wz = (this.windDir.x * sn + this.windDir.z * c) * ws;
      // 斜面上昇風: 風が斜面を駆け上がる成分
      if (agl < 900) {
        const g = terr.gradient(p.x, p.z, 40);
        const up = (this.windDir.x * g.x + this.windDir.z * g.z) * this.windSpeed;
        const decay = Math.exp(-agl / 260);
        wy += clamp(up > 0 ? up : up * 0.6, -5, 7) * decay;
      }
    }
    if (this.turbulence > 0) {
      const [a, b, c] = this.turbNoise;
      const s = 1 / 220;
      const tt = t * 0.45;
      const I = this.turbulence * (1 + 0.6 * (1 - smoothstep(0, 400, agl)));
      wx += I * a(p.x * s + tt, p.z * s);
      wz += I * b(p.z * s - tt, p.y * s + p.x * s * 0.3);
      wy += I * 0.6 * c(p.x * s + p.y * s, p.z * s + tt);
    }
    if (this.thermals.length) wy += this.thermalLift(p, ground);
    return { x: wx, y: wy, z: wz };
  }

  /** 対地高度 agl での風向の回転 [rad]（地表 0 → 1500 m で約 100°） */
  windVeerAt(agl) {
    return 1.75 * smoothstep(80, 1500, agl);
  }

  /** 基本の風（乱気流・上昇気流を除く）の水平ベクトル */
  baseWindAt(agl) {
    if (!this.windSpeed) return { x: 0, z: 0 };
    const prof = 0.55 + 0.45 * smoothstep(0, 300, agl) + 0.35 * smoothstep(300, 1500, agl);
    const veer = this.windVeerAt(agl);
    const c = Math.cos(veer), sn = Math.sin(veer);
    return { x: (this.windDir.x * c - this.windDir.z * sn) * this.windSpeed * prof, z: (this.windDir.x * sn + this.windDir.z * c) * this.windSpeed * prof };
  }

  thermalLift(p, ground) {
    let w = 0;
    for (const th of this.thermals) {
      const dx = p.x - th.x;
      const dz = p.z - th.z;
      const r2 = dx * dx + dz * dz;
      const R = th.radius;
      if (r2 > 9 * R * R) continue;
      const agl = p.y - ground;
      const env = smoothstep(5, 120, agl) * (1 - smoothstep(th.top - 250, th.top, p.y));
      const r = Math.sqrt(r2);
      w += th.strength * env * (Math.exp(-r2 / (R * R)) - 0.18 * Math.exp(-((r - 2 * R) ** 2) / (R * R)));
    }
    return w;
  }
}
