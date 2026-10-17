// Логотип «IZH CAR» → public/logo.svg. Начертание — по шильдику ИЖ: тяжёлые наклонные штампы,
// узкие просветы, тонкие перемычки, изгибы там, где диагональ входит в горизонталь.
// Буквы рисуются прямыми (высота 100), наклон даёт skewX.
// Запуск: node tools/logo.mjs
import { writeFileSync } from 'fs';

const T = 24, S = 40, G = 16, M = 20; // толщина горизонталей, штамп, просвет, средняя черта
const W2 = S * 2 + G;
const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}Z`;
const glyphs = {
  I: { w: S, d: rect(0, 0, S, 100) },
  Z: { w: 88, d: `M0 0H88V${T}H80C74 ${T} 72 26 70 30L52 70C50 74 52 ${100 - T} 58 ${100 - T}H88V100H0V${100 - T}H8C14 ${100 - T} 16 74 18 70L36 30C38 26 36 ${T} 30 ${T}H0Z` },
  H: { w: W2, d: rect(0, 0, S, 100) + rect(S + G, 0, S, 100) + rect(S, 40, G, M) },
  C: { w: 80, d: rect(0, 0, S, 100) + rect(S, 0, 80 - S, T) + rect(S, 100 - T, 80 - S, T) },
  A: { w: W2, d: rect(0, 0, S, 100) + rect(S + G, 0, S, 100) + rect(S, 0, G, T) + rect(S, 48, G, M) },
  // Нога R отходит от середины изгибом и уходит вниз штампом — как нижнее плечо «И» на шильдике.
  R: { w: W2 + 8, d: rect(0, 0, S, 100) + rect(S, 0, W2 - S, T) + rect(S + G, T, S, 56 - T) + rect(S, 38, G, 18)
      + `M${S} 56H${W2}C${W2 + 8} 56 ${W2 + 8} 66 ${W2 + 8} 74V100H${W2 + 8 - S}V80C${W2 + 8 - S} 70 ${S + G} 70 ${S} 70Z` },
};
const SPACE = 30, GAP = 10, SCALE = 1.05, SLANT = -21;

let x = 0;
const paths = [];
for (const ch of 'IZH CAR') {
  if (ch === ' ') { x += SPACE; continue; }
  paths.push(`<path transform="translate(${x} 0)" d="${glyphs[ch].d}"/>`);
  x += glyphs[ch].w + GAP;
}
const w = x - GAP;
// Наклон сдвигает низ букв влево — центрируем по середине высоты.
const tx = 410 - (w / 2 - 50 * Math.tan(-SLANT * Math.PI / 180)) * SCALE;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 220">
  <path d="M130 20 Q410 0 690 20 C826 30 826 190 690 200 Q410 220 130 200 C-6 190 -6 30 130 20Z" fill="#111" stroke="#ffd23f" stroke-width="8"/>
  <g transform="translate(${tx.toFixed(1)} ${110 - 50 * SCALE}) scale(${SCALE}) skewX(${SLANT})" fill="#ffd23f">
    ${paths.join('\n    ')}
  </g>
</svg>
`;
writeFileSync(new URL('../public/logo.svg', import.meta.url), svg);
