// ロケーション定義（データ）。新しいロケーションはここに追加する。
// generator は src/sim/terrainGen.js の生成関数名。
// field: type 'runway'（舗装/未舗装の滑走路あり → 動力機は地上から離陸開始）
//        type 'field'（平坦な着陸エリアのみ → 空中から開始）
// heading: 北(-z)=0°, 東=90°（度）

export const LOCATIONS = {
  island: {
    id: 'island',
    name: '海と島',
    desc: '青い海に浮かぶ島。滑走路から離陸できる。',
    generator: 'island',
    water: true,
    field: { type: 'runway', x: 0, z: 0, heading: 0, length: 2400, width: 45, elevation: 6, surface: 'asphalt' },
    windFrom: 250,
    thermals: 9,
    clouds: 46,
    cloudBase: 900,
    airSpawn: { x: 600, z: 3600, heading: 350 },
    palette: { low: 0x6fae4f, mid: 0x4f8a3a, high: 0x8a8a7a, top: 0xb5b5ad, sand: 0xe8d9a8, water: 0x1f6fa8, cliff: 0x7d7364 },
    heightScale: 1,
  },
  mountains: {
    id: 'mountains',
    name: '山岳・渓谷',
    desc: '切り立つ尾根と深い谷。斜面上昇風が強い。',
    generator: 'mountains',
    water: false,
    field: { type: 'field', x: -300, z: 900, heading: 10, length: 1400, width: 80, surface: 'grass' },
    windFrom: 270,
    thermals: 10,
    clouds: 40,
    cloudBase: 2300,
    airSpawn: { x: 0, z: 4200, heading: 0 },
    palette: { low: 0x5c8f45, mid: 0x3f6e33, high: 0x7c7466, top: 0xd8d8d8, sand: 0x9a8f6a, water: 0x2f6f8f, cliff: 0x6b6358 },
  },
  city: {
    id: 'city',
    name: '高層ビルの都市',
    desc: '摩天楼の間をすり抜けろ。ビルに当たると墜落。',
    generator: 'city',
    water: true,
    field: { type: 'field', x: 2600, z: 1800, heading: 0, length: 1400, width: 80, surface: 'park' },
    windFrom: 200,
    thermals: 6,
    clouds: 34,
    cloudBase: 1100,
    airSpawn: { x: -3600, z: 3200, heading: 45 },
    palette: { low: 0x7f9a62, mid: 0x6f8656, high: 0x8c8c80, top: 0xa0a0a0, sand: 0xbdb59a, water: 0x2d5f80, cliff: 0x7a7a72, building: 0x9aa4ae },
  },
  desert: {
    id: 'desert',
    name: '砂漠・キャニオン',
    desc: '赤い台地と深い峡谷。未舗装の滑走路あり。',
    generator: 'desert',
    water: false,
    field: { type: 'runway', x: 1800, z: 600, heading: 20, length: 2200, width: 45, surface: 'dirt' },
    windFrom: 300,
    thermals: 12,
    clouds: 14,
    cloudBase: 2600,
    airSpawn: { x: -2500, z: 3500, heading: 20 },
    palette: { low: 0xd8a66a, mid: 0xc27c48, high: 0xa65a35, top: 0xe0b98a, sand: 0xe6c690, water: 0x3f7f8f, cliff: 0x9c4f2e },
    track: { surface: 'dirt' },
  },
  snow: {
    id: 'snow',
    name: '雪山',
    desc: '白銀の高峰。凍った湖が着陸エリア。',
    generator: 'snow',
    water: false,
    field: { type: 'field', x: 500, z: 1500, heading: 340, length: 1500, width: 90, surface: 'ice' },
    windFrom: 320,
    thermals: 5,
    clouds: 36,
    cloudBase: 3200,
    airSpawn: { x: 0, z: 4500, heading: 0 },
    palette: { low: 0xdfe6ee, mid: 0xc9d3de, high: 0x8f969e, top: 0xf8fbff, sand: 0xd0dae4, water: 0x9fc7e0, cliff: 0x6f747a },
    track: { surface: 'snow' },
  },
  raceway: {
    id: 'raceway',
    name: 'サーキット',
    desc: '丘に囲まれた専用コース。ドリフト広場とジャンプ台あり。',
    generator: 'raceway',
    water: false,
    // メインストレートは滑走路を兼ねる（飛行機でも来られる）
    field: { type: 'runway', x: 0, z: 0, heading: 0, length: 1000, width: 36, elevation: 120, surface: 'asphalt' },
    windFrom: 240,
    thermals: 6,
    clouds: 30,
    cloudBase: 1100,
    airSpawn: { x: -600, z: 2600, heading: 15 },
    palette: { low: 0x6fa84f, mid: 0x5a9244, high: 0x6f7f58, top: 0x9aa088, sand: 0xbdb59a, water: 0x2d5f80, cliff: 0x7a7a62 },
    track: {
      width: 18,
      surface: 'asphalt',
      laps: 1,
      // 進行方向の順の制御点（メインストレート → 右回りの複合コーナー → 奥の S 字 → 戻り）
      ctrl: [[0, 430], [0, 0], [0, -430], [30, -565], [125, -635], [245, -605], [310, -505], [260, -405], [150, -360], [110, -275], [165, -185], [300, -170], [445, -215], [545, -160], [575, -30], [525, 95], [405, 135], [315, 210], [345, 315], [460, 375], [505, 490], [430, 600], [275, 620], [135, 610], [40, 565], [6, 500]].map(([x, z]) => ({ x, z })),
      pads: [{ x: 215, z: 40, r: 95 }],
      ramps: [{ at: 0.38, offset: 4.5 }, { at: 0.7, offset: -4.5, height: 2.6, len: 18 }],
    },
  },
};

