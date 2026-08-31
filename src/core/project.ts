import fs from "node:fs/promises";
import { SparseVoxelGrid } from "./grid.js";
import { Palette } from "./palette.js";
import type { VoxelProject } from "./types.js";

export function validateProject(data: unknown): VoxelProject {
  if (typeof data !== "object" || data === null) throw new Error("项目根必须是对象");
  const d = data as Record<string, unknown>;
  if (d.format !== "voxelforge/1") throw new Error(`format 必须为 "voxelforge/1"，实际: ${JSON.stringify(d.format)}`);
  const size = d.size;
  if (!Array.isArray(size) || size.length !== 3 || size.some(n => !Number.isInteger(n) || n < 1 || n > 256)) {
    throw new Error(`size 必须为 [x,y,z]，每轴 1..256: ${JSON.stringify(d.size)}`);
  }
  const palette = d.palette;
  if (typeof palette !== "object" || palette === null) throw new Error("palette 必须为对象");
  for (const [k, v] of Object.entries(palette)) {
    if (!/^\d+$/.test(k) || Number(k) < 1 || Number(k) > 255) throw new Error(`palette 键必须为 1..255: ${k}`);
    try {
      Palette.normalize(v as string);
    } catch {
      throw new Error(`palette[${k}] 颜色格式无效: ${JSON.stringify(v)}，需要 #RRGGBB`);
    }
  }
  const voxels = d.voxels;
  if (typeof voxels !== "object" || voxels === null) throw new Error("voxels 必须为对象");
  const [sx, sy, sz] = size as [number, number, number];
  for (const [k, idx] of Object.entries(voxels)) {
    if (!/^\d+,\d+,\d+$/.test(k)) throw new Error(`voxels 键必须为 "x,y,z": ${k}`);
    const [x, y, z] = k.split(",").map(Number);
    if (x >= sx || y >= sy || z >= sz) throw new Error(`voxels 越界: ${k}（size [${size}]）`);
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 1 || idx > 255) {
      throw new Error(`voxels 值必须为 1..255 调色板号: ${k}=${JSON.stringify(idx)}`);
    }
  }
  return d as unknown as VoxelProject;
}

export function emptyProject(size: [number, number, number]): VoxelProject {
  return { format: "voxelforge/1", size: [...size] as [number, number, number], palette: {}, voxels: {} };
}

export async function loadForge(file: string): Promise<{ grid: SparseVoxelGrid; palette: Palette }> {
  const raw = await fs.readFile(file, "utf8");
  const p = validateProject(JSON.parse(raw));
  return { grid: SparseVoxelGrid.fromProject(p), palette: new Palette(p.palette) };
}

export async function saveForge(file: string, grid: SparseVoxelGrid, palette: Palette): Promise<void> {
  const project: VoxelProject = {
    format: "voxelforge/1",
    size: [...grid.size] as [number, number, number],
    palette: palette.toRecord(),
    voxels: Object.fromEntries(grid.entries())
  };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project));
  await fs.rename(tmp, file);
}
