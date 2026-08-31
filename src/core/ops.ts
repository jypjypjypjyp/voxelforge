import type { SparseVoxelGrid } from "./grid.js";
import type { Axis, Region } from "./types.js";

export interface PlaceOpts {
  hollow?: boolean;
  mirror?: Axis[];
}

export interface ChangeStats {
  added: number;
  removed: number;
  total: number;
  bounds: Region | null;
}

export function normRegion(r: Region): Region {
  return [
    Math.min(r[0], r[3]), Math.min(r[1], r[4]), Math.min(r[2], r[5]),
    Math.max(r[0], r[3]), Math.max(r[1], r[4]), Math.max(r[2], r[5])
  ];
}

export function mirrorTargets(
  g: SparseVoxelGrid, x: number, y: number, z: number, mirror?: Axis[]
): Array<[number, number, number]> {
  if (!mirror || mirror.length === 0) return [[x, y, z]];
  const out: Array<[number, number, number]> = [];
  const n = mirror.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    let px = x, py = y, pz = z;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const a = mirror[i];
      const axisIdx = a === "x" ? 0 : a === "y" ? 1 : 2;
      const v = axisIdx === 0 ? px : axisIdx === 1 ? py : pz;
      const m = g.size[axisIdx] - 1 - v;
      if (axisIdx === 0) px = m; else if (axisIdx === 1) py = m; else pz = m;
    }
    out.push([px, py, pz]);
  }
  return out;
}

// 形状几何谓词：hollow 壳 = 形状内体素且 6 邻域至少一个邻居在形状外
abstract class Shape {
  abstract inside(x: number, y: number, z: number): boolean;
  isShell(x: number, y: number, z: number): boolean {
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      .some(([dx, dy, dz]) => !this.inside(x + dx, y + dy, z + dz));
  }
}

class BoxShape extends Shape {
  constructor(private r: Region) { super(); }
  inside(x: number, y: number, z: number): boolean {
    return x >= this.r[0] && y >= this.r[1] && z >= this.r[2] && x <= this.r[3] && y <= this.r[4] && z <= this.r[5];
  }
}

function stats(g: SparseVoxelGrid, added: number, removed: number): ChangeStats {
  return { added, removed, total: g.count, bounds: g.bounds() };
}

function placeShape(g: SparseVoxelGrid, shape: Shape, region: Region, idx: number, opts: PlaceOpts): ChangeStats {
  const r = normRegion(region);
  let added = 0;
  const seen = new Set<string>();
  for (let x = Math.max(0, r[0]); x <= Math.min(g.size[0] - 1, r[3]); x++) {
    for (let y = Math.max(0, r[1]); y <= Math.min(g.size[1] - 1, r[4]); y++) {
      for (let z = Math.max(0, r[2]); z <= Math.min(g.size[2] - 1, r[5]); z++) {
        if (!shape.inside(x, y, z)) continue;
        if (opts.hollow && !shape.isShell(x, y, z)) continue;
        for (const [mx, my, mz] of mirrorTargets(g, x, y, z, opts.mirror)) {
          const k = `${mx},${my},${mz}`;
          if (seen.has(k)) continue;
          seen.add(k);
          if (g.set(mx, my, mz, idx)) added++;
        }
      }
    }
  }
  return stats(g, added, 0);
}

export function placeBox(
  g: SparseVoxelGrid, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, idx: number, opts: PlaceOpts = {}
): ChangeStats {
  const r = normRegion([x0, y0, z0, x1, y1, z1]);
  return placeShape(g, new BoxShape(r), r, idx, opts);
}

export interface LineOpts extends PlaceOpts { thickness?: number }

export function placeLine(
  g: SparseVoxelGrid, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, idx: number, opts: LineOpts = {}
): ChangeStats {
  const t = Math.max(1, Math.round(opts.thickness ?? 1));
  const N = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  let added = 0;
  const seen = new Set<string>();
  for (let i = 0; i <= N; i++) {
    const f = N === 0 ? 0 : i / N;
    const x = Math.round(x0 + (x1 - x0) * f);
    const y = Math.round(y0 + (y1 - y0) * f);
    const z = Math.round(z0 + (z1 - z0) * f);
    for (let ox = 0; ox < t; ox++) {
      for (let oy = 0; oy < t; oy++) {
        for (let oz = 0; oz < t; oz++) {
          for (const [mx, my, mz] of mirrorTargets(g, x + ox, y + oy, z + oz, opts.mirror)) {
            if (!g.inBounds(mx, my, mz)) continue;
            const k = `${mx},${my},${mz}`;
            if (seen.has(k)) continue;
            seen.add(k);
            if (g.set(mx, my, mz, idx)) added++;
          }
        }
      }
    }
  }
  return stats(g, added, 0);
}
