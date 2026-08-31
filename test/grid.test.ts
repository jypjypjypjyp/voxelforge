import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";

describe("SparseVoxelGrid", () => {
  it("set/get/unset 与 count", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    expect(g.count).toBe(0);
    expect(g.set(1, 2, 3, 1)).toBe(true);
    expect(g.set(1, 2, 3, 1)).toBe(false); // 同值幂等
    expect(g.get(1, 2, 3)).toBe(1);
    expect(g.unset(1, 2, 3)).toBe(true);
    expect(g.unset(1, 2, 3)).toBe(false);
    expect(g.count).toBe(0);
  });

  it("越界 set 抛错并携带合法范围", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    expect(() => g.set(4, 0, 0, 1)).toThrow(/x:0\.\.3/);
    expect(() => g.set(-1, 0, 0, 1)).toThrow();
  });

  it("构造拒绝非法 size", () => {
    expect(() => new SparseVoxelGrid([0, 8, 8])).toThrow();
    expect(() => new SparseVoxelGrid([300, 8, 8])).toThrow();
  });

  it("bounds 与 colorCounts", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    g.set(2, 3, 4, 1); g.set(5, 1, 9, 2); g.set(5, 1, 9, 1);
    expect(g.bounds()).toEqual([2, 1, 4, 5, 3, 9]);
    expect(g.colorCounts().get(1)).toBe(2);
    expect(g.count).toBe(2);
  });

  it("空网格 bounds 为 null", () => {
    expect(new SparseVoxelGrid([4, 4, 4]).bounds()).toBeNull();
  });

  it("snapshot/restore 深拷贝", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 1, 1, 1);
    const snap = g.snapshot();
    g.set(2, 2, 2, 2);
    g.restore(snap);
    expect(g.count).toBe(1);
    expect(g.get(2, 2, 2)).toBeUndefined();
  });

  it("coords 迭代产出坐标", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 2, 3, 5);
    expect([...g.coords()]).toEqual([[1, 2, 3, 5]]);
  });

  it("clear 清空", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 1, 1, 1);
    g.clear();
    expect(g.count).toBe(0);
  });
});
