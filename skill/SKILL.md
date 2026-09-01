---
name: voxel-modeling
description: Use when 创建/修改 3D 体素模型、像素风建模、建城堡/建筑/载具/角色等体素作品，或用户提到 voxel、体素、像素建模、voxelforge 时。适用 voxelforge CLI 的任何会话。
---

# 体素建模（voxelforge）

像雕刻一样建模：**粗坯 → 细雕 → 精修 → critic 评审闭环**，每阶段有出口校验，critic PASS 才交付。

## 快速开始

```bash
VF=/Users/a1234/Library/CloudStorage/OneDrive-个人/Documents/鲸鱼娘/test/voxelforge/dist/cli.js
$VF tools                                  # 列出全部 18 个工具
$VF new /tmp/model.voxel.json --size 64    # 新建 64³ 项目（已存在加 --force）
$VF tool /tmp/model.voxel.json box '{"x0":8,"y0":0,"z0":8,"x1":55,"y1":7,"z1":55,"color":"#9aa0a6","hollow":true,"mirror":["x"]}'
$VF tool /tmp/model.voxel.json check
```

工具参数是 **JSON 对象**，颜色一律 `#RRGGBB`，引擎自动分配调色板。

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
| `render_png` | 渲染目检 | `{views:"multi", path:"/abs/out.png"}` 三视图合一；`highlight:[x0,y0,z0,x1,y1,z1]` 描红；输出路径字段是 **`path`** |

## 建模工作流（仿雕刻：粗坯 → 细雕 → 精修 → critic 评审闭环）

像雕刻一样工作：先用**大几何**定比例，再在坯上**增减**成型，最后精修，并进入 **critic 评审闭环**——独立子代理当评审，评审提出问题、主代理解决问题，1-N 轮直到达成最终效果。每个雕刻阶段有出口校验，critic PASS 才交付。

### 阶段 1｜粗坯（blocking）
- 只用**大的基础几何**（大方块、大圆柱、球）摆出轮廓与比例——此阶段只求"形与比例对"，**禁止写细节**（比例未定的细节全是返工）
- 对称体从第一步就上 `mirror`
- 出口校验：`check` + `render_png`（iso 单视图即可）确认比例；比例错了在这里返工最便宜

### 阶段 2｜细雕（carving）
- 在粗坯上**增减**：`erase` 挖门窗/掏空/削角，box/cylinder 加附属（檐、翼、烟囱、喷口），`line` 勾棱
- 每完成一个部件 `check` 一次；`slice_ascii` 抽查部件关键层

### 阶段 3｜精修（detail）
- `paint` 分区配色、`set` 点缀小体素（多数模型 < 20 色）
- 出口校验：`check` 各项**可解释**（floating/symmetry 见语义坑——合法悬挑不必归零）

### 阶段 4｜critic 评审闭环（交付前必做）
- critic = **独立子代理评审**：用你环境里的子代理/后台任务机制派一个 fresh-context 评审员（不带你的过程叙述），简报只给三样：模型文件路径、VF 路径、用户需求原文
- critic 自行跑 `check`/`slice_ascii`/`render_png`，对照需求找问题；**只读不改**；输出 `PASS` 或编号清单（每条：region + 严重度 + 建议）
- **闭环**：critic 提出问题清单 → 主代理逐条修复 → 重渲 → 再派新 critic 复审；**1-N 轮循环，直到 critic 输出 PASS（即达成最终效果）**
- 防空转守卫：若连续两轮问题不收敛（同类问题反复出现），停止循环，把分歧点原样汇报给用户裁决——不无限循环，也不带分歧交付
- ⚠️ critic 结果回传后必须**汇总最终汇报再结束回合**——禁止"派完评审就挂起等待"
- 环境不支持子代理时：降级为"换视角自审"——对照 render/check/slice 清单逐项过一遍，假装第一次看

### 阶段 5｜交付
- `render_png {views:"multi"}` 最终目检（有视觉能力时实际看图）
- `export {format:"glb"}`（自带结构闸门摘要）

**纪律**：粗坯期禁写细节；结构闸门通过 ≠ 视觉正确——宣称完成前必须 `render_png` 且（有视觉能力时）实际目检；critic 意见与你的判断冲突时，先重渲核实再反驳。

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
- `box/sphere/cylinder/line`：越界区域**静默裁剪**（CLI 语义）；script 沙箱内则**严格报错**
- `translate/paint/erase`：区域越界静默裁剪；translate 目标出界/被占的体素被丢弃
- 调色板上限 **255 色**；`paint` 的 `from` 色必须已存在（防幻影）
- `mirror` 映射 `v → size-1-v`；每次放置自动复制镜像位，无需手摆两边
- ⚠️ 工具 JSON 字段与 CLI 旗标不同名：`tool` 子命令里输出路径是 **`path`**（`out` 是 `render` 子命令的旗标，写在 JSON 里会被忽略）
- `script` 沙箱参数形态：`box/set` 收标量坐标，`erase/paint/translate` 收 region **数组**——传错会报错自动回滚
- 坐标/圆心须为**整数**；奇数宽物体放偶数网格时，模型自轴与 mirror 轴（`size/2-0.5`）差半格 → `check` 的 symmetry 出现系统性伪影（让 critic 绕模型自轴复核，或改用奇数网格）

## 实时 Viewer（可选）

```bash
$VF serve /tmp/model.voxel.json   # http://127.0.0.1:4173，SSE 实时跟随每次工具调用，相机保持
```
