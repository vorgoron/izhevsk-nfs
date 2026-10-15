// Нитро: пламя из выхлопной трубы, искры (летят назад, падают, гаснут) и «линии скорости»
// по краям экрана. Пыль из-под колёс вне дороги.
import * as THREE from 'three';

const SPARKS = 400, SPARK_LIFE = 0.45, SPARK_RATE = 260; // шт, с, шт/с

export class NitroFX {
  constructor(scene) {
    this.scene = scene;
    // Пламя: два конуса (внешний оранжевый, внутренний бело-голубой), смотрят назад.
    const cone = (r, l, color, opacity) => new THREE.Mesh(
      // Широкий край у трубы (z = 0), острие — назад (−z).
      new THREE.ConeGeometry(r, l, 10, 1, true).translate(0, l / 2, 0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.flame = new THREE.Group();
    this.outer = cone(0.24, 1.9, '#ff7a1a', 0.85);
    this.inner = cone(0.13, 1.1, '#9fd8ff', 0.95);
    this.flame.add(this.outer, this.inner);
    this.flame.visible = false;

    // Искры: точки с аддитивным смешением, цвет гаснет к концу жизни.
    this.pos = new Float32Array(SPARKS * 3);
    this.col = new Float32Array(SPARKS * 3);
    this.vel = new Float32Array(SPARKS * 3);
    this.life = new Float32Array(SPARKS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.3, map: glowDot(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.carry = 0;
    this.t = 0;
    this.lines = speedLines();
  }

  // Новая машина: пламя — в её выхлопную трубу (слева сзади, под бампером).
  attach(model) {
    const len = model.userData.length ?? 4.2;
    this.flame.position.set(-0.45, 0.33, -len / 2 - 0.05);
    model.add(this.flame);
    this.exhaust = this.flame.position;
  }

  update(dt, car) {
    this.t += dt;
    const on = !!car.nitroOn;
    this.flame.visible = on;
    if (on) {
      // Пламя мерцает.
      const k = 0.75 + Math.random() * 0.5;
      this.outer.scale.set(1, k * 1.2, 1);
      this.inner.scale.set(1, 0.7 + Math.random() * 0.5, 1);
    }

    // Рождение искр у трубы.
    const m = car.model.matrixWorld, p = new THREE.Vector3(), back = new THREE.Vector3(0, 0, -1).transformDirection(m);
    if (on) {
      this.carry += SPARK_RATE * dt;
      while (this.carry >= 1) {
        this.carry--;
        const i = this.next;
        this.next = (this.next + 1) % SPARKS;
        p.copy(this.exhaust).applyMatrix4(m);
        this.pos.set([p.x, p.y, p.z], i * 3);
        const s = 5 + Math.random() * 7;
        this.vel.set([
          car.vel.x * 0.7 + back.x * s + (Math.random() - 0.5) * 3,
          1.2 + Math.random() * 2.5,
          car.vel.y * 0.7 + back.z * s + (Math.random() - 0.5) * 3,
        ], i * 3);
        this.life[i] = SPARK_LIFE * (0.6 + Math.random() * 0.6);
      }
    }
    // Полёт: тормозятся воздухом, падают, гаснут от белого через оранжевый к красному.
    for (let i = 0; i < SPARKS; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= 12 * dt;
      const drag = Math.exp(-2.5 * dt);
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = Math.max(0, this.life[i] / SPARK_LIFE);
      this.col[j] = 1;
      this.col[j + 1] = 0.25 + 0.75 * t;
      this.col[j + 2] = 0.1 + 0.6 * t * t;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;

    this.lines.update(dt, on, Math.abs(car.speed));
  }
}

// «Линии скорости»: короткие белые штрихи от центра к краям экрана, только на нитро.
function speedLines() {
  const c = document.createElement('canvas');
  c.id = 'speedlines';
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  document.body.append(c);
  const g = c.getContext('2d');
  let alpha = 0;
  const streaks = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), v: 0.8 + Math.random() }));
  return {
    update(dt, on, speed) {
      alpha += ((on ? Math.min(1, speed / 45) : 0) - alpha) * Math.min(1, dt * 6);
      if (c.width !== innerWidth || c.height !== innerHeight) { c.width = innerWidth; c.height = innerHeight; }
      g.clearRect(0, 0, c.width, c.height);
      if (alpha < 0.02) return;
      const cx = c.width / 2, cy = c.height * 0.45, R = Math.hypot(cx, cy);
      g.lineCap = 'round';
      for (const s of streaks) {
        s.r += dt * s.v * 1.6;
        if (s.r > 1) { s.r = 0.35 + Math.random() * 0.2; s.a = Math.random() * Math.PI * 2; }
        const r0 = R * s.r, r1 = r0 + R * 0.12 * s.v;
        g.strokeStyle = `rgba(255,255,255,${0.35 * alpha * (s.r - 0.3)})`;
        g.lineWidth = 1.5 + 2 * s.r;
        g.beginPath();
        g.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
        g.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        g.stroke();
      }
    },
  };
}

// Круглая светящаяся точка для искр.
function glowDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// Пыль из-под задних колёс на грунте: клубы поднимаются, расплываются и тают.
const DUST = 240, DUST_LIFE = 1.1;

export class DustFX {
  constructor(scene) {
    this.pos = new Float32Array(DUST * 3);
    this.col = new Float32Array(DUST * 4);
    this.vel = new Float32Array(DUST * 3);
    this.life = new Float32Array(DUST);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.6, map: glowDot(), vertexColors: true, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.carry = 0;
  }

