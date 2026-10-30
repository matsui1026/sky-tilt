// 機体カード用のシルエット（SVG、オリジナルの簡易形状）
const S = (body) => `<svg viewBox="0 0 160 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none" stroke="#dfe9f5" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;

export const ICONS = {
  prop: S('<path d="M30 32 L118 30 Q128 31 130 34 Q128 37 118 37 L30 36 Z"/><path d="M62 31 L66 12 L80 12 L78 31"/><path d="M62 36 L66 52 L80 52 L78 36"/><path d="M34 33 L26 20 L32 20 L42 32"/><line x1="131" y1="22" x2="131" y2="46"/>'),
  airliner: S('<path d="M14 32 Q20 26 40 27 L130 27 Q146 28 148 32 Q146 36 130 37 L40 37 Q20 37 14 32 Z"/><path d="M70 28 L52 8 L62 8 L92 28"/><path d="M70 36 L52 56 L62 56 L92 36"/><path d="M28 28 L20 12 L28 12 L42 28"/><ellipse cx="66" cy="44" rx="8" ry="3"/>'),
  fighter: S('<path d="M10 32 L60 28 L120 26 L150 32 L120 38 L60 36 Z"/><path d="M60 28 L96 6 L104 10 L92 30"/><path d="M60 36 L96 58 L104 54 L92 34"/><path d="M24 30 L18 16 L26 16 L36 29"/><path d="M118 28 Q126 26 134 31"/>'),
  sailplane: S('<path d="M40 32 L120 30 Q130 31 132 33 Q130 35 120 35 L40 34 Z"/><path d="M8 30 L152 28 L152 31 L8 33 Z"/><path d="M42 32 L34 18 L40 18 L50 31"/><path d="M110 30 Q118 26 124 31"/>'),
  drone: S('<rect x="66" y="24" width="28" height="12" rx="3"/><line x1="70" y1="28" x2="40" y2="16"/><line x1="90" y1="28" x2="120" y2="16"/><line x1="70" y1="32" x2="40" y2="44"/><line x1="90" y1="32" x2="120" y2="44"/><ellipse cx="40" cy="14" rx="16" ry="3"/><ellipse cx="120" cy="14" rx="16" ry="3"/><ellipse cx="40" cy="46" rx="16" ry="3"/><ellipse cx="120" cy="46" rx="16" ry="3"/>'),
  flycar: S('<path d="M20 38 L28 28 Q44 20 70 20 L96 20 Q118 22 132 30 L142 34 L142 40 L20 40 Z"/><circle cx="44" cy="42" r="7"/><circle cx="118" cy="42" r="7"/><path d="M60 22 Q78 14 98 22"/><ellipse cx="30" cy="16" rx="14" ry="3" stroke="#6fd8ff"/><ellipse cx="132" cy="16" rx="14" ry="3" stroke="#6fd8ff"/>'),
  driftcar: S('<path d="M16 40 L22 30 Q40 28 56 20 L92 18 Q112 20 124 28 L146 32 L146 40 Z"/><circle cx="46" cy="42" r="8"/><circle cx="120" cy="42" r="8"/><path d="M14 26 L34 26 L34 30"/><path d="M8 52 Q24 50 38 52 M94 54 Q110 52 128 54" stroke="#9fb0c4" stroke-dasharray="3 4"/>'),
  rally: S('<path d="M20 40 L22 26 L46 24 L60 12 L98 12 L112 26 L140 28 L142 40 Z"/><circle cx="46" cy="42" r="9"/><circle cx="116" cy="42" r="9"/><path d="M64 14 L64 26 M94 14 L104 26"/><path d="M16 22 L38 22"/><path d="M8 52 Q20 46 30 54 M130 54 Q142 48 152 54" stroke="#c9a074"/>'),
  hypercar: S('<path d="M10 40 L14 32 L52 26 Q76 14 100 22 L128 30 L150 38 L150 40 Z"/><circle cx="44" cy="42" r="7"/><circle cx="122" cy="42" r="7"/><path d="M10 20 L30 20 L30 28"/><path d="M64 24 Q80 18 98 24"/>'),
  monster: S('<circle cx="46" cy="42" r="15"/><circle cx="116" cy="42" r="15"/><circle cx="46" cy="42" r="6"/><circle cx="116" cy="42" r="6"/><path d="M24 30 L28 18 L66 18 L74 6 L102 6 L112 18 L138 20 L140 30 Z"/><path d="M78 8 L78 18 M100 8 L106 18"/>'),
  kart: S('<circle cx="38" cy="46" r="7"/><circle cx="122" cy="46" r="7"/><path d="M24 42 L136 42 L146 46"/><path d="M64 42 L72 30 L82 42"/><circle cx="78" cy="20" r="7"/><path d="M78 27 L80 38 L100 38"/><path d="M60 36 L44 30"/>'),
  hover: S('<path d="M14 34 Q22 22 60 20 L104 20 Q134 22 148 34 L140 40 L22 40 Z"/><path d="M60 22 Q80 8 104 22"/><path d="M28 46 Q40 42 52 46 Q64 50 76 46 Q88 42 100 46 Q112 50 130 46" stroke="#6fd8ff"/>'),
  balloon: S('<path d="M80 4 C56 4 50 24 60 36 L72 46 L88 46 L100 36 C110 24 104 4 80 4 Z"/><path d="M70 6 Q72 28 74 46 M90 6 Q88 28 86 46"/><line x1="73" y1="46" x2="75" y2="52"/><line x1="87" y1="46" x2="85" y2="52"/><rect x="74" y="52" width="12" height="7" rx="1"/>'),
  heli: S('<path d="M60 30 Q62 18 90 18 Q112 20 112 32 Q110 42 88 42 L66 42 Q58 40 60 30 Z"/><path d="M60 32 L18 30 L14 22 L10 22 L12 34 L60 36"/><line x1="30" y1="12" x2="150" y2="12"/><line x1="88" y1="12" x2="88" y2="18"/><path d="M66 48 L114 48"/><line x1="74" y1="42" x2="72" y2="48"/><line x1="104" y1="42" x2="106" y2="48"/>'),
  paraglider: S('<path d="M30 20 Q80 -2 130 20 L126 26 Q80 6 34 26 Z"/><line x1="36" y1="25" x2="80" y2="50"/><line x1="124" y1="25" x2="80" y2="50"/><line x1="80" y1="12" x2="80" y2="50"/><circle cx="80" cy="52" r="4"/>'),
  jetsuit: S('<circle cx="80" cy="12" r="5"/><path d="M80 17 L80 38"/><path d="M80 22 L60 30 L56 40"/><path d="M80 22 L100 30 L104 40"/><path d="M80 38 L72 54 M80 38 L88 54"/><path d="M56 42 L54 56 M104 42 L106 56" stroke="#7fb6ff"/>'),
  wingsuit: S('<circle cx="40" cy="30" r="5"/><path d="M45 30 L110 30"/><path d="M50 30 L76 8 L112 28 L76 52 Z"/><path d="M110 30 L140 24 M110 30 L140 36"/>'),
  skydive: S('<circle cx="80" cy="16" r="5"/><path d="M80 21 L80 38"/><path d="M80 26 L56 16 M80 26 L104 16"/><path d="M80 38 L62 52 M80 38 L98 52"/><path d="M40 52 Q80 40 120 52" stroke-dasharray="4 4"/>'),
};

export const LOC_THUMBS = {
  island: 'linear-gradient(180deg,#5aa0e8 0%,#a8d4f0 45%,#1f6fa8 46%,#2f8fc8 70%,#6fae4f 71%,#e8d9a8 100%)',
  mountains: 'linear-gradient(180deg,#5a8fd6 0%,#bcd7f0 40%,#7c7466 41%,#d8d8d8 52%,#3f6e33 75%,#5c8f45 100%)',
  city: 'linear-gradient(180deg,#5a8fd6 0%,#c8d8e8 45%,#7a8a9a 46%,#9aa4ae 60%,#5f6f80 80%,#7f9a62 100%)',
  desert: 'linear-gradient(180deg,#f0a060 0%,#f8d0a0 40%,#a65a35 41%,#c27c48 65%,#d8a66a 85%,#e6c690 100%)',
  snow: 'linear-gradient(180deg,#7aa8e0 0%,#dfeefa 40%,#8f969e 42%,#f8fbff 55%,#c9d3de 80%,#dfe6ee 100%)',
  raceway: 'linear-gradient(180deg,#5a8fd6 0%,#bcd7f0 40%,#6f7f58 41%,#5a9244 62%,#3c3f44 63%,#3c3f44 76%,#e8e8e8 77%,#d03030 79%,#6fa84f 80%,#5a9244 100%)',
};
