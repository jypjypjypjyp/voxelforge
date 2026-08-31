# voxelforge 设计文档（2026-08-31）

## 定位

面向 LLM 的 3D 体素建模工具，**纯独立 npm 包**（TypeScript / Node ≥ 20 / pnpm / ESM，不集成 DSH）。LLM 通过 MCP 工具直接驾驶体素网格建模（LLM 主驾），人在浏览器 Web Viewer 里实时观看模型生长。核心数据模型为**直接网格操作**：状态 = 稀疏体素网格 + 调色板，工具直接改网格。

## 总体架构

```
voxelforge/
  package.json          exports: ./core ./mcp；bin: voxelforge / voxelforge-mcp
  src/
    core/               ← 零运行时依赖
      grid.ts           稀疏体素网格（键 "x,y,z" → 调色板号）
      ops.ts            box/sphere/cylinder/line/paint/erase/translate + hollow/mirror 参数
      project.ts        .voxel.json 读写 + schema 校验
      export/glb.ts     暴露面剔除网格化 + 顶点色 + 自写 GLB writer（node:zlib，内置结构闸门）
      export/vox.ts     MagicaVoxel .vox writer（SIZE/XYZI/RGBA chunks）
      export/png.ts     纯 JS DDA 体素光线投射 → PNG（无依赖，供 LLM 视觉自检）
    mcp/server.ts       @modelcontextprotocol/sdk stdio server
    viewer/             serve：node:http 静态托管 + fs.watch + SSE 推送；three.js 场景
    cli.ts              子命令 new / serve / export / render
  test/                 vitest
```

依赖：`@modelcontextprotocol/sdk`（zod 随附）、`three`（仅 viewer 打包用）；dev：typescript、tsdown、esbuild、vitest。core 零运行时依赖。

## 数据格式（`.voxel.json`）

```json
{
  "format": "voxelforge/1",
  "size": [64, 64, 64],
  "palette": { "1": "#8B4513", "2": "#DAA520" },
  "voxels": { "12,3,7": 1, "12,3,8": 2 }
}
```

- 稀疏映射，键 `"x,y,z"`（整数，0-based），值 = 调色板索引；LLM 可直读直写。
- 调色板索引上限 255（.vox 兼容）。
- **工具接口传十六进制色值**（如 `#8B4513`），引擎自动分配/复用调色板号，LLM 不管理索引。
- 坐标系：x 右、y 上、z 前（three.js 右手系一致）。

## MCP 工具集（15 个）

启动：`voxelforge-mcp <model.voxel.json>`（stdio；文件不存在则空项目待 `create_project`）。每次变更工具调用后**自动落盘**，返回计数摘要（如 `box: +48, total 1234, bounds 0..15`），LLM 无需读全网格即可校验。

| 工具 | 说明 |
|---|---|
| `create_project(size, force?)` | 新建项目；已存在须 force=true |
| `info()` | 尺寸/体素数/调色板/包围盒/每色计数 |
| `set(x,y,z,color)` / `unset(x,y,z)` | 单点写/擦 |
| `box(x0..z1, color, hollow?, mirror?)` | 长方体；hollow=只留壳 |
| `sphere(cx,cy,cz,r, color, hollow?, mirror?)` | 球 |
| `cylinder(cx,cy,cz, r, h, color, axis?, hollow?, mirror?)` | 圆柱：底面圆心 (cx,cy,cz)、半径 r、高 h，沿 axis 延伸（axis 默认 "y"，可 "x"/"z"） |
| `line(x0..z0, x1..z1, color, thickness?, mirror?)` | 线段（Bresenham，thickness=方形笔刷） |
| `paint(region?, from?, to)` | 换色（区域/全量、指定原色或全部） |
| `erase(region, shape?)` | 清除（box 区域 / all） |
| `translate(region, dx,dy,dz)` | 平移区域内体素（出界丢弃） |
| `undo()` | 撤销（内存快照栈，最近 20 步） |
| `sample(x,y,z)` | 读回单点颜色（LLM 验证用） |
| `export(format: "glb"\|"vox", path?)` | 导出文件，返回结构校验摘要 |
| `render_png(yaw, pitch, path?, size?, proj?)` | 渲染 PNG 供视觉自检（proj: ortho 默认/persp） |

