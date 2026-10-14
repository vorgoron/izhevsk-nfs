import * as THREE from 'three';
import { World } from './world.js';
import { MINIMAP_SCALE } from './build.js';
import { ChunkManager, MinimapTiles } from './chunks.js';
import { Car } from './car.js';
import { MODELS, buildPlayerModel, loadVehicleMeshes } from './vehicles.js';
import { Garage, loadChoice } from './garage.js';
import { Race, formatTime } from './race.js';
import { buildLandmarks } from './landmarks.js';
import { planFootbridges, buildFootbridges } from './footbridges.js';
import { Sound } from './audio.js';
import { Radio } from './radio.js';
import { Traffic } from './traffic.js';
import { Signals } from './signals.js';
import { Sky, HORIZON } from './sky.js';
import { Fuel } from './fuel.js';
import { Queues } from './queues.js';
import { Trams } from './trams.js';
import { NitroFX, DustFX, ExhaustFX } from './effects.js';
import { isTouch, setupTouch, toggleFullscreen } from './touch.js';
import { Menu } from './menu.js';

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

// city.json (~13 МБ) читаем потоком, чтобы показывать скачанное. Под gzip Content-Length — сжатый
// размер, а поток отдаёт распакованные байты, поэтому тогда размер неизвестен (total = 0).
async function fetchJSON(url, onBytes) {
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
  return JSON.parse(await new Blob(parts).text());
}
// Отладочные ключи в адресе (белый экран на Android): ?lite — проще графика, ?nohud — без HTML
// поверх канваса, ?lowpower — слабый GPU, ?noaa / ?aa — сглаживание.
const flags = new URLSearchParams(location.search);
const lite = flags.has('lite');
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

  // На телефоне экономим: без MSAA, плотность пикселей не выше 1.5, тени мельче.
  const renderer = new THREE.WebGLRenderer({
    antialias: flags.has('aa') || (!isTouch && !flags.has('noaa')),
    powerPreference: flags.has('lowpower') ? 'low-power' : 'default',
  });
  renderer.setPixelRatio(lite ? 1 : Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color(HORIZON); // туман = цвет горизонта неба (sky.js)
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 250, 1600);
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 4000);

  scene.add(new THREE.HemisphereLight('#dfe9f5', '#5a5444', 1.4));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(isTouch ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 600 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const SUN_DIR = new THREE.Vector3(-0.5, 0.8, 0.35).normalize();

  const world = new World(city);
  planFootbridges(world); // насыпи у мостов меняют рельеф — до постройки мешей
  world.buildGraph();
  progress(0.66, 'Ставлю мосты и достопримечательности…');
  await frame();
  // Город строится квадратами вокруг игрока (chunks.js); на телефоне — ближе и проще.
  const chunks = new ChunkManager(world, scene, renderer, lite ? { radius: 800, texSize: 256 } : isTouch ? { radius: 1300, texSize: 512 } : { radius: 1800, texSize: 1024 });
  scene.add(buildFootbridges(world, new THREE.MeshLambertMaterial({ color: '#9a968e' })));
  const landmarks = buildLandmarks(world);
  scene.add(landmarks.group);
  const minimap = new MinimapTiles(world);

  // Своя машина: выбор из гаража (localStorage), по умолчанию — «Ода».
  await vehiclesReady;
  const choice = loadChoice();
  const model = buildPlayerModel(choice.model, choice.color);
  scene.add(model);
  const car = new Car(world, model, MODELS[choice.model].stats);
  const setVehicle = (key, color) => {
    scene.remove(car.model);
    car.model.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    const m = buildPlayerModel(key, color);
    scene.add(m);
    car.setModel(m, MODELS[key].stats);
    nitroFx.attach(m);
    exhaustFx.attach(m);
    car.update(0, {}); // поставить новую модель на место старой
  };
  const nitroFx = new NitroFX(scene);
  const dustFx = new DustFX(scene);
  const exhaustFx = new ExhaustFX(scene);
  exhaustFx.attach(car.model);
  nitroFx.attach(car.model);
  const race = new Race(world, scene);

  // Старт у Центральной площади.
  const spawn = world.nearestRoad(0, 0, 400);
  const respawnAt = (x, z) => {
    const r = world.nearestRoad(x, z, 500);
    if (!r) return car.place(x, z, 0);
    const s = r.seg;
    car.place(r.px, r.pz, Math.atan2(s.bx - s.ax, s.bz - s.az));
  };
  respawnAt(spawn ? spawn.px : 0, spawn ? spawn.pz : 0);
  race.start(car.pos.x, car.pos.y);
  progress(0.7, 'Строю город вокруг…');
  await frame();
  await chunks.preload(car.pos.x, car.pos.y, 900, (f) => progress(0.7 + 0.25 * f));
  progress(0.95, 'Трафик, заправки, светофоры…');
  await frame();
  const skyDome = new Sky(scene, world.baseTerrain(0, 0));
  const fuel = new Fuel(world, scene);
  const queues = new Queues(world, fuel, scene);
  const traffic = new Traffic(world, scene);
  const signals = new Signals(world, traffic, scene);
  traffic.reset(car.pos.x, car.pos.y);
  // Сменил машину — гонка с начала (честно); первый запуск — сразу в гараж.
  const garage = new Garage(choice, {
    onChange: setVehicle,
    onClose: (changed) => {
      if (changed && race.restart()) car.place(race.startPose.x, race.startPose.z, race.startPose.heading);
    },
  });
  if (!choice.saved) garage.open();
  window.game = { world, car, race, respawnAt, landmarks, traffic, signals, garage, fuel, queues, chunks }; // для отладки из консоли

  // ---------------------------------------------------------------- ввод

  const sound = new Sound();
  game.sound = sound;
  const trams = new Trams(world, scene, sound);
  game.trams = trams;
  // Радио всегда на экране: станция или приглушённое «Радио выкл»; при переключении надпись вспыхивает.
  let radioName;
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
  });
  radio.setMuted(sound.muted);
  game.radio = radio;
  radioName = radio.name; // первый показ — без вспышки
  radio.onChange();
  // Надпись радио — кнопка переключения.
  $('radio').addEventListener('click', () => actions.radio());
  // iOS разрешает звук только из обработчика касания/клика. Нажатие на кнопку радио само решит,
  // что включать, — иначе запомненная станция включится тут и кнопка сразу перещёлкнет на следующую.
  for (const ev of ['pointerdown', 'touchend', 'click']) addEventListener(ev, (e) => {
    sound.unlock();
    if (!e.target.closest?.('[data-act="radio"], #radio')) radio.unlock();
  });

  let camMode = 0; // 0 — за машиной, 1 — из салона, 2 — сверху

  // Действия общие для клавиатуры, меню и сенсорных кнопок. Действия «в игру» (гонка, на дорогу,
  // гараж) закрывают меню, настройки переключаются на месте.
  const actions = {
    menu: () => {
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
    race: () => { resume(); race.start(car.pos.x, car.pos.y); },
    camera: () => { camMode = (camMode + 1) % 3; },
    garage: () => { resume(); garage.toggle(); },
    map: () => $('minimap').classList.toggle('big'),
    fullscreen: toggleFullscreen,
  };
  const resume = () => { menu.close(); sound.setPaused(false); };
  // После любого действия (клавишей, кнопкой) меню показывает актуальные значения.
  for (const [k, f] of Object.entries(actions)) actions[k] = () => { f(); menu.sync(); };
  const menu = new Menu({
    actions,
    state: () => ({ sound: !sound.muted, radio: radio.name, traffic: traffic.enabled, camera: camMode, bigMap: $('minimap').classList.contains('big'),
      fullscreen: !!document.fullscreenElement }),
  });
  game.menu = menu;
  $('menu-btn').addEventListener('click', actions.menu);
  const KEY_ACTIONS = { Escape: 'menu', KeyG: 'garage', KeyV: 'sound', KeyT: 'traffic', KeyR: 'respawn', KeyN: 'race', KeyC: 'camera',
    KeyB: 'radio', KeyM: 'map', KeyF: 'fullscreen' };

  const keys = new Set();
  const analog = { steer: null }; // сенсорный руль, -1..1; null — рулим клавишами
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    sound.unlock();
    if (e.code !== 'KeyB') radio.unlock();
    // Esc в гараже закрывает гараж (garage.js гасит событие), а не открывает меню.
    if (!e.repeat && !e.defaultPrevented && KEY_ACTIONS[e.code]) actions[KEY_ACTIONS[e.code]]();
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  setupTouch({ keys, analog, actions });
  $('minimap').addEventListener('click', actions.map);
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const input = () => ({
    up: keys.has('KeyW') || keys.has('ArrowUp'),
    down: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    brake: keys.has('Space'),
    nitro: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    steer: analog.steer,
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------------------------------------------------------------- камера

  let orbit = 0;
  let lag = 0; // отставание камеры при разгоне, м
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camInit = false;
  // ---------------------------------------------------------------- вращение камеры

  // Мышью (тянуть с зажатой кнопкой) и пальцем по свободному месту экрана (руль и педали —
  // свои элементы поверх, их касания сюда не попадают). Отпустил — через 1.5 с на ходу камера
  // плавно возвращается за машину.
  let camYaw = 0, camPitch = 0, dragId = null, dragX = 0, dragY = 0, sinceDrag = 99;
  const cv = renderer.domElement;
  cv.style.cursor = 'grab';
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => {
    if (dragId !== null || garage.isOpen || menu.isOpen) return;
    dragId = e.pointerId;
    dragX = e.clientX;
    dragY = e.clientY;
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    const k = e.pointerType === 'touch' ? 1.4 : 1; // палец — короче ход
    camYaw -= (e.clientX - dragX) * 0.006 * k;
    camPitch = Math.max(-0.25, Math.min(1.1, camPitch + (e.clientY - dragY) * 0.004 * k));
    dragX = e.clientX;
    dragY = e.clientY;
    sinceDrag = 0;
  });
  const endDrag = (e) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    cv.style.cursor = 'grab';
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(ev, endDrag);

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
    const back = [8 + speed * 0.02 + lag, 0.2, 70][camMode];
    const up = [3.3, 1.25, 55][camMode];
    // Наклон: поднимаем камеру по дуге вокруг машины.
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const want = new THREE.Vector3(car.pos.x - f.x * back * cp, car.y + up + back * sp, car.pos.y - f.y * back * cp);
    want.y = Math.max(want.y, world.ground(want.x, want.z, want.y) + 1.2);
    const look = new THREE.Vector3(car.pos.x + f.x * 6, car.y + 1.3, car.pos.y + f.y * 6);
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
    // Гараж: камера облетает машину, кадр сдвинут влево от панели.
    if (garage.isOpen) {
      orbit += dt * 0.35;
      const c = new THREE.Vector3(car.pos.x, car.y + 0.7, car.pos.y);
      camera.position.set(c.x + Math.sin(orbit) * 6.5, c.y + 1.6, c.z + Math.cos(orbit) * 6.5);
      camera.lookAt(c);
      camera.fov = 50;
      const panel = Math.min(innerWidth * 0.46, 420);
      camera.setViewOffset(innerWidth, innerHeight, panel / 2, 0, innerWidth, innerHeight);
      camera.updateProjectionMatrix();
      car.model.visible = true;
      return;
    }
    if (camera.view?.enabled) camera.clearViewOffset();
    const ov = window.game?.camOverride; // отладка: { pos: [x,y,z], look: [x,y,z] }
    if (ov) camera.position.set(...ov.pos);
    camera.lookAt(ov ? new THREE.Vector3(...ov.look) : lookAt);
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
    const size = mm.width;
    const scale = MINIMAP_SCALE;
    const [xmin, zmin] = world.bounds;
    const zoom = mm.classList.contains('big') ? 0.35 : 1.1;
    const cx = (car.pos.x - xmin) * scale, cz = (car.pos.y - zmin) * scale;
    mg.save();
    mg.fillStyle = '#111';
    mg.fillRect(0, 0, size, size);
    mg.translate(size / 2, size / 2);
    mg.rotate(car.heading + Math.PI); // курс машины — вверх
    mg.scale(zoom, zoom);
    mg.translate(-cx, -cz);
    minimap.draw(mg, car.pos.x, car.pos.y, (size / 2 / zoom / scale) * 1.42, scale);
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
    if (race.route.length && race.state !== 'finished') {
      mg.beginPath();
      race.route.forEach(([x, z], i) => mg[i ? 'lineTo' : 'moveTo']((x - xmin) * scale, (z - zmin) * scale));
      mg.strokeStyle = 'rgba(255,210,63,0.75)';
      mg.lineWidth = 3 / zoom;
      mg.stroke();
      race.checkpoints.forEach((cp, i) => {
        if (i < race.next) return;
        mg.beginPath();
        mg.arc((cp.x - xmin) * scale, (cp.z - zmin) * scale, (i === race.next ? 6 : 4) / zoom, 0, 7);
        mg.fillStyle = cp.finish ? '#40ff8a' : i === race.next ? '#ffd23f' : '#9a8540';
        mg.fill();
      });
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

  let lastStreet = '';
  function updateHud() {
    $('speed').textContent = Math.round(Math.abs(car.speed) * 3.6);
    $('nitro-fill').style.width = `${car.nitro * 100}%`;
    $('nitro').classList.toggle('locked', !!car.nitroLocked); // пусто — ждём четверть баллона
    const r = world.nearestRoad(car.pos.x, car.pos.y, 12);
    const street = r?.seg.road.name;
    if (street && street !== lastStreet) {
      lastStreet = street;
      $('street').textContent = street;
    }
    let near = null, nd = 160;
    for (const m of landmarks.markers) {
      const d = Math.hypot(m.x - car.pos.x, m.z - car.pos.y);
      if (d < nd) { nd = d; near = m; }
    }
    $('landmark').textContent = near ? near.name : '';
    const banner = $('banner');
    if (garage.isOpen) {
      banner.classList.remove('show');
    } else if (car.refueling) {
      banner.innerHTML = `⛽ ${Math.round(car.fuel * 100)}%<small>заправка</small>`;
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
      banner.innerHTML = `ФИНИШ ${formatTime(race.time)}<small>${race.isRecord ? 'новый рекорд!' : `рекорд ${formatTime(race.best)}`}<br>N — новая гонка</small>`;
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
    // Бак: шкала под нитро; мало бензина — ступенчатые предупреждения (fuelWarnings).
    $('fuel-fill').style.width = `${car.fuel * 100}%`;
    $('fuel').classList.toggle('low', car.fuel < LOW_FUEL);
    fuelWarnings();
    $('time').textContent = formatTime(race.time);
    $('cp').textContent = race.checkpoints.length ? `${Math.min(race.next, race.checkpoints.length)}/${race.checkpoints.length}` : '–';
    $('dist').textContent = `${(race.length / 1000).toFixed(1)} км`;
    drawMinimap();
  }

  // ---------------------------------------------------------------- цикл

  // Шейдеры компилируем заранее, иначе первый кадр после заставки подвисает.
  progress(0.98, 'Готовлю графику…');
  await frame();
  renderer.compile(scene, camera);
  progress(1);
  $('loading').remove();
  const clock = new THREE.Clock();
  const STEP = 1 / 120;
  let acc = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    // Меню — пауза: мир стоит, только перерисовываем кадр.
    if (menu.isOpen) {
      acc = 0;
      renderer.render(scene, camera);
      return;
    }
    acc += dt;
    const inp = race.state === 'countdown' || garage.isOpen ? {} : input();
    while (acc >= STEP) {
      car.update(STEP, inp);
      acc -= STEP;
    }
    chunks.update(car.pos.x, car.pos.y, isTouch ? 1 : 2);
    if (car.drowned) {
      // Утонул — всё сначала: та же гонка с отсчётом, полное нитро, трафик заново.
      car.nitro = 1;
      car.fuel = 1;
      if (race.restart()) car.place(race.startPose.x, race.startPose.z, race.startPose.heading);
      else respawnAt(car.dry.x, car.dry.y);
      traffic.reset(car.pos.x, car.pos.y);
    }
    if (!garage.isOpen) race.update(dt, car); // в гараже гонка на паузе
    signals.update(dt);
    fuel.update(dt, car);
    queues.update(dt, car);
    trams.update(dt, car);
    car.checkStuck(dt, inp);
    traffic.update(dt, car);
    nitroFx.update(dt, car);
    dustFx.update(dt, car);
    exhaustFx.update(dt, car);
    sound.update(dt, car, inp, race);
    landmarks.group.userData.update(performance.now() / 1000);
    updateCamera(dt);
    skyDome.update(dt, camera, car.pos.x, car.pos.y);
    sun.target.position.set(car.pos.x, car.y, car.pos.y);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 300);
    updateHud();
    renderer.render(scene, camera);
  });
}

main().catch((e) => {
  console.error(e);
  $('loading')?.classList.add('error');
  status(`Ошибка: ${e.message}`);
});
