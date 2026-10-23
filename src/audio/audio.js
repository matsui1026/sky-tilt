// Web Audio API による効果音の合成（外部音源なし）
// エンジン音（機体ごとに音色を変える）、風切り音、失速警報、バリオ音、各種イベント音
import { clamp } from '../sim/math.js';

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b = 0.97 * b + 0.03 * w; // 少し低域寄り（ピンク寄り）
    d[i] = w * 0.5 + b * 2.5;
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.enabled = true;
    this.engine = null;
    this.varioNext = 0;
    this.stallNext = 0;
    this.stats = { vario: 0, sink: 0, stall: 0 }; // 鳴らした回数（テスト用）
  }

  /** ユーザー操作の中で呼ぶ */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.noise = noiseBuffer(ctx);
    // 風切り音（常設）
    this.wind = this._noiseChain('bandpass', 400, 0.7);
  }

  /** バックグラウンド移行時に音を止める */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _noiseChain(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { src, f, g };
  }

  _osc(type, freq, gain = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(this.master);
    o.start();
    return { o, g };
  }

  /** 機体ごとの音色を組み立てる */
  setVehicle(def) {
    if (!this.ctx) return;
    this.stopEngine();
    const s = def.sound || { type: 'none' };
    const ctx = this.ctx;
    const e = { type: s.type, def: s, nodes: [] };
    switch (s.type) {
      case 'prop': {
        // のこぎり波 + 低い矩形波、トレモロでプロペラの唸り
        e.osc1 = this._osc('sawtooth', s.baseFreq, 0);
        e.osc2 = this._osc('square', s.baseFreq / 2, 0);
        e.lp = ctx.createBiquadFilter();
        e.lp.type = 'lowpass';
        e.lp.frequency.value = 700;
        e.osc1.g.disconnect();
        e.osc2.g.disconnect();
        e.trem = ctx.createGain();
        e.osc1.g.connect(e.lp);
        e.osc2.g.connect(e.lp);
        e.lp.connect(e.trem).connect(this.master);
        e.lfo = this._osc('sine', 20, 0);
        e.lfo.g.disconnect();
        e.lfo.g.connect(e.trem.gain);
        e.noise = this._noiseChain('lowpass', 500, 0.5);
        break;
      }
      case 'turbofan':
      case 'jet': {
        e.roar = this._noiseChain('lowpass', 400, 0.6);
        e.whine = this._osc('sine', 1800, 0);
        e.whine2 = this._osc('triangle', 2900, 0);
        e.rumble = this._noiseChain('lowpass', 120, 0.8);
        break;
      }
      case 'heli': {
        e.body = this._noiseChain('bandpass', 180, 1.2);
        e.slapGain = ctx.createGain();
        e.body.g.disconnect();
        e.body.g.connect(e.slapGain).connect(this.master);
        e.lfo = this._osc('square', 17, 0);
        e.lfo.g.disconnect();
        e.lfo.g.connect(e.slapGain.gain);
        e.whine = this._osc('sine', 1500, 0);
        break;
      }
      case 'jetsuit': {
        e.roar = this._noiseChain('bandpass', 900, 0.7);
        e.whine = this._osc('sawtooth', 600, 0);
        e.hp = null;
        break;
      }
      case 'drone': {
        // 4 つの小さなプロペラの高い唸り（わずかにずらしてうなりを出す）
        e.whine = this._osc('sawtooth', 200, 0);
        e.whine2 = this._osc('sawtooth', 207, 0);
        e.roar = this._noiseChain('bandpass', 1800, 1.2);
        break;
      }
      case 'ev': {
        // 電気モーターの高い音＋（飛行時）ファンの風切り
        e.whine = this._osc('sine', 300, 0);
        e.whine2 = this._osc('triangle', 600, 0);
        e.roar = this._noiseChain('bandpass', 700, 0.8);
        e.rumble = this._noiseChain('lowpass', 160, 0.7);
        break;
      }
      case 'balloon': {
        e.roar = this._noiseChain('bandpass', 350, 0.6);
        e.rumble = this._noiseChain('lowpass', 90, 0.7);
        break;
      }
      default:
    }
    this.engine = e;
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    const stop = (n) => {
      if (!n) return;
      try { (n.o || n.src).stop(); } catch (err) { /* 停止済み */ }
      try { n.g.disconnect(); } catch (err) { /* 切断済み */ }
    };
    ['osc1', 'osc2', 'lfo', 'noise', 'roar', 'whine', 'whine2', 'rumble', 'body'].forEach((k) => stop(e[k]));
    if (this.gun) { stop(this.gun); stop(this.gunLfo); this.gun = null; this.gunLfo = null; }
    this.engine = null;
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.wind) this.wind.g.gain.setTargetAtTime(0, t, 0.05);
    this.stopEngine();
  }

  /** 毎フレーム呼ぶ */
  update(state, vs, def, paused) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tc = 0.06;
    const active = !paused && state.status !== 'crashed';
    const spd = state.speed || 0;
    // 風切り音
    const wv = active ? clamp((spd / 70) ** 2, 0, 1) * 0.35 + (state.phase === 'freefall' ? 0.15 : 0) : 0;
    this.wind.g.gain.setTargetAtTime(wv, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(250 + spd * 9, t, 0.1);

    const e = this.engine;
    if (e) {
      const thr = active ? (state.throttle ?? 0) : 0;
      const s = e.def;
      const on = active ? 1 : 0;
      switch (e.type) {
        case 'prop': {
          const f = s.baseFreq + (s.maxFreq - s.baseFreq) * thr;
          e.osc1.o.frequency.setTargetAtTime(f, t, tc);
          e.osc2.o.frequency.setTargetAtTime(f / 2, t, tc);
          e.osc1.g.gain.setTargetAtTime(on * (0.05 + 0.1 * thr), t, tc);
          e.osc2.g.gain.setTargetAtTime(on * (0.06 + 0.08 * thr), t, tc);
          e.lp.frequency.setTargetAtTime(400 + thr * 1200, t, tc);
          e.lfo.o.frequency.setTargetAtTime(f / 3, t, tc);
          e.lfo.g.gain.setTargetAtTime(0.4, t, tc);
          e.trem.gain.setTargetAtTime(0.6, t, tc);
          e.noise.g.gain.setTargetAtTime(on * thr * 0.12, t, tc);
          break;
        }
        case 'turbofan':
        case 'jet': {
          const jet = e.type === 'jet';
          e.roar.f.frequency.setTargetAtTime(250 + thr * (jet ? 1400 : 900), t, tc);
          e.roar.g.gain.setTargetAtTime(on * (0.05 + thr * (jet ? 0.35 : 0.25)), t, tc);
          e.whine.o.frequency.setTargetAtTime((jet ? 1400 : 1900) + thr * (jet ? 2200 : 1600), t, tc);
          e.whine.g.gain.setTargetAtTime(on * (0.015 + thr * 0.025), t, tc);
          e.whine2.o.frequency.setTargetAtTime((jet ? 2600 : 3100) + thr * 1500, t, tc);
          e.whine2.g.gain.setTargetAtTime(on * 0.008 * thr, t, tc);
          e.rumble.g.gain.setTargetAtTime(on * ((state.ab ? 0.6 : 0) + thr * 0.12), t, tc);
          break;
        }
        case 'heli': {
          const rpm = vs.rotorRpm ?? 1;
          const coll = thr;
          e.lfo.o.frequency.setTargetAtTime(9 + 9 * rpm, t, tc);
          e.lfo.g.gain.setTargetAtTime(0.5, t, tc);
          e.slapGain.gain.setTargetAtTime(0.5, t, tc); // 0.5 ± 0.5 でブレードスラップ
          e.body.g.gain.setTargetAtTime(on * (0.12 + coll * 0.3) * rpm, t, tc);
          e.body.f.frequency.setTargetAtTime(140 + coll * 160, t, tc);
          e.whine.o.frequency.setTargetAtTime(1200 + rpm * 900, t, tc);
          e.whine.g.gain.setTargetAtTime(on * 0.012 * rpm, t, tc);
          break;
        }
        case 'drone': {
          const f = s.baseFreq + (s.maxFreq - s.baseFreq) * thr;
          e.whine.o.frequency.setTargetAtTime(f, t, tc);
          e.whine2.o.frequency.setTargetAtTime(f * 1.035, t, tc);
          e.whine.g.gain.setTargetAtTime(on * (0.012 + 0.035 * thr), t, tc);
          e.whine2.g.gain.setTargetAtTime(on * (0.01 + 0.03 * thr), t, tc);
          e.roar.g.gain.setTargetAtTime(on * thr * 0.08, t, tc);
          break;
        }
        case 'ev': {
          const flying = state.carMode === 'fly';
          const spd = Math.min(1, (state.groundSpeed || 0) / 80);
          const k = flying ? thr : Math.max(thr * 0.6, spd);
          e.whine.o.frequency.setTargetAtTime(s.baseFreq * 2 + k * s.maxFreq * 2, t, tc);
          e.whine2.o.frequency.setTargetAtTime(s.baseFreq * 4 + k * s.maxFreq * 3, t, tc);
          e.whine.g.gain.setTargetAtTime(on * (0.008 + 0.03 * k), t, tc);
          e.whine2.g.gain.setTargetAtTime(on * 0.012 * k, t, tc);
          e.roar.g.gain.setTargetAtTime(on * (flying ? 0.05 + thr * 0.3 : 0), t, tc);
          e.rumble.g.gain.setTargetAtTime(on * (flying ? 0 : spd * 0.15), t, tc);
          break;
        }
        case 'balloon': {
          const b = vs.burner ?? 0;
          e.roar.g.gain.setTargetAtTime(on * b * 0.45, t, 0.05);
          e.rumble.g.gain.setTargetAtTime(on * b * 0.35, t, 0.05);
          break;
        }
        case 'jetsuit': {
          e.roar.f.frequency.setTargetAtTime(500 + thr * 1500, t, tc);
          e.roar.g.gain.setTargetAtTime(on * thr * 0.45, t, tc);
          e.whine.o.frequency.setTargetAtTime(s.baseFreq + thr * (s.maxFreq - s.baseFreq), t, tc);
          e.whine.g.gain.setTargetAtTime(on * thr * 0.03, t, tc);
          break;
        }
        default:
      }
    }

    // 射撃音（撃っている間、発射レートで断続するノイズ）
    const firing = active && state.input && state.input.fire && state.combat && state.combat.armed && state.combat.ammo > 0;
    if (firing && !this.gun) {
      this.gun = this._noiseChain('bandpass', 1400, 0.9);
      this.gunGate = ctx.createGain();
      this.gun.g.disconnect();
      this.gun.g.connect(this.gunGate).connect(this.master);
      this.gunLfo = this._osc('square', def.weapon ? def.weapon.rate : 12, 0);
      this.gunLfo.g.disconnect();
      this.gunLfo.g.connect(this.gunGate.gain);
      this.gunLfo.g.gain.value = 0.5;
      this.gunGate.gain.value = 0.5;
    }
    if (this.gun) this.gun.g.gain.setTargetAtTime(firing ? 0.35 : 0, t, 0.02);

    // 失速警報
    if (active && state.stallWarn && t > this.stallNext) {
      this._beep(def.model === 'fixedwing' ? 880 : 520, 0.12, 'square', 0.12);
      this.stats.stall++;
      this.stallNext = t + (def.id === 'airliner' ? 0.35 : 0.25);
    }
    // バリオ（滑空系: 上昇中はピッ、ピッと上がる音）
    if (active && def.hud === 'glide' && state.phase !== 'freefall' && state.phase !== 'deploying') {
      const vsp = state.vs;
      if (vsp > 0.15 && t > this.varioNext) {
        const f = 600 + Math.min(vsp, 6) * 140;
        this._beep(f, 0.08, 'sine', 0.13);
        this.stats.vario++;
        this.varioNext = t + clamp(0.45 - vsp * 0.06, 0.12, 0.45);
      } else if (def.id === 'paraglider' && vsp < -2.5 && t > this.varioNext) {
        this._beep(220, 0.5, 'sine', 0.05);
        this.stats.sink++;
        this.varioNext = t + 0.6;
      }
    }
  }

  _beep(freq, dur, type = 'sine', vol = 0.1) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  _burst(freq, dur, vol, type = 'lowpass') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  /** sim のイベントに応じた効果音 */
  event(ev) {
    if (!this.ctx || !this.enabled) return;
    switch (ev.type) {
      case 'ring':
        this._beep(880, 0.12, 'sine', 0.18);
        setTimeout(() => this.ctx && this._beep(1320, 0.18, 'sine', 0.16), 90);
        break;
      case 'ringMiss':
        this._beep(240, 0.25, 'sawtooth', 0.08);
        break;
      case 'crash':
        this._burst(900, 1.4, 0.9);
        this._burst(120, 2.0, 0.8);
        break;
      case 'touchdown':
        this._burst(200, 0.25, Math.min(0.6, 0.15 + Math.abs(ev.vs || 0) * 0.15));
        break;
      case 'kill':
        this._burst(600, 1.2, 0.8);
        this._burst(90, 1.6, 0.7);
        break;
      case 'pop':
        this._burst(2500, 0.12, 0.5, 'highpass');
        break;
      case 'playerHit':
        this._burst(180, 0.15, 0.6);
        break;
      case 'lock':
        this._beep(1500, 0.08, 'square', 0.1);
        setTimeout(() => this.ctx && this._beep(1500, 0.08, 'square', 0.1), 120);
        break;
      case 'missile':
        this._burst(900, 1.0, 0.45, 'bandpass');
        break;
      case 'noLock':
        this._beep(300, 0.15, 'square', 0.06);
        break;
      case 'deploy':
        this._burst(1500, 0.8, 0.25, 'highpass');
        break;
      case 'canopy':
        this._burst(300, 0.35, 0.5);
        break;
      case 'courseFinished':
      case 'result':
        [660, 880, 1100].forEach((f, i) => setTimeout(() => this.ctx && this._beep(f, 0.18, 'triangle', 0.14), i * 120));
        break;
      default:
    }
  }
}
