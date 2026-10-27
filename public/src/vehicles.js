// Машины ижевского автопрома: процедурные модели по профилю сбоку (вытянутому на ширину)
// и характеристики для физики: заводские kmh — максималка, t100 — разгон до 100 км/ч, с (паспорт, ru.wikipedia,
// Веста — каталоги 2015 г.); grip — сцепление относительно базы, eco — расход бензина относительно «Оды».
// Размеры — по паспортным, силуэты упрощены.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { carGlows, glowMaterial } from './night.js';
import { paintMaterial } from './paints.js';
import { cachedURL } from './cached.js';

// ИЖ-27175 (фургон «Ода») отключён: хорошей 3D-модели нет, процедурная не годится.
// Вернуть — добавить `odavan: ODAVAN` в MODELS (по году — после «Оды»), в MIX (traffic.js) и KINDS (queues.js).
const ODAVAN = {
  name: 'ИЖ-27175 (фургон «Ода»)', years: '1997–2012',
  about: '«Каблук» нового поколения: перед от «Оды» и пластиковая будка.',
  width: 1.65, cabinWidth: 1.42,
  body: [[-2.03, 0.32], [2.03, 0.32], [2.05, 0.56], [1.96, 0.78], [0.95, 0.9], [-0.5, 0.92], [-2.03, 0.92]],
  cabin: [[0.95, 0.88], [0.18, 1.39], [-0.42, 1.4], [-0.5, 0.92]],
  windows: [[2, -2]], doors: [0.9, -0.46],
  box: { from: -0.52, to: -2.1, y0: 0.88, y1: 1.92, width: 1.68, color: '#ecebe6' },
  wheels: { r: 0.29, front: 1.26, rear: -1.21, track: 0.7 },
  bumper: '#2b2d31', bumperH: 0.24, grille: '#17181b', grilleBars: '#b9bdc2', trim: '#1a1b1d',
  lights: 'rect', lamp: { w: 0.44, h: 0.19 },
  colors: ['#e9e9e6', '#7c1622', '#2c5aa0', '#2f6b3a', '#8c9196', '#1e1f22', '#c9a227', '#1f5e6b'],
  stats: { kmh: 135, t100: 19, grip: 0.9, eco: 1.2 },
};

