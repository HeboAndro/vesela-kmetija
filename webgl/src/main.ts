import './style.css';
import * as THREE from 'three';

/** World matches mapa.png 1920×1280 (20 px per unit → 96×64). */
const MAP_W = 96;
const MAP_H = 64;
const HALF_W = MAP_W / 2;
const HALF_H = MAP_H / 2;

type ImplId = 'plug' | 'balirka' | 'prikolica' | 'vitla';

const IMPL_LABELS: Record<ImplId, string> = {
  plug: 'Plug',
  balirka: 'Balirka',
  prikolica: 'Prikolica',
  vitla: 'Vitla',
};

const canvas = document.getElementById('c') as HTMLCanvasElement;
const joyBase = document.getElementById('joy-base') as HTMLElement;
const joyKnob = document.getElementById('joy-knob') as HTMLElement;
const implLabel = document.getElementById('impl-label') as HTMLElement;
const implBar = document.getElementById('impl-bar') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 55, 120);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 250);
camera.position.set(0, 18, 22);

const hemi = new THREE.HemisphereLight(0xe8f5e9, 0x5d4037, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e0, 1.1);
sun.position.set(18, 28, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 90;
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun);

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeGround(texture: THREE.Texture): THREE.Mesh {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTractor(): THREE.Group {
  const g = new THREE.Group();
  const green = 0x3f8f3a;
  const dark = 0x2a6628;
  const cabin = 0x263238;
  const rubber = 0x212121;
  const rim = 0x90a4ae;

  g.add(box(1.45, 0.55, 2.5, green, 0, 0.58, 0.05));
  g.add(box(1.4, 0.32, 1.15, dark, 0, 0.98, 0.55));
  g.add(box(1.2, 0.9, 1.05, cabin, 0, 1.28, -0.5));
  g.add(box(1.05, 0.12, 0.95, 0xf5f5f5, 0, 1.78, -0.5));
  g.add(box(1.0, 0.5, 0.85, 0xb0bec5, 0, 1.48, -0.5));
  g.add(box(0.12, 0.75, 0.12, 0x455a64, -0.48, 1.4, 0.15));

  const wheel = (x: number, z: number, r: number, w: number) => {
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, w, 14),
      new THREE.MeshLambertMaterial({ color: rubber }),
    );
    tire.rotation.z = Math.PI / 2;
    tire.position.set(x, r, z);
    tire.castShadow = true;
    g.add(tire);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.4, r * 0.4, w + 0.02, 8),
      new THREE.MeshLambertMaterial({ color: rim }),
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, r, z);
    g.add(hub);
  };
  wheel(-0.88, 0.78, 0.38, 0.28);
  wheel(0.88, 0.78, 0.38, 0.28);
  wheel(-0.92, -0.88, 0.55, 0.36);
  wheel(0.92, -0.88, 0.55, 0.36);

  // Hitch beam + pin (local −Z = behind)
  g.add(box(0.14, 0.1, 0.55, 0x546e7a, 0, 0.38, -1.45));
  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 10),
    new THREE.MeshLambertMaterial({ color: 0xb0bec5 }),
  );
  pin.position.set(0, 0.38, -1.78);
  pin.name = 'hitchPin';
  g.add(pin);
  return g;
}

function makeImplement(id: ImplId): THREE.Group {
  const g = new THREE.Group();
  // Hitch eye at local origin; body trails in −Z
  g.add(box(0.12, 0.08, 0.55, 0x607d8b, 0, 0.05, -0.2));
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.03, 8, 12),
    new THREE.MeshLambertMaterial({ color: 0xb0bec5 }),
  );
  ring.rotation.y = Math.PI / 2;
  ring.position.set(0, 0.05, 0.05);
  g.add(ring);

  if (id === 'plug') {
    g.add(box(1.35, 0.28, 0.55, 0xc62828, 0, 0.35, -0.85));
    g.add(box(1.2, 0.08, 0.45, 0xfdd835, 0, 0.52, -0.85));
    for (const x of [-0.45, -0.15, 0.15, 0.45]) {
      const blade = box(0.12, 0.45, 0.35, 0x90a4ae, x, 0.15, -1.2);
      blade.rotation.x = 0.35;
      g.add(blade);
    }
  } else if (id === 'balirka') {
    g.add(box(1.1, 0.35, 0.7, 0x2e7d32, 0, 0.45, -0.7));
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.0, 16),
      new THREE.MeshLambertMaterial({ color: 0x1b5e20 }),
    );
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 0.7, -1.35);
    drum.castShadow = true;
    g.add(drum);
    g.add(box(1.15, 0.55, 0.2, 0xf9a825, -0.55, 0.7, -1.35));
    g.add(box(1.15, 0.55, 0.2, 0xf9a825, 0.55, 0.7, -1.35));
    const w = (x: number) => {
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.18, 10),
        new THREE.MeshLambertMaterial({ color: 0x212121 }),
      );
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, 0.28, -1.1);
      g.add(tire);
    };
    w(-0.65);
    w(0.65);
  } else if (id === 'prikolica') {
    g.add(box(1.5, 0.7, 2.0, 0x5d4037, 0, 0.65, -1.4));
    g.add(box(1.45, 0.12, 1.9, 0x795548, 0, 1.05, -1.4));
    for (const x of [-0.55, 0.55]) {
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10),
        new THREE.MeshLambertMaterial({ color: 0x212121 }),
      );
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, 0.32, -1.5);
      g.add(tire);
    }
  } else if (id === 'vitla') {
    // Forestry winch + chainsaw (žaga) on top
    g.add(box(0.95, 0.55, 0.85, 0x455a64, 0, 0.5, -0.85));
    g.add(box(0.75, 0.35, 0.55, 0x78909c, 0, 0.7, -0.85));
    g.add(box(0.85, 0.1, 0.7, 0x2e7d32, 0, 0.9, -0.85));
    g.add(box(0.35, 0.28, 0.45, 0xef6c00, 0, 1.12, -0.85));
    g.add(box(0.12, 0.08, 0.55, 0x37474f, 0, 1.28, -1.05));
    for (const x of [-0.4, 0.4]) {
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10),
        new THREE.MeshLambertMaterial({ color: 0x212121 }),
      );
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, 0.22, -0.75);
      g.add(tire);
    }
  }
  return g;
}

