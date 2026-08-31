import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { placeBox, placeLine, placeSphere, placeCylinder } from "../src/core/ops.js";

describe("placeBox", () => {
  it("实心 2x3x4 = 24，返回计数与 bounds", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeBox(g, 0, 0, 0, 1, 2, 3, 1);
    expect(g.count).toBe(24);
    expect(s).toMatchObject({ added: 24, removed: 0, total: 24, bounds: [0, 0, 0, 1, 2, 3] });
  });

  it("hollow 4x4x4 = 56（壳=至少一个6邻域邻居在形状外）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeBox(g, 0, 0, 0, 3, 3, 3, 1, { hollow: true });
    expect(g.count).toBe(56);
    expect(g.get(1, 1, 1)).toBeUndefined(); // 内芯被挖掉
    expect(g.get(0, 1, 1)).toBe(1);
  });

  it("region 反向输入自动纠正", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeBox(g, 3, 3, 3, 0, 0, 0, 1);
    // (3,3,3)→(0,0,0) 纠正为 [0,0,0,3,3,3] 实心立方：4×4×4 = 64
    expect(g.count).toBe(64);
    expect(g.bounds()).toEqual([0, 0, 0, 3, 3, 3]);
  });

  it("越界区域被裁剪不抛错", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const s = placeBox(g, 6, 6, 6, 10, 10, 10, 1);
    expect(g.count).toBe(8); // 只剩界内 2x2x2
    expect(s.bounds).toEqual([6, 6, 6, 7, 7, 7]);
  });

  it("mirror x 复制到对侧", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 1, 1, 1, 1, { mirror: ["x"] });
    expect(g.count).toBe(16);
    expect(g.get(6, 0, 0)).toBe(1); // 8-1-1=6
    expect(g.get(7, 0, 0)).toBe(1);
  });

  it("mirror xy 生成 4 份组合", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 1, 1, 1, 1, { mirror: ["x", "y"] });
    expect(g.count).toBe(32);
  });

  it("重复 set 幂等不重复计数", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 1, 1, 1, 1);
    const s = placeBox(g, 0, 0, 0, 1, 1, 1, 1);
    expect(s.added).toBe(0);
    expect(g.count).toBe(8);
  });
});

describe("placeLine", () => {
  it("对角线 4 点", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeLine(g, 0, 0, 0, 3, 3, 3, 1);
    expect(s.added).toBe(4);
    expect(g.get(2, 2, 2)).toBe(1);
  });

  it("thickness=2 笔刷去重后 29 个体素", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeLine(g, 0, 0, 0, 3, 3, 3, 1, { thickness: 2 });
    expect(s.added).toBe(29); // 4 个 2x2x2 立方相邻共享 1 体素 ×3
  });

  it("单点线（起终点相同）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    expect(placeLine(g, 5, 5, 5, 5, 5, 5, 1).added).toBe(1);
  });

  it("线出界部分被跳过不抛错", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    expect(() => placeLine(g, 0, 0, 0, 10, 0, 0, 1)).not.toThrow();
    expect(g.get(3, 0, 0)).toBe(1);
    expect(g.get(4, 0, 0)).toBeUndefined();
  });
});

describe("placeSphere", () => {
  it("r=2 实心 33 体素", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeSphere(g, 8, 8, 8, 2, 1);
    expect(s.added).toBe(33);
    expect(g.get(8, 8, 8)).toBe(1);
    expect(g.get(10, 8, 8)).toBe(1);  // d²=4 ≤ 4
    expect(g.get(11, 8, 8)).toBeUndefined();
  });

  it("r=2 hollow 26 体素（挖掉完全内埋的 7 个：球心+6轴邻）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeSphere(g, 8, 8, 8, 2, 1, { hollow: true });
    expect(g.count).toBe(26);
    expect(g.get(8, 8, 8)).toBeUndefined();
    expect(g.get(10, 8, 8)).toBe(1);
  });
});

describe("placeCylinder", () => {
  it("axis=y r=2 h=3 共 39 体素（圆盘 13 × 3 层）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeCylinder(g, 8, 4, 8, 2, 3, 1);
    expect(s.added).toBe(39);
    expect(g.get(8, 4, 8)).toBe(1);
    expect(g.get(10, 5, 8)).toBe(1);
    expect(g.get(8, 7, 8)).toBeUndefined(); // h=3 → y ∈ [4,7)
  });

  it("axis=y hollow r=2 h=3 = 34（中段内埋 5 个被挖）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeCylinder(g, 8, 4, 8, 2, 3, 1, { hollow: true });
    expect(g.count).toBe(34);
    expect(g.get(8, 5, 8)).toBeUndefined(); // 中段轴心
    expect(g.get(8, 4, 8)).toBe(1);          // 底盖保留（壳）
  });

  it("axis=x 沿 x 延伸", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeCylinder(g, 4, 8, 8, 1, 3, 1, { axis: "x" });
    expect(s.added).toBe(15); // r=1 圆盘 5 × 3
    expect(g.get(4, 8, 8)).toBe(1);
    expect(g.get(6, 8, 8)).toBe(1);
    expect(g.get(7, 8, 8)).toBeUndefined();
  });

  it("mirror 对称", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeCylinder(g, 4, 0, 4, 1, 2, 1, { mirror: ["x"] });
    expect(g.get(4, 0, 4)).toBe(1);
    expect(g.get(11, 0, 4)).toBe(1); // 16-1-4=11
  });
});
