import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { computeSignedDistance } from "../src/core/sdf.js";
import { surfaceNets, signedVolume, bboxOf } from "../src/core/surfaceNets.js";

function boxGrid(size: [number, number, number], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): SparseVoxelGrid {
  const g = new SparseVoxelGrid(size);
  for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) g.set(a, b, c, 1);
  return g;
}

describe("surfaceNets", () => {
  it("单盒包围盒≈盒、体积≈体素体积", () => {
    // 盒 cells 4..11 → 世界 [4,12]，体积 8^3=512
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [1, 0, 0]);
    const bb = bboxOf(m);
    expect(bb.min[0]).toBeGreaterThan(3.5); expect(bb.min[0]).toBeLessThan(4.6);
    expect(bb.max[0]).toBeGreaterThan(11.4); expect(bb.max[0]).toBeLessThan(12.5);
    expect(Math.abs(signedVolume(m) - 512) / 512).toBeLessThan(0.2);
  });

  it("三角数随分辨率增大而单调增加", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m8 = surfaceNets(f, 8, () => [1, 0, 0]);
    const m16 = surfaceNets(f, 16, () => [1, 0, 0]);
    const m32 = surfaceNets(f, 32, () => [1, 0, 0]);
    expect(m32.indices.length).toBeGreaterThan(m16.indices.length);
    expect(m16.indices.length).toBeGreaterThan(m8.indices.length);
  });

  it("封闭/水密：每条无向边恰 2 面", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [1, 0, 0]);
    const count = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
        const k = key(u, v);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    for (const [, cnt] of count) expect(cnt).toBe(2);
  });

  it("法线近似轴向（盒面法线沿轴）", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [1, 0, 0]);
    // 取 x 最小面上顶点，法线应接近 -x
    let best: number[] | undefined;
    let minX = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (m.positions[i] < minX) { minX = m.positions[i]; best = [m.normals[i], m.normals[i + 1], m.normals[i + 2]]; }
    }
    expect(best!).toBeDefined();
    expect(best![0]).toBeLessThan(-0.8); // 主体指向 -x
  });

  it("顶点色来源 colorAt", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [0.5, 0.25, 0.75]);
    expect(m.colors.length).toBe(m.positions.length);
    expect(Math.abs(m.colors[0] - 0.5)).toBeLessThan(1e-6);
  });

  it("smooth 上限 8 不至于抹平网格（仍能重建）", () => {
    const g = new SparseVoxelGrid([24, 24, 24]);
    for (let x = 0; x < 24; x++) for (let y = 0; y < 24; y++) for (let z = 0; z < 24; z++) {
      const dx = x - 11.5, dy = y - 11.5, dz = z - 11.5;
      if (dx * dx + dy * dy + dz * dz <= 7 * 7) g.set(x, y, z, 1);
    }
    const f = computeSignedDistance(g, { smooth: 8 });
    const m = surfaceNets(f, 24, () => [1, 0, 0]);
    expect(m.indices.length).toBeGreaterThan(0);
    const bb = bboxOf(m);
    expect(bb.max[0] - bb.min[0]).toBeGreaterThan(8); // 形状仍在（未塌缩）
  });

  it("球体（大量对角接触+薄曲面）水密且体积≈球", () => {
    const g = new SparseVoxelGrid([24, 24, 24]);
    for (let x = 0; x < 24; x++) for (let y = 0; y < 24; y++) for (let z = 0; z < 24; z++) {
      const dx = x - 11.5, dy = y - 11.5, dz = z - 11.5;
      if (dx * dx + dy * dy + dz * dz <= 7 * 7) g.set(x, y, z, 1);
    }
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 24, () => [1, 0, 0]);
    const count = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
        const k = key(u, v);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    for (const [, cnt] of count) expect(cnt).toBe(2); // 无重复 quad（活跃枚举恰好一次）
    expect(Math.abs(signedVolume(m) - (4 / 3) * Math.PI * 343) / ((4 / 3) * Math.PI * 343)).toBeLessThan(0.2);
  });

  it("网格范围跨完整 worldSize（裁剪场不改变世界坐标）", () => {
    const g = boxGrid([32, 32, 32], 20, 20, 20, 27, 27, 27);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [1, 0, 0]);
    const bb = bboxOf(m);
    expect(bb.min[0]).toBeGreaterThan(19.4); expect(bb.min[0]).toBeLessThan(20.6);
    expect(bb.max[0]).toBeGreaterThan(26.9); expect(bb.max[0]).toBeLessThan(28.1);
  });
});
