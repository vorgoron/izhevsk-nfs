// Контактная тень своей машины: мягкое тёмное пятно под кузовом по поверхности (наклон — по четырём точкам, как у
// машины), повёрнутое с машиной. Тень солнца на «средней» — 23 см на точку карты теней и размыта, на «низкой» её
// нет вовсе — без пятна машина будто висит над дорогой. В прыжке пятно растёт и бледнеет.
import * as THREE from 'three';

const OPACITY = 0.6, FADE = 5; // м над поверхностью — пятна уже нет
const PAD = [0.9, 0.7];        // м: пятно длиннее и шире кузова (край размыт, под кузовом его не видно)

// Прямоугольник со скруглёнными углами и размытым краем: стопка всё меньших полупрозрачных прямоугольников.
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const N = 16;
  for (let i = 0; i < N; i++) {
    const k = i / N, x = 2 + k * 10, y = 3 + k * 14, r = 20 - k * 10;
    g.fillStyle = `rgba(0,0,0,${0.14 + k * 0.04})`;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, 64 - 2 * x, 128 - 2 * y, Math.max(2, r));
    else g.rect(x, y, 64 - 2 * x, 128 - 2 * y);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

  // Размер — по кузову модели (в её осях, без поворота и крена); фары и их лучи (MeshBasic, прозрачное) не в счёт.
  fit(model) {
    const box = new THREE.Box3(), inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), b = new THREE.Box3();
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.material.isMeshBasicMaterial || o.material.transparent) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(b.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
    });
    if (!box.isEmpty()) this.size = [box.max.x - box.min.x, box.max.z - box.min.z];
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
    m.scale.set((this.size[0] + PAD[1]) * grow, 1, (this.size[1] + PAD[0]) * grow);
    m.position.set(x, y + 0.03, z);
    m.material.opacity = OPACITY * k;
  }
}
