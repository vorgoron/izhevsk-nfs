// Замер производительности: `?perf` в адресе. Табличка в углу раз в секунду:
// кадры в секунду, интервал кадра (среднее и худший из 20 %), время JS на кадр
// (логика + отправка рендера), время видеокарты (где есть EXT_disjoint_timer_query —
// в Chrome на Android и ПК есть, в Safari нет), вызовы отрисовки и треугольники.
export function createPerf(renderer) {
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
      start = performance.now();
      intervals.push(start - last);
      last = start;
      if (ext && pending.length < 8) {
        active = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
      }
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
        `вызовов ${calls}  треуг. ${(triangles / 1000).toFixed(0)} тыс.`,
        `геом. ${geometries}  текст. ${textures}  px ${renderer.getPixelRatio()}`,
      ].join('\n');
      shown = start;
      intervals = [];
      cpu = gpu = gpuN = frames = 0;
    },
  };
}
