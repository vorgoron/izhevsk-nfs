// Подгрузка города квадратами вокруг игрока: земля, дороги, дома, деревья, столбы, щиты, остановки, заборы строятся по мере
// приближения (не больше нескольких квадратов за кадр) и выгружаются, когда игрок уехал.
import * as THREE from 'three';
import {
  buildTerrainChunk, buildRoadChunk, buildBuildingChunk, buildTreeChunk, buildRailChunk, buildPoleChunk, buildBillboardChunk,
  buildStopChunk, stopMaterials, buildFenceChunk, fenceMaterials,
  drawMinimapTile, roadMaterials, buildingMaterials, treeMaterials, poleMaterials, billboardMaterials,
} from './build.js';

const TREE_NEAR = 450; // м до квадрата: ближе — подробные деревья

export class ChunkManager {
  constructor(world, scene, renderer, { radius = 1800, texSize = 1024 } = {}) {
    this.world = world;
    this.scene = scene;
    this.renderer = renderer;
    this.radius = radius;
    this.texSize = texSize;
    this.loaded = new Map(); // ключ → { group, terrain }
    this.breakables = null;  // выставляет main.js: столбы и щиты квадратов ломаются
    this.mats = { roads: roadMaterials(renderer), buildings: buildingMaterials(renderer), trees: treeMaterials(), poles: poleMaterials(),
      ads: billboardMaterials(renderer), stops: stopMaterials(renderer), fences: fenceMaterials(renderer) };
  }

  #key(ci, cj) { return ci * 10000 + cj; }

