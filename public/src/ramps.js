// Трамплины-ускорители на трассе гонки: стоят сами на прямых участках маршрута, кромкой по ходу гонки. Заехал — машину
// разгоняет (car.js, RAMP_BOOST), с кромки улетаешь (air.kind 'ramp'), прыжок тем выше, чем быстрее. Места считаются
// из маршрута — в общей гонке у всех одни и те же, в базу ничего не пишем.
import * as THREE from 'three';

export const RAMP_W = 4, RAMP_L = 7, RAMP_H = 1.8;
const STEP = 700;       // м по маршруту: не чаще
const FIRST = 250;      // м: не раньше от старта
const END_GAP = 200;    // м: не ближе к финишу
const GATE_GAP = 60;    // м: не у самых ворот
const BEFORE = 40, AFTER = 120; // м прямой дороги до трамплина и после (там посадка)
const STRAIGHT = 12 * Math.PI / 180; // поворот маршрута на этих отрезках — не больше
const SIDE = 2.5;       // м вправо от оси улицы — на своей полосе
const BRIDGE = 1;       // м: поверхность выше рельефа — мост или эстакада, туда не ставим
const MATCH = 0.3;      // заехать можно только спереди: cos угла между курсом машины и трамплина не меньше этого
const LEVEL = 3;        // м: по высоте дальше — не наш уровень (мост над трамплином)

// Клин: наклонная поверхность (полосы, своя текстура) и тёмные бока с торцом.
function wedge() {
  const w = RAMP_W / 2, l = RAMP_L / 2, h = RAMP_H;
  const bl = [-w, 0, -l], br = [w, 0, -l], fl = [-w, 0, l], fr = [w, 0, l], tl = [-w, h, l], tr = [w, h, l];
  const pos = [], uv = [];
  const tri = (a, b, c, ua = [0, 0], ub = [0, 0], uc = [0, 0]) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  tri(bl, tr, br, [0, 0], [1, 1], [1, 0]); tri(bl, tl, tr, [0, 0], [0, 1], [1, 1]); // наклон
  tri(fl, fr, tr); tri(fl, tr, tl);   // торец
  tri(bl, fl, tl); tri(br, tr, fr);   // бока
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, 6, 0);
  g.addGroup(6, 12, 1);
  g.computeVertexNormals();
  return g;
}

// Шевроны остриём к кромке, светятся — ускоритель видно издалека.
function stripes() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#29d3ff';
  for (let y = -32; y < 128; y += 32) {
    g.beginPath(); g.moveTo(0, y + 16); g.lineTo(32, y); g.lineTo(64, y + 16); g.lineTo(64, y + 28); g.lineTo(32, y + 12); g.lineTo(0, y + 28); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Ramps {
  constructor(world, scene) {
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geo = wedge();
    const map = stripes();
    this.mats = [new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.9, flatShading: true })];
    this.list = [];
    this.dists = []; // м по маршруту — чтобы канистры не вставали на трамплин
  }

  // Расставить по маршруту race (после race.start / startShared).
  set(race) {
    this.clear();
    const gates = race.checkpoints.map((cp) => race.cum[cp.i]);
    const ang = (a, b) => { const d = Math.atan2(b.dx, b.dz) - Math.atan2(a.dx, a.dz); return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); };
    const dir = (d0, d1) => { const a = race.at(d0), b = race.at(d1), l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { dx: (b.x - a.x) / l, dz: (b.z - a.z) / l }; };
    for (let d = FIRST; d < race.length - END_GAP; d += 20) {
      if (this.dists.length && d - this.dists.at(-1) < STEP) continue;
      if (gates.some((g) => Math.abs(g - d) < GATE_GAP)) continue;
      const a = dir(d - BEFORE, d), b = dir(d, d + AFTER / 2), c = dir(d + AFTER / 2, d + AFTER);
      if (ang(a, b) > STRAIGHT || ang(b, c) > STRAIGHT || ang(a, c) > STRAIGHT) continue;
      const p = race.at(d), x = p.x - b.dz * SIDE, z = p.z + b.dx * SIDE;
      const t = this.world.terrain(x, z);
      if (this.world.ground(x, z) - t > BRIDGE) continue;
      this.#make(x, z, Math.atan2(b.dx, b.dz), t);
      this.dists.push(d);
    }
  }

  clear() {
    this.group.clear();
    this.list = [];
    this.dists = [];
  }

  #make(x, z, h, y) {
    const mesh = new THREE.Mesh(this.geo, this.mats);
    mesh.position.set(x, y, z);
    mesh.rotation.y = h;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.list.push({ x, z, h, y, dx: Math.sin(h), dz: Math.cos(h), mesh });
  }

  // Трамплин под точкой (x, z) на высоте около y, на который заезжаем курсом (fx, fz): высота поверхности,
  // доля длины от низа (1 — кромка) и уклон. null — нет.
  at(x, z, y, fx, fz) {
    for (const r of this.list) {
      if (Math.abs(r.x - x) > RAMP_L || Math.abs(r.z - z) > RAMP_L || Math.abs(r.y - y) > LEVEL) continue;
      if (fx * r.dx + fz * r.dz < MATCH) continue;
      const rx = x - r.x, rz = z - r.z, u = rx * r.dx + rz * r.dz, v = rz * r.dx - rx * r.dz;
      if (Math.abs(v) > RAMP_W / 2 || Math.abs(u) > RAMP_L / 2) continue;
      const k = u / RAMP_L + 0.5;
      return { y: r.y + RAMP_H * k, k, slope: RAMP_H / RAMP_L };
    }
    return null;
  }
}