const tractor = makeTractor();
tractor.position.set(0, 0, 8);
scene.add(tractor);

const hitchRoot = new THREE.Group();
tractor.add(hitchRoot);
hitchRoot.position.set(0, 0.28, -1.78);

let currentImpl: ImplId = 'plug';
let implMesh = makeImplement(currentImpl);
hitchRoot.add(implMesh);

function setImplement(id: ImplId) {
  currentImpl = id;
  hitchRoot.remove(implMesh);
  implMesh.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  implMesh = makeImplement(id);
  hitchRoot.add(implMesh);
  implLabel.textContent = IMPL_LABELS[id];
  implBar.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-id') === id);
  });
}

implBar.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button');
  if (!t) return;
  const id = t.getAttribute('data-id') as ImplId | null;
  if (id && id in IMPL_LABELS) setImplement(id);
});

const keys: Record<string, boolean> = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Digit1') setImplement('plug');
  if (e.code === 'Digit2') setImplement('balirka');
  if (e.code === 'Digit3') setImplement('prikolica');
  if (e.code === 'Digit4') setImplement('vitla');
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

const joy = { x: 0, y: 0, active: false };
const joyMax = 42;
function setKnob(x: number, y: number) {
  joyKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}
function joyFromEvent(clientX: number, clientY: number) {
  const rect = joyBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const len = Math.hypot(dx, dy) || 1;
  if (len > joyMax) {
    dx = (dx / len) * joyMax;
    dy = (dy / len) * joyMax;
  }
  joy.x = dx / joyMax;
  joy.y = dy / joyMax;
  setKnob(dx, dy);
}
joyBase.addEventListener('pointerdown', (e) => {
  joy.active = true;
  joyBase.setPointerCapture(e.pointerId);
  joyFromEvent(e.clientX, e.clientY);
});
joyBase.addEventListener('pointermove', (e) => {
  if (!joy.active) return;
  joyFromEvent(e.clientX, e.clientY);
});
const endJoy = () => {
  joy.active = false;
  joy.x = 0;
  joy.y = 0;
  setKnob(0, 0);
};
joyBase.addEventListener('pointerup', endJoy);
joyBase.addEventListener('pointercancel', endJoy);

let heading = 0;
const speed = 9;
const turnSpeed = 2.1;
const camLook = new THREE.Vector3();
const camDesired = new THREE.Vector3();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
const loader = new THREE.TextureLoader();

loader.load(
  './mapa.png',
  (tex: THREE.Texture) => {
    scene.add(makeGround(tex));
  },
  undefined,
  () => {
    // Fallback green if texture missing
    const fallback = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W, MAP_H),
      new THREE.MeshLambertMaterial({ color: 0x4caf50 }),
    );
    fallback.rotation.x = -Math.PI / 2;
    fallback.receiveShadow = true;
    scene.add(fallback);
  },
);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  let forward = 0;
  let turn = 0;
  if (keys['KeyW'] || keys['ArrowUp']) forward += 1;
  if (keys['KeyS'] || keys['ArrowDown']) forward -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) turn += 1;
  if (keys['KeyD'] || keys['ArrowRight']) turn -= 1;
  if (joy.active) {
    forward += -joy.y;
    turn += -joy.x;
  }
  forward = THREE.MathUtils.clamp(forward, -1, 1);
  turn = THREE.MathUtils.clamp(turn, -1, 1);

  if (Math.abs(forward) > 0.04 || Math.abs(turn) > 0.04) {
    heading += turn * turnSpeed * dt * (forward >= 0 ? 1 : -1);
    const vx = Math.sin(heading) * forward * speed * dt;
    const vz = Math.cos(heading) * forward * speed * dt;
    tractor.position.x = THREE.MathUtils.clamp(tractor.position.x + vx, -HALF_W + 2, HALF_W - 2);
    tractor.position.z = THREE.MathUtils.clamp(tractor.position.z + vz, -HALF_H + 2, HALF_H - 2);
  }
  tractor.rotation.y = heading;

  // Slightly elevated chase camera (behind tractor)
  const height = 7.5;
  camDesired.set(
    tractor.position.x - Math.sin(heading) * 10,
    height,
    tractor.position.z - Math.cos(heading) * 10,
  );
  camera.position.lerp(camDesired, 0.06);
  camLook.set(tractor.position.x, 1.2, tractor.position.z);
  camera.lookAt(camLook);

  renderer.render(scene, camera);
}

animate();
