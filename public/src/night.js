// Ночь: общая доля «ночности» NIGHT (0 — день, 1 — ночь) для шейдеров (окна домов, светильники
// столбов) и свечение — ореолы фар и фонарей, пятна света на дороге. Свечение — один аддитивный
// материал: billboard-ореол, круглое пятно на земле или луч фар (в aGlow.w). Днём материал невидим.
import * as THREE from 'three';

export const NIGHT = { value: 0 };
const FOG = { value: new THREE.Vector2(250, 1600) }; // свечение гаснет в тумане, а не красится в него

let glowMat = null;
export function glowMaterial() {
  if (glowMat) return glowMat;
  glowMat = new THREE.ShaderMaterial({
    uniforms: { uNight: NIGHT, uFog: FOG },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute vec4 aGlow; attribute vec3 aColor;
      uniform vec2 uFog; varying vec2 vUv; varying vec3 vCol; varying float vKind; varying float vFog;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        // Спрятанный экземпляр (масштаб 0: снесённый столб, неактивная машина) — за кадр.
        if (dot(m[1].xyz, m[1].xyz) < 1e-6) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vUv = aGlow.xy; vCol = aColor; vKind = aGlow.w;
        vec4 mv = viewMatrix * m * vec4(position, 1.0);
        if (aGlow.w < 0.5) { mv.xy += aGlow.xy * aGlow.z; mv.z += min(0.4, -mv.z * 0.5); } // ореол — к камере
        vFog = 1.0 - smoothstep(uFog.x, uFog.y, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uNight; varying vec2 vUv; varying vec3 vCol; varying float vKind; varying float vFog;
      void main() {
        float a;
        if (vKind < 0.5) { float r = length(vUv); a = pow(max(0.0, 1.0 - r), 2.4); }
        else if (vKind < 1.5) { float r = length(vUv); a = 1.0 - smoothstep(0.0, 1.0, r); a *= a; }
        else { // луч фар: x — поперёк (-1..1), y — вдоль (0..1), расширяется вперёд
          a = (1.0 - vUv.y) * (1.0 - smoothstep(0.55, 1.0, abs(vUv.x) / (0.3 + 0.7 * vUv.y))) * smoothstep(0.0, 0.1, vUv.y);
        }
        gl_FragColor = vec4(vCol * a * uNight * vFog, 1.0);
      }`,
  });
  glowMat.visible = false;
  return glowMat;
}

// Построитель геометрии свечения: halo — ореол вокруг точки, pool — пятно на земле (горизонтальный круг),
// beam — луч вдоль +z от точки (длина len, ширина в начале w0 и в конце w1).
export class GlowBuilder {
  constructor() { this.p = []; this.g = []; this.c = []; this.idx = []; }
  #quad(corners, uvs, size, kind, col) {
    const n = this.p.length / 3;
    corners.forEach((v, i) => {
      this.p.push(...v);
      this.g.push(uvs[i][0], uvs[i][1], size, kind);
      this.c.push(col.r, col.g, col.b);
    });
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  halo(x, y, z, size, color) {
    const c = [x, y, z];
    this.#quad([c, c, c, c], [[-1, -1], [1, -1], [1, 1], [-1, 1]], size, 0, new THREE.Color(color));
    return this;
  }
  pool(x, y, z, r, color) {
    this.#quad([[x - r, y, z - r], [x - r, y, z + r], [x + r, y, z + r], [x + r, y, z - r]],
      [[-1, -1], [-1, 1], [1, 1], [1, -1]], 0, 1, new THREE.Color(color));
    return this;
  }
  beam(x, y, z, len, w0, w1, color) {
    this.#quad([[x - w0 / 2, y, z], [x + w0 / 2, y, z], [x + w1 / 2, y, z + len], [x - w1 / 2, y, z + len]],
      [[-1, 0], [1, 0], [1, 1], [-1, 1]], 0, 2, new THREE.Color(color));
    return this;
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.g, 4));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(this.c, 3));
    geo.setIndex(this.idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40); // ореолы выходят за вершины
    return geo;
  }
}

const HEAD = '#ffe6b0', TAIL = '#ff2412';

// Ореолы фар и фонарей по геометрии фар машины (части lights): вершины делятся на четыре группы —
// перед/зад × лево/право, красные — фонари. Ореол — у самой выступающей точки группы.
// beam — ещё и луч фар по дороге (трафику; у машины игрока — настоящий прожектор).
export function carGlows(lights, { beam = false } = {}) {
  const pos = lights.attributes.position, col = lights.attributes.color;
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const red = col ? col.getX(i) > 2 * col.getY(i) + 0.05 : z < 0;
    if (red ? z > 0 : z < 0) continue; // поворотники, повторители на бортах
    const key = `${red ? 'r' : 'h'}${x < 0 ? 'l' : 'r'}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { x: 0, y: 0, n: 0, z: red ? Infinity : -Infinity, red }));
    g.x += x; g.y += y; g.n++;
    g.z = red ? Math.min(g.z, z) : Math.max(g.z, z);
  }
  const b = new GlowBuilder();
  let front = 0;
  for (const g of groups.values()) {
    b.halo(g.x / g.n, g.y / g.n, g.z + (g.red ? -0.05 : 0.05), g.red ? 0.45 : 0.75, g.red ? '#a8180c' : HEAD);
    if (!g.red) front = Math.max(front, g.z);
  }
  if (beam && front) b.beam(0, 0.06, front + 0.3, 20, 1.8, 7, '#6e5c3e');
  return b.build();
}