  // Расстояние до ближайшей точки квадрата.
  #dist(i, j, px, pz) {
    const { sx, sz, xmin, zmin } = this.world.chunk;
    const x0 = xmin + i * sx, z0 = zmin + j * sz;
    return Math.hypot(Math.max(x0 - px, 0, px - (x0 + sx)), Math.max(z0 - pz, 0, pz - (z0 + sz)));
  }

  // Квадраты в радиусе, ближние первыми.
  #wanted(px, pz, radius) {
    const w = this.world, { nci, ncj, sx, sz } = w.chunk;
    const [pi, pj] = w.chunkAt(px, pz);
    const ri = Math.ceil(radius / sx) + 1, rj = Math.ceil(radius / sz) + 1;
    const out = [];
    for (let i = Math.max(0, pi - ri); i <= Math.min(nci - 1, pi + ri); i++) {
      for (let j = Math.max(0, pj - rj); j <= Math.min(ncj - 1, pj + rj); j++) {
        const d = this.#dist(i, j, px, pz);
        if (d <= radius) out.push({ i, j, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  #build(ci, cj) {
    const w = this.world, info = w.chunkInfo(ci, cj);
    const group = new THREE.Group();
    group.userData = { ci, cj, trees: [] };
    const tag = (o, label) => ((o.userData.perf = label), o); // разбивка треугольников в `?perf`
    group.add(tag(buildTerrainChunk(w, info, this.texSize, this.renderer), 'рельеф'));
    if (info.data.runs.length) group.add(tag(buildRoadChunk(w, info.data.runs, this.mats.roads), 'дороги'));
    if (info.data.buildings.length) group.add(tag(buildBuildingChunk(w, info.data.buildings, this.mats.buildings), 'дома'));
    const rails = info.data.rails.length ? buildRailChunk(w, info, this.mats.roads.rail, this.mats.roads.concrete) : null;
    if (rails) group.add(tag(rails, 'рельсы'));
    const trees = buildTreeChunk(w, info, this.mats.trees);
    if (trees.length) group.add(...trees.map((t) => tag(t, 'деревья')));
    for (const t of trees) this.breakables?.addTrees(t);
    group.userData.trees = trees;
    const poles = buildPoleChunk(w, info, this.mats.poles);
    if (poles) group.add(tag(poles, 'столбы'), ...poles.userData.glow.map((o) => tag(o, 'столбы')));
    const ads = buildBillboardChunk(w, info, this.mats.ads);
    if (ads) group.add(...ads.map((o) => tag(o, 'щиты')));
    if (poles) this.breakables?.addPoles(poles);
    if (ads) this.breakables?.addBoards(...ads);
    const stops = buildStopChunk(w, info, this.mats.stops);
    if (stops) group.add(...stops.map((o) => tag(o, 'остановки')));
    const fences = buildFenceChunk(w, info, this.mats.fences);
    if (fences) group.add(...fences.map((o) => tag(o, 'заборы')));
    this.scene.add(group);
    this.loaded.set(this.#key(ci, cj), group);
  }

  #unload(key, group) {
    this.scene.remove(group);
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) this.breakables?.remove(o);
      // Общие материалы и геометрии деревьев не трогаем; своё — геометрии и текстура земли.
      if (o.material === this.mats.ads.face) { o.geometry.dispose(); return; }
      if (!o.isInstancedMesh) o.geometry.dispose();
      else o.dispose();
      if (o.material.map && !this.mats.roads.owns(o.material) && o.material !== this.mats.buildings.walls
        && o.material !== this.mats.stops.sign && !this.mats.fences.owns(o.material)) {
        o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.loaded.delete(key);
  }

  // Каждый кадр: достроить до budget ближайших недостающих, выгрузить далёкие.
  update(px, pz, budget = 1) {
    this.mats.ads.tick(performance.now());
    this.mats.trees.tick(performance.now());
    // Деревья дальних квадратов — упрощённые; зазор между порогами, чтобы на границе не мигали.
    for (const group of this.loaded.values()) {
      const { ci, cj, trees } = group.userData;
      if (!trees.length) continue;
      const d = this.#dist(ci, cj, px, pz), cur = trees[0].geometry === trees[0].userData.lod[1];
      const far = cur ? d > TREE_NEAR - 60 : d > TREE_NEAR;
      if (far !== cur) for (const t of trees) t.geometry = t.userData.lod[far ? 1 : 0];
    }
    // Рядом с машиной — сразу и без лимита (после эвакуатора, рестарта гонки).
    for (const { i, j } of this.#wanted(px, pz, 600)) if (!this.loaded.has(this.#key(i, j))) this.#build(i, j);
    const want = this.#wanted(px, pz, this.radius);
    let built = 0;
    for (const { i, j } of want) {
      if (built >= budget) break;
      if (this.loaded.has(this.#key(i, j))) continue;
      this.#build(i, j);
      built++;
    }
    if (built) return;
    const keep = new Set(this.#wanted(px, pz, this.radius + 500).map(({ i, j }) => this.#key(i, j)));
    for (const [key, group] of this.loaded) if (!keep.has(key)) this.#unload(key, group);
  }

  // Перед стартом: всё в радиусе сразу. Между квадратами отдаём кадр, чтобы полоса загрузки
  // успевала перерисоваться; onProgress получает долю построенного.
  async preload(px, pz, radius = this.radius, onProgress) {
    const todo = this.#wanted(px, pz, radius).filter(({ i, j }) => !this.loaded.has(this.#key(i, j)));
    let t = performance.now();
    for (let n = 0; n < todo.length; n++) {
      this.#build(todo[n].i, todo[n].j);
      onProgress?.((n + 1) / todo.length);
      if (performance.now() - t > 50) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
        t = performance.now();
      }
    }
  }
}

// Миникарта из тайлов по квадратам: рисуются при первом показе, держим последние ~160.
export class MinimapTiles {
  constructor(world) {
    this.world = world;
    this.cache = new Map();
  }

  tile(ci, cj) {
    const key = ci * 10000 + cj;
    let t = this.cache.get(key);
    if (t) {
      this.cache.delete(key); // освежить порядок (LRU)
      this.cache.set(key, t);
      return t;
    }
    t = drawMinimapTile(this.world, this.world.chunkInfo(ci, cj));
    this.cache.set(key, t);
    if (this.cache.size > 160) this.cache.delete(this.cache.keys().next().value);
    return t;
  }

  // Нарисовать тайлы вокруг (px, pz) в текущей системе координат канваса (1 ед. = 1 px тайла).
  draw(g, px, pz, radius, scale, maxNew = 2) {
    const w = this.world, { nci, ncj, sx, sz, xmin, zmin } = w.chunk;
    const [pi, pj] = w.chunkAt(px, pz);
    const ri = Math.ceil(radius / sx), rj = Math.ceil(radius / sz);
    let made = 0;
    for (let i = Math.max(0, pi - ri); i <= Math.min(nci - 1, pi + ri); i++) {
      for (let j = Math.max(0, pj - rj); j <= Math.min(ncj - 1, pj + rj); j++) {
        const key = i * 10000 + j;
        if (!this.cache.has(key)) { if (made >= maxNew) continue; made++; }
        g.drawImage(this.tile(i, j), (i * sx) * scale, (j * sz) * scale, sx * scale + 0.5, sz * scale + 0.5);
      }
    }
  }
}
