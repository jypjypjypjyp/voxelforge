import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startViewer } from "../src/viewer/serve.js";
import { verifyGlb } from "../src/core/export/glb.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const getBuf = (port: number, p: string) => new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((res) => {
  http.get({ host: "127.0.0.1", port, path: p }, (r) => {
    const chunks: Buffer[] = [];
    r.on("data", (c) => chunks.push(c));
    r.on("end", () => res({ status: r.statusCode!, body: Buffer.concat(chunks), headers: r.headers }));
  });
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

  it("/export.glb：voxel 与 mesh(texture) 两模式过结构闸门", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "tank.voxel.json");
    writeFileSync(file, JSON.stringify({
      format: "voxelforge/1", size: [16, 16, 16], palette: { "1": "#ff0000", "2": "#00ff00" },
      // 2×2×2 实心块：保证存在 8 邻域全实心的节点（Surface Nets 严格负节点的最小配置）
      voxels: { "4,4,4": 1, "5,4,4": 2, "4,5,4": 1, "5,5,4": 2, "4,4,5": 1, "5,4,5": 2, "4,5,5": 1, "5,5,5": 2 }
    }));
    const v = await startViewer(file, 0);
    cleanups.push(v.close);

    const voxel = await getBuf(v.port, "/export.glb?mode=voxel");
    expect(voxel.status).toBe(200);
    expect(voxel.headers["content-type"]).toBe("model/gltf-binary");
    expect(voxel.headers["content-disposition"]).toContain("tank.voxel.glb");
    const vv = verifyGlb(voxel.body);
    expect(vv.tris).toBeGreaterThan(0);

    const mesh = await getBuf(v.port, "/export.glb?mode=mesh&res=16&smooth=0&texture=1");
    expect(mesh.status).toBe(200);
    const vm = verifyGlb(mesh.body);
    expect(vm.tris).toBeGreaterThan(0);
    expect(((vm.json.textures as unknown[]) ?? []).length).toBe(1);
    expect((vm.json.meshes as Array<Record<string, unknown>>)[0].primitives[0].attributes.TEXCOORD_0).toBeDefined();
  });

  it("/export.glb 空模型返回 503", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "empty.voxel.json");
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: {}, voxels: {} }));
    const v = await startViewer(file, 0);
    cleanups.push(v.close);
    const r = await getBuf(v.port, "/export.glb?mode=voxel");
    expect(r.status).toBe(503);
  });

  it("/export.glb 薄模型 mesh 模式 500（与 CLI sdf_mesh 同源守卫）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "thin.voxel.json");
    writeFileSync(file, JSON.stringify({
      format: "voxelforge/1", size: [16, 16, 16], palette: { "1": "#ff0000", "2": "#00ff00" },
      voxels: { "4,4,4": 1, "5,4,4": 2, "6,4,4": 1 }
    }));
    const v = await startViewer(file, 0);
    cleanups.push(v.close);
    const r = await getBuf(v.port, "/export.glb?mode=mesh&res=16&smooth=0&texture=1");
    expect(r.status).toBe(500);
    expect(r.body.toString()).toMatch(/未捕捉到任何面/);
  });
});
