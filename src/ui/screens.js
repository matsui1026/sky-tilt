// 画面（タイトル → 機体選択 → ロケーション選択 → 飛行）、一時停止、設定、操作説明、操作ガイド、
// 2 人プレイのロビー、墜落、結果
import { h, tapButton } from './dom.js';
import { ICONS, LOC_THUMBS } from './icons.js';
import { VEHICLES, VEHICLE_ORDER } from '../data/vehicles.js';
import { LOCATIONS, LOCATION_ORDER, TIMES, TIME_ORDER, WEATHERS, WEATHER_ORDER, MODES, MODE_ORDER } from '../data/locations.js';
import { modesFor } from '../sim/modes.js';
import { fmtTime } from './hud.js';

function bars(label, n, cls = '') {
  const segs = h('div', { class: 'segs' });
  for (let i = 0; i < 5; i++) segs.append(h('div', { class: `seg${i < n ? ' f' : ''}` }));
  return h('div', { class: `bar ${cls}` }, h('span', { class: 'lbl' }, label), segs);
}

function segmented(items, order, selected, onSelect, nameKey = 'name', testPrefix = '') {
  const wrap = h('div', { class: 'seg-ctl' });
  const btns = {};
  const select = (id) => {
    Object.values(btns).forEach((x) => x.classList.remove('sel'));
    if (btns[id]) btns[id].classList.add('sel');
  };
  for (const id of order) {
    const b = tapButton(items[id][nameKey], () => {
      if (b.disabled) return;
      select(id);
      onSelect(id);
    }, '', { 'data-id': id, 'data-test': `${testPrefix}${id}` });
    if (id === selected) b.classList.add('sel');
    btns[id] = b;
    wrap.append(b);
  }
  wrap.select = select;
  wrap.setEnabled = (ids) => { for (const [id, b] of Object.entries(btns)) b.disabled = !ids.includes(id); };
  return wrap;
}

/** 機体ごとの操作説明の文言（vehicles.js の guide から） */
export function tutorialText(def) {
  const g = def.guide || {};
  const btn = def.buttons.length ? `左のボタン: ${def.buttons.filter((b) => !/R$/.test(b.id)).map((b) => b.label.replace(/[◀▶ ]/g, '')).join('・')}。` : '';
  return {
    tilt: g.tilt || '',
    buttons: `${g.throttle ? `右手のスライダー: ${g.throttle}` : ''}${btn}`,
    tip: (g.tips || [])[0] || '',
  };
}

const PC_KEYS = [
  ['W / ↑', '機首下げ（奥へ倒す）'], ['S / ↓', '機首上げ（手前に引く）'], ['A D / ← →', 'ロール（左右）'], ['Q / E', 'ヨー・ラダー'],
  ['Shift / Ctrl', 'スロットル 上げ / 下げ'], ['F', 'フラップ'], ['G', 'ギア'], ['X', 'スポイラー・エアブレーキ'], ['B', 'アフターバーナー'],
  ['Space', 'パラシュート'], ['T', '飛行 ⇄ 走行'], ['K / Enter', '射撃（押している間）'], ['M', 'ミサイル'], ['H / J', 'バーナー / 排気弁'],
  ['C', '視点切替'], ['R', '再キャリブレーション'], ['Y', '早送り（熱気球・滑空機）'], ['Esc / P', '一時停止'],
];
const PAD_KEYS = [['左スティック', 'ロール・ピッチ'], ['右スティック上下', 'スロットル'], ['LB / RB', 'ヨー'], ['A / RT', '射撃・バーナー（押している間）'], ['LT', '排気弁（熱気球）'], ['B', '機体ボタン（ラダー以外の最初のボタン）'], ['X', 'ミサイル'], ['Y', '視点'], ['Back', '早送り'], ['Start', '一時停止']];

