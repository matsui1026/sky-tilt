// 画面（タイトル → 機体選択 → ロケーション選択 → 飛行）、一時停止、設定、操作説明、墜落、着陸評価
import { h, tapButton } from './dom.js';
import { ICONS, LOC_THUMBS } from './icons.js';
import { VEHICLES, VEHICLE_ORDER } from '../data/vehicles.js';
import { LOCATIONS, LOCATION_ORDER, TIMES, TIME_ORDER, WEATHERS, WEATHER_ORDER, MODES, MODE_ORDER } from '../data/locations.js';
import { fmtTime } from './hud.js';

function bars(label, n, cls = '') {
  const segs = h('div', { class: 'segs' });
  for (let i = 0; i < 5; i++) segs.append(h('div', { class: `seg${i < n ? ' f' : ''}` }));
  return h('div', { class: `bar ${cls}` }, h('span', { class: 'lbl' }, label), segs);
}

function segmented(items, order, selected, onSelect, nameKey = 'name', testPrefix = '') {
  const wrap = h('div', { class: 'seg-ctl' });
  const btns = {};
  for (const id of order) {
    const b = tapButton(items[id][nameKey], () => {
      Object.values(btns).forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onSelect(id);
    }, '', { 'data-id': id, 'data-test': `${testPrefix}${id}` });
    if (id === selected) b.classList.add('sel');
    btns[id] = b;
    wrap.append(b);
  }
  return wrap;
}

/** 機体ごとの操作説明の文言 */
export function tutorialText(def) {
  switch (def.id) {
    case 'heli':
      return {
        tilt: '傾けた方向に機体が傾いて進みます（サイクリック）。手前で減速・後退、奥で前進。',
        buttons: '右手のスライダーはコレクティブ（上下の推力）。左のボタンでテールロータ（向きを変える）。',
        tip: '約 63% でホバリング。地面の近くは地面効果で浮きやすくなります。',
      };
    case 'jetsuit':
      return {
        tilt: '傾けた方向に体が傾き、推力の向きが変わります。奥へ倒すと前進、手前で減速。左右で横移動しながら旋回。',
        buttons: '右手のスライダーが推力。左のボタンで向きを変えます。',
        tip: '約 60% でホバリング。右上の燃料ゲージに注意。',
      };
    case 'paraglider':
      return {
        tilt: '左右に傾けると片側ブレーク（その方向へ旋回）、手前に傾けると両ブレーク（減速）、奥へ倒すとスピードバー（加速）。',
        buttons: '推力はありません。風上側の斜面（斜面上昇風）や積雲の下（サーマル）で上昇し、ピッ、ピッとバリオ音が鳴ります。',
        tip: '着地は風に向かって。地面すれすれで手前に引いてフレア（減速）すると柔らかく降りられます。',
      };
    case 'wingsuit':
      return {
        tilt: '左右で旋回。手前に引くと減速して滑空比が良くなり、奥へ倒すと速くなる代わりに沈みが増えます。',
        buttons: '左のボタンでパラシュートを開きます。開かずに地面に着くと墜落です。',
        tip: 'キャノピーでは左右で旋回、地面すれすれで手前に引いてフレア。風に向かって着地しましょう。',
      };
    case 'skydive':
      return {
        tilt: '自由落下中: 左右で向きを変え、奥へ倒すとトラッキング（水平に移動）。手前でブレーキ。',
        buttons: '左のボタンでパラシュートを開きます（低すぎると自動展開装置が作動）。',
        tip: 'キャノピーでは左右で旋回、地面すれすれで手前に引いてフレア。目標の同心円に近いほど高得点。',
      };
    default:
      return {
        tilt: '左右に傾けると旋回、上端を手前に引くと機首上げ、奥へ倒すと機首下げ。',
        buttons: '右手のスライダーで出力を調整。左のボタンで機体固有の操作（ラダー、フラップ、ギアなど）。',
        tip: def.id === 'fighter' ? 'A/B を押すとアフターバーナー（推力最大）。強く引き続けると G で視界が暗くなります。'
          : def.id === 'airliner' ? '機体の保護機能が付いています。着陸はフラップ FULL・ギア DOWN で、ゆっくり降下。'
            : '約 90 km/h で手前に引くと離陸。傾けたままにするとその角度で旋回し、戻すと水平に戻ります。',
      };
  }
}