export const LOCATION_ORDER = ['island', 'mountains', 'city', 'desert', 'snow', 'raceway'];

export const TIMES = {
  morning: { id: 'morning', name: '朝', sunElev: 12, sunAzim: 95, thermal: 0.55 },
  noon: { id: 'noon', name: '昼', sunElev: 62, sunAzim: 170, thermal: 1.0 },
  evening: { id: 'evening', name: '夕', sunElev: 6, sunAzim: 260, thermal: 0.45 },
  night: { id: 'night', name: '夜', sunElev: -20, sunAzim: 300, thermal: 0.1 },
};
export const TIME_ORDER = ['morning', 'noon', 'evening', 'night'];

export const WEATHERS = {
  clear: { id: 'clear', name: '晴れ', wind: 3, turbulence: 0, thermal: 1.0, cloudCover: 0.35, fog: 1.0 },
  cloudy: { id: 'cloudy', name: '曇り', wind: 6, turbulence: 0.6, thermal: 0.55, cloudCover: 1.0, fog: 1.8 },
  windy: { id: 'windy', name: '強風', wind: 13, turbulence: 2.6, thermal: 0.7, cloudCover: 0.6, fog: 1.3 },
  // grip: 車のタイヤのグリップの倍率（濡れた路面・積雪）、precip: 降るものの描画
  rain: { id: 'rain', name: '雨', wind: 7, turbulence: 0.9, thermal: 0.25, cloudCover: 1.0, fog: 2.4, grip: 0.72, precip: 'rain' },
  snowfall: { id: 'snowfall', name: '雪', wind: 4, turbulence: 0.4, thermal: 0.15, cloudCover: 1.0, fog: 3.0, grip: 0.5, precip: 'snow' },
  fog: { id: 'fog', name: '霧', wind: 1.5, turbulence: 0, thermal: 0.2, cloudCover: 0.8, fog: 7.0, grip: 0.9 },
};
export const WEATHER_ORDER = ['clear', 'cloudy', 'windy', 'rain', 'snowfall', 'fog'];

export const MODES = {
  free: { id: 'free', name: 'フリー' },
  rings: { id: 'rings', name: 'リング' },
  combat: { id: 'combat', name: '射撃' },
  landing: { id: 'landing', name: '着陸' },
  race: { id: 'race', name: 'レース' },
  drift: { id: 'drift', name: 'ドリフト' },
  parking: { id: 'parking', name: '駐車' },
};
export const MODE_ORDER = ['free', 'race', 'drift', 'parking', 'rings', 'combat', 'landing'];

export function getLocation(id) {
  const l = LOCATIONS[id];
  if (!l) throw new Error(`unknown location: ${id}`);
  return l;
}
