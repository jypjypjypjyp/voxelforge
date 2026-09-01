import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { sampleVoxelColor } from "../src/core/color.js";

describe("sampleVoxelColor", () => {
  it("最近体素占用 → 取其颜色", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(3, 3, 3, 1);
    const c = sampleVoxelColor(g, () => "#8b4513", 3, 3, 3);
    expect(c[0]).toBeCloseTo(0x8b / 255, 3); expect(c[1]).toBeCloseTo(0x45 / 255, 3); expect(c[2]).toBeCloseTo(0x13 / 255, 3);
  });
  it("最近体素为空但邻域有占用 → 取实体侧色（不落灰）", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    // 实体在 x=2..4；采样点 x=5(空)，邻域(4)为占用
    for (let k = 2; k <= 4; k++) for (let b = 2; b <= 4; b++) for (let c = 2; c <= 4; c++) g.set(k, b, c, 1);
    const c = sampleVoxelColor(g, () => "#ff0000", 5, 3, 3);
    expect(c[0]).toBeCloseTo(1, 3); expect(c[1]).toBeCloseTo(0, 3); expect(c[2]).toBeCloseTo(0, 3);
  });
  it("附近全空 → 返回 fallback 灰", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    const c = sampleVoxelColor(g, () => "#ff0000", 0, 0, 0);
    expect(c[0]).toBeCloseTo(0.55, 3); expect(c[1]).toBeCloseTo(0.55, 3); expect(c[2]).toBeCloseTo(0.55, 3);
  });
});
