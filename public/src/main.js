import * as THREE from 'three';
import { World } from './world.js';
import { MINIMAP_SCALE } from './build.js';
import { ChunkManager, MinimapTiles } from './chunks.js';
import { Car } from './car.js';
import { MODELS, buildPlayerModel, loadVehicleMeshes, setPlate, disposePlates, setGear } from './vehicles.js';
import { Garage, loadChoice, defaultChoice, optionKey } from './garage.js';
import { tuned, ownsCar, grandfather } from './shop.js';
import { paintOf, paintKey } from './paints.js';
import { Race, formatTime, LENGTHS } from './race.js';
import { Ramps } from './ramps.js';
import { Boundary } from './boundary.js';
import { Pickups, NITRO_GIVE } from './pickups.js';
import { buildLandmarks } from './landmarks.js';
import { planFootbridges, buildFootbridges } from './footbridges.js';
import { Sound } from './audio.js';
import { Radio, STATIONS } from './radio.js';
import { Wheel } from './wheel.js';
import { Traffic } from './traffic.js';
import { Signals } from './signals.js';
import { Breakables } from './breakables.js';
import { Sky, HORIZON } from './sky.js';
import { DayNight } from './night.js';
import { Fuel } from './fuel.js';
import { Queues } from './queues.js';
import { Trams } from './trams.js';
import { NitroFX, JetFX, DustFX, ExhaustFX, SkidMarksFX, TireSmokeFX } from './effects.js';
import { GhostFX } from './ghostfx.js';
import { sendAdRequest } from './adrequest.js';
import { isTouch, setupTouch, toggleFullscreen } from './touch.js';
import { install } from './install.js';
import { Menu } from './menu.js';
import { createPerf } from './perf.js';
import { createDebug } from './debug.js';
import { Net, CITY } from './net.js';
import { track } from './analytics.js';
import { Wallet, PRICES, raceReward, speedingFine, formatMoney } from './money.js';
import { Cameras } from './cameras.js';
import { StopSigns } from './yields.js';
import { Taxi } from './taxi.js';
import { Drift } from './drift.js';
import { RouteGuide } from './guide.js';
import { CityMap } from './citymap.js';
import { Gauges } from './gauges.js';
import { Account } from './account.js';
import { CLEAR_ALT } from './car.js';

const CAM_CONE = 100, CAM_SPREAD = 0.55; // миникарта: длина конуса камеры (м) и его полуугол (рад)
const FINISH_BIG = 3000; // мс: столько «ФИНИШ» крупно по центру, потом — мельче и наверх, чтобы не мешал ехать
const $ = (id) => document.getElementById(id);
const status = (t) => { $('loading-text').textContent = t; };
// Полоса загрузки: доля 0…1 и, если есть, подпись этапа.
const progress = (p, t) => {
  $('loading-fill').style.width = `${(p * 100).toFixed(1)}%`;
  if (t) status(t);
};
// Дать браузеру нарисовать кадр: продолжение после rAF + setTimeout идёт уже после отрисовки
// (сразу в колбэке rAF тяжёлая работа задержала бы и сам кадр с новой подписью).
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
// Этапы загрузки, мс: stage(name) закрывает прошлый этап и открывает новый, stage() — только закрывает.
// Итог — строка `[load]` в консоли, window.loadTimes (CDP) и блок «загрузка» в `?perf`.
const loadTimes = [{ name: 'до старта модуля', ms: Math.round(performance.now()) }];
let stageAt = performance.now(), stageName = null;
function stage(name, note) {
  const t = performance.now();
  if (stageName) loadTimes.push({ name: stageName, ms: Math.round(t - stageAt), ...(note && { note }) });
  stageName = name;
  stageAt = t;
}

// city.json (~13 МБ) читаем потоком, чтобы показывать скачанное. Под gzip Content-Length — сжатый
// размер, а поток отдаёт распакованные байты, поэтому тогда размер неизвестен (total = 0).
async function fetchJSON(url, onBytes) {
  stage('скачивание');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body) return res.json();
  const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes(got, total);
  }
  // got — распакованные байты; сжатый размер под gzip/br отсюда не виден.
  stage('разбор', `${(got / 1024 / 1024).toFixed(1)} МБ без сжатия`);
  const data = JSON.parse(await new Blob(parts).text());
  stage();
  return data;
}
// Отладочные ключи в адресе (белый экран на Android): ?lite — проще графика, ?nohud — без HTML
// поверх канваса, ?lowpower — слабый GPU, ?noaa / ?aa — сглаживание.
const flags = new URLSearchParams(location.search);
const lite = flags.has('lite');

// Уровни графики: меню «Графика», `?q=high|medium|low`, localStorage.quality; меняются на лету (setQuality),
// кроме неба (число шагов облаков — при постройке).
// На телефоне кадр упирается в процессор — в число вызовов отрисовки и треугольников, поэтому главное —
// дальность (туман, квадраты города, мелочи, трафик), а не разрешение. fog — множитель дальности тумана,
// дальняя плоскость камеры — по его концу (цикл ниже).
const QUALITY = {
  high: { label: 'высокая', px: 2, shadow: 2048, fog: 1, radius: 1800, tex: 1024, treeNear: 450, detailFar: Infinity, carsFar: 300 },
  medium: { label: 'средняя', px: 1, shadow: 1024, fog: 0.6, radius: 1000, tex: 512, treeNear: 250, detailFar: 300, carsFar: 220 },
  // treeNear −1 — деревья всегда простые: подробность меняется на весь квадрат 510 м, и вблизи все ~1000 деревьев
  // квадрата шли по 400–580 треугольников (на слабом телефоне — 0,3 млн из 0,6).
  low: { label: 'низкая', px: 0.75, shadow: 0, fog: 0.4, radius: 700, tex: 256, treeNear: -1, detailFar: 180, carsFar: 150 },
};
let qChosen = flags.get('q');
try { qChosen = QUALITY[qChosen] ? qChosen : localStorage.getItem('quality'); } catch {}
let qName = lite ? 'low' : QUALITY[qChosen] ? qChosen : isTouch ? 'medium' : 'high';
let Q = QUALITY[qName];
if (flags.has('nohud')) document.documentElement.classList.add('nohud');

