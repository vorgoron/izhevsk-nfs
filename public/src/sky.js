// Небо: купол с градиентом (горизонт светлее, зенит синее) и низкополигональные облака,
// которые несёт ветром. Облака живут в квадрате вокруг игрока и переносятся на другую сторону.
import * as THREE from 'three';

export const HORIZON = '#b4cbe0'; // цвет горизонта = цвет тумана
const ZENITH = '#5f93cf';
const CLOUDS = 70, AREA = 5200;   // облаков в квадрате AREA × AREA вокруг игрока
const WIND = new THREE.Vector2(3.2, 1.1); // м/с

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export class Sky {
  constructor(scene, baseY) {
    // Купол следует за камерой; рисуется первым, без тумана и записи глубины.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3500, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(ZENITH) } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; varying vec3 vDir;
          void main() { float t = smoothstep(-0.02, 0.45, vDir.y); gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    scene.add(dome);
    this.dome = dome;

    // Облака: кучки сплюснутых икосаэдров, плоская заливка, низ чуть темнее за счёт освещения.
    const r = rand(20241013);
    this.clouds = [];
    const puffs = [];
    for (let i = 0; i < CLOUDS; i++) {
      const size = 1.0 + r() * 1.2;
      const cloud = { x: (r() - 0.5) * AREA, z: (r() - 0.5) * AREA, y: baseY + 220 + r() * 120, puffs: [] };
      const n = 7 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, d = r() * 70 * size;
        const s = (30 + r() * 34) * size * (1 - d / (115 * size));
        cloud.puffs.push({ dx: Math.cos(a) * d * 1.4, dz: Math.sin(a) * d, dy: s * 0.25, s, rot: r() * 6 });
        puffs.push(cloud);
      }
      this.clouds.push(cloud);
    }
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#6d7c8c', flatShading: true, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, puffs.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  update(dt, camera, px, pz) {
    this.dome.position.copy(camera.position);
    const half = AREA / 2;
    let i = 0;
    for (const c of this.clouds) {
      c.x += WIND.x * dt;
      c.z += WIND.y * dt;
      // Держим облако в квадрате вокруг игрока: ушло за край — появилось с другой стороны.
      const ox = ((((c.x - px + half) % AREA) + AREA) % AREA) - half;
      const oz = ((((c.z - pz + half) % AREA) + AREA) % AREA) - half;
      c.x = px + ox;
      c.z = pz + oz;
      for (const f of c.puffs) {
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, f.rot);
        this.m.compose(this.p.set(c.x + f.dx, c.y + f.dy, c.z + f.dz), this.q, this.s.set(f.s, f.s * 0.55, f.s));
        this.mesh.setMatrixAt(i++, this.m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
