import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { checkGrid, formatCheck } from "../src/core/check.js";

describe("checkGrid", () => {
  it("两个分离盒子 → components=2", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) g.set(x, y, z, 1);
    for (let x = 8; x < 10; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) g.set(x, y, z, 1);
    const r = checkGrid(g);
    expect(r.components).toBe(2);
    expect(r.floating).toBe(0);
  });

  it("悬空单点 → floating=1", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    g.set(10, 5, 10, 1);
    const r = checkGrid(g);
    expect(r.floating).toBe(1);
    expect(r.components).toBe(1);
  });

  it("对称/不对称计数", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 0, 0, 1); // 镜像位 (6,0,0) 缺失
    const r = checkGrid(g);
    expect(r.symmetry.x).toBe(1);
    expect(r.symmetry.y).toBe(0); // y 向 0↔7 都为空，无体素即对称
    g.set(6, 0, 0, 1);
    expect(checkGrid(g).symmetry.x).toBe(0);
  });

  it("profile 剖面计数", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(0, 0, 0, 1); g.set(0, 1, 0, 1); g.set(3, 0, 3, 1);
    const r = checkGrid(g);
    expect(r.profile.x[0]).toBe(2);
    expect(r.profile.x[3]).toBe(1);
    expect(r.profile.x.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("formatCheck 输出关键字段", () => {
    // 勘误（brief 原文 [8,8,8]）：set(10,5,10) 在 8³ 网格越界抛错（Task 2 边界校验），
    // 断言不可达；同文件上一用例同坐标用 16³，故按显然意图改为 16³。
    const g = new SparseVoxelGrid([16, 16, 16]);
    g.set(10, 5, 10, 1);
    const text = formatCheck(checkGrid(g));
    expect(text).toContain("floating 1");
    expect(text).toContain("components 1");
  });
});
