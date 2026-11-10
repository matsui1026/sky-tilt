// 今日のチャレンジ: 日付から機体・場所・モードが決まる（端末の日付だけで動く。サーバー不要）
import { mulberry32, hashString } from '../sim/math.js';
import { modesFor } from '../sim/modes.js';
import { VEHICLES, VEHICLE_ORDER } from '../data/vehicles.js';
import { LOCATION_ORDER, TIME_ORDER, WEATHER_ORDER } from '../data/locations.js';

export function dateKey(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 点数として比べられるモードだけ（自由飛行は除く） */
const SCORED = ['race', 'drift', 'parking', 'rings', 'stunt', 'combat', 'landing'];

export function dailyChallenge(key = dateKey()) {
  const rnd = mulberry32(hashString(`skytilt-daily-${key}`));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const vehicle = pick(VEHICLE_ORDER);
  const def = VEHICLES[vehicle];
  const modes = modesFor(def).filter((m) => SCORED.includes(m));
  const mode = pick(modes);
  const location = pick(LOCATION_ORDER);
  const time = pick(TIME_ORDER);
  const weather = pick(WEATHER_ORDER);
  return { key, vehicle, mode, location, time, weather, seed: hashString(key) % 1000000 };
}

/** 結果の点数化（大きいほど良い） */
export function dailyScore(res) {
  switch (res.type) {
    case 'race': return Math.round(100000 / Math.max(res.time, 1) - (res.place - 1) * 100);
    case 'drift': return res.score;
    case 'stunt': return res.score;
    case 'parking': return res.score;
    case 'rings': return Math.round(100000 / Math.max(res.total, 1));
    case 'combat': return res.score;
    case 'landing': return res.score;
    default: return 0;
  }
}
