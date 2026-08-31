import vm from "node:vm";
import type { SparseVoxelGrid } from "./grid.js";
import type { Palette } from "./palette.js";
import type { Region } from "./types.js";
import {
  placeBox, placeSphere, placeCylinder, placeLine,
  paintRegion, eraseRegion, translateRegion, normRegion, type ChangeStats
} from "./ops.js";

export interface ScriptResult { logs: string[]; added: number; removed: number; total: number }

export function runScript(
  grid: SparseVoxelGrid, palette: Palette, code: string, timeoutMs = 5000
): ScriptResult {
  const snapG = grid.snapshot();
  const snapP = palette.snapshot();
  const logs: string[] = [];
  const sum = { added: 0, removed: 0 };
  const track = (fn: (...a: never[]) => ChangeStats) => (...args: never[]): ChangeStats => {
    const s = fn(...args);
    sum.added += s.added;
    sum.removed += s.removed;
    return s;
  };
  const idx = (hex: unknown): number => palette.indexOf(String(hex));
  const regionOf = (r: unknown): Region | null =>
    r === null || r === undefined ? null : (Array.isArray(r) && r.length === 6 ? (r as Region) : (() => { throw new Error(`region 须为 [x0,y0,z0,x1,y1,z1] 或 null`); })());
  // 沙箱放置 API 严格校验：区域须完全在网格内（ops 层是宽容裁剪语义，脚本层须抛错回滚）
  const checkRegion = (r: Region): void => {
    const n = normRegion(r);
    const [sx, sy, sz] = grid.size;
    if (n[0] < 0 || n[1] < 0 || n[2] < 0 || n[3] > sx - 1 || n[4] > sy - 1 || n[5] > sz - 1) {
      throw new Error(`坐标越界 ${JSON.stringify(n)}，合法范围 x:0..${sx - 1} y:0..${sy - 1} z:0..${sz - 1}`);
    }
  };

  const api = {
    size: [...grid.size] as [number, number, number],
    log: (...args: unknown[]) => logs.push(args.map(a => String(a)).join(" ")),
    palette: (hex: unknown) => idx(hex),
    box: track((x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: string, opts?: object) => {
      checkRegion([x0, y0, z0, x1, y1, z1]);
      return placeBox(grid, x0, y0, z0, x1, y1, z1, idx(hex), opts);
    }),
    sphere: track((cx: number, cy: number, cz: number, r: number, hex: string, opts?: object) => {
      const r0 = Math.ceil(r);
      checkRegion([cx - r0, cy - r0, cz - r0, cx + r0, cy + r0, cz + r0]);
      return placeSphere(grid, cx, cy, cz, r, idx(hex), opts);
    }),
    cylinder: track((cx: number, cy: number, cz: number, r: number, h: number, hex: string, opts?: object) => {
      const axis = (opts as { axis?: "x" | "y" | "z" } | undefined)?.axis ?? "y";
      const r0 = Math.ceil(r);
      checkRegion(axis === "x"
        ? [cx, cy - r0, cz - r0, cx + h - 1, cy + r0, cz + r0]
        : axis === "y"
          ? [cx - r0, cy, cz - r0, cx + r0, cy + h - 1, cz + r0]
          : [cx - r0, cy - r0, cz, cx + r0, cy + r0, cz + h - 1]);
      return placeCylinder(grid, cx, cy, cz, r, h, idx(hex), opts);
    }),
    line: track((x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: string, opts?: object) => {
      const t = Math.max(1, Math.round((opts as { thickness?: number } | undefined)?.thickness ?? 1));
      checkRegion([x0, y0, z0, x1 + t - 1, y1 + t - 1, z1 + t - 1]);
      return placeLine(grid, x0, y0, z0, x1, y1, z1, idx(hex), opts);
    }),
    set: (x: number, y: number, z: number, hex: string) => {
      if (grid.set(x, y, z, idx(hex))) sum.added++;
    },
    unset: (x: number, y: number, z: number) => {
      if (grid.unset(x, y, z)) sum.removed++;
    },
    paint: track((region: unknown, fromHex: unknown, hex: string) =>
      paintRegion(grid, regionOf(region) as Region | null,
        fromHex === null || fromHex === undefined ? undefined : idx(fromHex as string), idx(hex))),
    erase: track((region: unknown) =>
      eraseRegion(grid, region === "all" ? "all" : regionOf(region) as Region)),
    translate: track((region: unknown, dx: number, dy: number, dz: number) =>
      translateRegion(grid, regionOf(region) as Region, dx, dy, dz))
  };

  try {
    vm.runInNewContext(code, api, { timeout: timeoutMs });
  } catch (e) {
    grid.restore(snapG);
    palette.restore(snapP);
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`script 执行失败（已回滚）: ${msg}`);
  }
  return { logs, added: sum.added, removed: sum.removed, total: grid.count };
}
