// Контактная сеть троллейбусов: над правой полосой каждого направления маршрута (рёбра трафика с e.troll) — пара
// проводов на высоте TROLL_H (до них тянутся штанги троллейбуса, traffic.js), у края дороги через POLE_GAP м — опоры
// с растяжкой к проводам; опора не встаёт на полотно улицы (у перекрёстка — поперечной) и на рельсы, сбивается как
// фонарный столб (breakables.addTrolleyPoles). Ячейки по CELL м: в каждой одни линии и один InstancedMesh опор, дальние прячет cull —
// общий меш на город рисовался бы целиком каждый кадр.
import * as THREE from 'three';
import { TROLL_H } from './traffic.js';
import { World } from './world.js';

const CELL = 600, POLE_GAP = 35, POLE_H = 7.6, PAIR = 0.3; // м; PAIR — полрасстояния между проводами

export class TrolleyWires {
  constructor(world, traffic, scene) {
    this.cells = [];
    this.poles = []; // InstancedMesh опор с userData.spots — для breakables
    const edges = traffic.edges.filter((e) => e.troll);
    if (!edges.length) return;
    const by = new Map(), cellOf = (x, z) => {
      const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
      if (!by.has(k)) by.set(k, { lines: [], poles: [], x: (Math.floor(x / CELL) + 0.5) * CELL, z: (Math.floor(z / CELL) + 0.5) * CELL });
      return by.get(k);
    };
    const grid = new Map(); // опоры по клеткам POLE_GAP: { x, z, dx, dz }
    // Не на проезжей части (своей и поперечной) и не на рельсах.
    const free = (x, z) => ![...world.nearbyRoadSegments(x, z)].some((sg) => World.closest(sg, x, z).d < sg.w / 2 + 0.6)
      && !world.railsNear(x, z).some((sg) => World.closest(sg, x, z).d < 2.5);
    const y = (e, x, z) => (world.roadY(e.road, x, z) ?? world.terrain(x, z)) + TROLL_H;
    for (const e of edges) {
      const off = e.laneOff(0), nx = -e.dz, nz = e.dx; // вправо от направления
      const n = Math.max(1, Math.ceil(e.len / 12)); // по длине — с шагом не больше 12 м, чтобы шли по рельефу
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const s = (e.len * i) / n, x = e.ax + e.dx * s + nx * off, z = e.az + e.dz * s + nz * off;
        pts.push([x, y(e, x, z), z]);
      }
      const c = cellOf(pts[0][0], pts[0][2]);
      for (let i = 1; i < pts.length; i++) {
        for (const k of [-PAIR, PAIR]) {
          const [ax, ay, az] = pts[i - 1], [bx, by_, bz] = pts[i];
          c.lines.push(ax + nx * k, ay, az + nz * k, bx + nx * k, by_, bz + nz * k);
        }
      }
      // Опоры — у правого края полотна через ~POLE_GAP: кандидаты через 5 м, опора ставится, если рядом нет другой
      // опоры этого же направления (рёбра короткие, по одной на ребро было бы часто).
      const edgeOff = e.road.w / 2 + 0.9;
      for (let s = 2; s < e.len; s += 5) {
        const px = e.ax + e.dx * s + nx * edgeOff, pz = e.az + e.dz * s + nz * edgeOff;
        const gk = Math.floor(px / POLE_GAP) * 100003 + Math.floor(pz / POLE_GAP);
        let near = false;
        for (let i = -1; i <= 1 && !near; i++) {
          for (let j = -1; j <= 1 && !near; j++) {
            for (const o of grid.get(gk + i * 100003 + j) || []) {
              if (o.dx * e.dx + o.dz * e.dz > 0.5 && Math.hypot(o.x - px, o.z - pz) < POLE_GAP * 0.85) { near = true; break; }
            }
          }
        }
        if (near || !free(px, pz)) continue;
        (grid.get(gk) || grid.set(gk, []).get(gk)).push({ x: px, z: pz, dx: e.dx, dz: e.dz });
        const g = world.roadY(e.road, px - nx * edgeOff, pz - nz * edgeOff) ?? world.terrain(px, pz);
        const cc = cellOf(px, pz);
        cc.poles.push([px, Math.min(g, world.terrain(px, pz)), pz, g + POLE_H]);
        const wx = px - nx * (edgeOff - off), wz = pz - nz * (edgeOff - off);
        cc.lines.push(px, g + POLE_H - 0.4, pz, wx, g + TROLL_H + 0.15, wz); // растяжка
      }
    }
    const wireMat = new THREE.LineBasicMaterial({ color: '#25282c' });
    const poleMat = new THREE.MeshLambertMaterial({ color: '#7d8389' });
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 1, 6).translate(0, 0.5, 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const c of by.values()) {
      const g = new THREE.Group();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(c.lines, 3));
      g.add(new THREE.LineSegments(geo, wireMat));
      if (c.poles.length) {
        const poles = new THREE.InstancedMesh(poleGeo, poleMat, c.poles.length);
        c.poles.forEach(([x, y0, z, top], i) => poles.setMatrixAt(i, m.compose(p.set(x, y0, z), q, sc.set(1, top - y0, 1))));
        poles.castShadow = true;
        poles.computeBoundingSphere();
        poles.userData.spots = c.poles;
        this.poles.push(poles);
        g.add(poles);
      }
      scene.add(g);
      this.cells.push({ g, x: c.x, z: c.z });
    }
  }

  // Ячейки дальше dist м (по центру, с запасом на полдиагонали) не рисуются.
  cull(x, z, dist) {
    for (const c of this.cells) c.g.visible = Math.hypot(c.x - x, c.z - z) < dist + CELL * 0.71;
  }
}
