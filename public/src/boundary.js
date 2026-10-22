// Забор по краю карты, как в NFS: полупрозрачная светящаяся стенка с косыми полосами по прямоугольнику world.edge
// (EDGE_INSET м внутрь от bounds). Проявляется, только когда подъезжаешь, издалека её не видно. Держит машину
// World.collide, здесь — только вид.
import * as THREE from 'three';

const H = 6;          // м: высота над рельефом
const SINK = 1.5;     // м: низ под рельефом — на склоне не видно щели
const STEP = 10;      // м: шаг точек по рельефу
const PIECE = 400;    // м: кусок — отдельный меш, чтобы отсекался по видимости и расстоянию
const NEAR = 40, FAR = 160; // м: ближе NEAR — во всю силу, дальше FAR — не видно

const vert = `
  attribute float s;
  varying float vS, vV;
  varying vec3 vPos;
  void main() {
    vS = s; vV = uv.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPos = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const frag = `
  uniform vec3 uCar;
  uniform float uTime;
  varying float vS, vV;
  varying vec3 vPos;
  void main() {
    float d = distance(vPos.xz, uCar.xz);
    float fade = 1.0 - smoothstep(${NEAR.toFixed(1)}, ${FAR.toFixed(1)}, d);
    if (fade <= 0.0) discard;
    float y = vV * ${(H + SINK).toFixed(1)};
    float band = fract((vS + y) / 3.0 - uTime * 0.25);
    float stripe = smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.42, 0.5, band));
    // Светлые кромки: поверху и у земли (y = SINK — уровень рельефа).
    float rim = smoothstep(${(H + SINK - 0.35).toFixed(2)}, ${(H + SINK).toFixed(2)}, y)
      + smoothstep(${(SINK + 0.35).toFixed(2)}, ${SINK.toFixed(2)}, y) * smoothstep(${(SINK - 0.6).toFixed(2)}, ${(SINK - 0.3).toFixed(2)}, y);
    float top = 1.0 - 0.5 * smoothstep(${(SINK + 1).toFixed(1)}, ${(H + SINK).toFixed(1)}, y);
    vec3 col = mix(vec3(0.25, 0.7, 1.0), vec3(0.85, 0.97, 1.0), stripe * 0.6 + rim);
    float a = (0.16 + 0.28 * stripe) * top + 0.55 * rim;
    gl_FragColor = vec4(col, a * fade);
  }`;

export class Boundary {
  constructor(world, scene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { uCar: { value: new THREE.Vector3() }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.group = new THREE.Group();
    this.pieces = [];
    const [x0, z0, x1, z1] = world.edge;
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c], [bx, bz] = corners[c + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / PIECE);
      for (let k = 0; k < n; k++) this.#piece(world, ax, az, bx, bz, L, (k * L) / n, ((k + 1) * L) / n);
    }
    scene.add(this.group);
  }

  // Кусок стены от t0 до t1 м вдоль стороны A→B.
  #piece(world, ax, az, bx, bz, L, t0, t1) {
    const pos = [], uv = [], s = [], idx = [];
    const m = Math.max(1, Math.ceil((t1 - t0) / STEP));
    for (let i = 0; i <= m; i++) {
      const t = t0 + ((t1 - t0) * i) / m, x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L;
      const y = world.terrain(x, z);
      pos.push(x, y - SINK, z, x, y + H, z);
      uv.push(0, 0, 0, 1);
      s.push(t, t);
      if (i) { const v = 2 * i; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('s', new THREE.Float32BufferAttribute(s, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.renderOrder = 2; // прозрачное — после домов и дорог
    mesh.visible = false;
    this.group.add(mesh);
    const t = (q) => [ax + ((bx - ax) * q) / L, az + ((bz - az) * q) / L];
    this.pieces.push({ mesh, a: t(t0), b: t(t1) });
  }

  update(t, x, y, z) {
    this.mat.uniforms.uCar.value.set(x, y, z);
    this.mat.uniforms.uTime.value = t;
    for (const p of this.pieces) {
      const [ax, az] = p.a, [bx, bz] = p.b;
      const dx = bx - ax, dz = bz - az;
      const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      p.mesh.visible = Math.hypot(ax + dx * k - x, az + dz * k - z) < FAR;
    }
  }
}