// Профили: [z, y] — z вперёд (перед машины при +len/2), y вверх, от земли.
// body — кузов, cabin — салон (оба под краску, cabin уже кузова и сужается к крыше).
// windows — боковые стёкла [z спереди, z сзади] внутри силуэта салона, frame — цвет рамок между
// ними (нет — стойки под краску); doors — швы дверей (z); trim — зеркала и ручки.
// Порядок — по году начала выпуска: так машины идут в гараже. price — цена в автосалоне, ₽ (shop.js); без цены —
// стартовая машина (DEFAULT_MODEL), она есть у всех.
export const MODELS = {
  m412: {
    name: 'Москвич-412 (ИЖ-412)', years: '1967–1998',
    about: 'Седан, который Ижмаш выпускал три десятилетия; ралли «Лондон — Сидней» и экспорт.',
    // Готовая модель (tools/models/moskvich.mjs); не загрузилась — рисуется процедурная по полям ниже.
    glb: 'models/moskvich.glb',
    credit: 'Модель: «Car_ Moskvich 412i E», 87-Motors (Sketchfab), CC BY 4.0',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.06, 0.32], [2.06, 0.32], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-1.1, 0.9], [-2.0, 0.88], [-2.07, 0.62]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.72, 1.46], [-1.15, 0.9]],
    windows: [[2, -0.19], [-0.31, -0.98]], doors: [0.82, -0.25, -1.05],
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', bumperH: 0.12, grille: '#c8ccd0', trim: '#c8ccd0', lights: 'rect',
    colors: ['#9fc2d6', '#e8e2c8', '#6b1420', '#3b6e4f', '#f0f0ec', '#c9a227', '#2b3a66', '#5a5f66'],
    stats: { kmh: 145, t100: 19, grip: 0.95, eco: 1.15 }, // УЗАМ-412, 75 л. с.
  },
  kabluk: {
    price: 15000,
    name: 'ИЖ-2715 «Каблучок»', years: '1972–2001',
    about: 'Пикап-фургон с высокой будкой — главная развозная машина 80-х.',
    // Готовая модель (tools/models/kabluk.mjs: перед — от пикапа, будка — от другой модели); не загрузилась —
    // рисуется процедурная по полям ниже.
    glb: 'models/kabluk.glb',
    // Номеров в модели нет: передний — на бампере, задний (квадратный) — на подсветке номера между фонарями.
    meshPlates: [{ x: 0, y: 0.46, z: 2.05, w: 0.52, h: 0.11, n: [0, 0, 1] }, { x: 0, y: 0.58, z: -2.02, w: 0.29, h: 0.17, n: [0, 0, -1] }],
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.04, 0.34], [2.06, 0.34], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-0.42, 0.9], [-2.04, 0.9]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.32, 1.44], [-0.4, 0.9]],
    windows: [[2, -2]], doors: [0.82, -0.38],
    box: { from: -0.45, to: -2.06, y0: 0.86, y1: 1.98, width: 1.6, color: 'paint' },
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', bumperH: 0.12, grille: '#c8ccd0', trim: '#c8ccd0', lights: 'rect',
    colors: ['#3b6e4f', '#e9e9e6', '#2c5aa0', '#c9a227', '#7a2f2f', '#5a6e8c', '#8c9196', '#d8641e'],
    stats: { kmh: 125, t100: 21, grip: 0.9, eco: 1.25 }, // УЗАМ-412ДЭ, 67 л. с.; 19 с в паспорте — у 75-сильного
  },
  pickup: {
    price: 18000,
    name: 'ИЖ-2715 (пикап)', years: '1972–2001',
    about: 'Бортовой пикап на базе 412-го: кабина на двоих и открытый кузов.',
    // Готовая модель (tools/models/pickup.mjs); не загрузилась — рисуется процедурная по полям ниже.
    glb: 'models/pickup.glb',
    // Номеров в модели нет: передний — на бампере, задний (квадратный) — в нише откидного борта.
    meshPlates: [{ x: 0, y: 0.46, z: 2.05, w: 0.52, h: 0.11, n: [0, 0, 1] }, { x: 0, y: 0.81, z: -2.06, w: 0.29, h: 0.17, n: [0, 0, -1] }],
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.04, 0.34], [2.06, 0.34], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-0.42, 0.9], [-2.04, 0.9]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.32, 1.44], [-0.4, 0.9]],
    windows: [[2, -2]], doors: [0.82, -0.38],
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', bumperH: 0.12, grille: '#c8ccd0', trim: '#c8ccd0', lights: 'rect',
    colors: ['#b8322a', '#e9e9e6', '#3b6e4f', '#2c5aa0', '#c9a227', '#5a6e8c', '#8c9196', '#d8641e'],
    stats: { kmh: 125, t100: 21, grip: 0.9, eco: 1.22 }, // как у «Каблучка»
  },
  kombi: {
    price: 40000,
    name: 'ИЖ-2125 «Комби»', years: '1973–1997',
    about: 'Лифтбек на базе 412-го — один из первых советских хэтчбеков.',
    // Готовая модель (tools/models/kombi.mjs: Москвич с новой крышей и пятой дверью); не загрузилась —
    // рисуется процедурная по полям ниже.
    glb: 'models/kombi.glb',
    credit: 'Модель: «Car_ Moskvich 412i E», 87-Motors (Sketchfab), CC BY 4.0; задок — по скану «Izh-2715 Kombi», trolleway (Sketchfab), CC BY 4.0',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.06, 0.32], [2.06, 0.32], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-1.95, 0.92], [-2.07, 0.62]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.95, 1.45], [-1.95, 0.94], [-1.95, 0.9]],
    windows: [[2, -0.24], [-0.36, -1.5]], doors: [0.82, -0.3, -1.2],
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', bumperH: 0.12, grille: '#c8ccd0', trim: '#c8ccd0', lights: 'rect',
    colors: ['#c64a1e', '#e8e2c8', '#2e8b8b', '#f2c230', '#6b1420', '#4a6b2f', '#e9e9e6', '#3d4a5c'],
    stats: { kmh: 142, t100: 19, grip: 0.95, eco: 1.15 }, // УЗАМ-412, 75 л. с.
  },
  oda: {
    price: 65000,
    name: 'ИЖ-2126 «Ода»', years: '1990–2005',
    about: 'Пятидверный хэтчбек — первая собственная легковая модель Ижмаша.',
    glb: 'models/oda.glb', // tools/models/oda.mjs; не загрузилась — процедурная по полям ниже
    credit: 'Модель: «izh2126_oda_rework_dcs», 87-Motors (Sketchfab), CC BY 4.0',
    // Номеров в модели нет (были в текстуре): спереди — на бампере, сзади — в нише между фонарями.
    meshPlates: [{ x: 0, y: 0.385, z: 2.045, w: 0.52, h: 0.11, n: [0, 0, 1] }, { x: 0, y: 0.6, z: -1.965, w: 0.52, h: 0.11, n: [0, 0, -1] }],
    // Детали на выбор в гараже: меши «o-слот-вариант-часть» в glb (tools/models/oda.mjs). Первый вариант — по
    // умолчанию; новые слоты и варианты — только в конец (номер варианта уходит в сеть, см. optionsCode).
    // Третье число — цена, ₽ (garage.js; купленное помнится в money.js); первый вариант бесплатный.
    options: [
      { key: 'front', name: 'Передний бампер', variants: [['stock', 'штатный'], ['paint', 'в цвет', 2500], ['tune', 'тюнинг', 7000], ['bullbar', 'кенгурятник', 5000]] },
      { key: 'rear', name: 'Задний бампер', variants: [['stock', 'штатный'], ['paint', 'в цвет', 2500]] },
      { key: 'lamps', name: 'Фары', variants: [['stock', 'штатные'], ['round', 'круглые', 4000]] },
      { key: 'spoiler', name: 'Спойлер', variants: [['none', 'нет'], ['lip', 'утиный хвост', 3500], ['wing', 'антикрыло', 9000]] },
      { key: 'kit', name: 'Обвес', variants: [['none', 'нет'], ['wide', 'широкие арки', 15000]] },
      { key: 'taxi', name: 'Шашка такси', variants: [['none', 'нет'], ['taxi', 'есть', 1500]] },
    ],
    width: 1.65, cabinWidth: 1.42,
    body: [[-2.03, 0.3], [2.03, 0.3], [2.05, 0.56], [1.96, 0.78], [0.95, 0.9], [-1.9, 0.94], [-2.05, 0.62]],
    cabin: [[0.95, 0.88], [0.18, 1.39], [-1.22, 1.4], [-1.93, 0.96], [-1.9, 0.9]],
    windows: [[2, -0.1], [-0.24, -1.08]], frame: '#1a1b1d', doors: [0.9, -0.17, -1.15],
    wheels: { r: 0.29, front: 1.26, rear: -1.21, track: 0.7 },
    bumper: '#2b2d31', bumperH: 0.24, grille: '#17181b', grilleBars: '#b9bdc2', trim: '#1a1b1d',
    lights: 'rect', lamp: { w: 0.44, h: 0.19 }, tail: { w: 0.36, h: 0.17, y: 0.76 },
    colors: ['#7c1622', '#e9e9e6', '#1f5e6b', '#2c5aa0', '#8c9196', '#2f6b3a', '#d8641e', '#1e1f22'],
    stats: { kmh: 155, t100: 15, grip: 1.0, eco: 1.0 }, // ВАЗ-2106, 1,6 л
  },
  largus: {
    price: 110000,
    name: 'LADA Largus', years: '2012 — н. в.',
    about: 'Универсал на пять или семь мест; с 2024 года его собирают в Ижевске.',
    glb: 'models/largus.glb', // tools/models/largus.mjs; не загрузилась — процедурная по полям ниже
    credit: 'Модель: «Lada Largus», usolakolya (Sketchfab), CC BY 4.0',
    // Номеров в модели нет: передний — на бампере над воздухозаборником, задний — в бампере под дверями. z — на 1 см
    // впереди самой выступающей точки кузова на площади таблички (замер лучами), иначе бампер её перекрывает.
    meshPlates: [{ x: 0, y: 0.49, z: 2.248, w: 0.52, h: 0.11, n: [0, 0, 1] }, { x: 0, y: 0.36, z: -2.25, w: 0.52, h: 0.11, n: [0, 0, -1] }],
    width: 1.75, cabinWidth: 1.55,
    body: [[-2.22, 0.27], [2.2, 0.27], [2.24, 0.5], [2.2, 0.72], [2.0, 0.82], [1.15, 0.97], [-2.15, 1.0], [-2.23, 0.6]],
    cabin: [[1.15, 0.96], [0.4, 1.52], [-1.9, 1.55], [-2.17, 1.45], [-2.17, 0.99]],
    windows: [[2, -0.25], [-0.35, -1.15], [-1.25, -2]], frame: '#1a1b1d', doors: [1.15, -0.3, -1.2],
    wheels: { r: 0.29, front: 1.44, rear: -1.46, track: 0.75, rim: 15 },
    bumper: 'paint', bumperH: 0.24, grille: '#17181b', grilleBars: '#c8ccd0', trim: '#1a1b1d', lights: 'rect',
    colors: ['#e9e9e6', '#a7abb0', '#22324f', '#8c1c1c', '#b8a88a', '#1e1f22', '#3b5f4a', '#5a5f66'],
    stats: { kmh: 155, t100: 15.4, grip: 0.95, eco: 0.95 }, // 1,6 л, 8 клапанов, 87 л. с.
  },
  vesta: {
    price: 140000,
    name: 'LADA Vesta', years: '2015–2022',
    about: 'Седан, который собирали на «ИжАвто», пока выпуск не перевели в Тольятти.',
    // Готовая модель (tools/models/vesta.mjs); не загрузилась — рисуется процедурная по полям ниже.
    glb: 'models/vesta.glb',
    credit: 'Модель: «Lada Vesta», tiunov.se (Sketchfab), CC BY 4.0',
    // В готовой модели номеров нет — места под таблички: центр, нормаль наружу (у остальных находятся по цвету). Задний —
    // в нише крышки багажника между фонарями, как у настоящей (ниша на 3 см глубже крышки, замер лучами).
    meshPlates: [{ x: 0, y: 0.47, z: 2.215, w: 0.52, h: 0.11, n: [0, 0, 1] }, { x: 0, y: 0.855, z: -2.144, w: 0.52, h: 0.11, n: [0, 0, -1] }],
    width: 1.76, cabinWidth: 1.5,
    // Бамперы в профиле кузова: низкий скруглённый нос, капот круто падает вперёд, короткий высокий багажник.
    body: [[-2.2, 0.32], [2.2, 0.32], [2.26, 0.46], [2.25, 0.6], [2.17, 0.73], [1.95, 0.83], [1.0, 1.0], [-1.66, 1.05],
      [-2.12, 1.04], [-2.22, 0.95], [-2.25, 0.62], [-2.23, 0.42]],
    cabin: [[1.0, 0.99], [0.0, 1.46], [-0.6, 1.5], [-1.12, 1.44], [-1.72, 1.05]],
    taper: 0.8, corner: 0.13, cornerR: 0.7, // покатая крыша, сильно скруглённые углы
    windows: [[2, -0.3], [-0.42, -1.2], [-1.28, -2]], frame: '#1a1b1d', doors: [1.0, -0.36, -1.4],
    crease: [[0.8, 0.46], [-1.68, 0.8]], // косая выштамповка на дверях — «икс» сбоку (процедурная модель)
    creaseAngle: 10, // у готовой «икс» — неглубокий перегиб: с общим порогом 30° сглаживание его стирает (борта в glb
    // для этого плотнее — BAND в tools/models/vesta.mjs; на редкой сетке 10° дал бы гранёный кузов)
    wheels: { r: 0.32, front: 1.38, rear: -1.25, track: 0.76, alloy: true, rim: 15 },
    bumper: 'paint', bumperH: 0.26, grille: '#1b1c1f', trim: '#1a1b1d', lights: 'vesta',
    colors: ['#e9e9e6', '#c63a2a', '#1e1f22', '#8c9196', '#2c5aa0', '#e07a1f', '#5a3a6b', '#3b5f4a'],
    stats: { kmh: 178, t100: 11.8, grip: 1.06, eco: 0.85 }, // ВАЗ-21129, 1,6 л, 106 л. с., механика
  },
  elargus: {
    price: 220000,
    name: 'LADA e-Largus', years: '2024 — н. в.',
    about: 'Электрический Ларгус ижевской сборки: ни выхлопа, ни рёва мотора — только гул электромотора.',
    // electric — без выхлопной трубы и дыма, звук — электромотор (audio.js), заряд — на тех же АЗС, что и бензин.
    electric: true,
    // Готовая модель (tools/models/largus.mjs: рестайлинг 2021 г. из Cross, обвес — в цвет, «иксы» — синие);
    // не загрузилась — процедурная по полям ниже.
    glb: 'models/elargus.glb',
    credit: 'Модель: «Lada Largus Cross Rest», usolakolya (Sketchfab), CC BY 4.0',
    // Номеров в модели нет: передний — на чёрной нижней части бампера, задний — в бампере под дверями (z — как у Ларгуса).
    meshPlates: [{ x: 0, y: 0.56, z: 2.284, w: 0.52, h: 0.11, n: [0, 0, 1] }, { x: 0, y: 0.4, z: -2.272, w: 0.52, h: 0.11, n: [0, 0, -1] }],
    width: 1.75, cabinWidth: 1.55,
    body: [[-2.24, 0.29], [2.24, 0.29], [2.28, 0.5], [2.24, 0.74], [2.0, 0.84], [1.15, 0.98], [-2.15, 1.0], [-2.25, 0.6]],
    cabin: [[1.15, 0.97], [0.4, 1.53], [-1.9, 1.56], [-2.17, 1.46], [-2.17, 1.0]],
    windows: [[2, -0.25], [-0.35, -1.15], [-1.25, -2]], frame: '#1a1b1d', doors: [1.15, -0.3, -1.2],
    wheels: { r: 0.34, front: 1.45, rear: -1.45, track: 0.72, alloy: true, rim: 15 },
    bumper: 'paint', bumperH: 0.24, grille: '#17181b', trim: '#1a1b1d', lights: 'rect',
    colors: ['#f0f0ec', '#2c5aa0', '#a7abb0', '#5a5f66', '#1e1f22', '#3d4a5c', '#8c1c1c', '#3b5f4a'],
    stats: { kmh: 145, t100: 9.9, grip: 1.0, eco: 1.25 }, // 120 кВт пиковой; 145 км/ч — ограничитель, разгон «меньше 10 с»
  },
};
export const DEFAULT_MODEL = 'm412';

