import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
        return;
      } catch { await sleep(100); }
    }
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    fs.watch(abs, () => {
      clearTimeout(timer);
      timer = setTimeout(tryRead, 150);
    });
  } catch { /* 文件尚不存在：等待 create_project */ }
  await tryRead();

  const server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/healthz") { res.writeHead(200); res.end("ok"); return; }
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
      clearInterval(timer);
      server.close();
      server.closeAllConnections?.(); // 打开的 SSE 连接会挂住 close，显式断开
    }
  };
}
