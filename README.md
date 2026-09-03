# voxelforge

LLM-native 3D 体素建模：skill + CLI + web viewer。

## 安装

```bash
npm i -g voxelforge        # 全局安装（Node ≥20）；升级同命令
voxelforge --help          # 或免装临时用: npx voxelforge
```

## 快速开始（源码开发）

```bash
pnpm install && pnpm build
node dist/cli.js new model.voxel.json --size 64
node dist/cli.js serve model.voxel.json   # 浏览器打开 http://127.0.0.1:4173
```

端到端示例（骨架 → check → 细节 → render 目检）：

```bash
node examples/build-castle.mjs
# 产出 examples/castle.voxel.json / castle.glb / castle.multi.png / castle.cutaway.png
```


## CLI

| 命令 | 说明 |
|---|---|
| `voxelforge new <file> [--size 64] [--force]` | 新建项目 |
| `voxelforge serve <file> [--port 4173]` | 启动实时 viewer |
| `voxelforge export <file> --glb out.glb \| --vox out.vox` | 导出 |
| `voxelforge tools` / `voxelforge tool <file> <name> '<json>'` | 直调 19 个建模工具 |
| `voxelforge render <file> [--multi] [--cutaway q] [--view iso]` | 渲染 PNG |
| `voxelforge remesh <file> [--res N] [--smooth S] [--color #hex] --out out.glb` | 体素→SDF→Surface Nets→平滑网格 GLB |

render 还支持 `--yaw/--pitch/--out/--size/--proj/--axes=false` 等参数，详见 `node dist/cli.js` 用法输出。

## 数据格式

`.voxel.json`：`{ format, size, palette: {"1":"#rrggbb"}, voxels: {"x,y,z": 色号} }`（LLM 可直读直写）。

`sdf_mesh` 工具可从体素网格重建连续平滑网格（复用 core 的 `computeSignedDistance`/`surfaceNets`）。

## Skill 形态（推荐日常入口）

项目自带 agent skill（`skill/SKILL.md`，含 19 工具 CLI 速查 + 建模闭环方法论 + 语义坑），安装：

```bash
mkdir -p ~/.agents/skills/voxel-modeling && cp skill/SKILL.md ~/.agents/skills/voxel-modeling/
```

skill 教模型用 `voxelforge tools` 发现能力、`voxelforge tool <file> <name> '<json>'` 直调任一工具（zod 校验）。

## LLM 自检闭环

`check()` → `slice_ascii` 定位 → `render_png(views:"multi")` 目检 → `highlight` 区域修改 → `undo()` 兜底 → `export` 交付。
详见 `docs/superpowers/specs/2026-08-31-voxelforge-design.md`。

## 注意事项

- **script() 沙箱**：`box/sphere/cylinder/line` 区域要求**完全在界内**（越界整体报错并自动回滚），`set` 越界同样报错；`translate/paint/erase` 沿用区域操作语义（源区域越界静默裁剪，translate 目标出界/被占的体素被丢弃），`unset` 越界为无操作。
- **render_png 坐标参照层默认策略**：单视图（`view`/`yaw+pitch`）默认开启地面参照层（红 X 轴 / 蓝 Z 轴刻度），`views:"multi"` 合成图默认关闭（避免轴红线与 highlight 红框语义冲突）；两种情况都可用 `axes` 参数显式覆盖。
- **调色板 255 色上限 + paint 防幻影**：调色板最多 255 色，写满后需复用已有颜色或用 paint 换色；`paint` 的 `from` 参数是防幻影过滤——指定的 `from` 颜色若不在调色板中会直接报错（而不是静默零换色），省略 `from` 则对区域内全部换色。

## License

MIT © 2026 yupeng.jia —— 详见 [LICENSE](./LICENSE)。
