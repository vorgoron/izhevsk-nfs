// Google Analytics через Firebase (проект izh-car): просмотры страницы считаются сами, свои события — track().
// SDK грузится в фоне и не мешает игре: не загрузился (блокировщик, нет связи) — события просто теряются.
// Локально не считаем, чтобы проверки не попадали в статистику.
import { firebaseConfig, FIREBASE_SDK } from './firebase-config.js';

const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
let log = null; // (name, params) => void, когда SDK загружен
const queue = []; // события до загрузки SDK

if (!local) {
  Promise.all(['app', 'analytics'].map((m) => import(`${FIREBASE_SDK}/firebase-${m}.js`)))
    .then(async ([{ initializeApp }, an]) => {
      if (!(await an.isSupported())) return;
      // То же приложение, что в net.js: initializeApp с тем же конфигом возвращает уже созданное.
      const analytics = an.getAnalytics(initializeApp(firebaseConfig));
      log = (name, params) => an.logEvent(analytics, name, params);
      for (const [name, params] of queue.splice(0)) log(name, params);
    })
    .catch(() => {});
}

export function track(name, params) {
  if (local) return;
  if (log) log(name, params); else if (queue.length < 50) queue.push([name, params]);
}