async function main() {
  // Доли этапов на полосе: скачивание — до 55 %, постройка мира — до 70 %, квадраты города — до 95 %.
  progress(0, 'Загружаю карту…');
  const vehiclesReady = loadVehicleMeshes(); // параллельно с картой
  const MB = 1024 * 1024;
  const city = await fetchJSON('city.json', (got, total) => {
    // Размер неизвестен — полоса ползёт к концу этапа асимптотически.
    const f = total ? got / total : 1 - Math.exp(-got / (6 * MB));
    const mb = total ? `${(got / MB).toFixed(1)} / ${(total / MB).toFixed(1)} МБ` : `${(got / MB).toFixed(1)} МБ`;
    progress(0.55 * f, `Загружаю карту… ${mb}`);
  });
  progress(0.58, 'Строю рельеф и дороги…');
  await frame();
  stage('рельеф и дороги');

  // На телефоне экономим: без MSAA, плотность пикселей не выше 1.5, тени мельче.
  const renderer = new THREE.WebGLRenderer({
    antialias: flags.has('aa') || (!isTouch && !flags.has('noaa')),
    powerPreference: flags.has('lowpower') ? 'low-power' : 'default',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.px));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = Q.shadow > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color(HORIZON); // туман = цвет горизонта неба (sky.js)
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 250 * Q.fog, 1600 * Q.fog);
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 4000);

  const hemi = new THREE.HemisphereLight('#dfe9f5', '#5a5444', 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(Q.shadow || 512);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 600 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const SUN_DIR = new THREE.Vector3(-0.5, 0.8, 0.35).normalize();

  const world = new World(city);
  planFootbridges(world); // насыпи у мостов меняют рельеф — до постройки мешей
  world.buildGraph();
  progress(0.66, 'Ставлю мосты и достопримечательности…');
  await frame();
  stage('мосты и достопримечательности');
  // Город строится квадратами вокруг игрока (chunks.js); на телефоне — ближе и проще.
  const chunks = new ChunkManager(world, scene, renderer, { radius: Q.radius, texSize: Q.tex, treeNear: Q.treeNear, detailFar: Q.detailFar });
  // Подписи для разбивки треугольников в `?perf`: всё, что добавила в сцену make(), — под label.
  const owned = (label, make) => {
    const n = scene.children.length, r = make();
    for (const o of scene.children.slice(n)) o.userData.perf = label;
    return r;
  };
  // Столбы, щиты (из квадратов) и светофоры ломаются от удара.
  const breakables = owned('обломки', () => new Breakables(world, scene));
  chunks.breakables = breakables;
  const footbridges = buildFootbridges(world, new THREE.MeshLambertMaterial({ color: '#9a968e' }));
  footbridges.userData.perf = 'мосты';
  scene.add(footbridges);
  const landmarks = buildLandmarks(world);
  landmarks.group.userData.perf = 'достопримечательности';
  scene.add(landmarks.group);
  const minimap = new MinimapTiles(world);

  // Своя машина: выбор из гаража (localStorage), по умолчанию — стартовая (Москвич-412).
  await vehiclesReady;
  let choice = loadChoice();
  // Деньги (money.js). Детали, выбранные до появления денег, считаются купленными; машина, на которой ездили
  // до автосалона, — тоже, с нитро и «Кузнечиком» (shop.js). Не своя машина (вышли из аккаунта) — стартовая.
  const wallet = new Wallet($('money'), $('money-log'));
  // Покрытие кузова (paints.js) — своё на каждую машину; обычный цвет — у всех.
  const ownsPaint = ({ model, color }) => !paintOf(color) || wallet.owns(paintKey(model, color));
  if (wallet.fresh) {
    wallet.grant((MODELS[choice.model].options || []).map((o) => optionKey(choice.model, o.key, choice.options[o.key])));
  }
  grandfather(wallet, choice.model);
  if (!ownsCar(wallet, choice.model)) choice = { ...defaultChoice(), saved: choice.saved };
  if (!ownsPaint(choice)) choice = { ...choice, color: MODELS[choice.model].colors[0] };
  const model = buildPlayerModel(choice.model, choice.color, choice.options);
  model.userData.perf = 'машина игрока';
  scene.add(model);
  const car = new Car(world, model, tuned(wallet, choice.model));
  // Тюнинг на машине: в гараже — и то, что в корзине, в городе — купленное.
  const showGear = (g) => setGear(car.model, g.isOpen ? g.gear() : tuned(wallet, g.choice.model));
  const setVehicle = (key, color, options) => {
    scene.remove(car.model);
    car.model.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    disposePlates(car.model);
    const m = buildPlayerModel(key, color, options);
    setPlate(m, net.name);
    m.userData.perf = 'машина игрока';
    scene.add(m);
    car.setModel(m, tuned(wallet, key));
    showGear(garage);
    net.setVehicle(key, color, options);
    net.setGear(tuned(wallet, key)); // другим игрокам — только купленное
    nitroFx.attach(m);
    jetFx.attach(m);
    exhaustFx.attach(m);
    car.update(0, {}); // поставить новую модель на место старой
  };
  const nitroFx = owned('эффекты', () => new NitroFX(scene));
  const jetFx = owned('эффекты', () => new JetFX(scene));
  const dustFx = owned('эффекты', () => new DustFX(scene));
  const skidFx = owned('эффекты', () => new SkidMarksFX(scene, world));
  const tireSmokeFx = owned('эффекты', () => new TireSmokeFX(scene));
  const exhaustFx = owned('эффекты', () => new ExhaustFX(scene));
  const ghostFx = new GhostFX(scene, world); // эффекты чужих машин — по мере появления игроков
  exhaustFx.attach(car.model);
  nitroFx.attach(car.model);
  jetFx.attach(car.model);
  const race = new Race(world, scene);
  const ramps = owned('трамплины', () => new Ramps(world, scene));
  const boundary = owned('край карты', () => new Boundary(world, scene));
  const pickups = owned('бонусы гонки', () => new Pickups(world, scene));
  car.ramp = (x, z, y, fx, fz) => ramps.at(x, z, y, fx, fz);
  // Догонялка в общей гонке: отставшему на CATCH_UP м и больше нитро наполняется вдвое быстрее.
  const CATCH_UP = 300;
  race.onBegin = () => { ramps.set(race); pickups.set(race, ramps.dists); };
  const guide = owned('стрелки', () => new RouteGuide(world, scene));
  let navRoute = null; // маршрут до точки на большой карте (citymap.js)

  // Старт у Центральной площади; в общем городе — там, где уехал в прошлый раз (localStorage 'pos', пишет savePos).
  // По ссылке друга — у площади, как и он: иначе не встретиться. heading — повернуть по дороге в ту же сторону.
  const spawn = world.nearestRoad(0, 0, 400);
  const respawnAt = (x, z, heading) => {
    const r = world.nearestRoad(x, z, 500);
    if (!r) return car.place(x, z, heading ?? 0);
    const s = r.seg;
    let h = Math.atan2(s.bx - s.ax, s.bz - s.az);
    if (heading != null && Math.cos(h - heading) < 0) h += Math.PI;
    car.place(r.px, r.pz, h);
  };
  const respawnHome = () => respawnAt(spawn ? spawn.px : 0, spawn ? spawn.pz : 0);
  let lastPos = null;
  try {
    const p = JSON.parse(localStorage.getItem('pos'));
    if (!new URLSearchParams(location.search).has('room') && [p?.x, p?.z, p?.h].every(Number.isFinite) && world.nearestRoad(p.x, p.z, 500)) lastPos = p;
  } catch {}
  if (lastPos) respawnAt(lastPos.x, lastPos.z, lastPos.h); else respawnHome(); // гонки нет — свободная езда, гонка — по кнопке (N)
  // Место пишем раз в POS_EVERY с и при уходе со страницы; в воде и в прыжке — последнюю точку на суше.
  const POS_EVERY = 5;
  let posT = 0, posReady = false; // до «Поехали» машина стоит, где поставили, — не пишем
  const savePos = () => {
    if (!posReady) return;
    const p = car.air || car.sink ? car.dry : car.pos;
    try { localStorage.setItem('pos', JSON.stringify({ x: Math.round(p.x), z: Math.round(p.y), h: +car.heading.toFixed(2) })); } catch {}
  };
  addEventListener('pagehide', savePos);
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(); });
  progress(0.7, 'Строю город вокруг…');
  await frame();
  stage('квадраты города');
  const pre = await chunks.preload(car.pos.x, car.pos.y, 900, (f) => progress(0.7 + 0.25 * f));
  stage(null, `${pre.n} шт., сама постройка ${Math.round(pre.ms)} мс`);
  progress(0.95, 'Трафик, заправки, светофоры…');
  await frame();
  stage('трафик, светофоры, HUD и прочее');
  const skyDome = owned('небо', () => new Sky(scene, { low: qName !== 'high' || isTouch }));
  // Ночь: фары своей машины — прожектор без теней (днём выключен, см. DayNight).
  const headlight = new THREE.SpotLight('#ffeccc', 0, 90, 0.62, 0.55, 1.1);
  scene.add(headlight, headlight.target);
  const dayNight = new DayNight({ scene, hemi, sun, dir: SUN_DIR, sky: skyDome, ads: chunks.mats.ads, headlight, fogScale: Q.fog });
  const HEAD_POS = new THREE.Vector3(), HEAD_AIM = new THREE.Vector3();
  const fuel = owned('заправки', () => new Fuel(world, scene));
  const queues = owned('очереди', () => new Queues(world, fuel, scene));
  const traffic = owned('трафик', () => new Traffic(world, scene));
  traffic.drawFar = Q.carsFar;
  // Сменить уровень графики на ходу: квадраты текстур рельефа и радиус — для новых квадратов, остальное сразу.
  const setQuality = (name) => {
    if (name === qName || !QUALITY[name]) return;
    qName = name;
    Q = QUALITY[name];
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.px));
    renderer.setSize(innerWidth, innerHeight);
    if (renderer.shadowMap.enabled !== Q.shadow > 0) {
      renderer.shadowMap.enabled = Q.shadow > 0;
      // Тени включены в шейдер — материалы пересобрать (разовая заминка).
      scene.traverse((o) => { for (const m of [o.material].flat()) if (m) m.needsUpdate = true; });
    }
    if (Q.shadow && sun.shadow.mapSize.x !== Q.shadow) {
      sun.shadow.mapSize.setScalar(Q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    Object.assign(chunks, { radius: Q.radius, texSize: Q.tex, treeNear: Q.treeNear, detailFar: Q.detailFar });
    traffic.drawFar = Q.carsFar;
    dayNight.setFogScale(Q.fog);
  };
  const signals = owned('светофоры', () => new Signals(world, traffic, scene));
  breakables.addSignals(signals);
  const cameras = owned('камеры', () => new Cameras(world, signals, scene));
  breakables.addCameras(cameras);
  traffic.reset(car.pos.x, car.pos.y);
  // Сменил машину — гонка с начала (честно); первый запуск — в гараж сразу после «Поехали».
  const garage = new Garage(choice, {
    wallet,
    onChange: setVehicle,
    // Улучшение куплено — новые характеристики сразу (модель та же).
    onUpgrade: () => { car.setModel(car.model, tuned(wallet, garage.choice.model)); game.account?.save(); },
    onGear: showGear,
    onClose: (changed) => {
      if (changed) track('car_select', { model: garage.choice.model, color: garage.choice.color });
      if (changed) game.account?.save();
      if (changed && race.restart()) car.place(race.startPose.x, race.startPose.z, race.startPose.heading);
    },
  });
  // Другие игроки: подключение в фоне, без связи игра идёт одна. Меню открыто — обновляем его.
  // На номере своей машины — имя игрока (сменил имя — меняется и номер).
  const net = new Net(scene, choice, () => {
    setPlate(car.model, net.name);
    if (window.game?.menu?.isOpen) game.menu.sync();
  });
  setPlate(car.model, net.name);
  net.setGear(tuned(wallet, choice.model));
  // Общая гонка: новая (ещё до старта) — встаём в сетку; та же — обновились результаты.
  net.onRace = (v) => {
    if (!v) { race.shared = false; return; }
    if (race.shared && v.t === race.startAt) return;
    if (v.t <= net.serverNow()) return; // уже стартовала без нас — ждём следующую
    const order = String(v.o).split(','), i = order.indexOf(net.uid);
    const via = v.w ? String(v.w).split(',').map(Number) : [];
    if (race.startShared({ from: v.a, to: v.b, via, startAt: v.t, slot: i < 0 ? order.length : i, clock: () => net.serverNow() })) {
      if (menu.isOpen) actions.menu();
      car.nitro = 1; car.fuel = Math.max(car.fuel, 0.5);
    }
  };
  // Награда за гонку (money.js): одному — всегда «победа»; в общей — по месту среди уже финишировавших.
  race.onFinish = (t) => {
    track('race_finish', { time: +t.toFixed(2), shared: race.shared });
    if (race.shared) net.finishRace(t);
    const place = race.shared ? 1 + Object.values(net.race?.r ?? {}).filter((x) => x < t).length : 1;
    race.reward = raceReward(race.length, { place, record: race.isRecord && !race.shared });
    wallet.earn(race.reward, race.shared ? `${place}-е место` : race.isRecord ? 'гонка, рекорд' : 'гонка');
  };
  // Список справа — кто в комнате; в общей гонке — по местам: финишировавшие по времени,
  // остальные по проеханному (своё считаем сами, чужое приходит в записи игрока, p).
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const dot = (model, color) => `<i style="background:${color || MODELS[model]?.colors[0] || '#888'}"></i>`;
  let rosterHtml = '';
  const roster = () => {
    let html = '';
    if (net.room !== CITY) {
      const v = net.race, inRace = race.shared && v && v.t === race.startAt;
      const me = { u: net.uid, me: true, name: net.name, model: net.model, color: net.color, p: inRace ? race.progress(car) : 0 };
      let rows = [me, ...[...net.ghosts].filter(([, g]) => !g.stale && g.name)
        .map(([u, g]) => ({ u, name: g.name, model: g.model, color: g.color, p: g.p ?? 0 }))];
      if (inRace) {
        const order = String(v.o).split(','), r = v.r ?? {};
        rows = rows.filter((x) => order.includes(x.u) || x.u in r);
        for (const x of rows) { x.t = r[x.u]; x.slot = order.indexOf(x.u); }
        rows.sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || b.p - a.p || a.slot - b.slot);
        const lead = rows.find((x) => x.t == null)?.p;
        html = `<h4>Гонка · ${rows.length}</h4>` + rows.map((x, k) => `<div${x.me ? ' class="me"' : ''}><span>${k + 1}.</span>${dot(x.model, x.color)}${esc(x.name)}`
          + `<em>${x.t != null ? formatTime(x.t) : race.state === 'countdown' || k === 0 || x.p >= lead ? '' : `−${Math.round(lead - x.p)} м`}</em></div>`).join('');
      } else {
        html = `<h4>Вместе · ${rows.length}</h4>` + rows.map((x) => `<div${x.me ? ' class="me"' : ''}>${dot(x.model, x.color)}${esc(x.name)}${x.me ? '<em>ты</em>' : ''}</div>`).join('');
      }
    }
    if (html !== rosterHtml) { rosterHtml = html; $('roster').innerHTML = html; $('roster').hidden = !html; }
  };
  // Таблица общей гонки: финишировавшие по времени, остальные — «едет».
  const standings = () => {
    const v = net.race;
    if (!race.shared || !v || v.t !== race.startAt) return '';
    const r = v.r ?? {};
    const rows = String(v.o).split(',').filter((u) => u in r || net.ghosts.has(u) || u === net.uid)
      .map((u) => ({ u, t: r[u] })).sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    return rows.map(({ u, t }, k) => `${t != null ? `${k + 1}.` : '·'} ${esc(net.nameOf(u))} — ${t != null ? formatTime(t) : 'едет'}`).join('<br>');
  };
  window.game = { world, car, race, ramps, pickups, boundary, respawnAt, landmarks, traffic, signals, breakables, garage, fuel, queues, chunks, net, dayNight, wallet, cameras, skids: skidFx, tireSmoke: tireSmokeFx, ghostFx }; // для отладки из консоли

  // ---------------------------------------------------------------- ввод

  const sound = new Sound();
  game.sound = sound;
  const trams = owned('трамваи', () => new Trams(world, scene, sound));
  game.trams = trams;
  traffic.trams = trams; // трафик ждёт трамваи, трамваи — трафик на путях
  trams.traffic = traffic;
  // Куда можно сесть после трюка: крыша машины трафика, трамвая или дома под точкой, не выше y + 0.5.
  // Машина и трамвай везут стоящего на них со своей скоростью.
  const TRAM_ROOF = 3.2, TRAM_HALF = [7.4, 1.25];
  car.support = (x, z, y) => {
    let best = null;
    const put = (top, vx, vz, kind, obj) => { if (top <= y + 0.5 && (!best || top > best.y)) best = { y: top, vx, vz, kind, obj }; };
    if (traffic.enabled) {
      for (const v of traffic.vehicles) {
        if (!v.active || Math.abs(v.x - x) > 7 || Math.abs(v.z - z) > 7) continue;
        const rx = x - v.x, rz = z - v.z;
        if (Math.abs(rx * v.dx + rz * v.dz) > v.len / 2 - 0.3 || Math.abs(rz * v.dx - rx * v.dz) > v.half) continue;
        const [vx, vz] = v.knock ? [v.knock.vx, v.knock.vz] : [v.dx * v.speed, v.dz * v.speed];
        put(v.y + v.roof, vx, vz, v.bus ? 'bus' : 'car', v);
      }
    }
    for (const t of trams.near(x, z, 9)) {
      if (t.y === undefined) continue;
      const rx = x - t.x, rz = z - t.z;
      if (Math.abs(rx * t.dx + rz * t.dz) > TRAM_HALF[0] || Math.abs(rz * t.dx - rx * t.dz) > TRAM_HALF[1]) continue;
      put(t.y + TRAM_ROOF, t.dx * t.v, t.dz * t.v, 'tram', t);
    }
    const roof = world.roofAt(x, z, y + 0.5);
    if (roof !== null) put(roof, 0, 0, 'roof', null);
    return best;
  };
  // Радио всегда на экране: станция или приглушённое «Радио выкл»; при переключении надпись вспыхивает.
  let radioName, radioWheel; // барабан создаётся ниже, а onChange зовётся уже здесь
  const radio = new Radio(() => {
    const el = $('radio');
    const extra = radio.started && { loading: ' · подключение…', error: ' · нет связи' }[radio.status] || '';
    el.textContent = radio.name ? `📻 ${radio.name}${extra}` : '📻 Радио выкл';
    el.classList.toggle('error', !!radio.name && radio.status === 'error');
    el.classList.toggle('off', !radio.name);
    if (radio.name !== radioName) {
      radioName = radio.name;
      el.classList.remove('flash');
      void el.offsetWidth; // перезапуск анимации
      el.classList.add('flash');
    }
    radioWheel?.sync();
  });
  radio.setMuted(sound.muted);
  const radioVolume = () => radio.setVolume(sound.vol.master * sound.vol.radio);
  radioVolume();
  game.radio = radio;
  radioName = radio.name; // первый показ — без вспышки
  radio.onChange();
  // Надпись радио открывает барабан станций рядом с собой: над надписью, если она внизу экрана, иначе под ней.
  // Закрывается нажатием мимо, повторным нажатием на надпись или сам через 3 с после выбора.
  radioWheel = new Wheel(STATIONS.map((s) => s.name), {
    get: () => radio.station,
    select: (i) => { radio.select(i); pickClose(); },
  });
  const pick = $('radio-pick');
  pick.append(radioWheel.el);
  let pickTimer = 0;
  const pickClose = (ms = 3000) => { clearTimeout(pickTimer); pickTimer = setTimeout(() => pick.classList.remove('open'), ms); };
  $('radio').addEventListener('click', () => {
    if (pick.classList.toggle('open')) {
      const r = $('radio').getBoundingClientRect();
      const h = pick.offsetHeight, w = pick.offsetWidth;
      pick.style.top = `${r.top > innerHeight / 2 ? r.top - h - 6 : r.bottom + 6}px`;
      pick.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.right - w))}px`;
      radioWheel.show();
      pickClose(6000); // открыли и не крутят — убрать
    }
  });
  addEventListener('pointerdown', (e) => { if (!e.target.closest('#radio-pick, #radio')) pick.classList.remove('open'); });
  pick.addEventListener('scroll', () => pickClose(6000), { capture: true, passive: true }); // пока крутят — не убирать
  // iOS разрешает звук только из обработчика касания/клика. Нажатие на кнопку радио и барабан станций
  // в меню сами решат, что включать, — иначе запомненная станция включится тут и тут же сменится.
  for (const ev of ['pointerdown', 'touchend', 'click']) addEventListener(ev, (e) => {
    sound.unlock();
    if (!e.target.closest?.('.wheel, #radio')) radio.unlock();
  });

  let camMode = 0; // 0 — за машиной, 1 — из салона, 2 — сверху, 3 — кино
  // Предел кадров в секунду, 0 — без предела. На экранах 120–144 Гц без предела игра рисует
  // вдвое больше кадров, чем нужно для плавности, — телефон греется.
  const FPS_CAPS = [60, 30, 0];
  let fpsCap = 60;
  try { const v = localStorage.getItem('fps'); if (v !== null && FPS_CAPS.includes(+v)) fpsCap = +v; } catch {}

  // Отладочная плашка (debug.js): `?debug` в адресе или запомненный выбор.
  let debugOn = flags.has('debug');
  try { debugOn ||= localStorage.getItem('debug') === '1'; } catch {}
  const debug = createDebug({ world, car, camera, camMode: () => camMode, dayNight, fpsCap: () => fpsCap, on: debugOn });

  // Действия общие для клавиатуры, меню и сенсорных кнопок. Действия «в игру» (гонка, на дорогу,
  // гараж) закрывают меню, настройки переключаются на месте.
  const actions = {
    menu: () => {
      if (!raceLenEl.hidden) { raceLenEl.hidden = true; return; } // Esc закрывает выбор длины гонки
      if (menu.back()) return; // из подменю — на главную страницу меню
      if (garage.isOpen) garage.close();
      menu.toggle();
      sound.setPaused(menu.isOpen);
    },
    sound: () => radio.setMuted(sound.toggleMute()),
    radio: () => radio.next(),
    traffic: () => traffic.setEnabled(!traffic.enabled),
    // Пустой бак — эвакуатор на ближайшую АЗС (прямо к колонкам), иначе — на ближайшую дорогу.
    respawn: () => {
      resume();
      const n = car.fuel <= 0 && fuel.nearest(car.pos.x, car.pos.y);
      if (n) {
        const [x, z] = fuel.spot(n.station);
        const [sx, sz] = n.station.sign || [n.station.cx, n.station.cz]; // носом к стеле — она у выезда на дорогу
        car.place(x, z, Math.atan2(sx - x, sz - z));
      }
      else respawnAt(car.pos.x, car.pos.y);
    },
    // Сначала выбор длины; N ещё раз — гонка той же длины, что в прошлый раз.
    race: () => {
      resume();
      if (raceLenEl.hidden) { raceLenEl.hidden = false; markLen(); }
      else startRace(raceLen);
    },
    // Такси: заказ — пассажир на остановке рядом; ещё раз — отменить. В гонке заказов нет.
    taxi: () => {
      resume();
      notice(race.state === 'running' || race.state === 'countdown' ? 'Во время гонки заказов нет' : taxi.toggle(car));
    },
    camera: () => { camMode = (camMode + 1) % 4; cine.shot = null; cine.left = 0; },
    night: () => dayNight.toggle(),
    quality: (q) => {
      setQuality(q);
      try { localStorage.setItem('quality', q); } catch {}
    },
    fps: () => {
      fpsCap = FPS_CAPS[(FPS_CAPS.indexOf(fpsCap) + 1) % FPS_CAPS.length];
      try { localStorage.setItem('fps', fpsCap); } catch {}
    },
    garage: () => { resume(); garage.toggle(); },
    // Большая карта (citymap.js): как меню — пауза.
    map: () => {
      if (garage.isOpen) return;
      menu.close();
      citymap.toggle();
      sound.setPaused(citymap.isOpen);
    },
    debug: () => debug.toggle(),
    fullscreen: toggleFullscreen,
    // Позвать друзей: своя комната и ссылка на неё в буфер обмена (не вышло — ссылка видна в адресе).
    invite: () => {
      const link = net.inviteLink();
      track('invite');
      navigator.clipboard?.writeText(link).then(() => {
        // «Скопирована» на 4 с; меню само не перерисовывается — снимает надпись таймер.
        clearTimeout(copied);
        copied = setTimeout(() => { copied = 0; menu.sync(); }, 4000);
        menu.sync();
        if (!menu.isOpen) notice('Ссылка для друзей скопирована — отправьте её');
      }, () => {});
    },
    city: () => { clearTimeout(copied); copied = 0; net.join(CITY); },
    // Страница «Трюки» в меню (с плаката-подсказки).
    tricks: () => { menu.open(); sound.setPaused(true); menu.page('tricks'); },
    ads: () => { menu.open(); sound.setPaused(true); menu.page('ads'); }, // щит «Место свободно» (build.js)
    // Нитро за деньги: долить баллон, на сколько хватает. Нет нитро — в автосалон.
    nitro: () => {
      if (!car.nitroLevel) { resume(); garage.open(); return; }
      const got = Math.min(1 - car.nitro, Math.max(0, wallet.balance) / PRICES.nitro);
      if (got * PRICES.nitro < 1) return;
      wallet.pay(Math.min(got * PRICES.nitro, wallet.balance), 'нитро');
      car.nitro = Math.min(1, car.nitro + got);
    },
  };
  let copied = 0; // таймер надписи «ссылка скопирована», 0 — не показываем
  let citymap = null; // большая карта и аккаунт — создаются после меню (меню уже спрашивает их состояние)
  let account = null;
  let taxi = null; // такси — после карты (taxi.js)
  const resume = () => { menu.close(); sound.setPaused(false); };
  // Выбор длины гонки (race.js LENGTHS); последняя выбранная — в localStorage.
  const raceLenEl = $('race-len');
  let raceLen = 'short';
  try { const v = localStorage.getItem('raceLen'); if (Object.hasOwn(LENGTHS, v ?? '')) raceLen = v; } catch {}
  const markLen = () => { for (const b of raceLenEl.querySelectorAll('[data-len]')) b.classList.toggle('last', b.dataset.len === raceLen); };
  // В своей комнате — общая гонка: старт отсюда, финиш случайный; придёт всем через базу (net.onRace).
  function startRace(len) {
    raceLenEl.hidden = true;
    raceLen = len;
    try { localStorage.setItem('raceLen', len); } catch {}
    const p = race.pick(car.pos.x, car.pos.y, len);
    if (!p) return;
    const shared = net.shared && net.startRace(p.from, p.to, p.via, len);
    if (!shared) race.start(car.pos.x, car.pos.y, len, p);
    track('race_start', { shared, len });
    menu.sync();
  }
  raceLenEl.addEventListener('click', (e) => { const b = e.target.closest('[data-len]'); if (b) startRace(b.dataset.len); });
  // После любого действия (клавишей, кнопкой) меню показывает актуальные значения.
  for (const [k, f] of Object.entries(actions)) actions[k] = (...a) => { f(...a); menu.sync(); };
  const menu = new Menu({
    actions,
    volume: {
      get: (k) => sound.vol[k],
      set: (k, v) => { sound.setVolume(k, v); radioVolume(); },
    },
    radio: { names: STATIONS.map((s) => s.name), get: () => radio.station, select: (i) => radio.select(i) },
    state: () => ({ sound: !sound.muted, radio: radio.name, traffic: traffic.enabled, camera: camMode, fps: fpsCap, quality: Q.label, qName, night: dayNight.label, debug: debug.on, nav: citymap?.target ? `→ ${citymap.target.name || 'точка'}` : '',
      fullscreen: !!document.fullscreenElement, name: net.name, room: net.room, city: net.room === CITY, online: net.status === 'online',
      players: net.count, netStatus: net.status, copied: !!copied, shared: net.shared,
      money: formatMoney(wallet.balance), hopper: car.hopper > 0, taxi: taxi?.active ? 'отменить заказ' : 'найти пассажира',
      nitro: !car.nitroLevel ? 'нет баллона' : car.nitro >= 0.999 ? 'полный' : wallet.balance >= 1 ? formatMoney(Math.min((1 - car.nitro) * PRICES.nitro, wallet.balance)) : 'нет денег' }),
    setName: (v) => net.setName(v),
    account: { state: () => account ?? { status: 'out' }, start: () => account.start(), send: (e) => account.send(e), signOut: () => account.signOut() },
    adRequest: (v) => sendAdRequest(v).then(() => track('ad_request')),
  });
  game.menu = menu;
  // Аккаунт по почте (account.js): прогресс — в базу при каждом изменении денег и выезде из гаража.
  account = new Account({
    wallet,
    vehicle: () => garage.choice,
    // Машину из аккаунта — только если она своя (купленное к этому времени уже слито в кошелёк).
    setVehicle: (v) => {
      if (!MODELS[v.model] || !ownsCar(wallet, v.model)) return;
      if (!ownsPaint(v)) v = { ...v, color: undefined }; // покрытие не куплено на эту машину — обычный цвет
      if (garage.set(v)) setVehicle(garage.choice.model, garage.choice.color, garage.choice.options);
    },
    onChange: () => menu.sync(),
  });
  // Покупки могли приехать из аккаунта — характеристики своей машины пересчитываем.
  wallet.onChange = () => {
    account.save();
    car.setModel(car.model, tuned(wallet, garage.choice.model));
    showGear(garage);
    net.setGear(tuned(wallet, garage.choice.model));
  };
  game.account = account;
  // Большая карта: значки — заправки, достопримечательности, камеры, другие игроки; маршрут гонки — жёлтым.
  citymap = new CityMap({
    world, car,
    base: isTouch ? 0.14 : 0.2,
    poi: () => [
      ...fuel.stations.map((s) => ({ kind: 'fuel', name: s.name, x: s.cx, z: s.cz })),
      ...landmarks.markers.map((m) => ({ kind: 'landmark', name: m.name, x: m.x, z: m.z })),
      ...cameras.list.filter((c) => !c.broken).map((c) => ({ kind: 'camera', name: c.speed === false ? 'камера на перекрёстке' : `камера ${c.lim}`, x: c.x, z: c.z })),
      ...[...net.ghosts.values()].filter((g) => g.mesh?.visible).map((g) => ({ kind: 'ghost', name: g.name, x: g.mesh.position.x, z: g.mesh.position.z })),
    ],
    extra: () => (race.state === 'running' || race.state === 'countdown' ? [{ route: race.route, color: '#ffd23f' }] : []),
    onRoute: (route) => { navRoute = route; offRoute = 0; menu.sync(); },
    teleport: (x, z) => { respawnAt(x, z); citymap.reroute(); },
  });
  citymap.onClose = () => { sound.setPaused(menu.isOpen); menu.sync(); };
  taxi = new Taxi(world, scene, citymap, $('taxi'));
  game.taxi = taxi;
  game.citymap = citymap;
  $('menu-btn').addEventListener('click', actions.menu);
  $('race-btn').addEventListener('click', actions.race);
  const KEY_ACTIONS = { Escape: 'menu', KeyG: 'garage', KeyV: 'sound', KeyT: 'traffic', KeyR: 'respawn', KeyN: 'race', KeyC: 'camera', KeyL: 'fps',
    KeyB: 'radio', KeyM: 'map', KeyF: 'fullscreen', KeyY: 'night', KeyI: 'debug', KeyJ: 'taxi' }; // Y — «Н» в русской раскладке, J — «О»

  let starting = true;
  const keys = new Set();
  const analog = { steer: null }; // сенсорный руль, -1..1; null — рулим клавишами
  // Трюки — набором нажатий, как суперудар в файтинге: пробел, пробел, вперёд / назад / вбок — не дольше COMBO_MS.
  // Нажатия, а не удержание: едешь с зажатым газом — отпусти и нажми снова.
  const TRICKS = [
    { seq: ['Space', 'Space', 'Up'], run: (dir) => car.kickflip(dir) },
    { seq: ['Space', 'Space', 'Down'], run: () => car.backflip() },
    { seq: ['Space', 'Space', 'Left'], run: () => car.barrelRoll(-1) },
    { seq: ['Space', 'Space', 'Right'], run: () => car.barrelRoll(1) },
  ];
  const COMBO_MS = 700;
  const combo = [];
  let hopperHint = -Infinity;
  const press = (code) => {
    if (starting || menu.isOpen || garage.isOpen || race.state === 'countdown') return;
    const k = { KeyW: 'Up', ArrowUp: 'Up', KeyS: 'Down', ArrowDown: 'Down', KeyA: 'Left', ArrowLeft: 'Left', KeyD: 'Right', ArrowRight: 'Right' }[code] ?? code;
    const t = performance.now();
    combo.push({ k, t });
    if (combo.length > 4) combo.shift();
    for (const { seq, run } of TRICKS) {
      const tail = combo.slice(-seq.length);
      if (tail.length < seq.length || tail.some((c, i) => c.k !== seq[i]) || t - tail[0].t > COMBO_MS) continue;
      // Без «Кузнечика» трюков нет — подсказка, где его взять (не чаще раза в 4 с).
      if (!car.hopper) {
        combo.length = 0;
        if (t - hopperHint > 4000) { hopperHint = t; notice(`Трюкам нужна система «Кузнечик» — она в автосалоне${isTouch ? ' (меню → автосалон)' : ' (G)'}`); }
        return;
      }
      // Сторона оборота — куда рулишь; руль прямо — наугад.
      const st = analog.steer ?? (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (run(Math.sign(st) || (Math.random() < 0.5 ? -1 : 1))) combo.length = 0;
    }
  };
  addEventListener('keydown', (e) => {
    // Печатают в поле (имя, заявка на рекламу в меню) — буквы не управляют игрой, работает только Esc.
    if (e.target.closest?.('input:not([type=range]), textarea') && e.code !== 'Escape') return;
    keys.add(e.code);
    sound.unlock();
    if (e.code !== 'KeyB') radio.unlock();
    if (starting) return; // экран «Поехали»: клавиши игры не работают
    if (!raceLenEl.hidden && /^Digit[123]$/.test(e.code)) return startRace(Object.keys(LENGTHS)[+e.code.slice(5) - 1]);
    if (!e.repeat) press(e.code);
    // Esc в гараже закрывает гараж (garage.js гасит событие), а не открывает меню.
    if (!e.repeat && !e.defaultPrevented && KEY_ACTIONS[e.code]) actions[KEY_ACTIONS[e.code]]();
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  const touch = setupTouch({ keys, analog, actions, press });
  $('minimap').addEventListener('click', actions.map);
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const input = () => ({
    up: keys.has('KeyW') || keys.has('ArrowUp'),
    down: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    brake: keys.has('Space'),
    nitro: keys.has('ShiftLeft') || keys.has('ShiftRight') || (touch.nitro && keys.has('KeyW')), // на телефоне нитро взводится касанием и горит под газом
    steer: analog.steer,
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------------------------------------------------------------- камера

  // Гараж: камера сама облетает машину; потянул мышью или пальцем — крутишь сам (вбок — вокруг, вверх-вниз — выше
  // или ниже), колесо мыши — ближе/дальше. Отпустил — через 3 с облёт продолжается с того же места.
  let orbit = 0, orbitPitch = 0.24, orbitDist = 6.7, orbitIdle = 99;
  let lag = 0; // отставание камеры при разгоне, м
  let turnLook = 0, lastHeading = null; // доворот камеры в поворот, рад
  let camRoll = 0; // крен камеры, рад
  const UP = new THREE.Vector3(0, 1, 0);
  // Зум вида сзади: колесо мыши и щипок двумя пальцами, 1 — близко, как в NFS (5 м за центром машины), 1.6 — прежние
  // 8 м; запоминается (localStorage.camZoom).
  const ZOOM_MIN = 0.85, ZOOM_MAX = 2.4;
  let camZoom = 1;
  try { const v = +localStorage.getItem('camZoom'); if (v >= ZOOM_MIN && v <= ZOOM_MAX) camZoom = v; } catch {}
  let zoomSaveT = 0;
  const zoomBy = (f) => { // f > 1 — дальше
    if (garage.isOpen) {
      orbitDist = Math.max(5, Math.min(11, orbitDist * f));
      orbitIdle = 0;
      return;
    }
    camZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camZoom * f));
    clearTimeout(zoomSaveT);
    zoomSaveT = setTimeout(() => { try { localStorage.setItem('camZoom', camZoom.toFixed(2)); } catch {} }, 400);
  };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camInit = false;
  // ---------------------------------------------------------------- вращение камеры

  // Мышью (тянуть с зажатой кнопкой) и пальцем по свободному месту экрана (руль и педали —
  // свои элементы поверх, их касания сюда не попадают). Отпустил — через 1.5 с на ходу камера
  // плавно возвращается за машину. В гараже так же крутится облёт машины.
  let camYaw = 0, camPitch = 0, dragId = null, dragX = 0, dragY = 0, sinceDrag = 99;
  const cv = renderer.domElement;
  cv.style.cursor = 'grab';
  cv.style.touchAction = 'none';
  // Пальцы на свободной части экрана: два — щипок (зум), камера при этом не крутится.
  const fingers = new Map();
  let pinch = 0;
  const pinchDist = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !menu.isOpen) {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) pinch = pinchDist();
    }
    if (dragId !== null || menu.isOpen) return;
    dragId = e.pointerId;
    dragX = e.clientX;
    dragY = e.clientY;
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', (e) => {
    const fp = fingers.get(e.pointerId);
    if (fp) {
      fp.x = e.clientX;
      fp.y = e.clientY;
      if (fingers.size >= 2) {
        const d = pinchDist();
        if (pinch > 0 && d > 0) zoomBy(pinch / d);
        pinch = d;
        if (e.pointerId === dragId) { dragX = e.clientX; dragY = e.clientY; }
        return;
      }
    }
    if (e.pointerId !== dragId) return;
    if (garage.isOpen) {
      orbit -= (e.clientX - dragX) * 0.008;
      orbitPitch = Math.max(0.03, Math.min(1.2, orbitPitch + (e.clientY - dragY) * 0.003));
      dragX = e.clientX;
      dragY = e.clientY;
      orbitIdle = 0;
      return;
    }
    // Палец — короче ход; мышь — по обеим осям в обратную сторону от пальца.
    const k = e.pointerType === 'touch' ? 1.4 : -1;
    camYaw -= (e.clientX - dragX) * 0.006 * k;
    camPitch = Math.max(-0.25, Math.min(1.1, camPitch + (e.clientY - dragY) * 0.004 * k));
    dragX = e.clientX;
    dragY = e.clientY;
    sinceDrag = 0;
  });
  cv.addEventListener('wheel', (e) => {
    if (menu.isOpen) return;
    e.preventDefault();
    zoomBy(1 + Math.sign(e.deltaY) * Math.min(0.15, Math.abs(e.deltaY) * 0.0015));
  }, { passive: false });
  // Ссылка со щита с UTM-метками — переходы видны в статистике сайта рекламодателя. Telegram меток не читает.
  const adLink = (url, key, poster) => {
    const u = new URL(url);
    if (u.hostname === 't.me') return url;
    u.searchParams.set('utm_source', 'izh-car');
    u.searchParams.set('utm_medium', 'billboard');
    u.searchParams.set('utm_campaign', key);
    u.searchParams.set('utm_content', `poster${poster + 1}`);
    return u.href;
  };
  // Приложение по диплинку (tg://…): страница ушла в фон за 1,5 с — открылось (opened в ad_open), нет — приложения,
  // видимо, нет, подсказываем, что искать. Переход — в той же вкладке: неизвестную схему браузер просто не откроет.
  const openApp = (ad, poster) => {
    let left = false;
    const away = () => { left = true; };
    const hidden = () => { if (document.hidden) left = true; };
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', hidden);
    location.href = ad.app;
    setTimeout(() => {
      window.removeEventListener('blur', away);
      document.removeEventListener('visibilitychange', hidden);
      track('ad_open', { ad: ad.key, poster, url: ad.app, opened: left });
      if (!left) notice(`Telegram не открылся — найдите канал ${ad.handle}`);
    }, 1500);
  };
  // Нажатие без перетаскивания — по рекламному щиту? Ссылка рекламодателя или действие игры (build.js, ADVERTISERS).
  let tapAt = null;
  cv.addEventListener('pointerdown', (e) => { tapAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  ray.far = 220;
  cv.addEventListener('pointerup', (e) => {
    if (!tapAt || garage.isOpen || menu.isOpen || starting) return;
    const quick = Math.hypot(e.clientX - tapAt.x, e.clientY - tapAt.y) < 8 && performance.now() - tapAt.t < 450;
    tapAt = null;
    if (!quick) return;
    const r = cv.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...chunks.mats.ads.meshes], false)[0];
    const ad = hit?.object.userData.adv;
    if (!ad) return;
    // ad_click — нажатие (какой плакат, с какого расстояния, куда ведёт); ad_open — переход по ссылке,
    // opened: false — браузер не открыл вкладку (блокировщик всплывающих окон).
    const poster = chunks.mats.ads.sheets.find((sh) => sh.ad === ad)?.poster ?? 0;
    track('ad_click', { ad: ad.key, poster, dist: Math.round(hit.distance), target: ad.url ? 'link' : ad.app ? 'app' : ad.act });
    if (ad.app) openApp(ad, poster);
    else if (ad.url) {
      // Без 'noopener': с ним window.open всегда возвращает null и не узнать, открылась ли вкладка.
      const win = window.open(adLink(ad.url, ad.key, poster), '_blank');
      if (win) win.opener = null;
      track('ad_open', { ad: ad.key, poster, url: ad.url, opened: !!win });
    } else actions[ad.act]?.();
  });
  const endDrag = (e) => {
    if (fingers.delete(e.pointerId) && fingers.size < 2) pinch = 0;
    if (e.pointerId !== dragId) return;
    dragId = null;
    cv.style.cursor = 'grab';
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(ev, endDrag);

  // ---------------------------------------------------------------- кинокамера

  // Режим «кино» для роликов: планы сменяются склейкой каждые 4–7 с. Одни едут вместе с машиной
  // (облёт, у колеса, спереди, кран), другие стоят на месте и провожают её (обочина, длинный фокус) —
  // их ставят только на ходу, иначе машина в кадре так и не появится. План, который смотрит на машину
  // сквозь стену, не берётся, а неподвижный — обрывается, как только машина заехала за дом.
  const SHOTS = ['orbit', 'wheel', 'front', 'roadside', 'crane', 'tele'];
  const cine = { shot: null, left: 0, t: 0, side: 1, heading: 0, fixed: new THREE.Vector3() };
  // Видна ли машина из точки: идём от машины к камере с шагом 1.5 м, стена ближе 0.6 м — не видна.
  const clearView = (x, z) => {
    const dx = x - car.pos.x, dz = z - car.pos.y, n = Math.ceil(Math.hypot(dx, dz) / 1.5);
    for (let i = 2; i <= n; i++) {
      const p = new THREE.Vector2(car.pos.x + dx * i / n, car.pos.y + dz * i / n);
      if (world.collide(p, 0.6)) return false;
    }
    return true;
  };
  function cineShot(dt, speed) {
    // Курс машины сглаженный: камера у колеса и спереди не дёргается на каждой кочке.
    const h = Math.atan2(car.forward.x, car.forward.y);
    const dh = Math.atan2(Math.sin(h - cine.heading), Math.cos(h - cine.heading));
    cine.heading += cine.shot ? dh * Math.min(1, dt * 3) : dh;
    const fx = Math.sin(cine.heading), fz = Math.cos(cine.heading);
    const c = new THREE.Vector3(car.pos.x, car.y + 0.8, car.pos.y);
    // Точка рядом с машиной: вперёд, вбок (сторона — своя у каждого плана), вверх.
    const at = (fwd, side, up) => new THREE.Vector3(c.x + fx * fwd + fz * side * cine.side, c.y + up, c.z + fz * fwd - fx * side * cine.side);

    cine.left -= dt;
    cine.t += dt;
    const fixedShot = cine.shot === 'roadside' || cine.shot === 'tele';
    const passed = fixedShot && (cine.fixed.x - c.x) * fx + (cine.fixed.z - c.z) * fz < -30; // уехала далеко за камеру
    if (cine.left <= 0 || passed || (fixedShot && !clearView(cine.fixed.x, cine.fixed.z))) {
      for (let tries = 0; tries < 8; tries++) {
        const shot = SHOTS[Math.floor(Math.random() * SHOTS.length)];
        if (shot === cine.shot) continue;
        if ((shot === 'roadside' || shot === 'tele') && speed < 8) continue;
        cine.side = Math.random() < 0.5 ? 1 : -1;
        cine.t = 0;
        // Неподвижные — впереди по ходу: машина успеет подъехать за время плана.
        if (shot === 'roadside') cine.fixed.copy(at(15 + speed * 2, 6, 0.4));
        if (shot === 'tele') cine.fixed.copy(at(40 + speed * 3, 14, 2.5));
        const probe = shot === 'roadside' || shot === 'tele' ? cine.fixed : at(...{ orbit: [0, 7, 1.4], wheel: [-0.8, 1.6, 0], front: [10, 0, 0.6], crane: [-12, 0, 4] }[shot]);
        if (!clearView(probe.x, probe.z)) continue;
        cine.shot = shot;
        cine.left = 4 + Math.random() * 3;
        break;
      }
      if (cine.left <= 0) { cine.shot = 'crane'; cine.left = 4; cine.t = 0; } // всюду стены — кран над крышами
    }

    const t = cine.t;
    // Вертикальный кадр (рилс) уже по горизонтали — камера отходит дальше, чтобы машина влезла целиком.
    const wide = Math.max(1, 1 / camera.aspect);
    let pos, look = c, fov = 50;
    switch (cine.shot) {
      case 'orbit': { // медленный облёт низко над асфальтом
        const a = t * 0.3 * cine.side;
        const ca = Math.cos(a), sa = Math.sin(a);
        pos = at(-7 * wide * sa, 7 * wide * ca, 0.6);
        fov = 45;
        break;
      }
      case 'wheel': // у заднего колеса, у самой земли, смотрит вперёд вдоль борта
        pos = at(-1.2 - t * 0.15, 1.5 + (wide - 1), -0.35);
        look = at(9, 0.3, -0.2);
        fov = 60;
        break;
      case 'front': // спереди, машина едет прямо в камеру; камера понемногу отъезжает в сторону
        pos = at((9 + Math.min(speed * 0.05, 3)) * wide, t * 0.35, 0.1);
        fov = 42;
        break;
      case 'crane': // сзади и вверх: от машины к виду на город
        pos = at(-10 - t * 1.2, 0, 2 + Math.min(t, 6) * 2.2);
        look = at(6, 0, 0);
        fov = 55;
        break;
      case 'roadside': // с обочины: машина проносится мимо
        pos = cine.fixed;
        fov = 50;
        break;
      case 'tele': { // длинный фокус: машина во весь кадр издалека, фон сжат
        pos = cine.fixed;
        const d = pos.distanceTo(c);
        fov = THREE.MathUtils.radToDeg(2 * Math.atan(5 * wide / Math.max(d, 1)));
        fov = Math.max(8, Math.min(40, fov));
        break;
      }
    }
    camera.position.copy(pos);
    camera.position.y = Math.max(camera.position.y, world.ground(pos.x, pos.z, pos.y) + 0.35);
    camera.lookAt(look);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    car.model.visible = true;
  }

  function updateCamera(dt) {
    const speed = Math.abs(car.speed);
    sinceDrag += dt;
    if (dragId === null && sinceDrag > 1.5 && speed > 2) {
      const k = Math.min(1, dt * 2.5);
      camYaw = Math.atan2(Math.sin(camYaw), Math.cos(camYaw)) * (1 - k);
      camPitch *= 1 - k;
    }
    // Курс камеры = курс машины + поворот мышью/пальцем.
    const f0 = car.forward, cy = Math.cos(camYaw), sy = Math.sin(camYaw);
    const f = { x: f0.x * cy - f0.y * sy, y: f0.x * sy + f0.y * cy };
    // 0 — за машиной, 1 — из салона, 2 — высоко сверху (видно город и пруд).
    // Разгон — камера отстаёт (тянется назад пропорционально ускорению), торможение — подъезжает;
    // нитро — ещё дальше, шире угол и лёгкая тряска.
    lag += (Math.max(-6, Math.min(16, car.accel_ ?? 0)) * 0.09 + (car.nitroOn ? 1.2 : 0) - lag) * Math.min(1, dt * 3);
    // В повороте на скорости камера чуть доворачивает в сторону поворота: пропорционально скорости поворота
    // курса, до 0.08 рад. Отставание камеры само уводит взгляд наружу поворота (≈ 0.13 × рад/с) — доворот его
    // почти гасит, в поворот не смотрит (сильнее — укачивает). Переброску (скачок курса) не считаем.
    const dh = lastHeading === null ? 0 : Math.atan2(Math.sin(car.heading - lastHeading), Math.cos(car.heading - lastHeading));
    lastHeading = car.heading;
    const rate = dt > 0 && Math.abs(dh) < 0.5 ? dh / dt : 0;
    const turnWant = Math.max(-0.08, Math.min(0.08, rate * 0.1 * Math.min(1, speed / 20)));
    turnLook += (turnWant - turnLook) * Math.min(1, dt * 3);
    // Крен камеры вокруг продольной оси — в обратную сторону от крена кузова (как в NFS), пятая часть его и не
    // больше 1°; сглажен, чтобы толчки подвески и удары не качали картинку.
    camRoll += (Math.max(-0.02, Math.min(0.02, car.bodyRoll * 0.2)) - camRoll) * Math.min(1, dt * 3);
    // В кино обычная камера всё равно считается, как «сзади»: вернёмся из кино — она уже на месте.
    const mode = camMode === 3 ? 0 : camMode;
    // Сзади: близко, как в NFS, но на 2.3 м — под горку через крышу видно машины впереди; зум отводит камеру
    // назад и вверх (на 1.6 — прежние 8 м и 3.3 м).
    const back = [5 * camZoom + speed * 0.015 + lag, 0.2, 70][mode];
    const up = [2.3 + (camZoom - 1) * 1.67, 1.25, 55][mode];
    // Наклон: поднимаем камеру по дуге вокруг машины.
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const want = new THREE.Vector3(car.pos.x - f.x * back * cp, car.y + up + back * sp, car.pos.y - f.y * back * cp);
    want.y = Math.max(want.y, world.ground(want.x, want.z, want.y) + 1.2);
    const look = new THREE.Vector3(car.pos.x + f.x * 6, car.y + (mode === 0 ? 1.15 + (camZoom - 1) * 0.25 : 1.3), car.pos.y + f.y * 6);
    const k = camMode === 1 ? 1 : 1 - Math.exp(-dt * 7);
    // Сглаживаем смещение камеры относительно машины, а не точку в мире: иначе на скорости
    // камера отстаёт сама собой и машина уезжает вдаль. Отставание при разгоне задаёт lag.
    const carP = new THREE.Vector3(car.pos.x, car.y, car.pos.y);
    want.sub(carP);
    look.sub(carP);
    if (!camInit) { camPos.copy(want); camLook.copy(look); camInit = true; }
    camPos.lerp(want, k);
    camLook.lerp(look, k);
    camera.position.copy(camPos).add(carP);
    camera.position.y = Math.max(camera.position.y, world.ground(camera.position.x, camera.position.z, camera.position.y) + 1);
    const lookAt = camLook.clone().add(carP);
    const shake = car.impact * 0.6 + (car.nitroOn ? 0.07 : 0) + (car.offroad ?? 0) * Math.min(1, speed / 20) * 0.07;
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    // Гараж: камера облетает машину (или её крутят, см. «вращение камеры»), кадр сдвинут влево от панели и вверх
    // от ленты машин.
    if (garage.isOpen) {
      orbitIdle += dt;
      if (orbitIdle > 3 && dragId === null) orbit += dt * 0.35;
      const c = new THREE.Vector3(car.pos.x, car.y + 0.7, car.pos.y), flat = Math.cos(orbitPitch) * orbitDist;
      camera.position.set(c.x + Math.sin(orbit) * flat, c.y + Math.sin(orbitPitch) * orbitDist, c.z + Math.cos(orbit) * flat);
      camera.lookAt(c);
      camera.fov = 50;
      const f = garage.frame();
      camera.setViewOffset(innerWidth, innerHeight, f.right / 2, f.bottom / 2, innerWidth, innerHeight);
      camera.updateProjectionMatrix();
      car.model.visible = true;
      return;
    }
    if (camera.view?.enabled) camera.clearViewOffset();
    if (camMode === 3) return cineShot(dt, speed);
    const ov = window.game?.camOverride; // отладка: { pos: [x,y,z], look: [x,y,z] }
    if (ov) camera.position.set(...ov.pos);
    camera.lookAt(ov ? new THREE.Vector3(...ov.look) : lookAt);
    if (!ov && camMode === 0) {
      camera.rotateOnWorldAxis(UP, turnLook);
      camera.rotateZ(camRoll); // ось Z камеры смотрит назад: +camRoll — против крена кузова
    }
    const fov = 62 + Math.min(12, speed * 0.2) + (car.nitroOn ? 6 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    car.model.visible = camMode !== 1 || garage.isOpen;
  }

  // ---------------------------------------------------------------- HUD

  const mm = $('minimap');
  const northEl = $('north');
  const mg = mm.getContext('2d');
  function drawMinimap() {
    // Рисуем в единицах холста 440×440 (размер в разметке), а сам холст — под экран: на retina и большой
    // миникарте 440 px растягивались до 840 и мылили. Тайлы — в разрешении, которое холст покажет.
    const size = 440;
    const scale = MINIMAP_SCALE;
    const [xmin, zmin] = world.bounds;
    const zoom = 1.1;
    const px = Math.round(mm.clientWidth * Math.min(devicePixelRatio, 2));
    if (px && mm.width !== px) mm.width = mm.height = px;
    const k = mm.width / size;
    minimap.setRes(scale * Math.min(3, Math.ceil(zoom * k * 2) / 2));
    const cx = (car.pos.x - xmin) * scale, cz = (car.pos.y - zmin) * scale;
    mg.setTransform(k, 0, 0, k, 0, 0);
    mg.save();
    mg.fillStyle = '#111';
    mg.fillRect(0, 0, size, size);
    mg.translate(size / 2, size / 2);
    mg.rotate(car.heading + Math.PI); // курс машины — вверх
    mg.scale(zoom, zoom);
    mg.translate(-cx, -cz);
    const view = (size / 2 / zoom / scale) * 1.42; // м: радиус видимого на миникарте
    minimap.draw(mg, car.pos.x, car.pos.y, view, scale);
    // Камеры скорости — как в навигаторах: красный конус обзора по направлению объектива (под маршрутом)
    // и значок на столбе (поверх всего).
    const camIcons = [];
    for (const c of cameras.list) {
      if (c.broken) continue;
      const [px, pz] = c.pole;
      if (Math.abs(px - car.pos.x) > view || Math.abs(pz - car.pos.y) > view) continue;
      const x = (px - xmin) * scale, z = (pz - zmin) * scale, a = Math.atan2(Math.cos(c.face), Math.sin(c.face));
      const len = CAM_CONE * scale;
      const fill = mg.createRadialGradient(x, z, 0, x, z, len);
      fill.addColorStop(0, 'rgba(255, 40, 30, 0.9)');
      fill.addColorStop(0.6, 'rgba(255, 40, 30, 0.45)');
      fill.addColorStop(1, 'rgba(255, 60, 50, 0)');
      mg.beginPath();
      mg.moveTo(x, z);
      mg.arc(x, z, len, a - CAM_SPREAD, a + CAM_SPREAD);
      mg.closePath();
      mg.fillStyle = fill;
      mg.fill();
      camIcons.push(x, z);
    }
    for (const m of landmarks.markers) {
      mg.beginPath();
      mg.arc((m.x - xmin) * scale, (m.z - zmin) * scale, 4 / zoom, 0, 7);
      mg.fillStyle = '#e0b84a';
      mg.fill();
    }
    for (const st of fuel.stations) {
      const r = 7 / zoom, x = (st.cx - xmin) * scale, z = (st.cz - zmin) * scale;
      mg.fillStyle = car.fuel < 0.25 ? '#ff8a2a' : '#e07a1f';
      mg.fillRect(x - r, z - r, 2 * r, 2 * r);
      mg.fillStyle = '#fff';
      mg.fillRect(x - r * 0.45, z - r * 0.55, r * 0.9, r * 1.1);
    }
    mg.fillStyle = '#e0453a'; // трамваи
    for (const t of trams.near(car.pos.x, car.pos.y, 700)) {
      mg.save();
      mg.translate((t.x - xmin) * scale, (t.z - zmin) * scale);
      mg.rotate(Math.atan2(t.dz, t.dx));
      mg.fillRect(-4 / zoom, -1.6 / zoom, 8 / zoom, 3.2 / zoom);
      mg.restore();
    }
    if (traffic.enabled) {
      mg.fillStyle = '#cfd3d8';
      for (const v of traffic.vehicles) {
        if (!v.active) continue;
        mg.beginPath();
        mg.arc((v.x - xmin) * scale, (v.z - zmin) * scale, (v.bus ? 3 : 2) / zoom, 0, 7);
        mg.fill();
      }
    }
    mg.fillStyle = '#4ab3ff'; // другие игроки
    for (const g of net.ghosts.values()) {
      if (!g.mesh?.visible) continue;
      mg.beginPath();
      mg.arc((g.mesh.position.x - xmin) * scale, (g.mesh.position.z - zmin) * scale, 5 / zoom, 0, 7);
      mg.fill();
    }
    if (navRoute && !(race.route.length && race.state !== 'finished' && race.state !== 'idle')) {
      mg.beginPath();
      navRoute.forEach(([x, z], i) => mg[i ? 'lineTo' : 'moveTo']((x - xmin) * scale, (z - zmin) * scale));
      mg.strokeStyle = 'rgba(74,179,255,0.9)';
      mg.lineWidth = 6 / zoom;
      mg.lineCap = mg.lineJoin = 'round';
      mg.stroke();
      const t = citymap.target;
      mg.beginPath();
      mg.arc((t.x - xmin) * scale, (t.z - zmin) * scale, 6 / zoom, 0, 7);
      mg.fillStyle = '#4ab3ff';
      mg.fill();
    }
    if (race.route.length && race.state !== 'finished') {
      mg.beginPath();
      race.route.forEach(([x, z], i) => mg[i ? 'lineTo' : 'moveTo']((x - xmin) * scale, (z - zmin) * scale));
      mg.strokeStyle = 'rgba(255,210,63,0.75)';
      mg.lineWidth = 5 / zoom;
      mg.lineCap = mg.lineJoin = 'round';
      mg.stroke();
      race.checkpoints.forEach((cp, i) => {
        if (i < race.next) return;
        mg.beginPath();
        mg.arc((cp.x - xmin) * scale, (cp.z - zmin) * scale, (i === race.next ? 6 : 4) / zoom, 0, 7);
        mg.fillStyle = cp.finish ? '#40ff8a' : i === race.next ? '#ffd23f' : '#9a8540';
        mg.fill();
      });
    }
    for (let i = 0; i < camIcons.length; i += 2) {
      const x = camIcons[i], z = camIcons[i + 1];
      mg.beginPath();
      mg.arc(x, z, 6 / zoom, 0, 7);
      mg.fillStyle = '#fff';
      mg.fill();
      mg.lineWidth = 2 / zoom;
      mg.strokeStyle = '#e0302a';
      mg.stroke();
      mg.beginPath();
      mg.arc(x, z, 2.4 / zoom, 0, 7);
      mg.fillStyle = '#1b1f22';
      mg.fill();
    }
    mg.restore();
    // Север: карта повёрнута курсом вверх; значок N лежит на окружности миникарты (отдельный
    // элемент — внутри канваса край обрезан кругом). Север мира — −z: на экране угол курс + π/2.
    const box = mm.getBoundingClientRect(), na = car.heading + Math.PI / 2, nr = box.width / 2;
    northEl.style.left = `${box.left + nr + Math.cos(na) * nr}px`;
    northEl.style.top = `${box.top + nr + Math.sin(na) * nr}px`;
    mg.fillStyle = '#ff3b30';
    mg.beginPath();
    mg.moveTo(size / 2, size / 2 - 8);
    mg.lineTo(size / 2 - 6, size / 2 + 6);
    mg.lineTo(size / 2 + 6, size / 2 + 6);
    mg.fill();
  }

  // ---------------------------------------------------------------- предупреждения о бензине

  // 25% — плашка «мало бензина» и сигнал; 10% — «на исходе», пульсирующие края экрана,
  // сигнал раз в 10 с. Пока мало — подсказка с расстоянием и указатель ⛽ на ободе миникарты.
  const LOW_FUEL = 0.25, CRIT_FUEL = 0.1;
  const fuelPtr = $('fuelptr');
  let fuelLevel = 2, warnTimer = 0, toastTimer = 0, lastHud = performance.now();
  const fmtDist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(1)} км`);
  function fuelWarnings() {
    const now = performance.now(), dt = (now - lastHud) / 1000;
    lastHud = now;
    const level = car.fuel <= 0 ? 0 : car.fuel < CRIT_FUEL ? 0 : car.fuel < LOW_FUEL ? 1 : 2;
    const nf = level < 2 && !car.refueling ? fuel.nearest(car.pos.x, car.pos.y) : null;
    if (level < fuelLevel && car.fuel > 0) {
      // Перешли порог вниз — плашка на 4 с и сигнал.
      const t = $('fuelwarn');
      t.innerHTML = `${level === 0 ? 'БЕНЗИН НА ИСХОДЕ!' : 'МАЛО БЕНЗИНА'}<small>${nf ? `⛽ ${nf.station.name} — ${fmtDist(nf.d)}` : ''}</small>`;
      t.classList.toggle('crit', level === 0);
      t.classList.add('show');
      toastTimer = 4;
      sound.warn(level === 0);
      warnTimer = 10;
    }
    if (level > fuelLevel) $('fuelwarn').classList.remove('show'); // заправился
    fuelLevel = level;
    toastTimer -= dt;
    if (toastTimer <= 0) $('fuelwarn').classList.remove('show');
    if (level === 0 && car.fuel > 0 && (warnTimer -= dt) <= 0) { sound.warn(true); warnTimer = 10; }
    document.body.classList.toggle('fuel-crit', level === 0 && car.fuel > 0 && !car.refueling);
    $('fuelhint').textContent = nf ? `⛽ ${nf.station.name} — ${fmtDist(nf.d)}` : '';
    $('fuelhint').classList.toggle('crit', level === 0);
    // Указатель на ближайшую заправку по ободу миникарты (как N): угол = направление + (курс + π).
    fuelPtr.style.display = nf && !garage.isOpen ? 'block' : 'none';
    if (nf) {
      const box = mm.getBoundingClientRect(), r = box.width / 2;
      const a = Math.atan2(nf.station.cz - car.pos.y, nf.station.cx - car.pos.x) + car.heading + Math.PI;
      fuelPtr.style.left = `${box.left + r + Math.cos(a) * r}px`;
      fuelPtr.style.top = `${box.top + r + Math.sin(a) * r}px`;
    }
  }

  // ---------------------------------------------------------------- маршрут по карте

  // Доехал до точки — маршрут убираем; съехал с маршрута дальше 45 м на 2 с — строим заново отсюда.
  let offRoute = 0;
  function navigate(dt) {
    const t = citymap.target;
    if (!t) return;
    if (t !== taxi.target && Math.hypot(t.x - car.pos.x, t.z - car.pos.y) < 25) { // у такси «приехали» — taxi.js
      citymap.clear();
      notice(`Приехали${t.name ? `: ${t.name}` : ''}`);
      return;
    }
    if (guide.route !== navRoute) return; // идёт гонка — её стрелки
    const { d } = guide.locate(car.pos.x, car.pos.y);
    offRoute = d > 45 ? offRoute + dt : 0;
    if (offRoute > 2) { offRoute = 0; citymap.reroute(); }
  }
  // Такси (taxi.js): пассажир сел / довёз — плата; началась гонка (и общая, по сети) — заказ отменяется.
  function taxiTick(dt) {
    if (!taxi.active) return;
    if (race.state === 'running' || race.state === 'countdown') { taxi.cancel(); notice('Гонка — заказ такси отменён'); menu.sync(); return; }
    const ev = taxi.update(dt, car);
    if (!ev) return;
    if (ev.kind === 'drop') { wallet.earn(ev.pay, ev.text); track('taxi_done', { pay: ev.pay }); }
    else notice(ev.text);
    menu.sync();
  }
  // Сообщение плашкой по центру сверху (там же, где деньги).
  function notice(text) {
    const div = document.createElement('div');
    div.className = 'info';
    div.textContent = text;
    $('money-log').prepend(div);
    setTimeout(() => div.classList.add('out'), 2600);
    setTimeout(() => div.remove(), 3200);
  }

  // ---------------------------------------------------------------- штрафы и награды

  // Штраф — вспышка камеры по экрану. Красный — signals.js (только у камер), скорость — камеры (cameras.js);
  // STOP без остановки — yields.js, без камеры и без вспышки.
  const stopSigns = new StopSigns(world);
  const flash = () => { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); };
  // В гонке (и на отсчёте) не штрафуют. Проверки всё равно идут — иначе скорость, снятая камерой на заезде,
  // пришла бы штрафом сразу после финиша.
  function fines(dt) {
    const red = signals.checkPlayer(car), shot = cameras.update(dt, car), stop = stopSigns.checkPlayer(car, dt);
    if (race.state === 'countdown' || race.state === 'running') return;
    if (stop) wallet.fine(PRICES.stopSign, 'STOP без остановки');
    if (red) { wallet.fine(PRICES.redLight, 'проезд на красный'); flash(); }
    if (shot) { wallet.fine(speedingFine(shot.over), `превышение: ${shot.kmh} км/ч при ${shot.cam.lim}`); flash(); }
  }
  // Трюк: приземлился — награда; за каждую машину и трамвай, над которыми пролетел, — сверху. Дрифт — drift.js.
  const TRICK_PAY = { kick: 500, back: 700, roll: 600, ramp: 200 }, OVER_PAY = 300;
  const TRICK_NAME = { kick: 'kickflip', back: 'backflip', roll: 'бочка', ramp: 'трамплин' };
  const ROOF_PAY = { car: 800, bus: 1200, tram: 1500, roof: 1000 };
  const ROOF_NAME = { car: 'на крышу машины', bus: 'на крышу автобуса', tram: 'на крышу трамвая', roof: 'на крышу дома' };
  const jumped = new Set();
  const drift = new Drift($('drift'));
  function tricks(dt) {
    const pay = garage.isOpen ? 0 : drift.update(dt, car);
    if (pay) wallet.earn(pay, 'дрифт');
    if (car.air && car.alt > CLEAR_ALT) {
      for (const v of traffic.vehicles) if (v.active && Math.hypot(v.x - car.pos.x, v.z - car.pos.y) < (v.bus ? 4 : 2.5)) jumped.add(v);
      for (const t of trams.near(car.pos.x, car.pos.y, 12)) if (Math.abs((car.pos.x - t.x) * t.dz - (car.pos.y - t.z) * t.dx) < 2) jumped.add(t);
    }
    if (!car.landed) return;
    const n = jumped.size, kind = car.landed, on = car.landedOn;
    car.landed = car.landedOn = null;
    jumped.clear();
    // Посадка на крышу — сверху ещё (на трамвай и автобус дороже: попасть труднее).
    const roof = on ? ROOF_PAY[on] : 0;
    wallet.earn(TRICK_PAY[kind] + n * OVER_PAY + roof, `${TRICK_NAME[kind]}${n ? ` над ${n} ${n === 1 ? 'машиной' : 'машинами'}` : ''}${on ? ` · ${ROOF_NAME[on]}` : ''}`);
  }

  const gauges = isTouch ? null : new Gauges($('tacho'));
  let lastStreet = '';
  let nearMark = null;
  const camDir = new THREE.Vector3();
  function updateHud(dt, inp) {
    gauges?.update(dt, car, inp);
    $('speed').textContent = Math.round(Math.abs(car.speed) * 3.6);
    $('nitro-fill').style.width = `${car.nitro * 100}%`;
    $('nitro').classList.toggle('locked', !!car.nitroLocked); // пусто — ждём четверть баллона
    $('nitro').hidden = !car.nitroLevel; // нитро не куплено
    touch.update(car);
    const r = world.nearestRoad(car.pos.x, car.pos.y, 12);
    const street = r?.seg.road.name;
    if (street && street !== lastStreet) {
      lastStreet = street;
      $('street').textContent = street;
    }
    // Метка — у того, что крупнее видно: радиус контура к расстоянию, сбоку от взгляда — в 1,5 раза,
    // сзади — вдвое меньше. По одному расстоянию до центра подписывался Казанский храм у самой
    // Карла Маркса, хотя в кадре собор в 70 м от дороги. Сменить метку можно, только если новая
    // заметно крупнее, — иначе мигает при повороте камеры.
    camera.getWorldDirection(camDir);
    const camLen = Math.hypot(camDir.x, camDir.z) || 1;
    let near = null, best = 0, cur = 0;
    for (const m of landmarks.markers) {
      // Радиус — в пределах 8…40 м: у длинных контуров (Арсенал, стадион) он не про видимый размер.
      const dx = m.x - car.pos.x, dz = m.z - car.pos.y, c = Math.hypot(dx, dz), r = Math.min(40, Math.max(8, m.r));
      if (c - r > 160) continue;
      const cos = (dx * camDir.x + dz * camDir.z) / (camLen * c || 1);
      const size = r / Math.max(c, 1) / (1.5 - cos / 2);
      if (size > best) { best = size; near = m; }
      if (m === nearMark) cur = size;
    }
    if (cur && best < cur * 1.15) near = nearMark;
    if (near !== nearMark) {
      nearMark = near;
      $('landmark').textContent = near ? near.name : '';
    }
    const banner = $('banner');
    if (race.state !== 'finished') banner.classList.remove('mini');
    if (garage.isOpen) {
      banner.classList.remove('show');
    } else if (car.refueling) {
      banner.innerHTML = `⛽ ${Math.round(car.fuel * 100)}%<small>${car.freeFuel ? 'денег нет — заправщик наливает бесплатно' : `заправка · ${formatMoney(PRICES.tank)} полный бак`}</small>`;
      banner.classList.add('show');
    } else if (car.recharging) {
      banner.innerHTML = `🔷 ${Math.round(car.nitro * 100)}%<small>нитро · ${formatMoney(PRICES.nitro)} полный баллон</small>`;
      banner.classList.add('show');
    } else if (car.broke && Math.abs(car.speed) < 1) {
      banner.innerHTML = `НЕТ ДЕНЕГ<small>заработайте в гонках, трюками и дрифтом</small>`;
      banner.classList.add('show');
    } else if (car.fuel <= 0 && Math.abs(car.speed) < 2 && race.state !== 'countdown') {
      banner.innerHTML = `БЕНЗИН КОНЧИЛСЯ<small>${isTouch ? '↺' : 'R'} — эвакуатор до заправки</small>`;
      banner.classList.add('show');
    } else if (car.sink > 0.4) {
      banner.innerHTML = 'УТОНУЛ!<small>всё сначала</small>';
      banner.classList.add('show');
    } else if (race.state === 'countdown') {
      banner.textContent = Math.ceil(race.countdown);
      banner.classList.add('show');
    } else if (race.state === 'running') {
      banner.classList.toggle('show', race.time < 0.8);
      if (race.time < 0.8) banner.textContent = 'ПОЕХАЛИ!';
    } else if (race.state === 'finished') {
      const table = standings();
      banner.innerHTML = `ФИНИШ ${formatTime(race.time)}<small>${table || (race.isRecord ? 'новый рекорд!' : `рекорд ${formatTime(race.best)}`)}${race.reward ? ` · +${formatMoney(race.reward)}` : ''}<br>N — новая гонка</small>`;
      banner.classList.toggle('mini', performance.now() - race.finishedAt > FINISH_BIG);
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
    // Бак: шкала под нитро; мало бензина — ступенчатые предупреждения (fuelWarnings).
    $('fuel-fill').style.width = `${car.fuel * 100}%`;
    $('fuel').classList.toggle('low', car.fuel < LOW_FUEL);
    fuelWarnings();
    // Камера впереди: знак с пределом и расстоянием; едешь быстрее — знак красный.
    const cam = cameras.ahead(car), cw = $('camwarn');
    cw.hidden = !cam || garage.isOpen;
    if (cam) {
      cw.innerHTML = `📷 <b>${cam.cam.lim}</b><small>${cam.d < 25 ? 'камера' : fmtDist(cam.d)}</small>`;
      const kmh = Math.abs(car.speed) * 3.6;
      cw.classList.toggle('over', kmh > cam.cam.lim);
      cw.classList.toggle('fast', kmh > cam.cam.lim + 20); // столько камера штрафует (cameras.js)
    }
    document.body.classList.toggle('no-race', race.state === 'idle');
    roster();
    $('time').textContent = formatTime(race.time);
    $('cp').textContent = race.checkpoints.length ? `${Math.min(race.next, race.checkpoints.length)}/${race.checkpoints.length}` : '–';
    $('dist').textContent = `${(race.length / 1000).toFixed(1)} км`;
    $('ramps-left').textContent = race.state === 'running' && car.nitroBoost > 1.05 ? 'нитро догоняет' : '';
    drawMinimap();
  }

  // Экран «Поехали»: логотип остаётся, вместо полосы — имя (если ещё не выбрано) и кнопка.
  // Нажатие заодно разрешает звук: браузер не даёт играть звуку и радио до первого клика/клавиши.
  function startScreen() {
    const box = $('start'), nameIn = box.querySelector('input');
    $('loading-bar').hidden = $('loading-text').hidden = true;
    box.hidden = false;
    nameIn.parentElement.hidden = net.named;
    nameIn.placeholder = net.name;
    if (!net.named && !isTouch) nameIn.focus();
    // Клавиатура телефона закрывает пол-экрана — прокручиваем к полю и кнопке.
    nameIn.addEventListener('focus', () => setTimeout(() => box.scrollIntoView({ block: 'end', behavior: 'smooth' }), 300));
    // Иконка на рабочий стол: кнопка, только пока браузер может поставить (или это iPhone с подсказкой).
    const inst = box.querySelector('.install'), hint = box.querySelector('.install-hint');
    const showInst = () => { inst.hidden = !install.available; };
    showInst();
    install.onChange(showInst);
    inst.addEventListener('click', async () => {
      const r = await install.prompt();
      if (r === 'ios') { hint.hidden = false; inst.hidden = true; }
      track('install', { result: String(r) });
    });
    return new Promise((resolve) => {
      // По ссылке друга — уже в его компании: «Поехали к друзьям» или ездить одному.
      const invited = net.room !== CITY;
      box.querySelector('.invited').hidden = !invited;
      box.querySelector('.go span').textContent = invited ? 'Поехали к друзьям ▶' : 'Исследовать город ▶';
      const fr = box.querySelector('.friends');
      fr.querySelector('span').textContent = invited ? 'Ездить одному' : '👥 Играть с друзьями';
      fr.querySelector('small').textContent = invited ? 'без других игроков' : 'получите ссылку — кто её откроет, окажется в городе рядом с вами';
      fr.addEventListener('click', () => {
        if (invited) { net.join(CITY); go(); return; }
        // Друг по ссылке появится у площади — туда же и мы, если стояли в прошлом месте.
        if (lastPos) { respawnHome(); traffic.reset(car.pos.x, car.pos.y); }
        // Ссылка — в «Поделиться» на телефоне, иначе в буфер обмена; в игре — подсказка, что с ней делать.
        const link = net.inviteLink();
        track('invite', { from: 'start' });
        const shared = isTouch && navigator.share ? navigator.share({ title: 'Izh Car', text: 'Погоняем по Ижевску?', url: link }) : null;
        (shared ?? navigator.clipboard?.writeText(link) ?? Promise.reject())
          .then(() => notice(shared ? 'Ссылка отправлена — ждите друзей в городе' : 'Ссылка для друзей скопирована — отправьте её'),
            () => notice('Ссылка для друзей — в адресной строке'));
        go();
      }, { once: true });
      const go = () => {
        removeEventListener('keydown', onKey);
        if (nameIn.value.trim()) net.setName(nameIn.value);
        nameIn.blur();
        sound.unlock();
        radio.unlock();
        document.body.classList.remove('boot'); // дальше игра только лёжа — снова просим повернуть телефон
        resolve();
      };
      const onKey = (e) => {
        if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
        e.preventDefault();
        go();
      };
      addEventListener('keydown', onKey);
      box.querySelector('.go').addEventListener('click', go, { once: true });
    });
  }

  // ---------------------------------------------------------------- цикл

  // Шейдеры компилируем заранее, иначе первый кадр после заставки подвисает.
  progress(0.98, 'Готовлю графику…');
  await frame();
  stage('шейдеры');
  renderer.compile(scene, camera);
  stage();
  const loadTotal = Math.round(performance.now());
  // Остаток — отданные кадры (frame()) и мелочи между этапами.
  loadTimes.push({ name: 'между этапами', ms: loadTotal - loadTimes.reduce((sum, s) => sum + s.ms, 0) });
  loadTimes.push({ name: 'итого до «Поехали»', ms: loadTotal });
  window.loadTimes = loadTimes;
  console.log('[load]', loadTimes.map((s) => `${s.name} ${s.ms}${s.note ? ` (${s.note})` : ''}`).join(' · '));
  progress(1);
  await startScreen();
  starting = false;
  posReady = true;
  setTimeout(() => citymap.prepare(), 3000); // подложку большой карты — заранее, чтобы она открылась сразу
  track('game_start', { model: garage.choice.model, touch: isTouch, room: net.room !== CITY });
  if (!choice.saved) garage.open();
  // Телефон не тянет (меньше 20 кадров в секунду за 8 с после старта) — один раз ступенью ниже, если
  // игрок уровень сам не выбирал. Выбор запоминается — дальше не проверяем.
  if (isTouch && !QUALITY[qChosen] && qName !== 'low') {
    let n = 0;
    const from = performance.now() + 3000; // первые секунды — достройка квадратов, кадры неровные
    const probe = (now) => {
      if (now > from) n++;
      if (now < from + 8000) { requestAnimationFrame(probe); return; }
      if (n / 8 >= 20) return;
      const next = qName === 'high' ? 'medium' : 'low';
      actions.quality(next);
      notice(`Графика понижена: ${QUALITY[next].label} — для плавности (меню → Графика)`);
    };
    requestAnimationFrame(probe);
  }
  // Заставка с логотипом гаснет поверх уже идущей игры.
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 600);
  const clock = new THREE.Clock();
  let cullAt = 0;
  const cullPos = new THREE.Vector3();
  const STEP = 1 / 120, MAX_STEPS = 8; // 8 шагов = 67 мс: до 15 fps игра идёт в обычном темпе
  let acc = 0;
  const perf = flags.has('perf') ? createPerf(renderer, scene, camera, sun, loadTimes) : null;
  let nextFrame = 0;
  renderer.setAnimationLoop((now) => {
    // Предел кадров: пропускаем вызовы раньше срока (запас 1 мс на дрожание таймера).
    // Срок двигается шагом интервала — на 144 Гц в среднем выходит ровно предел.
    if (fpsCap) {
      if (now < nextFrame - 1) return;
      nextFrame = Math.max(nextFrame + 1000 / fpsCap, now);
    }
    perf?.begin();
    const dt = Math.min(clock.getDelta(), 0.1);
    // Меню и большая карта — пауза: мир стоит, только перерисовываем кадр.
    if (menu.isOpen || citymap.isOpen) {
      acc = 0;
      renderer.render(scene, camera);
      perf?.end();
      return;
    }
    acc += dt;
    const inp = race.state === 'countdown' || garage.isOpen ? {} : input();
    // Не больше MAX_STEPS шагов за кадр: на слабом телефоне 12 шагов удлиняли кадр, и следующий
    // требовал ещё больше (спираль). Остаток отбрасываем — игра там чуть замедляется, но не тонет.
    for (let steps = 0; acc >= STEP; steps++) {
      if (steps === MAX_STEPS) { acc = 0; break; }
      car.update(STEP, inp);
      breakables.collide(car);
      acc -= STEP;
    }
    perf?.mark('физика');
    chunks.update(car.pos.x, car.pos.y, isTouch ? 1 : 2);
    perf?.mark('квадраты');
    if ((posT += dt) > POS_EVERY) { posT = 0; savePos(); }
    if (car.drowned) {
      // Утонул — всё сначала: та же гонка с отсчётом, трафик заново. Бак и нитро — какие были (за деньги).
      if (race.restart()) car.place(race.startPose.x, race.startPose.z, race.startPose.heading);
      else respawnAt(car.dry.x, car.dry.y);
      traffic.reset(car.pos.x, car.pos.y);
    }
    if (!garage.isOpen) race.update(dt, car); // в гараже гонка на паузе
    // Канистры и трамплины на трассе — пока едем гонку; кончилась — убираем.
    if (race.state === 'running') {
      for (let n = pickups.update(dt, car); n > 0; n--) {
        if (!car.nitroLevel) { wallet.say('🔷 канистра', 'нитро не установлено — в автосалон'); continue; }
        car.nitro = Math.min(1, car.nitro + NITRO_GIVE); wallet.say('🔷 нитро', `+${NITRO_GIVE * 100}%`);
      }
    } else if (race.state !== 'countdown' && (pickups.items.length || ramps.list.length)) { pickups.clear(); ramps.clear(); }
    signals.update(dt);
    fines(dt);
    fuel.update(dt, car, wallet);
    queues.update(dt, car);
    trams.update(dt, car);
    tricks(dt);
    car.checkStuck(dt, inp);
    net.progress = race.shared && race.state !== 'countdown' && net.race?.t === race.startAt ? race.progress(car) : null;
    car.nitroBoost = 1;
    if (net.progress != null && race.state === 'running') {
      let lead = net.progress;
      for (const g of net.ghosts.values()) if (!g.stale && g.p != null) lead = Math.max(lead, g.p);
      car.nitroBoost = 1 + Math.min(1, (lead - net.progress) / CATCH_UP);
    }
    perf?.mark('игра');
    net.update(dt, car);
    traffic.update(dt, car);
    perf?.mark('трафик');
    breakables.update(dt, car, traffic);
    nitroFx.update(dt, car);
    jetFx.update(dt, car);
    dustFx.update(dt, car);
    skidFx.update(dt, car);
    tireSmokeFx.update(dt, car);
    exhaustFx.update(dt, car);
    ghostFx.update(dt, net, car);
    perf?.mark('эффекты');
    sound.update(dt, car, inp, race);
    sound.traffic(dt, traffic, car);
    sound.players(dt, net, car);
    sound.smash(breakables.smashes.splice(0), car);
    landmarks.group.userData.update(performance.now() / 1000);
    boundary.update(performance.now() / 1000, car.pos.x, car.y, car.pos.y);
    // Стрелки на дороге: в гонке — по её маршруту, иначе — до точки, выбранной на карте.
    const route = race.state === 'running' || race.state === 'countdown' ? race.route : navRoute;
    if (route !== guide.route) guide.set(route, route === navRoute ? '#4ab3ff' : '#ffd23f');
    guide.update(car);
    taxiTick(dt);
    navigate(dt);
    updateCamera(dt);
    // Дальше конца тумана всё одного цвета с горизонтом — не рисуем: дальняя плоскость = конец тумана
    // (туман three.js считает по той же глубине, что и отсечение, — шва нет).
    if (camera.far !== scene.fog.far) { camera.far = scene.fog.far; camera.updateProjectionMatrix(); }
    // Дальние достопримечательности прячем раз в 0,5 с (по часам, не по dt — он ограничен) и сразу после
    // прыжка камеры (перенос машины, рестарт гонки).
    const cp = camera.position;
    if (now > cullAt || Math.abs(cp.x - cullPos.x) + Math.abs(cp.z - cullPos.z) > 100) {
      cullAt = now + 500;
      cullPos.copy(cp);
      landmarks.group.userData.cull(cp.x, cp.z, camera.far);
      signals.cull(cp.x, cp.z, Math.min(camera.far, Q.carsFar + 100)); // светофоры — до 400 / 320 / 250 м
    }
    skyDome.update(dt, camera);
    dayNight.update(dt);
    if (headlight.visible) {
      const m = car.model, front = (m.userData.length || 4.2) / 2;
      m.updateMatrixWorld();
      headlight.position.copy(m.localToWorld(HEAD_POS.set(0, 0.75, front - 0.2)));
      headlight.target.position.copy(m.localToWorld(HEAD_AIM.set(0, -0.6, front + 22)));
    }
    sun.target.position.set(car.pos.x, car.y, car.pos.y);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 300);
    updateHud(dt, inp);
    debug.update(now);
    perf?.mark('звук, камера, HUD');
    renderer.render(scene, camera);
    perf?.mark('отрисовка');
    perf?.end();
  });
}

main().catch((e) => {
  console.error(e);
  $('loading')?.classList.add('error');
  status(`Ошибка: ${e.message}`);
});
