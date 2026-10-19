// Аккаунт по почте (Firebase Auth, вход по ссылке из письма, без пароля): прогресс — деньги, купленные детали,
// машина, рекорды — хранится в users/<uid>/progress (Realtime Database) и приезжает на другом устройстве.
// Отдельное приложение Firebase ('account') с постоянным входом: у мультиплеера (net.js) свой анонимный вход на
// вкладку. Без входа всё как раньше — только в этом браузере.
// Слияние при входе: в аккаунте уже есть прогресс — берём его деньги и машину, детали — объединяем; нет — заливаем свой.
// Нужно включить в консоли Firebase: Authentication → Email link (passwordless), домены — в Authorized domains.
import { firebaseConfig, FIREBASE_SDK } from './firebase-config.js';

const SAVE_DELAY = 3000; // мс: копим изменения перед записью
const LINK_PARAMS = ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'signin'];

export class Account {
  // wallet — кошелёк (money.js); vehicle() / setVehicle(v) — выбор гаража { model, color, options };
  // onChange — изменилось состояние (для меню).
  constructor({ wallet, vehicle, setVehicle, onChange }) {
    Object.assign(this, { wallet, vehicle, setVehicle, onChange });
    this.status = 'out'; // out | loading | sent | in | error
    this.email = null;
    this.error = null;
    let remembered = false;
    try { remembered = !!localStorage.getItem('account'); } catch {}
    // Вошли раньше или пришли по ссылке из письма — подключаемся сразу, иначе — когда откроют страницу аккаунта.
    if (remembered || new URLSearchParams(location.search).has('oobCode')) this.start();
  }

  start() {
    this.ready ??= this.#init().catch((e) => {
      console.warn('[account]', e);
      this.#set('error', 'Нет связи с сервером');
    });
    return this.ready;
  }

  async #init() {
    const [{ initializeApp }, auth, db] = await Promise.all(['app', 'auth', 'database'].map((m) => import(`${FIREBASE_SDK}/firebase-${m}.js`)));
    const app = initializeApp(firebaseConfig, 'account');
    this.fb = { ...auth, ...db };
    this.auth = auth.initializeAuth(app, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence] });
    this.db = db.getDatabase(app);
    // Пришли по ссылке из письма — входим; почту помним с отправки (другое устройство — спросим).
    if (auth.isSignInWithEmailLink(this.auth, location.href)) {
      let email = null;
      try { email = localStorage.getItem('signinEmail'); } catch {}
      email ||= prompt('Почта, на которую пришла ссылка для входа:');
      const url = new URL(location.href);
      for (const k of LINK_PARAMS) url.searchParams.delete(k);
      const link = location.href;
      history.replaceState(null, '', url);
      if (email) {
        this.#set('loading');
        await auth.signInWithEmailLink(this.auth, email, link).catch((e) => this.#set('error', linkError(e)));
      }
    }
    auth.onAuthStateChanged(this.auth, (user) => this.#user(user));
  }

  async #user(user) {
    this.user = user;
    if (!user || user.isAnonymous) {
      try { localStorage.removeItem('account'); } catch {}
      if (this.status === 'in') this.#set('out');
      return;
    }
    this.email = user.email;
    try { localStorage.setItem('account', user.email); localStorage.removeItem('signinEmail'); } catch {}
    this.#set('loading');
    const { ref, get } = this.fb;
    const snap = await get(ref(this.db, `users/${user.uid}/progress`)).catch(() => null);
    const saved = snap?.val();
    if (saved) {
      this.wallet.restore(saved);
      if (saved.vehicle) this.setVehicle(saved.vehicle);
      try {
        for (const [k, v] of Object.entries(saved.best || {})) {
          const mine = parseFloat(localStorage.getItem(k));
          if (!(mine <= v)) localStorage.setItem(k, String(v));
        }
      } catch {}
    }
    this.#set('in');
    this.save(0); // своё (и слитое) — в аккаунт
  }

  // Отправить письмо со ссылкой для входа.
  async send(email) {
    email = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return this.#set('error', 'Похоже, в почте опечатка');
    this.#set('loading');
    await this.start();
    if (!this.auth) return;
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('signin', '1');
    try {
      await this.fb.sendSignInLinkToEmail(this.auth, email, { url: url.href, handleCodeInApp: true });
      try { localStorage.setItem('signinEmail', email); } catch {}
      this.email = email;
      this.#set('sent');
    } catch (e) {
      this.#set('error', linkError(e));
    }
  }

  async signOut() {
    if (!this.auth) return;
    await this.save(0);
    await this.fb.signOut(this.auth);
  }

  // Записать прогресс в аккаунт (не чаще раза в SAVE_DELAY, ms = 0 — сразу).
  save(ms = SAVE_DELAY) {
    if (this.status !== 'in' || !this.user) return Promise.resolve();
    clearTimeout(this.timer);
    return new Promise((resolve) => {
      this.timer = setTimeout(() => {
        const best = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith('best_')) best[k] = parseFloat(localStorage.getItem(k));
          }
        } catch {}
        const { ref, set, serverTimestamp } = this.fb;
        set(ref(this.db, `users/${this.user.uid}/progress`), { ...this.wallet.snapshot(), vehicle: this.vehicle(), best, t: serverTimestamp() })
          .catch((e) => console.warn('[account] не сохранилось:', e))
          .finally(resolve);
      }, ms);
    });
  }

  #set(status, error = null) {
    this.status = status;
    this.error = error;
    this.onChange();
  }
}

function linkError(e) {
  const code = e?.code || '';
  if (code.includes('invalid-email')) return 'Похоже, в почте опечатка';
  if (code.includes('expired') || code.includes('invalid-action-code')) return 'Ссылка устарела — пришлём новую';
  if (code.includes('operation-not-allowed')) return 'Вход по почте ещё не включён';
  if (code.includes('quota') || code.includes('too-many')) return 'Слишком много писем — попробуйте позже';
  return 'Не получилось — попробуйте ещё раз';
}
