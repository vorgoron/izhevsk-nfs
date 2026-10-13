import * as THREE from 'three';
import { World } from './world.js';
import { buildTerrain, buildRoads, buildBuildings, buildTrees, buildMinimapCanvas } from './build.js';
import { Car, buildCarModel } from './car.js';
import { Race, formatTime } from './race.js';
import { buildLandmarks } from './landmarks.js';
import { planFootbridges, buildFootbridges } from './footbridges.js';
import { Sound } from './audio.js';
import { Traffic } from './traffic.js';
import { Signals } from './signals.js';
import { isTouch, setupTouch, toggleFullscreen } from './touch.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('loading-text').textContent = t; };
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function main() {
  status('Загружаю карту…');
  const city = await (await fetch('city.json')).json();
  status('Строю рельеф и дороги…');
  await frame();

  // На телефоне экономим: без MSAA, плотность пикселей не выше 1.5, тени мельче.
  const renderer = new THREE.WebGLRenderer({ antialias: !isTouch });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color('#a9c4dc');
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
  const terrain = buildTerrain(world, renderer);
  scene.add(terrain.mesh);
  scene.add(buildRoads(world, renderer));
  status('Строю дома…');
  await frame();
  scene.add(buildBuildings(world, renderer));
  scene.add(...buildTrees(world));
  scene.add(buildFootbridges(world, terrain.mesh.material));
  const landmarks = buildLandmarks(world);
  scene.add(landmarks.group);
  const minimap = buildMinimapCanvas(world);

  const model = buildCarModel();
  scene.add(model);
  const car = new Car(world, model);
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
  const traffic = new Traffic(world, scene);
  const signals = new Signals(world, traffic, scene);
  traffic.reset(car.pos.x, car.pos.y);
  window.game = { world, car, race, respawnAt, landmarks, traffic, signals }; // для отладки из консоли

  // ---------------------------------------------------------------- ввод

  const sound = new Sound();
  game.sound = sound;
  // iOS разрешает звук только из обработчика касания/клика.
  for (const ev of ['pointerdown', 'touchend', 'click']) addEventListener(ev, () => sound.unlock());

  // Действия общие для клавиатуры и сенсорных кнопок.
  const actions = {
    sound: () => sound.toggleMute(),
    traffic: () => { traffic.setEnabled(!traffic.enabled); return traffic.enabled; },
    respawn: () => respawnAt(car.pos.x, car.pos.y),
    race: () => race.start(car.pos.x, car.pos.y),
    camera: () => { camMode = (camMode + 1) % 3; },
    map: () => $('minimap').classList.toggle('big'),
    fullscreen: toggleFullscreen,
  };
  const KEY_ACTIONS = { KeyV: 'sound', KeyT: 'traffic', KeyR: 'respawn', KeyN: 'race', KeyC: 'camera', KeyM: 'map' };

  const keys = new Set();
  const analog = { steer: null }; // сенсорный руль, -1..1; null — рулим клавишами
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    sound.unlock();
    if (!e.repeat && KEY_ACTIONS[e.code]) actions[KEY_ACTIONS[e.code]]();
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

  let camMode = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camInit = false;
  function updateCamera(dt) {
    const f = car.forward;
    const speed = Math.abs(car.speed);
    // 0 — за машиной, 1 — из салона, 2 — высоко сверху (видно город и пруд).
    const back = [8.5 + speed * 0.04, 0.2, 70][camMode];
    const up = [3.3, 1.25, 55][camMode];
    const want = new THREE.Vector3(car.pos.x - f.x * back, car.y + up, car.pos.y - f.y * back);
    want.y = Math.max(want.y, world.ground(want.x, want.z) + 1.2);
    const look = new THREE.Vector3(car.pos.x + f.x * 6, car.y + 1.3, car.pos.y + f.y * 6);
    const k = camMode === 1 ? 1 : 1 - Math.exp(-dt * 7);
    if (!camInit) { camPos.copy(want); camLook.copy(look); camInit = true; }
    camPos.lerp(want, k);
    camLook.lerp(look, k);
    camera.position.copy(camPos);
    if (car.impact > 0) {
      camera.position.x += (Math.random() - 0.5) * car.impact * 0.6;
      camera.position.y += (Math.random() - 0.5) * car.impact * 0.6;
    }
    const ov = window.game?.camOverride; // отладка: { pos: [x,y,z], look: [x,y,z] }
    if (ov) camera.position.set(...ov.pos);
    camera.lookAt(ov ? new THREE.Vector3(...ov.look) : camLook);
    const fov = 62 + Math.min(18, speed * 0.28);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    model.visible = camMode !== 1;
  }

  // ---------------------------------------------------------------- HUD

  const mm = $('minimap');
  const mg = mm.getContext('2d');
  function drawMinimap() {
    const size = mm.width;
    const { canvas: src, scale } = minimap;
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
    mg.drawImage(src, 0, 0);
    for (const m of landmarks.markers) {
      mg.beginPath();
      mg.arc((m.x - xmin) * scale, (m.z - zmin) * scale, 4 / zoom, 0, 7);
      mg.fillStyle = '#e0b84a';
      mg.fill();
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
    mg.fillStyle = '#ff3b30';
    mg.beginPath();
    mg.moveTo(size / 2, size / 2 - 8);
    mg.lineTo(size / 2 - 6, size / 2 + 6);
    mg.lineTo(size / 2 + 6, size / 2 + 6);
    mg.fill();
  }

  let lastStreet = '';
  function updateHud() {
    $('speed').textContent = Math.round(Math.abs(car.speed) * 3.6);
    $('nitro-fill').style.width = `${car.nitro * 100}%`;
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
    if (race.state === 'countdown') {
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
    $('time').textContent = formatTime(race.time);
    $('cp').textContent = race.checkpoints.length ? `${Math.min(race.next, race.checkpoints.length)}/${race.checkpoints.length}` : '–';
    $('dist').textContent = `${(race.length / 1000).toFixed(1)} км`;
    drawMinimap();
  }

  // ---------------------------------------------------------------- цикл

  $('loading').remove();
  const clock = new THREE.Clock();
  const STEP = 1 / 120;
  let acc = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    acc += dt;
    const inp = race.state === 'countdown' ? {} : input();
    while (acc >= STEP) {
      car.update(STEP, inp);
      acc -= STEP;
    }
    race.update(dt, car);
    signals.update(dt);
    traffic.update(dt, car);
    sound.update(dt, car, inp, race);
    landmarks.group.userData.update(performance.now() / 1000);
    updateCamera(dt);
    sun.target.position.set(car.pos.x, car.y, car.pos.y);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 300);
    updateHud();
    renderer.render(scene, camera);
  });
}

main().catch((e) => {
  console.error(e);
  status(`Ошибка: ${e.message}`);
});