- `mirror?: ["x"|"y"|"z"]`：对每个轴，镜像平面为该轴中点，坐标映射 `v → size[axis]-1-v`，每次放置同时在镜像位置复制一份（与原位重叠只写一次）。
- `region` 统一用扁平六元组 `[x0,y0,z0,x1,y1,z1]`（含两端，min>max 自动纠正）。
- `paint` 语义：`region` 省略 = 全网格；`from` 省略 = 区域内全部体素换色；`from` 给定（hex）= 仅替换该颜色；`to`（hex）为目标色。
- 所有工具入参经 zod 校验，越界坐标报错信息含合法范围。

## Web Viewer（实时监听）

`voxelforge serve model.voxel.json [--port 4173]`：

- `GET /` → 单文件 viewer.html（esbuild 预打包，three.js 内联，无 CDN、离线可用）
- `GET /model` → 当前 JSON；`GET /events` → SSE
- fs.watch（防抖 150ms）→ SSE 推新 JSON → three.js 场景 in-place 重建（合并几何 + 顶点色 + Lambert 材质 + OrbitControls + 网格地面），**相机保持不重置**
- HUD：体素数 / 尺寸 / 最后更新时间
- 事件同步处理：watch 回调排队防抖，读取失败重试 3 次（文件可能被写到一半）

## 关键决策

1. **自写 GLB writer**（~200 行）：GLB 布局知识已有沉淀（header 12B → JSON chunk pad 0x20 → BIN chunk pad 0x00），core 保持零依赖。体素网格化为"每个暴露面一个 quad"+ 顶点色（COLOR_0）+ 单哑光材质——PBR 金属发黑问题不存在（不用金属材质）。
2. **DDA 光线投射 PNG**：Amanatides & Woo 网格遍历，正交默认，方向光 + 邻居遮蔽简易 AO + 天空渐变背景；PNG 编码用 node:zlib deflate 自写（IHDR/IDAT/IEND + CRC32）。这是 LLM 视觉自检闭环的关键——渲染三视角 PNG 直接给视觉模型目检。
3. **复用已验证教训**：结构闸门 ≠ 视觉闸门；GLB 结构校验（魔数 0x6766746B / version=2 / chunk 布局）内置在 export 返回值里。
4. `.vox` 仅导出（SIZE/XYZI/RGBA），导入留 v1.1。
5. 不做声明式形状图/模板系统（YAGNI）；不做用户交互编辑（纯 viewer）。

## 测试（vitest）

- ops 单测：box/sphere/cylinder/line/mirror/hollow 的数量与边界断言
- project roundtrip：save → load 相等
- GLB 结构闸门：魔数/版本/chunk 布局/三角形计数
- .vox 结构校验：chunk 顺序与字节数
- PNG 冒烟：非空、尺寸正确、存在非背景像素
- MCP server 集成：直调 tool handlers，断言文件落盘与返回摘要

## CLI

```
voxelforge new <file> [--size 64] [--force]
voxelforge serve <file> [--port 4173]
voxelforge export <file> --glb out.glb | --vox out.vox
voxelforge render <file> --yaw 45 --pitch 30 [--out shot.png] [--size 512] [--proj ortho|persp]
voxelforge-mcp <file>            # stdio MCP server
```

## 验收标准

1. `pnpm install && pnpm build && pnpm test` 全绿。
2. MCP 客户端挂载 `voxelforge-mcp` 后，用工具建示例模型（小城堡），每步返回计数正确、文件实时落盘。
3. `serve` 打开浏览器，MCP 工具操作后 ≤ 1s 自动更新且相机不跳。
4. GLB 过结构闸门且可在通用 GLTF viewer 加载；PNG 三视角目检通过（用 read_image 实际验证）。
5. `render_png` 输出可独立用于 LLM 自检闭环（结构 → 视觉 → 精修）。

## 非目标（v1 明确不做）

- .vox 导入、声明式形状图、模板/stamp、人类交互编辑、多文件工程、动画、体素引擎级性能优化（>128³ 分块）。
