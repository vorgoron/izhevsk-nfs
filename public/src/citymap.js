// Большая карта города (M, нажатие на миникарту): весь Ижевск, север сверху. Тянуть — двигать, колесо или
// два пальца — масштаб. На карте — машина, заправки, достопримечательности, камеры, другие игроки, маршрут.
// Нажатие на место или значок — маршрут туда по улицам (стрелки на дороге — guide.js). Пока карта открыта,
// игра стоит, как в меню.
// Подложка (вода, парки, дома, улицы) рисуется один раз в отдельный холст — в фоне после старта (prepare);
// крупнее её масштаба поверх ложатся плитки, нарисованные вектором под масштаб (#tiles).

const ZOOM_MIN = 0.04, ZOOM_MAX = 2.5; // экранных пикселей на метр
const TAP = 8;             // px: сдвиг меньше — нажатие, а не перетаскивание
const HIT = 16;            // px: радиус попадания по значку
const SNAP = 300;          // м: нажатие дальше от улиц — маршрута нет

const SLICE = 6;            // мс: столько за раз рисуется подложка в фоне
const BATCH = 300;         // домов в одном пути подложки
const CELL = 250;          // м: ячейка индекса, по которому плитка берёт своё
const TILE = 512;          // px: сторона плитки (вектором, когда карта крупнее подложки)
const TILES = 64;          // плиток в памяти (по 1 МБ); видимые не выбрасываются
const TILE_MS = 12;        // мс за кадр на новые плитки

const ROAD_COLOR = { trunk: '#e8b44a', primary: '#e8c46a', secondary: '#d9d2bd', tertiary: '#c9c4b5' };

export class CityMap {
  #work = null; // недорисованная подложка (генератор #steps)
  tiles = new Map(); // 'k/i/j' → холст плитки, по давности использования

  // world, car; poi() — значки: [{ kind: 'fuel'|'landmark'|'camera'|'ghost', name, x, z }];
  // onRoute(route | null, target) — проложен / сброшен маршрут.
  // base — пикселей подложки на метр (на телефоне меньше: холст на весь город).
  constructor({ world, car, poi, onRoute, extra, base = 0.2 }) {
    this.world = world;
    this.B = base;
    this.car = car;
    this.poi = poi;
    this.onRoute = onRoute;
    this.extra = extra; // () => [{ route, color }] — маршрут гонки и т. п.
    this.isOpen = false;
    this.target = null; // { x, z, name, route }
    this.zoom = 0.25;
    this.cx = 0; this.cz = 0;

    const el = (this.el = document.createElement('div'));
    el.id = 'citymap';
    el.innerHTML = `<canvas></canvas>
      <div class="bar"><b>Карта Ижевска</b><span class="info"></span>
        <button data-act="fuel">⛽ Ближайшая АЗС</button><button data-act="clear" hidden>✕ Сбросить маршрут</button>
        <button data-act="close">Закрыть <kbd>M</kbd></button></div>
      <div class="zoom"><button data-z="1.5">+</button><button data-z="0.667">−</button><button data-act="me">◎</button></div>
      <div class="legend"><span><i class="me"></i>вы</span><span>⛽ заправки</span><span><i class="lm"></i>достопримечательности</span><span>📷 камеры</span>
        <span class="hint">нажмите на место — маршрут туда</span></div>`;
    document.body.append(el);
    this.cv = el.querySelector('canvas');
    this.g = this.cv.getContext('2d');
    el.querySelector('[data-act=close]').addEventListener('click', () => this.close());
    el.querySelector('[data-act=clear]').addEventListener('click', () => this.clear());
    el.querySelector('[data-act=me]').addEventListener('click', () => { this.cx = this.car.pos.x; this.cz = this.car.pos.y; this.draw(); });
    el.querySelector('[data-act=fuel]').addEventListener('click', () => {
      const st = this.poi().filter((p) => p.kind === 'fuel')
        .sort((a, b) => Math.hypot(a.x - car.pos.x, a.z - car.pos.y) - Math.hypot(b.x - car.pos.x, b.z - car.pos.y))[0];
      if (st) this.go(st.x, st.z, `АЗС ${st.name}`);
    });
    for (const b of el.querySelectorAll('[data-z]')) b.addEventListener('click', () => this.#zoomAt(innerWidth / 2, innerHeight / 2, +b.dataset.z));
    this.#input();
    addEventListener('resize', () => this.isOpen && this.draw());
    // Esc закрывает карту, а не открывает меню (main.js пропускает погашенные события, как у гаража).
    addEventListener('keydown', (e) => {
      if (!this.isOpen || e.code !== 'Escape') return;
      e.preventDefault();
      this.close();
    });
  }

  // ---------------------------------------------------------------- подложка

  // Заранее, в фоне: подложка рисуется кусками по SLICE мс между кадрами, игра не встаёт.
  prepare() {
    const steps = this.#steps();
    const tick = () => {
      if (this.baseCv) return; // успели открыть карту — дорисовано целиком
      const end = performance.now() + SLICE;
      while (performance.now() < end) if (steps.next().done) return;
      setTimeout(tick, 0);
    };
    this.#work = steps;
    tick();
  }

  // Готовая подложка; недорисованная в фоне — дорисовывается сразу.
  #base() {
    if (this.baseCv) return this.baseCv;
    const steps = this.#work ?? this.#steps();
    while (!steps.next().done);
    return this.baseCv;
  }

