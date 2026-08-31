import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildMesh } from "../core/export/mesh.js";

const hud = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(48, 40, 48);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x2a2d33, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 80, 30);
scene.add(sun);

const gridHelper = new THREE.GridHelper(128, 16, 0x3a3f47, 0x262a30);
scene.add(gridHelper);

let mesh: THREE.Mesh | null = null;

function rebuild(project: { size: number[]; palette: Record<string, string>; voxels: Record<string, number> }): void {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh = null;
  }
  const entries = Object.entries(project.voxels).map(([k, idx]) => {
    const [x, y, z] = k.split(",").map(Number);
    return [x, y, z, idx] as [number, number, number, number];
  });
  const hexAt = (idx: number) => project.palette[String(idx)] ?? "#ff00ff";
  const m = buildMesh(entries, hexAt);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);
  hud.textContent = `体素 ${entries.length} · 网格 ${project.size.join("x")} · ${new Date().toLocaleTimeString()}`;
}

fetch("/model").then((r) => r.json()).then((p) => { if (p && p.size) rebuild(p); });
new EventSource("/events").addEventListener("model", (e) => {
  const p = JSON.parse((e as MessageEvent).data);
  if (p && p.size) rebuild(p);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
