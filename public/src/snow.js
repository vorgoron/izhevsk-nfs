// Зима: общая доля «снежности» SNOW (0 — лето, 1 — зима) для шейдеров, выбор сезона и снегопад.
// Без потери кадров: в шейдерах материалов — пара арифметических действий без шума и лишних выборок
// (snowy), рисунок снега на дорогах — заранее нарисованные текстуры (build.js меняет карту), снегопад —
// один вызов отрисовки, хлопья движет вершинный шейдер. Летом снегопад не рисуется вовсе.
import * as THREE from 'three';

export const SNOW = { value: 0 };

// Цвет снега и льда (линейные, под Lambert): снег не чисто белый — иначе на солнце выгорает в пятно.
export const SNOW_RGB = 'vec3(0.74, 0.78, 0.84)';
const ICE_RGB = 'vec3(0.44, 0.57, 0.69)', PACKED_RGB = 'vec3(0.56, 0.58, 0.61)';

// Снег на материале (Lambert/Phong): правка шейдера поверх прежней onBeforeCompile.
//   top    — на гранях, смотрящих вверх (крыши, навесы, капоты): мировая нормаль круче lo…hi;
//   flat   — на всей поверхности (тротуары, насыпи), amount — насколько плотно, рисунок карты просвечивает;
//   ground — земля квадрата: вода по цвету подложки — лёд, асфальт парковок — укатанный серый снег.
// Ключ программы дополняется сам: у обёрток с одинаковым текстом, но разной начинкой three иначе взял бы одну программу.
export function snowy(mat, { mode = 'top', amount = 1, lo = 0.45, hi = 0.8 } = {}) {
  if (mat.userData.snowy) return mat;
  mat.userData.snowy = true;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  const f = (v) => v.toFixed(3);
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    sh.uniforms.uSnow = SNOW;
    if (mode === 'top') {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vSnowUp;')
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
          vec3 snowN = objectNormal;
          #ifdef USE_INSTANCING
            snowN = mat3(instanceMatrix) * snowN;
          #endif
          snowN = mat3(modelMatrix) * snowN;
          vSnowUp = snowN.y / max(length(snowN), 1e-4);`);
    }
    const body = mode === 'top'
      ? `diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_RGB}, uSnow * ${f(amount)} * smoothstep(${f(lo)}, ${f(hi)}, vSnowUp));`
      : mode === 'flat'
        ? `diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_RGB} * (0.86 + 0.5 * dot(diffuseColor.rgb, vec3(0.33))), uSnow * ${f(amount)});`
        : `vec3 snowC = diffuseColor.rgb;
          float snowL = dot(snowC, vec3(0.3, 0.5, 0.2));
          float snowSat = max(snowC.r, max(snowC.g, snowC.b)) - min(snowC.r, min(snowC.g, snowC.b));
          float snowIce = step(snowC.r * 1.6, snowC.b) * step(snowC.g, snowC.b);
          float snowRoad = (1.0 - smoothstep(0.09, 0.13, snowL)) * (1.0 - smoothstep(0.015, 0.03, snowSat));
          vec3 snowOut = mix(${SNOW_RGB} * (0.9 + 0.55 * snowL), ${PACKED_RGB} * (0.9 + 1.5 * snowL), snowRoad);
          diffuseColor.rgb = mix(snowC, mix(snowOut, ${ICE_RGB} * (0.85 + 0.6 * snowL), snowIce), uSnow * ${f(amount)});`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSnow;${mode === 'top' ? '\nvarying float vSnowUp;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${body}`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : prev ? prev.toString() : ''}|snow:${mode}:${amount}:${lo}:${hi}`;
  return mat;
}

// Снег на всех материалах готового объекта (достопримечательности): крыши, карнизы, площадки.
export function snowyObject(root) {
  root.traverse((o) => {
    for (const m of [o.material].flat()) {
      if (m && (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial) && !m.transparent) snowy(m);
    }
  });
}

// ---------------------------------------------------------------- сезон

// Зима по календарю в Ижевске (UTC+4): снег лежит примерно с начала ноября до начала апреля.
export function winterNow(ms = Date.now()) {
  const d = new Date(ms + 4 * 3600000), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  return md >= 1105 || md <= 405;
}

const MODES = ['auto', 'summer', 'winter'];
const subs = [];
// Подписка на смену сезона: fn(зима?) — сразу и при каждой смене (текстуры дорог, свет, небо).
export function onSeason(fn) { subs.push(fn); fn(SNOW.value > 0.5); }

// Режим: auto — по календарю, summer / winter — вручную; помнится в localStorage.season.
// ?season=winter | summer в адресе — на этот запуск, без записи (для проверки и роликов).
export class Season {
  constructor() {
    this.mode = 'auto';
    try { const m = localStorage.getItem('season'); if (MODES.includes(m)) this.mode = m; } catch {}
    const q = new URLSearchParams(location.search).get('season');
    if (MODES.includes(q)) this.mode = q;
    this.#apply();
  }

  get winter() { return this.mode === 'auto' ? winterNow() : this.mode === 'winter'; }

  // Для меню: «авто · зима», «лето», «зима».
  get label() {
    const name = this.winter ? 'зима' : 'лето';
    return this.mode === 'auto' ? `авто · ${name}` : name;
  }

  // По кругу: авто → лето → зима.
  toggle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    try { localStorage.setItem('season', this.mode); } catch {}
    this.#apply();
  }

  #apply() {
    const w = this.winter ? 1 : 0;
    if (SNOW.value === w && this.applied) return;
    this.applied = true;
    SNOW.value = w;
    for (const fn of subs) fn(w > 0.5);
  }
}

// ---------------------------------------------------------------- снегопад

// Хлопья — точки в кубе BOX вокруг камеры: место считает вершинный шейдер (падение, ветер, заворот по
// кубу), с процессора в кадр уходит только время и место камеры. Летом объект невидим.
const BOX = new THREE.Vector3(56, 30, 56);

export class Snowfall {
  // count — хлопьев (по уровню графики); night — { value } доля ночи: ночью хлопья тусклее.
  constructor(scene, { count = 3000, night = { value: 0 } } = {}) {
    const pos = new Float32Array(count * 3);
    let s = 4242;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < pos.length; i++) pos[i] = rnd();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: BOX }, uPx: { value: 900 }, uNight: night };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */`uniform float uTime, uPx; uniform vec3 uCam, uBox; varying float vA;
        void main() {
          float seed = fract(position.x * 37.0 + position.z * 91.0);
          vec3 p = position * uBox;
          p.y -= uTime * (1.5 + 1.3 * seed);
          p.xz += vec2(0.9, 0.35) * uTime + vec2(sin(uTime * 0.7 + seed * 40.0), cos(uTime * 0.5 + seed * 23.0)) * 0.5;
          p = mod(p - uCam, uBox) - 0.5 * uBox;
          vec4 mv = viewMatrix * vec4(p + uCam, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.5);
          gl_PointSize = clamp((0.05 + 0.05 * seed) * uPx / d, 1.5, 0.02 * uPx);
          // к краю куба хлопья тают — заворот не виден
          vec3 e = 1.0 - abs(p) / (0.5 * uBox);
          vA = smoothstep(0.0, 0.25, min(e.x, min(e.y, e.z))) * smoothstep(0.5, 2.5, d);
        }`,
      fragmentShader: /* glsl */`uniform float uNight; varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.2, 0.5, r)) * vA * 0.85;
          gl_FragColor = vec4(vec3(1.0 - 0.45 * uNight), a);
          #include <colorspace_fragment>
        }`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    onSeason((w) => { this.points.visible = w; });
  }

  update(dt, camera, renderer) {
    if (!this.points.visible) return;
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 3600;
    u.uCam.value.copy(camera.position);
    // Пикселей на метр на расстоянии 1 м — размер хлопьев от разрешения и угла обзора не зависит.
    u.uPx.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
}
