// Эффекты чужих машин (net.js): пламя нитро, струи трюков, дым шин — те же классы, что у своей машины, но
// вместо Car — заменитель, собранный из того, что пришло по сети: положение, скорость по отрезку между точками,
// флаги (газ, нитро, ручник, грунт, трюк). Оборот трюка не передаётся — струи крутят по той же пружине, что
// в car.js, от момента взлёта. Звук мотора и трюков — Sound.players (audio.js).
import * as THREE from 'three';
import { NitroFX, JetFX, TireSmokeFX } from './effects.js';
import { AIR_KINDS } from './net.js';

const FX_DIST = 250; // м: дальше эффекты не рождаются (оставшиеся клубы догорают)
// Оборот трюка — как в car.js: FLIP_K, FLIP_C, FLIP_ACC, FLIP_SPIN; полёт с земли — 2 · FLIP_VY / FLIP_G.
const FLIP_K = 100, FLIP_C = 11, FLIP_ACC = 30, FLIP_SPIN = 0.5, FLIP_DUR = 2 * 12.3 / 15;

export class GhostFX {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = new Map(); // uid → { mesh, car, nitro, jet, smoke }
  }

  update(dt, net, me) {
    for (const [uid, e] of this.list) if (!net.ghosts.has(uid)) this.#drop(uid, e);
    for (const [uid, g] of net.ghosts) {
      const m = g.mesh;
      const near = !!m?.visible && Math.hypot(m.position.x - me.pos.x, m.position.z - me.pos.y) < FX_DIST;
      let e = this.list.get(uid);
      if (!e) {
        if (!near) continue;
        this.list.set(uid, (e = {
          mesh: null, car: ghostCar(),
          nitro: new NitroFX(this.scene, { lines: false }), jet: new JetFX(this.scene), smoke: new TireSmokeFX(this.scene),
        }));
        for (const fx of [e.nitro, e.jet, e.smoke]) fx.points.userData.perf = 'другие игроки'; // для ?perf
      }
      if (e.mesh !== m && m) { // сменил машину в гараже — сопла и пламя на новую модель
        e.mesh = m;
        e.car.model = m;
        e.nitro.attach(m);
        e.jet.attach(m);
      }
      this.#step(e.car, g, near, dt);
      e.nitro.update(dt, e.car);
      e.jet.update(dt, e.car);
      e.smoke.update(dt, e.car);
    }
  }

  // Заменитель Car для эффектов по данным игрока g.
  #step(c, g, near, dt) {
    const m = g.mesh, fx = near ? g.fx ?? 0 : 0;
    const vy = dt > 0 && c.ready ? (m.position.y - c.y) / dt : 0;
    c.ready = true;
    c.pos.set(m.position.x, m.position.z);
    c.y = m.position.y;
    c.heading = m.rotation.y;
    c.vel.set(g.vx ?? 0, g.vz ?? 0);
    c.speed = g.speed ?? 0;
    c.nitroOn = !!(fx & 2);
    c.handbrake = !!(fx & 4);
    c.offroad = fx & 8 ? 1 : 0;
    c.surface = fx & 8 ? 'ground' : 'road';
    const kind = AIR_KINDS[(fx >> 4) & 7] || null;
    if (kind && !c.air) c.air = { kind, t: 0, vy: 0, dir: fx & 128 ? -1 : 1, a: 0, w: 0, acc: 0 };
    else if (!kind && c.air) {
      if (c.air.kind !== 'fall') c.landings++; // посадка — пар из-под днища
      c.air = null;
    }
    const air = c.air;
    if (air) {
      air.t += dt;
      air.vy += (vy - air.vy) * Math.min(1, dt * 10);
      const u = Math.min(1, air.t / (FLIP_DUR * FLIP_SPIN));
      const want = air.kind === 'ramp' || air.kind === 'fall' ? 0 : Math.PI * (1 - Math.cos(Math.PI * u));
      const acc = FLIP_K * (want - air.a) - FLIP_C * air.w;
      air.w += acc * dt;
      air.a += air.w * dt;
      air.acc = acc / FLIP_ACC;
    }
    c.alt = air ? Math.max(0, c.y - this.world.ground(c.pos.x, c.pos.y)) : 0;
  }

  #drop(uid, e) {
    for (const fx of [e.nitro, e.jet, e.smoke]) {
      this.scene.remove(fx.points);
      fx.points.geometry.dispose();
    }
    this.list.delete(uid);
  }
}

function ghostCar() {
  return {
    model: null, ready: false, pos: new THREE.Vector2(), vel: new THREE.Vector2(), y: 0, heading: 0, speed: 0,
    nitroOn: false, handbrake: false, offroad: 0, surface: 'road', air: null, alt: 0, airSteer: 0, landings: 0,
    onTop: null, sink: 0,
    get forward() { return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)); },
    get right() { return new THREE.Vector2(-Math.cos(this.heading), Math.sin(this.heading)); },
  };
}
