import type { SparseVoxelGrid } from "./grid.js";
import { hexToRgb01 } from "./export/mesh.js";
import type { SdfField } from "./sdf.js";

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

/**
 * 密集索引场颜色采样器（P0-4）：O(1) 直查 + 零字符串分配，替代逐顶点 string-key Map 探针。
 * idx 与 field 同维度（buildSignedField 输出，0=空）；网格边界兜底在密集场内做 r≤2 邻域搜索。
 */
export function makeDenseColorSampler(
  field: Pick<SdfField, "size" | "origin">,
  idx: Uint8Array,
  hexAt: (pi: number) => string | undefined
): (x: number, y: number, z: number) => [number, number, number] {
  const [sx, sy, sz] = field.size;
  const [ox, oy, oz] = field.origin;
  const plane = sx * sy;
  const lut = new Array<[number, number, number] | undefined>(256);
  const rgbOf = (pi: number): [number, number, number] | undefined => {
    if (!pi) return undefined;
    let c = lut[pi];
    if (!c) { c = hexToRgb01(hexAt(pi) ?? "#888888"); lut[pi] = c; }
    return c;
  };
  const at = (cx: number, cy: number, cz: number): [number, number, number] | undefined => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) return undefined;
    return rgbOf(idx[cx + cy * sx + cz * plane]);
  };
  return (x, y, z) => {
    const vx = Math.min(Math.max(Math.round(x - 0.5) - ox, 0), sx - 1);
    const vy = Math.min(Math.max(Math.round(y - 0.5) - oy, 0), sy - 1);
    const vz = Math.min(Math.max(Math.round(z - 0.5) - oz, 0), sz - 1);
    const direct = at(vx, vy, vz);
    if (direct) return direct;
    for (let r = 1; r <= 2; r++) {
      let best: [number, number, number] | undefined;
      let bestD = Infinity;
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            const d = dx * dx + dy * dy + dz * dz;
            if (d >= bestD) continue;
            const cc = at(vx + dx, vy + dy, vz + dz);
            if (cc) { best = cc; bestD = d; }
          }
      if (best) return best;
    }
    return [0.55, 0.55, 0.55];
  };
}
