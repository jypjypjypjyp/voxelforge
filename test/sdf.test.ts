import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { computeSignedDistance, sampleField } from "../src/core/sdf.js";

function boxGrid(size: [number, number, number], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): SparseVoxelGrid {
  const g = new SparseVoxelGrid(size);
  for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) g.set(a, b, c, 1);
  return g;
}

describe("computeSignedDistance", () => {
  it("单盒：内部为负、外部为正、边界附近过零", () => {
    const g = boxGrid([8, 8, 8], 2, 2, 2, 5, 5, 5);
    const f = computeSignedDistance(g);
    expect(sampleField(f, 4, 4, 4)).toBeLessThan(0);      // 盒心内部
    expect(sampleField(f, 0, 0, 0)).toBeGreaterThan(0);   // 角落外部
    expect(sampleField(f, 2.5, 4, 4)).toBeLessThan(0);    // 紧贴盒内(距面0.5)
    expect(sampleField(f, 6.5, 4, 4)).toBeGreaterThan(0); // 紧贴盒外
  });

  it("空网格：全部为正（无体）", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    const f = computeSignedDistance(g);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) {
      expect(sampleField(f, x + 0.5, y + 0.5, z + 0.5)).toBeGreaterThan(0);
    }
  });

  it("smooth 使场更平滑（相邻样本差更小）", () => {
    const g = boxGrid([8, 8, 8], 2, 2, 2, 5, 5, 5);
    const raw = computeSignedDistance(g);
    const sm = computeSignedDistance(g, { smooth: 2 });
    const dRaw = Math.abs(sampleField(raw, 2.5, 4, 4) - sampleField(raw, 3.5, 4, 4));
    const dSm = Math.abs(sampleField(sm, 2.5, 4, 4) - sampleField(sm, 3.5, 4, 4));
    expect(dSm).toBeLessThan(dRaw);
  });
});
