import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { renderView, gridSource } from "../src/core/render/raycast.js";

function singleRed(): { src: ReturnType<typeof gridSource>; } {
  const g = new SparseVoxelGrid([8, 8, 8]);
  g.set(4, 0, 4, 1);
  const pal = new Palette({ "1": "#ff0000" });
  return { src: gridSource(g, (i) => pal.hexOf(i)!) };
}

describe("renderView", () => {
  it("输出尺寸正确", () => {
    const { src } = singleRed();
    const r = renderView(src, { view: "iso", size: 64 });
    expect(r.w).toBe(64);
    expect(r.h).toBe(64);
    expect(r.rgba.length).toBe(64 * 64 * 4);
  });

  it("空网格：天空渐变上下不同", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const src = gridSource(g, () => "#000000");
    const r = renderView(src, { view: "front", size: 32, axes: false });
    const px = (x: number, y: number) => {
      const o = (y * 32 + x) * 4;
      return [r.rgba[o], r.rgba[o + 1], r.rgba[o + 2]];
    };
    const top = px(16, 4), bottom = px(16, 30);
    expect(top).not.toEqual(bottom);
  });

  it("单体素：中心像素接近红色", () => {
    const { src } = singleRed();
    const r = renderView(src, { view: "iso", size: 64 });
    const o = (32 * 64 + 32) * 4;
    const [cr, cg, cb] = [r.rgba[o], r.rgba[o + 1], r.rgba[o + 2]];
    expect(cr).toBeGreaterThan(120);
    expect(cr).toBeGreaterThan(cg + 40);
    expect(cr).toBeGreaterThan(cb + 40);
  });

  it("cutaway quarter 后中心像素不再是体素色", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) g.set(x, 0, z, 1);
    const pal = new Palette({ "1": "#00ff00" });
    const src = gridSource(g, (i) => pal.hexOf(i)!);
    const r = renderView(src, { view: "top", size: 64, cutaway: "quarter", axes: false });
    // 顶视：quarter 被切掉 → 对应角落露出天空/地面色而非绿色
    let green = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      if (r.rgba[i + 1] > 180 && r.rgba[i] < 100) green++;
    }
    expect(green).toBeGreaterThan(0);
    expect(green).toBeLessThan(64 * 64 / 2);
  });

  it("axes 默认开启：地面参照层有灰线像素", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const src = gridSource(g, () => "#000000");
    const r = renderView(src, { view: "iso", size: 64 });
    let gray = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      const [cr, cg, cb] = [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2]];
      if (Math.abs(cr - cg) < 6 && Math.abs(cg - cb) < 6 && cr > 90 && cr < 190) gray++;
    }
    expect(gray).toBeGreaterThan(10);
  });
});
