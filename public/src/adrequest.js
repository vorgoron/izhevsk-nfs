// Заявка на рекламу на щитах (меню → «Реклама на щитах», щит «Место свободно»): запись в Realtime Database
// adRequests/<push id> { who, contact, what, t }. Читать заявки может только владелец проекта (консоль Firebase) —
// правило на чтение не дано. Firebase грузится только при отправке: отдельное приложение 'ads' с анонимным входом
// в памяти (в общем городе SDK мультиплеера не загружен).
import { firebaseConfig, FIREBASE_SDK } from './firebase-config.js';

export const AD_LIMITS = { who: 80, contact: 80, what: 1000 };

let ready = null;
async function connect() {
  const [{ initializeApp }, auth, db] = await Promise.all(
    ['app', 'auth', 'database'].map((m) => import(`${FIREBASE_SDK}/firebase-${m}.js`)));
  const app = initializeApp(firebaseConfig, 'ads');
  await auth.signInAnonymously(auth.initializeAuth(app, { persistence: auth.inMemoryPersistence }));
  return { db, base: db.getDatabase(app) };
}

// fields — { who, contact, what }; обрезаются до AD_LIMITS. Ошибка — исключение.
export async function sendAdRequest(fields) {
  ready ??= connect().catch((e) => { ready = null; throw e; });
  const { db, base } = await ready;
  const v = Object.fromEntries(Object.entries(AD_LIMITS).map(([k, n]) => [k, String(fields[k] ?? '').trim().slice(0, n)]));
  if (!v.what) delete v.what;
  await db.push(db.ref(base, 'adRequests'), { ...v, t: db.serverTimestamp() });
}
