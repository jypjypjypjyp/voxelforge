import type { SparseVoxelGrid } from "./grid.js";
import { hexToRgb01 } from "./export/mesh.js";

export function sampleVoxelColor(
  grid: SparseVoxelGrid,
  hexAt: (idx: number) => string | undefined,
  x: number, y: number, z: number,
  fallback: [number, number, number] = [0.55, 0.55, 0.55]
): [number, number, number] {
  const [sx, sy, sz] = grid.size;
  const vx = Math.min(Math.max(Math.round(x - 0.5), 0), sx - 1);
  const vy = Math.min(Math.max(Math.round(y - 0.5), 0), sy - 1);
  const vz = Math.min(Math.max(Math.round(z - 0.5), 0), sz - 1);
  const take = (cx: number, cy: number, cz: number): [number, number, number] | undefined => {
    const i = grid.get(cx, cy, cz);
    if (i === undefined) return undefined;
    const hex = hexAt(i);
    if (!hex) return undefined;
    return hexToRgb01(hex);
  };
  const direct = take(vx, vy, vz);
  if (direct) return direct;
  // 边界处：最近体素为空 → 半径 1..2 内搜最近占用体素（取实体侧色，避免灰点）
  for (let r = 1; r <= 2; r++) {
    let best: [number, number, number] | undefined;
    let bestD = Infinity;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const cx = vx + dx, cy = vy + dy, cz = vz + dz;
          if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) continue;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { const cc = take(cx, cy, cz); if (cc) { best = cc; bestD = d; } }
        }
    if (best) return best;
  }
  return fallback;
}
