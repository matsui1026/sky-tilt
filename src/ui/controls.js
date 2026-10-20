// 飛行中の操作 UI（左: 機体ボタン / スティック、右: スロットル、上: 一時停止・再キャリブレーション・視点）
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
    this.vbuttons = h('div', { id: 'vbuttons' });
    this.stickKnob = h('div', { id: 'stick-knob' });
    this.stickEl = h('div', { id: 'stick', class: 'ctl' }, this.stickKnob, h('div', { id: 'stick-label' }, 'スティック'));
    this.leftZone = h('div', { id: 'left-zone' }, this.vbuttons, this.stickEl);
    this.thrFill = h('div', { id: 'throttle-fill' });
    this.thrKnob = h('div', { id: 'throttle-knob' }, '0%');
    this.thrLabel = h('div', { id: 'throttle-label' }, 'スロットル');
    this.thrEl = h('div', { id: 'throttle', class: 'ctl' }, this.thrFill, this.thrLabel, this.thrKnob);
    this.el.append(
      h('div', { id: 'top-left' }, this.pause, this.recal),
      h('div', { id: 'top-right' }, this.cam),
      this.leftZone,
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

  setVehicle(def) {
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
    const noThrottle = def.model === 'paraglider' || def.model === 'human';
    this.thrEl.style.display = noThrottle ? 'none' : '';
    this.thrLabel.textContent = def.model === 'heli' ? 'コレクティブ' : def.model === 'jetsuit' ? '推力' : 'スロットル';
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
  }
}
