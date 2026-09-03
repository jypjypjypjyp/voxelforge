import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SparseVoxelGrid } from "../core/grid.js";
import { buildMesh } from "../core/export/mesh.js";
import { sampleVoxelColor } from "../core/color.js";
import { buildSignedField } from "../core/sdf.js";
import { surfaceNets, SURFACE_EMPTY_MSG } from "../core/surfaceNets.js";
import { buildTextureFromMesh } from "../core/export/texture.js";
import { exportGlb, verifyGlb } from "../core/export/glb.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startViewer(file: string, port = 4173): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const viewerHtml = fs.readFileSync(path.join(here, "index.html"), "utf8");
  const abs = path.resolve(file);

  let lastJson = "";
  const clients = new Set<http.ServerResponse>();

  const broadcast = () => {
    for (const res of clients) res.write(`event: model\ndata: ${lastJson}\n\n`);
  };

  const tryRead = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      try {
        const j = fs.readFileSync(abs, "utf8");
        JSON.parse(j); // 校验完整性
        if (j !== lastJson) { lastJson = j; broadcast(); }
        if (!watcher) armWatcher(); // 文件已就绪但 watcher 未挂上（如启动时文件尚未创建）：补挂
        return;
      } catch { await sleep(100); }
    }
  };

  // watch 父目录而非文件本身：目录 watcher 在文件 create/原子替换（rename 换 inode）后仍存活，
  // 且文件尚不存在时也能先挂上（fs.watch 对不存在的文件会 ENOENT）。
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  let watcher: fs.FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  const armWatcher = (): void => {
    if (watcher) return;
    try {
      watcher = fs.watch(dir, (_event, filename) => {
        if (filename && filename !== base) return;
        clearTimeout(timer);
        timer = setTimeout(tryRead, 150);
      });
      watcher.on("error", () => { watcher?.close(); watcher = undefined; });
    } catch { /* 目录暂不可 watch：下次 tryRead 时再试 */ }
  };
  armWatcher();
  await tryRead();

  const server = http.createServer((req, res) => {
    const [url, queryString] = (req.url ?? "/").split("?");
    if (url === "/healthz") { res.writeHead(200); res.end("ok"); return; }
    if (url === "/export.glb") {
      // 与 CLI 同一条导出管线（服务端执行），浏览器只负责下载
      if (!lastJson) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end("模型尚未加载");
        return;
      }
      try {
        const q = new URLSearchParams(queryString ?? "");
        const p = JSON.parse(lastJson);
        if (!p || !p.size || !Object.keys(p.voxels ?? {}).length) {
          res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
          res.end("模型为空");
          return;
        }
        const grid = SparseVoxelGrid.fromProject(p);
        const hexAt = (i: number) => p.palette[String(i)] ?? "#ff00ff";
        const mode = q.get("mode") === "mesh" ? "mesh" : "voxel";
        let mesh;
        let texture: ReturnType<typeof buildTextureFromMesh> | undefined;
        if (mode === "mesh") {
          const maxAxis = Math.max(...grid.size);
          const resolution = Math.min(256, Math.max(8, Number(q.get("res")) || maxAxis));
          const smooth = Math.min(8, Math.max(0, Number(q.get("smooth")) || 0));
          const { field } = buildSignedField(grid, { smooth });
          mesh = surfaceNets(field, resolution, (x, y, z) => sampleVoxelColor(grid, hexAt, x, y, z));
          if (mesh.indices.length === 0) throw new Error(SURFACE_EMPTY_MSG);
          if (q.get("texture") !== "0") texture = buildTextureFromMesh(mesh);
        } else {
          mesh = buildMesh(grid.coords(), hexAt);
          if (q.get("texture") === "1") texture = buildTextureFromMesh(mesh);
        }
        const buf = exportGlb(mesh, texture ? { texture: { png: texture.png, uvs: texture.uvs } } : undefined);
        verifyGlb(buf); // 结构闸门，与 CLI 一致
        const baseName = base.replace(/\.voxel\.json$/, "");
        res.writeHead(200, {
          "content-type": "model/gltf-binary",
          "content-disposition": `attachment; filename="${baseName}.${mode}.glb"`
        });
        res.end(buf);
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(String((e as Error).message ?? e));
      }
      return;
    }
    if (url === "/model") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(lastJson || "{}");
      return;
    }
    if (url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      // 初始状态由客户端 fetch("/model") 获取；/events 只推后续变更
      clients.add(res);
      const hb = setInterval(() => res.write(": hb\n\n"), 15000);
      req.on("close", () => { clearInterval(hb); clients.delete(res); });
      return;
    }
    if (url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(viewerHtml);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((res) => server.listen(port, "127.0.0.1", res));
  const addr = server.address();
  const realPort = typeof addr === "object" && addr ? addr.port : port;
  console.log(`voxelforge viewer: http://127.0.0.1:${realPort}  ←  ${abs}`);
  return {
    server, port: realPort,
    close: async () => {
      watcher?.close();
      clearInterval(timer);
      server.close();
      server.closeAllConnections?.(); // 打开的 SSE 连接会挂住 close，显式断开
    }
  };
}