// Диски — у всех машин: два слота в конце options (стиль и диаметр покупаются отдельно, как детали; wheel — показывать
// в гараже и у процедурных машин). Штатный диаметр — wheels.rim (дюймы, по умолчанию 13), больше — до +6". Вид — в
// rimWheel: колесо того же размера, шина ниже и шире. Новые стили — только в конец (номер варианта уходит в сеть).
export const RIM_STYLES = [['stock', 'штатные'], ['steel', 'штампованные', 3000], ['star', '«звезда»', 8000], ['spoke5', '5 спиц', 12000],
  ['turbo', '«турбина»', 15000], ['bbs', 'сетка, золото', 20000]];
const RIM_UP_PRICE = [0, 4000, 9000, 15000, 22000, 30000, 40000];
// Вид для всех машин (any — и у процедурных), слоты после дисков: подвеска — кузов выше/ниже над колёсами (RIDE, м),
// тонировка — цвет стёкол, хром (бамперы, решётка, молдинги) — в чёрный или в цвет кузова (restyle).
const STYLE_SLOTS = [
  { key: 'ride', name: 'Подвеска', any: true, variants: [['stock', 'штатная'], ['low', 'ниже на 3 см', 4000], ['slam', 'ниже на 6 см', 8000], ['stance', 'ниже на 10 см', 12000], ['lift', 'выше на 4 см', 5000]] },
  { key: 'tint', name: 'Тонировка', any: true, variants: [['none', 'нет'], ['light', 'лёгкая', 3000], ['dark', 'тёмная', 6000], ['blue', 'синяя', 7000]] },
  { key: 'chrome', name: 'Хром', any: true, variants: [['stock', 'штатный'], ['black', 'чёрный', 3000], ['paint', 'в цвет кузова', 4000]] },
];
const RIDE = { stock: 0, low: -0.03, slam: -0.06, stance: -0.1, lift: 0.04 };
// Посадка — это и пружины: ниже — короче и жёстче, меньше крен, руль острее, сцепление в повороте выше; выше — наоборот.
// [крен ×, руль ×, сцепление ×] — для физики (Car.setModel) и полосы «сцепление» в гараже.
export const RIDE_HANDLING = { stock: [1, 1, 1], low: [0.8, 1.05, 1.04], slam: [0.62, 1.1, 1.08], stance: [0.48, 1.15, 1.12], lift: [1.3, 0.94, 0.95] };
// Ниже штатной посадки шина уже и чуть внутрь [доля ширины, сдвиг к оси, м]: верх колеса уходит под крыло, а не
// прорезает его (у готовых моделей над шиной 0–2 см, крыло снаружи шины на ~2 см). Кузов не меняется.
const TUCK = { low: [0.9, 0.005], slam: [0.82, 0.01], stance: [0.72, 0.02] };
const TINT = { light: '#141b21', dark: '#06080a', blue: '#0b1a33' };
for (const spec of Object.values(MODELS)) {
  const base = spec.wheels.rim ?? 13;
  spec.options = [...(spec.options ?? []),
    { key: 'rim', name: 'Диски', wheel: true, variants: RIM_STYLES },
    { key: 'rsize', name: 'Диаметр', wheel: true, variants: RIM_UP_PRICE.map((p, i) => [String(base + i), `R${base + i}`, ...(p ? [p] : [])]) },
    ...STYLE_SLOTS];
}
// Детали, которые видно в гараже: у машин из glb — все, у процедурных — диски и вид (any).
export const shownOptions = (spec) => (spec.options ?? []).filter((o) => spec.mesh || o.wheel || o.any);

// Стекло и хром во всех моделях — одного цвета (tools/models: '#26333f', '#c8ccd0'); в вершинах glb он лежит как есть,
// у процедурных — в линейном пространстве (THREE.Color). Узнаём по цвету и перекрашиваем или переносим в краску.
const GLASS_HEX = '#26333f', CHROME_HEX = '#c8ccd0';
const spaces = (hex) => { const c = new THREE.Color(hex); return [[c.r, c.g, c.b], [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)]; };
function restyle(parts, { tint = 'none', chrome = 'stock' }) {
  if (tint === 'none' && chrome === 'stock') return;
  let geo = parts.detail.index ? parts.detail.toNonIndexed() : parts.detail;
  const col = geo.attributes.color;
  if (!col) return;
  const near = (i, c) => Math.abs(col.getX(i) - c[0]) < 0.004 && Math.abs(col.getY(i) - c[1]) < 0.004 && Math.abs(col.getZ(i) - c[2]) < 0.004;
  // Подходящий вариант цвета: [0] — линейный, [1] — как в glb; новый цвет — в том же пространстве.
  const which = (i, list) => (near(i, list[0]) ? 0 : near(i, list[1]) ? 1 : -1);
  const glass = spaces(GLASS_HEX), chromes = spaces(CHROME_HEX);
  const to = (hex, k) => spaces(hex)[k];
  const moved = [];
  for (let t = 0; t < col.count; t += 3) {
    for (let v = t; v < t + 3; v++) {
      const g = tint !== 'none' ? which(v, glass) : -1;
      if (g >= 0) col.setXYZ(v, ...to(TINT[tint], g));
    }
    if (chrome === 'stock') continue;
    const k = which(t, chromes);
    if (k < 0 || which(t + 1, chromes) !== k || which(t + 2, chromes) !== k) continue;
    if (chrome === 'black') for (let v = t; v < t + 3; v++) col.setXYZ(v, ...to('#1b1c1f', k));
    else moved.push(t / 3);
  }
  col.needsUpdate = true;
  if (moved.length) {
    // В цвет кузова: треугольники хрома — в геометрию краски (вершины белые), из деталей — прочь.
    const tri = (src, keep) => {
      const out = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(src.attributes)) {
        const n = a.itemSize, arr = new Float32Array(keep.length * 3 * n);
        keep.forEach((tIdx, j) => arr.set(a.array.subarray(tIdx * 3 * n, tIdx * 3 * n + 3 * n), j * 3 * n));
        out.setAttribute(name, new THREE.BufferAttribute(arr, n));
      }
      return out;
    };
    const set = new Set(moved), rest = [];
    for (let i = 0; i < col.count / 3; i++) if (!set.has(i)) rest.push(i);
    let paint = parts.paint.index ? parts.paint.toNonIndexed() : parts.paint;
    const add = tri(geo, moved);
    for (const name of Object.keys(add.attributes)) if (!paint.attributes[name]) add.deleteAttribute(name);
    if (add.attributes.color) add.attributes.color.array.fill(1);
    if (Object.keys(paint.attributes).every((k) => add.attributes[k])) {
      parts.paint = mergeGeometries([paint, add]);
      geo = tri(geo, rest);
    }
  }
  parts.detail = geo;
}

// ---------------------------------------------------------------- геометрия

