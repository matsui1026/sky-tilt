// 高さマップ地形（格子）。描画と当たり判定が同じ格子・同じ三角形分割を使う。
import { GENERATORS, fieldMask, fieldLocal } from './terrainGen.js';
import { lerp, clamp } from './math.js';
import { Track, fieldCircuit } from './track.js';

export const TERRAIN_SIZE = 12000; // 一辺 [m]（中心が原点）
export const TERRAIN_SEGMENTS = 256;

export class Terrain {
  constructor(location, seed, { segments = TERRAIN_SEGMENTS, size = TERRAIN_SIZE } = {}) {
    this.location = location;
    this.seed = seed;
    this.size = size;
    this.half = size / 2;
    this.n = segments;
    this.cell = size / segments;
    this.water = !!location.water;
    const gen = GENERATORS[location.generator](seed);
    let field = { ...location.field };
    if (gen.fieldPos) field = gen.fieldPos(field);
    if (field.elevation == null) field.elevation = Math.max(4, gen.raw(field.x, field.z));
    this.field = field;

    const n1 = segments + 1;
    const h = new Float32Array(n1 * n1);
    for (let j = 0; j < n1; j++) {
      const z = -this.half + j * this.cell;
      for (let i = 0; i < n1; i++) {
        const x = -this.half + i * this.cell;
        let y = gen.raw(x, z);
        const m = fieldMask(field, x, z);
        if (m > 0) y = lerp(y, field.elevation, m);
        h[j * n1 + i] = y;
      }
    }
    this.heights = h;
    let minH = Infinity, maxH = -Infinity;
    for (let k = 0; k < h.length; k++) { if (h[k] < minH) minH = h[k]; if (h[k] > maxH) maxH = h[k]; }
    this.minH = minH;
    this.maxH = maxH;
    // 外周より外は端の値を使う（クランプ）

    this.buildings = [];
    if (gen.buildings) {
      this.buildings = gen.buildings({
        height: (x, z) => this.heightAt(x, z),
        nearField: (x, z, m) => fieldMask(field, x, z, m, 1) > 0.5,
      });
    }
    this._buildGrid();
    this._buildTrack();
  }

  /** 格子上の生値 */
  _h(i, j) {
    const n1 = this.n + 1;
    i = clamp(i, 0, this.n);
    j = clamp(j, 0, this.n);
    return this.heights[j * n1 + i];
  }