// Ореолы фар и луч автобуса трафика (фары в busGeometry: x ±0.9, y 0.8, z ±5.76).
export function busGlows() {
  const b = new GlowBuilder();
  for (const x of [-0.9, 0.9]) b.halo(x, 0.8, 5.83, 0.8, HEAD).halo(x, 0.9, -5.83, 0.5, '#a8180c');
  return b.beam(0, 0.06, 6.1, 22, 2.2, 8, '#6e5c3e').build();
}

// Светильник столба (poleMaterials в build.js: консоль вдоль +x, светильник на ~2,3 м от столба,
// на высоте ~8,9 м): ореол — в координатах столба, пятно света — в своих (центр под светильником,
// на высоте дороги там, а не основания столба: иначе дорога выше обочины прячет пятно).
export const POLE_POOL_X = 2.1;
export function poleGlowGeometry() {
  return {
    halo: new GlowBuilder().halo(2.27, 8.7, 0, 1.7, '#ffcf87').build(),
    pool: new GlowBuilder().pool(0, 0, 0, 11, '#a07a45').build(),
  };
}

// ---------------------------------------------------------------- переключение дня и ночи

const DAY = {
  hemiSky: '#dfe9f5', hemiGround: '#5a5444', hemi: 1.4,
  sun: '#fff3dc', sunI: 2.2,
  fogNear: 250, fogFar: 1600,
};
const NIGHT_SET = {
  hemiSky: '#5a6f9c', hemiGround: '#2a2a33', hemi: 0.55,
  sun: '#9fb4e6', sunI: 0.45, // луна — с той же стороны, что солнце: тени те же
  fogNear: 150, fogFar: 1300,
};
const FADE = 1.5; // с: смена дня и ночи вручную

