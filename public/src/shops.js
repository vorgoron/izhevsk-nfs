// Вывески на фасадах: магазины, аптеки, банки, кафе, пункты выдачи, конторы из OSM (city.json → shops, место на стене
// выбирает fetch_city.py → shop_signs). Квадрат — одна canvas-текстура с вывесками и один меш коробов; ночью
// вывески светятся. Строятся только у ближних квадратов (ChunkManager), дальние выгружаются — текстуры не копятся.
import * as THREE from 'three';
import { NIGHT } from './night.js';

export const SHOP_NEAR = 350; // м до квадрата: ближе — вывески есть

const H = 0.8, D = 0.14;          // м: высота вывески (как SIGN_H в fetch_city.py), толщина короба
const PXM = 50, ROW = 48, PAD = 4; // px на метр, высота ряда атласа, поля вокруг вывески (против швов на mip)
const TEX_W = 1024;
const font = (px) => `800 ${px}px Arial, Helvetica, sans-serif`;

// Цвета по виду: [фон, текст]; несколько — по хешу названия.
const KIND = {
  food: [['#c62828', '#fff'], ['#2e7d32', '#fff'], ['#ef6c00', '#fff'], ['#fff8e1', '#b71c1c']],
  shop: [['#1565c0', '#fff'], ['#6a1b9a', '#fff'], ['#37474f', '#fff'], ['#00838f', '#fff'], ['#ad1457', '#fff'], ['#f5f5f5', '#263238']],
  post: [['#3949ab', '#fff'], ['#0277bd', '#fff']],
  cafe: [['#4e342e', '#ffe0b2'], ['#bf360c', '#fff'], ['#212121', '#ffca28'], ['#fff3e0', '#6d4c41']],
  office: [['#263238', '#fff'], ['#eceff1', '#1a237e'], ['#1a237e', '#fff']],
  auto: [['#212121', '#fdd835'], ['#f9a825', '#212121'], ['#b71c1c', '#fff']],
  pharm: [['#ffffff', '#00843d'], ['#00843d', '#fff']],
  med: [['#ffffff', '#1565c0'], ['#e3f2fd', '#0d47a1']],
  beauty: [['#ad1457', '#fff'], ['#f8bbd0', '#880e4f'], ['#212121', '#f8bbd0']],
  bank: [['#0d47a1', '#fff'], ['#004d40', '#fff']],
};
// Известные сети — своими цветами (по началу названия, без регистра).
const BRANDS = [
  ['магнит косметик', '#e5007d', '#fff'], ['магнит', '#e30613', '#fff'], ['пятёрочка', '#e31e24', '#fff'], ['пятерочка', '#e31e24', '#fff'],
  ['перекрёсток', '#0b6b3a', '#fff'], ['монетка', '#009a44', '#ffe600'], ['чижик', '#ffdd00', '#222'], ['fix price', '#0057b8', '#ffd400'],
  ['красное', '#8c0f22', '#fff'], ['бристоль', '#1c3f94', '#fff'], ['ozon', '#005bff', '#fff'], ['wildberries', '#a3119d', '#fff'],
  ['яндекс', '#ffdb4d', '#222'], ['сдэк', '#1ab248', '#fff'], ['boxberry', '#ed1651', '#fff'], ['почта', '#0055a6', '#fff'],
  ['сбер', '#21a038', '#fff'], ['втб', '#002882', '#fff'], ['альфа', '#ef3124', '#fff'], ['совкомбанк', '#0b3e8e', '#fff'],
  ['промсвязьбанк', '#f26722', '#fff'], ['мтс', '#e30611', '#fff'], ['билайн', '#ffd200', '#222'], ['мегафон', '#00b956', '#fff'],
  ['dns', '#fc8507', '#fff'], ['м.видео', '#e40000', '#fff'], ['kfc', '#a3080c', '#fff'], ["rostic's", '#c8102e', '#fff'],
  ['бургер кинг', '#f5ebdc', '#d62300'], ['додо', '#ff6900', '#fff'], ['coffee like', '#1f1f1f', '#8dc63f'],
  ['авито', '#00aaff', '#fff'], ['лукойл', '#ed1c24', '#fff'], ['башнефть', '#00529b', '#fff'], ['галамарт', '#e4032e', '#fff'],
];

export function shopColors(k, text) {
  const low = text.toLowerCase();
  const b = BRANDS.find(([n]) => low.startsWith(n));
  if (b) return [b[1], b[2]];
  const list = KIND[k] || KIND.shop;
  let h = 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 2654435761) >>> 0;
  return list[h % list.length];
}

