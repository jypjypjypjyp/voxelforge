import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparseVoxelGrid } from "../core/grid.js";
import { computeSignedDistance } from "../core/sdf.js";
import { surfaceNets } from "../core/surfaceNets.js";
import { buildMesh, hexToRgb01 } from "../core/export/mesh.js";
import type { VoxelProject } from "../core/types.js";

const hud = document.getElementById("hud")!;
const modeBtn = document.getElementById("modeBtn")! as HTMLButtonElement;
const resWrap = document.getElementById("resWrap")! as HTMLElement;
const resSlider = document.getElementById("resSlider")! as HTMLInputElement;
const resVal = document.getElementById("resVal")! as HTMLElement;

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
scene.add(new THREE.GridHelper(128, 16, 0x3a3f47, 0x262a30));

type Proj = VoxelProject;
let mode: "voxel" | "mesh" = "voxel";
let meshRes = 64;
let current: Proj | null = null;
let obj: THREE.Mesh | null = null;
let pendingResFrame: number | undefined;

function clearObj(): void {
  if (obj) { scene.remove(obj); obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); obj = null; }
}

function buildVoxel(p: Proj): void {
  const entries = Object.entries(p.voxels).map(([k, idx]) => {
    const [x, y, z] = k.split(",").map(Number);
    return [x, y, z, idx] as [number, number, number, number];
  });
  const m = buildMesh(entries, (i) => p.palette[String(i)] ?? "#ff00ff");
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  obj = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(obj);
  hud.textContent = `体素 ${entries.length} · 网格 ${p.size.join("x")} · ${new Date().toLocaleTimeString()}`;
}

function buildSdf(p: Proj): void {
  const grid = SparseVoxelGrid.fromProject(p);
  const sdf = computeSignedDistance(grid, { smooth: 1 });
  const sizeS = grid.size;
  const colorAt = (x: number, y: number, z: number): [number, number, number] => {
    const vx = Math.min(Math.max(Math.round(x - 0.5), 0), sizeS[0] - 1);
    const vy = Math.min(Math.max(Math.round(y - 0.5), 0), sizeS[1] - 1);
    const vz = Math.min(Math.max(Math.round(z - 0.5), 0), sizeS[2] - 1);
    const idx = grid.get(vx, vy, vz);
    return idx === undefined ? [0.55, 0.55, 0.55] : hexToRgb01(p.palette[String(idx)] ?? "#ffffff");
  };
  const m = surfaceNets(sdf, meshRes, colorAt);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  obj = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(obj);
  hud.textContent = `平滑网格 res ${meshRes} · tris ${m.indices.length / 3} · ${new Date().toLocaleTimeString()}`;
}

function rebuild(p: Proj): void {
  clearObj();
  if (mode === "voxel") buildVoxel(p);
  else buildSdf(p);
}

function onProject(p: Proj): void {
  current = p;
  const maxAxis = Math.max(...p.size);
  resSlider.value = String(maxAxis);
  resVal.textContent = String(maxAxis);
  meshRes = maxAxis;
  rebuild(p);
}

modeBtn.addEventListener("click", () => {
  mode = mode === "voxel" ? "mesh" : "voxel";
  modeBtn.textContent = mode === "voxel" ? "体素" : "平滑网格";
  resWrap.style.display = mode === "mesh" ? "flex" : "none";
  if (current) rebuild(current);
});
resSlider.addEventListener("input", () => {
  meshRes = Number(resSlider.value);
  resVal.textContent = String(meshRes);
  if (pendingResFrame !== undefined) return;
  pendingResFrame = requestAnimationFrame(() => {
    pendingResFrame = undefined;
    if (current && mode === "mesh") rebuild(current);
  });
});

fetch("/model").then((r) => r.json()).then((p) => { if (p && p.size) onProject(p); });
new EventSource("/events").addEventListener("model", (e) => {
  const p = JSON.parse((e as MessageEvent).data);
  if (p && p.size) onProject(p);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