export class Screens {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.el = {};
    this.state = { vehicle: 'prop', location: 'island', time: 'noon', weather: 'clear', mode: 'free' };
    this.current = null;
    this.mp = null; // 2 人プレイ中なら { role: 'host' | 'guest' }
    this.build();
  }

  build() {
    const r = this.root;
    // タイトル
    this.el.title = h('div', { class: 'screen bg-sky col center', id: 'scr-title' },
      h('h1', { class: 'title-logo' }, 'SKY', h('span', {}, 'TILT')),
      h('p', { class: 'subtitle' }, 'スマホを傾けて大空を飛ぼう'),
      tapButton('タップしてスタート', () => this.cb.onStart(), 'btn primary big', { id: 'btn-start' }),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        tapButton('👥 2人で飛ぶ', () => this.cb.onMultiplayer(), 'btn small', { id: 'btn-title-mp' }),
        tapButton('📖 操作ガイド', () => this.showGuide(null, 'title'), 'btn small', { id: 'btn-title-guide' }),
        tapButton('⚙ 設定', () => this.cb.onOpenSettings('title'), 'btn small', { id: 'btn-title-settings' })),
      h('div', { class: 'hint' }, '横向きで遊んでください ／ PC: WASD・矢印キー＝姿勢　Shift/Ctrl＝スロットル　Q/E＝ヨー　K＝射撃'),
    );

    // 機体選択
    const vcards = h('div', { class: 'cards', id: 'vehicle-cards' });
    this.vcardEls = {};
    for (const id of VEHICLE_ORDER) {
      const v = VEHICLES[id];
      const card = h('button', { class: 'card', type: 'button', 'data-vehicle': id },
        h('div', { html: ICONS[id] || ICONS.prop }),
        h('div', { class: 'name' }, v.short, v.weapon ? h('span', { class: 'badge' }, '武装') : null),
        h('div', { class: 'desc' }, v.desc),
        bars('速度', v.stats.speed), bars('機動性', v.stats.agility), bars('難易度', v.stats.difficulty, 'diff'));
      card.addEventListener('click', () => this.selectVehicle(id));
      card.addEventListener('dblclick', () => { this.selectVehicle(id); this.cb.onVehicleNext(); });
      this.vcardEls[id] = card;
      vcards.append(card);
    }
    this.vehicleTitle = h('h2', {}, '機体を選ぶ');
    this.el.vehicle = h('div', { class: 'screen bg-sky col', id: 'scr-vehicle' },
      h('div', { class: 'screen-head' },
        tapButton('← 戻る', () => this.cb.onVehicleBack(), 'btn small'),
        this.vehicleTitle,
        tapButton('📖 ガイド', () => this.showGuide(this.state.vehicle, 'vehicle'), 'btn small', { id: 'btn-vehicle-guide' }),
        tapButton('次へ →', () => this.cb.onVehicleNext(), 'btn primary', { id: 'btn-vehicle-next' })),
      h('div', { class: 'screen-body col', style: { justifyContent: 'center' } }, vcards, h('div', { class: 'swipe-hint' }, `← 横にスワイプで全 ${VEHICLE_ORDER.length} 機体 →`)),
    );
    const endWatch = (el) => {
      const upd = () => el.classList.toggle('at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
      el.addEventListener('scroll', upd, { passive: true });
      requestAnimationFrame(upd);
    };
    endWatch(vcards);

    // ロケーション選択
    const lcards = h('div', { class: 'cards', id: 'location-cards' });
    this.lcardEls = {};
    for (const id of LOCATION_ORDER) {
      const l = LOCATIONS[id];
      const card = h('button', { class: 'card loc-card', type: 'button', 'data-location': id },
        h('div', { class: 'loc-thumb', style: { background: LOC_THUMBS[id] } }),
        h('div', { class: 'name' }, l.name),
        h('div', { class: 'desc' }, l.desc));
      card.addEventListener('click', () => this.selectLocation(id));
      this.lcardEls[id] = card;
      lcards.append(card);
    }
    const s = this.state;
    this.modeCtl = segmented(MODES, MODE_ORDER, s.mode, (id) => { s.mode = id; this.updateNote(); }, 'name', 'mode-');
    const opts = h('div', { class: 'opts' },
      h('div', { class: 'k' }, '時間帯'), segmented(TIMES, TIME_ORDER, s.time, (id) => { s.time = id; this.updateNote(); }, 'name', 'time-'),
      h('div', { class: 'k' }, '天候'), segmented(WEATHERS, WEATHER_ORDER, s.weather, (id) => { s.weather = id; this.updateNote(); }, 'name', 'weather-'),
      h('div', { class: 'k' }, 'モード'), this.modeCtl,
    );
    this.noteEl = h('div', { class: 'loc-note', id: 'loc-note', style: { display: 'none' } });
    this.flyBtn = tapButton('飛行開始 ▶', () => this.cb.onFly({ ...this.state }), 'btn primary', { id: 'btn-fly' });
    this.el.location = h('div', { class: 'screen bg-sky col', id: 'scr-location' },
      h('div', { class: 'screen-head' },
        tapButton('← 機体', () => this.show('vehicle'), 'btn small'),
        h('h2', {}, 'ロケーション・時間帯・天候'),
        this.flyBtn),
      h('div', { class: 'col', style: { flex: '1', minHeight: '0', gap: '6px' } }, lcards, h('div', { class: 'row', style: { alignItems: 'flex-start', justifyContent: 'flex-start', flexWrap: 'nowrap' } }, opts, this.noteEl)),
    );

    // 一時停止
    this.el.pause = h('div', { class: 'screen dim col center', id: 'scr-pause' },
      h('div', { class: 'panel col center', style: { gap: '10px' } },
        h('h2', { style: { margin: '0' } }, '一時停止'),
        this.pauseMsg = h('div', { class: 'pause-msg', id: 'pause-msg' }),
        h('div', { class: 'menu-grid' },
          tapButton('▶ 再開', () => this.cb.onResume(), 'btn primary', { id: 'btn-resume' }),
          tapButton('⟲ 再キャリブレーション', () => this.cb.onRecalibrate(), 'btn', { id: 'btn-recal' }),
          tapButton('⚙ 設定', () => this.cb.onOpenSettings('pause'), 'btn', { id: 'btn-settings' }),
          tapButton('📖 操作ガイド', () => this.showGuide(this.cb.currentVehicle ? this.cb.currentVehicle() : null, 'pause'), 'btn', { id: 'btn-pause-guide' }),
          tapButton('✈ 機体変更', () => this.cb.onChangeVehicle(), 'btn', { id: 'btn-change-vehicle' }),
          tapButton('↺ リスタート', () => this.cb.onRestart(), 'btn', { id: 'btn-restart' }),
          tapButton('⌂ タイトルへ', () => this.cb.onTitle(), 'btn', { id: 'btn-title' }),
        )));

    this.el.settings = h('div', { class: 'screen dim col center', id: 'scr-settings' });
    this.el.tutorial = h('div', { class: 'screen dim col center', id: 'scr-tutorial' });
    this.el.guide = h('div', { class: 'screen bg-guide col', id: 'scr-guide' });
    this.el.lobby = h('div', { class: 'screen bg-sky col', id: 'scr-lobby' });
    this.el.wait = h('div', { class: 'screen bg-sky col center', id: 'scr-wait' });
    this.el.crash = h('div', { class: 'screen dim col center', id: 'scr-crash' });
    this.el.result = h('div', { class: 'screen dim col center', id: 'scr-result' });

    endWatch(lcards);
    for (const k of Object.keys(this.el)) r.append(this.el[k]);
    this.selectVehicle(this.state.vehicle);
    this.selectLocation(this.state.location);
  }

  setPauseMessage(msg) {
    this.pauseMsg.textContent = msg;
    this.pauseMsg.style.display = msg ? '' : 'none';
  }

  /** 2 人プレイの状態を反映（null で解除） */
  setMultiplayer(mp) {
    this.mp = mp;
    this.vehicleTitle.textContent = mp ? `機体を選ぶ（2人プレイ・${mp.role === 'host' ? 'ホスト' : 'ゲスト'}）` : '機体を選ぶ';
  }

  selectVehicle(id) {
    this.state.vehicle = id;
    for (const [k, el] of Object.entries(this.vcardEls)) el.classList.toggle('sel', k === id);
    // 機体で遊べないモードは選べなくする
    const ok = modesFor(VEHICLES[id]);
    if (this.modeCtl) {
      this.modeCtl.setEnabled(ok);
      if (!ok.includes(this.state.mode)) { this.state.mode = 'free'; this.modeCtl.select('free'); }
    }
    this.updateNote();
  }

  /** 選択の組み合わせに応じた注意書き */
  updateNote() {
    if (!this.noteEl) return;
    const s = this.state;
    const v = VEHICLES[s.vehicle];
    let msg = '';
    if (s.weather === 'windy' && s.vehicle === 'paraglider') msg = '⚠ 強風（13 m/s）はパラグライダーの速度（約 10 m/s）より速く、前に進めず押し戻されます';
    else if (s.mode === 'combat' && !v.weapon) msg = 'この機体は武器がありません。風船に体当たりして割りましょう';
    else if (s.mode === 'combat') msg = `武器: ${v.weapon.name}${v.weapon.missiles ? '・追尾ミサイル' : ''}。風船・地上の的・敵機を撃ち落とす`;
    else if (s.vehicle === 'balloon') msg = '熱気球はリングコース・射撃では遊べません。高さごとの風を使って目標へ';
    else if (s.weather === 'windy') msg = '強風と乱気流で機体が揺れます';
    else if (s.vehicle === 'paraglider' && s.time === 'night') msg = '夜はサーマルがほとんどありません。斜面上昇風を使いましょう';
    this.noteEl.textContent = msg;
    this.noteEl.style.display = msg ? '' : 'none';
  }
  selectLocation(id) {
    this.state.location = id;
    for (const [k, el] of Object.entries(this.lcardEls)) el.classList.toggle('sel', k === id);
  }

  show(name) {
    for (const [k, el] of Object.entries(this.el)) el.classList.toggle('on', k === name);
    this.current = name;
    if (name === 'vehicle') this.vcardEls[this.state.vehicle].scrollIntoView({ block: 'nearest', inline: 'center' });
    if (this.cb.onScreen) this.cb.onScreen(name);
  }
  hideAll() {
    for (const el of Object.values(this.el)) el.classList.remove('on');
    this.current = null;
    if (this.cb.onScreen) this.cb.onScreen(null);
  }

  // ---------- 設定 ----------
  showSettings(settings, onChange, onClose) {
    const el = this.el.settings;
    el.innerHTML = '';
    const rows = [];
    const slider = (key, label, min, max, step, fmt) => {
      const val = h('span', { class: 'val' }, fmt(settings[key]));
      const input = h('input', { type: 'range', min, max, step, value: settings[key], 'data-setting': key });
      input.addEventListener('input', () => {
        settings[key] = parseFloat(input.value);
        val.textContent = fmt(settings[key]);
        onChange(settings);
      });
      rows.push(h('div', { class: 'srow' }, h('label', {}, label), input, val));
    };
    const toggle = (key, label, on = '入', off = '切') => {
      const b = tapButton(settings[key] ? on : off, () => {
        settings[key] = !settings[key];
        b.textContent = settings[key] ? on : off;
        b.classList.toggle('on', !!settings[key]);
        onChange(settings);
      }, `btn small toggle${settings[key] ? ' on' : ''}`, { 'data-setting': key });
      rows.push(h('div', { class: 'srow' }, h('label', {}, label), h('div', {}, b), h('span')));
    };
    const choice = (key, label, items, prefix) => {
      rows.push(h('div', { class: 'srow wide' }, h('label', {}, label),
        segmented(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { name: v }])), Object.keys(items), settings[key], (id) => { settings[key] = id; onChange(settings); }, 'name', prefix), h('span')));
    };
    choice('control', '操作方式', { auto: '自動', tilt: '傾き', stick: 'スティック' }, 'control-');
    slider('sensitivity', '感度', 0.4, 2.5, 0.05, (v) => `${v.toFixed(2)}×`);
    slider('deadzone', 'デッドゾーン', 0, 8, 0.5, (v) => `${v.toFixed(1)}°`);
    slider('smoothing', 'スムージング', 0, 0.3, 0.01, (v) => `${Math.round(v * 1000)}ms`);
    slider('expo', 'エクスポ', 0, 0.9, 0.05, (v) => v.toFixed(2));
    toggle('invertPitch', 'ピッチ反転');
    slider('volume', '音量', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    toggle('vibrate', '振動');
    toggle('cameraShake', 'カメラの揺れ');
    toggle('minimap', 'レーダー');
    toggle('ghost', 'ゴースト');
    choice('quality', '画質', { auto: '自動', high: '高', low: '低（省電力）' }, 'quality-');
    choice('difficulty', '射撃の難易度', { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' }, 'difficulty-');
    toggle('lefty', '左利き配置（スティックを右に）');
    el.append(h('div', { class: 'panel settings col', style: { gap: '4px' } },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', { style: { margin: '0' } }, '設定'), tapButton('閉じる', onClose, 'btn primary small', { id: 'btn-settings-close' })),
      h('div', { class: 'settings-grid' }, ...rows),
      h('div', { class: 'hint', style: { textAlign: 'left', marginTop: '4px' } }, '傾き操作: 開始時の持ち方が「ニュートラル」。持ち方を変えたら ⟲ で再キャリブレーション。ゴースト: リングコースの自己ベストの飛び方を半透明で表示。難易度: エイムアシストの強さ・敵の弾の精度と威力・敵の数が変わります。'),
    ));
    this.show('settings');
  }

  // ---------- 操作説明（3 枚） ----------
  /** opts: { combat: 射撃モードの説明を足す, combatOnly: 射撃の説明だけ（機体の説明は見たことがある） } */
  showTutorial(def, onDone, opts = {}) {
    const el = this.el.tutorial;
    const T = tutorialText(def);
    let pages = [
      {
        t: `1. 持ち方とキャリブレーション（${def.short}）`,
        // 横から見た図: 端末を手前に 30〜60° 傾けて持つ
        svg: '<svg viewBox="0 0 200 106"><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><line x1="20" y1="88" x2="180" y2="88" stroke-dasharray="6 6" stroke-width="2"/><circle cx="40" cy="30" r="9"/><line x1="52" y1="34" x2="92" y2="44" stroke-width="2" stroke-dasharray="3 4"/><line x1="100" y1="78" x2="136" y2="34" stroke-width="7"/><path d="M150 78 A36 36 0 0 0 126 50" stroke="#3affb0" stroke-width="2"/></g><text x="158" y="58" fill="#3affb0" font-size="12">30〜60°</text><text x="62" y="70" fill="#ffd28a" font-size="11">顔</text><text x="100" y="104" fill="#9fb0c4" font-size="10" text-anchor="middle">（横から見た図）</text></svg>',
        p: ['スマホを横向きにして、手前に少し傾けた楽な姿勢で持ちます。', '飛行開始時の持ち方が「ニュートラル」になります。左上の ⟲ でいつでも再キャリブレーションできます（押したら 0.5 秒そのまま）。'],
      },
      {
        t: '2. 傾けて操縦',
        svg: '<svg viewBox="0 0 200 100"><g fill="none" stroke="#fff" stroke-width="3"><rect x="60" y="30" width="80" height="44" rx="8"/><path d="M40 52 A60 60 0 0 1 60 20" /><path d="M160 52 A60 60 0 0 0 140 20"/><path d="M100 84 L100 96 M92 90 L100 98 L108 90" stroke="#ffc23a"/></g><text x="100" y="18" fill="#3affb0" font-size="13" text-anchor="middle">ハンドルのように左右 ／ 手前・奥</text></svg>',
        p: [T.tilt, 'センサーが使えない端末では、左下のスティックで操縦します。'],
      },
      {
        t: '3. スロットルとボタン',
        svg: '<svg viewBox="0 0 200 100"><g fill="none" stroke="#fff" stroke-width="3"><rect x="150" y="14" width="26" height="76" rx="8"/><rect x="153" y="52" width="20" height="16" rx="4" fill="#fff"/><rect x="20" y="56" width="40" height="28" rx="7"/><rect x="66" y="56" width="40" height="28" rx="7"/></g><text x="62" y="44" fill="#3affb0" font-size="12" text-anchor="middle">機体ボタン</text><text x="162" y="10" fill="#3affb0" font-size="12" text-anchor="middle">スロットル</text></svg>',
        p: [T.buttons, T.tip, '詳しい説明は ❚❚ →「操作ガイド」。'],
      },
    ];
    if (opts.combat) {
      const w = def.weapon;
      const combatPage = {
        t: `射撃モード（${def.short}）`,
        svg: '<svg viewBox="0 0 200 100"><g fill="none" stroke-width="2.5"><circle cx="80" cy="50" r="16" stroke="#fff"/><path d="M54 50h18M88 50h18M80 24v18M80 58v18" stroke="#fff"/><path d="M80 50L128 38" stroke="#ffe24a" stroke-dasharray="4 4"/><circle cx="128" cy="38" r="7" stroke="#ffe24a"/><path d="M150 26l10 10-10 10-10-10z" stroke="#ff5a4a"/><path d="M30 86A70 70 0 0 1 20 60" stroke="#ff3c28" stroke-width="6"/></g><text x="128" y="62" fill="#ffe24a" font-size="10" text-anchor="middle">偏差照準</text><text x="160" y="60" fill="#ff5a4a" font-size="10" text-anchor="middle">敵機</text></svg>',
        p: w
          ? [`右下の「${w.name}」を押している間撃ちます。白い照準の近くの目標には自動で狙いが補正され、黄色の点（目標の未来位置）へ弾が飛びます。`,
            w.missiles ? '敵を正面の枠に入れ続けると LOCK。「ミサイル」で追尾ミサイルを発射します。' : null,
            '画面中央の赤い弧は撃たれた方向。風船・地上の的・敵機（3 波）を全部倒すとクリアです。']
          : ['この機体に武器はありません。風船に体当たりして割ります。', '飛び直せない機体は、着地した時点の点数で終わります。'],
      };
      pages = opts.combatOnly ? [combatPage] : [...pages, combatPage];
    }
    let i = 0;
    const render = () => {
      el.innerHTML = '';
      const pg = pages[i];
      const dots = h('div', { class: 'dots' }, pages.map((_, k) => h('div', { class: `dot${k === i ? ' on' : ''}` })));
      el.append(h('div', { class: 'panel tut col center' },
        h('h3', {}, pg.t),
        h('div', { html: pg.svg }),
        ...pg.p.filter(Boolean).map((t) => h('p', {}, t)),
        dots,
        h('div', { class: 'row' },
          tapButton('スキップ', () => onDone(), 'btn small', { id: 'btn-tut-skip' }),
          tapButton(i < pages.length - 1 ? '次へ →' : '飛ぶ！', () => { if (i < pages.length - 1) { i++; render(); } else onDone(); }, 'btn primary', { id: 'btn-tut-next' }))));
    };
    render();
    this.show('tutorial');
  }

  // ---------- 操作ガイド ----------
  showGuide(vehicleId, from) {
    const el = this.el.guide;
    el.innerHTML = '';
    const list = h('div', { class: 'guide-list', id: 'guide-list' });
    const content = h('div', { class: 'guide-content', id: 'guide-content' });
    const chips = {};
    const renderCommon = () => {
      content.innerHTML = '';
      content.append(
        h('h3', {}, '共通の操作'),
        h('h4', {}, '持ち方と傾き'),
        h('p', {}, 'スマホを横向きにして、手前に少し傾けた楽な姿勢で持ちます。飛行開始時（と ⟲ を押したとき）の持ち方が「ニュートラル」です。'),
        h('ul', {},
          h('li', {}, 'ハンドルのように左右に回す → ロール（旋回）'),
          h('li', {}, '画面の上端を手前に引く → 機首上げ ／ 奥へ倒す → 機首下げ'),
          h('li', {}, '体の向きを変えても操作は変わりません（重力が基準）。端末を逆向きに持ち替えると自動で一時停止します')),
        h('h4', {}, '画面のボタン'),
        h('div', { class: 'stat-grid guide-grid' },
          ...[['❚❚（左上）', '一時停止。設定・操作ガイド・機体変更・リスタート'], ['⟲（左上）', '再キャリブレーション（今の持ち方をニュートラルに。押したら 0.5 秒そのまま）'], ['視点（右上）', '後方追従 → コックピット → 外部視点'], ['▶×1（右上）', '早送り ×1 → ×2 → ×4（熱気球・パラグライダー・グライダーの自由飛行／着陸チャレンジ。地面が近いと自動で ×1）'], ['スロットル（右下）', '縦にドラッグして出力を調整（触れた位置には飛ばない）'], ['射撃（右下）', '射撃モードで、押している間撃つ。白い照準の近くの的には自動で狙いを補正し、黄色の点（偏差照準＝目標の未来位置）へ弾が飛ぶ'], ['画面中央の赤い弧', '撃たれた方向。「敵機に狙われています」が出たら旋回して振り切る'], ['左下の機体ボタン', '機体ごとに違う（左の一覧から機体を選ぶと説明）'], ['スティック（左下）', '傾きセンサーが使えないとき。下へ引くと機首上げ'], ['レーダー（右上）', '機首方向が上。緑=次のリング、赤=敵、橙=目標、水色=相手のプレイヤー']].map(([k, v]) => [h('span', { class: 'k' }, k), h('span', {}, v)]).flat()),
        h('h4', {}, 'モード'),
        h('ul', {},
          h('li', {}, 'フリーフライト: 自由に飛ぶ。滑走路・着陸エリアに降りると評価'),
          h('li', {}, 'リングコース: 番号順にリングをくぐるタイムアタック。画面の円（緑＝このままで通れる）と距離・秒数を目安に。外すと +5 秒'),
          h('li', {}, '射撃: 風船・地上の的・敵機（3 波）を撃ち落とす。武器の無い機体は風船に体当たり。全部倒すとクリア（早いほどボーナス）。パラグライダーなど飛び直せない機体は、着地した時点の点数で終了。難易度は設定で変えられます'),
          h('li', {}, '着陸チャレンジ: 進入の途中から始まり、降下率・接地速度・精度で採点'),
          h('li', {}, '2人で飛ぶ: タイトルの「👥 2人で飛ぶ」。同じ場所を一緒に飛び、リングで競争（遅い方の機体に合わせたコース）・射撃で撃ち合い（撃墜 +1000 点）。レーダーの下に通信の往復時間が出ます')),
        h('h4', {}, '設定'),
        h('ul', {},
          h('li', {}, '左利き配置: スティック・機体ボタンを右、スロットル・射撃ボタンを左に入れ替え'),
          h('li', {}, '射撃の難易度: やさしい／ふつう／むずかしい（エイムアシストの強さ、敵の弾の精度と威力、敵の数）')),
        h('h4', {}, 'PC のキーボード'),
        h('div', { class: 'stat-grid guide-grid' }, ...PC_KEYS.map(([k, v]) => [h('span', { class: 'k' }, k), h('span', {}, v)]).flat()),
        h('h4', {}, 'ゲームパッド'),
        h('div', { class: 'stat-grid guide-grid' }, ...PAD_KEYS.map(([k, v]) => [h('span', { class: 'k' }, k), h('span', {}, v)]).flat()),
      );
    };
    const renderVehicle = (id) => {
      const v = VEHICLES[id];
      const g = v.guide || {};
      content.innerHTML = '';
      content.append(
        h('div', { class: 'guide-head' }, h('div', { class: 'guide-icon', html: ICONS[id] || '' }), h('div', {}, h('h3', {}, v.name), h('p', { class: 'muted' }, v.desc))),
        h('h4', {}, '傾き'), h('p', {}, g.tilt || ''),
        h('h4', {}, 'スロットル（右手）'), h('p', {}, g.throttle || '—'),
        h('h4', {}, '機体ボタン（左手）'),
        v.buttons.length
          ? h('div', { class: 'stat-grid guide-grid' }, ...v.buttons.map((b) => [h('span', { class: 'k btnlabel' }, b.label), h('span', {}, `${b.desc || ''}${b.type === 'hold' ? '（押している間）' : ''}`)]).flat())
          : h('p', {}, 'なし'),
        h('h4', {}, '射撃モード'),
        h('p', {}, v.weapon ? `${v.weapon.name}（毎秒 ${v.weapon.rate} 発・${v.weapon.ammo} 発）${v.weapon.missiles ? `。追尾ミサイル ${v.weapon.missiles} 発: 敵を正面の円に約 ${v.weapon.lockTime} 秒入れ続けるとロックオン → 「ミサイル」` : ''}` : '武器なし。風船に体当たりして割る'),
        h('h4', {}, 'コツ'), h('ul', {}, ...(g.tips || []).map((t) => h('li', {}, t))),
      );
    };
    const select = (id) => {
      for (const [k, c] of Object.entries(chips)) c.classList.toggle('sel', k === (id || 'common'));
      if (id) renderVehicle(id); else renderCommon();
      content.scrollTop = 0;
    };
    chips.common = tapButton('共通の操作', () => select(null), 'chip', { 'data-guide': 'common' });
    list.append(chips.common);
    for (const id of VEHICLE_ORDER) {
      chips[id] = tapButton(VEHICLES[id].short, () => select(id), 'chip', { 'data-guide': id });
      list.append(chips[id]);
    }
    el.append(
      h('div', { class: 'screen-head' },
        tapButton('← 戻る', () => this.show(from || 'title'), 'btn small', { id: 'btn-guide-back' }),
        h('h2', {}, '操作ガイド')),
      h('div', { class: 'guide-body' }, list, content),
    );
    select(vehicleId);
    this.show('guide');
  }

  // ---------- 2 人プレイ ----------
  /**
   * ロビー画面。cb: { host(name), join(name, code), manualHost(name), manualAccept(text), manualJoin(name, offer), back, proceed }
   */
  showLobby(cb, info = {}) {
    const el = this.el.lobby;
    el.innerHTML = '';
    const nameIn = h('input', { type: 'text', id: 'mp-name', maxlength: '10', value: info.name || '', placeholder: '名前' });
    const codeIn = h('input', { type: 'text', id: 'mp-code', maxlength: '6', placeholder: 'コード', style: { textTransform: 'uppercase' } });
    this.lobbyStatus = h('div', { class: 'lobby-status', id: 'mp-status' }, info.status || '同じ場所を 2 人で飛べます。片方が「ルームを作る」、もう片方がそのコードで「参加」。');
    const manualOut = h('textarea', { id: 'mp-manual-out', readonly: true, rows: '2', placeholder: 'ここに表示される接続コードを相手に送る' });
    const manualIn = h('textarea', { id: 'mp-manual-in', rows: '2', placeholder: '相手から届いた接続コードを貼り付け' });
    this.lobbyManualOut = manualOut;
    const manual = h('div', { class: 'lobby-manual', style: { display: 'none' } },
      h('div', { class: 'muted' }, 'サーバーを使わない接続（コードを 1 往復コピーし合う）: ホストは「作成」→ 出たコードを相手へ → 相手が貼って「応答」→ 相手のコードを貼って「接続」'),
      h('div', { class: 'row', style: { justifyContent: 'flex-start' } },
        tapButton('作成（ホスト）', () => cb.manualHost(nameIn.value), 'btn small', { id: 'btn-mp-manual-host' }),
        tapButton('応答（参加）', () => cb.manualJoin(nameIn.value, manualIn.value), 'btn small', { id: 'btn-mp-manual-join' }),
        tapButton('接続', () => cb.manualAccept(manualIn.value), 'btn small', { id: 'btn-mp-manual-accept' }),
        tapButton('コピー', () => { try { navigator.clipboard.writeText(manualOut.value); } catch (e) { /* 非対応 */ } manualOut.select(); }, 'btn small')),
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, manualOut, manualIn));
    this.lobbyProceed = tapButton('機体を選ぶ →', () => cb.proceed(), 'btn primary', { id: 'btn-mp-proceed', style: { display: info.connected ? '' : 'none' } });
    el.append(
      h('div', { class: 'screen-head' },
        tapButton('← 戻る', () => cb.back(), 'btn small', { id: 'btn-mp-back' }),
        h('h2', {}, '2人で飛ぶ'),
        this.lobbyProceed),
      h('div', { class: 'panel col', style: { gap: '10px', overflowY: 'auto' } },
        h('div', { class: 'row', style: { justifyContent: 'flex-start' } },
          h('label', { class: 'muted' }, '名前'), nameIn,
          tapButton('ルームを作る', () => cb.host(nameIn.value), 'btn primary small', { id: 'btn-mp-host' }),
          h('span', { class: 'muted' }, 'または'), codeIn,
          tapButton('参加', () => cb.join(nameIn.value, codeIn.value), 'btn small', { id: 'btn-mp-join' }),
          tapButton('サーバーなしで接続', () => { manual.style.display = manual.style.display === 'none' ? '' : 'none'; }, 'btn small', { id: 'btn-mp-manual' })),
        this.lobbyStatus,
        manual),
    );
    this.show('lobby');
  }

  setLobbyStatus(text, { connected = false, code = null, manualCode = null } = {}) {
    if (this.lobbyStatus) this.lobbyStatus.innerHTML = '';
    if (this.lobbyStatus) {
      if (code) this.lobbyStatus.append(h('div', { class: 'room-code', id: 'mp-room-code' }, code));
      this.lobbyStatus.append(h('div', {}, text));
    }
    if (manualCode != null && this.lobbyManualOut) this.lobbyManualOut.value = manualCode;
    if (this.lobbyProceed) this.lobbyProceed.style.display = connected ? '' : 'none';
  }

  /** ゲスト: ホストが開始するのを待つ */
  showWait(info, onBack) {
    const el = this.el.wait;
    el.innerHTML = '';
    el.append(h('div', { class: 'panel col center', style: { gap: '10px', minWidth: '380px' } },
      h('h2', { style: { margin: '0' } }, 'ホストの開始を待っています'),
      h('div', { id: 'mp-wait-info' }, info || ''),
      h('div', { class: 'spinner' }),
      tapButton('← 機体を選び直す', onBack, 'btn small', { id: 'btn-wait-back' })));
    this.show('wait');
  }

  // ---------- 墜落 ----------
  showCrash(cause, cb) {
    const el = this.el.crash;
    el.innerHTML = '';
    el.append(h('div', { class: 'panel col center', style: { gap: '10px', minWidth: '360px' } },
      h('h2', { class: 'crash-title' }, '墜落'),
      h('p', { style: { margin: '0', fontSize: '16px' } }, cause || ''),
      h('div', { class: 'row' },
        tapButton('↺ リトライ', cb.retry, 'btn primary', { id: 'btn-retry' }),
        tapButton('✈ 機体変更', cb.vehicle, 'btn', { id: 'btn-crash-vehicle' }),
        tapButton('🗺 ロケーション', cb.location, 'btn', { id: 'btn-crash-location' }))));
    this.show('crash');
  }

  // ---------- 結果（着陸評価 / リングコース / 射撃） ----------
  showResult(res, def, cb) {
    const el = this.el.result;
    el.innerHTML = '';
    let body, title;
    if (res.type === 'landing') {
      title = '着陸成功！';
      const kmh = (v) => `${Math.round(v * 3.6)} km/h`;
      const rows = [
        ['降下率', `${res.vs.toFixed(2)} m/s`],
        ['接地速度', kmh(res.airspeed ?? res.speed)],
      ];
      if (res.idealSpeed) rows.push(['目安の接地速度', kmh(res.idealSpeed)]);
      if (def.model === 'fixedwing') rows.push(['センターラインからのずれ', `${Math.abs(res.centerline).toFixed(1)} m`]);
      else rows.push(['目標からの距離', `${res.dist.toFixed(1)} m`]);
      rows.push(['接地面', { runway: '滑走路', field: '着陸エリア', ground: '地面', roof: '屋上' }[res.surface] || res.surface]);
      body = h('div', { class: 'row', style: { gap: '28px', alignItems: 'center' } },
        h('div', { class: 'col center' }, h('div', { class: `result-grade grade-${res.grade}`, id: 'result-grade' }, res.grade), h('div', {}, res.comment)),
        h('div', { class: 'col', style: { gap: '8px' } },
          h('div', { style: { fontSize: '22px', fontWeight: '800' } }, `スコア ${res.score}`),
          h('div', { class: 'stat-grid' }, rows.map(([k, v]) => [h('span', { class: 'k' }, k), h('span', {}, v)]))));
    } else if (res.type === 'combat') {
      title = res.partial ? '着地 — ここで終了' : '全目標クリア！';
      const acc = res.shots ? Math.round((res.hits / res.shots) * 100) : null;
      body = h('div', { class: 'col center', style: { gap: '6px' } },
        h('div', { style: { fontSize: '40px', fontWeight: '900' }, id: 'result-score' }, `${res.score} 点`),
        h('div', { class: 'stat-grid' },
          h('span', { class: 'k' }, 'タイム'), h('span', {}, `${fmtTime(res.time)}（ボーナス +${res.timeBonus}）`),
          h('span', { class: 'k' }, '撃墜'), h('span', {}, `${res.kills} 機`),
          h('span', { class: 'k' }, '命中率'), h('span', {}, acc == null ? (def.weapon ? '—（撃っていません）' : '—（体当たり）') : `${acc}%（${res.hits}/${res.shots}）`),
          h('span', { class: 'k' }, '残り体力'), h('span', {}, `${res.health}`),
          res.partial ? h('span', { class: 'k' }, '残りの目標') : null, res.partial ? h('span', {}, `${res.targetsLeft} 個`) : null,
          h('span', { class: 'k' }, '難易度'), h('span', {}, { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' }[res.difficulty] || 'ふつう'),
          h('span', { class: 'k' }, 'ベスト'), h('span', {}, res.best != null ? `${res.best} 点` : '—')),
        res.newBest ? h('div', { style: { color: '#ffd84a', fontWeight: '800' } }, '新記録！') : null);
    } else {
      title = 'ゴール！';
      body = h('div', { class: 'col center', style: { gap: '6px' } },
        h('div', { style: { fontSize: '44px', fontWeight: '900' }, id: 'result-time' }, fmtTime(res.total)),
        h('div', { class: 'stat-grid' },
          h('span', { class: 'k' }, '通過'), h('span', {}, `${res.passed} / ${res.passed + res.missed}`),
          h('span', { class: 'k' }, 'ペナルティ'), h('span', {}, `+${res.penalty} 秒`),
          h('span', { class: 'k' }, 'ベスト'), h('span', {}, res.best != null ? `${fmtTime(res.best)}（${res.bestPassed} 個通過）` : '—'),
          res.opponent ? h('span', { class: 'k' }, '相手') : null, res.opponent ? h('span', {}, res.opponent) : null),
        res.newBest && res.missed === 0 ? h('div', { style: { color: '#ffd84a', fontWeight: '800' } }, '全リング通過・新記録！') : null);
    }
    el.append(h('div', { class: 'panel col center', style: { gap: '12px', minWidth: '420px' } },
      h('h2', { style: { margin: '0' } }, title),
      body,
      h('div', { class: 'row' },
        cb.continue ? tapButton('▶ 続ける', cb.continue, 'btn', { id: 'btn-continue' }) : null,
        tapButton('↺ もう一度', cb.retry, 'btn primary', { id: 'btn-result-retry' }),
        tapButton('✈ 機体変更', cb.vehicle, 'btn', { id: 'btn-result-vehicle' }),
        tapButton('🗺 ロケーション', cb.location, 'btn', { id: 'btn-result-location' }),
        cb.share ? tapButton('共有', cb.share, 'btn', { id: 'btn-result-share' }) : null)));
    this.show('result');
  }
}
