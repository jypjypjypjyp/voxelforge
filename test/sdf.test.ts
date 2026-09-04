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

  it("对角接触：六邻域全实、仅对角邻空的胞取 5/3（26 邻域界面语义）", () => {
    // 实心除单个空气胞 (5,5,5)：cell(4,4,4) 的六个 6-邻居全实，最近空胞 (5,5,5) 为对角步（权重 5）
    const g = new SparseVoxelGrid([9, 9, 9]);
    for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) {
      if (!(x === 5 && y === 5 && z === 5)) g.set(x, y, z, 1);
    }
    const f = computeSignedDistance(g);
    expect(sampleField(f, 4.5, 4.5, 4.5)).toBeCloseTo(-5 / 3, 5); // cell(4,4,4) 中心
    expect(sampleField(f, 5.5, 5.5, 5.5)).toBeCloseTo(1, 5);      // 空胞 (5,5,5)：6 邻实 → +1
  });

  it("bbox 裁剪：场被裁剪到模型附近，但世界坐标语义不变", () => {
    const g = boxGrid([32, 32, 32], 20, 20, 20, 25, 25, 25); // 模型在远角，77% 空白
    const f = computeSignedDistance(g);
    expect(f.size[0]).toBeLessThan(32); // 已裁剪
    expect(sampleField(f, 21, 23, 24)).toBeLessThan(0);    // 盒内
    expect(sampleField(f, 26.5, 23, 24)).toBeGreaterThan(0); // 紧贴盒外
    expect(sampleField(f, 0.5, 0.5, 0.5)).toBeGreaterThan(0); // 远角平台期仍为正（不越零）
  });

  it("贴世界边缘：界外按空气处理（场允许越过世界边界，不 clamp 吞壳）", () => {
    // 盒贴 x/y/z 最大边缘（cells 4..11，world 12）：+x 侧界外 cell 12 须当作空气参与 EDT
    const g = boxGrid([12, 12, 12], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    expect(f.size[0]).toBe(10); // bbox 8 + 两侧 pad 1；+x 侧越过世界边界 1 格
    expect(sampleField(f, 11.6, 8, 8)).toBeLessThan(0);    // 贴边内侧为负
    expect(sampleField(f, 12.4, 8, 8)).toBeGreaterThan(0); // 界外为正（此前被 clamp 成深负 → 丢面）
  });
});
