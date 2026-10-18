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
const FADE = 1.5; // с: смена дня и ночи

export class DayNight {
  // hemi, sun — свет сцены; sky — Sky (купол, звёзды, облака); ads — материалы щитов (подсветка плакатов);
  // headlight — прожектор фар игрока; dir — направление на солнце (ночью там луна).
  constructor({ scene, hemi, sun, dir, sky, ads, headlight }) {
    Object.assign(this, { scene, hemi, sun, dir, sky, ads, headlight });
    this.night = false;
    try { this.night = localStorage.getItem('night') === '1'; } catch {}
    this.t = this.night ? 1 : 0;
    this.c1 = new THREE.Color();
    this.c2 = new THREE.Color();
    this.#apply();
  }

  toggle() {
    this.night = !this.night;
    try { localStorage.setItem('night', this.night ? '1' : '0'); } catch {}
  }

  update(dt) {
    const goal = this.night ? 1 : 0;
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
    fog.near = lerp(DAY.fogNear, NIGHT_SET.fogNear);
    fog.far = lerp(DAY.fogFar, NIGHT_SET.fogFar);
    FOG.value.set(fog.near, fog.far);
    this.sky.setNight(s, this.dir);
    fog.color.copy(this.sky.horizon);
    this.scene.background.copy(this.sky.horizon);
    if (this.ads) this.ads.face.emissiveIntensity = lerp(0.35, 0.9);
    if (this.headlight) {
      this.headlight.intensity = 60 * s;
      this.headlight.visible = s > 0.01;
    }
  }
}
