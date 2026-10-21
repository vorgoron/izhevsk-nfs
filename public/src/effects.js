// Нитро: пламя из выхлопной трубы, искры (летят назад, падают, гаснут) и «линии скорости»
// по краям экрана. Пыль из-под колёс вне дороги, следы колёс и дым шин от заноса.
import * as THREE from 'three';

const SPARKS = 400, SPARK_LIFE = 0.45, SPARK_RATE = 260; // шт, с, шт/с

export class NitroFX {
  // lines — «линии скорости» по краям экрана (только у своей машины).
  constructor(scene, { lines = true } = {}) {
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
    this.lines = lines ? speedLines() : null;
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

    this.lines?.update(dt, on, Math.abs(car.speed));
  }
}

// Струи трюка (kickflip, как у Roadster): холодный газ, не пламя. Тонкая светлая сердцевина у сопла
// (конус, к концу тает в чёрное — при сложении это прозрачность) и поток мелких белых клубов вдоль оси
// сопла — он и делает струю видимой. Два сопла в днище толкают при взлёте и мягко сажают перед посадкой,
// на backflip они же крутят машину (переднее, потом заднее);
// четыре боковых (по два с борта, спереди и сзади) крутят оба трюка: момент даёт только вертикальная
// составляющая, поэтому сопла наклонены — на kickflip на одном борту бьют вниз, на другом вверх (оба
// борта крутят в одну сторону), на backflip передние вниз, задние вверх (нос вверх). На раскрутке и на
// торможении наклоны противоположные,
// тяга — по угловому ускорению: сильнее всего в начале и в конце оборота, в середине машина крутится
// по инерции и сопла почти гаснут. Руль в воздухе поворачивает машину ими же, горизонтально и
// накрест — переднее с одного борта и заднее с другого. Всё крутится вместе с машиной. На взлёте —
// кольцо дыма; после посадки — много пара: облако, стелющееся по земле, и ещё STEAM_TIME пар идёт
// из-под днища, стихая; клубы пара поднимаются (rise) и долго тают.
const JET_PUFFS = 1600, STREAM_RATE = 90; // шт; клубов в секунду из одного сопла на полной тяге
const SPIN_TILT = 0.6; // рад (~35°): наклон боковых сопел на обороте
const STEAM_TIME = 1.4, STEAM_RATE = 110; // с; клубов в секунду из-под днища сразу после посадки
const DOWN = new THREE.Vector3(0, -1, 0);

export class JetFX {
  constructor(scene) {
    // Сердцевина длиной 1 вдоль −y, широкий край у сопла; масштаб по y — длина.
    const core = (r) => {
      const g = new THREE.ConeGeometry(r, 1, 10, 4, true).rotateX(Math.PI).translate(0, -0.5, 0);
      const p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const f = (1 + p.getY(i)) ** 1.5; // 1 у сопла → 0 на конце
        c.set([0.85 * f, 0.93 * f, f], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    };
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const downGeo = core(0.1), sideGeo = core(0.075);
    // Сопло: { mesh, dir — ось струи в координатах машины, len — длина сердцевины, side/front — для боковых }.
    const nozzle = (geo, len, dir, extra) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      return { mesh, len, dir: new THREE.Vector3(...dir), k: 0, carry: 0, ...extra };
    };
    this.down = [0, 1].map(() => nozzle(downGeo, 1.9, [0, -1, 0]));
    this.side = [[1, true], [-1, true], [1, false], [-1, false]].map(([side, front]) => {
      return nozzle(sideGeo, 1.4, [side, 0, 0], { side, front });
    });
    this.all = [...this.down, ...this.side];

    // Клубы: точки разного размера (атрибут aSize, как у выхлопа).
    const n = JET_PUFFS;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.a = new Float32Array(n);
    this.rise = new Float32Array(n); // всплытие, м/с² (пар — тёплый)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, sizedPointsMaterial());
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.wasAir = false;
    this.landings = 0;
    this.steamT = 0;
    this.q = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.d = new THREE.Vector3();
  }

  // Новая машина: нижние сопла под передней и задней частью днища, боковые — на бортах.
  attach(model) {
    const len = model.userData.length ?? 4.2, w = (model.userData.width ?? 1.7) / 2;
    this.down[0].mesh.position.set(0, 0.3, len * 0.28);
    this.down[1].mesh.position.set(0, 0.3, -len * 0.28);
    for (const s of this.side) s.mesh.position.set(s.side * w, 0.65, (s.front ? 1 : -1) * len * 0.36);
    for (const n of this.all) model.add(n.mesh);
  }

