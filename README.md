# voxelforge

LLM-native 3D 体素建模：MCP server + web viewer。

## 快速开始

```bash
pnpm install && pnpm build
node dist/cli.js new model.voxel.json --size 64
node dist/cli.js serve model.voxel.json   # 浏览器打开 http://127.0.0.1:4173
```

端到端示例（骨架 → check → 细节 → render 目检）：

```bash
node examples/build-castle.mjs
# 产出 examples/castle.voxel.json / castle.glb / castle.multi.png
```

## 接入 MCP 客户端（如 Claude Desktop / 任意支持 MCP 的宿主）

```json
{ "mcpServers": { "voxelforge": { "command": "node", "args": ["/绝对路径/dist/mcp.js", "/绝对路径/model.voxel.json"] } } }
```

然后对 LLM 说「建一座城堡」即可；工具操作实时反映在 viewer（SSE 推送，相机保持）。

## CLI

| 命令 | 说明 |
|---|---|
| `voxelforge new <file> [--size 64] [--force]` | 新建项目 |
| `voxelforge serve <file> [--port 4173]` | 启动实时 viewer |
| `voxelforge export <file> --glb out.glb \| --vox out.vox` | 导出 |
| `voxelforge render <file> [--multi] [--cutaway q] [--view iso]` | 渲染 PNG |
| `voxelforge-mcp <file>` | stdio MCP server |

render 还支持 `--yaw/--pitch/--out/--size/--proj/--axes=false` 等参数，详见 `node dist/cli.js` 用法输出。

## 数据格式

`.voxel.json`：`{ format, size, palette: {"1":"#rrggbb"}, voxels: {"x,y,z": 色号} }`（LLM 可直读直写）。

## LLM 自检闭环

`check()` → `slice_ascii` 定位 → `render_png(views:"multi")` 目检 → `highlight` 区域修改 → `undo()` 兜底 → `export` 交付。
详见 `docs/superpowers/specs/2026-08-31-voxelforge-design.md`。

## 注意事项

- **script() 沙箱严格界内校验**：沙箱内所有坐标（含 box/sphere/cylinder/line 的包围范围、translate 目标）必须完全落在项目尺寸内，任一点越界即整体报错并自动回滚，不会留下半成品。写循环批量生成前先核对边界。
- **render_png 坐标参照层默认策略**：单视图（`view`/`yaw+pitch`）默认开启地面参照层（红 X 轴 / 蓝 Z 轴刻度），`views:"multi"` 合成图默认关闭（避免轴红线与 highlight 红框语义冲突）；两种情况都可用 `axes` 参数显式覆盖。
- **调色板 255 色上限 + paint 防幻影**：调色板最多 255 色，写满后需复用已有颜色或用 paint 换色；`paint` 的 `from` 参数是防幻影过滤——指定的 `from` 颜色若不在调色板中会直接报错（而不是静默零换色），省略 `from` 则对区域内全部换色。
