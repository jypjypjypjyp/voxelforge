import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { gridSource } from "../src/core/render/raycast.js";
import { renderProject } from "../src/core/render/render.js";

function setup() {
  const g = new SparseVoxelGrid([16, 16, 16]);
  for (let x = 2; x < 8; x++) for (let y = 0; y < 4; y++) for (let z = 2; z < 8; z++) g.set(x, y, z, 1);
  const pal = new Palette({ "1": "#4488cc" });
  return gridSource(g, (i) => pal.hexOf(i)!);
}

describe("renderProject", () => {
  it("single 默认 iso", () => {
    const r = renderProject(setup(), { size: 64 });
    expect(r.views).toEqual(["iso"]);
    expect(r.w).toBe(64);
  });

  it("multi 三视图拼接 w=3*64+16 分隔条深灰", () => {
    const r = renderProject(setup(), { size: 64, views: "multi" });
    expect(r.views).toEqual(["iso", "front", "side"]);
    expect(r.w).toBe(3 * 64 + 16);
    expect(r.h).toBe(64);
    // 分隔条像素（x=64..67）为深灰
    const o = (10 * r.w + 65) * 4;
    expect(Math.abs(r.rgba[o] - 70)).toBeLessThan(30);
  });

  it("highlight 区域出现红色线框像素", () => {
    const r = renderProject(setup(), { size: 64, highlight: [2, 0, 2, 7, 3, 7] });
    let red = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      if (r.rgba[i] > 200 && r.rgba[i + 1] < 90 && r.rgba[i + 2] < 90) red++;
    }
    expect(red).toBeGreaterThan(5);
  });

  it("无 highlight 时无纯红像素", () => {
    const r = renderProject(setup(), { size: 64 });
    let red = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      if (r.rgba[i] > 200 && r.rgba[i + 1] < 90 && r.rgba[i + 2] < 90) red++;
    }
    expect(red).toBe(0);
  });
});