export class Screens {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.el = {};
    this.state = { vehicle: 'prop', location: 'island', time: 'noon', weather: 'clear', mode: 'free' };
    this.current = null;
    this.build();
  }

  build() {
    const r = this.root;
    // タイトル
    this.el.title = h('div', { class: 'screen bg-sky col center', id: 'scr-title' },
      h('h1', { class: 'title-logo' }, 'SKY', h('span', {}, 'TILT')),
      h('p', { class: 'subtitle' }, 'スマホを傾けて大空を飛ぼう'),
      tapButton('タップしてスタート', () => this.cb.onStart(), 'btn primary big', { id: 'btn-start' }),
      h('div', { class: 'row', style: { marginTop: '14px' } },
        tapButton('設定', () => this.cb.onOpenSettings('title'), 'btn small', { id: 'btn-title-settings' })),
      h('div', { class: 'hint' }, '横向きで遊んでください ／ PC: WASD・矢印キー＝姿勢　Shift/Ctrl＝スロットル　Q/E＝ヨー'),
    );

    // 機体選択
    const vcards = h('div', { class: 'cards', id: 'vehicle-cards' });
    this.vcardEls = {};
    for (const id of VEHICLE_ORDER) {
      const v = VEHICLES[id];
      const card = h('button', { class: 'card', type: 'button', 'data-vehicle': id },
        h('div', { html: ICONS[id] }),
        h('div', { class: 'name' }, v.short),
        h('div', { class: 'desc' }, v.desc),
        bars('速度', v.stats.speed), bars('機動性', v.stats.agility), bars('難易度', v.stats.difficulty, 'diff'));
      card.addEventListener('click', () => this.selectVehicle(id));
      card.addEventListener('dblclick', () => { this.selectVehicle(id); this.show('location'); });
      this.vcardEls[id] = card;
      vcards.append(card);
    }
    this.el.vehicle = h('div', { class: 'screen bg-sky col', id: 'scr-vehicle' },
      h('div', { class: 'screen-head' },
        tapButton('← 戻る', () => this.show('title'), 'btn small'),
        h('h2', {}, '機体を選ぶ'),
        tapButton('次へ →', () => this.show('location'), 'btn primary', { id: 'btn-vehicle-next' })),
      h('div', { class: 'screen-body col', style: { justifyContent: 'center' } }, vcards, h('div', { class: 'swipe-hint' }, '← 横にスワイプで全 8 機体 →')),
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
    const opts = h('div', { class: 'opts' },
      h('div', { class: 'k' }, '時間帯'), segmented(TIMES, TIME_ORDER, s.time, (id) => { s.time = id; this.updateNote(); }, 'name', 'time-'),
      h('div', { class: 'k' }, '天候'), segmented(WEATHERS, WEATHER_ORDER, s.weather, (id) => { s.weather = id; this.updateNote(); }, 'name', 'weather-'),
      h('div', { class: 'k' }, 'モード'), segmented(MODES, MODE_ORDER, s.mode, (id) => { s.mode = id; }, 'name', 'mode-'),
    );
    this.noteEl = h('div', { class: 'loc-note', id: 'loc-note', style: { display: 'none' } });
    this.el.location = h('div', { class: 'screen bg-sky col', id: 'scr-location' },
      h('div', { class: 'screen-head' },
        tapButton('← 機体', () => this.show('vehicle'), 'btn small'),
        h('h2', {}, 'ロケーション・時間帯・天候'),
        tapButton('飛行開始 ▶', () => this.cb.onFly({ ...this.state }), 'btn primary', { id: 'btn-fly' })),
      h('div', { class: 'col', style: { flex: '1', minHeight: '0', gap: '6px' } }, lcards, h('div', { class: 'row', style: { alignItems: 'flex-start', justifyContent: 'flex-start', flexWrap: 'nowrap' } }, opts, this.noteEl)),
    );

    // 一時停止
    this.el.pause = h('div', { class: 'screen dim col center', id: 'scr-pause' },
      h('div', { class: 'panel col center', style: { gap: '12px' } },
        h('h2', { style: { margin: '0' } }, '一時停止'),
        this.pauseMsg = h('div', { class: 'pause-msg', id: 'pause-msg' }),
        h('div', { class: 'menu-grid' },
          tapButton('▶ 再開', () => this.cb.onResume(), 'btn primary', { id: 'btn-resume' }),
          tapButton('⟲ 再キャリブレーション', () => this.cb.onRecalibrate(), 'btn', { id: 'btn-recal' }),
          tapButton('⚙ 設定', () => this.cb.onOpenSettings('pause'), 'btn', { id: 'btn-settings' }),
          tapButton('✈ 機体変更', () => this.cb.onChangeVehicle(), 'btn', { id: 'btn-change-vehicle' }),
          tapButton('↺ リスタート', () => this.cb.onRestart(), 'btn', { id: 'btn-restart' }),
          tapButton('⌂ タイトルへ', () => this.cb.onTitle(), 'btn', { id: 'btn-title' }),
        )));

    // 設定
    this.el.settings = h('div', { class: 'screen dim col center', id: 'scr-settings' });
    // 操作説明
    this.el.tutorial = h('div', { class: 'screen dim col center', id: 'scr-tutorial' });
    // 墜落
    this.el.crash = h('div', { class: 'screen dim col center', id: 'scr-crash' });
    // 結果
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

  selectVehicle(id) {
    this.state.vehicle = id;
    for (const [k, el] of Object.entries(this.vcardEls)) el.classList.toggle('sel', k === id);
    this.updateNote();
  }

  /** 選択の組み合わせに応じた注意書き */
  updateNote() {
    if (!this.noteEl) return;
    const s = this.state;
    let msg = '';
    if (s.weather === 'windy' && s.vehicle === 'paraglider') msg = '⚠ 強風（13 m/s）はパラグライダーの速度（約 10 m/s）より速く、前に進めず押し戻されます';
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
    const ctlNames = { auto: '自動', tilt: '傾き', stick: 'スティック' };
    rows.push(h('div', { class: 'srow' }, h('label', {}, '操作方式'),
      segmented({ auto: { name: ctlNames.auto }, tilt: { name: ctlNames.tilt }, stick: { name: ctlNames.stick } }, ['auto', 'tilt', 'stick'], settings.control, (id) => { settings.control = id; onChange(settings); }, 'name', 'control-'), h('span')));
    slider('sensitivity', '感度', 0.4, 2.5, 0.05, (v) => `${v.toFixed(2)}×`);
    slider('deadzone', 'デッドゾーン', 0, 8, 0.5, (v) => `${v.toFixed(1)}°`);
    slider('smoothing', 'スムージング', 0, 0.3, 0.01, (v) => `${Math.round(v * 1000)}ms`);
    slider('expo', 'エクスポ', 0, 0.9, 0.05, (v) => v.toFixed(2));
    toggle('invertPitch', 'ピッチ反転');
    slider('volume', '音量', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    toggle('vibrate', '振動');
    toggle('cameraShake', 'カメラの揺れ');
    el.append(h('div', { class: 'panel settings col', style: { gap: '4px' } },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', { style: { margin: '0' } }, '設定'), tapButton('閉じる', onClose, 'btn primary small', { id: 'btn-settings-close' })),
      h('div', { class: 'settings-grid' }, ...rows),
      h('div', { class: 'hint', style: { textAlign: 'left', marginTop: '4px' } }, '傾き操作: 開始時の持ち方が「ニュートラル」。持ち方を変えたら ⟲ で再キャリブレーション。'),
    ));
    this.show('settings');
  }

  // ---------- 操作説明（3 枚） ----------
  showTutorial(def, onDone) {
    const el = this.el.tutorial;
    const T = tutorialText(def);
    const pages = [
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
        p: [T.buttons, T.tip, '左上の ❚❚ で一時停止・設定・機体変更。'],
      },
    ];
    let i = 0;
    const render = () => {
      el.innerHTML = '';
      const pg = pages[i];
      const dots = h('div', { class: 'dots' }, pages.map((_, k) => h('div', { class: `dot${k === i ? ' on' : ''}` })));
      el.append(h('div', { class: 'panel tut col center' },
        h('h3', {}, pg.t),
        h('div', { html: pg.svg }),
        ...pg.p.map((t) => h('p', {}, t)),
        dots,
        h('div', { class: 'row' },
          tapButton('スキップ', () => onDone(), 'btn small', { id: 'btn-tut-skip' }),
          tapButton(i < pages.length - 1 ? '次へ →' : '飛ぶ！', () => { if (i < pages.length - 1) { i++; render(); } else onDone(); }, 'btn primary', { id: 'btn-tut-next' }))));
    };
    render();
    this.show('tutorial');
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

  // ---------- 結果（着陸評価 / リングコース） ----------
  showResult(res, def, cb) {
    const el = this.el.result;
    el.innerHTML = '';
    let body;
    if (res.type === 'landing') {
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
    } else {
      body = h('div', { class: 'col center', style: { gap: '6px' } },
        h('div', { style: { fontSize: '44px', fontWeight: '900' }, id: 'result-time' }, fmtTime(res.total)),
        h('div', { class: 'stat-grid' },
          h('span', { class: 'k' }, '通過'), h('span', {}, `${res.passed} / ${res.passed + res.missed}`),
          h('span', { class: 'k' }, 'ペナルティ'), h('span', {}, `+${res.penalty} 秒`),
          h('span', { class: 'k' }, 'ベスト'), h('span', {}, res.best != null ? `${fmtTime(res.best)}（${res.bestPassed} 個通過）` : '—')),
        res.newBest && res.missed === 0 ? h('div', { style: { color: '#ffd84a', fontWeight: '800' } }, '全リング通過・新記録！') : null);
    }
    el.append(h('div', { class: 'panel col center', style: { gap: '12px', minWidth: '420px' } },
      h('h2', { style: { margin: '0' } }, res.type === 'landing' ? '着陸成功！' : 'ゴール！'),
      body,
      h('div', { class: 'row' },
        cb.continue ? tapButton('▶ 続ける', cb.continue, 'btn', { id: 'btn-continue' }) : null,
        tapButton('↺ もう一度', cb.retry, 'btn primary', { id: 'btn-result-retry' }),
        tapButton('✈ 機体変更', cb.vehicle, 'btn', { id: 'btn-result-vehicle' }),
        tapButton('🗺 ロケーション', cb.location, 'btn', { id: 'btn-result-location' }))));
    this.show('result');
  }
}
