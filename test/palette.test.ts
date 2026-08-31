import { describe, it, expect } from "vitest";
import { Palette, hexToRgb255 } from "../src/core/palette.js";

describe("Palette", () => {
  it("normalize 大小写与缺 #", () => {
    expect(Palette.normalize("#FFAA00")).toBe("#ffaa00");
    expect(Palette.normalize("ffaa00")).toBe("#ffaa00");
    expect(() => Palette.normalize("red")).toThrow(/#RRGGBB/);
    expect(() => Palette.normalize("#12345")).toThrow();
  });

  it("indexOf 自动分配并复用", () => {
    const p = new Palette();
    expect(p.indexOf("#ff0000")).toBe(1);
    expect(p.indexOf("#00ff00")).toBe(2);
    expect(p.indexOf("#FF0000")).toBe(1); // 复用（大小写不敏感）
    expect(p.hexOf(2)).toBe("#00ff00");
    expect(p.size).toBe(2);
  });

  it("从已有项目恢复稀疏索引", () => {
    const p = new Palette({ "3": "#ff0000", "1": "#00ff00" });
    expect(p.hexOf(3)).toBe("#ff0000");
    expect(p.hexOf(1)).toBe("#00ff00");
    expect(p.indexOf("#ff0000")).toBe(3); // 已存在则复用原号
  });

  it("255 色上限", () => {
    const p = new Palette();
    for (let i = 0; i < 255; i++) p.indexOf(`#${i.toString(16).padStart(6, "0")}`);
    expect(() => p.indexOf("#ffffff")).toThrow(/255/);
  });

  it("snapshot/restore", () => {
    const p = new Palette();
    p.indexOf("#ff0000");
    const snap = p.snapshot();
    p.indexOf("#00ff00");
    p.restore(snap);
    expect(p.size).toBe(1);
    expect(p.indexOf("#00ff00")).toBe(2);
  });

  it("hexToRgb255", () => {
    expect(hexToRgb255("#8b4513")).toEqual([139, 69, 19]);
  });
});
