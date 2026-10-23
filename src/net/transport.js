// WebRTC による P2P 接続（DataChannel）
// - RtcTransport: サーバーなし。オファー/アンサーの接続コードを 1 往復コピーし合う
// - PeerJsTransport: 4 文字のルームコード。シグナリングだけ PeerJS の公開サーバー（0.peerjs.com）を使い、
//   接続後のデータは端末どうしで直接やり取りする
// 状態は順序なし・再送なしのチャネル（遅れたパケットは捨てる）、イベントは確実に届くチャネルで送る。

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer());
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return `Z${btoa(s)}`;
  }
  return `J${btoa(unescape(encodeURIComponent(json)))}`;
}
async function unpack(code) {
  const c = String(code || '').trim().replace(/\s+/g, '');
  if (c[0] === 'Z') {
    const bin = atob(c.slice(1));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(ds).text());
  }
  if (c[0] === 'J') return JSON.parse(decodeURIComponent(escape(atob(c.slice(1)))));
  throw new Error('接続コードの形式が正しくありません');
}

function waitIce(pc, timeout = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); res(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeout);
  });
}

class Base {
  constructor() {
    this.onmessage = null;
    this.onclose = null;
    this.onopen = null;
    this.open = false;
  }
  _emitOpen() { if (!this.open) { this.open = true; if (this.onopen) this.onopen(); } }
  _emitMsg(raw) {
    let m = raw;
    if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch (e) { return; } }
    if (this.onmessage) this.onmessage(m);
  }
  _emitClose() {
    if (this._closedOnce) return;
    this._closedOnce = true;
    if (this.onclose) this.onclose();
  }
}

export class RtcTransport extends Base {
  constructor() {
    super();
    this.pc = new RTCPeerConnection(ICE);
    this.rel = null;
    this.unrel = null;
    this.pc.addEventListener('connectionstatechange', () => {
      const st = this.pc.connectionState;
      clearTimeout(this._discT);
      if (st === 'failed' || st === 'closed') this._emitClose();
      // disconnected は電波の一時的な途切れでも起きて、多くは数秒で戻る。5 秒待って戻らなければ切断
      else if (st === 'disconnected') this._discT = setTimeout(() => { if (this.pc.connectionState !== 'connected') this._emitClose(); }, 5000);
    });
  }
  _bind(ch) {
    ch.onmessage = (e) => this._emitMsg(e.data);
    ch.onopen = () => { if (this.rel && this.rel.readyState === 'open' && this.unrel && this.unrel.readyState === 'open') this._emitOpen(); };
    ch.onclose = () => this._emitClose();
  }
  /** ホスト: オファーの接続コードを作る */
  async createOffer() {
    this.rel = this.pc.createDataChannel('r', { ordered: true });
    this.unrel = this.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 });
    this._bind(this.rel); this._bind(this.unrel);
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitIce(this.pc);
    return pack({ t: 'o', sdp: this.pc.localDescription.sdp });
  }
  /** ホスト: 相手のアンサーを受け入れる */
  async acceptAnswer(code) {
    const a = await unpack(code);
    if (a.t !== 'a') throw new Error('参加側の接続コードを貼り付けてください');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
  }
  /** ゲスト: オファーを受けてアンサーの接続コードを作る */
  async createAnswer(offerCode) {
    const o = await unpack(offerCode);
    if (o.t !== 'o') throw new Error('ホストの接続コードを貼り付けてください');
    this.pc.ondatachannel = (e) => {
      if (e.channel.label === 'r') this.rel = e.channel; else this.unrel = e.channel;
      this._bind(e.channel);
      if (e.channel.readyState === 'open') e.channel.onopen();
    };
    await this.pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitIce(this.pc);
    return pack({ t: 'a', sdp: this.pc.localDescription.sdp });
  }
  send(msg, reliable = true) {
    const ch = reliable ? this.rel : this.unrel;
    if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg));
  }
  close() { clearTimeout(this._discT); try { this.pc.close(); } catch (e) { /* 閉じ済み */ } }
}

const PREFIX = 'skytilt-v1-';

/** PeerJS のエラーを、何をすればよいか分かる言葉にする */
export function peerErrorMessage(e) {
  const type = e && e.type;
  if (type === 'peer-unavailable') return 'ルームが見つかりません（コードを確認するか、ホストにもう一度作ってもらってください）';
  if (type === 'unavailable-id') return 'このコードは使用中です。もう一度「作成」してください';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return 'シグナリングサーバーに接続できません（インターネット接続を確認）';
  if (type === 'browser-incompatible') return 'このブラウザは 2 人プレイ（WebRTC）に対応していません';
  if (type === 'ice-timeout') return 'ルームは見つかりましたが端末どうしで直接つながりませんでした。同じ Wi-Fi で試すか、「サーバーなしで接続」を使ってください';
  return (e && e.message) || String(e);
}
export function makeRoomCode(rnd = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(rnd() * A.length)];
  return s;
}

export class PeerJsTransport extends Base {
  constructor() {
    super();
    this.peer = null;
    this.rel = null;
    this.unrel = null;
  }
  async _peer(id) {
    const { Peer } = await import('peerjs');
    return new Promise((res, rej) => {
      const p = id ? new Peer(id, { config: ICE, debug: 0 }) : new Peer({ config: ICE, debug: 0 });
      const to = setTimeout(() => rej(Object.assign(new Error(''), { type: 'network' })), 10000);
      p.on('open', () => { clearTimeout(to); res(p); });
      p.on('error', (e) => { clearTimeout(to); rej(e); });
    });
  }
  _bindConn(c) {
    c.on('data', (d) => this._emitMsg(d));
    c.on('close', () => this._emitClose());
    c.on('open', () => { if (this.rel && this.rel.open && this.unrel && this.unrel.open) this._emitOpen(); });
  }
  /** ホスト: ルームを作る（戻り値: ルームコード） */
  async host(code) {
    this.peer = await this._peer(PREFIX + code);
    this.peer.on('connection', (c) => {
      if (c.label === 'r') this.rel = c; else this.unrel = c;
      this._bindConn(c);
    });
    return code;
  }
  /** ゲスト: ルームに参加 */
  async join(code) {
    this.peer = await this._peer(null);
    const target = PREFIX + String(code).trim().toUpperCase();
    this.rel = this.peer.connect(target, { label: 'r', reliable: true, serialization: 'json' });
    this.unrel = this.peer.connect(target, { label: 'u', reliable: false, serialization: 'json' });
    this._bindConn(this.rel);
    this._bindConn(this.unrel);
    return new Promise((res, rej) => {
      // ルームが無いときは PeerJS がすぐ peer-unavailable を返す。返らずに時間切れなら、直接接続（ICE）の失敗
      const to = setTimeout(() => rej(Object.assign(new Error(''), { type: 'ice-timeout' })), 15000);
      const prev = this.onopen;
      this.onopen = () => { clearTimeout(to); this.onopen = prev; if (prev) prev(); res(); };
      this.peer.on('error', (e) => { clearTimeout(to); rej(e); });
    });
  }
  send(msg, reliable = true) {
    const c = reliable ? this.rel : this.unrel;
    if (c && c.open) c.send(msg);
  }
  close() { try { if (this.peer) this.peer.destroy(); } catch (e) { /* 閉じ済み */ } }
}
