// Платные покрытия кузова (автосалон, вкладка «Вид»): металлик, перламутр, хамелеон, супер-чёрный и плёнки —
// матовые, карбон, камуфляж, хром. Одни на все машины, покупаются на конкретную машину (ключ `<машина>:paint:<key>`
// в кошельке, money.js). В выборе гаража `color` — либо обычный '#hex', либо key покрытия.
// Порядок PAINTS не менять: номер покрытия уходит по сети (net.js), новые — в конец.
import * as THREE from 'three';

// kind — как рисуется (paintMaterial); base — похожий обычный цвет (старые клиенты, кружок в ленте);
// tint / tints — второй и третий цвета перелива; swatch — фон кружка в гараже.
export const PAINTS = [
  { key: 'met-silver', name: 'Серебристый металлик', price: 5000, kind: 'metallic', base: '#aeb3b8', swatch: 'radial-gradient(circle at 35% 30%, #fff, #aeb3b8 45%, #6d7277)' },
  { key: 'met-graphite', name: 'Графитовый металлик', price: 5000, kind: 'metallic', base: '#4a4f55', swatch: 'radial-gradient(circle at 35% 30%, #b9bec4, #4a4f55 45%, #23262a)' },
  { key: 'met-blue', name: 'Синий металлик', price: 5000, kind: 'metallic', base: '#1f4f9a', swatch: 'radial-gradient(circle at 35% 30%, #a9c4f0, #1f4f9a 45%, #0d2552)' },
  { key: 'met-cherry', name: 'Вишнёвый металлик', price: 5000, kind: 'metallic', base: '#6e0f1f', swatch: 'radial-gradient(circle at 35% 30%, #e88a9a, #6e0f1f 45%, #33060e)' },
  { key: 'pearl-pink', name: 'Перламутр бело-розовый', price: 12000, kind: 'pearl', base: '#f1ece6', tint: '#f0a8c8', swatch: 'radial-gradient(circle at 40% 35%, #fff 20%, #f1ece6 45%, #f0a8c8)' },
  { key: 'pearl-blue', name: 'Перламутр бело-голубой', price: 12000, kind: 'pearl', base: '#eef0f2', tint: '#9ccaf2', swatch: 'radial-gradient(circle at 40% 35%, #fff 20%, #eef0f2 45%, #9ccaf2)' },
  { key: 'cham-violet', name: 'Хамелеон фиолетово-зелёный', price: 25000, kind: 'chameleon', base: '#5b2a86', tints: ['#5b2a86', '#2a6fb0', '#2f9a5a'], swatch: 'linear-gradient(135deg, #5b2a86, #2a6fb0, #2f9a5a)' },
  { key: 'cham-blue', name: 'Хамелеон сине-бордовый', price: 25000, kind: 'chameleon', base: '#1d3f8f', tints: ['#1d3f8f', '#6a2a7a', '#8c1830'], swatch: 'linear-gradient(135deg, #1d3f8f, #6a2a7a, #8c1830)' },
  { key: 'cham-teal', name: 'Хамелеон бирюзово-фиолетовый', price: 25000, kind: 'chameleon', base: '#1b8a8a', tints: ['#1b8a8a', '#3a5cc0', '#7a3fa0'], swatch: 'linear-gradient(135deg, #1b8a8a, #3a5cc0, #7a3fa0)' },
  { key: 'superblack', name: 'Супер-чёрный', price: 15000, kind: 'black', base: '#060607', swatch: 'radial-gradient(circle, #000 60%, #2a2c30)' },
  { key: 'matte-black', name: 'Матовая плёнка, чёрная', price: 8000, kind: 'matte', base: '#2a2b2e', swatch: '#2a2b2e' },
  { key: 'matte-graphite', name: 'Матовая плёнка, графит', price: 8000, kind: 'matte', base: '#4b5056', swatch: '#4b5056' },
  { key: 'matte-khaki', name: 'Матовая плёнка, хаки', price: 8000, kind: 'matte', base: '#6b6b45', swatch: '#6b6b45' },
  { key: 'carbon', name: 'Карбон', price: 20000, kind: 'carbon', base: '#2c2e33', swatch: 'repeating-conic-gradient(#2c2e33 0 25%, #121316 0 50%) 0 0 / 8px 8px' },
  { key: 'camo', name: 'Камуфляж', price: 10000, kind: 'camo', base: '#5c6440', swatch: 'radial-gradient(circle at 30% 30%, #3b4a2a 22%, transparent 23%), radial-gradient(circle at 70% 65%, #7a6a48 24%, transparent 25%), #5c6440' },
  { key: 'chrome', name: 'Хром-плёнка', price: 40000, kind: 'chrome', base: '#c9ced4', swatch: 'linear-gradient(180deg, #f4f8fc, #9aa6b2 48%, #3a3d42 52%, #b9c0c8)' },
];

