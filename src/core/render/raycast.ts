import type { Region } from "../types.js";
import { hexToRgb255 } from "../palette.js";

export interface VoxelSource {
  size: [number, number, number];
  get(x: number, y: number, z: number): number | undefined;
  bounds(): Region | null;
  colorAt(idx: number): [number, number, number];
}

export function gridSource(grid: { size: [number,number,number]; get(x: number, y: number, z: number): number|undefined; bounds(): Region | null }, hexAt: (idx: number) => string): VoxelSource {
  const cache = new Map<number, [number, number, number]>();
  return {
    size: grid.size,
    get: (x, y, z) => grid.get(x, y, z),
    bounds: () => grid.bounds(),
    colorAt(idx: number): [number, number, number] {
      let c = cache.get(idx);
      if (!c) { c = hexToRgb255(hexAt(idx)); cache.set(idx, c); }
      return c;
    }
  };
}

export interface RenderOpts {
  view?: "iso" | "front" | "side" | "top";
  yaw?: number;
  pitch?: number;
  size?: number;
  proj?: "ortho" | "persp";
  cutaway?: "x" | "y" | "z" | "quarter";
  axes?: boolean;
}

const VIEW_ANGLES: Record<string, [number, number]> = {
  iso: [45, 30], front: [0, 0], side: [90, 0], top: [0, 89]
};

// 3x5 数字点阵（行从上到下，每行 3 位）
const DIGITS: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7],
  "3": [7, 1, 7, 1, 7], "4": [5, 5, 7, 1, 1], "5": [7, 4, 7, 1, 7],
  "6": [7, 4, 7, 5, 7], "7": [7, 1, 2, 2, 2], "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7]
};

interface Vec3 { x: number; y: number; z: number }
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x
});
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const rad = (d: number): number => (d * Math.PI) / 180;

const LIGHT = norm({ x: 0.4, y: 0.85, z: 0.35 });

// 地面参照纹理：1 单位=1 纹元，覆盖 [gx0..gx0+w)×[gz0..gz0+h)
interface GroundTex { gx0: number; gz0: number; w: number; h: number; data: Uint8Array }
function buildGround(src: VoxelSource): GroundTex {
  const b = src.bounds() ?? [0, 0, 0, src.size[0] - 1, src.size[1] - 1, src.size[2] - 1];
  const gx0 = Math.floor(b[0] / 10) * 10 - 20;
  const gz0 = Math.floor(b[2] / 10) * 10 - 20;
  const w = (Math.ceil(b[3] / 10) * 10 + 20) - gx0;
  const h = (Math.ceil(b[5] / 10) * 10 + 20) - gz0;
  const data = new Uint8Array(w * h * 3); // 默认全 0 = 透明（画天空）
  const put = (x: number, z: number, r: number, g: number, bb: number) => {
    const ix = x - gx0, iz = z - gz0;
    if (ix < 0 || iz < 0 || ix >= w || iz >= h) return;
    const o = (iz * w + ix) * 3;
    data[o] = r; data[o + 1] = g; data[o + 2] = bb;
  };
  // 网格线（灰）
  for (let gx = Math.ceil(gx0 / 10) * 10; gx <= gx0 + w - 1; gx += 10) {
    for (let z = 0; z < h; z++) put(gx, gz0 + z, 120, 120, 125);
  }
  for (let gz = Math.ceil(gz0 / 10) * 10; gz <= gz0 + h - 1; gz += 10) {
    for (let x = 0; x < w; x++) put(gx0 + x, gz, 120, 120, 125);
  }
  // 轴线：X 红（z=0 行）、Z 蓝（x=0 列）
  for (let x = 0; x < w; x++) put(gx0 + x, 0, 220, 60, 60);
  for (let z = 0; z < h; z++) put(0, gz0 + z, 60, 90, 230);
  // 数字标签：X 轴红（z=-6 行）、Z 轴蓝（x=-6 列），间隔 10
  const drawDigit = (d: string, x0: number, z0: number, r: number, g: number, bb: number) => {
    const rows = DIGITS[d];
    for (let ry = 0; ry < 5; ry++) {
      for (let cx = 0; cx < 3; cx++) {
        if (!(rows[ry] & (1 << (2 - cx)))) continue;
        put(x0 + cx, z0 + ry, r, g, bb); // 纹元即世界单位，两个方向同为平铺
      }
    }
  };
  const drawLabel = (value: number, x0: number, z0: number, r: number, g: number, bb: number) => {
    const s = String(value);
    for (let i = 0; i < s.length; i++) {
      const d = DIGITS[s[i]] ? s[i] : "0";
      drawDigit(d, x0 + i * 4, z0, r, g, bb);
    }
  };
  for (let v = Math.ceil(gx0 / 10) * 10; v < gx0 + w; v += 10) drawLabel(v, v, -6, 220, 60, 60);
  for (let v = Math.ceil(gz0 / 10) * 10; v < gz0 + h; v += 10) drawLabel(v, -6, v, 60, 90, 230);
  return { gx0, gz0, w, h, data };
}

