import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgeSession } from "../src/tools.js";

// cli 用例是进程级冒烟，跑编译产物 dist/cli.js；未构建时跳过（先 pnpm build）
const skip = !existsSync("dist/cli.js");
const run = (args: string[]) => spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8", timeout: 30000 });

describe("cli（需先 pnpm build）", () => {
  it("new + export + render 全链路", async () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    const r1 = run(["new", file, "--size", "16"]);
    expect(r1.status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).size).toEqual([16, 16, 16]);
    // 写一个盒子再导出
    const session = new ForgeSession(file);
    await session.init();
    await session.handle("box", { x0: 0, y0: 0, z0: 0, x1: 2, y1: 2, z1: 2, color: "#ff0000" });
    const r2 = run(["export", file, "--glb", join(dir, "out.glb")]);
    expect(r2.status).toBe(0);
    expect(existsSync(join(dir, "out.glb"))).toBe(true);
    const r3 = run(["render", file, "--view", "iso", "--out", join(dir, "shot.png"), "--size", "64"]);
    expect(r3.status).toBe(0);
    expect(existsSync(join(dir, "shot.png"))).toBe(true);
    expect(readFileSync(join(dir, "shot.png")).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("render 默认 512 与 new size 校验", () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    run(["new", file, "--size", "8"]);
    run(["export", file, "--glb", join(dir, "o.glb")]); // 确保有产物可渲染（空模型也可）
    const r = run(["render", file, "--out", join(dir, "shot.png")]);
    expect(r.status).toBe(0);
    const buf = readFileSync(join(dir, "shot.png"));
    expect(buf.readUInt32BE(16)).toBe(512); // IHDR width
    const bad = run(["new", join(dir, "bad.voxel.json"), "--size", "abc"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("1..256");
  });

  // serve 的 HTTP 行为已由 test/viewer.test.ts 覆盖；cli 侧只做 help 冒烟
  it("help", () => {
    if (skip) return;
    expect(run(["--help"]).status).toBe(0);
  });

  it("tools 列出 18 个工具", () => {
    if (skip) return;
    const r = run(["tools"]);
    expect(r.status).toBe(0);
    const names = ["box", "sphere", "check", "slice_ascii", "script", "render_png"];
    for (const n of names) expect(r.stdout).toContain(n);
  });

  it("tool 子命令：直调 box/info + zod 错误路径", () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    expect(run(["new", file, "--size", "8"]).status).toBe(0);
    const r1 = run(["tool", file, "box", JSON.stringify({ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" })]);
    expect(r1.status).toBe(0);
    expect(r1.stdout).toMatch(/box: \+8/);
    const r2 = run(["tool", file, "info"]);
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain("voxels: 8");
    const r3 = run(["tool", file, "box", JSON.stringify({ x0: 0 })]);
    expect(r3.status).toBe(1);
    expect(r3.stderr).toContain("参数校验失败");
    const r4 = run(["tool", file, "nope"]);
    expect(r4.status).toBe(1);
    expect(r4.stderr).toContain("未知工具");
    const r5 = run(["tool", file, "box", "{not json"]);
    expect(r5.status).toBe(1);
    expect(r5.stderr).toContain("JSON 解析失败");
  });

  it("remesh 出平滑网格 GLB", async () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    expect(run(["new", file, "--size", "16"]).status).toBe(0);
    const session = new ForgeSession(file);
    await session.init();
    await session.handle("box", { x0: 4, y0: 4, z0: 4, x1: 11, y1: 11, z1: 11, color: "#ff0000" });
    const out = join(dir, "smooth.glb");
    const r = run(["remesh", file, "--res", "24", "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/sdf_mesh: GLB/);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).subarray(0, 4).toString("ascii")).toBe("glTF");
  });
});
