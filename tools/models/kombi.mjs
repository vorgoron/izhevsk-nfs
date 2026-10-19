// Сборка public/models/kombi.glb — ИЖ-2125 «Комби» из модели Москвича-412 (moskvich.mjs): у «Комби» тот же
// кузов ниже окон, нос, двери и колёса, а позади задних дверей — крыша до самой кормы и покатая пятая дверь.
// Верх седана за задними дверями (заднее стекло, стойки, крышка багажника) срезается, вместо него
// строится оболочка: сечение салона Москвича у задних дверей протягивается назад и по высоте поджимается
// под профиль «Комби». Стёкла на оболочке — по сечению (боковое стекло задней двери продолжается до её
// конца, дальше стойка и стекло боковины) и по длине (стекло пятой двери — средняя часть крыши на спуске).
// Профиль снят с фотограмметрии «Izh-2715 Kombi» (trolleway, Sketchfab, CC BY 4.0) — это настоящий 2125.
//
//   cd tools/models && npm install && node kombi.mjs [3d-models/car__moskvich_412i_e/scene.gltf]
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { bbox, clip, hex, pick, simplify, writeGlb } from './lib.mjs';
import { MOSKVICH_CREDIT, MOSKVICH_SRC, loadMoskvich, moskvichParts, root, wheelSpec } from './moskvich.mjs';

// Шов: плоскость поперёк машины сразу за средней стойкой. Дальше −0,45 у седана верх окна и крыша уже опускаются
// к задней стойке — сечение оттуда, протянутое назад ровным, даёт излом в шве.
const Z_CUT = -0.36;
// Низ оболочки (подоконная линия): у дверей — по низу стёкол, к корме опускается на крышку багажника.
const BASE = [[Z_CUT, 0.955], [-1.3, 0.955], [-1.9, 0.915], [-2.0, 0.89]];
// Верх «Комби» (z → y) — разница с высотой крыши седана в шве (H0), по скану и фото: крыша почти ровная до −1,3
// (над задним краем заднего колеса), перелом, крутое стекло пятой двери, под ним панель положе — до кормы.
const ROOF = [[Z_CUT, 0], [-1.0, -0.005], [-1.3, -0.035], [-1.36, -0.07], [-1.72, -0.33], [-1.95, -0.45], [-1.98, -0.47],
  [-2.0, null]]; // null — конец: оболочка сходится на нет у задней панели
// Окна по длине: стекло задней двери — до Z_DOOR, стойка, стекло боковины — от Z_PILLAR; задний край стекла
// боковины скошен вдоль пятой двери: вверху — Z_QUARTER[0], у подоконной линии — Z_QUARTER[1]. Стекло пятой
// двери — средняя часть крыши от Z_HATCH[0] до Z_HATCH[1].
// По фото: стекло задней двери кончается над передним краем задней арки, стойка тонкая, стекло боковины — над аркой.
const Z_DOOR = -0.75, Z_PILLAR = -0.8, Z_QUARTER = [-1.28, -1.5], Z_HATCH = [-1.34, -1.8], HATCH_X = 0.9;
// Скос — сдвиг вершин борта назад по длине: от Z_PILLAR до Z_SHEAR, сильнее у подоконной линии.
const Z_SHEAR = -1.85;
// Фонари «Комби» — крупные, по углам кормы, верх оранжевый, низ красный (у седана — узкие и «плавники»).
const TAIL = { x: [0.37, 0.67], y: [0.61, 0.71, 0.8], z: -2.04, depth: 0.015, colors: ['#ff2a1a', '#ff8a1e'] };
const PLATE_UP = 0.1; // задний номер — между фонарями, выше, чем у седана
// Ширина оболочки относительно сечения в шве: борт седана у подоконной линии почти не сужается до кормы.
const WIDTH = [[Z_CUT, 1], [-1.6, 1], [-1.9, 0.98], [-2.0, 0.95]];
const SKIRT = 0.035; // юбка ниже подоконной линии внутрь кузова — закрывает щели над крыльями
const STEP = 0.04, SPACING = 0.045; // шаг оболочки по длине и по контуру сечения
const SHELL_KEEP = 0.45; // доля треугольников оболочки после упрощения (крыша почти плоская)
const COLORS = { paint: '#ffffff', glass: '#26333f', chrome: '#c8ccd0' };

