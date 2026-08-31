import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ForgeSession, TOOLS } from "./tools.js";

export const INSTRUCTIONS = `voxelforge 体素建模方法论：
1) create_project 定尺寸 → 2) 骨架优先（box/cylinder 摆大结构，对称结构用 mirror:["x"] 一次成型）→ 3) check() 看悬空/连通/对称/空层 → 4) 细节与配色（hex #RRGGBB）→ 5) slice_ascii 抽查关键层 → 6) render_png(views:"multi") 目检，发现问题后用 highlight 回传区域修改 → 7) export glb/vox 交付。
批量重复结构一律用 script()（循环/数学/噪声），别逐点 set。
所有工具返回计数摘要，无需读全量网格。`;

export function createMcpServer(session: ForgeSession): McpServer {
  const server = new McpServer({ name: "voxelforge", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  for (const def of TOOLS) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.schema }, async (args: Record<string, unknown>) => {
      try {
        const { content } = await session.handle(def.name, args);
        return { content: [{ type: "text", text: content }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
      }
    });
  }
  return server;
}

export async function runMcpServer(file: string): Promise<void> {
  const session = new ForgeSession(file);
  await session.init();
  const server = createMcpServer(session);
  await server.connect(new StdioServerTransport());
}
