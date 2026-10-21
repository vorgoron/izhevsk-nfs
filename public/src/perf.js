// Замер производительности: `?perf` в адресе. Табличка в углу раз в секунду:
// кадры в секунду, интервал кадра (среднее и худший из 20 %), время JS на кадр
// (логика + отправка рендера), время видеокарты (где есть EXT_disjoint_timer_query —
// в Chrome на Android и ПК есть, в Safari нет), вызовы отрисовки и треугольники.
// Ниже — разбивка треугольников по группам сцены (`userData.perf` у объекта или предка):
// «кадр» — основной проход с камеры, «тени» — проход в карту теней солнца. Считается
// обходом сцены по тем же правилам отсечения, что у three.js r160. Счётчик `renderer.info`
// в третьей строке тени не видит (r160 сбрасывает его после прохода теней), поэтому с ним
// сходится столбец «кадр», а не «итого».
import * as THREE from 'three';

const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

// Треугольники и вызовы отрисовки одного объекта — как их считает renderBufferDirect.
function drawCost(o) {
  const g = o.geometry, pos = g?.attributes.position;
  if (!pos) return null;
  const n = g.index ? g.index.count : pos.count;
  const start = Math.max(0, g.drawRange.start), end = Math.min(n, g.drawRange.start + g.drawRange.count);
  const inst = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1;
  const k = o.isMesh ? inst / 3 : 0; // линии и точки треугольников не дают
  let tris = 0, calls = 0;
  if (Array.isArray(o.material)) {
    for (const gr of g.groups) {
      if (!o.material[gr.materialIndex]?.visible) continue;
      calls++;
      tris += Math.max(0, Math.min(end, gr.start + gr.count) - Math.max(start, gr.start)) * k;
    }
  } else if (o.material.visible) {
    calls = 1;
    tris = (end - start) * k;
  }
  return { tris, calls };
}

function labelOf(o, scene) {
  let label = null;
  for (; o && o !== scene; o = o.parent) if (o.userData.perf) label = o.userData.perf; // самый верхний
  return label ?? 'прочее';
}

function breakdown(scene, camera, light) {
  const rows = new Map();
  const row = (label) => rows.get(label) ?? rows.set(label, { label, tris: 0, calls: 0, sTris: 0, sCalls: 0 }).get(label);
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  const shadow = light?.castShadow ? light.shadow.getFrustum() : null;
  scene.traverseVisible((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints)) return;
    const cost = drawCost(o);
    if (!cost) return;
    const r = row(labelOf(o, scene));
    if (!o.frustumCulled || frustum.intersectsObject(o)) {
      r.tris += cost.tris;
      r.calls += cost.calls;
    }
    if (shadow && o.castShadow && (!o.frustumCulled || shadow.intersectsObject(o))) {
      r.sTris += cost.tris;
      r.sCalls += cost.calls;
    }
  });
  return [...rows.values()].sort((a, b) => b.tris + b.sTris - a.tris - a.sTris);
}

const k = (n) => (n >= 1e5 ? `${(n / 1e6).toFixed(2)}М` : `${(n / 1e3).toFixed(0)}т`).padStart(6);

export function createPerf(renderer, scene, camera, light) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;pointer-events:none;'
    + 'font:12px/1.35 ui-monospace,monospace;color:#fff;background:#000a;padding:6px 8px;'
    + 'border-radius:6px;white-space:pre';
  document.body.append(el);

  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = []; // запросы к видеокарте ждут результата несколько кадров
  let active = null;

  let last = performance.now(), start = 0, shown = last;
  let intervals = [], cpu = 0, gpu = 0, gpuN = 0, frames = 0;
  // Доли кадра: mark(label) относит время с прошлой метки к label (в main.js — физика, трафик, отрисовка…).
  let markT = 0, parts = new Map();

  function poll() {
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gpuN++;
      }
      gl.deleteQuery(q);
    }
  }

  return {
    begin() {
      start = markT = performance.now();
      intervals.push(start - last);
      last = start;
      if (ext && pending.length < 8) {
        active = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
      }
    },
    mark(label) {
      const t = performance.now();
      parts.set(label, (parts.get(label) || 0) + t - markT);
      markT = t;
    },
    end() {
      if (active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(active);
        active = null;
      }
      if (ext) poll();
      cpu += performance.now() - start;
      frames++;
      if (start - shown < 1000) return;
      const sorted = intervals.sort((a, b) => a - b);
      const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      const p80 = sorted[Math.floor(sorted.length * 0.8)] ?? avg;
      const { calls, triangles } = renderer.info.render;
      const { geometries, textures } = renderer.info.memory;
      el.textContent = [
        `${Math.round(frames * 1000 / (start - shown))} fps  кадр ${avg.toFixed(1)} / ${p80.toFixed(1)} мс`,
        `JS ${(cpu / frames).toFixed(1)} мс  GPU ${ext ? (gpuN ? (gpu / gpuN).toFixed(1) + ' мс' : '…') : 'н/д'}`,
        [...parts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, t]) => `${l} ${(t / frames).toFixed(1)}`).join(' · '),
        `кадр: вызовов ${calls}  треуг. ${(triangles / 1000).toFixed(0)} тыс.`,
        `геом. ${geometries}  текст. ${textures}  px ${renderer.getPixelRatio()}`,
      ].join('\n');
      if (scene) {
        const rows = breakdown(scene, camera, renderer.shadowMap.enabled ? light : null);
        const sum = rows.reduce((s, r) => s + r.tris + r.sTris, 0);
        el.textContent += `\n\nтреуг.: кадр + тени (вызовы)   итого ${k(sum).trim()}\n` + rows
          .filter((r) => r.tris + r.sTris >= 1000 || r.calls + r.sCalls >= 10)
          .map((r) => `${r.label.padEnd(22)}${k(r.tris)} +${k(r.sTris)}  (${r.calls} + ${r.sCalls})`)
          .join('\n');
      }
      shown = start;
      intervals = [];
      cpu = gpu = gpuN = frames = 0;
      parts = new Map();
    },
  };
}