function cutSkip(src: VoxelSource, x: number, y: number, z: number, cut?: string): boolean {
  if (!cut) return false;
  const [sx, sy, sz] = src.size;
  if (cut === "x") return x >= Math.ceil(sx / 2);
  if (cut === "y") return y >= Math.ceil(sy / 2);
  if (cut === "z") return z >= Math.ceil(sz / 2);
  return x >= Math.ceil(sx / 2) && z >= Math.ceil(sz / 2); // quarter
}

interface Hit { t: number; idx: number; nx: number; ny: number; nz: number; x: number; y: number; z: number }

// DDA (Amanatides & Woo)：slab 求交取 t0（入射点），从入射 cell 起步逐格步进
function dda(src: VoxelSource, o: Vec3, d: Vec3, cut?: string): Hit | null {
  const [sx, sy, sz] = src.size;
  // slab 求交
  const bmin = { x: 0, y: 0, z: 0 }, bmax = { x: sx, y: sy, z: sz };
  let t0 = 0, t1 = Infinity;
  let entryAxis = -1;
  const od = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    const lo = [bmin.x, bmin.y, bmin.z][a], hi = [bmax.x, bmax.y, bmax.z][a];
    if (Math.abs(dd[a]) < 1e-12) {
      if (od[a] < lo || od[a] > hi) return null;
      continue;
    }
    let ta = (lo - od[a]) / dd[a], tb = (hi - od[a]) / dd[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) { t0 = ta; entryAxis = a; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (t1 <= 0) return null;
  const start = { x: o.x + d.x * (t0 + 1e-9), y: o.y + d.y * (t0 + 1e-9), z: o.z + d.z * (t0 + 1e-9) };
  let cx = Math.min(sx - 1, Math.max(0, Math.floor(start.x)));
  let cy = Math.min(sy - 1, Math.max(0, Math.floor(start.y)));
  let cz = Math.min(sz - 1, Math.max(0, Math.floor(start.z)));
  const step = [Math.sign(d.x), Math.sign(d.y), Math.sign(d.z)];
  // tMax：起点所在 cell 的下个边界（相对 start，即 t0 平移后的原点）的距离；dir 分量为 0 → Infinity
  const tMax = [0, 1, 2].map(a => {
    if (step[a] === 0) return Infinity;
    const cell = [cx, cy, cz][a];
    const target = step[a] > 0 ? cell + 1 : cell;
    return (target - start[["x", "y", "z"][a] as "x" | "y" | "z"]) / dd[a];
  });
  const tDelta = [0, 1, 2].map(a => (step[a] === 0 ? Infinity : Math.abs(1 / dd[a])));
  // lastAxis 初值 = slab 入射轴（第一个被进入的 cell 的入口面）
  let lastAxis = entryAxis >= 0 ? entryAxis : 1;
  const maxIter = sx + sy + sz + 3;
  for (let iter = 0; iter < maxIter; iter++) {
    const idx = src.get(cx, cy, cz);
    if (idx !== undefined && !cutSkip(src, cx, cy, cz, cut)) {
      const n = [0, 0, 0];
      n[lastAxis] = -step[lastAxis];
      return {
        t: t0, idx, nx: n[0], ny: n[1], nz: n[2], x: cx, y: cy, z: cz
      };
    }
    const a = tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;
    if (tMax[a] === Infinity || tMax[a] > t1 + 1e-9) return null;
    if (a === 0) cx += step[0]; else if (a === 1) cy += step[1]; else cz += step[2];
    if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) return null;
    tMax[a] += tDelta[a];
    lastAxis = a;
  }
  return null;
}