// Профиль (z, y) → призма шириной w по x, по центру.
export function prism(profile, w) {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(w / 2, 0, 0);
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// Части [геометрия, цвет, форма?]: form(x, y, z) → множитель x — скругляет кузов (см. bodyForm).
function merge(parts, form) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [geo, color, shaped = true] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (form && shaped) {
      const p = g.attributes.position;
      // Нормали остаются от прямоугольной формы: пересчитанные выдают диагонали на скрученных гранях.
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * form(p.getY(i), p.getZ(i)));
    }
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    c.set(color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));
// Призма-выдавливание прямоугольное, у настоящих машин борта заваливаются внутрь: чуть ниже пояса,
// сильнее — стойки салона к крыше; углы спереди и сзади скруглены в плане.
function bodyForm(spec, front, rear) {
  const belt = spec.cabin[0][1], top = Math.max(...spec.cabin.map((p) => p[1]));
  const k = spec.taper ?? 0.85, R = spec.cornerR ?? 0.45, corner = spec.corner ?? 0.07;
  return (y, z) => {
    const side = y < belt ? 1 - 0.03 * clamp01((y - 0.45) / (belt - 0.45)) : 0.97 - (0.97 - k) * clamp01((y - belt) / (top - belt));
    const end = Math.max(clamp01((z - front + R) / R), clamp01((rear + R - z) / R));
    return side * (1 - corner * end);
  };
}

// Выпуклый многоугольник (z, y), сдвинутый внутрь на m.
function inset(poly, m) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [a, b] = poly[i], [c, d] = poly[(i + 1) % n]; area += a * d - c * b; }
  const lines = poly.map(([z0, y0], i) => {
    const [z1, y1] = poly[(i + 1) % n], l = Math.hypot(z1 - z0, y1 - y0), dz = (z1 - z0) / l, dy = (y1 - y0) / l;
    const s = Math.sign(area) * m;
    return { z: z0 - dy * s, y: y0 + dz * s, dz, dy };
  });
  return lines.map((B, i) => {
    const A = lines[(i + n - 1) % n], den = A.dz * B.dy - A.dy * B.dz;
    const t = ((B.z - A.z) * B.dy - (B.y - A.y) * B.dz) / den;
    return [A.z + A.dz * t, A.y + A.dy * t];
  });
}
// Часть многоугольника между z = lo и z = hi.
function clipZ(poly, lo, hi) {
  let p = poly;
  for (const [s, c] of [[1, hi], [-1, lo]]) {
    const out = [];
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length], ia = s * a[0] <= s * c, ib = s * b[0] <= s * c;
      if (ia) out.push(a);
      if (ia !== ib) out.push([c, a[1] + ((c - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
    });
    p = out;
  }
  return p;
}
// Пластина на обоих бортах по многоугольнику профиля: толщина по x от x0 до x1.
const plates = (poly, x0, x1) => [-1, 1].map((s) => prism(poly, x1 - x0).translate((s * (x0 + x1)) / 2, 0, 0));
// Пластина вдоль отрезка профиля a→b (лобовое, заднее стекло): отступ m с концов, ширина w, выступ t наружу.
function panel(a, b, w, m, t, cabin) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]), dz = (b[0] - a[0]) / l, dy = (b[1] - a[1]) / l;
  const cz = cabin.reduce((s, p) => s + p[0], 0) / cabin.length, cy = cabin.reduce((s, p) => s + p[1], 0) / cabin.length;
  let nz = -dy, ny = dz; // нормаль наружу — от центра салона
  if (nz * (a[0] - cz) + ny * (a[1] - cy) < 0) { nz = -nz; ny = -ny; }
  const p = (q, s, o) => [q[0] + dz * s + nz * o, q[1] + dy * s + ny * o];
  return prism([p(a, m, -0.01), p(b, -m, -0.01), p(b, -m, t), p(a, m, t)], w);
}
// Верх/низ кромки многоугольника на данном z.
function spanAt(poly, z) {
  const ys = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if ((a[0] - z) * (b[0] - z) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((z - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  });
  return [Math.min(...ys), Math.max(...ys)];
}

// Профиль кузова с вырезанными арками: нижняя кромка (первые две точки профиля — задний и
// передний низ) огибает дуги окружностей { z, y, R } — центр дуги и радиус.
export const ARCH_GAP = 0.06; // зазор арки над колесом
export function withArches(body, arches) {
  const [[z0, y0], [z1]] = body;
  const pts = [];
  for (const { z, y, R } of [...arches].sort((a, b) => a.z - b.z)) {
    const t0 = Math.asin(Math.min(1, Math.max(-1, (y0 - y) / R)));
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - t0 - ((Math.PI - 2 * t0) * i) / 10;
      pts.push([z + R * Math.cos(a), Math.max(y0, y + R * Math.sin(a))]);
    }
  }
  return [[z0, y0], ...pts.filter(([z]) => z > z0 && z < z1), ...body.slice(1)];
}
// Арки под колёса: полукруг чуть больше колеса.
export const wheelArches = (r, zs) => zs.map((z) => ({ z, y: r, R: r + ARCH_GAP }));

// Части модели: paint — под цвет кузова (вершины белые), detail — стекло, бамперы, шины,
// lights — фары/фонари (рисуются без освещения). wheels — для вращения у машины игрока.
// ---------------------------------------------------------------- готовые модели

// Грузит модели с glb до постройки машин: части paint/detail/lights/wheel (вершинные цвета), размеры колёс и длина —
// из extras сцены. Ошибка — модель остаётся процедурной. Нормали сглажены между гранями, кроме рёбер круче CREASE:
// модели ужаты в 10–20 раз, и с плоскими нормалями каждый крупный треугольник на изгибе кузова виден отдельной
// гранью — кузов как мятая бумага. Неглубокие выштамповки разглаживаются вместе с изгибами — модели с ними задают
// свой порог (creaseAngle в MODELS, градусы).
const CREASE = 30;

export async function loadVehicleMeshes() {
  const loader = new GLTFLoader();
  await Promise.all(Object.values(MODELS).filter((m) => m.glb).map(async (spec) => {
    try {
      const gltf = await loader.loadAsync(await cachedURL(spec.glb));
      const mesh = {}, opts = {}; // opts: слот → вариант → часть → геометрия
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = toCreasedNormals(o.geometry, ((spec.creaseAngle ?? CREASE) * Math.PI) / 180);
        const [o_, slot, variant, part] = o.name.split('-');
        if (o_ === 'o' && part) ((opts[slot] ||= {})[variant] ||= {})[part] = g;
        else mesh[o.name] = g;
      });
      const { wheels, length, hub } = gltf.scene.userData;
      Object.assign(spec.wheels, wheels);
      spec.mesh = { ...mesh, opts, length, hub, wheelL: hub && mirrorX(mesh.wheel) };
    } catch (e) {
      console.warn(`Модель ${spec.name} не загрузилась, рисую процедурную`, e);
    }
  }));
}

// Зеркало по x (колесо левого борта): с переворотом обхода треугольников, иначе грани смотрят внутрь. Нормали отражает
// scale — заново не считаем, иначе сглаженные стали бы плоскими.
function mirrorX(geo) {
  const g = geo.clone().scale(-1, 1, 1);
  for (const a of Object.values(g.attributes)) {
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.array[(i + 1) * a.itemSize + k];
        a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        a.array[(i + 2) * a.itemSize + k] = t;
      }
    }
  }
  return g;
}

// Колесо вокруг своего центра одной геометрией с вершинными цветами. left — для левого борта (x < 0):
// у колеса с диском из модели (hub) диск снаружи, его отражаем.
function wheelGeometry(spec, seg, left = false, options) {
  const base = spec.wheels.rim ?? 13, style = options?.rim ?? 'stock', size = +(options?.rsize ?? base);
  if (style !== 'stock' || size !== base) return rimWheel(spec, seg, style === 'stock' ? (spec.wheels.alloy ? 'spoke5' : 'steel') : style, size, left);
  const m = spec.mesh;
  if (!m || !m.wheel) return merge(wheelParts(spec.wheels, seg)); // в модели нет колеса — процедурное
  if (m.hub) return (left ? m.wheelL : m.wheel).clone();
  return mergeGeometries([m.wheel.clone(), merge(wheelParts(spec.wheels, seg).slice(1))]); // шина — своя
}

function meshParts(spec, wheelsInDetail, options) {
  const { r, front: wf, rear: wr, track } = spec.wheels, m = spec.mesh;
  const wheels = [];
  for (const z of [wf, wr]) for (const x of [-track, track]) wheels.push({ x, y: r, z, r, front: z > 0 });
  // Кузов + выбранные варианты деталей.
  const sets = [m, ...Object.entries(pickOptions(spec, options)).map(([slot, v]) => m.opts?.[slot]?.[v]).filter(Boolean)];
  const part = (name) => { const l = sets.map((s) => s[name]).filter(Boolean); return l.length > 1 ? mergeGeometries(l) : l[0].clone(); };
  let detail = part('detail');
  if (wheelsInDetail) {
    detail = mergeGeometries([detail, ...wheels.map((p) => staticWheel(spec, p.x < 0).translate(p.x, p.y, p.z))]);
  }
  return { paint: part('paint'), detail, lights: part('lights'), wheels, length: m.length };
}

