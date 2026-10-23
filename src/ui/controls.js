// 飛行中の操作 UI（左: 機体ボタン / スティック、右: スロットル＋射撃、上: 一時停止・再キャリブレーション・視点）
import { h } from './dom.js';
import { VirtualStick, ThrottleSlider, bindButton } from '../input/touch.js';

export class FlightControls {
  constructor(root, cb) {
    this.cb = cb;
    this.el = h('div', { id: 'controls' });
    this.pause = h('button', { class: 'hbtn icon-btn ctl', id: 'btn-pause', type: 'button', 'aria-label': '一時停止' }, '❚❚');
    this.recal = h('button', { class: 'hbtn icon-btn ctl', id: 'btn-hud-recal', type: 'button', 'aria-label': '再キャリブレーション' }, '⟲');
    this.cam = h('button', { class: 'hbtn ctl', id: 'btn-camera', type: 'button', 'aria-label': '視点切替' }, '視点');
    bindButton(this.pause, { id: 'pause', type: 'tap' }, { action: () => cb.onPause() });
    bindButton(this.recal, { id: 'recal', type: 'tap' }, { action: () => cb.onRecalibrate() });
    bindButton(this.cam, { id: 'camera', type: 'tap' }, { action: () => cb.onCamera() });
    // 早送り（熱気球・滑空機など、ゆっくりした機体の移動時間を縮める）
    this.warp = h('button', { class: 'hbtn ctl', id: 'btn-warp', type: 'button', 'aria-label': '早送り' }, '▶×1');
    bindButton(this.warp, { id: 'warp', type: 'tap' }, { action: () => cb.onWarp && cb.onWarp() });
    this.vbuttons = h('div', { id: 'vbuttons' });
    this.stickKnob = h('div', { id: 'stick-knob' });
    this.stickEl = h('div', { id: 'stick', class: 'ctl' }, this.stickKnob, h('div', { id: 'stick-label' }, 'スティック'));
    this.leftZone = h('div', { id: 'left-zone' }, this.vbuttons, this.stickEl);
    this.thrFill = h('div', { id: 'throttle-fill' });
    this.thrKnob = h('div', { id: 'throttle-knob' }, '0%');
    this.thrLabel = h('div', { id: 'throttle-label' }, 'スロットル');
    this.thrEl = h('div', { id: 'throttle', class: 'ctl' }, this.thrFill, this.thrLabel, this.thrKnob);
    // 射撃（右手の親指でスロットルのすぐ左）
    this.fireBtn = h('button', { class: 'hbtn ctl fire-btn', id: 'btn-fire', type: 'button', 'data-button': 'fire' }, '射撃');
    this.missileBtn = h('button', { class: 'hbtn ctl', id: 'btn-missile', type: 'button', 'data-button': 'missile' }, 'ミサイル');
    bindButton(this.fireBtn, { id: 'fire', type: 'hold' }, { hold: (id, on) => cb.onHold(id, on) });
    bindButton(this.missileBtn, { id: 'missile', type: 'once' }, { action: (id) => cb.onAction(id) });
    this.weaponZone = h('div', { id: 'weapon-zone' }, this.missileBtn, this.fireBtn);
    this.el.append(
      h('div', { id: 'top-left' }, this.pause, this.recal),
      h('div', { id: 'top-right' }, this.warp, this.cam),
      this.leftZone,
      this.weaponZone,
      this.thrEl,
    );
    root.append(this.el);
    this.stick = new VirtualStick(this.stickEl, this.stickKnob);
    this.throttle = new ThrottleSlider(this.thrEl, this.thrFill, this.thrKnob, (v, user) => {
      this.thrKnob.textContent = `${Math.round(v * 100)}%`;
      cb.onThrottle(v, user);
    });
    this.buttonEls = {};
  }

  show(on) {
    this.el.classList.toggle('on', on);
  }

