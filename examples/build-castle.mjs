// 城堡示例：voxelforge LLM 建模流程演示（骨架 → check → 细节 → render 目检）
// 兼做 few-shot 范例：直接用 ForgeSession + 工具名/参数，与 MCP 工具一一对应。
import { ForgeSession } from "../dist/tools.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "castle.voxel.json");
const s = new ForgeSession(file);
await s.init();

console.log(await s.handle("create_project", { size: [64, 40, 64], force: true }));
console.log(await s.handle("script", { code: `
  const STONE = "#9aa0a6", DARK = "#7d8288", WOOD = "#8B4513", DOOR = "#5b3a1e", ROOF = "#a63d2f";
  // 地基
  box(4, 0, 4, 59, 1, 59, STONE);
  // 主楼（壳）
  box(24, 2, 24, 39, 18, 39, STONE, { hollow: true });
  // 主楼城垛
  for (let i = 24; i <= 39; i += 3) {
    set(i, 19, 24, DARK); set(i, 19, 39, DARK);
    set(24, 19, i, DARK); set(39, 19, i, DARK);
  }
  // 四角塔（圆柱壳 + 塔尖）
  for (const [tx, tz] of [[10, 10], [53, 10], [10, 53], [53, 53]]) {
    cylinder(tx, 2, tz, 4, 24, DARK, { hollow: true });
    cylinder(tx, 26, tz, 2, 4, ROOF);
    set(tx, 30, tz, ROOF);
  }
  // 城门（南面）
  box(29, 2, 24, 34, 7, 24, DOOR);
  box(31, 8, 24, 32, 8, 24, DOOR);
  // 门前步道
  box(30, 1, 8, 33, 1, 23, WOOD);
` }));
console.log(await s.handle("check", {}));
console.log(await s.handle("export", { format: "glb" }));
console.log(await s.handle("render_png", { views: "multi", size: 384 }));