// Высота солнца над горизонтом в Ижевске, градусы, по времени UTC (упрощённые формулы NOAA/Альманаха,
// точность ~0,1°). Часовой пояс игрока не важен: время суток — ижевское.
const LAT = 56.85, LON = 53.2, RAD = Math.PI / 180;
export function sunAltitude(ms = Date.now()) {
  const d = (ms - 946728000000) / 86400000; // сутки от J2000 (2000-01-01 12:00 UTC)
  const g = (357.529 + 0.98560028 * d) * RAD;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // долгота Солнца
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ha = (280.46061837 + 360.98564736629 * d + LON) * RAD - ra; // звёздное время − прямое восхождение
  return Math.asin(Math.sin(LAT * RAD) * Math.sin(dec) + Math.cos(LAT * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}
// По часам: день, пока солнце над горизонтом (−0,833° — верхний край с рефракцией, как в восходе/заходе);
// после захода темнеет за гражданские сумерки (до −6°), утром светлеет так же — к восходу уже день.
const SET = -0.833, DUSK = -6;
const clockNight = () => Math.min(1, Math.max(0, (SET - sunAltitude()) / (SET - DUSK)));

const MODES = ['auto', 'day', 'night'];

export class DayNight {
  // hemi, sun — свет сцены; sky — Sky (купол, звёзды, облака); ads — материалы щитов (подсветка плакатов);
  // headlight — прожектор фар игрока; dir — направление на солнце (ночью там луна).
  // Режим: auto — по солнцу в Ижевске сейчас, day / night — вручную; помнится в localStorage.daytime.
  // fogScale — множитель дальности тумана (уровень графики в main.js).
  constructor({ scene, hemi, sun, dir, sky, ads, headlight, fogScale = 1 }) {
    Object.assign(this, { scene, hemi, sun, dir, sky, ads, headlight, fogScale });
    this.mode = 'auto';
    try { const m = localStorage.getItem('daytime'); if (MODES.includes(m)) this.mode = m; } catch {}
    this.clock = clockNight();
    this.check = 0; // с до пересчёта солнца
    this.t = this.#goal();
    this.c1 = new THREE.Color();
    this.c2 = new THREE.Color();
    this.#apply();
  }

  get night() { return this.t > 0.5; }

  // Для меню: «авто · ночь», «день», «ночь».
  get label() {
    if (this.mode !== 'auto') return this.mode === 'day' ? 'день' : 'ночь';
    return `авто · ${this.clock <= 0 ? 'день' : this.clock >= 1 ? 'ночь' : 'сумерки'}`;
  }

  // По кругу: авто → день → ночь.
  toggle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    try { localStorage.setItem('daytime', this.mode); } catch {}
  }

  setFogScale(k) {
    this.fogScale = k;
    this.#apply();
  }

  #goal() { return this.mode === 'auto' ? this.clock : this.mode === 'night' ? 1 : 0; }

  update(dt) {
    if ((this.check -= dt) <= 0) { this.check = 5; this.clock = clockNight(); }
    const goal = this.#goal();
    if (this.t === goal) return;
    this.t = goal > this.t ? Math.min(goal, this.t + dt / FADE) : Math.max(goal, this.t - dt / FADE);
    this.#apply();
  }

  #apply() {
    const t = this.t, s = t * t * (3 - 2 * t), lerp = (a, b) => a + (b - a) * s;
    const col = (out, a, b) => out.set(a).lerp(this.c2.set(b), s);
    NIGHT.value = s;
    glowMaterial().visible = s > 0.01;
    col(this.hemi.color, DAY.hemiSky, NIGHT_SET.hemiSky);
    col(this.hemi.groundColor, DAY.hemiGround, NIGHT_SET.hemiGround);
    this.hemi.intensity = lerp(DAY.hemi, NIGHT_SET.hemi);
    col(this.sun.color, DAY.sun, NIGHT_SET.sun);
    this.sun.intensity = lerp(DAY.sunI, NIGHT_SET.sunI);
    const fog = this.scene.fog;
    fog.near = lerp(DAY.fogNear, NIGHT_SET.fogNear) * this.fogScale;
    fog.far = lerp(DAY.fogFar, NIGHT_SET.fogFar) * this.fogScale;
    FOG.value.set(fog.near, fog.far);
    this.sky.setNight(s, this.dir);
    fog.color.copy(this.sky.horizon);
    this.scene.background.copy(this.sky.horizon);
    if (this.ads) for (const f of this.ads.faces) f.emissiveIntensity = lerp(0.35, 0.9);
    if (this.headlight) {
      this.headlight.intensity = 60 * s;
      this.headlight.visible = s > 0.01;
    }
  }
}
