import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { runScript } from "../src/core/script.js";

describe("runScript", () => {
  it("循环批量生成", () => {
    const g = new SparseVoxelGrid([64, 64, 64]);
    const pal = new Palette();
    const r = runScript(g, pal, `
      for (let i = 0; i < 5; i++) box(i * 6, 0, 0, i * 6 + 2, 4, 2, "#8b4513");
      log("done");
    `);
    expect(g.count).toBe(5 * 3 * 5 * 3);
    expect(r.added).toBe(225);
    expect(r.logs).toEqual(["done"]);
    expect(pal.hexOf(1)).toBe("#8b4513");
  });

  it("sphere/cylinder/line/set 全可用", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const pal = new Palette();
    runScript(g, pal, `
      sphere(8, 8, 8, 2, "#ff0000");
      cylinder(4, 0, 4, 1, 3, "#00ff00", { axis: "y" });
      line(0, 0, 0, 3, 0, 0, "#0000ff");
      set(15, 15, 15, "#ffffff");
    `);
    expect(g.get(15, 15, 15)).toBe(4);
  });

  it("死循环 → 超时抛错并回滚", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const pal = new Palette();
    g.set(0, 0, 0, pal.indexOf("#123456"));
    expect(() => runScript(g, pal, "while (true) {}", 200)).toThrow(/已回滚/);
    expect(g.count).toBe(1);
    expect(pal.size).toBe(1);
  });

  it("运行时错误 → 回滚", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const pal = new Palette();
    expect(() => runScript(g, pal, `box(0,0,0,1,1,1,"#ff0000"); nope();`)).toThrow(/已回滚/);
    expect(g.count).toBe(0);
  });

  it("越界坐标 → 抛错回滚", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    expect(() => runScript(g, new Palette(), `box(0,0,0,99,1,1,"#ff0000")`)).toThrow();
    expect(g.count).toBe(0);
  });
});
