# voxelforge 体素 → SDF → 多分辨率 Surface Nets → mesh 设计文档（2026-09-01）

## 目标

给 voxelforge 新增一条**平滑重网格化**管线：把方块感体素模型（`.voxel.json`）转成连续的**有符号距离场(SDF)**，再用 **Surface Nets** 在**可调网格分辨率**下重建，输出圆润的有机网格 GLB。

核心卖点：**同一 SDF，不同网格分辨率出不同细节度的 mesh**——低分辨率减面、高分辨率平滑精细。分辨率通过每次调用传入（单档）；要多分辨率就多次调用（v1 明确只做单档）。同一管线同时供 CLI/tool（导出 GLB）与 **web viewer（实时可视化 + 分辨率滑杆探索）**。

## 背景与现状

- 现有唯一的网格出口是 `buildMesh`（体素暴露面剔除）→ **方块状** GLB。
- 本项目无连续曲面重建能力；本能力为**下游导出/造型**路径，不写回体素网格。

## 总体架构（新增，core 零运行时依赖）

```
voxelforge/src/core/
  sdf.ts          computeSignedDistance(voxels, size, {smooth?}): Float32Array
                   8SSEDT 精确欧氏距离变换；按占用定符号（占用=负，空=正）
                   得到原生分辨率有符号距离场（cell 中心采样）
  surfaceNets.ts  surfaceNets(field, nativeSize, outRes, colorAt): MeshData
                   在 outRes³ 网格上三线性插值采样 SDF
                   检测 iso=0 边交点；每 cell 1 顶点 = 边交点均值；连 quad
                   法线 = SDF 梯度（有限差分），顶点色 = colorAt(最近占用体素色)
```

- 复用 `export/glb.ts` 的 `exportGlb` + `verifyGlb` 写 GLB；复用 `export/mesh.ts` 的 `MeshData` 类型。
- `surfaceNets` 输出直接喂 `exportGlb`，结构闸门内置在 export 返回值里。
- viewer（`viewer/app.ts`）复用同一套 `computeSignedDistance` + `surfaceNets`（esbuild 本就打包 core），在浏览器里实时重算并渲染平滑网格。

## 数据流

1. `loadForge(file)` → `SparseVoxelGrid` + `Palette`（现有）。
2. `computeSignedDistance(grid)`：从占用网格算出原生分辨率有符号距离场；`smooth` 参数做一次盒/高斯平滑让表面更圆润。
3. `surfaceNets(field, nativeSize, outRes, ...)`：按 `outRes` 采样重建 → `MeshData`，顶点色取最近占用体素色。
4. `exportGlb(mesh)` 写文件 → `verifyGlb` 结构闸门 → 返回摘要（tris/verts/bbox/体积）。

## 工具与 CLI

### 新工具 `sdf_mesh`（进 ForgeSession 工具集 + zod 校验）

```
{ resolution? , color?, smooth?, path? }
```
- `resolution`：输出网格边长（立方），默认 = 体素原生 size 的**最大轴**（保证形状完整）；`1..256` 整数。
- `color`：可选，强制平涂单色 `#RRGGBB`；缺省 = 每个顶点采样最近占用体素色。
- `smooth`：可选，SDF 平滑半径（≥0 整数，0=不平滑），默认 0。
- `path`：输出 GLB 路径；缺省 = `<file 去 .voxel.json>_sdf_r<res>.glb`。

返回摘要：`sdf_mesh: GLB <path>（<tris> tris, <verts> verts, bbox <min>-<max>, 体积 <v>, 结构闸门通过）`。
体积 = 三角网格的**有符号体积**（对每个面元做 `dot(a, cross(b, c))/6` 求和），作为与体素体积对比的验收口径。

### CLI 子命令

```
voxelforge remesh <file> [--res 64] [--smooth 1] [--color #hex] --out out.glb
```
直接包装 `sdf_mesh` 工具（缺失 `--out` 时用上述缺省命名）。

## Web Viewer 可视化 mesh

`voxelforge serve` 的 viewer（`viewer/index.html` + `viewer/app.ts`）新增**平滑网格模式**，让"不同分辨率出 mesh"在 UI 里可直接探索：

- 工具栏加一个**视图切换**：`体素` / `平滑网格`（默认保持体素视图，不破坏现有行为）。
- 切到"平滑网格"时，用浏览器内打包的 `computeSignedDistance` + `surfaceNets` 对当前体素项目实时重算，重建为一个 three.js 平滑网格（`MeshLambertMaterial`+`vertexColors`，法线取自 SDF 梯度），相机不重置。
- 配一个**分辨率滑杆**（`resolution`，范围跨原生上/下采样）+ 可选**平滑度滑杆**；拖动即重算+重渲，三角数随分辨率变化——把"同一 SDF 不同分辨率"变成可拖动的响应式体验。
- HUD 显示当前视图/分辨率/tris。
- 体素 JSON 仍经 `/model`+`/events` 自动更新；切到网格模式时对每次体素变更做防抖重算（64³ 网格毫秒级，可接受）。

## 语义与注意（写进 skill/工具描述）

- 空网格/无体素 → 报错（无法从空场重建）。
- 分辨率越低三角越少、越粗糙；越高越平滑精细但三角量近立方增长。
- 薄壁/小特征（空心房、薄壳）：SDF 表现为正-负-正；分辨率过低可能闭合不上内壳或漏细节——文档给出分档建议。
- `resolution` 与体素原生 size 解耦：可大于（超采样上采样，更平滑）或小于（减面下采样）原生，靠三线性插值。

## 验证（验收标准）

1. `pnpm build && pnpm test` 全绿。
2. 单测（`test/sdf.test.ts` / `test/surfaceNets.test.ts`）：
   - 单盒 → SDF → 各分辨率 mesh：包围盒≈盒、包络体积≈体素体积（容差）、三角数随分辨率单调、法线近似轴向、**边流形**（每条边恰 2 个面 = 封闭/水密）。
   - 球：包围盒≈球、半径≈r。
   - `smooth` 提升圆润度（顶点更少偏离理想曲面）。
3. GLB 结构闸门通过（`verifyGlb`：魔数/version/chunk/三角数/accessor min-max）。
4. CLI `remesh` 端到端：单档出一 GLB，返回摘要正确。
5. 工具 `sdf_mesh` 端到端：默认色采样 + 强制单色两种路径返回值正确。
6. viewer mesh 模式：`serve` 打开后切到"平滑网格"，出现平滑网格（非方块）+ HUD 显示 tris/分辨率；拖动分辨率滑杆三角数变化、网格重渲且相机不跳；切回"体素"仍显示原方块视图。

## 明确不做（v1）

- Marching Cubes 后端、外部体积文件（.raw/.mrc/.nii）输入。
- SDF/网格反向写回体素网格。
- 一次多档/批量 LOD 输出（v1 单档，多次调用）。
- viewer 不做编辑交互（纯查看；mesh 模式为只读重算渲染）。

## 依赖

- core 零新增运行时依赖；`sdf.ts`/`surfaceNets.ts` 纯数值。
- 复用 zod（工具 schema）、现有 exportGlb/verifyGlb、MeshData。