// Выбор деталей { слот: вариант } с вариантами по умолчанию для недостающих и неизвестных.
export function pickOptions(spec, options = {}) {
  const out = {};
  for (const o of spec.options || []) out[o.key] = o.variants.some(([v]) => v === options[o.key]) ? options[o.key] : o.variants[0][0];
  return out;
}
// Выбор деталей числом для сети: номер варианта слота i — i-я десятичная цифра (вариантов в слоте < 10).
export function optionsCode(spec, options) {
  const o = pickOptions(spec, options);
  return (spec.options || []).reduce((s, slot, i) => s + slot.variants.findIndex(([v]) => v === o[slot.key]) * 10 ** i, 0);
}
export function optionsFrom(spec, code) {
  const out = {};
  (spec.options || []).forEach((slot, i) => { out[slot.key] = slot.variants[Math.floor(code / 10 ** i) % 10]?.[0]; });
  return pickOptions(spec, out);
}

export function vehicleParts(spec, { wheelsInDetail = false, options } = {}) {
  if (spec.mesh) return meshParts(spec, wheelsInDetail, options);
  const W = spec.width, CW = spec.cabinWidth, front = Math.max(...spec.body.map((p) => p[0])), rear = Math.min(...spec.body.map((p) => p[0]));
  const paint = [], detail = [], lights = [];
  const { r, front: wf, rear: wr, track } = spec.wheels, R = r + ARCH_GAP, y0 = spec.body[0][1];
  const body = withArches(spec.body, wheelArches(r, [wr, wf]));
  paint.push([prism(body, W), '#fff']);
  // Ниши колёс: тёмная вставка между колёсами, чтобы сквозь арки не просвечивала улица.
  for (const z of [wf, wr]) detail.push([box(2 * (track - 0.12), r + R - y0 + 0.01, 2 * R, 0, (y0 + r + R + 0.01) / 2, z), '#111214', false]);
  // Салон под краску, стёкла — пластинами поверх: стойки и рамки получаются сами.
  paint.push([prism(spec.cabin, CW), '#fff']);
  const glass = '#26333f', side = inset(spec.cabin, 0.06);
  const zs = spec.windows.flat();
  if (spec.frame) detail.push(...plates(clipZ(side, Math.min(...zs), Math.max(...zs)), CW / 2 - 0.01, CW / 2 + 0.008).map((g) => [g, spec.frame]));
  for (const [hi, lo] of spec.windows) detail.push(...plates(clipZ(side, lo, hi), CW / 2 - 0.01, CW / 2 + 0.014).map((g) => [g, glass]));
  const c = spec.cabin;
  detail.push([panel(c[0], c[1], CW - 0.1, 0.06, 0.012, c), glass]);
  if (!spec.box) detail.push([panel(c[2], c[3], CW - 0.12, 0.06, 0.012, c), glass]);
  if (spec.box) {
    const b = spec.box;
    const geo = box(b.width, b.y1 - b.y0, b.from - b.to, 0, (b.y0 + b.y1) / 2, (b.from + b.to) / 2);
    (b.color === 'paint' ? paint : detail).push([geo, b.color === 'paint' ? '#fff' : b.color, false]);
  }
  // Швы дверей и ручки, зеркала.
  const trim = spec.trim || '#1a1b1d', doors = [...(spec.doors || [])].sort((a, b) => b - a);
  doors.forEach((z, i) => {
    let bottom = y0;
    for (const w of [wf, wr]) if (Math.abs(z - w) < R) bottom = Math.max(bottom, r + Math.sqrt(R * R - (z - w) ** 2));
    const top = spanAt(body, z)[1];
    detail.push(...plates([[z - 0.006, bottom + 0.04], [z + 0.006, bottom + 0.04], [z + 0.006, top - 0.03], [z - 0.006, top - 0.03]], W / 2 - 0.01, W / 2 + 0.004).map((g) => [g, '#141518']));
    if (i > 0 && !spec.box) detail.push(...plates([[z + 0.1, top - 0.13], [z + 0.24, top - 0.13], [z + 0.24, top - 0.1], [z + 0.1, top - 0.1]], W / 2 - 0.01, W / 2 + 0.012).map((g) => [g, trim]));
  });
  if (spec.box && doors.length > 1) {
    const z = doors[1], top = spanAt(body, z)[1];
    detail.push(...plates([[z + 0.1, top - 0.13], [z + 0.24, top - 0.13], [z + 0.24, top - 0.1], [z + 0.1, top - 0.1]], W / 2 - 0.01, W / 2 + 0.012).map((g) => [g, trim]));
  }
  for (const s of [-1, 1]) {
    const [mz, my] = c[0];
    detail.push([box(0.06, 0.04, 0.05, s * (CW / 2 + 0.06), my + 0.06, mz - 0.14), trim]);
    detail.push([box(0.07, 0.11, 0.16, s * (CW / 2 + 0.13), my + 0.1, mz - 0.14), trim]);
  }
  // Бамперы с загибом на борта, решётка, номера.
  // bumper: 'paint' — бамперы в цвет кузова (снизу чёрная губа).
  const bh = spec.bumperH || 0.16, by = y0 + 0.02 + bh / 2;
  const [bumpers, bc] = spec.bumper === 'paint' ? [paint, '#fff'] : [detail, spec.bumper];
  for (const [z, s] of [[front, 1], [rear, -1]]) {
    if (spec.bumper === 'paint') { detail.push([box(W - 0.3, 0.05, 0.1, 0, y0 + 0.03, z + s * 0.02), '#1b1c1f']); continue; }
    bumpers.push([box(W + 0.04, bh, 0.14, 0, by, z + s * 0.02), bc]);
    for (const x of [-1, 1]) bumpers.push([box(0.05, bh, 0.34, x * (W / 2 + 0.01), by, z - s * 0.12), bc]);
    detail.push([box(0.52, 0.11, 0.02, 0, s > 0 ? by : Math.max(by + bh / 2 + 0.1, 0.6), z + s * (s > 0 ? 0.1 : 0.02)), '#f0f0ea']);
  }
  // Выштамповка на борту — полоса чуть темнее краски.
  if (spec.crease) {
    const [[za, ya], [zb, yb]] = spec.crease;
    // Выступ 2 см: борт после bodyForm прогибается между вершинами, тоньше — пластина тонет.
    const band = (d0, d1, c) => paint.push(...plates([[za, ya + d0], [za, ya + d1], [zb, yb + d1], [zb, yb + d0]], W / 2 - 0.01, W / 2 + 0.02).map((g) => [g, c]));
    band(-0.025, 0.012, '#9a9a9a'); // тень под острой кромкой
    band(-0.08, -0.025, '#c8c8c8'); // вогнутость ниже
  }
  // Фары и фонари.
  const fy = 0.66;
  if (spec.lights === 'vesta') {
    // Веста: фары на углах капота единым куском с заходом на крыло, ниже — решётка-трапеция
    // с эмблемой, большой воздухозаборник с номером, противотуманки; фонари тоже заходят на борта.
    const chrome = '#d4d7da', side = (poly, w, c, to) => to.push(...plates(poly, W / 2 - w, W / 2 + 0.006).map((g) => [g, c]));
    side([[2.262, 0.6], [2.185, 0.725], [1.95, 0.818], [1.76, 0.85], [1.84, 0.79], [2.0, 0.745], [2.2, 0.63]], 0.46, '#fff6d8', lights);
    const lean = (g) => g.rotateX(-0.12), trap = (top, bottom, h, d) => new THREE.ExtrudeGeometry(new THREE.Shape([[-bottom / 2, -h / 2], [bottom / 2, -h / 2], [top / 2, h / 2], [-top / 2, h / 2]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
    detail.push([lean(trap(0.7, 0.58, 0.15, 0.05)).translate(0, 0.635, 2.25), chrome]);
    detail.push([lean(trap(0.64, 0.52, 0.11, 0.05)).translate(0, 0.635, 2.257), spec.grille]);
    detail.push([box(0.13, 0.065, 0.03, 0, 0.66, 2.275), chrome]);
    detail.push([box(1.0, 0.13, 0.04, 0, 0.47, 2.25), spec.grille], [box(0.52, 0.11, 0.02, 0, 0.47, 2.275), '#f0f0ea']);
    for (const s of [-1, 1]) {
      detail.push([box(0.14, 0.1, 0.04, s * (W / 2 - 0.2), 0.47, 2.245), spec.grille]);
      lights.push([box(0.08, 0.06, 0.03, s * (W / 2 - 0.2), 0.47, 2.26), '#fff6d8']);
    }
    side([[-2.24, 0.82], [-2.205, 0.958], [-2.12, 1.046], [-1.88, 1.056], [-1.9, 0.98], [-2.1, 0.94], [-2.2, 0.82]], 0.42, '#ff2a1a', lights);
    detail.push([box(0.52, 0.11, 0.02, 0, 0.68, rear - 0.025), '#f0f0ea']);
    paint.push([box(W - 0.4, 0.03, 0.08, 0, 1.055, -2.08), '#fff']); // спойлер на крышке багажника
  } else {
    const L = { w: 0.34, h: 0.15, ...spec.lamp }, T = { w: 0.3, h: 0.14, y: 0.72, ...spec.tail };
    const lx = W / 2 - 0.06 - L.w / 2, gw = 2 * (lx - L.w / 2) - 0.04;
    detail.push([box(gw, L.h, 0.04, 0, fy, front + 0.01), spec.grille]);
    if (spec.grilleBars) for (const dy of [-0.035, 0.035]) detail.push([box(gw - 0.04, 0.018, 0.05, 0, fy + dy, front + 0.012), spec.grilleBars]);
    for (const s of [-1, 1]) {
      detail.push([box(L.w + 0.03, L.h + 0.03, 0.04, s * lx, fy, front + 0.005), spec.grille]);
      lights.push([box(L.w, L.h, 0.04, s * lx, fy, front + 0.012), '#fff6d8']);
      lights.push([box(T.w, T.h, 0.04, s * (W / 2 - 0.06 - T.w / 2), T.y, rear - 0.01), '#ff2a1a']);
    }
  }
  // Колёса.
  const wheels = [];
  for (const z of [wf, wr]) for (const x of [-track, track]) wheels.push({ x, y: r, z, r, front: z > 0 });
  if (wheelsInDetail) for (const w of wheels) for (const [g, c] of staticWheelParts(spec.wheels)) detail.push([g.translate(w.x, w.y, w.z), c, false]);
  const form = bodyForm(spec, front, rear);
  return { paint: merge(paint, form), detail: merge(detail, form), lights: merge(lights, form), wheels, length: front - rear };
}

// Купленные диски (слоты rim, rsize): шина, обод и лицо диска по стилю. Колесо снаружи того же радиуса, что штатное
// (крупнее — вылезало из тесных арок готовых моделей), обод — по диаметру, резина — что осталось (низкий профиль).
// На дюйм шире на 4 % — внутрь машины (left — левый борт), внешняя боковина на месте, иначе торчит из-за крыла.
// Штампованный — сплошной, лицо шире шины (видно с обеих сторон); остальные — сквозные, лицом наружу (left). userData.rim — радиус обода (ободок шин, setGear).
const RIM_COLORS = { steel: ['#7d8288', '#8f949a'], star: ['#c4c8cc', '#c4c8cc'], spoke5: ['#c4c8cc', '#d4d8dc'], turbo: ['#b9bec4', '#d0d4d8'], bbs: ['#c9cdd2', '#c9a227'] };
function rimWheel(spec, seg, style, size, left) {
  const { r: R } = spec.wheels, up = size - (spec.wheels.rim ?? 13);
  const w = 0.22 * (1 + 0.04 * up), rr = Math.min(R - 0.035, size * 0.0127 * (R / 0.29));
  const disc = (rad, width, n = seg * 2) => new THREE.CylinderGeometry(rad, rad, width, n).rotateZ(Math.PI / 2);
  const [barrel, face] = RIM_COLORS[style], DARK = '#2a2c30';
  const parts = [[disc(R, w), TIRE], [disc(rr, w + 0.004), barrel]];
  if (style === 'steel') {
    parts.push([disc(rr * 0.94, w + 0.006), face], [disc(rr * 0.32, w + 0.016, 16), '#c4c8cc']);
    for (let i = 0; i < 6; i++) parts.push([disc(rr * 0.11, w + 0.01, 8).translate(0, Math.cos(i * Math.PI / 3) * rr * 0.62, Math.sin(i * Math.PI / 3) * rr * 0.62), DARK]);
  } else {
    // Сквозные: шина и обод — кольца, спицы — у внешнего края, за ними тормозной диск и ступица, между ними
    // видно арку. «Звезда» — 5 широких, «5 спиц» — 5 пар тонких, сетка — 10 спиц крест-накрест, «турбина» — 12
    // косых лопаток, развёрнутых, как у вентилятора, между ступицей и внешним кольцом.
    const o = left ? -1 : 1, n2 = seg * 2;
    const ring = (rin, rout, x, dir) => new THREE.RingGeometry(rin, rout, n2).rotateY(dir * Math.PI / 2).translate(x, 0, 0);
    const tube = (rad, width) => new THREE.CylinderGeometry(rad, rad, width, n2, 1, true).rotateZ(Math.PI / 2);
    const SPOKE = 0.045; // толщина спиц вдоль оси
    const spokeAt = (len, thick, at, angle, tilt = 0) => new THREE.BoxGeometry(SPOKE, len, thick).rotateX(tilt)
      .translate(o * (w / 2 - SPOKE / 2 + 0.004), at, 0).rotateX(angle);
    parts.length = 0;
    parts.push([tube(R, w), TIRE], [ring(rr, R, w / 2, 1), TIRE], [ring(rr, R, -w / 2, -1), TIRE],
      [mirrorX(tube(rr * 0.96, w)), barrel], [ring(rr * 0.96, rr, -o * w / 2, -o), barrel],
      [ring(rr * 0.9, rr, o * (w / 2 + 0.002), o), face],
      [disc(rr * 0.72, 0.022).translate(o * (w / 2 - 0.09), 0, 0), '#5d6066'],
      [disc(rr * 0.3, 0.07, 16).translate(o * (w / 2 - 0.05), 0, 0), '#3a3c40'],
      [disc(rr * 0.24, 0.05, 16).translate(o * (w / 2 - 0.02), 0, 0), face]);
    if (style === 'turbo') {
      parts.push([ring(rr * 0.78, rr * 0.9, o * (w / 2 + 0.002), o), face],
        [mirrorX(tube(rr * 0.78, SPOKE)).translate(o * (w / 2 - SPOKE / 2), 0, 0), barrel],
        [disc(rr * 0.34, 0.05, 16).translate(o * (w / 2 - 0.02), 0, 0), '#e4e7ea']);
      for (let i = 0; i < 12; i++) {
        parts.push([new THREE.BoxGeometry(SPOKE, rr * 0.5, 0.05).rotateY(0.65).rotateX(0.5)
          .translate(o * (w / 2 - SPOKE / 2 + 0.002), rr * 0.55, 0).rotateX((i * 2 * Math.PI) / 12), '#9aa0a6']);
      }
    }
    const n = style === 'turbo' ? 0 : style === 'bbs' ? 10 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n;
      if (style === 'star') parts.push([spokeAt(rr * 0.8, 0.075, rr * 0.52, a), face]);
      else if (style === 'spoke5') for (const d of [-0.11, 0.11]) parts.push([spokeAt(rr * 0.8, 0.03, rr * 0.52, a + d), face]);
      else for (const t of [-0.45, 0.45]) parts.push([spokeAt(rr * 0.82, 0.022, rr * 0.53, a, t), face]);
    }
  }
  const g = merge(parts).translate((left ? 1 : -1) * (w - 0.22) / 2, 0, 0);
  g.userData.rim = rr;
  return g;
}

// Граней по окружности у колёс, которые рисует игра: у машины игрока (видна вблизи) и у трафика с парковками (их
// много — вдвое меньше). При 14 и 12 колёса были заметными многоугольниками.
const WHEEL_SEG = 32, WHEEL_SEG_STATIC = 24;
// Цвет шины у колёс игры — как у шин в glb: там #151618 записан как есть (линейный), а здесь цвет переводится из sRGB,
// и тот же #151618 выходил почти чёрным — у Весты шина была чернее, чем у Ларгуса.
const TIRE = '#515356';

// Колесо машин, у которых колёса не крутятся (трафик, очереди на заправках): литой диск — сплошной, одним
// цветом; неподвижные спицы на ходу выглядят плохо. Штампованные и колпаки — как есть.
function staticWheel(spec, left = false) {
  return spec.wheels.alloy ? merge(staticWheelParts(spec.wheels)) : wheelGeometry(spec, WHEEL_SEG_STATIC, left);
}
function staticWheelParts({ r, alloy }) {
  if (!alloy) return wheelParts({ r, alloy }, WHEEL_SEG_STATIC);
  const disc = (k, w) => new THREE.CylinderGeometry(r * k, r * k, w, WHEEL_SEG_STATIC).rotateZ(Math.PI / 2);
  return [[disc(1, 0.22), TIRE], [disc(0.74, 0.226), '#b4b8bd']];
}

// Колесо вокруг своего центра: шина и штампованный диск с колпаком; alloy — литой диск со спицами.
function wheelParts({ r, alloy }, seg) {
  const disc = (k, w, n = 16) => new THREE.CylinderGeometry(r * k, r * k, w, n).rotateZ(Math.PI / 2);
  const parts = [[disc(1, 0.22, seg), TIRE]];
  if (!alloy) return [...parts, [disc(0.55, 0.23), '#9ea3a8']];
  parts.push([disc(0.8, 0.225, seg), '#c4c8cc'], [disc(0.68, 0.23, seg), '#2a2c30'], [disc(0.18, 0.24), '#c4c8cc']);
  for (let i = 0; i < 5; i++) parts.push([new THREE.BoxGeometry(0.235, 0.05, r * 1.4).rotateX((i * Math.PI) / 5), '#c4c8cc']);
  return parts;
}

// Модель для машины игрока: краска — материалом, колёса — отдельными узлами (крутятся, рулят).
const wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export function buildPlayerModel(key, color, options) {
  const spec = MODELS[key] || MODELS[DEFAULT_MODEL];
  const parts = vehicleParts(spec, { options }), style = pickOptions(spec, options);
  restyle(parts, style);
  const g = new THREE.Group();
  g.userData.ride = style.ride; // посадка — для управляемости (Car.setModel)
  const paintMat = paintMaterial(color || spec.colors[0]); // обычный цвет или покрытие (paints.js)
  const meshes = [
    new THREE.Mesh(parts.paint, paintMat),
    new THREE.Mesh(parts.detail, new THREE.MeshLambertMaterial({ vertexColors: true })),
    new THREE.Mesh(parts.lights, new THREE.MeshBasicMaterial({ vertexColors: true })),
  ];
  // Кузов — в своей группе с осью крена на высоте центра крена (колёса не кренятся, см. Car.bodyRoll).
  const body = new THREE.Group(), ROLL_CENTER = 0.45;
  body.position.y = ROLL_CENTER + (RIDE[style.ride] ?? 0); // подвеска: кузов выше/ниже, колёса на месте
  for (const mesh of meshes) mesh.position.y = -ROLL_CENTER;
  body.add(...meshes);
  g.add(body);
  g.userData.body = body;
  g.userData.wheels = [];
  const wheelGeo = [wheelGeometry(spec, WHEEL_SEG, false, options), wheelGeometry(spec, WHEEL_SEG, true, options)];
  for (const w of parts.wheels) {
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(wheelGeo[w.x < 0 ? 1 : 0], wheelMat));
    const tuck = TUCK[style.ride];
    if (tuck) {
      wheel.scale.x = tuck[0];
      pivot.position.x -= Math.sign(w.x) * tuck[1];
    }
    pivot.add(wheel);
    g.add(pivot);
    g.userData.wheels.push({ pivot, w: wheel, front: w.front });
  }
  g.userData.paint = paintMat;
  g.userData.length = parts.length;
  g.userData.width = spec.width;
  g.userData.electric = !!spec.electric; // без выхлопа: ни трубы, ни дыма (setGear, ExhaustFX)
  g.userData.plateHost = meshes[1];
  g.userData.plateSpots = plateSpots(spec, parts.detail);
  g.userData.mounts = gearMounts(spec, g, meshes.slice(0, 2), parts.length, RIDE[style.ride] ?? 0);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // Ночью — ореолы фар и фонарей (свет на дорогу у своей машины — прожектор в main.js).
  const glow = new THREE.Mesh(carGlows(parts.lights), glowMaterial());
  glow.position.y = -ROLL_CENTER;
  glow.frustumCulled = false;
  body.add(glow);
  return g;
}

// ---------------------------------------------------------------- тюнинг на машине

// Точки крепления навесного — лучом снаружи по кузову (краска и детали), чтобы сидело на поверхности: сопла
// «Кузнечика» на порогах между колёсами и под днищем, сопло нитро справа сзади, глушитель слева сзади.
// Струи, пламя нитро и выхлоп (effects.js) бьют из этих же точек.
// dy — посадка (RIDE): высоты, заданные числом (пороги, труба), — вместе с кузовом; низ кузова лучом и так по опущенному.
function gearMounts(spec, g, meshes, len, dy = 0) {
  g.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  // С обеих сторон граней: у готовых моделей низ бампера — одна грань, изнутри.
  const hit = (o, d) => {
    ray.set(new THREE.Vector3(...o), new THREE.Vector3(...d));
    for (const m of meshes) m.material.side = THREE.DoubleSide;
    const p = ray.intersectObjects(meshes, false)[0]?.point;
    for (const m of meshes) m.material.side = THREE.FrontSide;
    return p;
  };
  const { r, front, rear } = spec.wheels, mid = (front + rear) / 2, w = spec.width / 2;
  const side = [];
  for (const s of [1, -1]) {
    for (const [z, isFront] of [[front - r - 0.28, true], [rear + r + 0.28, false]]) {
      side.push({ side: s, front: isFront, x: hit([s * 3, 0.45 + dy, z], [-s, 0, 0])?.x ?? s * w, y: 0.45 + dy, z });
    }
  }
  const down = [0.3, -0.3].map((k) => { const z = mid + k * (front - rear); return { x: 0, y: hit([0, -1, z], [0, 1, 0])?.y ?? 0.3, z }; });
  // Задний торец: бампер бывает выше трубы — самая задняя точка кузова на высоте 0.2…0.6 м; труба — под нижним
  // краем бампера (у низкого бампера «Оды» — ниже 0.33 м, иначе пряталась в нём).
  const back = (x, y) => {
    let z = Infinity;
    for (let h = 0.2; h <= 0.6; h += 0.05) z = Math.min(z, hit([x, h + dy, -10], [0, 0, 1])?.z ?? Infinity);
    z = Number.isFinite(z) ? z : -len / 2;
    const bottom = hit([x, -1, z + 0.06], [0, 1, 0])?.y;
    return { x, y: bottom ? Math.max(0.17 + dy, Math.min(y, bottom - 0.045)) : y, z: z + PIPE_IN };
  };
  return { side, down, exhaust: back(-0.45, 0.33 + dy), nitro: back(0.45, 0.33 + dy) };
}

const gearMats = {};
const gearMat = (color) => (gearMats[color] ??= new THREE.MeshLambertMaterial({ color }));
const CHROME = '#c9ccd0', DARK = '#1c1d20', NOZZLE = '#3a3d42', HOT = '#ff8a2a';
const PIPE_IN = 0.06; // срез глушителя и нитро — под бампером, а не за ним (висели в воздухе), м
const PIPE_LEN = 0.4; // труба вперёд от среза — уходит под днище
const HOP_OUT = 0.04; // насколько сопло «Кузнечика» выходит из кузова, м (у «М» — в 1.35 раза больше)

// Видимый тюнинг (уровни — как в tuned(), shop.js): двигатель — насадка глушителя (III — двойная), шины — тонкий
// цветной ободок на боковине вокруг диска (жёлтый / красный), нитро — синее сопло сзади (двойной баллон — два), «Кузнечик» — сопла
// на порогах и под днищем, выходят из кузова на 4 см («Кузнечик-М» — те же, крупнее). Трубы — вровень с бампером.
export function setGear(model, { engine = 0, tires = 0, nitro = 0, hopper = 0 } = {}) {
  const ud = model.userData, key = `${engine}${tires}${nitro}${hopper}`;
  if (!ud.mounts || ud.gearKey === key) return;
  ud.gearKey = key;
  for (const m of ud.gear ?? []) { m.removeFromParent(); m.geometry.dispose(); }
  ud.gear = [];
  const lift = -ud.body.position.y; // меши кузова опущены на центр крена
  const add = (parent, geo, color, y = lift) => {
    const m = new THREE.Mesh(geo, gearMat(color));
    m.position.y = y;
    parent.add(m);
    ud.gear.push(m);
  };
  // Труба вдоль машины: от z + PIPE_LEN до z − out (z — срез, на PIPE_IN впереди заднего края бампера).
  const pipe = ({ x, y, z }, r, color, out) => {
    const l = PIPE_LEN + out;
    add(ud.body, new THREE.CylinderGeometry(r, r, l, 14).rotateX(Math.PI / 2).translate(x, y, z + PIPE_LEN - l / 2), color);
    add(ud.body, new THREE.CircleGeometry(r * 0.7, 14).rotateY(Math.PI).translate(x, y, z - out - 0.001), DARK);
  };
  const { side, down, exhaust, nitro: nz } = ud.mounts;
  if (engine && !ud.electric) {
    const tips = engine === 3 ? [-0.042, 0.042] : [0];
    for (const dx of tips) pipe({ ...exhaust, x: exhaust.x + dx }, engine === 1 ? 0.028 : 0.034, CHROME, 0.005);
  }
  if (nitro) for (const dx of nitro === 2 ? [-0.028, 0.028] : [0]) pipe({ ...nz, x: nz.x + dx }, 0.021, '#2a62d8', -0.005);
  if (hopper) {
    // Сопло: фланец на кузове, из него наружу — конус на HOP_OUT, на срезе — раскалённое кольцо.
    // «Кузнечик-М» — такие же, только крупнее.
    const k = hopper === 2 ? 1.35 : 1, out = HOP_OUT * k;
    const nozzle = (r, flip, place) => [
      [new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.02, 18), NOZZLE, 0],
      [new THREE.CylinderGeometry(r * 0.8, r, out, 18).translate(0, out / 2, 0), NOZZLE, 0],
      [new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.004, 18), HOT, out + 0.001],
    ].forEach(([geo, color, at]) => add(ud.body, place(flip(geo.translate(0, at, 0))), color));
    for (const m of side) nozzle(0.034 * k, (g) => g.rotateZ(-m.side * Math.PI / 2), (g) => g.translate(m.x, m.y, m.z));
    for (const m of down) nozzle(0.06 * k, (g) => g.rotateX(Math.PI), (g) => g.translate(0, m.y, m.z));
  }
  if (tires) {
    for (const wh of ud.wheels) {
      const geo = wh.w.children[0].geometry;
      geo.boundingBox ?? geo.computeBoundingBox();
      const s = Math.sign(wh.pivot.position.x), ring = geo.userData.rim ? geo.userData.rim + 0.012 : geo.boundingBox.max.y * 0.7; // купленные диски — по ободу
      const x = s < 0 ? geo.boundingBox.min.x - 0.002 : geo.boundingBox.max.x + 0.002;
      add(wh.w, new THREE.TorusGeometry(ring, 0.007, 4, 32).rotateY(Math.PI / 2).translate(x, 0, 0), tires === 2 ? '#ff3b30' : '#ffd23f', 0);
    }
  }
}

