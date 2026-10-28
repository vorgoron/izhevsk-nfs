// Контактная тень своей машины: мягкое тёмное пятно под кузовом по поверхности (наклон — по четырём точкам, как у
// машины), повёрнутое с машиной. Тень солнца на «средней» — 23 см на точку карты теней и размыта, на «низкой» её
// нет вовсе — без пятна машина будто висит над дорогой. В прыжке пятно растёт и бледнеет.
import * as THREE from 'three';

const OPACITY = 0.55, FADE = 5; // м над поверхностью — пятна уже нет
const PAD = [0.4, 0.5];        // м: пятно шире и длиннее кузова — на размытый край, середина целиком под машиной

// Мягкий прямоугольник: прозрачность — произведение плавных спадов поперёк и вдоль (край — внешние 30 %).
function shadowTexture() {
  const W = 32, H = 64, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  const fall = (t) => { const k = Math.min(1, Math.max(0, (1 - Math.abs(t)) / 0.3)); return k * k * (3 - 2 * k); };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    img.data[(j * W + i) * 4 + 3] = 255 * fall((i + 0.5) / W * 2 - 1) * fall((j + 0.5) / H * 2 - 1);
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

export class CarShadow {
  constructor(scene) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh.renderOrder = 1; // после асфальта и разметки
    this.mesh.userData.perf = 'машина игрока';
    scene.add(this.mesh);
    this.size = [1.9, 4.3];
    this.n = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.yaw = new THREE.Quaternion();
  }

  // Размер — из габаритов модели (vehicles.js), без зеркал.
  fit(model) {
    this.size = [model.userData.width ?? 1.7, model.userData.length ?? 4.2];
  }

  update(car, world) {
    const m = this.mesh, alt = Math.max(0, car.alt), y = car.y - car.alt;
    const k = 1 - Math.min(1, alt / FADE);
    m.visible = k > 0.02;
    if (!m.visible) return;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), x = car.pos.x, z = car.pos.y, ref = y + 0.5;
    const hf = world.ground(x + fx * 1.6, z + fz * 1.6, ref), hb = world.ground(x - fx * 1.6, z - fz * 1.6, ref);
    const hl = world.ground(x + fz * 0.9, z - fx * 0.9, ref), hr = world.ground(x - fz * 0.9, z + fx * 0.9, ref);
    // Нормаль поверхности из уклонов вдоль и поперёк машины; ступенька (бордюр, край моста) — не наклонять.
    const sl = Math.abs(hf - hb) < 1.2 ? (hf - hb) / 3.2 : 0, sw = Math.abs(hl - hr) < 1.2 ? (hl - hr) / 1.8 : 0;
    this.n.set(-fx * sl - fz * sw, 1, -fz * sl + fx * sw).normalize(); // под уклон
    this.q.setFromUnitVectors(this.up, this.n);
    m.quaternion.copy(this.q).multiply(this.yaw.setFromAxisAngle(this.up, car.heading));
    const grow = 1 + alt * 0.12;
    m.scale.set((this.size[0] + PAD[0]) * grow, 1, (this.size[1] + PAD[1]) * grow);
    m.position.set(x, y + 0.03, z);
    m.material.opacity = OPACITY * k;
  }
}
