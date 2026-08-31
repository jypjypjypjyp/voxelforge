import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startViewer } from "../src/viewer/serve.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("startViewer", () => {
  it("/model 返回 JSON，/healthz ok", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: { "1": "#ff0000" }, voxels: { "0,0,0": 1 } }));
    const v = await startViewer(file, 0);
    cleanups.push(v.close);
    const get = (p: string) => new Promise<{ status: number; body: string }>((res) => {
      http.get({ host: "127.0.0.1", port: v.port, path: p }, (r) => {
        let b = "";
        r.on("data", (c) => (b += c));
        r.on("end", () => res({ status: r.statusCode!, body: b }));
      });
    });
    expect((await get("/healthz")).body).toBe("ok");
    const model = await get("/model");
    expect(model.status).toBe(200);
    expect(JSON.parse(model.body).voxels["0,0,0"]).toBe(1);
  });

  it("文件变化 → SSE 推送新模型", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: {}, voxels: {} }));
    const v = await startViewer(file, 0);
    cleanups.push(v.close);
    const received = new Promise<string>((res) => {
      const req = http.get({ host: "127.0.0.1", port: v.port, path: "/events" }, (r) => {
        let buf = "";
        r.on("data", (c) => {
          buf += c;
          if (buf.includes("event: model")) {
            const line = buf.split("\n").find(l => l.startsWith("data:"))!;
            res(line.slice(5).trim());
          }
        });
      });
      cleanups.push(async () => req.destroy());
    });
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: { "1": "#ff0000" }, voxels: { "1,1,1": 1 } }));
    const data = JSON.parse(await Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error("SSE 超时")), 3000))]));
    expect(data.voxels["1,1,1"]).toBe(1);
  });

  it("文件后创建也能收到推送（watcher 自愈）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    // 注意：不预写文件，viewer 启动时文件不存在
    const v = await startViewer(file, 0);
    cleanups.push(v.close);
    const received = new Promise<string>((res) => {
      const req = http.get({ host: "127.0.0.1", port: v.port, path: "/events" }, (r) => {
        let buf = "";
        r.on("data", (c) => {
          buf += c;
          if (buf.includes("event: model")) {
            const line = buf.split("\n").find(l => l.startsWith("data:"))!;
            res(line.slice(5).trim());
          }
        });
      });
      cleanups.push(async () => req.destroy());
    });
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: { "1": "#00ff00" }, voxels: { "2,2,2": 1 } }));
    const data = JSON.parse(await Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error("SSE 超时")), 3000))]));
    expect(data.voxels["2,2,2"]).toBe(1);
  });
});