const BY_KEY = new Map(PAINTS.map((p) => [p.key, p]));
export const paintOf = (color) => BY_KEY.get(color) ?? null;
export const paintKey = (model, key) => `${model}:paint:${key}`;
// По сети: 0 — обычный цвет, иначе номер в PAINTS + 1.
export const paintIndex = (color) => PAINTS.indexOf(paintOf(color)) + 1;
export const paintFrom = (i) => PAINTS[i - 1]?.key ?? null;
// Обычный цвет для мест, где покрытий нет (кружок в ленте, поле c по сети).
export const plainColor = (color) => paintOf(color)?.base ?? color;

// Шейдерные куски: перелив по френелю, отражение неба и земли (цвета полусферного света сцены — днём светлое,
// ночью тёмное), рисунки карбона и камуфляжа по координатам кузова (UV у процедурных машин нет).
const GLSL = `
uniform vec3 uA, uB, uC;
varying vec3 vObj, vObjN;
float ph(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float pn(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ph(i), ph(i + vec3(1, 0, 0)), f.x), mix(ph(i + vec3(0, 1, 0)), ph(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(ph(i + vec3(0, 0, 1)), ph(i + vec3(1, 0, 1)), f.x), mix(ph(i + vec3(0, 1, 1)), ph(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Плоскость рисунка — по главной оси нормали кузова.
vec2 pplane() {
  vec3 n = abs(vObjN);
  return n.x > n.y && n.x > n.z ? vObj.zy : n.y > n.z ? vObj.xz : vObj.xy;
}
`;
// Отражение — после объявления источников света (lights_pars_begin).
const ENV_GLSL = `
vec3 penv(vec3 normal, vec3 viewDir) {
  vec3 r = inverseTransformDirection(reflect(-viewDir, normal), viewMatrix);
  #if NUM_HEMI_LIGHTS > 0
    return mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, smoothstep(-0.25, 0.35, r.y)) * 0.6;
  #else
    return ambientLightColor * 0.6;
  #endif
}
`;

// color — что подмешать в цвет (после нормалей, fr — френель); env — доля отражения в итоговом свете (по краям — больше,
// у хрома — везде одинаково, flat); phong — [блеск, цвет блика], нет — матовое.
const KINDS = {
  metallic: { phong: [70, '#666'], env: 0.12, color: 'diffuseColor.rgb *= mix(uA, uA * 1.6 + 0.05, pow(1.0 - fr, 6.0) * 0.35);' },
  pearl: { phong: [60, '#555'], env: 0.1, color: 'diffuseColor.rgb *= mix(uA, uB, smoothstep(0.15, 0.85, fr) * 0.75);' },
  chameleon: { phong: [70, '#666'], env: 0.12, color: 'diffuseColor.rgb *= fr < 0.5 ? mix(uA, uB, fr * 2.0) : mix(uB, uC, fr * 2.0 - 1.0);' },
  black: { color: 'diffuseColor.rgb *= uA + vec3(0.05, 0.055, 0.06) * pow(fr, 3.0);' },
  matte: { color: 'diffuseColor.rgb *= uA;' },
  carbon: {
    phong: [45, '#3a3a3a'], env: 0.06,
    // Плетение крупнее настоящего (5 см), иначе с камеры за машиной сливается в чёрное.
    color: `{ vec2 q = pplane() / 0.05; float c = mod(floor(q.x) + floor(q.y), 2.0);
      float g = fract(c > 0.5 ? q.x : q.y); diffuseColor.rgb *= uA * (0.35 + 1.1 * sin(g * 3.14159)); }`,
  },
  camo: {
    color: `{ float n = pn(vObj * 1.6) * 0.65 + pn(vObj * 3.7) * 0.35;
      diffuseColor.rgb *= n < 0.42 ? uB : n < 0.6 ? uA : uC; }`,
  },
  chrome: { phong: [140, '#fff'], env: 0.8, flat: true, color: 'diffuseColor.rgb *= uA;' },
};
const CAMO = ['#5c6440', '#33402a', '#7a6a48'];

const cache = new Map();

// Материал краски кузова: обычный '#hex' — Lambert с цветом (как раньше), покрытие — свой шейдер.
// Покрытия кэшируются: материал общий у всех машин с этим покрытием.
export function paintMaterial(color) {
  const p = paintOf(color);
  if (!p) return new THREE.MeshLambertMaterial({ color, vertexColors: true });
  if (cache.has(p.key)) return cache.get(p.key);
  const k = KINDS[p.kind];
  const mat = k.phong
    ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: k.phong[0], specular: k.phong[1] })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  const cols = p.kind === 'camo' ? CAMO : p.tints ?? [p.base, p.tint ?? p.base, p.base];
  const [uA, uB, uC] = cols.map((c) => ({ value: new THREE.Color(c) }));
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uA, uB, uC });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj, vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL)
      .replace('#include <lights_pars_begin>', '#include <lights_pars_begin>\n' + ENV_GLSL)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 1.5);
        ${k.color}`)
      .replace('#include <opaque_fragment>', `${k.env ? `outgoingLight = mix(outgoingLight, penv(normal, normalize(vViewPosition)) * mix(vec3(1.0), uA * 1.2, 0.35), ${k.env.toFixed(2)}${k.flat ? '' : ' * (0.4 + 0.6 * fr)'});` : ''}
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `paint-${p.kind}`;
  cache.set(p.key, mat);
  return mat;
}
