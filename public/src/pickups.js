// Бонусы на трассе гонки: канистры нитро (+половина баллона) вдоль маршрута.
// Места считаются из маршрута — у всех в общей гонке одни и те же; берёт каждый свои (в базу не пишем).
import * as THREE from 'three';

const STEP = 350;      // м по маршруту между канистрами
const GATE_GAP = 60;   // м: у ворот не ставим — там и так тесно
const SIDE = 2.5;      // м вправо от оси улицы — на своей полосе
const TAKE_R = 3.5;    // м: проехал ближе — взял
const RESPAWN = 15;    // с: взятая появляется снова
const RAMP_GAP = 40;   // м: на трамплин и сразу за ним не ставим
export const NITRO_GIVE = 0.5;

export class Pickups {
  constructor(world, scene) {
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.geo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 16).translate(0, 1.2, 0);
    this.mat = new THREE.MeshStandardMaterial({ color: '#2f8bff', emissive: '#1d5cff', emissiveIntensity: 0.8 });
  }

  // Расставить вдоль маршрута race (после race.start / startShared); ramps — м по маршруту, где трамплины.
  set(race, ramps = []) {
    this.clear();
    const gates = race.checkpoints.map((cp) => race.cum[cp.i]);
    for (let d = STEP; d < race.length - GATE_GAP; d += STEP) {
      if (gates.some((g) => Math.abs(g - d) < GATE_GAP) || ramps.some((r) => d > r - RAMP_GAP && d < r + 2 * RAMP_GAP)) continue;
      const { x: px, z: pz, dx, dz } = race.at(d);
      const x = px - dz * SIDE, z = pz + dx * SIDE;
      const mesh = new THREE.Mesh(this.geo, this.mat);
      const y = this.world.terrain(x, z);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      this.items.push({ x, y, z, mesh, gone: 0 });
    }
  }

  clear() {
    this.group.clear();
    this.items = [];
  }

  // Раз в кадр: крутятся и подпрыгивают; проехал рядом — взял. Возвращает, сколько взял.
  update(dt, car) {
    let got = 0;
    const t = performance.now() / 1000;
    for (const it of this.items) {
      if (it.gone > 0) {
        it.gone -= dt;
        it.mesh.visible = it.gone <= 0;
        continue;
      }
      it.mesh.rotation.y = t * 2;
      it.mesh.position.y = it.y + Math.sin(t * 3 + it.x) * 0.2;
      if (car.alt < 3 && Math.hypot(car.pos.x - it.x, car.pos.y - it.z) < TAKE_R) {
        it.gone = RESPAWN;
        it.mesh.visible = false;
        got++;
      }
    }
    return got;
  }
}
