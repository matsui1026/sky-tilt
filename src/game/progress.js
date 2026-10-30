// 実績と記録（純粋ロジック。保存は呼び出し側が渡す store で行う）
export const ACHIEVEMENTS = [
  { id: 'first_flight', name: '初飛行', desc: '飛行機で離陸する', test: (s) => s.takeoffs >= 1 },
  { id: 'first_landing', name: '無事に着陸', desc: '着陸に成功する', test: (s) => s.landings >= 1 },
  { id: 's_landing', name: 'バターランディング', desc: '着陸で S 評価', test: (s) => s.landingS >= 1 },
  { id: 'rings_50', name: 'リングマスター', desc: 'リングを合計 50 個くぐる', test: (s) => s.rings >= 50 },
  { id: 'ace', name: 'エース', desc: '敵機を合計 10 機撃墜', test: (s) => s.kills >= 10 },
  { id: 'balloons_100', name: '風船割り', desc: '風船を合計 100 個割る', test: (s) => s.balloons >= 100 },
  { id: 'km_100', name: '長距離移動', desc: '合計 100 km 移動する', test: (s) => s.distanceKm >= 100 },
  { id: 'night', name: '夜間飛行', desc: '夜に 5 分飛ぶ', test: (s) => s.nightMinutes >= 5 },
  { id: 'storm', name: '悪天候でも', desc: '雨・雪・霧の中で 5 分操縦する', test: (s) => s.badWeatherMinutes >= 5 },
  { id: 'all_vehicles', name: 'コレクター', desc: '全機体に乗る', test: (s, ctx) => (s.vehicles || []).length >= ctx.vehicleCount },
  { id: 'all_locations', name: '世界旅行', desc: '全ロケーションを訪れる', test: (s, ctx) => (s.locations || []).length >= ctx.locationCount },
  { id: 'drift_1k', name: '初ドリフト', desc: '1 回のドリフトで 1,000 点', test: (s) => s.driftBest >= 1000 },
  { id: 'drift_5k', name: 'ドリフトキング', desc: '1 回のドリフトで 5,000 点', test: (s) => s.driftBest >= 5000 },
  { id: 'drift_total', name: 'タイヤスモーカー', desc: 'ドリフトの点を合計 50,000 点', test: (s) => s.driftTotal >= 50000 },
  { id: 'race_win', name: '優勝', desc: 'レースで 1 位', test: (s) => s.raceWins >= 1 },
  { id: 'race_hard', name: '本気のライバルに勝つ', desc: '難易度「むずかしい」のレースで 1 位', test: (s) => s.raceWinsHard >= 1 },
  { id: 'cones', name: 'コーンクラッシャー', desc: 'コーンを合計 30 個はね飛ばす', test: (s) => s.cones >= 30 },
  { id: 'jump', name: '大ジャンプ', desc: '車で 2.5 秒以上空中にいる', test: (s) => s.bestAir >= 2.5 },
  { id: 'park_s', name: '駐車の達人', desc: '駐車チャレンジで S 評価', test: (s) => s.parkS >= 1 },
  { id: 'sea', name: '海を渡る', desc: 'ホバーカーで水の上を 2 km 走る', test: (s) => s.waterKm >= 2 },
  { id: 'daily_3', name: '毎日パイロット', desc: '今日のチャレンジを 3 日クリア', test: (s) => (s.dailyDays || []).length >= 3 },
  { id: 'student', name: '卒業', desc: '練習モードをすべて終える', test: (s, ctx) => (s.lessons || []).length >= ctx.lessonCount },
];

const EMPTY = {
  takeoffs: 0, landings: 0, landingS: 0, rings: 0, kills: 0, balloons: 0, distanceKm: 0, nightMinutes: 0, badWeatherMinutes: 0,
  flightMinutes: 0, driveMinutes: 0, driftBest: 0, driftTotal: 0, raceWins: 0, raceWinsHard: 0, races: 0, cones: 0, bestAir: 0, parkS: 0, waterKm: 0,
  crashes: 0, vehicles: [], locations: [], dailyDays: [], lessons: [],
};

export class Progress {
  /** store: { get(key, def), set(key, value) }、ctx: { vehicleCount, locationCount, lessonCount } */
  constructor(store, key, ctx) {
    this.store = store;
    this.key = key;
    this.ctx = ctx;
    const saved = store.get(key, null) || {};
    this.stats = { ...EMPTY, ...(saved.stats || {}) };
    this.unlocked = { ...(saved.unlocked || {}) };
    this._dirty = false;
    this._saveT = 0;
    this.pending = [];
  }
  save() {
    this.store.set(this.key, { stats: this.stats, unlocked: this.unlocked });
    this._dirty = false;
  }
  add(k, v = 1) { this.stats[k] = (this.stats[k] || 0) + v; this._dirty = true; this.check(); }
  max(k, v) { if (v > (this.stats[k] || 0)) { this.stats[k] = v; this._dirty = true; this.check(); } }
  addUnique(k, v) {
    const a = this.stats[k] || (this.stats[k] = []);
    if (!a.includes(v)) { a.push(v); this._dirty = true; this.check(); }
  }
  /** 新しく解除された実績を見て pending へ */
  check() {
    for (const a of ACHIEVEMENTS) {
      if (!this.unlocked[a.id] && a.test(this.stats, this.ctx)) {
        this.unlocked[a.id] = true;
        this.pending.push(a);
        this._dirty = true;
      }
    }
  }
  /** 解除の通知を取り出す */
  drain() {
    const p = this.pending;
    this.pending = [];
    return p;
  }
  /** 毎フレーム: 時間と距離（dt は実際に進んだシミュレーション時間） */
  tick(st, def, weather, timeId, dt) {
    const km = (st.groundSpeed * dt) / 1000;
    this.stats.distanceKm += km;
    if (def.category === 'car' && st.onGround) {
      this.stats.driveMinutes += dt / 60;
      if (st.car && st.car.surface === 'water') this.stats.waterKm += km;
    } else this.stats.flightMinutes += dt / 60;
    if (timeId === 'night') this.stats.nightMinutes += dt / 60;
    if (weather === 'rain' || weather === 'snowfall' || weather === 'fog') this.stats.badWeatherMinutes += dt / 60;
    this._dirty = true;
    this._saveT += dt;
    if (this._saveT > 5) {
      this._saveT = 0;
      this.check();
      this.save();
    }
  }
  flush() { if (this._dirty) { this.check(); this.save(); } }
  count() { return Object.keys(this.unlocked).length; }
}
