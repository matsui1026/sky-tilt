// 高さマップ地形（格子）。描画と当たり判定が同じ格子・同じ三角形分割を使う。
import { GENERATORS, fieldMask, fieldLocal } from './terrainGen.js';
import { lerp, clamp } from './math.js';

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