  /**
   * 高さ。描画メッシュと同じ三角形分割で補間する。
   * セル (i,j) は三角形 (i,j)-(i,j+1)-(i+1,j) と (i,j+1)-(i+1,j+1)-(i+1,j)。
   */
  heightAt(x, z) {
    const gx = clamp((x + this.half) / this.cell, 0, this.n - 1e-6);
    const gz = clamp((z + this.half) / this.cell, 0, this.n - 1e-6);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const h00 = this._h(i, j);
    const h10 = this._h(i + 1, j);
    const h01 = this._h(i, j + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    const h11 = this._h(i + 1, j + 1);
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** 接地面の高さ（水面を含む） */
  surfaceAt(x, z) {
    const h = this.heightAt(x, z);
    return this.water && h < 0 ? 0 : h;
  }

  isWater(x, z) {
    return this.water && this.heightAt(x, z) < 0;
  }

  /** 勾配 (dh/dx, dh/dz)。差分幅 d で平滑化 */
  gradient(x, z, d = 30) {
    return {
      x: (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d),
      z: (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d),
    };
  }

  slopeAt(x, z) {
    const g = this.gradient(x, z, 8);
    return Math.atan(Math.hypot(g.x, g.z));
  }

  /** 走行コースとジャンプ台・コーン・広場 */
  _buildTrack() {
    const loc = this.location;
    const def = loc.track || {};
    const ctrl = def.ctrl || fieldCircuit(this.field);
    const grip = { snow: 0.42, dirt: 0.72 }[def.surface] || 1;
    this.track = new Track(ctrl, { width: def.width || 16, surface: def.surface || 'asphalt', grip, heightAt: (x, z) => this.heightAt(x, z) });
    this.laps = def.laps || 2;
    this.pads = (def.pads || []).map((p) => ({ ...p }));
    // ジャンプ台: コース上の位置（周の割合）と左右のずれで指定
    this.ramps = (def.ramps || []).map((r) => {
      const p = this.track.at(r.at * this.track.length, r.offset || 0);
      const hd = p.heading;
      return { x: p.x, z: p.z, heading: hd, fx: Math.sin(hd), fz: -Math.cos(hd), len: r.len || 16, width: r.width || 7, height: r.height || 2.2, base: p.y };
    });
    // コーン: カーブの内側に並べる（数を抑えて 1 ドローコール）
    this.cones = [];
    const t = this.track;
    let lastS = -100;
    for (const p of t.pts) {
      if (Math.abs(p.k) < 1 / 90 || p.s - lastS < 24 || this.cones.length >= 60) continue;
      lastS = p.s;
      const side = p.k > 0 ? 1 : -1; // 曲がる側が内側
      const off = side * (t.width / 2 + 1.2);
      const x = p.x + -p.tz * off, z = p.z + p.tx * off;
      if (this.water && this.heightAt(x, z) < 0) continue;
      this.cones.push({ x, z, y: this.heightAt(x, z) });
    }
    this.startPoint = t.at(0);
  }

  /** ジャンプ台の高さ（無ければ -Infinity） */
  rampAt(x, z) {
    if (!this.ramps || !this.ramps.length) return -Infinity;
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      const u = dx * r.fx + dz * r.fz;
      if (Math.abs(u) > r.len / 2) continue;
      const v = dx * -r.fz + dz * r.fx;
      if (Math.abs(v) > r.width / 2) continue;
      return r.base + (r.height * (u + r.len / 2)) / r.len;
    }
    return -Infinity;
  }

  /** 車の路面の種類（car.js の SURFACES のキー） */
  surfaceKind(x, z) {
    if (this.isWater(x, z)) return 'water';
    if (this.roofAt(x, z) >= this.surfaceAt(x, z)) return 'concrete';
    if (this.track && this.track.onRoad(x, z)) return this.track.surface;
    if (this.pads) for (const p of this.pads) if (Math.hypot(x - p.x, z - p.z) <= p.r) return 'asphalt';
    const f = this.field;
    const { u, v } = fieldLocal(f, x, z);
    if (Math.abs(u) <= f.length / 2 && Math.abs(v) <= f.width / 2) return f.surface || 'asphalt';
    return this._groundKind(x, z);
  }

  _groundKind(x, z) {
    const g = this.location.generator;
    const steep = this.slopeAt(x, z) > 0.45;
    if (g === 'snow') return steep ? 'rock' : 'snow';
    if (g === 'desert') return steep ? 'rock' : 'sand';
    if (g === 'mountains') return steep ? 'rock' : 'grass';
    if (g === 'city' && Math.hypot(x, z) < 3150) return 'asphalt';
    if (g === 'island' && this.heightAt(x, z) < 3.5) return 'sand';
    return steep ? 'rock' : 'grass';
  }

  /** 地表の種類: 'runway' | 'field' | 'water' | 'ground' */
  surfaceType(x, z) {
    if (this.isWater(x, z)) return 'water';
    const f = this.field;
    const { u, v } = fieldLocal(f, x, z);
    if (Math.abs(u) <= f.length / 2 + 30 && Math.abs(v) <= f.width / 2 + 6) return f.type === 'runway' ? 'runway' : 'field';
    return 'ground';
  }

  _buildGrid() {
    this.bcell = 100;
    this.bgrid = new Map();
    this.buildings.forEach((b, idx) => {
      const r = Math.max(b.w, b.d) / 2;
      const i0 = Math.floor((b.x - r) / this.bcell), i1 = Math.floor((b.x + r) / this.bcell);
      const j0 = Math.floor((b.z - r) / this.bcell), j1 = Math.floor((b.z + r) / this.bcell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = i * 100003 + j;
        let a = this.bgrid.get(k);
        if (!a) { a = []; this.bgrid.set(k, a); }
        a.push(idx);
      }
    });
  }

  /** 半径 r の球がビルと接触していればそのビルを返す */
  buildingHit(p, r = 1) {
    if (!this.buildings.length) return null;
    const i = Math.floor(p.x / this.bcell);
    const j = Math.floor(p.z / this.bcell);
    const list = this.bgrid.get(i * 100003 + j);
    if (!list) return null;
    for (const idx of list) {
      const b = this.buildings[idx];
      if (p.y - r > b.base + b.h) continue;
      if (Math.abs(p.x - b.x) <= b.w / 2 + r && Math.abs(p.z - b.z) <= b.d / 2 + r && p.y + r >= b.base) return b;
    }
    return null;
  }

  /** (x,z) の真下にあるビルの屋上高さ（なければ -Infinity） */
  roofAt(x, z) {
    if (!this.buildings.length) return -Infinity;
    const list = this.bgrid.get(Math.floor(x / this.bcell) * 100003 + Math.floor(z / this.bcell));
    if (!list) return -Infinity;
    let top = -Infinity;
    for (const idx of list) {
      const b = this.buildings[idx];
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) top = Math.max(top, b.base + b.h);
    }
    return top;
  }
}
