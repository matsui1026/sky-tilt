// 機体ごとの HUD（Canvas 2D）
// basic: 小型機 / pfd: 旅客機（PFD 風）/ fighter: 戦闘機（緑の HUD）/ heli: ヘリ・ジェットスーツ / glide: 滑空系・スカイダイビング
import { clamp } from '../sim/math.js';

const KMH = 3.6;
const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.safe = { l: 0, r: 0, t: 0, b: 0 };
    this.maxG = 1;
    this.type = 'basic';
    this.blink = 0;
    this.resize();
  }
  setSafe(s) { this.safe = s; }
  setVehicle(def) {
    this.def = def;
    this.type = def.hud;
    this.maxG = 1;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
  }
  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(st, extra = {}) {
    const c = this.ctx;
    this.clear();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.blink += 1 / 60;
    if (st.g > this.maxG) this.maxG = st.g;
    // 左手の操作 UI とスロットルの間の空き領域に合わせて配置する
    const b = this.bounds || { l: 0, r: this.W };
    this.cx = (b.l + b.r) / 2;
    this.half = (b.r - b.l) / 2;
    this.sp = clamp(this.half - 56, 95, 165);
    this.rects = [];
    const fn = { basic: this.drawBasic, pfd: this.drawPfd, fighter: this.drawFighter, heli: this.drawHeli, glide: this.drawGlide }[this.type] || this.drawBasic;
    fn.call(this, st, extra);
    this.drawCommon(st, extra);
  }

  setBounds(l, r) {
    this.bounds = { l, r };
  }

  /** 描いた枠の画面上の矩形（CSS px）を記録する（レイアウト検査用） */
  record(x, y, w, h, name) {
    const m = this.ctx.getTransform();
    const p0 = m.transformPoint({ x, y });
    const p1 = m.transformPoint({ x: x + w, y: y + h });
    const d = this.dpr;
    this.rects.push({ name, left: Math.min(p0.x, p1.x) / d, top: Math.min(p0.y, p1.y) / d, right: Math.max(p0.x, p1.x) / d, bottom: Math.max(p0.y, p1.y) / d });
  }

  // ---------- 共通部品 ----------
  text(s, x, y, { size = 14, color = '#fff', align = 'center', weight = 700, shadow = true, base = 'middle' } = {}) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    c.textAlign = align;
    c.textBaseline = base;
    if (shadow) {
      c.fillStyle = 'rgba(0,0,0,0.65)';
      c.fillText(s, x + 1, y + 1);
    }
    c.fillStyle = color;
    c.fillText(s, x, y);
  }
  box(x, y, w, h, { fill = 'rgba(8,16,28,0.55)', stroke = 'rgba(255,255,255,0.55)', r = 8 } = {}) {
    const c = this.ctx;
    this.record(x, y, w, h, 'box');
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
  }
  valueBox(label, value, unit, x, y, { w = 96, color = '#fff', align = 'center' } = {}) {
    const h = 46;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    this.box(left, y - h / 2, w, h);
    this.text(label, left + w / 2, y - 13, { size: 10, color: 'rgba(220,230,240,0.85)', weight: 600, shadow: false });
    this.text(value, left + w / 2 - (unit ? 8 : 0), y + 6, { size: 19, color });
    if (unit) this.text(unit, left + w - 6, y + 9, { size: 10, align: 'right', color: 'rgba(220,230,240,0.85)', weight: 600, shadow: false });
  }
  headingTape(hdg, y, w = 260, color = '#fff') {
    const c = this.ctx;
    const cx = this.cx;
    c.save();
    c.beginPath();
    c.rect(cx - w / 2, y - 16, w, 34);
    c.clip();
    const pxPerDeg = w / 90;
    c.strokeStyle = color;
    c.lineWidth = 1.5;
    for (let d = Math.floor(hdg - 50); d <= hdg + 50; d++) {
      if (d % 5) continue;
      const x = cx + (d - hdg) * pxPerDeg;
      const n = ((d % 360) + 360) % 360;
      const major = n % 15 === 0;
      c.beginPath();
      c.moveTo(x, y + 10);
      c.lineTo(x, y + (major ? 2 : 6));
      c.stroke();
      if (n % 90 === 0) {
        this.text({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n], x, y - 7, { size: 12, color });
      } else if (n % 30 === 0) {
        this.text(String(n / 10).padStart(2, '0'), x, y - 7, { size: 10, color, weight: 600 });
      }
    }
    c.restore();
    this.box(cx - 24, y + 12, 48, 20, { r: 5 });
    this.text(String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0'), cx, y + 22, { size: 13, color });
  }
  /** 小さな姿勢指示器（円形） */
  attitudeBall(cx, cy, r, pitch, roll) {
    const c = this.ctx;
    this.record(cx - r, cy - r, 2 * r, 2 * r, 'attitude');
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.clip();
    c.translate(cx, cy);
    c.rotate((-roll * Math.PI) / 180);
    const off = clamp(pitch, -40, 40) * (r / 30);
    c.fillStyle = 'rgba(60,130,210,0.75)';
    c.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
    c.fillStyle = 'rgba(140,95,50,0.75)';
    c.fillRect(-r * 2, off, r * 4, r * 3);
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-r * 2, off); c.lineTo(r * 2, off); c.stroke();
    for (const p of [-20, -10, 10, 20]) {
      const yy = off - p * (r / 30);
      c.beginPath(); c.moveTo(-r * 0.25, yy); c.lineTo(r * 0.25, yy); c.stroke();
    }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#ffd23a';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx - r * 0.6, cy); c.lineTo(cx - r * 0.2, cy); c.lineTo(cx - r * 0.1, cy + 5); c.moveTo(cx + r * 0.6, cy); c.lineTo(cx + r * 0.2, cy); c.lineTo(cx + r * 0.1, cy + 5); c.stroke();
  }
  warning(s, y, color = '#ff4a3a') {
    if (Math.floor(this.blink * 3) % 2 === 0) {
      const c = this.ctx;
      c.font = `900 22px ${FONT}`;
      const w = c.measureText(s).width + 28;
      this.box(this.cx - w / 2, y - 18, w, 36, { fill: 'rgba(0,0,0,0.5)', stroke: color });
      this.text(s, this.cx, y, { size: 22, color, weight: 900 });
    }
  }
  statusLine(items, y) {
    const s = items.filter(Boolean).join('   ');
    if (!s) return;
    const c = this.ctx;
    c.font = `700 13px ${FONT}`;
    const w = c.measureText(s).width + 24;
    this.box(this.cx - w / 2, y - 14, w, 28, { r: 7 });
    this.text(s, this.cx, y, { size: 13 });
  }

  // ---------- 共通: 警告・モード表示 ----------
  drawCommon(st, extra) {
    const W = this.W, H = this.H;
    let wy = 92;
    const def = this.def;
    if (st.status === 'flying') {
      if (st.stallWarn && def.model === 'fixedwing' && !st.onGround) { this.warning(def.id === 'airliner' ? 'STALL' : '失速！', wy); wy += 42; }
      if (def.model === 'fixedwing' && !st.onGround && st.agl < 120 && st.vs < -12) { this.warning('PULL UP', wy); wy += 42; }
      if (st.aFloor) { this.warning('A.FLOOR', wy, '#ffc23a'); wy += 42; }
      if (st.fuel != null && st.fuel < 0.15) { this.warning(st.fuel <= 0 ? '燃料切れ' : '燃料わずか', wy, '#ffc23a'); wy += 42; }
      if (st.outOfBounds) { this.warning('エリア外 — 引き返してください', wy, '#ffc23a'); wy += 42; }
      if (def.model === 'human' && st.phase === 'freefall' && st.agl < 900) { this.warning('パラシュートを開いて！', wy, '#ffc23a'); wy += 42; }
    }
    // リングコース
    if (st.rings) {
      const r = st.rings;
      const txt = `リング ${Math.min(r.index + 1, r.total)}/${r.total}   ${fmtTime(r.time)}${r.penalty ? `  (+${r.penalty}s)` : ''}`;
      this.statusLine([txt], 66);
      // 次のリングの方向
      if (r.next && extra.camera) this.pointer(r.next, extra, '#3affb0');
    }
    if (st.mode === 'landing' && st.status === 'flying' && extra.camera) {
      this.pointer({ x: st.target.x, y: st.target.elevation, z: st.target.z }, extra, '#ffb040', `${(st.target.dist / 1000).toFixed(2)} km`);
    }
    if (extra.recalHint) this.text(extra.recalHint, W / 2, H - 70, { size: 13, color: '#ffe08a' });
  }

  /** 画面外/画面内の目標を矢印・マーカーで示す */
  pointer(p, extra, color, label) {
    const v = extra.project(p);
    const W = this.W, H = this.H;
    const c = this.ctx;
    const margin = 70;
    if (v.onScreen) {
      c.strokeStyle = color;
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(v.x, v.y, 14, 0, Math.PI * 2);
      c.stroke();
      if (label) this.text(label, v.x, v.y - 26, { size: 12, color });
      return;
    }
    const cx = W / 2, cy = H / 2;
    let dx = v.x - cx, dy = v.y - cy;
    if (v.behind) { dx = -dx; dy = -dy; }
    const a = Math.atan2(dy, dx);
    const rx = W / 2 - margin, ry = H / 2 - margin;
    const k = Math.min(Math.abs(rx / Math.cos(a)), Math.abs(ry / Math.sin(a)));
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(16, 0); c.lineTo(-8, -10); c.lineTo(-8, 10); c.closePath();
    c.fill();
    c.restore();
    if (label) this.text(label, x - Math.cos(a) * 30, y - Math.sin(a) * 22, { size: 12, color });
  }

  // ---------- 小型機 ----------
  drawBasic(st) {
    const W = this.W, H = this.H, cx = this.cx, sp = this.sp;
    this.headingTape(st.attitude.heading, 24);
    const yMid = H * 0.5;
    this.valueBox('速度', String(Math.round(st.speed * KMH)), 'km/h', cx - sp, yMid);
    this.valueBox('高度', String(Math.round(st.altitude)), 'm', cx + sp, yMid);
    this.valueBox('昇降率', fmtSigned(st.vs, 1), 'm/s', cx + sp, yMid + 54, { color: st.vs < -5 ? '#ffb38a' : '#fff' });
    this.valueBox('対地', String(Math.round(st.agl)), 'm', cx - sp, yMid + 54);
    this.attitudeBall(cx, H - 70, 36, st.attitude.pitch, st.attitude.roll);
    this.statusLine([`出力 ${Math.round(st.throttle * 100)}%`, `フラップ ${['UP', '1', '2'][Math.round(st.flaps)] || st.flaps}`, st.onGround ? '地上' : null], H - 18);
  }

  // ---------- 旅客機（PFD 風） ----------
  drawPfd(st, extra) {
    const c = this.ctx;
    // 機体（画面中央）を隠さないよう、計器は画面下部にまとめる
    const W = this.W, H = this.H, cx = this.cx, cy = H - 108;
    this.headingTape(st.attitude.heading, 24, 240);
    // 空き幅が狭い端末では PFD 全体を縮小する（下端中央を基準に）
    const k = clamp((this.half - 6) / 192, 0.62, 1);
    c.save();
    c.translate(cx, H);
    c.scale(k, k);
    c.translate(-cx, -H);
    // 姿勢指示器
    const aw = 150, ah = 112;
    c.save();
    c.beginPath();
    c.roundRect(cx - aw / 2, cy - ah / 2, aw, ah, 10);
    c.clip();
    c.translate(cx, cy);
    c.rotate((-st.attitude.roll * Math.PI) / 180);
    const ppd = 3.2;
    const off = st.attitude.pitch * ppd;
    c.fillStyle = 'rgba(40,120,210,0.55)';
    c.fillRect(-300, -600 + off, 600, 600);
    c.fillStyle = 'rgba(130,80,40,0.55)';
    c.fillRect(-300, off, 600, 600);
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-300, off); c.lineTo(300, off); c.stroke();
    for (let p = -30; p <= 30; p += 5) {
      if (!p) continue;
      const yy = off - p * ppd;
      const w = p % 10 === 0 ? 28 : 12;
      c.beginPath(); c.moveTo(-w, yy); c.lineTo(w, yy); c.stroke();
      if (p % 10 === 0) this.text(String(Math.abs(p)), w + 12, yy, { size: 10, shadow: false });
    }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(cx - aw / 2, cy - ah / 2, aw, ah, 10); c.stroke();
    this.record(cx - aw / 2, cy - ah / 2, aw, ah, 'attitude');
    // バンク目盛り（33° と 67° の保護マーク）
    const R = 64;
    c.save();
    c.translate(cx, cy);
    for (const b of [-67, -60, -45, -33, -30, -20, -10, 0, 10, 20, 30, 33, 45, 60, 67]) {
      const a = ((b - 90) * Math.PI) / 180;
      const prot = Math.abs(b) === 33 || Math.abs(b) === 67;
      c.strokeStyle = prot ? '#3affb0' : '#fff';
      c.lineWidth = prot ? 3 : 1.5;
      const r0 = R, r1 = R + (prot ? 6 : b % 30 === 0 ? 9 : 5);
      c.beginPath(); c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); c.stroke();
    }
    c.rotate((-st.attitude.roll * Math.PI) / 180);
    c.fillStyle = '#ffd23a';
    c.beginPath(); c.moveTo(0, -R + 2); c.lineTo(-6, -R + 12); c.lineTo(6, -R + 12); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = '#ffd23a';
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(cx - 48, cy); c.lineTo(cx - 16, cy); c.moveTo(cx + 16, cy); c.lineTo(cx + 48, cy); c.stroke();
    c.fillStyle = '#ffd23a';
    c.fillRect(cx - 3, cy - 3, 6, 6);

    // 速度テープ
    const spd = st.speed * KMH;
    this.tape(cx - aw / 2 - 64, cy, 56, 124, spd, 20, 2.0, 'km/h', { lowRed: extra.stallKmh || 0 });
    // 高度テープ
    this.tape(cx + aw / 2 + 10, cy, 64, 124, st.altitude, 20, 0.9, 'm');
    // 昇降率
    const vx = cx + aw / 2 + 84;
    this.box(vx, cy - 58, 18, 116, { r: 5 });
    const vy = clamp(st.vs, -10, 10) * 5.4;
    c.strokeStyle = '#3affb0';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(vx, cy); c.lineTo(vx + 18, cy - vy); c.stroke();
    this.text(fmtSigned(st.vs, 1), vx + 9, cy + 70, { size: 11 });
    const fl = ['UP', '1', 'FULL'][Math.round(st.flaps)];
    this.statusLine([
      `推力 ${Math.round(st.throttle * 100)}%`, `FLAPS ${fl}`,
      st.gear != null ? (st.gear > 0.95 ? 'GEAR ▼' : st.gear < 0.05 ? 'GEAR ▲' : 'GEAR …') : null,
      st.spoiler ? 'SPD BRK' : null, st.onGround ? 'GND' : null,
    ], H - 16);
    c.restore();
  }

  tape(x, cy, w, h, value, step, pxPerUnit, unit, { lowRed = 0 } = {}) {
    const c = this.ctx;
    this.box(x, cy - h / 2, w, h, { r: 6 });
    c.save();
    c.beginPath();
    c.rect(x, cy - h / 2, w, h);
    c.clip();
    if (lowRed > 0) {
      const yr = cy + (value - lowRed) * pxPerUnit;
      c.fillStyle = 'rgba(255,60,50,0.55)';
      c.fillRect(x + w - 6, yr, 6, h);
    }
    const range = h / 2 / pxPerUnit;
    c.strokeStyle = '#fff';
    c.lineWidth = 1.2;
    for (let v = Math.floor((value - range) / step) * step; v <= value + range; v += step) {
      const yy = cy - (v - value) * pxPerUnit;
      c.beginPath(); c.moveTo(x, yy); c.lineTo(x + 8, yy); c.stroke();
      if (Math.round(v / step) % 2 === 0) this.text(String(Math.round(v)), x + w / 2 + 4, yy, { size: 10, shadow: false });
    }
    c.restore();
    this.box(x - 2, cy - 13, w + 4, 26, { fill: 'rgba(0,0,0,0.85)', stroke: '#ffd23a', r: 5 });
    this.text(String(Math.round(value)), x + w / 2, cy, { size: 15 });
    this.text(unit, x + w / 2, cy + h / 2 + 10, { size: 10, color: 'rgba(220,230,240,0.85)', weight: 600 });
  }

  // ---------- 戦闘機（緑の HUD） ----------
  drawFighter(st, extra) {
    const c = this.ctx;
    const G = '#4dff88';
    const W = this.W, H = this.H, cx = this.cx, cy = H * 0.48, sp = this.sp + 5;
    const fov = extra.fov || 70;
    const ppd = H / fov;
    this.headingTape(st.attitude.heading, 24, 240, G);
    // ピッチラダー
    c.save();
    c.beginPath();
    const lw = Math.min(122, sp - 48);
    c.rect(cx - lw, cy - 130, lw * 2, 250);
    c.clip();
    c.translate(cx, cy);
    c.rotate((-st.attitude.roll * Math.PI) / 180);
    c.strokeStyle = G;
    c.lineWidth = 1.6;
    for (let p = -90; p <= 90; p += 5) {
      const yy = (st.attitude.pitch - p) * ppd;
      if (Math.abs(yy) > 200) continue;
      const wl = p === 0 ? Math.min(100, lw - 8) : Math.min(42, lw - 30);
      c.setLineDash(p < 0 ? [6, 5] : []);
      c.beginPath();
      c.moveTo(-wl, yy); c.lineTo(-18, yy);
      c.moveTo(18, yy); c.lineTo(wl, yy);
      if (p !== 0) { c.moveTo(-wl, yy); c.lineTo(-wl, yy + (p > 0 ? 7 : -7)); c.moveTo(wl, yy); c.lineTo(wl, yy + (p > 0 ? 7 : -7)); }
      c.stroke();
      if (p !== 0) { this.text(String(p), -wl - 14, yy, { size: 11, color: G, shadow: false }); this.text(String(p), wl + 14, yy, { size: 11, color: G, shadow: false }); }
    }
    c.setLineDash([]);
    c.restore();
    // 速度ベクトル（フライトパスマーカー）
    const fpmY = cy + clamp(st.alpha, -20, 30) * ppd * 0.95;
    c.strokeStyle = G;
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, fpmY, 7, 0, Math.PI * 2);
    c.moveTo(cx - 7, fpmY); c.lineTo(cx - 20, fpmY); c.moveTo(cx + 7, fpmY); c.lineTo(cx + 20, fpmY); c.moveTo(cx, fpmY - 7); c.lineTo(cx, fpmY - 14);
    c.stroke();
    // 機首方向（W マーク）
    c.beginPath(); c.moveTo(cx - 14, cy); c.lineTo(cx - 7, cy + 6); c.lineTo(cx, cy); c.lineTo(cx + 7, cy + 6); c.lineTo(cx + 14, cy); c.stroke();
    const spd = Math.round(st.speed * KMH);
    this.fbox(cx - sp, cy, `${spd}`, 'km/h', G);
    this.text(`M ${(st.speed / 340).toFixed(2)}`, cx - sp, cy + 34, { size: 13, color: G });
    this.fbox(cx + sp, cy, `${Math.round(st.altitude)}`, 'm', G);
    this.text(`${fmtSigned(st.vs, 0)} m/s`, cx + sp, cy + 34, { size: 13, color: G });
    const gcol = st.g > 8 ? '#ff6a4a' : G;
    this.text(`G ${st.g.toFixed(1)}`, cx - sp, cy + 64, { size: 18, color: gcol, weight: 800 });
    this.text(`MAX ${this.maxG.toFixed(1)}`, cx - sp, cy + 84, { size: 11, color: G });
    this.text(`α ${st.alpha.toFixed(1)}°`, cx + sp, cy + 64, { size: 15, color: st.alpha > 20 ? '#ffc23a' : G });
    this.statusLine([`推力 ${Math.round(st.throttle * 100)}%`, st.ab ? 'A/B ON' : null, st.gear != null && st.gear > 0.5 ? 'GEAR ▼' : 'GEAR ▲', st.onGround ? 'GND' : null], H - 18);
  }
  fbox(x, y, value, unit, color) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.strokeRect(x - 44, y - 15, 88, 30);
    this.record(x - 44, y - 15, 88, 30, 'fbox');
    this.text(value, x, y, { size: 19, color, shadow: true });
    this.text(unit, x, y - 24, { size: 10, color, shadow: false });
  }

  // ---------- ヘリ・ジェットスーツ ----------
  drawHeli(st) {
    const W = this.W, H = this.H, cx = this.cx, yMid = H * 0.5, sp = this.sp;
    this.headingTape(st.attitude.heading, 24);
    this.valueBox('対地速度', String(Math.round(st.groundSpeed * KMH)), 'km/h', cx - sp, yMid);
    this.valueBox('対地高度', st.agl < 100 ? st.agl.toFixed(1) : String(Math.round(st.agl)), 'm', cx + sp, yMid, { color: st.agl < 3 ? '#ffe08a' : '#fff' });
    this.valueBox('昇降率', fmtSigned(st.vs, 1), 'm/s', cx + sp, yMid + 54, { color: st.vs < -3 ? '#ffb38a' : st.vs > 0.3 ? '#9fffd0' : '#fff' });
    this.valueBox('高度', String(Math.round(st.altitude)), 'm', cx - sp, yMid + 54);
    this.attitudeBall(cx, H - 70, 34, st.attitude.pitch, st.attitude.roll);
    const isJet = this.def.id === 'jetsuit';
    if (isJet && st.fuel != null) this.fuelGauge(st.fuel);
    const lab = isJet ? '推力' : 'コレクティブ';
    this.statusLine([
      `${lab} ${Math.round(st.throttle * 100)}%`,
      st.kGE && st.kGE > 1.03 ? '地面効果' : null,
      st.speed > 6 && st.speed < 30 && !isJet ? 'ETL' : null,
      st.onGround ? '接地' : null,
    ], H - 18);
  }
  fuelGauge(f) {
    const x = this.W - this.safe.r - 196, y = 72;
    this.box(x, y, 120, 26, { r: 6 });
    const col = f < 0.15 ? '#ff6a4a' : f < 0.35 ? '#ffc23a' : '#3affb0';
    const c = this.ctx;
    c.fillStyle = col;
    c.fillRect(x + 40, y + 7, 72 * clamp(f, 0, 1), 12);
    this.text('燃料', x + 20, y + 13, { size: 11 });
    this.text(`${Math.round(f * 100)}%`, x + 76, y + 13, { size: 10, shadow: true });
  }

  // ---------- 滑空系・スカイダイビング ----------
  drawGlide(st) {
    const W = this.W, H = this.H, cx = this.cx, yMid = H * 0.48, sp = this.sp;
    const c = this.ctx;
    this.headingTape(st.attitude.heading, 24);
    this.valueBox('高度', String(Math.round(st.altitude)), 'm', cx + sp, yMid);
    this.valueBox('対地高度', String(Math.round(st.agl)), 'm', cx + sp, yMid + 54, { color: st.agl < 300 ? '#ffe08a' : '#fff' });
    this.valueBox('対気速度', String(Math.round(st.speed * KMH)), 'km/h', cx - sp, yMid);
    const ld = st.glideRatio;
    this.valueBox('滑空比', ld == null ? '—' : ld > 99 ? '∞' : ld.toFixed(1), '', cx - sp, yMid + 54);
    // バリオ（大きく）
    const v = st.vs;
    const vcol = v > 0.2 ? '#3affb0' : v < -2.5 ? '#ff8a6a' : '#fff';
    const bx = Math.min(cx + sp + 105, cx + this.half - 18), by = yMid - 40;
    this.box(bx - 14, by - 60, 28, 200, { r: 6 });
    const scale = st.phase === 'freefall' || st.phase === 'deploying' ? 2.0 : 15;
    const hgt = clamp(v * scale, -95, 95);
    c.fillStyle = vcol;
    c.fillRect(bx - 9, by + 40 - Math.max(hgt, 0), 18, Math.abs(hgt));
    this.text('バリオ', cx, H - 92, { size: 10, color: 'rgba(220,230,240,0.85)', weight: 600 });
    this.text(`${fmtSigned(v, 1)} m/s`, cx, H - 70, { size: 26, color: vcol, weight: 900 });
    const phaseName = { freefall: st.input && st.input.pitch < -0.2 ? 'トラッキング' : '自由落下', deploying: '展開中…', canopy: 'キャノピー', wingsuit: 'ウイングスーツ', glide: null, landed: '着地' }[st.phase];
    // 目標までの距離と方向
    const tdx = st.target.x - st.pos.x, tdz = st.target.z - st.pos.z;
    const brg = (Math.atan2(tdx, -tdz) * 180) / Math.PI;
    const rel = ((brg - st.attitude.heading + 540) % 360) - 180;
    const ax = cx, ay = 88;
    c.save();
    c.translate(ax - 64, ay);
    c.rotate((rel * Math.PI) / 180);
    c.fillStyle = '#ffb040';
    c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 8); c.lineTo(0, 3); c.lineTo(-8, 8); c.closePath(); c.fill();
    c.restore();
    // 風（吹いていく向きを機首基準の矢印で）
    const ws = Math.hypot(st.wind.x, st.wind.z);
    if (ws > 0.5) {
      const wb = (Math.atan2(st.wind.x, -st.wind.z) * 180) / Math.PI;
      const wr = ((wb - st.attitude.heading + 540) % 360) - 180;
      const wx = cx + sp, wy = 88;
      c.save();
      c.translate(wx - 30, wy);
      c.rotate((wr * Math.PI) / 180);
      c.strokeStyle = '#9fd8ff';
      c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(0, 10); c.lineTo(0, -10); c.moveTo(-5, -4); c.lineTo(0, -10); c.lineTo(5, -4); c.stroke();
      c.restore();
      this.text(`風 ${ws.toFixed(0)} m/s`, wx + 8, wy, { size: 12, color: '#9fd8ff' });
    }
    this.text(`目標 ${st.target.dist >= 1000 ? (st.target.dist / 1000).toFixed(1) + ' km' : Math.round(st.target.dist) + ' m'}`, ax + 6, ay, { size: 13, color: '#ffd08a' });
    if (st.brakes && (this.def.id === 'paraglider' || st.phase === 'canopy')) {
      const b = st.brakes;
      this.brakeBar(cx - 120, H - 92, b.left, 'L');
      this.brakeBar(cx + 108, H - 92, b.right, 'R');
    }
    this.statusLine([phaseName], H - 22);
  }
  brakeBar(x, y, v, lab) {
    this.box(x, y, 12, 60, { r: 4 });
    const c = this.ctx;
    c.fillStyle = '#ffc23a';
    c.fillRect(x + 2, y + 2, 8, 56 * clamp(v, 0, 1));
    this.text(lab, x + 6, y + 70, { size: 10 });
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
function fmtSigned(v, d) {
  const s = v.toFixed(d);
  return v > 0 && s !== (0).toFixed(d) ? `+${s}` : s;
}
