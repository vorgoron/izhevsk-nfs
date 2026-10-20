// Автосалон: что продаётся — машины, улучшения (двигатель, шины) и системы (нитро, «Кузнечик» — струи для трюков).
// В начале игры есть только базовая машина (DEFAULT_MODEL) без допов, остальное покупается в гараже (garage.js).
// Купленное — ключи в кошельке (money.js): `car:<машина>`, `<машина>:up:<улучшение>:<уровень>`. Улучшения ставятся
// на машину: у новой машины — снова штатные. Уровни покупаются по порядку, стоит самый высокий купленный.
import { MODELS } from './vehicles.js';

// levels: [название, цена ₽, что даёт]; эффект уровня — в tuned().
export const UPGRADES = [
  { key: 'engine', name: 'Двигатель', levels: [['I', 8000, 'форсировка I: +5 % скорости, +7 % разгона'], ['II', 18000, 'форсировка II: +10 % скорости, +14 % разгона'], ['III', 35000, 'форсировка III: +15 % скорости, +21 % разгона']] },
  { key: 'tires', name: 'Шины', levels: [['спортивные', 6000, '+5 % сцепления'], ['полуслики', 14000, '+10 % сцепления']] },
  { key: 'nitro', name: 'Нитро', levels: [['баллон', 10000, 'Shift — закись азота: +30 % скорости, баллон сам наполняется за ~17 с'], ['двойной баллон', 22000, 'горит в полтора раза дольше, наполняется быстрее']] },
  { key: 'hopper', name: '«Кузнечик»', levels: [['Кузнечик', 15000, 'струи на днище: kickflip, backflip, бочка, посадка на крыши'], ['Кузнечик-М', 30000, 'подскок выше в полтора раза — до крыш пятиэтажек']] },
];

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

// Характеристики машины с улучшениями — для физики (Car.setModel): nitro и hopper — уровни систем.
export function tuned(wallet, model) {
  const s = MODELS[model].stats, lv = (k) => upLevel(wallet, model, k);
  const e = lv('engine'), t = lv('tires');
  return { ...s, kmh: s.kmh * (1 + 0.05 * e), accel: s.accel * (1 + 0.07 * e), grip: s.grip * (1 + 0.05 * t), nitro: lv('nitro'), hopper: lv('hopper') };
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
