// Небо: купол с градиентом (горизонт светлее, зенит синее) и низкополигональные облака,
// которые несёт ветром. Облака живут в квадрате вокруг игрока и переносятся на другую сторону.
import * as THREE from 'three';

export const HORIZON = '#b4cbe0'; // цвет горизонта = цвет тумана
const ZENITH = '#5f93cf';
// Ночью: тёмно-синий зенит, у горизонта — рыжеватая засветка города.
const NIGHT_HORIZON = '#1d2133', NIGHT_ZENITH = '#03060f';
const STARS = 900;
const CLOUDS = 70, AREA = 5200;   // облаков в квадрате AREA × AREA вокруг игрока
const WIND = new THREE.Vector2(3.2, 1.1); // м/с
const CLOUD_OPACITY = 0.45;

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
    this.horizon = new THREE.Color(HORIZON);
    this.colors = [HORIZON, ZENITH, NIGHT_HORIZON, NIGHT_ZENITH].map((c) => new THREE.Color(c));

    // Ночью — звёзды (точки на куполе, выше горизонта, ближе к нему — тусклее) и луна там, откуда свет.
    const sr = rand(777);
    const sp = new Float32Array(STARS * 3), sc = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const y = 0.08 + 0.92 * Math.sqrt(sr()), a = sr() * Math.PI * 2, h = Math.sqrt(1 - y * y);
      sp.set([Math.cos(a) * h * 3300, y * 3300, Math.sin(a) * h * 3300], i * 3);
      const b = (0.35 + 0.65 * sr() ** 3) * Math.min(1, y * 3);
      sc.set([b * (0.85 + 0.15 * sr()), b * 0.92, b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true,
      fog: false, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    dome.add(this.stars);
    const mc = document.createElement('canvas');
    mc.width = mc.height = 128;
    const g = mc.getContext('2d');
    const halo = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    halo.addColorStop(0, 'rgba(220,230,255,0.5)');
    halo.addColorStop(1, 'rgba(220,230,255,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#eef1f7';
    g.beginPath(); g.arc(64, 64, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,160,180,0.35)'; // моря
    for (const [x, y, r] of [[58, 58, 5], [70, 66, 4], [61, 71, 3]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    const moonTex = new THREE.CanvasTexture(mc);
    moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true, opacity: 0, depthWrite: false }));
    this.moon.scale.setScalar(420);
    this.moon.renderOrder = -1;
    this.moon.visible = false;
    dome.add(this.moon);

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
    // Полупрозрачные: без записи глубины клубки просвечивают друг через друга — где их больше,
    // там облако плотнее, края — тоньше.
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#6d7c8c', flatShading: true, fog: false,
      transparent: true, opacity: CLOUD_OPACITY, depthWrite: false });
    this.cloudMat = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, puffs.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  // Ночь 0…1: цвета купола (горизонт — он же цвет тумана, this.horizon), звёзды, луна, тёмные облака.
  // dir — направление на луну (откуда светит directional-свет).
  setNight(s, dir) {
    const [h, z, nh, nz] = this.colors, u = this.dome.material.uniforms;
    u.horizon.value.copy(h).lerp(nh, s);
    u.zenith.value.copy(z).lerp(nz, s);
    this.horizon.copy(u.horizon.value);
    this.stars.visible = this.moon.visible = s > 0.01;
    this.stars.material.opacity = s;
    this.moon.material.opacity = s;
    if (dir) this.moon.position.copy(dir).multiplyScalar(3000);
    this.cloudMat.color.setScalar(1 - 0.85 * s);
    this.cloudMat.emissive.set('#6d7c8c').lerp(this.colors[2], s);
    this.cloudMat.opacity = CLOUD_OPACITY * (1 - 0.4 * s);
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
