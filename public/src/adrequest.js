// Заявка на рекламу на щитах (меню → «Реклама на щитах», щит «Место свободно»): запись в Realtime Database
// adRequests/<push id> { who, contact, phone?, what?, t }. Читать заявки может только владелец проекта (консоль Firebase) —
// правило на чтение не дано. Firebase грузится только при отправке: отдельное приложение 'ads' с анонимным входом
// в памяти (в общем городе SDK мультиплеера не загружен).
import { firebaseConfig, FIREBASE_SDK } from './firebase-config.js';

export const AD_LIMITS = { who: 80, contact: 80, phone: 30, what: 1000 };

// Контакт для связи — обязательно почта, Telegram (@имя, t.me/имя) или ВКонтакте (vk.com/…); телефон — по желанию.
const CONTACT = [
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /^(@|(https?:\/\/)?(t\.me|telegram\.me)\/)[a-z0-9_]{4,32}$/i,
  /^(https?:\/\/)?(m\.)?vk\.(com|ru)\/[a-z0-9_.]{2,}\/?$/i,
];
export const validContact = (s) => CONTACT.some((re) => re.test(s.trim()));

let ready = null;
async function connect() {
  const [{ initializeApp }, auth, db] = await Promise.all(
    ['app', 'auth', 'database'].map((m) => import(`${FIREBASE_SDK}/firebase-${m}.js`)));
  const app = initializeApp(firebaseConfig, 'ads');
  await auth.signInAnonymously(auth.initializeAuth(app, { persistence: auth.inMemoryPersistence }));
  return { db, base: db.getDatabase(app) };
}

// fields — { who, contact, phone, what }; обрезаются до AD_LIMITS, пустые необязательные не пишутся. Ошибка — исключение.
export async function sendAdRequest(fields) {
  ready ??= connect().catch((e) => { ready = null; throw e; });
  const { db, base } = await ready;
  const v = Object.fromEntries(Object.entries(AD_LIMITS).map(([k, n]) => [k, String(fields[k] ?? '').trim().slice(0, n)]));
  for (const k of ['phone', 'what']) if (!v[k]) delete v[k];
  await db.push(db.ref(base, 'adRequests'), { ...v, t: db.serverTimestamp() });
}
