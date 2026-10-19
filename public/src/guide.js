// Стрелки на дороге вдоль маршрута (как в Need for Speed): шевроны лежат на полотне впереди машины и
// показывают, куда ехать, — у гонки (race.js) и у маршрута, проложенного по большой карте (citymap.js).
// По шевронам бежит волна яркости — от машины вперёд.
import * as THREE from 'three';

const STEP = 7;       // м между шевронами
const FROM = 7;       // м от машины до первого
const AHEAD = 150;    // м: дальше не рисуем
const MAX = Math.ceil((AHEAD - FROM) / STEP) + 1;
const LIFT = 0.12;    // м над полотном
const SEARCH = 40;    // узлов маршрута вперёд от прошлого места, где ищем машину

// Шеврон «^» 2,6 × 1,8 м, остриём к +z, лежит в плоскости xz.
function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1.3, -0.6); s.lineTo(0, 0.5); s.lineTo(1.3, -0.6); s.lineTo(1.3, 0.1);
  s.lineTo(0, 1.2); s.lineTo(-1.3, 0.1); s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).scale(1, 1, -1);
}

export class RouteGuide {
  constructor(world, scene, color = '#ffd23f') {
    this.world = world;
    this.mesh = new THREE.InstancedMesh(chevronGeometry(), new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.base = new THREE.Color(color);
    this.mesh.setColorAt(0, this.base);
    scene.add(this.mesh);
    this.route = null;
    this.cursor = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.c = new THREE.Color();
  }

  // Новый маршрут — массив точек [x, z]; null — убрать стрелки.
  set(route) {
    this.route = route?.length > 1 ? route : null;
    this.cursor = 0;
    if (!this.route) this.mesh.count = 0;
  }

  // Где машина на маршруте: ближайший отрезок рядом с прошлым местом (маршрут может идти рядом сам с собой).
  // Возвращает { i, t, d } — отрезок i→i+1, доля t, расстояние d.
  // Далеко от прошлого места (гонку начали заново, срезал) — ищем по всему маршруту.
  locate(x, z, all = false) {
    const r = this.route;
    let best = { i: this.cursor, t: 0, d: Infinity };
    const lo = all ? 0 : Math.max(0, this.cursor - 2), hi = all ? r.length - 1 : Math.min(r.length - 1, this.cursor + SEARCH);
    for (let i = lo; i < hi; i++) {
      const [ax, az] = r[i], [bx, bz] = r[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best.d) best = { i, t, d };
    }
    if (best.d > 60 && !all) return this.locate(x, z, true);
    this.cursor = best.i;
    return best;
  }

  update(car) {
    const r = this.route;
    if (!r) return;
    const { i: i0, t: t0 } = this.locate(car.pos.x, car.pos.y);
    const now = performance.now() / 1000;
    let n = 0, i = i0, along = -t0 * Math.hypot(r[i0 + 1][0] - r[i0][0], r[i0 + 1][1] - r[i0][1]);
    for (let s = FROM; s <= AHEAD && n < MAX; s += STEP) {
      // Идём по маршруту до расстояния s от машины.
      let L;
      while (i < r.length - 1 && along + (L = Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1])) < s) { along += L; i++; }
      if (i >= r.length - 1) break;
      const [ax, az] = r[i], [bx, bz] = r[i + 1];
      L = Math.hypot(bx - ax, bz - az) || 1;
      const k = (s - along) / L, x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      const y = this.world.ground(x, z, car.y + 3) + LIFT;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(bx - ax, bz - az));
      this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(n, this.m);
      // Волна яркости бежит вперёд; дальние шевроны тусклее.
      const wave = 0.65 + 0.35 * Math.max(0, Math.cos((s / 40 - now * 1.6) * Math.PI * 2)) ** 4;
      this.mesh.setColorAt(n, this.c.copy(this.base).multiplyScalar(wave * (1 - 0.45 * (s / AHEAD))));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