// ---------------------------------------------------------------- номер с именем игрока

// Таблички в детали (detail) крашены '#f0f0ea': в готовых моделях цвет записан как есть, в процедурных —
// переведён в линейный. По этим вершинам и находим места под номер; грани — только смотрящие вперёд/назад.
const PLATE_COLORS = [[0.941, 0.941, 0.918], [0.871, 0.871, 0.823]];
function plateSpots(spec, detail) {
  if (spec.mesh && spec.meshPlates) return spec.meshPlates;
  const key = spec.mesh ? 'platesMesh' : 'platesProc';
  if (spec[key]) return spec[key];
  const c = detail.attributes.color, p = detail.attributes.position, nr = detail.attributes.normal;
  const isPlate = (i) => PLATE_COLORS.some(([pr, pg, pb]) => Math.abs(c.getX(i) - pr) + Math.abs(c.getY(i) - pg) + Math.abs(c.getZ(i) - pb) < 0.01);
  const spots = [];
  for (const side of [1, -1]) {
    const idx = [];
    for (let i = 0; i < c.count; i++) if (Math.sign(p.getZ(i)) === side && nr.getZ(i) * side >= 0.5 && isPlate(i)) idx.push(i);
    if (!idx.length) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sz = 0;
    const n = new THREE.Vector3();
    for (const i of idx) {
      x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i));
      y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i));
      sz += p.getZ(i);
      n.x += nr.getX(i); n.y += nr.getY(i); n.z += nr.getZ(i);
    }
    n.normalize();
    // Центр — середина по x и y; вдоль нормали — у самой выступающей точки таблички: у готовых моделей
    // (STL) табличка неровная, и номер на средней плоскости местами уходил бы под её треугольники.
    const ctr = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, sz / idx.length);
    let out = -Infinity;
    for (const i of idx) out = Math.max(out, (p.getX(i) - ctr.x) * n.x + (p.getY(i) - ctr.y) * n.y + (p.getZ(i) - ctr.z) * n.z);
    ctr.addScaledVector(n, out);
    // Наклонная табличка (номер на крышке багажника) по высоте занимает меньше своей высоты.
    spots.push({ x: ctr.x, y: ctr.y, z: ctr.z, w: x1 - x0, h: (y1 - y0) / Math.max(0.3, Math.abs(n.z)), n: n.toArray() });
  }
  return (spec[key] = spots);
}

