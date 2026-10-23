// 2 人プレイのセッション: 挨拶・時計合わせ（ping/pong）・状態の送受信・イベント（純粋ロジック）
// トランスポートは { send(msg, reliable), onmessage, onclose, close() } を満たせば何でもよい
// （WebRTC の DataChannel、テスト用のループバックなど）。
import { SnapshotBuffer, ClockSync, INTERP_DELAY } from './interp.js';
import { decodeState } from './protocol.js';

/** 相手から何も届かない時間: これを超えたら「通信が不安定」、さらに超えたら切断とみなす */
export const SILENCE_WARN = 3;
export const SILENCE_CLOSE = 12;

export class Session {
  constructor(transport, { role, name = 'PLAYER', now } = {}) {
    this.t = transport;
    this.role = role; // 'host' | 'guest'
    this.name = name;
    this.now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
    this.remote = { name: null, vehicle: null, ready: false, buffer: new SnapshotBuffer(), clock: new ClockSync(), lastSeen: this.now() };
    this.handlers = { hello: [], start: [], event: [], close: [] };
    this.closed = false;
    this.stats = { sent: 0, recv: 0, dropped: 0 };
    transport.onmessage = (m) => this._recv(m);
    transport.onclose = () => this._closed();
    this._pingTimer = null;
  }

  on(type, fn) { this.handlers[type].push(fn); return this; }
  _fire(type, ...a) { for (const f of this.handlers[type]) f(...a); }

  start() {
    this.send({ k: 'hello', name: this.name, vehicle: this.vehicle || null }, true);
    this.ping();
    if (typeof setInterval !== 'undefined') this._pingTimer = setInterval(() => { this.ping(); this.checkAlive(); }, 1000);
  }

  /** 相手から届かない時間（秒） */
  silence() { return this.now() - this.remote.lastSeen; }

  /** 一定時間何も届かなければ切断扱いにする（相手のアプリが落ちた・圏外など、閉じる通知が来ない場合） */
  checkAlive() {
    const now = this.now();
    // 自分の側が止まっていた（地形の読み込み・バックグラウンド等でタイマーが遅れた）分は数えない
    if (this._lastCheck != null && now - this._lastCheck > 2) this.remote.lastSeen += now - this._lastCheck - 1;
    this._lastCheck = now;
    if (!this.closed && this.silence() > SILENCE_CLOSE) this._closed();
  }

  send(msg, reliable = true) {
    if (this.closed) return;
    try { this.t.send(msg, reliable); this.stats.sent++; } catch (e) { /* 切断済み */ }
  }

  ping() { this.send({ k: 'ping', t0: this.now() }, true); }

  setVehicle(id) {
    this.vehicle = id;
    this.send({ k: 'hello', name: this.name, vehicle: id }, true);
  }

  sendState(arr) { this.send({ k: 's', d: arr }, false); }
  sendEvent(e) { this.send({ k: 'ev', e }, true); }
  sendStart(cfg) { this.send({ k: 'start', cfg }, true); }

  _recv(m) {
    if (!m || typeof m !== 'object') return;
    this.stats.recv++;
    const now = this.now();
    this.remote.lastSeen = now;
    switch (m.k) {
      case 'hello':
        this.remote.name = String(m.name || '相手').slice(0, 12);
        this.remote.vehicle = m.vehicle || null;
        this._fire('hello', this.remote);
        break;
      case 'ping':
        this.send({ k: 'pong', t0: m.t0, tr: now }, true);
        break;
      case 'pong':
        this.remote.clock.add(m.t0, m.tr, now);
        break;
      case 's': {
        const s = decodeState(m.d);
        if (s && !this.remote.buffer.push(s)) this.stats.dropped++;
        break;
      }
      case 'start':
        this._fire('start', m.cfg);
        break;
      case 'ev':
        this._fire('event', m.e);
        break;
      case 'bye':
        this._closed();
        break;
      default:
    }
  }

  /** 相手の表示用の状態（補間・外挿済み）。時計合わせ前は最新をそのまま */
  sampleRemote() {
    const b = this.remote.buffer;
    if (!b.snaps.length) return null;
    const off = this.remote.clock.offset;
    if (off == null) return { ...b.latest(), mode: 'raw' };
    return b.sample(this.now() + off - INTERP_DELAY);
  }

  rtt() { return this.remote.clock.rtt; }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    if (this._pingTimer) clearInterval(this._pingTimer);
    try { this.t.close(); } catch (e) { /* 既に閉じている */ }
    this._fire('close');
  }

  close() {
    this.send({ k: 'bye' }, true);
    this.closed = true;
    if (this._pingTimer) clearInterval(this._pingTimer);
    try { this.t.close(); } catch (e) { /* 既に閉じている */ }
  }
}

/** テスト用: 遅延・揺らぎ・損失を再現するループバック接続のペア */
export function loopbackPair({ latency = 0.04, jitter = 0.01, loss = 0, rnd = Math.random, schedule } = {}) {
  const mk = () => ({ onmessage: null, onclose: null, peer: null, closed: false });
  const a = mk(), b = mk();
  a.peer = b; b.peer = a;
  const sched = schedule || ((fn, ms) => setTimeout(fn, ms));
  for (const ep of [a, b]) {
    ep.send = (msg, reliable) => {
      if (ep.closed) return;
      if (!reliable && rnd() < loss) return;
      const d = Math.max(0, latency + (rnd() - 0.5) * 2 * jitter);
      const copy = JSON.parse(JSON.stringify(msg));
      sched(() => { if (ep.peer.onmessage && !ep.peer.closed) ep.peer.onmessage(copy); }, d * 1000);
    };
    ep.close = () => { ep.closed = true; if (ep.peer.onclose) ep.peer.onclose(); };
  }
  return [a, b];
}
