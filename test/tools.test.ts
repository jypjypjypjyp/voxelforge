import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ForgeSession } from "../src/mcp/tools.js";

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "vf-")), "m.voxel.json");
});

describe("ForgeSession", () => {
  it("listTools 18 个且无重名", () => {
    const s = new ForgeSession(file);
    const names = s.listTools().map(t => t.name);
    expect(names.length).toBe(18);
    expect(new Set(names).size).toBe(18);
  });

  it("create_project → info → box → 落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [16, 16, 16] });
    const r = await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 3, y1: 3, z1: 3, color: "#8b4513" });
    expect(r.content).toMatch(/box: \+64 -0, total 64/);
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(64);
    expect(raw.palette["1"]).toBe("#8b4513");
  });

  it("create_project 已存在拒绝，force 可覆盖", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await expect(s.handle("create_project", { size: [16, 16, 16] })).rejects.toThrow(/force/);
    await s.handle("create_project", { size: [16, 16, 16], force: true });
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(raw.size).toEqual([16, 16, 16]);
  });

  it("undo 恢复上一步并落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const r = await s.handle("undo", {});
    expect(r.content).toMatch(/undo: 回滚到 0 体素/);
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(0);
  });

  it("undo 空栈报错", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await expect(s.handle("undo", {})).rejects.toThrow(/无可撤销/);
  });

  it("info/sample/slice_ascii/check 返回结构", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("set", { x: 1, y: 0, z: 1, color: "#ff0000" });
    const info = (await s.handle("info", {})).content;
    expect(info).toContain("size: 8x8x8");
    expect(info).toContain("voxels: 1");
    const sample = (await s.handle("sample", { x: 1, y: 0, z: 1 })).content;
    expect(sample).toContain("#ff0000");
    const empty = (await s.handle("sample", { x: 0, y: 7, z: 0 })).content;
    expect(empty).toContain("空");
    const slice = (await s.handle("slice_ascii", { axis: "y", index: 0 })).content;
    expect(slice).toContain("A=");
    const chk = (await s.handle("check", {})).content;
    expect(chk).toContain("floating 0");
  });

  it("paint/erase/translate", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const p = await s.handle("paint", { region: [0, 0, 0, 1, 1, 1], color: "#00ff00" });
    expect(p.content).toMatch(/paint: 8/);
    const e = await s.handle("erase", { region: [0, 0, 0, 1, 1, 1] });
    expect(e.content).toMatch(/erase: -8/);
  });

  it("paint from 不在调色板报错且不落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const before = JSON.parse(await readFile(file, "utf8"));
    await expect(s.handle("paint", { region: [0, 0, 0, 1, 1, 1], from: "#00ff00", color: "#0000ff" })).rejects.toThrow(/不在调色板/);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(before); // 文件未变
  });

  it("paint 空区域不创建调色板条目", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    const r = await s.handle("paint", { region: [5, 5, 5, 7, 7, 7], color: "#123456" });
    expect(r.content).toContain("0 处换色");
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.palette).length).toBe(0);
  });

  it("set 越界失败：无 stale undo、无幻影调色板落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    await expect(s.handle("set", { x: 99, y: 0, z: 0, color: "#00ff00" })).rejects.toThrow(/越界/);
    // undo 恢复到最近一次真实变更（box 之前的状态），而非空转死槽
    await s.handle("undo", {});
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(0); // undo 到 create_project 后
    expect(Object.keys(raw.palette).length).toBe(0); // 无幻影 #00ff00 落盘
  });

  it("box 非法 hex 失败：无 stale undo", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    await expect(s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "not-a-color" })).rejects.toThrow();
    await s.handle("undo", {});
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(0);
  });

  it("export glb/vox 落盘且摘要含结构校验", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const g = await s.handle("export", { format: "glb" });
    // 2x2x2 box 表面积 = 24 quad = 48 tris（plan 内联勘误：不是 tris 12）
    expect(g.content).toMatch(/GLB 已导出.*48 tris/);
    const v = await s.handle("export", { format: "vox" });
    expect(v.content).toMatch(/VOX 已导出/);
  });

  it("render_png 默认路径落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const r = await s.handle("render_png", { size: 64 });
    expect(r.content).toMatch(/PNG 已渲染.*\.iso\.png/);
  });

  it("script 正常与失败", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [16, 16, 16] });
    const ok = await s.handle("script", { code: `for (let i=0;i<3;i++) box(i*4,0,0,i*4+1,2,1,"#ff0000"); log("ok")` });
    // box 闭区间语义：每盒 2×3×2=12 体素 ×3 = 36（brief 里 +18 系算术勘误，同 /tris 12/ → 48 tris）
    expect(ok.content).toMatch(/script: \+36/);
    expect(ok.content).toContain("ok");
    await expect(s.handle("script", { code: "while(true){}" })).rejects.toThrow(/已回滚/);
  });

  it("镜像与 hollow 参数透传", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000", mirror: ["x"] });
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(16);
  });

  it("未初始化文件时默认 64³ 空项目", async () => {
    const s = new ForgeSession(file);
    await s.init();
    const info = (await s.handle("info", {})).content;
    expect(info).toContain("size: 64x64x64");
    expect(info).toContain("voxels: 0");
  });
});