// Номер на холсте. Длинный — пропорции российского 520×112 мм: текст, справа регион 18, RUS и флаг.
// Квадратный (задний у Москвича, 290×170) — в две строки: текст, под ним 18 RUS.
const PLATE_FONT = '"Arial Narrow", "Roboto Condensed", "DIN Condensed", sans-serif';
function drawPlate(cv, text, square) {
  const W = cv.width, H = cv.height, g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f4f4f0';
  g.beginPath(); g.roundRect(0, 0, W, H, 18); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 8;
  g.beginPath(); g.roundRect(8, 8, W - 16, H - 16, 14); g.stroke();
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  // Регион: «18», ниже RUS и флаг; (cx, top, w, h) — поле под него.
  const region = (cx, top, w, h) => {
    g.textAlign = 'center';
    g.font = `bold ${h * 0.5}px ${PLATE_FONT}`;
    g.fillText('18', cx, top + h * 0.38, w - 30);
    g.font = `bold ${h * 0.2}px sans-serif`;
    const fy = top + h * 0.8, fw = w * 0.24, fh = h * 0.13, fx = cx + w * 0.12;
    g.textAlign = 'right';
    g.fillText('RUS', fx - 8, fy);
    ['#fff', '#1c57b8', '#d52b1e'].forEach((col, i) => { g.fillStyle = col; g.fillRect(fx, fy - fh / 2 + (i * fh) / 3, fw, fh / 3); });
    g.strokeStyle = '#111'; g.lineWidth = 2; g.strokeRect(fx, fy - fh / 2, fw, fh);
    g.fillStyle = '#111';
  };
  const name = (cx, cy, size, maxW) => {
    g.textAlign = 'center';
    g.font = `bold ${size}px ${PLATE_FONT}`;
    g.fillText(text.toUpperCase(), cx, cy + size * 0.05, maxW); // длинное имя сжимается по ширине
  };
  if (square) {
    name(W / 2, H * 0.3, H * 0.36, W - 50);
    region(W / 2 - W * 0.1, H * 0.5, W * 0.5, H * 0.48);
    return;
  }
  const R = Math.round(W * 0.235), split = W - R;
  g.beginPath(); g.moveTo(split, 8); g.lineTo(split, H - 8); g.stroke();
  name(split / 2, H / 2, H * 0.72, split - 44);
  region(split + R / 2, 0, R, H);
}