  /** combat: 射撃モードなら武器ボタンを出す */
  setVehicle(def, { combat = false, warp = false } = {}) {
    this.warp.style.display = warp ? '' : 'none';
    this.setWarp(1);
    this.vbuttons.innerHTML = '';
    this.buttonEls = {};
    const cols = def.buttons.length > 4 ? 3 : 2;
    this.vbuttons.style.gridTemplateColumns = `repeat(${cols}, minmax(64px, auto))`;
    for (const spec of def.buttons) {
      const b = h('button', { class: 'hbtn ctl', type: 'button', 'data-button': spec.id }, spec.label);
      if (def.buttons.length % cols === 1 && spec === def.buttons[def.buttons.length - 1]) b.classList.add('wide');
      bindButton(b, spec, { hold: (id, on) => this.cb.onHold(id, on), action: (id) => this.cb.onAction(id) });
      this.buttonEls[spec.id] = b;
      this.vbuttons.append(b);
    }
    const noThrottle = def.model === 'paraglider' || def.model === 'human' || !!(def.p.thrust && def.p.thrust.type === 'none');
    this.thrEl.style.display = noThrottle ? 'none' : '';
    this.thrLabel.textContent = { heli: def.id === 'drone' ? '推力' : 'コレクティブ', jetsuit: '推力', balloon: 'バーナー', flycar: 'アクセル' }[def.model] || 'スロットル';
    const armed = combat && !!def.weapon;
    this.weaponZone.style.display = armed ? '' : 'none';
    this.weaponZone.classList.toggle('no-throttle', noThrottle);
    this.missileBtn.style.display = armed && def.weapon.missiles ? '' : 'none';
    this.fireBtn.textContent = armed ? def.weapon.name : '射撃';
  }

  setWarp(k) {
    this.warp.textContent = k > 1 ? `▶▶×${k}` : '▶×1';
    this.warp.classList.toggle('on', k > 1);
  }

  setStickVisible(on) {
    this.stickEl.classList.toggle('on', on);
  }

  /** ボタンの状態表示（トグル中は点灯） */
  sync(st) {
    const b = this.buttonEls;
    if (b.flaps) b.flaps.innerHTML = `フラップ<span class="sub">${['UP', '1', st.vehicleId === 'airliner' ? 'FULL' : '2'][Math.round(st.flaps)]}</span>`;
    if (b.gear) { b.gear.classList.toggle('on', !!st.gearCmd); b.gear.innerHTML = `ギア<span class="sub">${st.gearCmd ? 'DOWN' : 'UP'}</span>`; }
    if (b.spoiler) b.spoiler.classList.toggle('on', !!st.spoiler);
    if (b.ab) b.ab.classList.toggle('on', !!st.ab || !!st.abCmd);
    if (b.deploy) {
      const done = st.phase && st.phase !== 'freefall' && st.phase !== 'wingsuit';
      b.deploy.classList.toggle('on', !!done);
      b.deploy.disabled = !!done;
    }
    if (b.carMode) {
      const fly = st.carMode === 'fly';
      b.carMode.classList.toggle('on', fly);
      b.carMode.innerHTML = `${fly ? '飛行中' : '走行中'}<span class="sub">押すと${fly ? '走行へ' : '飛行へ'}</span>`;
      // ヨーは飛行中だけ（走行中はハンドル）。場所は空けたままにして配置を動かさない
      for (const k of ['rudderL', 'rudderR']) if (b[k]) b[k].style.visibility = fly ? '' : 'hidden';
    }
    if (st.combat) {
      const c = st.combat;
      if (c.armed) this.fireBtn.innerHTML = `${c.weaponName}<span class="sub">残 ${c.ammo}</span>`;
      this.missileBtn.innerHTML = `ミサイル<span class="sub">${c.lock.locked ? 'ロック!' : '残 ' + c.missiles}</span>`;
      this.missileBtn.classList.toggle('on', !!c.lock.locked);
    }
  }
}
