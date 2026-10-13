// Пешеходные мосты из OSM (footway/pedestrian + bridge): бетонная плита с бортом,
// ажурные чугунные перила, белые колонны (не на проезжей части), фонари.
import * as THREE from 'three';
import { World } from './world.js';

const CLEARANCE = 5.5;   // м над дорогой под мостом
const SLAB = 1.1;        // толщина плиты с бортом
const RAIL_H = 1.1;

// Высота проезжей части под точкой (или -Infinity, если дороги нет).
function roadBelow(world, x, z, pad = 1) {
  let y = -Infinity;
  for (const s of world.nearbyRoadSegments(x, z)) {
    const c = World.closest(s, x, z);
    if (c.d > s.w / 2 + pad) continue;
    const ry = s.ya !== undefined ? s.ya + (s.yb - s.ya) * c.t : world.terrain(x, z) + s.road.lift;
    y = Math.max(y, ry);
  }
  return y;
}

function pointIn(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) ins = !ins;
  }
  return ins;
}

// Контур настила: площадь — как есть; дорожка — лента шириной w (вперёд по левому краю, назад по правому).
function outline(fb) {
  if (fb.a) return { poly: fb.p, sides: fb.p.map(() => true), center: fb.p };
  const pts = fb.p, n = pts.length, hw = fb.w / 2;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    left.push([pts[i][0] + nx * hw, pts[i][1] + nz * hw]);
    right.push([pts[i][0] - nx * hw, pts[i][1] - nz * hw]);
  }
  const poly = [...left, ...right.reverse()];
  // Перила вдоль длинных сторон; на торцах — проход на лестницу.
  const sides = poly.map((_, i) => i !== n - 1 && i !== poly.length - 1);
  return { poly, sides, center: pts };
}

function samples(o, fb) {
  const out = [...o.poly];
  if (fb.a) {
    const xs = o.poly.map((p) => p[0]), zs = o.poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 2) {
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 2) if (pointIn(x, z, o.poly)) out.push([x, z]);
    }
  } else {
    for (let i = 1; i < fb.p.length; i++) {
      const [ax, az] = fb.p[i - 1], [bx, bz] = fb.p[i];
      const k = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
      for (let j = 0; j <= k; j++) out.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]);
    }
  }
  return out;
}

