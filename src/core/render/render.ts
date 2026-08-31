import type { Region } from "../types.js";
import { renderView, type RenderOpts, type VoxelSource } from "./raycast.js";

export interface RenderRequest extends RenderOpts {
  views?: "single" | "multi";
  highlight?: Region;
}

interface Cam { f: Vec3; right: Vec3; up: Vec3; center: Vec3; frame: number; eye: Vec3; eyeDist: number; proj: "ortho" | "persp" }
interface Vec3 { x: number; y: number; z: number }

const VIEW_ANGLES: Record<string, [number, number]> = {
  iso: [45, 30], front: [0, 0], side: [90, 0], top: [0, 89]
};

const rad = (d: number): number => (d * Math.PI) / 180;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x
});
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

// 与 renderView 相同的相机推导（重复实现以保持 core 内聚；renderView 参数完全确定）
function makeCamera(src: VoxelSource, opts: RenderOpts): Cam {
  const view = opts.view ?? "iso";
  const yaw = opts.yaw ?? VIEW_ANGLES[view][0];
  const pitch = Math.max(-89, Math.min(89, opts.pitch ?? VIEW_ANGLES[view][1]));
  const b = src.bounds();
  const center: Vec3 = b
    ? { x: (b[0] + b[3] + 1) / 2, y: (b[1] + b[4] + 1) / 2, z: (b[2] + b[5] + 1) / 2 }
    : { x: src.size[0] / 2, y: src.size[1] / 2, z: src.size[2] / 2 };
  const extent = b ? Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) + 1 : Math.max(...src.size);
  const frame = extent * 0.85 + 8; // 留出参照层边距

  // forward: yaw 绕 Y（自 +Z），pitch 为相机仰角（正值=俯视模型，forward.y = −sin(pitch)，
  // 保证 eye = center − f·eyeDist 在地面上方）；right = norm(cross(f, up0))，up = cross(right, f)
  const f = { x: Math.sin(rad(yaw)) * Math.cos(rad(pitch)), y: -Math.sin(rad(pitch)), z: Math.cos(rad(yaw)) * Math.cos(rad(pitch)) };
  const right = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const up = cross(right, f);

  const eyeDist = frame * 2.2;
  const eye: Vec3 = { x: center.x - f.x * eyeDist, y: center.y - f.y * eyeDist, z: center.z - f.z * eyeDist };
  return { f, right, up, center, frame, eye, eyeDist, proj: opts.proj ?? "ortho" };
}

// 逆投影：世界点 → 子画布像素坐标（与 renderView 的逐像素正向映射互逆）
function projectPoint(p: Vec3, cam: Cam, size: number): [number, number] {
  const d = { x: p.x - cam.center.x, y: p.y - cam.center.y, z: p.z - cam.center.z };
  let u: number, v: number;
  if (cam.proj === "ortho") {
    u = (d.x * cam.right.x + d.y * cam.right.y + d.z * cam.right.z) / cam.frame;
    v = (d.x * cam.up.x + d.y * cam.up.y + d.z * cam.up.z) / cam.frame;
  } else {
    const rel = { x: p.x - cam.eye.x, y: p.y - cam.eye.y, z: p.z - cam.eye.z };
    const depth = rel.x * cam.f.x + rel.y * cam.f.y + rel.z * cam.f.z;
    u = ((rel.x * cam.right.x + rel.y * cam.right.y + rel.z * cam.right.z) / depth) * cam.eyeDist / cam.frame;
    v = ((rel.x * cam.up.x + rel.y * cam.up.y + rel.z * cam.up.z) / depth) * cam.eyeDist / cam.frame;
  }
  return [(u + 1) / 2 * size, (1 - v) / 2 * size];
}

// Bresenham，红 (255,48,48)；边界检查按子画布（x − xoff ∈ [0, size)），不越过分隔条/相邻视图
function drawLine(rgba: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, xoff: number, size: number): void {
  // 先取整再算 dx/dy：整数 Bresenham 的终止性依赖整数误差项，
  // 小数端点会让 x 越过 ex 后永不回头（persp 投影必现死循环）
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  const ex = x1, ey = y1;
  for (;;) {
    const lx = x - xoff;
    if (lx >= 0 && y >= 0 && lx < size && y < h) {
      const o = (y * w + x) * 4;
      rgba[o] = 255; rgba[o + 1] = 48; rgba[o + 2] = 48; rgba[o + 3] = 255;
    }
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function drawHighlight(rgba: Uint8Array, w: number, h: number, region: Region, cam: Cam, size: number, xoff: number): void {
  const [x0, y0, z0, x1, y1, z1] = region;
  const corners: Vec3[] = [];
  for (const X of [x0, x1 + 1]) for (const Y of [y0, y1 + 1]) for (const Z of [z0, z1 + 1]) corners.push({ x: X, y: Y, z: Z });
  // 12 条边：同轴且其余两轴坐标为端点组合
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      const a = corners[i], b = corners[j];
      const diffs = (a.x !== b.x ? 1 : 0) + (a.y !== b.y ? 1 : 0) + (a.z !== b.z ? 1 : 0);
      if (diffs === 1) edges.push([i, j]);
    }
  }
  for (const [i, j] of edges) {
    const [ax, ay] = projectPoint(corners[i], cam, size);
    const [bx, by] = projectPoint(corners[j], cam, size);
    drawLine(rgba, w, h, ax + xoff, ay, bx + xoff, by, xoff, size);
  }
}

export function renderProject(src: VoxelSource, req: RenderRequest = {}): { w: number; h: number; rgba: Uint8Array; views: string[] } {
  const size = req.size ?? 512;
  const views: string[] = req.views === "multi" ? ["iso", "front", "side"] : [req.view ?? "iso"];
  // 默认关闭地面参照层：其 X 轴红线 (220,60,60) 会污染「红色=highlight」契约
  //（renderProject 契约保证无 highlight 时无纯红像素）。显式传 axes: true 可开启。
  const singles = views.map(v => renderView(src, { ...req, view: v as RenderOpts["view"], size, axes: req.axes ?? false }));
  const sep = req.views === "multi" ? 8 : 0;
  const w = singles.length * size + (singles.length - 1) * sep;
  const h = size;
  const rgba = new Uint8Array(w * h * 4);
  singles.forEach((s, i) => {
    const xoff = i * (size + sep);
    for (let y = 0; y < h; y++) {
      rgba.set(s.rgba.subarray(y * size * 4, (y + 1) * size * 4), (y * w + xoff) * 4);
    }
  });
  // 分隔条深灰 (70)
  if (sep) {
    for (let i = 0; i < singles.length - 1; i++) {
      for (let x = i * (size + sep) + size; x < (i + 1) * (size + sep); x++) {
        for (let y = 0; y < h; y++) {
          const o = (y * w + x) * 4;
          rgba[o] = 70; rgba[o + 1] = 70; rgba[o + 2] = 74; rgba[o + 3] = 255;
        }
      }
    }
  }
  if (req.highlight) {
    // highlight 画在每个视图上（用各自相机），投影到子画布坐标后平移 xoff
    singles.forEach((_, i) => {
      const view = views[i];
      const cam = makeCamera(src, { ...req, view: view as RenderOpts["view"] });
      drawHighlight(rgba, w, h, req.highlight!, cam, size, i * (size + sep));
    });
  }
  return { w, h, rgba, views };
}