export function renderView(src: VoxelSource, opts: RenderOpts = {}): { w: number; h: number; rgba: Uint8Array } {
  const size = opts.size ?? 512;
  const view = opts.view ?? "iso";
  const yaw = opts.yaw ?? VIEW_ANGLES[view][0];
  const pitch = Math.max(-89, Math.min(89, opts.pitch ?? VIEW_ANGLES[view][1]));
  const proj = opts.proj ?? "ortho";
  const useAxes = opts.axes !== false;

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

  const ground = useAxes ? buildGround(src) : null;
  const sky = (v: number): [number, number, number] => {
    const t = Math.max(0, Math.min(1, v));
    return [184 + (235 - 184) * t, 209 + (242 - 209) * t, 242 + (250 - 242) * t];
  };

  const rgba = new Uint8Array(size * size * 4);
  const eyeDist = frame * 2.2;
  const eye: Vec3 = { x: center.x - f.x * eyeDist, y: center.y - f.y * eyeDist, z: center.z - f.z * eyeDist };

  for (let py = 0; py < size; py++) {
    const v = 1 - ((py + 0.5) / size) * 2; // +1 上
    for (let px = 0; px < size; px++) {
      const u = ((px + 0.5) / size) * 2 - 1;
      let origin: Vec3, dir: Vec3;
      if (proj === "ortho") {
        origin = {
          x: eye.x + right.x * u * frame + up.x * v * frame,
          y: eye.y + right.y * u * frame + up.y * v * frame,
          z: eye.z + right.z * u * frame + up.z * v * frame
        };
        dir = f;
      } else {
        dir = norm({
          x: f.x * eyeDist + right.x * u * frame + up.x * v * frame,
          y: f.y * eyeDist + right.y * u * frame + up.y * v * frame,
          z: f.z * eyeDist + right.z * u * frame + up.z * v * frame
        });
        origin = eye;
      }
      // 地面 y=-0.01 平面
      let groundColor: [number, number, number] | null = null;
      let groundT = Infinity;
      if (ground && Math.abs(dir.y) > 1e-9) {
        const tp = (-0.01 - origin.y) / dir.y;
        if (tp > 0) {
          const gx = Math.floor(origin.x + dir.x * tp);
          const gz = Math.floor(origin.z + dir.z * tp);
          const ix = gx - ground.gx0, iz = gz - ground.gz0;
          if (ix >= 0 && iz >= 0 && ix < ground.w && iz < ground.h) {
            const o = (iz * ground.w + ix) * 3;
            const r = ground.data[o], g = ground.data[o + 1], bb = ground.data[o + 2];
            if (r | g | bb) groundColor = [r, g, bb];
          }
          groundT = tp;
        }
      }
      const hit = dda(src, origin, dir, opts.cutaway);
      const o = (py * size + px) * 4;
      let color: [number, number, number];
      if (hit && hit.t < groundT) {
        const [br, bg, bb] = src.colorAt(hit.idx);
        const nd = { x: hit.nx, y: hit.ny, z: hit.nz };
        const shade = 0.55 + 0.45 * Math.max(0, dot(nd, LIGHT));
        let occ = 0;
        for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          if (src.get(hit.x + ax, hit.y + ay, hit.z + az) !== undefined) occ++;
        }
        const ao = 1 - 0.06 * occ;
        color = [br * shade * ao, bg * shade * ao, bb * shade * ao];
      } else if (groundColor) {
        color = groundColor;
      } else {
        color = sky(v);
      }
      rgba[o] = Math.min(255, Math.round(color[0]));
      rgba[o + 1] = Math.min(255, Math.round(color[1]));
      rgba[o + 2] = Math.min(255, Math.round(color[2]));
      rgba[o + 3] = 255;
    }
  }
  return { w: size, h: size, rgba };
}
