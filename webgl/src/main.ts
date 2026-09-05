import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const joyBase = document.getElementById('joy-base') as HTMLElement;
const joyKnob = document.getElementById('joy-knob') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 40, 90);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(8, 6, 10);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 4;
controls.maxDistance = 28;
controls.target.set(0, 0.8, 0);

const hemi = new THREE.HemisphereLight(0xe8f5e9, 0x5d4037, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e0, 1.05);
sun.position.set(12, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshLambertMaterial({ color: 0x4caf50 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const patch = new THREE.Mesh(
  new THREE.CircleGeometry(1.6, 24),
  new THREE.MeshLambertMaterial({ color: 0x388e3c }),
);
patch.rotation.x = -Math.PI / 2;
patch.position.y = 0.01;
scene.add(patch);

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeTractor(): THREE.Group {
  const g = new THREE.Group();
  const green = 0x3f8f3a;
  const dark = 0x2a6628;
  const cabin = 0x263238;
  const rubber = 0x212121;
  const rim = 0x90a4ae;
  g.add(box(1.4, 0.55, 2.4, green, 0, 0.55, 0.1));
  g.add(box(1.35, 0.35, 1.1, dark, 0, 0.95, 0.55));
  g.add(box(1.15, 0.85, 1.0, cabin, 0, 1.25, -0.55));
  g.add(box(1.0, 0.45, 0.85, 0xb0bec5, 0, 1.45, -0.55));
  g.add(box(0.12, 0.7, 0.12, 0x455a64, -0.45, 1.35, 0.2));
  const wheel = (x: number, z: number, r: number, w: number) => {
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, w, 12),
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
  wheel(-0.85, 0.75, 0.38, 0.28);
  wheel(0.85, 0.75, 0.38, 0.28);
  wheel(-0.9, -0.85, 0.55, 0.35);
  wheel(0.9, -0.85, 0.55, 0.35);
  g.add(box(0.12, 0.1, 0.7, 0x546e7a, 0, 0.35, -1.55));
  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 10, 10),
    new THREE.MeshLambertMaterial({ color: 0xb0bec5 }),
  );
  pin.position.set(0, 0.35, -1.9);
  g.add(pin);
  g.add(box(1.0, 0.7, 0.9, 0xef6c00, 0, 0.55, -2.55));
  g.add(box(0.9, 0.15, 0.8, 0x37474f, 0, 0.95, -2.55));
  return g;
}

const tractor = makeTractor();
scene.add(tractor);

const keys: Record<string, boolean> = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

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
  if (len > joyMax) { dx = (dx / len) * joyMax; dy = (dy / len) * joyMax; }
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
const endJoy = () => { joy.active = false; joy.x = 0; joy.y = 0; setKnob(0, 0); };
joyBase.addEventListener('pointerup', endJoy);
joyBase.addEventListener('pointercancel', endJoy);

let heading = 0;
const speed = 6;
const turnSpeed = 2.2;
const camOffset = new THREE.Vector3(6, 5, 8);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  let forward = 0;
  let turn = 0;
  if (keys['KeyW'] || keys['ArrowUp']) forward += 1;
  if (keys['KeyS'] || keys['ArrowDown']) forward -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) turn += 1;
  if (keys['KeyD'] || keys['ArrowRight']) turn -= 1;
  if (joy.active) { forward += -joy.y; turn += -joy.x; }
  forward = THREE.MathUtils.clamp(forward, -1, 1);
  turn = THREE.MathUtils.clamp(turn, -1, 1);
  if (Math.abs(forward) > 0.05 || Math.abs(turn) > 0.05) {
    heading += turn * turnSpeed * dt * (forward >= 0 ? 1 : -1);
    const vx = Math.sin(heading) * forward * speed * dt;
    const vz = Math.cos(heading) * forward * speed * dt;
    tractor.position.x += vx;
    tractor.position.z += vz;
    tractor.position.x = THREE.MathUtils.clamp(tractor.position.x, -35, 35);
    tractor.position.z = THREE.MathUtils.clamp(tractor.position.z, -35, 35);
  }
  tractor.rotation.y = heading;
  patch.position.x = tractor.position.x;
  patch.position.z = tractor.position.z;
  controls.target.lerp(new THREE.Vector3(tractor.position.x, 0.9, tractor.position.z), 0.12);
  const desired = new THREE.Vector3(
    tractor.position.x + Math.sin(heading + Math.PI) * camOffset.x * 0.35 + 4,
    camOffset.y,
    tractor.position.z + Math.cos(heading + Math.PI) * camOffset.z * 0.35 + 5,
  );
  if (!(keys['ShiftLeft'] || keys['ShiftRight'])) {
    camera.position.lerp(desired, 0.04);
  }
  controls.update();
  renderer.render(scene, camera);
}

animate();

