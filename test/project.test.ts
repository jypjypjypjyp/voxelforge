import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { validateProject, emptyProject, loadForge, saveForge } from "../src/core/project.js";

describe("validateProject", () => {
  it("合法项目通过", () => {
    const p = emptyProject([8, 8, 8]);
    p.palette["1"] = "#ff0000";
    p.voxels["0,0,0"] = 1;
    expect(validateProject(p)).toEqual(p);
  });
  it("坏 format / size / voxels 键 / 越界 / 索引范围各自抛错", () => {
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), format: "x" })).toThrow(/format/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), size: [8, 8] })).toThrow(/size/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), voxels: { "0,0": 1 } })).toThrow(/x,y,z/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), voxels: { "9,0,0": 1 } })).toThrow(/越界/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), voxels: { "0,0,0": 0 } })).toThrow(/1\.\.255/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), palette: { "0": "#ff0000" } })).toThrow(/1\.\.255/);
  });
});

describe("saveForge/loadForge roundtrip", () => {
  it("保存后加载字节一致", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    const g = new SparseVoxelGrid([8, 8, 8]);
    const pal = new Palette();
    g.set(1, 2, 3, pal.indexOf("#8b4513"));
    g.set(4, 5, 6, pal.indexOf("#daa520"));
    await saveForge(file, g, pal);
    const { grid, palette } = await loadForge(file);
    expect(grid.count).toBe(2);
    expect(grid.get(1, 2, 3)).toBe(1);
    expect(palette.hexOf(2)).toBe("#daa520");
    // 二次保存字节一致（确定性）
    await saveForge(file, grid, palette);
    const again = await loadForge(file);
    expect(again.grid.count).toBe(2);
  });

  it("loadForge 对坏文件抛错", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "bad.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{ not json");
    await expect(loadForge(file)).rejects.toThrow();
  });
});
