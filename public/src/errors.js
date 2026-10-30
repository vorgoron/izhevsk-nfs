// Ошибки в проде: в консоль и в аналитику (событие js_error), чтобы о них узнавать, а не ждать жалоб.
// Одна и та же ошибка уходит один раз, всего — не больше MAX за заход (ошибка в каждом кадре не зальёт статистику).
// guard(fn) — для цикла кадров: исключение в нём у three.js останавливает setAnimationLoop навсегда, игра замирает.
import { track } from './analytics.js';

const MAX = 10;
const seen = new Set();

export function reportError(e, where = '') {
  const msg = String(e?.message ?? e ?? 'unknown');
  const key = `${where}|${msg}`;
  if (seen.has(key)) return;
  console.error(`[${where || 'error'}]`, e);
  if (seen.size >= MAX) return;
  seen.add(key);
  // Первая строка стека с файлом и строкой — без неё по сообщению «x is undefined» место не найти.
  const at = String(e?.stack ?? '').split('\n').find((l) => /\.js:\d+/.test(l))?.trim().replace(/^at\s+/, '') ?? '';
  track('js_error', { where, msg: msg.slice(0, 100), at: at.slice(-100) });
}

export const guard = (fn, where) => (...a) => {
  try { fn(...a); } catch (e) { reportError(e, where); }
};

addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'));
addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
