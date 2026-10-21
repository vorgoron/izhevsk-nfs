// Небо: купол с градиентом (горизонт светлее, зенит синее), солнце с ореолом, перистые облака и кучевые
// с плоским низом — всё в шейдере купола, облака несёт ветром. Облака перенесены из n4spb
// (github.com/averkij/n4spb, src/core/sky.js, © Sergei Averkiev, Apache License 2.0): кучевые — поле высот
// из шума, по которому идут несколько шагов сквозь тонкий слой (основание и купол), освещение — по нормали поля.
// Ночью облаков нет — звёзды и луна.
import * as THREE from 'three';

export const HORIZON = '#b4cbe0'; // цвет горизонта = цвет тумана
const ZENITH = '#5f93cf';
// Ночью: тёмно-синий зенит, у горизонта — рыжеватая засветка города.
const NIGHT_HORIZON = '#1d2133', NIGHT_ZENITH = '#03060f';
const STARS = 900;
// Облака днём и ночью: освещённая сторона, тень, низ, тёплый отсвет к солнцу.
const CLOUD = { lit: '#fffaf0', shade: '#d6deee', base: '#b0bfd9', glow: '#ffd9a8' };
const NIGHT_CLOUD = { lit: '#3c4458', shade: '#272d3d', base: '#1b2030', glow: '#000000' };

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const FRAG = /* glsl */`
uniform vec3 horizon, zenith, uSun, uCloudLit, uCloudShade, uCloudBase, uCloudGlow, uWarm;
uniform float uTime, uDisc, uCumulus, uCirrus, uNight;
varying vec3 vDir;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm3(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<3;i++){ s += a*vn(p); p = ROT*p; a*=0.5; } return s / 0.875; }
float fbm4(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s += a*vn(p); p = ROT*p; a*=0.5; } return s / 0.9375; }
const vec2 WIND = vec2(0.93, 0.36);
const float CPAR = 0.42;   // насколько облако шире кверху
const float CSC = 1.35;    // частота кучевых (больше — мельче)
// облако над точкой основания: внутри, где cumF > y^2 / 3 (купол с плоским низом при y = 0)
float cumF(vec2 p, float thr){ return fbm4(p) - thr; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y, hp = max(h, 0.0);
  vec3 S = normalize(uSun);
  float sd = dot(d, S);
  vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.45, h));

  // солнце: ореол и диск
  float day = 1.0 - uNight;
  vec3 aur = mix(uWarm, vec3(1.0), 0.45);
  col += aur * (pow(max(sd, 0.0), 22.0) * 0.16 + pow(max(sd, 0.0), 120.0) * 0.30) * day;
  col += vec3(1.0, 0.96, 0.85) * 2.3 * smoothstep(0.99962, 0.99978, sd) * uDisc;

  // перистые: тонкие короткие пряди высоко
  if (h > 0.0 && uCirrus > 0.01 && day > 0.01) {
    vec2 cp = d.xz / (h + 0.18) * 0.9;
    cp = vec2(dot(cp, WIND), dot(cp, vec2(-WIND.y, WIND.x)));
    cp.x += uTime * 0.0012;
    cp += (vec2(fbm3(cp * 0.7 + 3.1), fbm3(cp * 0.7 + 8.7)) - 0.5) * 1.1;
    float st = fbm3(vec2(cp.x * 1.2, cp.y * 2.6) + 5.0) * 0.75 + fbm3(vec2(cp.x * 3.4, cp.y * 8.0) + 17.0) * 0.40;
    float cir = smoothstep(0.70 - 0.12 * uCirrus, 0.86 - 0.10 * uCirrus, st);
    cir *= smoothstep(0.40, 0.68, fbm3(cp * 0.3 + 2.0));
    cir *= smoothstep(0.02, 0.16, hp);
    cir *= day;
    col = mix(col, mix(uCloudLit, uCloudShade, 0.15), cir * 0.42);
    col += uCloudGlow * cir * pow(max(sd, 0.0), 6.0) * 0.30;
  }

  // кучевые: шаги сквозь слой (основание 1, верх до 1.9), свет по нормали поля
  // ночью облаков нет: растворяются вместе с сумерками (day → 0), в полной ночи не считаются
  if (h > 0.01 && uCumulus > 0.01 && day > 0.01) {
    float thr = mix(0.80, 0.52, clamp(uCumulus, 0.0, 1.0)) + 0.20 * smoothstep(0.25, 0.75, hp);   // в зените чище
    vec2 dir = d.xz / (h + 0.22);
    vec2 drift = WIND * uTime * 0.0025;
    float yPrev = 0.0, yHit = -1.0, bestM = -1.0, bestY = 0.0;
    for (int i = 0; i < CUM_STEPS; i++) {
      float y = float(i) / float(CUM_STEPS - 1);
      float m = cumF((dir * (1.0 + CPAR * y) + drift) * CSC, thr) - y * y * 0.3333;
      if (m > bestM) { bestM = m; bestY = y; }
      if (yHit < 0.0 && m > 0.0) {
        if (i == 0) yHit = 0.0;
        else {
          float lo = yPrev, hi = y;
          for (int j = 0; j < 5; j++) { float mid = 0.5 * (lo + hi); if (cumF((dir * (1.0 + CPAR * mid) + drift) * CSC, thr) - mid * mid * 0.3333 > 0.0) hi = mid; else lo = mid; }
          yHit = hi;
        }
      }
      yPrev = y;
    }
    float a = smoothstep(-0.012, 0.012, bestM) * smoothstep(0.012, 0.075, h) * day;
    if (a > 0.003) {
      float ys = yHit >= 0.0 ? yHit : bestY;
      vec2 pH = (dir * (1.0 + CPAR * ys) + drift) * CSC;
      vec2 g = vec2(fbm3(pH + vec2(0.16, 0.0)) - fbm3(pH - vec2(0.16, 0.0)), fbm3(pH + vec2(0.0, 0.16)) - fbm3(pH - vec2(0.0, 0.16))) / 0.32;
      vec3 N = normalize(vec3(-g.x * CSC, ys * 0.74 + 0.05, -g.y * CSC));
      float lit = smoothstep(0.04, 0.26, dot(N, S));
      float under = 1.0 - smoothstep(0.0, 0.12, ys);
      vec3 cc = mix(uCloudShade, uCloudLit, lit);
      cc = mix(cc, uCloudBase, under);
      cc += uCloudGlow * pow(max(sd, 0.0), 5.0) * (0.25 + 0.55 * lit);
      cc = mix(cc, col, (1.0 - smoothstep(0.02, 0.22, h)) * 0.55);   // дальние тают в дымке
      col = mix(col, cc, a);
    }
  }
  col = mix(col, horizon, 1.0 - smoothstep(-0.10, 0.015, h));   // под горизонтом — цвет тумана
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  // low — меньше шагов сквозь слой кучевых (телефон, ?lite).
  constructor(scene, { low = false } = {}) {
    // Купол следует за камерой; рисуется первым, без тумана и записи глубины.
    const C = (h) => new THREE.Color(h);
    this.uniforms = {
      horizon: { value: C(HORIZON) }, zenith: { value: C(ZENITH) },
      uSun: { value: new THREE.Vector3(-0.5, 0.8, 0.35).normalize() }, uTime: { value: 0 },
      uCloudLit: { value: C(CLOUD.lit) }, uCloudShade: { value: C(CLOUD.shade) }, uCloudBase: { value: C(CLOUD.base) },
      uCloudGlow: { value: C(CLOUD.glow) }, uWarm: { value: C('#fff0d0') },
      uDisc: { value: 1 }, uNight: { value: 0 },
      uCumulus: { value: 0.5 }, uCirrus: { value: 0.5 }, // покрытие кучевыми и перистыми, 0…1
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3500, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: this.uniforms,
        defines: { CUM_STEPS: low ? 5 : 8 },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: FRAG,
      }),
    );
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    scene.add(dome);
    this.dome = dome;
    this.horizon = new THREE.Color(HORIZON);
    this.colors = [HORIZON, ZENITH, NIGHT_HORIZON, NIGHT_ZENITH].map((c) => new THREE.Color(c));
    this.cloud = [CLOUD, NIGHT_CLOUD].map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, C(v)])));
    this.time = 0;

    // Ночью — звёзды (точки на куполе, выше горизонта, ближе к нему — тусклее) и луна там, откуда свет.
    const sr = rand(777);
    const sp = new Float32Array(STARS * 3), sc = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const y = 0.08 + 0.92 * Math.sqrt(sr()), a = sr() * Math.PI * 2, h = Math.sqrt(1 - y * y);
      sp.set([Math.cos(a) * h * 3300, y * 3300, Math.sin(a) * h * 3300], i * 3);
      const b = (0.35 + 0.65 * sr() ** 3) * Math.min(1, y * 3);
      sc.set([b * (0.85 + 0.15 * sr()), b * 0.92, b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true,
      fog: false, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    dome.add(this.stars);
    const mc = document.createElement('canvas');
    mc.width = mc.height = 128;
    const g = mc.getContext('2d');
    const halo = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    halo.addColorStop(0, 'rgba(220,230,255,0.5)');
    halo.addColorStop(1, 'rgba(220,230,255,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#eef1f7';
    g.beginPath(); g.arc(64, 64, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,160,180,0.35)'; // моря
    for (const [x, y, r] of [[58, 58, 5], [70, 66, 4], [61, 71, 3]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    const moonTex = new THREE.CanvasTexture(mc);
    moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true, opacity: 0, depthWrite: false }));
    this.moon.scale.setScalar(420);
    this.moon.renderOrder = -1;
    this.moon.visible = false;
    dome.add(this.moon);
  }

  // Ночь 0…1: цвета купола (горизонт — он же цвет тумана, this.horizon), звёзды, луна, тёмные облака.
  // dir — направление на луну (откуда светит directional-свет).
  setNight(s, dir) {
    const [h, z, nh, nz] = this.colors, u = this.uniforms;
    u.horizon.value.copy(h).lerp(nh, s);
    u.zenith.value.copy(z).lerp(nz, s);
    this.horizon.copy(u.horizon.value);
    this.stars.visible = this.moon.visible = s > 0.01;
    this.stars.material.opacity = s;
    this.moon.material.opacity = s;
    if (dir) this.moon.position.copy(dir).multiplyScalar(3000);
    u.uSun.value.copy(dir || u.uSun.value);
    u.uNight.value = s;
    u.uDisc.value = 1 - s;
    const [day, night] = this.cloud;
    u.uCloudLit.value.copy(day.lit).lerp(night.lit, s);
    u.uCloudShade.value.copy(day.shade).lerp(night.shade, s);
    u.uCloudBase.value.copy(day.base).lerp(night.base, s);
    u.uCloudGlow.value.copy(day.glow).lerp(night.glow, s);
  }

  update(dt, camera) {
    this.dome.position.copy(camera.position);
    // Дальняя плоскость камеры — по концу тумана (main.js): купол сжимаем, чтобы он не обрезался.
    this.dome.scale.setScalar(Math.min(1, (camera.far * 0.95) / 3500));
    this.uniforms.uTime.value = this.time += dt;
  }
}
