// Сборка public/models/pickup.glb из модели бортового пикапа ИЖ-2715 (экспорт Blender, буфер встроен в .gltf).
// Исходник (~45 тыс. треугольников, перед — в +x) раскладывается на части игры: paint, detail, lights,
// wheel (переднее правое колесо вокруг своего центра). Рама, двигатель и салон (узел transmission)
// выбрасываются: за непрозрачными стёклами и под кузовом их не видно. Перед и кабину пикапа берёт
// и «Каблучок» (kabluk.mjs) — отсюда loadPickup / pickupParts.
//
//   cd tools/models && npm install && node pickup.mjs путь/к/IZH-2715.gltf
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, pick, readGltf, simplify, used, writeGlb } from './lib.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PICKUP_SRC = `${root}/3d-models/IZH-2715.gltf`;

// Длина с бамперами; модель в своих единицах.
const LENGTH = 4.1;

// Материал → [часть, цвет, доля треугольников, которую оставить]. null — выбросить.
const ROLES = {
  car_kuzov: ['paint', '#ffffff', 0.6],
  car_glass: ['detail', '#26333f', 1],
  car_rubber: ['detail', '#151618', 0.3], // уплотнители, брызговики, коврики
  car_chrome: ['detail', '#c8ccd0', 0.5], // бамперы, ободки фар, ручки
  car_black_metall: ['detail', '#1b1c1f', 1], // решётка радиатора: упрощённая идёт зубцами
  car_black_plastic: ['detail', '#1b1c1f', 0.5], // зеркала, корпуса фонарей
  car_black: ['detail', '#1b1c1f', 1],
  car_light: ['lights', '#fff6d8', 0.6], // фары
  car_light_2: ['lights', '#fff6d8', 1], // габариты
  car_DarkOrange: ['lights', '#ffb030', 1], // поворотники
  'car_red emission': ['lights', '#ff2a1a', 1], // задние фонари
  car_red: ['lights', '#8a1410', 1], // отражатели
  car_white: null, // обивка потолка
};
// Узлы целиком вон; в кузове — салонные мелочи (зеркало, плафон, аккумулятор под капотом).
const DROP_NODES = new Set(['transmission']);
const DROP = { body: new Set(['car_black_plastic', 'car_light_2', 'car_white']) };
// Колесо: шина, обод, колпак.
const WHEEL = { car_rubber: ['#151618', 1], car_disk_metall: ['#aeb2b6', 0.4], car_gray: ['#4a4d52', 1] };
const isWheel = (p) => p.node === 'wheels';

// Исходник в координатах игры: { prims, wheels (центры четырёх колёс), R, ref (переднее правое), length }.
export function loadPickup(src = PICKUP_SRC) {
  const prims = readGltf(src).filter((p) => !DROP_NODES.has(p.node) && !DROP[p.node]?.has(p.mat));
  const all = bbox(prims);
  const S = LENGTH / all.size[0];
  // Перед исходника — +x: поворот вокруг вертикали (x → z, z → −x), низ колёс — на земле.
  for (const p of prims) {
    for (let i = 0; i < p.pos.length; i += 3) {
      const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2];
      p.pos[i] = -(z - all.mid[2]) * S;
      p.pos[i + 1] = (y - all.lo[1]) * S;
      p.pos[i + 2] = (x - all.mid[0]) * S;
    }
  }
  // Центры колёс — по габаритам шины в каждой четверти; радиус — высота оси (колесо стоит на земле).
  const tires = prims.filter((p) => isWheel(p) && p.mat === 'car_rubber');
  const wheels = [];
  for (const sz of [1, -1]) for (const sx of [1, -1]) {
    const b = bbox(tires.map((p) => used(pick(p, ([x, , z]) => sx * x > 0 && sz * z > 0))));
    wheels.push({ x: b.mid[0], y: b.mid[1], z: b.mid[2] });
  }
  const R = wheels.reduce((s, w) => s + w.y, 0) / 4;
  return { prims, wheels, R, ref: wheels[0], length: all.size[0] * S };
}

// Части игры. trim(примитив) → { pos, idx } — что оставить от кузова (колёса — всегда целиком).
export function pickupParts({ prims, R, ref }, { trim = (p) => p, parts = { paint: [], detail: [], lights: [], wheel: [] }, stat = {} } = {}) {
  const add = (part, color, list, k, name) => {
    if (!list.some((p) => p.idx.length)) return;
    const g = simplify(list, k);
    parts[part].push({ ...g, color: hex(color) });
    stat[name] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
  };
  for (const [mat, role] of Object.entries(ROLES)) {
    if (role) add(role[0], role[1], prims.filter((p) => !isWheel(p) && p.mat === mat).map(trim), role[2], mat);
  }
  for (const [mat, [color, k]] of Object.entries(WHEEL)) {
    const list = prims.filter((p) => isWheel(p) && p.mat === mat).map((p) => {
      const { idx } = pick(p, ([x, , z]) => x * ref.x > 0 && z * ref.z > 0);
      return { pos: Float32Array.from(p.pos, (v, i) => v - [ref.x, R, ref.z][i % 3]), idx };
    });
    add('wheel', color, list, k, 'колесо ' + mat);
  }
  // За решёткой в исходнике радиатор (узел transmission выброшен) — без него в щелях виден кузов.
  // Тёмная пластина по габаритам решётки, чуть позади самых задних её граней.
  const front = prims.filter((p) => p.mat === 'car_black_metall').map((p) => pick(p, ([x, y, z]) => z > 1.8 && Math.abs(x) < 0.45 && y > 0.4));
  const g = bbox(front.map(used));
  const z = g.lo[2] - 0.01, [x0, y0] = g.lo, [x1, y1] = g.hi;
  parts.detail.push({ pos: new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]), idx: new Uint32Array([0, 1, 2, 0, 2, 3]), color: hex('#0e0f10') });
  stat['пластина за решёткой'] = `${(x1 - x0).toFixed(2)} × ${(y1 - y0).toFixed(2)} м`;
  return { parts, stat };
}

// Размеры колёс для extras сцены.
export function wheelSpec({ wheels, R }) {
  const fr = wheels.filter((w) => w.z > 0), rr = wheels.filter((w) => w.z < 0);
  const avg = (l, f) => +(l.reduce((s, w) => s + f(w), 0) / l.length).toFixed(3);
  return { r: +R.toFixed(3), front: avg(fr, (w) => w.z), rear: avg(rr, (w) => w.z), track: avg(wheels, (w) => Math.abs(w.x)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const model = loadPickup(resolve(process.argv[2] || PICKUP_SRC));
  const { parts, stat } = pickupParts(model);
  console.table(stat);
  const wheels = wheelSpec(model);
  const body = bbox(model.prims.filter((p) => p.mat === 'car_kuzov'));
  console.log('колёса', wheels, '| длина', model.length.toFixed(2), 'ширина кузова', body.size[0].toFixed(2), 'высота', body.hi[1].toFixed(2));
  // hub: диск — в самой модели колеса (игра не дорисовывает свой).
  writeGlb(`${root}/public/models/pickup.glb`, parts, { copyright: 'ИЖ-2715 (пикап) — модель Blender (источник уточняется)', extras: { wheels, length: +model.length.toFixed(3), width: +body.size[0].toFixed(3), hub: true } });
}
