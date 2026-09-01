---
name: voxel-modeling
description: Use when 创建/修改 3D 体素模型、像素风建模、建城堡/建筑/载具/角色等体素作品，或用户提到 voxel、体素、像素建模、voxelforge、mcp__voxel 时。适用 voxelforge CLI 与 mcp__voxel__* 工具的任何会话。
---

# 体素建模（voxelforge）

用体素 CLI 建模：先定骨架再补细节，**每完成一个大结构就 `check`，交付前必 `render` 目检**。

## 快速开始

```bash
VF=/Users/a1234/Library/CloudStorage/OneDrive-个人/Documents/鲸鱼娘/test/voxelforge/dist/cli.js
$VF tools                                  # 列出全部 18 个工具
$VF new /tmp/model.voxel.json --size 64    # 新建 64³ 项目（已存在加 --force）
$VF tool /tmp/model.voxel.json box '{"x0":8,"y0":0,"z1":8,"z1":8,"x1":55,"y1":7,"color":"#9aa0a6","hollow":true,"mirror":["x"]}'
$VF tool /tmp/model.voxel.json check
```

工具参数是 **JSON 对象**，与 MCP 形态完全一致；颜色一律 `#RRGGBB`，引擎自动分配调色板。

若会话里有 `mcp__voxel__*` 工具（MCP 已开启时），优先直接用它们——参数形态与下述 JSON 相同。

## 18 工具速查（`$VF tools` 可随时列出）

| 命令 | 用途 | 要点 |
|---|---|---|
| `create_project` | 新建 | `{size:[64,64,64]}`；已存在须 `force:true` |
| `info` | 概览 | 尺寸/体素数/调色板/包围盒/每色计数 |
| `box` / `sphere` / `cylinder` / `line` | 几何体 | 均支持 `hollow:true`（只留壳）与 `mirror:["x"\|"y"\|"z"]`（对称一次成型） |
| `set` / `unset` | 单点 | |
| `paint` | 换色 | `region` 省略=全网格；`from` 省略=区域内全部 |
| `erase` / `translate` | 擦除/平移 | erase 的 region 可传 `"all"` |
| `undo` | 撤销 | 内存快照栈 20 步 |
| `sample` | 读单点 | 校验某处颜色 |
| `slice_ascii` | 层字符画 | `{axis:"y",index:3}`——空间定位最便宜的手段 |
| `check` | 自诊断 | 悬空/连通分量/对称差/每轴 occupancy 剖面 |
| `script` | 批量生成 | vm 沙箱跑 JS（见下） |
| `export` | 导出 | `{format:"glb"}` 或 `"vox"` |
| `render_png` | 渲染目检 | `{views:"multi"}` 三视图合一；`highlight:[x0,y0,z0,x1,y1,z1]` 描红 |

## 建模工作流

1. `create_project` 定尺寸（想好比例再定，改尺寸要重建）
2. **骨架**：box/cylinder 摆大结构；对称物体务必用 `mirror` 一次成型，别手摆两边
3. `check`：看 `floating`（悬空）、`components`（应为 1，除非有意分离）、`symmetry`、profile 空层
4. 细节与配色（多数体素 < 20 色，够用）
5. `slice_ascii` 抽查 1-2 个关键层，确认结构位置
6. `render_png {views:"multi"}` 目检；发现局部问题用 `highlight:[region]` 重渲确认坐标，再定点修改
7. `export {format:"glb"}` 交付（自带结构闸门摘要）

**纪律**：结构闸门通过 ≠ 视觉正确——宣称完成前必须 `render_png` 且（有视觉能力时）实际目检。

## script() 批量生成

重复结构/数学形状用脚本一次成型（比逐个工具调用省轮次）：

```bash
$VF tool model.voxel.json script '{"code":"for (let i=0;i<10;i++) box(i*6,0,0,i*6+2,5,2,\"#8B4513\")"}'
```

- 沙箱 API：`box/sphere/cylinder/line/set/unset/paint/erase/translate/palette(hex)/size/log`
- 同步代码，默认 5s 超时；任何错误**自动回滚**到执行前
- ⚠️ `box/sphere/cylinder/line` 的区域要求**完全在界内**，越界即报错回滚

## 语义坑（必读，基线实测的试错点）

- region 六元组 `[x0,y0,z0,x1,y1,z1]` **含两端**（0..7 = 8 格）；min>max 自动纠正
- 朝向约定：**z 小的一侧 = front 视图正向**（"南墙"= min-z 侧）；x 左右、y 上下
- `check` 的 `floating`：正下方+四侧下方共 5 位全空且 y>0 才计——空心房间顶板、平顶出檐**天然大量 floating，属正常形态**，不是错误
- `symmetry.y` 豁免贴地层（y=0）——接地建筑 y 向不对称是正常的；看 x/z 的对称差
- 渲染光照下浅色偏灰是着色效果，非建模问题
- `box/sphere/cylinder/line`：越界区域**静默裁剪**（MCP/CLI 同语义）；script 沙箱内则**严格报错**
- `translate/paint/erase`：区域越界静默裁剪；translate 目标出界/被占的体素被丢弃
- 调色板上限 **255 色**；`paint` 的 `from` 色必须已存在（防幻影）
- `mirror` 映射 `v → size-1-v`；每次放置自动复制镜像位，无需手摆两边

## 实时 Viewer（可选）

```bash
$VF serve /tmp/model.voxel.json   # http://127.0.0.1:4173，SSE 实时跟随每次工具调用，相机保持
```
