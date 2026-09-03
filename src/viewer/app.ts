import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparseVoxelGrid } from "../core/grid.js";
import { computeSignedDistance } from "../core/sdf.js";
import { surfaceNets } from "../core/surfaceNets.js";
import { buildMesh } from "../core/export/mesh.js";
import { sampleVoxelColor } from "../core/color.js";
import type { VoxelProject } from "../core/types.js";

const hud = document.getElementById("hud")!;
const modeBtn = document.getElementById("modeBtn")! as HTMLButtonElement;
const exportBtn = document.getElementById("exportBtn")! as HTMLButtonElement;
const resWrap = document.getElementById("resWrap")! as HTMLElement;
const resSlider = document.getElementById("resSlider")! as HTMLInputElement;
const resVal = document.getElementById("resVal")! as HTMLElement;
const smoothWrap = document.getElementById("smoothWrap")! as HTMLElement;
const smoothSlider = document.getElementById("smoothSlider")! as HTMLInputElement;
const smoothVal = document.getElementById("smoothVal")! as HTMLElement;

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
let smoothValue = 1;
let pendingSmoothFrame: number | undefined;

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
  const sdf = computeSignedDistance(grid, { smooth: smoothValue });
  const colorAt = (x: number, y: number, z: number): [number, number, number] =>
    sampleVoxelColor(grid, (idx) => p.palette[String(idx)], x, y, z);
  const m = surfaceNets(sdf, meshRes, colorAt);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  obj = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(obj);
  hud.textContent = `平滑网格 res ${meshRes} · smooth ${smoothValue} · tris ${m.indices.length / 3} · ${new Date().toLocaleTimeString()}`;
}

function rebuild(p: Proj): void {
  clearObj();
  if (mode === "voxel") buildVoxel(p);
  else buildSdf(p);
}

let cameraFitted = false;

// 首次加载按模型 bbox 自动取景（固定相机位会看向空区域/被悬空模型挡住）；SSE 更新保持用户相机
function fitCamera(p: Proj): void {
  let b: [number, number, number, number, number, number] | null = null;
  for (const k of Object.keys(p.voxels)) {
    const [x, y, z] = k.split(",").map(Number);
    if (!b) { b = [x, y, z, x, y, z]; continue; }
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
  }
  if (!b) return;
  const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
  const r = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 + 1;
  const dist = (r / Math.tan((camera.fov / 2) * Math.PI / 180)) * 1.15;
  const dir = new THREE.Vector3(1, 0.75, 1).normalize();
  camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
  controls.target.set(cx, cy, cz);
  controls.update();
}

function onProject(p: Proj): void {
  current = p;
  const maxAxis = Math.max(...p.size);
  resSlider.value = String(maxAxis);
  resVal.textContent = String(maxAxis);
  meshRes = maxAxis;
  smoothSlider.value = "1";
  smoothVal.textContent = "1";
  smoothValue = 1;
  if (!cameraFitted) { fitCamera(p); cameraFitted = true; }
  rebuild(p);
}

exportBtn.addEventListener("click", async () => {
  if (!current || exportBtn.disabled) return;
  exportBtn.disabled = true;
  const prev = hud.textContent;
  hud.textContent = "导出中…";
  try {
    const q = new URLSearchParams({ mode });
    if (mode === "mesh") {
      q.set("res", String(meshRes));
      q.set("smooth", String(smoothValue));
      q.set("texture", "1");
    }
    const r = await fetch(`/export.glb?${q}`);
    if (!r.ok) throw new Error(await r.text());
    const dispo = r.headers.get("content-disposition") ?? "";
    const name = dispo.match(/filename="([^"]+)"/)?.[1] ?? "voxelforge.glb";
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    hud.textContent = `已导出 ${name}（${(blob.size / 1024).toFixed(0)} KB）`;
  } catch (e) {
    hud.textContent = "导出失败: " + (e as Error).message;
  } finally {
    exportBtn.disabled = false;
    setTimeout(() => { hud.textContent = prev; }, 4000);
  }
});

modeBtn.addEventListener("click", () => {
  mode = mode === "voxel" ? "mesh" : "voxel";
  modeBtn.textContent = mode === "voxel" ? "体素" : "平滑网格";
  resWrap.style.display = mode === "mesh" ? "flex" : "none";
  smoothWrap.style.display = mode === "mesh" ? "flex" : "none";
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
smoothSlider.addEventListener("input", () => {
  smoothValue = Number(smoothSlider.value);
  smoothVal.textContent = String(smoothValue);
  if (pendingSmoothFrame !== undefined) return;
  pendingSmoothFrame = requestAnimationFrame(() => {
    pendingSmoothFrame = undefined;
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
