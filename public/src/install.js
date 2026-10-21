// Установка как приложения (manifest.webmanifest). Chrome и Edge отдают своё окно установки через
// beforeinstallprompt — ловим его сразу при загрузке модуля, кнопка появится позже, на экране «Поехали».
// У iPhone такого API нет: только подсказка «Поделиться → На экран Домой».

let deferred = null;
const listeners = new Set();
const changed = () => listeners.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; changed(); });
addEventListener('appinstalled', () => { deferred = null; installed = true; changed(); });

let installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export const install = {
  get available() { return !installed && (!!deferred || ios); },
  // true — окно установки показано, 'ios' — показать подсказку.
  async prompt() {
    if (!deferred) return ios ? 'ios' : false;
    const e = deferred;
    deferred = null;
    e.prompt();
    const { outcome } = await e.userChoice;
    changed();
    return outcome === 'accepted';
  },
  onChange(f) { listeners.add(f); },
};
