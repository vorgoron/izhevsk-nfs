// Стрелки на дороге вдоль маршрута (как в Need for Speed): шевроны лежат на полотне впереди машины и
// показывают, куда ехать, — у гонки (race.js) и у маршрута, проложенного по большой карте (citymap.js).
// Шевроны лежат на маршруте неподвижно, машина проезжает по ним; полупрозрачные — видна разметка.
// По шевронам бежит волна яркости — от машины вперёд.
import * as THREE from 'three';

const STEP = 7;       // м между шевронами
const TURN = 0.5;     // рад: на крутом повороте (разворот) шеврон ставится раньше — как только курс сменился на столько,
const DENSE = 2.5;    // м: но не ближе этого к прошлому
// Поворот (курс за CORNER_W м до и после точки различается больше CORNER) — шевроны через CORNER_STEP
// от CORNER_BEFORE м до него и до CORNER_AFTER после: так поворот не пропустить.
const CORNER = 0.35, CORNER_W = 10, CORNER_BEFORE = 30, CORNER_AFTER = 12, CORNER_STEP = 3.5;
const FROM = 2;       // м: ближе к машине шеврон гаснет (она по нему проехала)
const AHEAD = 150;    // м: дальше не рисуем
const MAX = Math.ceil((AHEAD - FROM) / CORNER_STEP) + 20;
const LIFT = 0.12;    // м над полотном
const LEFT = 12, RIGHT = 20; // м: полуширина окна сглаживания на повороте налево / направо (см. rounded)
const SWING = 2;      // вынос наружу перед поворотом направо: прямой угол — заход ~2,4 м левее, срез угла ~1,7 м
const SEARCH = 120;   // узлов маршрута вперёд от прошлого места, где ищем машину

// Шеврон «^» 2,6 × 1,8 м, остриём к +z, лежит в плоскости xz.
function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1.3, -0.6); s.lineTo(0, 0.5); s.lineTo(1.3, -0.6); s.lineTo(1.3, 0.1);
  s.lineTo(0, 1.2); s.lineTo(-1.3, 0.1); s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).scale(1, 1, -1);
}

// Маршрут через 1 м, сглаженный скользящим средним по длине: излом становится дугой, прямые остаются прямыми.
// По точкам OSM скруглять нельзя — у перекрёстка узлы через 3–5 м, и дуга на коротком отрезке выходит в метр.
// Простое среднее срезает угол внутрь. На повороте направо внутри — бордюр, поэтому там дуга шире (окно RIGHT) и
// заход с выносом наружу (влево): сглаживается путь, отодвинутый от собственного сглаженного на SWING раз —
// так дуга почти не срезает угол. Налево внутри — середина перекрёстка, там просто среднее с окном LEFT.
function rounded(r) {
  const pts = [];
  for (let i = 1; i < r.length; i++) {
    const [ax, az] = r[i - 1], [bx, bz] = r[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az)));
    for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  pts.push(r[r.length - 1]);
  const N = pts.length;
  // Насколько тут поворот направо (0…1): курс за RIGHT м до точки и после.
  const right = pts.map((p, i) => {
    const a = pts[Math.max(0, i - RIGHT)], b = pts[Math.min(N - 1, i + RIGHT)];
    const ax = p[0] - a[0], az = p[1] - a[1], bx = b[0] - p[0], bz = b[1] - p[1];
    const l = Math.hypot(ax, az) * Math.hypot(bx, bz);
    return l ? Math.max(0, Math.min(1, 4 * (ax * bz - az * bx) / l)) : 0; // правая сторона курса — (−dz, dx)
  });
  const win = right.map((k) => Math.round(LEFT + (RIGHT - LEFT) * k));
  const mean = (q) => q.map((_, i) => {
    const W = Math.min(win[i], i, N - 1 - i); // у концов окно уже — концы на месте
    let x = 0, z = 0;
    for (let j = -W; j <= W; j++) { x += q[i + j][0]; z += q[i + j][1]; }
    return [x / (2 * W + 1), z / (2 * W + 1)];
  });
  const sm = mean(pts);
  return mean(pts.map((p, i) => {
    const k = SWING * right[i];
    return [p[0] + (p[0] - sm[i][0]) * k, p[1] + (p[1] - sm[i][1]) * k];
  }));
}