  #puff(x, y, z, vx, vy, vz, life, s0, s1, a, rise = 0) {
    const i = this.next;
    this.next = (this.next + 1) % JET_PUFFS;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.max[i] = this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a[i] = a;
    this.rise[i] = rise;
  }

  update(dt, car) {
    const air = car.air;
    // Тяга нижних: на взлёте — полная и слабеет за 0,35 с; при снижении у земли — тормозящие струи.
    const thrust = !air ? 0 : air.t < 0.35 ? 1 - air.t / 0.35 * 0.6 : air.vy < 0 && car.alt < 2.2 ? 0.55 : 0;
    // Тяга — по угловому ускорению оборота c (car.js, air.acc): > 0 — раскрутка, < 0 — торможение и поправки
    // после перелёта; степень 0,7 — слабые поправки всё же заметны.
    const c = air ? Math.max(-1, Math.min(1, air.acc)) : 0;
    const spin = Math.abs(c) ** 0.7;
    // Backflip крутят нижние сопла: раскрутка — переднее (поднимает нос), торможение — заднее (поднимает хвост).
    const back = air?.kind === 'back';
    this.down[0].k = Math.max(thrust, back && c > 0 ? spin : 0);
    this.down[1].k = Math.max(thrust, back && c < 0 ? spin : 0);
    // Боковые крутят оба трюка, на всех четырёх тяга spin. Знак вертикальной составляющей ey струи:
    // kickflip — момент вокруг оси z от струи на борту side·x равен −side·ey, для момента знака dir·c
    // струя бьёт вниз (ey < 0) на борту side = dir·sign(c) и вверх на другом;
    // backflip — нос вверх: на раскрутке передние бьют вниз (подъём носа), задние вверх, на торможении наоборот.
    const roll = air ? spin : 0;
    const down = (s) => !air ? 0 : air.kind === 'back' ? (s.front ? 1 : -1) * Math.sign(c) : s.side * air.dir * Math.sign(c);
    // Руль вправо (курс уменьшается, нос к −x): нос толкает левое переднее, хвост — правое заднее.
    const st = car.airSteer;
    for (const s of this.side) {
      const yaw = Math.abs(st) > 0.15 && (s.front ? s.side : -s.side) === Math.sign(st) ? Math.min(1, Math.abs(st)) : 0;
      s.k = Math.max(roll, yaw);
      // Наклон — от доли «оборотной» тяги: рулим без оборота — сопло горизонтально.
      const tilt = s.k > 0 ? -SPIN_TILT * (roll / s.k) * down(s) : 0;
      s.dir.set(s.side * Math.cos(tilt), Math.sin(tilt), 0);
      s.mesh.quaternion.setFromUnitVectors(DOWN, s.dir); // −y сердцевины → по оси струи
    }

    const m = car.model.matrixWorld, p = this.p, d = this.d, t = performance.now() / 1000;
    for (const [i, n] of this.all.entries()) {
      n.mesh.visible = n.k > 0.06;
      if (!n.mesh.visible) { n.carry = 0; continue; }
      const wob = 1 + 0.12 * Math.sin(t * 47 + i * 1.7); // дрожит плавно, без скачков размера
      n.mesh.scale.set(0.7 + 0.3 * n.k, n.len * n.k * wob, 0.7 + 0.3 * n.k);
      // Поток клубов из сопла вдоль его оси (ось — в мир вместе с поворотом и оборотом машины).
      n.carry += STREAM_RATE * n.k * dt;
      if (n.carry < 1) continue;
      p.copy(n.mesh.position).applyMatrix4(m);
      d.copy(n.dir).transformDirection(m);
      for (; n.carry >= 1; n.carry--) {
        const v = (13 + 6 * n.k) * (0.85 + Math.random() * 0.3), j = () => (Math.random() - 0.5) * 0.12;
        this.#puff(p.x + j(), p.y + j(), p.z + j(), car.vel.x * 0.5 + d.x * v, d.y * v, car.vel.y * 0.5 + d.z * v,
          0.45 + Math.random() * 0.2, 0.45, 1.9, 0.75 * n.k);
      }
    }
    // Взлёт: кольцо дыма по земле во все стороны.
    if (air && !this.wasAir) {
      for (let k = 0; k < 50; k++) {
        const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 5;
        this.#puff(car.pos.x, car.y + 0.3, car.pos.y, car.vel.x * 0.3 + Math.cos(a) * s, 0.3 + Math.random() * 1.5, car.vel.y * 0.3 + Math.sin(a) * s,
          1.5 * (0.6 + Math.random() * 0.6), 1.2, 3.2, 0.5);
      }
    }
    this.wasAir = !!air;
    // Посадка: облако пара, расходится по земле во все стороны, потом пар ещё идёт из-под днища.
    const landed = (car.landings ?? 0) !== this.landings;
    this.landings = car.landings ?? 0;
    if (landed) {
      this.steamT = STEAM_TIME;
      for (let k = 0; k < 110; k++) {
        const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 6;
        this.#puff(car.pos.x + Math.cos(a) * 0.8, car.y + 0.2 + Math.random() * 0.4, car.pos.y + Math.sin(a) * 0.8,
          car.vel.x * 0.4 + Math.cos(a) * s, 0.2 + Math.random() * 0.8, car.vel.y * 0.4 + Math.sin(a) * s,
          2 + Math.random() * 1.2, 1, 4.2, 0.5, 0.7);
      }
    }
    if (this.steamT > 0) {
      const k = this.steamT / STEAM_TIME, m = car.model.matrixWorld, q = this.q;
      const len = car.model.userData.length ?? 4.2, w = (car.model.userData.width ?? 1.7) / 2;
      this.steamT -= dt;
      this.steamCarry = (this.steamCarry ?? 0) + STEAM_RATE * k * dt;
      for (; this.steamCarry >= 1; this.steamCarry--) {
        // Из-под днища в случайной точке, наружу от середины машины.
        q.set((Math.random() * 2 - 1) * w, 0.25, (Math.random() - 0.5) * len).applyMatrix4(m);
        const dx = q.x - car.pos.x, dz = q.z - car.pos.y, dl = Math.hypot(dx, dz) || 1, s = 1.5 + Math.random() * 2.5;
        this.#puff(q.x, q.y, q.z, car.vel.x * 0.6 + dx / dl * s, 0.4 + Math.random() * 0.8, car.vel.y * 0.6 + dz / dl * s,
          1.8 + Math.random() * 0.9, 0.8, 3.4, 0.42 * (0.4 + 0.6 * k), 1);
      }
    }

    const floor = car.y - car.alt + 0.15; // клубы не уходят в землю
    for (let i = 0; i < JET_PUFFS; i++) {
      const j = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const drag = Math.exp(-2.2 * dt);
      this.vel[j] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag + this.rise[i] * dt;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(floor, this.pos[j + 1] + this.vel[j + 1] * dt);
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const age = 1 - Math.max(0, this.life[i] / this.max[i]); // 0 → 1
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(age);
      this.col.set([0.92, 0.95, 1, this.a[i] * Math.min(1, age * 10) * (1 - age)], c);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
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
    // В заносе пыли втрое больше — грунтовый «дым» (на асфальте — TireSmokeFX).
    const rate = (car.offroad ?? 0) > 0.5 && speed > 3 && car.sink === 0 ? (25 + speed * 2.5) * (1 + 2 * slipAmount(car)) : 0;
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

// Следы задних колёс: на асфальте — чёрные полосы от заноса и ручника, на грунте — бурые колеи.
// Лента из четырёхугольников по SKID_STEP м, общий кольцевой буфер на SKIDS кусков: новые затирают
// самые старые; за четверть буфера до того, как затереться, кусок тускнеет вдвое. Лежат на 4 см над поверхностью и
// сдвинуты к камере, чтобы не мерцать с асфальтом.
const SKIDS = 3000, SKID_STEP = 0.4, SKID_W = 0.3, SKID_LIFT = 0.04;
const SKID_COLOR = { road: [0.02, 0.02, 0.025, 0.75], ground: [0.24, 0.18, 0.11, 0.6] };

// Насколько скользят задние колёса, 0..1: занос, ручник на ходу, срыв после удара; на грунте — уже при
// слабом скольжении. Общее для следов и дыма.
function slipAmount(car) {
  if (car.air || car.onTop || car.sink > 0) return 0;
  const vf = car.vel.dot(car.forward), vr = Math.abs(car.vel.dot(car.right));
  if (Math.abs(vf) <= 2) return 0;
  const k = (car.offroad ?? 0) > 0.5 ? (vr - 0.8) / 3 : (vr - 1.5) / 5;
  return Math.max(car.handbrake ? 0.7 : 0, Math.min(1, Math.max(0, k)));
}

export class SkidMarksFX {
  constructor(scene, world) {
    this.world = world;
    this.pos = new Float32Array(SKIDS * 4 * 3);
    this.col = new Float32Array(SKIDS * 4 * 4);
    const idx = new Uint32Array(SKIDS * 6);
    for (let i = 0; i < SKIDS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.next = 0;
    this.count = 0;
    this.wheels = [null, null]; // последняя точка каждого колеса: { x, z, l: [x, y, z], r: [x, y, z] }
  }

  update(dt, car) {
    const f = car.forward, r = car.right;
    const k = slipAmount(car);
    // Цвет — по покрытию прямо под машиной (offroad сглажен и отстаёт на съезде с дороги).
    const color = SKID_COLOR[car.surface === 'ground' || car.surface === 'dirt' ? 'ground' : 'road'];
    for (let w = 0; w < 2; w++) {
      const side = w ? 0.75 : -0.75;
      const x = car.pos.x - f.x * 1.3 + r.x * side, z = car.pos.y - f.y * 1.3 + r.y * side;
      const last = this.wheels[w];
      if (k <= 0) { this.wheels[w] = null; continue; }
      if (last && Math.hypot(x - last.x, z - last.z) < SKID_STEP) continue;
      // Поперёк хода колеса; первая точка — поперёк кузова.
      let dx = last ? x - last.x : f.x, dz = last ? z - last.z : f.y;
      const d = Math.hypot(dx, dz) || 1;
      if (last && d > 3) { this.wheels[w] = null; continue; } // респаун, переброска — не тянем ленту
      const nx = -dz / d * SKID_W / 2, nz = dx / d * SKID_W / 2;
      const y = this.world.ground(x, z, car.y) + SKID_LIFT;
      const cur = { x, z, l: [x + nx, y, z + nz], r: [x - nx, y, z - nz] };
      if (last) this.#quad(last, cur, color, k);
      this.wheels[w] = cur;
    }
  }

  #quad(a, b, color, k) {
    const i = this.next;
    this.next = (this.next + 1) % SKIDS;
    this.count = Math.min(SKIDS, this.count + 1);
    this.pos.set([...a.l, ...a.r, ...b.l, ...b.r], i * 12);
    const alpha = color[3] * k;
    for (let v = 0; v < 4; v++) this.col.set([color[0], color[1], color[2], alpha], i * 16 + v * 4);
    // В видеокарту грузятся только изменённые куски, а не весь буфер.
    const { position, color: col } = this.mesh.geometry.attributes;
    position.addUpdateRange(i * 12, 12);
    col.addUpdateRange(i * 16, 16);
    if (this.count === SKIDS) {
      const j = (i + SKIDS / 4) % SKIDS;
      for (let v = 0; v < 4; v++) this.col[j * 16 + v * 4 + 3] *= 0.5;
      col.addUpdateRange(j * 16, 16);
    }
    position.needsUpdate = col.needsUpdate = true;
  }
}

// Удар машин: сноп искр и осколков стекла из точки контакта — разлетаются от удара и вверх, падают,
// отскакивают от асфальта и гаснут. Один пул на все удары.
const HITS = 240, HIT_LIFE = 0.7;

export class HitFX {
  constructor(scene) {
    this.pos = new Float32Array(HITS * 3);
    this.col = new Float32Array(HITS * 3);
    this.base = new Float32Array(HITS * 3);
    this.vel = new Float32Array(HITS * 3);
    this.floor = new Float32Array(HITS);
    this.life = new Float32Array(HITS);
    this.max = new Float32Array(HITS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.22, map: glowDot(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.alive = 0;
  }

  // (x, y, z) — точка удара, (nx, nz) — куда отлетает, strength 0..1.
  burst(x, y, z, nx, nz, strength) {
    const n = Math.round(12 + 50 * strength);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % HITS;
      const glass = Math.random() < 0.3;
      const sp = (2 + Math.random() * 7) * (0.5 + strength);
      const a = Math.random() * Math.PI * 2, side = Math.random() * 0.9;
      // Конус вокруг нормали: в основном наружу и вверх, немного вбок.
      const tx = -nz, tz = nx, sx = Math.cos(a) * side;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([(nx + tx * sx) * sp, (0.4 + Math.random() * 0.9) * sp * 0.6, (nz + tz * sx) * sp], i * 3);
      this.base.set(glass ? [0.75, 0.85, 0.95] : [1, 0.55 + Math.random() * 0.3, 0.15], i * 3);
      this.floor[i] = y - 0.55;
      this.life[i] = this.max[i] = HIT_LIFE * (0.4 + Math.random() * 0.8) * (glass ? 1.6 : 1);
    }
    this.alive = HIT_LIFE * 2;
  }

  update(dt) {
    if (this.alive <= 0) return; // нечего обновлять
    this.alive -= dt;
    for (let i = 0; i < HITS; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) { this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      this.life[i] -= dt;
      this.vel[j + 1] -= 12 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < this.floor[i]) {
        this.pos[j + 1] = this.floor[i];
        this.vel[j + 1] *= -0.3;
        this.vel[j] *= 0.5;
        this.vel[j + 2] *= 0.5;
      }
      const t = Math.max(0, this.life[i] / this.max[i]);
      for (let c = 0; c < 3; c++) this.col[j + c] = this.base[j + c] * t;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// Точки с размером на каждую (атрибут aSize, м); туман и прозрачность — от штатного PointsMaterial.
function sizedPointsMaterial() {
  const mat = new THREE.PointsMaterial({ size: 1, map: glowDot(), vertexColors: true, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'attribute float aSize;\nvoid main() {')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  };
  return mat;
}

// Дым из-под задних колёс в заносе на асфальте: клубы рождаются у колёс, чуть увлекаются машиной,
// растут до TIRE_SIZE м, поднимаются и тают за TIRE_LIFE с. Чем сильнее скольжение, тем чаще и гуще.
const TIRE_N = 320, TIRE_LIFE = 2.2, TIRE_RATE = 70, TIRE_SIZE = 4.5; // шт, с, шт/с на оба колеса, м

export class TireSmokeFX {
  constructor(scene) {
    this.pos = new Float32Array(TIRE_N * 3);
    this.col = new Float32Array(TIRE_N * 4);
    this.size = new Float32Array(TIRE_N);
    this.vel = new Float32Array(TIRE_N * 3);
    this.life = new Float32Array(TIRE_N);
    this.max = new Float32Array(TIRE_N);
    this.k = new Float32Array(TIRE_N); // густота клуба — по скольжению при рождении
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, sizedPointsMaterial());
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.carry = 0;
    this.alive = 0; // сколько ещё живут клубы — потом кадр не считаем
  }

  update(dt, car) {
    const k = car.surface === 'ground' || car.surface === 'dirt' ? 0 : slipAmount(car);
    this.carry += TIRE_RATE * k * dt;
    if (this.carry >= 1) this.alive = TIRE_LIFE * 1.3;
    const f = car.forward, r = car.right;
    while (this.carry >= 1) {
      this.carry--;
      const i = this.next;
      this.next = (this.next + 1) % TIRE_N;
      const side = Math.random() < 0.5 ? -0.75 : 0.75, back = Math.random() * dt;
      const x = car.pos.x - f.x * 1.3 + r.x * side - car.vel.x * back, z = car.pos.y - f.y * 1.3 + r.y * side - car.vel.y * back;
      this.pos.set([x, car.y + 0.3, z], i * 3);
      this.vel.set([car.vel.x * 0.3 + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.8, car.vel.y * 0.3 + (Math.random() - 0.5) * 2], i * 3);
      this.max[i] = this.life[i] = TIRE_LIFE * (0.7 + Math.random() * 0.6);
      this.k[i] = k;
    }
    if (this.alive <= 0) return;
    this.alive -= dt;
    for (let i = 0; i < TIRE_N; i++) {
      const j = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const drag = Math.exp(-1.6 * dt);
      this.vel[j] *= drag;
      this.vel[j + 1] *= Math.exp(-0.6 * dt);
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const age = 1 - Math.max(0, this.life[i] / this.max[i]); // 0 → 1
      this.size[i] = 0.8 + (TIRE_SIZE - 0.8) * Math.sqrt(age);
      // Быстро густеет у колеса, долго тает.
      this.col.set([0.86, 0.86, 0.88, 0.4 * (0.4 + 0.6 * this.k[i]) * Math.min(1, age * 6) * (1 - age) ** 1.5], c);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
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
    this.points = new THREE.Points(geo, sizedPointsMaterial());
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
