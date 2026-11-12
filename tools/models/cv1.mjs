// Сборка public/models/cv1.glb — концепт «Калашников CV-1» (2018; электромобиль в кузове ИЖ-21252 «Комби»).
// Модель целиком строится в Blender скриптом blender/cv1.py (по фото, без чужих исходников) и выгружается в
// 3d-models/cv1/cv1.gltf. Материалы там названы «часть:#цвет» — здесь только раскладка по частям игры, без упрощения.
// Порядок: Blender: blender/cv1.py → node cv1.mjs
//
//   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/models/blender/cv1.py
//   (или в открытом Blender: python3 tools/models/blender/bl.py tools/models/blender/cv1.py)
//   cd tools/models && node cv1.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, readGltf, simplify, writeGlb } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = `${root}/3d-models/cv1/cv1`;

const prims = readGltf(`${SRC}.gltf`);
const { wheels } = JSON.parse(readFileSync(`${SRC}.json`, 'utf8'));
const parts = { paint: [], detail: [], lights: [], wheel: [] };
const groups = new Map(); // «часть:#цвет» → примитивы
for (const p of prims) {
  if ((p.wheel != null) !== p.mat.startsWith('wheel:')) throw new Error(`материал ${p.mat} не на своём месте (узел ${p.node})`);
  if (!groups.has(p.mat)) groups.set(p.mat, []);
  groups.get(p.mat).push(p);
}
const stat = {};
for (const [mat, list] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const [part, color] = mat.split(':');
  const g = simplify(list, 1); // только сварка вершин
  parts[part].push({ ...g, color: hex(color) });
  stat[mat] = g.idx.length / 3;
}
console.table(stat);
const body = bbox([...parts.paint, ...parts.detail]);
console.log('колёса', wheels, '| длина', body.size[2].toFixed(3), 'ширина', body.size[0].toFixed(3), 'высота', body.hi[1].toFixed(3));
const credit = 'Kalashnikov CV-1 concept model by Izh Car, built from photos';
writeGlb(`${root}/public/models/cv1.glb`, parts, { cull: true, copyright: credit,
  extras: { wheels, length: +body.size[2].toFixed(3), width: +body.size[0].toFixed(3), hub: true } });