// Повесить на машину (buildPlayerModel) номера с текстом или сменить текст.
export function setPlate(model, text) {
  const ud = model.userData;
  if (!ud.plateSpots?.length || ud.plateText === text) return;
  ud.plateText = text;
  if (!ud.plateTex) {
    ud.plateTex = {}; // формат ('long' | 'square') → текстура
    for (const sp of ud.plateSpots) {
      const fmt = sp.w / sp.h < 2.5 ? 'square' : 'long';
      if (!ud.plateTex[fmt]) {
        const cv = document.createElement('canvas');
        [cv.width, cv.height] = fmt === 'square' ? [580, 340] : [1040, 224];
        const tex = (ud.plateTex[fmt] = new THREE.CanvasTexture(cv));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.userData.mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      }
      const n = new THREE.Vector3(...sp.n);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sp.w, sp.h), ud.plateTex[fmt].userData.mat);
      m.position.set(sp.x, sp.y, sp.z).addScaledVector(n, 0.004);
      // Разворот вокруг вертикали к нормали, потом наклон. Не setFromUnitVectors: для нормали назад
      // (поворот на 180°) он крутит вокруг поперечной оси — номер вверх ногами и зеркально.
      m.rotation.order = 'YXZ';
      m.rotation.set(-Math.asin(n.y), Math.atan2(n.x, n.z), 0);
      ud.plateHost.add(m);
    }
  }
  for (const [fmt, tex] of Object.entries(ud.plateTex)) {
    drawPlate(tex.image, text, fmt === 'square');
    tex.needsUpdate = true;
  }
}

// Освободить текстуры номеров (машину убрали со сцены).
export function disposePlates(model) {
  for (const tex of Object.values(model.userData.plateTex ?? {})) { tex.userData.mat.dispose(); tex.dispose(); }
}