// Вывеска в прямоугольнике (x, y, w, h) атласа: фон, тонкая кайма, текст по центру (не влез — мельче);
// у аптеки — зелёный крест слева.
function drawSign(g, x, y, w, h, k, text) {
  const [bg, fg] = shopColors(k, text);
  g.fillStyle = bg;
  g.fillRect(x - PAD, y - PAD, w + 2 * PAD, h + 2 * PAD);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 3;
  g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  let left = x + 8;
  if (k === 'pharm') {
    const s = h * 0.62, cx = x + 8 + s / 2, cy = y + h / 2, t = s / 3;
    g.fillStyle = bg === '#ffffff' ? '#00a651' : '#fff';
    g.fillRect(cx - t / 2, cy - s / 2, t, s);
    g.fillRect(cx - s / 2, cy - t / 2, s, t);
    left += s + 6;
  }
  const maxW = x + w - 8 - left;
  let px = Math.round(h * 0.62);
  g.font = font(px);
  const tw = g.measureText(text).width;
  if (tw > maxW) g.font = font((px = Math.max(10, Math.floor(px * maxW / tw))));
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, (left + x + w - 8) / 2, y + h / 2 + px * 0.04, maxW);
}

// Высота центра вывески: по верху первого этажа фасада (под межэтажной линией shopLine), этажи — как в
// buildBuildingChunk: от высшей точки земли под домом, на склоне ниже неё — ещё extra рядов. Не выше крыши.
let pieces = null;
function signY(world, b, t) {
  if (!pieces) {
    pieces = new Map();
    for (const q of world.city.buildings) if (q.g !== undefined) (pieces.get(q.g) || pieces.set(q.g, []).get(q.g)).push(q);
  }
  let gmin = Infinity, gmax = -Infinity;
  for (const q of b.g === undefined ? [b] : pieces.get(b.g)) {
    for (const [x, z] of q.p) {
      const y = world.terrain(x, z);
      gmin = Math.min(gmin, y);
      gmax = Math.max(gmax, y);
    }
  }
  const [step, para] = b.r ? [2.9, 0.3] : [3.1, 1];
  const floors = Math.max(1, Math.round((b.h - para) / step)), fh = Math.max(2.4, (b.h - para) / floors);
  const extra = Math.floor((gmax - gmin) / fh + 0.35);
  return Math.min(shopLine(t, gmax, fh, extra) - 0.45, gmax + b.h - 0.6);
}

// Межэтажная линия, под которой висит вывеска (и кончается витрина, buildBuildingChunk): первая не ниже 2.2 м
// над землёй t у вывески; ряды фасада — от gmax − extra этажей высотой fh.
export function shopLine(t, gmax, fh, extra) {
  const n = Math.max(1, Math.ceil((t + 2.2 - gmax) / fh + extra));
  return gmax + (n - extra) * fh;
}

export function buildShopChunk(world, info, renderer) {
  const list = info.data.shops;
  if (!list.length) return null;
  // Раскладка по рядам атласа: слева направо, не влезла — новый ряд. Угол 0…12 px — тёмный (бока короба).
  const cells = [];
  let cx = 16, row = 0;
  for (const s of list) {
    const w = Math.round(s[3] * PXM);
    if (cx + w + PAD > TEX_W) { cx = PAD; row++; }
    cells.push([cx, row * ROW + PAD, w, ROW - 2 * PAD]);
    cx += w + 2 * PAD;
  }
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = (row + 1) * ROW;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2e31';
  g.fillRect(0, 0, 12, 12);
  list.forEach((s, i) => drawSign(g, ...cells[i], s[5], s[6]));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const pos = [], nor = [], uv = [];
  const dark = [6 / TEX_W, 1 - 6 / c.height];
  list.forEach(([x, z, a, wm, bi], i) => {
    const [px, py, pw, ph] = cells[i];
    const geo = new THREE.BoxGeometry(wm, H, D).toNonIndexed();
    const u = geo.attributes.uv;
    // Грани BoxGeometry: +x, -x, +y, -y, +z (лицо), -z — по 6 вершин после toNonIndexed.
    for (let v = 0; v < u.count; v++) {
      if (v >= 24 && v < 30) u.setXY(v, (px + u.getX(v) * pw) / TEX_W, 1 - (py + (1 - u.getY(v)) * ph) / c.height);
      else u.setXY(v, ...dark);
    }
    const out = D / 2 + 0.02; // задняя грань — у стены
    geo.rotateY(a).translate(x + Math.sin(a) * out, signY(world, world.city.buildings[bi], world.terrain(x, z)), z + Math.cos(a) * out);
    pos.push(...geo.attributes.position.array);
    nor.push(...geo.attributes.normal.array);
    uv.push(...u.array);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  // Вывеска светится своей же текстурой: днём чуть (в тени стены не тускнеет), ночью — в полную (бока тёмные — почти нет).
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.2 + 0.8 * uNight;');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