export class RouteGuide {
  constructor(world, scene) {
    this.world = world;
    this.mesh = new THREE.InstancedMesh(chevronGeometry(), new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false, fog: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.base = new THREE.Color();
    this.mesh.setColorAt(0, this.base);
    scene.add(this.mesh);
    this.route = null;
    this.cursor = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.c = new THREE.Color();
  }

  // Новый маршрут — массив точек [x, z] и цвет стрелок; null — убрать стрелки.
  set(route, color = '#ffd23f') {
    this.route = route?.length > 1 ? route : null;
    this.base.set(color);
    this.cursor = 0;
    if (!this.route) { this.mesh.count = 0; return; }
    this.path = rounded(this.route);
    this.#place();
  }

  // Шевроны стоят на маршруте неподвижно (не едут с машиной): места считаются один раз от начала маршрута —
  // через STEP, на крутом повороте гуще. at — расстояние от начала, x, z, a — курс. cum — длина до точки i.
  #place() {
    const r = this.path;
    this.cum = [0];
    for (let i = 1; i < r.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
    // Точки маршрута через 1 м: положение и курс.
    const pts = [];
    for (let s = 0, i = 0; s <= this.cum[r.length - 1]; s += 1) {
      while (i < r.length - 2 && this.cum[i + 1] < s) i++;
      const [ax, az] = r[i], [bx, bz] = r[i + 1];
      const k = (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1);
      pts.push([ax + (bx - ax) * k, az + (bz - az) * k, Math.atan2(bx - ax, bz - az)]);
    }
    const diff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    // Отрезки у поворотов — гуще.
    const dense = new Uint8Array(pts.length);
    for (let s = CORNER_W; s < pts.length - CORNER_W; s++) {
      if (diff(pts[s + CORNER_W][2], pts[s - CORNER_W][2]) <= CORNER) continue;
      dense.fill(1, Math.max(0, s - CORNER_BEFORE), Math.min(pts.length, s + CORNER_AFTER));
    }
    this.marks = [];
    let last = -Infinity, lastA = 0;
    for (let s = FROM; s < pts.length; s++) {
      const [x, z, a] = pts[s];
      if (s - last < (dense[s] ? CORNER_STEP : STEP) && !(diff(a, lastA) > TURN && s - last >= DENSE)) continue;
      last = s; lastA = a;
      this.marks.push({ at: s, x, z, a });
    }
    this.mark = 0; // первый шеврон впереди машины (ищется от прошлого)
  }

  // Где машина на маршруте: ближайший отрезок рядом с прошлым местом (маршрут может идти рядом сам с собой).
  // Возвращает { i, t, d } — отрезок i→i+1, доля t, расстояние d.
  // Далеко от прошлого места (гонку начали заново, срезал) — ищем по всему маршруту.
  locate(x, z, all = false) {
    const r = this.path;
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
    if (!this.route) return;
    const { i: i0, t: t0 } = this.locate(car.pos.x, car.pos.y);
    const pos = this.cum[i0] + t0 * (this.cum[i0 + 1] - this.cum[i0]); // где машина вдоль маршрута
    const ms = this.marks;
    while (this.mark > 0 && ms[this.mark - 1].at >= pos + FROM) this.mark--;
    while (this.mark < ms.length && ms[this.mark].at < pos + FROM) this.mark++;
    const now = performance.now() / 1000;
    let n = 0;
    for (let j = this.mark; j < ms.length && n < MAX; j++) {
      const { at, x, z, a } = ms[j], s = at - pos;
      if (s > AHEAD) break;
      const y = this.world.ground(x, z, car.y + 3) + LIFT;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a);
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
