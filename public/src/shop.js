// Автосалон: что продаётся — машины, улучшения (двигатель, шины) и системы (нитро, «Кузнечик» — струи для трюков).
// В начале игры есть только базовая машина (DEFAULT_MODEL) без допов, остальное покупается в гараже (garage.js).
// Купленное — ключи в кошельке (money.js): `car:<машина>`, `<машина>:up:<улучшение>:<уровень>`. Улучшения ставятся
// на машину: у новой машины — снова штатные. Уровни покупаются по порядку, стоит самый высокий купленный.
import { MODELS } from './vehicles.js';

// levels: [название, цена ₽, что даёт]; эффект уровня — в tuned().
export const UPGRADES = [
  { key: 'engine', name: 'Двигатель', levels: [['I', 8000, 'форсировка I: +7 % скорости, до 100 км/ч на 20 % быстрее'], ['II', 18000, 'форсировка II: +15 % скорости, до 100 км/ч на 38 % быстрее'], ['III', 35000, 'форсировка III: +25 % скорости, до 100 км/ч вдвое быстрее']] },
  { key: 'tires', name: 'Шины', levels: [['спортивные', 6000, '+12 % сцепления'], ['полуслики', 14000, '+25 % сцепления']] },
  { key: 'nitro', name: 'Нитро', levels: [['баллон', 10000, 'Shift — закись азота: +30 % скорости, баллон сам наполняется за ~17 с'], ['двойной баллон', 22000, 'горит в полтора раза дольше, наполняется быстрее']] },
  { key: 'hopper', name: '«Кузнечик»', levels: [['Кузнечик', 15000, 'струи на днище: kickflip, backflip, бочка, посадка на крыши'], ['Кузнечик-М', 30000, 'подскок выше в полтора раза — до крыш пятиэтажек']] },
  // Полный привод — только у «Оды» (only): по траве, грунту и грязи теряет втрое меньше (AWD_OFF в car.js).
  { key: 'awd', name: 'Привод', only: ['oda'], levels: [['4×4', 25000, 'полный привод: по траве, грунту и грязи почти как по асфальту']] },
];
export const upgradesFor = (model) => UPGRADES.filter((u) => !u.only || u.only.includes(model));

export const carKey = (model) => `car:${model}`;
export const upKey = (model, up, level) => `${model}:up:${up}:${level}`;
export const carPrice = (model) => MODELS[model]?.price ?? 0;
export const ownsCar = (wallet, model) => !carPrice(model) || wallet.owns(carKey(model));

// Стоящий уровень улучшения: 0 — нет, 1.. — номер купленного.
export function upLevel(wallet, model, up) {
  const spec = UPGRADES.find((u) => u.key === up);
  let n = 0;
  while (n < spec.levels.length && wallet.owns(upKey(model, up, n + 1))) n++;
  return n;
}

// Штатно машина заводская (MODELS[].stats — паспорт), только разгон в игре бодрее паспортного (PACE: Москвич
// 19 → 12,4 с до 100, Веста 11,8 → 7,7 с). Улучшения по уровням: максималка ×, время до 100 км/ч ×, сцепление ×.
// Двигатель III — до 100 вдвое быстрее штатного.
const PACE = 0.65;
const ENGINE = [[1, 1], [1.07, 0.8], [1.15, 0.62], [1.25, 0.5]], TIRES = [1, 1.12, 1.25];

// Характеристики машины с улучшениями — для физики (Car.setModel): nitro и hopper — уровни систем; engine и tires —
// уровни улучшений, для вида (setGear в vehicles.js). accel — для полосы в гараже (10 / t100).
export function tuned(wallet, model) {
  const lv = (k) => wallet ? upLevel(wallet, model, k) : 0;
  const s = MODELS[model].stats, e = lv('engine'), t = lv('tires'), t100 = s.t100 * PACE * ENGINE[e][1];
  return { ...s, kmh: s.kmh * ENGINE[e][0], t100, accel: 10 / t100, grip: s.grip * TIRES[t], nitro: lv('nitro'), hopper: lv('hopper'), awd: lv('awd'), engine: e, tires: t };
}

// Автосалон появился позже денег: у кого кошелёк уже был, тому — машина, на которой ездил, с нитро и «Кузнечиком»,
// чтобы обновление ничего не отняло. Один раз (флаг в localStorage).
export function grandfather(wallet, model) {
  try {
    if (localStorage.getItem('shop')) return;
    localStorage.setItem('shop', '1');
  } catch { return; }
  if (wallet.fresh) return;
  wallet.grant([...(carPrice(model) ? [carKey(model)] : []), upKey(model, 'nitro', 1), upKey(model, 'hopper', 1)]);
}