  // Подложка по шагам (генератор): весь город в один холст масштаба B. Холст — в baseCv по окончании.
  *#steps() {
    const [xmin, zmin, xmax, zmax] = this.world.bounds;
    const c = document.createElement('canvas');
    c.width = Math.ceil((xmax - xmin) * this.B);
    c.height = Math.ceil((zmax - zmin) * this.B);
    const g = c.getContext('2d');
    g.fillStyle = '#1b1f22';
    g.fillRect(0, 0, c.width, c.height);
    const { items } = yield* this.#index();
    yield* this.#paint(g, this.B, xmin, zmin, items.map((_, i) => i));
    this.baseCv = c;
  }

  // Всё, что на подложке, — одним списком в порядке рисования (вода и парки, реки, дома, улицы: мелкие, крупные
  // поверх) и сетка ячеек по CELL м с номерами того, что в них попадает, — чтобы плитка брала только своё.
  *#index() {
    if (this.idx) return this.idx;
    const w = this.world, [xmin, zmin, xmax, zmax] = w.bounds;
    const nx = Math.ceil((xmax - xmin) / CELL), nz = Math.ceil((zmax - zmin) / CELL);
    const cells = Array.from({ length: nx * nz }, () => []), items = [];
    const add = (it, pad = 0) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of it.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const id = items.push(it) - 1;
      const cx = (x) => Math.max(0, Math.min(nx - 1, Math.floor((x - xmin) / CELL)));
      const cz = (z) => Math.max(0, Math.min(nz - 1, Math.floor((z - zmin) / CELL)));
      for (let j = cz(z0 - pad); j <= cz(z1 + pad); j++) for (let i = cx(x0 - pad); i <= cx(x1 + pad); i++) cells[j * nx + i].push(id);
    };
    for (const a of w.city.areas) {
      const c = a.k === 'water' ? '#24465c' : a.k === 'park' ? (a.f ? '#1f2e1c' : '#25331f') : a.k === 'grass' ? '#222b1f' : a.k === 'industrial' ? '#24242a' : null;
      if (c) add({ k: 'a', p: a.p, holes: a.holes, c });
    }
    for (const r of w.city.waterways) add({ k: 'l', p: r.p, w: r.w, min: 0.8, c: '#24465c' }, r.w);
    yield;
    for (const b of w.city.buildings) add({ k: 'b', p: b.p });
    yield;
    const order = (k) => ['trunk', 'primary', 'secondary', 'tertiary'].indexOf(k);
    for (const r of [...w.roads].sort((a, b) => order(a.k) - order(b.k))) {
      add({ k: 'l', p: r.n.map((id) => w.nodes[id]), w: r.w, min: r.k in ROAD_COLOR ? 1.6 : 0.8, c: ROAD_COLOR[r.k] ?? '#6f6d68' }, r.w);
    }
    return (this.idx = { items, cells, nx, nz });
  }

  // Рисует items[ids] (ids — по возрастанию, это и есть порядок) в масштабе S пикселей на метр, (ox, oz) — левый
  // верхний угол. Дома — общим путём пачками по BATCH (весь город одним путём заливается секундами).
  *#paint(g, S, ox, oz, ids) {
    const items = this.idx.items;
    const tx = (x) => (x - ox) * S, tz = (z) => (z - oz) * S;
    const ring = (p) => { g.moveTo(tx(p[0][0]), tz(p[0][1])); for (const [x, z] of p) g.lineTo(tx(x), tz(z)); g.closePath(); };
    g.lineCap = g.lineJoin = 'round';
    g.fillStyle = '#30343a';
    let houses = 0;
    const flush = () => { if (houses) { g.fillStyle = '#30343a'; g.fill(); houses = 0; } };
    for (const id of ids) {
      const it = items[id];
      if (it.k === 'b') {
        if (!houses) g.beginPath();
        ring(it.p);
        if (++houses === BATCH) { flush(); yield; }
        continue;
      }
      flush();
      g.beginPath();
      if (it.k === 'a') {
        ring(it.p);
        for (const h of it.holes || []) ring(h);
        g.fillStyle = it.c;
        g.fill('evenodd');
      } else {
        it.p.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](tx(x), tz(z)));
        g.lineWidth = Math.max(it.min, it.w * S);
        g.strokeStyle = it.c;
        g.stroke();
      }
      yield;
    }
    flush();
  }

  // ---------------------------------------------------------------- плитки

  // Крупнее подложки — плитки TILE×TILE, нарисованные вектором под масштаб: уровень k — B·2^k пикселей экрана на
  // метр, ближайший не мельче нужного. Каждая рисуется один раз и кешируется (до TILES последних); не успели
  // за TILE_MS — пока видна размытая подложка, дорисовываем в следующих кадрах.
  #tiles(g, dpr, W, H) {
    const need = this.zoom * dpr;
    if (need <= this.B * 1.25) return;
    const k = Math.min(Math.ceil(Math.log2(ZOOM_MAX * 2 / this.B)), Math.ceil(Math.log2(need / this.B)));
    const S = this.B * 2 ** k, m = TILE / S; // м на плитку
    const [xmin, zmin, xmax, zmax] = this.world.bounds;
    const cell = (v, lo, hi) => Math.max(0, Math.min(Math.floor((hi - lo) / m), Math.floor((v - lo) / m)));
    const i0 = cell(this.#wx(0), xmin, xmax), i1 = cell(this.#wx(W), xmin, xmax);
    const j0 = cell(this.#wz(0), zmin, zmax), j1 = cell(this.#wz(H), zmin, zmax);
    const px = (v) => Math.round(v * dpr), end = performance.now() + TILE_MS;
    let missing = false;
    g.save();
    g.beginPath();
    g.rect(this.#sx(xmin), this.#sz(zmin), (xmax - xmin) * this.zoom, (zmax - zmin) * this.zoom);
    g.clip();
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${k}/${i}/${j}`;
      let t = this.tiles.get(key);
      if (t) this.tiles.delete(key);
      else if (performance.now() < end) t = this.#tile(S, xmin + i * m, zmin + j * m);
      else { missing = true; continue; }
      this.tiles.set(key, t); // в конец: недавно нужная
      const x0 = px(this.#sx(xmin + i * m)), x1 = px(this.#sx(xmin + (i + 1) * m));
      const y0 = px(this.#sz(zmin + j * m)), y1 = px(this.#sz(zmin + (j + 1) * m));
      g.drawImage(t, x0, y0, x1 - x0, y1 - y0);
    }
    g.restore();
    const keep = Math.max(TILES, (i1 - i0 + 1) * (j1 - j0 + 1));
    for (const key of this.tiles.keys()) { if (this.tiles.size <= keep) break; this.tiles.delete(key); }
    if (missing && !this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  #tile(S, x0, z0) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d');
    g.fillStyle = '#1b1f22';
    g.fillRect(0, 0, TILE, TILE);
    const { cells, nx, nz } = this.idx, [xmin, zmin] = this.world.bounds, m = TILE / S;
    const ids = new Set();
    const ci = (v, lo, n) => Math.max(0, Math.min(n - 1, Math.floor((v - lo) / CELL)));
    for (let j = ci(z0, zmin, nz); j <= ci(z0 + m, zmin, nz); j++) {
      for (let i = ci(x0, xmin, nx); i <= ci(x0 + m, xmin, nx); i++) for (const id of cells[j * nx + i]) ids.add(id);
    }
    for (const _ of this.#paint(g, S, x0, z0, [...ids].sort((a, b) => a - b)));
    return c;
  }

  // ---------------------------------------------------------------- вид

  #sx(x) { return (x - this.cx) * this.zoom + this.cv.clientWidth / 2; }
  #sz(z) { return (z - this.cz) * this.zoom + this.cv.clientHeight / 2; }
  #wx(sx) { return (sx - this.cv.clientWidth / 2) / this.zoom + this.cx; }
  #wz(sz) { return (sz - this.cv.clientHeight / 2) / this.zoom + this.cz; }

  #zoomAt(sx, sy, k) {
    const x = this.#wx(sx), z = this.#wz(sy);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * k));
    this.cx = x - (sx - this.cv.clientWidth / 2) / this.zoom;
    this.cz = z - (sy - this.cv.clientHeight / 2) / this.zoom;
    this.draw();
  }

  #input() {
    const cv = this.cv, pts = new Map();
    let moved = 0, pinch = 0;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      moved = 0;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p[0], dy = e.clientY - p[1];
      p[0] = e.clientX; p[1] = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.#zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch);
        pinch = d;
        moved = TAP + 1;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > TAP) { this.cx -= dx / this.zoom; this.cz -= dy / this.zoom; this.draw(); }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0 && moved <= TAP && e.type === 'pointerup') this.#tap(e.clientX, e.clientY);
      if (pts.size < 2) pinch = 0;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.#zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }

  // Нажатие: значок рядом — маршрут к нему, иначе — к ближайшей улице.
  #tap(sx, sy) {
    const r = this.cv.getBoundingClientRect();
    sx -= r.left; sy -= r.top;
    let hit = null, hd = HIT;
    for (const p of this.poi()) {
      const d = Math.hypot(this.#sx(p.x) - sx, this.#sz(p.z) - sy);
      if (d < hd) { hd = d; hit = p; }
    }
    if (hit) return this.go(hit.x, hit.z, hit.kind === 'fuel' ? `АЗС ${hit.name}` : hit.name);
    const x = this.#wx(sx), z = this.#wz(sy);
    const name = this.world.nearestRoad(x, z, 60)?.seg.road.name;
    this.go(x, z, name || null);
  }

  // Маршрут от машины до точки по графу улиц. false — туда не проехать.
  go(x, z, name) {
    const w = this.world;
    const to = w.nearestGraphNode(x, z), [nx, nz] = w.nodes[to];
    if (Math.hypot(nx - x, nz - z) > SNAP) return this.#info('Туда не проехать — выберите место у дороги'), false;
    const route = this.route(to);
    if (!route) return this.#info('Маршрут не найден'), false;
    this.target = { x: nx, z: nz, name, node: to, route };
    this.onRoute(route, this.target);
    this.draw();
    return true;
  }

  // Путь от машины до узла to — массив точек [x, z], первая — где машина (world.navRoute: по своей
  // стороне, без встречки, назад — через разворот).
  route(to) {
    return this.world.navRoute(this.car.pos.x, this.car.pos.y, this.car.heading, to);
  }

  // Перестроить маршрут от текущего места (съехал с маршрута).
  reroute() {
    if (!this.target) return;
    const route = this.route(this.target.node);
    if (!route) return;
    this.target.route = route;
    this.onRoute(route, this.target);
  }

  clear() {
    this.target = null;
    this.onRoute(null, null);
    if (this.isOpen) this.draw();
  }

  // ---------------------------------------------------------------- рисование

  #info(text) {
    this.infoText = text;
    clearTimeout(this.infoT);
    this.infoT = setTimeout(() => { this.infoText = null; this.isOpen && this.draw(); }, 3000);
    this.draw();
  }

  draw() {
    if (!this.isOpen) return;
    const cv = this.cv, g = this.g, dpr = Math.min(devicePixelRatio, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#15181b';
    g.fillRect(0, 0, W, H);
    const base = this.#base(), [xmin, zmin] = this.world.bounds;
    g.imageSmoothingEnabled = true;
    g.drawImage(base, this.#sx(xmin), this.#sz(zmin), base.width / this.B * this.zoom, base.height / this.B * this.zoom);
    this.#tiles(g, dpr, W, H);

    const line = (route, color, width) => {
      g.beginPath();
      route.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](this.#sx(x), this.#sz(z)));
      g.lineCap = g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,.55)';
      g.lineWidth = width + 3;
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
    };
    for (const { route, color } of this.extra?.() ?? []) if (route?.length > 1) line(route, color, 4);
    if (this.target) {
      line(this.target.route, '#4ab3ff', 5);
      this.#pin(this.#sx(this.target.x), this.#sz(this.target.z));
    }

    // Значки: подписи достопримечательностей — когда карта достаточно крупная; налезающая на другую — не пишем.
    this.labels = [];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.poi()) {
      const x = this.#sx(p.x), y = this.#sz(p.z);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      if (p.kind === 'fuel') {
        g.fillStyle = '#e07a1f';
        g.beginPath(); g.roundRect(x - 9, y - 9, 18, 18, 4); g.fill();
        g.font = '12px sans-serif'; g.fillText('⛽', x, y + 1);
        if (this.zoom > 0.5) this.#label(p.name, x, y + 16);
      } else if (p.kind === 'landmark') {
        g.fillStyle = '#e0b84a';
        g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
        g.strokeStyle = '#15181b'; g.lineWidth = 2; g.stroke();
        if (this.zoom > 0.3) this.#label(p.name, x, y + 15);
      } else if (p.kind === 'camera' && this.zoom > 0.15) {
        g.font = '13px sans-serif'; g.fillText('📷', x, y);
      } else if (p.kind === 'ghost') {
        g.fillStyle = '#4ab3ff';
        g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
        this.#label(p.name, x, y - 14);
      }
    }
    // Своя машина — стрелка по курсу.
    const x = this.#sx(this.car.pos.x), y = this.#sz(this.car.pos.y), h = this.car.heading;
    g.save();
    g.translate(x, y);
    g.rotate(-h + Math.PI);
    g.fillStyle = '#ff3b30';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath();
    g.fill(); g.stroke();
    g.restore();

    const t = this.target;
    const info = this.infoText ?? (t ? `→ ${t.name || 'точка на карте'} · ${fmtDist(routeLen(t.route))}` : '');
    this.el.querySelector('.info').textContent = info;
    this.el.querySelector('[data-act=clear]').hidden = !t;
  }

  #label(text, x, y) {
    const g = this.g;
    g.font = '600 12px system-ui, sans-serif';
    const w = g.measureText(text).width + 10;
    if (this.labels.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 && Math.abs(r.y - y) < 17)) return;
    this.labels.push({ x, y, w });
    g.fillStyle = 'rgba(10,12,14,.7)';
    g.beginPath(); g.roundRect(x - w / 2, y - 8, w, 16, 5); g.fill();
    g.fillStyle = '#fff';
    g.fillText(text, x, y + 0.5);
  }

  #pin(x, y) {
    const g = this.g;
    g.fillStyle = '#4ab3ff';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x - 12, y - 14, x - 9, y - 28, x, y - 28);
    g.bezierCurveTo(x + 9, y - 28, x + 12, y - 14, x, y);
    g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x, y - 19, 4, 0, 7); g.fill();
  }

  // ---------------------------------------------------------------- открыть / закрыть

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.el.classList.add('open');
    document.body.classList.add('in-map');
    this.cx = this.car.pos.x;
    this.cz = this.car.pos.y;
    this.draw();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    document.body.classList.remove('in-map');
    this.tiles.clear(); // память — игре
    this.onClose?.();
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
}

export const routeLen = (r) => r.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0);
const fmtDist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(1)} км`);
