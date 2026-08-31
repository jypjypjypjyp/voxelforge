import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgeSession } from "../src/mcp/tools.js";

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

  // serve 的 HTTP 行为已由 test/viewer.test.ts 覆盖；cli 侧只做 help 冒烟
  it("help", () => {
    if (skip) return;
    expect(run(["--help"]).status).toBe(0);
  });
});