const lerp = (table, z) => {
  for (let i = 1; i < table.length; i++) {
    const [z0, a] = table[i - 1], [z1, b] = table[i];
    if (z >= z1) return a + ((b - a) * (z - z0)) / (z1 - z0);
  }
  return table[table.length - 1][1];
};
const base = (z) => (z >= Z_CUT ? BASE[0][1] : lerp(BASE, z));

const model = loadMoskvich(resolve(process.argv[2] || MOSKVICH_SRC));
const body = (mat) => model.prims.filter((p) => p.mat === mat);

// ---------------------------------------------------------------- сечение салона в шве

// Отрезки пересечения плоскости z = Z_CUT с треугольниками кузова, стёкол и хрома.
const y0 = base(Z_CUT);
const segs = [];
for (const mat of ['Carpaint', 'Glass', 'Chrome']) for (const p of body(mat)) {
  for (let t = 0; t < p.idx.length; t += 3) {
    const v = [0, 1, 2].map((j) => [0, 1, 2].map((k) => p.pos[p.idx[t + j] * 3 + k]));
    const cut = [];
    for (let j = 0; j < 3; j++) {
      const a = v[j], b = v[(j + 1) % 3];
      if ((a[2] - Z_CUT) * (b[2] - Z_CUT) >= 0) continue;
      const u = (Z_CUT - a[2]) / (b[2] - a[2]);
      cut.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    if (cut.length === 2) segs.push({ a: cut[0], b: cut[1], mat });
  }
}
// Внешний контур правой половины. Борт — горизонтальными лучами снаружи (самое дальнее пересечение на высоте y):
// так в контур попадает утопленная рамка окна под кромкой водостока; крыша — вертикальными сверху (самое
// высокое на ширине x). Лучи из одного центра водосток рамку заслоняет, и оболочка выходит толще седана в шве.
const cross = (axis, v) => {
  let best = null;
  for (const { a, b, mat } of segs) {
    if ((a[axis] - v) * (b[axis] - v) > 0 || a[axis] === b[axis]) continue;
    const u = (v - a[axis]) / (b[axis] - a[axis]), w = a[1 - axis] + (b[1 - axis] - a[1 - axis]) * u;
    if (!best || w > best.w) best = { w, mat };
  }
  return best;
};
const SIDE_TOP = 1.36, ROOF_EDGE = 0.58; // где кончается борт и начинается крыша
const dense = [];
for (let y = y0; y <= SIDE_TOP + 1e-6; y += 0.005) {
  const h = cross(1, y);
  if (h) dense.push({ x: h.w, y, mat: h.mat });
}
for (let x = ROOF_EDGE; x >= -1e-6; x -= 0.01) {
  const h = cross(0, Math.max(0, x));
  if (h && h.w > SIDE_TOP) dense.push({ x: Math.max(0, x), y: h.w, mat: h.mat });
}
// Шаг по контуру — не мельче SPACING (на пологой крыше лучи ложатся густо); точки смены материала — все.
const half = [dense[0]];
for (let i = 1; i < dense.length; i++) {
  const h = dense[i], last = half[half.length - 1];
  if (i === dense.length - 1 || h.mat !== dense[i - 1].mat || Math.hypot(h.x - last.x, h.y - last.y) >= SPACING) half.push(h);
}
const H0 = half[half.length - 1].y;
console.log('сечение в шве:', half.length, 'точек, крыша', H0.toFixed(3), 'ширина у низа', (2 * half[0].x).toFixed(3));
console.log(half.map((h) => `${{ Carpaint: 'к', Glass: 'с', Chrome: 'х' }[h.mat]}(${h.x.toFixed(2)},${h.y.toFixed(2)})`).join(' '));
// Весь контур слева направо: [x, y, класс отрезка к следующей точке].
const cls = (m) => (m === 'Glass' ? 'glass' : m === 'Chrome' ? 'chrome' : 'paint');
const ring = [...half.map((h) => ({ x: -h.x, y: h.y, c: cls(h.mat) })), ...half.slice(0, -1).reverse().map((h) => ({ x: h.x, y: h.y, c: cls(h.mat) }))];

// ---------------------------------------------------------------- оболочка «Комби»

const zs = [];
const Z_END = ROOF[ROOF.length - 1][0];
for (let z = Z_CUT; z > Z_END + 1e-6; z -= STEP) zs.push(+z.toFixed(4));
zs.push(Z_END, Z_DOOR, Z_PILLAR, Z_QUARTER[0], ...Z_HATCH);
zs.sort((a, b) => b - a);
// Скос: высота точки сечения в полосе окна (0 — подоконная линия, 1 — верх стекла и выше) → настоящая z
// для кольца с номинальной z. Номинальная Z_QUARTER[0] уходит к Z_QUARTER[1] внизу, концы участка на месте.
const glassTop = Math.max(...half.filter((h) => h.mat === 'Glass').map((h) => h.y));
const shear = (z, y) => {
  if (z >= Z_PILLAR || z <= Z_SHEAR) return z;
  const v = Math.min(1, Math.max(0, (y - y0) / (glassTop - y0)));
  const q = Z_QUARTER[1] + (Z_QUARTER[0] - Z_QUARTER[1]) * v;
  return z >= Z_QUARTER[0] ? Z_PILLAR + ((z - Z_PILLAR) * (q - Z_PILLAR)) / (Z_QUARTER[0] - Z_PILLAR)
    : q + ((z - Z_QUARTER[0]) * (Z_SHEAR - q)) / (Z_SHEAR - Z_QUARTER[0]);
};
const top = (z) => {
  const yb = base(z);
  if (z <= Z_END) return yb;
  return Math.max(yb, H0 + (ROOF.find(([zz]) => zz === z)?.[1] ?? lerp(ROOF.slice(0, -1), z)));
};
const at = (p, zn) => {
  const z = shear(zn, p.y), yb = base(z), w = lerp(WIDTH, z);
  return [p.x * w, yb + ((p.y - y0) * (top(z) - yb)) / (H0 - y0), z];
};
const rings = [...new Set(zs)].map((z) => {
  const pts = ring.map((p) => at(p, z)), [x, , zb] = pts[0];
  return { z, pts, skirt: [x * 0.99, base(zb) - SKIRT, zb] };
});

// Класс четырёхугольника: отрезок сечения i (класс, середина по x) × участок по длине (z0 > z1).
const roofX = Math.min(...half.filter((h) => h.mat !== 'Carpaint').map((h) => h.x).filter((x) => x > 0.3));
const quadClass = (i, z0, z1) => {
  const c = ring[i].c, z = (z0 + z1) / 2, x = Math.abs((ring[i].x + ring[i + 1].x) / 2);
  if (c === 'glass') return z > Z_DOOR || (z < Z_PILLAR && z > Z_QUARTER[0]) ? 'glass' : 'paint';
  if (c === 'paint' && x < roofX * HATCH_X && z < Z_HATCH[0] && z > Z_HATCH[1]) return 'glass';
  return c;
};
const shell = { paint: [], glass: [], chrome: [] };
const quad = (list, a, b, c, d) => list.push(...a, ...b, ...c, ...a, ...c, ...d); // a→b→c→d против часовой снаружи
const mir = ([x, y, z]) => [-x, y, z];
for (let r = 0; r + 1 < rings.length; r++) {
  const A = rings[r], B = rings[r + 1];
  for (let i = 0; i + 1 < ring.length; i++) quad(shell[quadClass(i, A.z, B.z)], A.pts[i], A.pts[i + 1], B.pts[i + 1], B.pts[i]);
  // Юбки по бортам: от подоконной линии вниз, внутрь кузова.
  quad(shell.paint, A.pts[0], B.pts[0], B.skirt, A.skirt);
  quad(shell.paint, mir(A.skirt), mir(B.skirt), mir(B.pts[0]), mir(A.pts[0]));
}
const geo = (arr) => ({ pos: new Float32Array(arr), idx: Uint32Array.from({ length: arr.length / 3 }, (_, i) => i) });

// ---------------------------------------------------------------- седан без верха позади шва

// Остаётся всё ниже подоконной линии и всё впереди шва (верх, пересекающий шов, обрезается по нему).
const trim = (p) => {
  const low = pick(p, ([, y, z]) => y <= base(z) + 0.004);
  const high = clip(pick(p, ([, y, z]) => y > base(z) + 0.004), 2, Z_CUT, 1);
  const lowPos = low.pos, n = lowPos.length / 3;
  const pos = new Float32Array(lowPos.length + high.pos.length);
  pos.set(lowPos); pos.set(high.pos, lowPos.length);
  return { pos, idx: Uint32Array.from([...low.idx, ...Array.from(high.idx, (i) => i + n)]) };
};
// Фонари седана (узкие красные и оранжевые «плавники» на углах) с хромом «плавников» — вон, номер — выше, между новыми фонарями.
for (const p of model.prims) {
  if (p.mat === 'material_10') p.idx = new Uint32Array(0);
  if (p.mat === 'Lgt_2') p.idx = pick(p, ([, , z]) => z > -1.5).idx;
  if (p.mat === 'Chrome') p.idx = pick(p, ([x, y, z]) => !(z < -1.95 && Math.abs(x) > 0.6 && y > 0.58 && y < 0.95)).idx; // окантовка «плавников»
  if (p.mat === 'material_12') for (let i = 1; i < p.pos.length; i += 3) p.pos[i] += PLATE_UP;
}
const { parts, stat } = moskvichParts(model, { trim, lockBorder: true });
// Фонарь — плоский блок на задней стенке: лицевая грань и боковины до стенки.
const box = (x0, x1, y0_, y1, z, d) => {
  const f = [[x0, y0_], [x1, y0_], [x1, y1], [x0, y1]].map(([x, y]) => [x, y, z]), b = f.map(([x, y]) => [x, y, z + d]);
  const tris = [];
  const q = (a, b2, c, e) => tris.push(...a, ...b2, ...c, ...a, ...c, ...e);
  q(f[0], f[3], f[2], f[1]); // лицом назад (−z)
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; q(f[i], f[j], b[j], b[i]); }
  return tris;
};
for (const sx of [1, -1]) {
  const [xa, xb] = TAIL.x.map((x) => x * sx), [x0, x1] = sx > 0 ? [xa, xb] : [xb, xa];
  for (let k = 0; k < 2; k++) {
    parts.lights.push({ ...geo(box(x0, x1, TAIL.y[k], TAIL.y[k + 1], TAIL.z, TAIL.depth)), color: hex(TAIL.colors[k]) });
  }
}
for (const [c, list] of Object.entries(shell)) {
  if (!list.length) continue;
  const g = simplify([geo(list)], SHELL_KEEP, { lockBorder: true });
  parts[c === 'paint' ? 'paint' : 'detail'].push({ ...g, color: hex(COLORS[c]) });
  stat['оболочка ' + c] = `${list.length / 9} → ${g.idx.length / 3}`;
}
console.table(stat);

const wheels = wheelSpec(model);
const width = bbox(body('Carpaint')).size[0];
console.log('колёса', wheels, '| длина', model.length.toFixed(2), 'ширина', width.toFixed(2));
const credit = `${MOSKVICH_CREDIT}; rear body after "Izh-2715 Kombi" (https://sketchfab.com/3d-models/izh-2715-kombi-e2d950ee7b3d43949b9957a7cc49f407) by trolleway (https://sketchfab.com/trolleway), CC-BY-4.0`;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeGlb(`${root}/public/models/kombi.glb`, parts, { copyright: credit, extras: { wheels, length: +model.length.toFixed(3), width: +width.toFixed(3), hub: true } });
}
