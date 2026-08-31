import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { sliceAscii } from "../src/core/slice.js";

describe("sliceAscii", () => {
  it("y 层：字符与图例正确", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(0, 3, 0, 1);
    g.set(1, 3, 0, 2);
    const pal = new Palette({ "1": "#8b4513", "2": "#daa520" });
    const text = sliceAscii(g, pal, "y", 3);
    const lines = text.split("\n");
    expect(lines.some(l => l.startsWith("z0") && l.includes("AB."))).toBe(true);
    expect(text).toContain("A=#8b4513");
    expect(text).toContain("B=#daa520");
  });

  it("空层全点", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    const text = sliceAscii(g, new Palette(), "y", 2);
    expect(text).toContain("....");
  });

  it("axis=x 与 axis=z 行列轴映射正确", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(2, 1, 0, 1); // (x=2,y=1,z=0)
    const pal = new Palette({ "1": "#ff0000" });
    // axis=x, index=2 → 行 z, 列 y：z0 行 y1 列应为 A
    const tx = sliceAscii(g, pal, "x", 2);
    const zRow = tx.split("\n").find(l => l.startsWith("z0"))!;
    expect(zRow.includes("A")).toBe(true);
    // axis=z, index=0 → 行 y, 列 x：y1 行 x2 列应为 A
    const tz = sliceAscii(g, pal, "z", 0);
    const yRow = tz.split("\n").find(l => l.startsWith("y1"))!;
    expect(yRow.includes("A")).toBe(true);
  });

  it("region 限定窗口", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    g.set(10, 0, 10, 1);
    const pal = new Palette({ "1": "#ff0000" });
    const text = sliceAscii(g, pal, "y", 0, [8, 0, 8, 12, 0, 12]);
    expect(text).toContain("A");
    expect(text.split("\n").some(l => l.startsWith("z"))).toBe(true);
  });
});