// Ажур перил: рамка, круг и ромб — на канвасе с прозрачностью.
function railTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.strokeRect(2, 2, 60, 60);
  g.lineWidth = 3;
  g.beginPath(); g.arc(32, 32, 16, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32); g.closePath(); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildFootbridges(world) {
  const list = world.city.footbridges || [];
  const group = new THREE.Group();
  if (!list.length) return group;

  // Высота настила: над дорогой — с просветом, иначе — по рельефу. Касающиеся друг друга
  // мосты (площадь-мост и дорожки по ней) — на одной высоте.
  const items = list.map((fb) => {
    const o = outline(fb);
    const smp = samples(o, fb);
    let ground = -Infinity, road = -Infinity;
    for (const [x, z] of smp) {
      ground = Math.max(ground, world.terrain(x, z));
      road = Math.max(road, roadBelow(world, x, z));
    }
    return { fb, o, smp, overRoad: road > -Infinity, flat: Math.max(ground + 0.4, road + CLEARANCE), group: null };
  });
  for (const a of items) {
    for (const b of items) {
      if (a === b || a.group === b.group && a.group) continue;
      const near = a.smp.some(([x, z]) => b.fb.a ? pointIn(x, z, b.o.poly) : b.smp.some(([u, v]) => Math.hypot(u - x, v - z) < 3));
      if (!near) continue;
      const g = a.group || b.group || { flat: -Infinity, items: [] };
      for (const it of [a, b]) if (it.group !== g) { it.group = g; g.items.push(it); }
    }
  }
  for (const it of items) {
    if (it.group) it.flat = Math.max(...it.group.items.map((q) => q.flat));
  }
  // Дорожка-мост через овраг/воду без дорог: настил по прямой между берегами.
  const topAt = (it, x, z) => {
    // Дорожка поверх моста-площади — чуть ниже её настила, чтобы поверхности не мерцали.
    if (it.group && !it.fb.a && it.group.items.some((q) => q.fb.a)) return it.flat - 0.05;
    if (it.group || it.overRoad || it.fb.a) return it.flat;
    const p = it.fb.p, [ax, az] = p[0], [bx, bz] = p[p.length - 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
    const y = world.terrain(ax, az) + (world.terrain(bx, bz) - world.terrain(ax, az)) * t + 0.4;
    return Math.max(y, world.terrain(x, z) + 0.4);
  };

  const concrete = new THREE.MeshLambertMaterial({ color: '#d8d4cc', side: THREE.DoubleSide });
  const columnMat = new THREE.MeshLambertMaterial({ color: '#eceae4' });
  const iron = new THREE.MeshLambertMaterial({ color: '#202326', map: railTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  const dark = new THREE.MeshLambertMaterial({ color: '#202326' });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff8e6' });

  const sp = [], rp = [], ruv = [];
  const columns = [], lamps = [];
  for (const it of items) {
    const { poly, sides } = it.o;
    let pts = poly, sd = sides;
    let area = 0;
    for (let i = 0; i < pts.length; i++) area += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    if (area < 0) { pts = [...pts].reverse(); sd = [...sd.slice(0, -1).reverse(), sd[sd.length - 1]]; }
    const ys = pts.map(([x, z]) => topAt(it, x, z));

    // Плита: верх, низ, борта.
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [a, b, c] of tris) {
      for (const i of [a, c, b]) sp.push(pts[i][0], ys[i], pts[i][1]);
      for (const i of [a, b, c]) sp.push(pts[i][0], ys[i] - SLAB, pts[i][1]);
    }
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const [x1, z1] = pts[i], [x2, z2] = pts[j];
      sp.push(x1, ys[i], z1, x2, ys[j] - SLAB, z2, x1, ys[i] - SLAB, z1);
      sp.push(x1, ys[i], z1, x2, ys[j], z2, x2, ys[j] - SLAB, z2);

      const len = Math.hypot(x2 - x1, z2 - z1);
      if (!sd[i] || len < 0.3) continue;
      // Перила: ажурная лента, текстура повторяется каждые 1.2 м.
      const u = len / 1.2;
      rp.push(x1, ys[i], z1, x2, ys[j], z2, x2, ys[j] + RAIL_H, z2, x1, ys[i], z1, x2, ys[j] + RAIL_H, z2, x1, ys[i] + RAIL_H, z1);
      ruv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1);

      // Колонны вдоль края, с отступом внутрь; не на проезжей части и не там, где настил у земли.
      const ix = -(z2 - z1) / len, iz = (x2 - x1) / len; // внутрь для CCW
      for (let d = 2; d < len - 1; d += 4.5) {
        const x = x1 + ((x2 - x1) * d) / len + ix * 1.0, z = z1 + ((z2 - z1) * d) / len + iz * 1.0;
        const top = ys[i] + ((ys[j] - ys[i]) * d) / len - SLAB, g = world.terrain(x, z);
        if (top - g < 2.2 || roadBelow(world, x, z, 1.2) > -Infinity) continue;
        columns.push([x, z, g, top]);
      }
      for (let d = 6; it.fb.a && d < len - 3; d += 18) {
        lamps.push([x1 + ((x2 - x1) * d) / len + ix * 0.4, z1 + ((z2 - z1) * d) / len + iz * 0.4, ys[i] + ((ys[j] - ys[i]) * d) / len]);
      }
    }
  }

  const slab = new THREE.BufferGeometry();
  slab.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  slab.computeVertexNormals();
  const slabMesh = new THREE.Mesh(slab, concrete);
  slabMesh.castShadow = slabMesh.receiveShadow = true;
  const rail = new THREE.BufferGeometry();
  rail.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rail.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  rail.computeVertexNormals();
  const railMesh = new THREE.Mesh(rail, iron);
  railMesh.castShadow = true;
  group.add(slabMesh, railMesh);

  const m = new THREE.Matrix4();
  if (columns.length) {
    const colGeo = new THREE.BoxGeometry(0.6, 1, 0.6).translate(0, 0.5, 0);
    const cols = new THREE.InstancedMesh(colGeo, columnMat, columns.length);
    columns.forEach(([x, z, g, top], i) => {
      cols.setMatrixAt(i, m.makeScale(1, top - g + 0.3, 1).setPosition(x, g - 0.3, z));
      world.addCollider([[x - 0.35, z - 0.35], [x + 0.35, z - 0.35], [x + 0.35, z + 0.35], [x - 0.35, z + 0.35]]);
    });
    cols.castShadow = cols.receiveShadow = true;
    group.add(cols);
  }
  if (lamps.length) {
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 6).translate(0, 2, 0), dark, lamps.length);
    const ball = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8).translate(0, 4.15, 0), lampMat, lamps.length);
    lamps.forEach(([x, z, y], i) => {
      m.makeTranslation(x, y, z);
      pole.setMatrixAt(i, m);
      ball.setMatrixAt(i, m);
    });
    group.add(pole, ball);
  }
  return group;
}
