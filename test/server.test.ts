import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { ForgeSession } from "../src/mcp/tools.js";

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "vf-")), "m.voxel.json");
});

async function connect(session: ForgeSession) {
  const server = createMcpServer(session);
  const client = new Client({ name: "test", version: "0.0.1" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
  return client;
}

describe("MCP server", () => {
  it("listTools 返回 18 个工具", async () => {
    const session = new ForgeSession(file);
    await session.init();
    const client = await connect(session);
    const { tools } = await client.listTools();
    expect(tools.length).toBe(18);
    expect(tools.map(t => t.name)).toContain("box");
    expect(tools.map(t => t.name)).toContain("script");
  });

  it("callTool box 成功返回摘要", async () => {
    const session = new ForgeSession(file);
    await session.init();
    await session.handle("create_project", { size: [8, 8, 8] });
    const client = await connect(session);
    const r = await client.callTool({ name: "box", arguments: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" } });
    expect((r.content as Array<{ text: string }>)[0].text).toMatch(/box: \+8/);
    expect(r.isError).toBeUndefined();
  });

  it("callTool 错误包装为 isError", async () => {
    // 勘误（brief 原文 box x1:999）：placeBox 对越界区域裁剪不抛错（Task 6 语义，ops.test.ts:30），
    // 改用 set 越界坐标——走 grid.set 直接抛「坐标越界」（Task 2 边界校验）。
    const session = new ForgeSession(file);
    await session.init();
    const client = await connect(session);
    const r = await client.callTool({ name: "set", arguments: { x: 999, y: 0, z: 0, color: "#ff0000" } });
    expect(r.isError).toBe(true);
    expect((r.content as Array<{ text: string }>)[0].text).toContain("越界");
  });
});