  update(dt, car) {
    const speed = Math.abs(car.speed);
    const rate = (car.offroad ?? 0) > 0.5 && speed > 3 && car.sink === 0 ? 25 + speed * 2.5 : 0;
    this.carry += rate * dt;
    const m = car.model.matrixWorld, p = new THREE.Vector3();
    while (this.carry >= 1) {
      this.carry--;
      const i = this.next;
      this.next = (this.next + 1) % DUST;
      // У одного из задних колёс.
      p.set(Math.random() < 0.5 ? -0.75 : 0.75, 0.2, -1.3).applyMatrix4(m);
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([car.vel.x * 0.25 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 1.2, car.vel.y * 0.25 + (Math.random() - 0.5) * 1.5], i * 3);
      this.life[i] = DUST_LIFE * (0.7 + Math.random() * 0.6);
    }
    for (let i = 0; i < DUST; i++) {
      const j = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; continue; }
      this.life[i] -= dt;
      const drag = Math.exp(-1.8 * dt);
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = Math.max(0, this.life[i] / DUST_LIFE);
      this.col.set([0.62, 0.55, 0.42, 0.45 * t * (1 - t) * 4 * 0.6], c);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// Выхлоп из трубы: клубы растут, поднимаются, сносятся назад и тают. На холостых — редкие светлые
// облачка, под газом — чаще и гуще; заглох (пустой бак, вода) — нет. Точки разного размера:
// PointsMaterial с атрибутом aSize (туман и прозрачность остаются от штатного материала).
// Один пул на много источников: машина игрока (update) или трафик (emit на каждую машину + step).
const SMOKE_LIFE = 1.1;

export class ExhaustFX {
  constructor(scene, count = 160) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 4);
    this.size = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count); // своя длительность жизни у клуба
    this.dark = new Float32Array(count);
    this.thin = new Float32Array(count);
    this.size0 = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 1, map: glowDot(), vertexColors: true, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'attribute float aSize;\nvoid main() {')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    };
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.exhaust = new THREE.Vector3();
    this.src = { carry: 0 }; // накопитель рождения для машины игрока
    this.p = new THREE.Vector3();
    this.back = new THREE.Vector3();
  }

  // Труба — там же, где пламя нитро: слева сзади, под бампером.
  attach(model) {
    this.exhaust.set(-0.45, 0.33, -(model.userData.length ?? 4.2) / 2 - 0.1);
  }

  // Машина игрока: выпустить и прожить кадр.
  update(dt, car) {
    const running = car.fuel > 0 && car.sink === 0;
    const throttle = Math.min(1, Math.max(0, (car.accel_ ?? 0) / 5));
    this.emit(dt, this.src, car.model.matrixWorld, this.exhaust, car.vel.x, car.vel.y, Math.abs(car.speed), running ? throttle : -1);
    this.step(dt);
  }

  // Клубы из трубы exhaust (в координатах машины с матрицей m). src.carry — дробная часть рождения
  // у этого источника; throttle 0..1, меньше 0 — мотор заглох.
  emit(dt, src, m, exhaust, vx, vz, speed, throttle, rateK = 1) {
    if (throttle < 0) return;
    // На ходу клубы чаще (иначе за машиной цепочка точек), но прозрачнее — дым размазан по пути.
    const spread = 1 + Math.min(speed, 30) / 12;
    src.carry = (src.carry ?? 0) + Math.min(80, (4 + 18 * throttle) * spread) * rateK * dt;
    if (src.carry < 1) return;
    const p = this.p, back = this.back.set(0, 0, -1).transformDirection(m);
    p.copy(exhaust).applyMatrix4(m);
    while (src.carry >= 1) {
      src.carry--;
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      // Случайная точка на отрезке, пройденном за кадр, — иначе на скорости дым идёт пятнами.
      const back1 = Math.random() * dt;
      this.pos.set([p.x - vx * back1, p.y, p.z - vz * back1], i * 3);
      const s = 1 + throttle * 1.8;
      this.vel.set([
        vx * 0.15 + back.x * s + (Math.random() - 0.5) * 0.4, // почти не увлекается машиной — висит в воздухе
        0.2 + Math.random() * 0.25,
        vz * 0.15 + back.z * s + (Math.random() - 0.5) * 0.4,
      ], i * 3);
      this.max[i] = this.life[i] = SMOKE_LIFE * (0.7 + Math.random() * 0.6);
      this.dark[i] = throttle;
      this.thin[i] = 1 / spread;
      this.size0[i] = 0.2 + Math.min(speed, 30) * 0.02; // на скорости клуб сразу растянут потоком
    }
  }

  step(dt) {
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const drag = Math.exp(-2.2 * dt);
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const age = 1 - Math.max(0, this.life[i] / this.max[i]); // 0 → 1
      this.size[i] = this.size0[i] + 1.0 * Math.sqrt(age);
      const g = 0.82 - 0.25 * this.dark[i];
      // Быстро проявляется у трубы, медленно тает.
      this.col.set([g, g, g * 1.02, (0.16 + 0.12 * this.dark[i]) * (0.4 + 0.6 * this.thin[i]) * Math.min(1, age * 8) * (1 - age)], c);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }
}
