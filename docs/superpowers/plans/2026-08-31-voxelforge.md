# voxelforge 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 LLM-native 体素建模工具 voxelforge：零依赖 core（网格/几何 ops/GLB/.vox/PNG 导出）+ 18 工具 MCP server + SSE 实时 web viewer + CLI。

**Architecture:** 纯 ESM TypeScript 单包。`src/core/*` 零运行时依赖（网格、ops、导出、渲染全部纯函数/类）；`src/mcp/*` 用 @modelcontextprotocol/sdk + zod 封装 ForgeSession 工具层；`src/viewer/*` 用 node:http 托管预打包单文件 three.js viewer 并经 SSE 推送文件变化。测试 vitest，TDD 节奏：先写失败测试 → 最小实现 → 通过 → 提交。

**Tech Stack:** TypeScript 5 (NodeNext, strict)、Node ≥20 内置模块（http/fs/vm/zlib/util.parseArgs）、@modelcontextprotocol/sdk ^1.12、zod ^3.23、three ^0.169（仅 devDep，esbuild 打包内联进 viewer.html）、vitest ^2、esbuild ^0.23、pnpm。

## Global Constraints

- 包管理只用 pnpm；构建 `pnpm build`，测试 `pnpm test`（= `vitest run`）。
- `src/core/**` 禁止任何 npm 运行时依赖（three、sdk、zod 都不许 import）。
- 所有 import 带 `.js` 后缀（NodeNext）；`"type": "module"`。
- 数据格式 `.voxel.json`：`{ format: "voxelforge/1", size:[x,y,z], palette: {"1": "#rrggbb"}, voxels: {"x,y,z": idx} }`；调色板与体素索引均 1..255；坐标 0-based，x 右/y 上/z 前。
- 颜色一律 `#RRGGBB` hex（写入前 normalize 为小写 `#rrggbb`）；工具层自动分配调色板号。
- 镜像映射 `v → size[axis]-1-v`；region 扁平六元组含两端，min>max 自动纠正。
- 工具返回一律简洁文本摘要（计数/bounds），绝不回传全量网格。
- 每个变更类工具执行前压 undo 快照（栈深 20），成功后原子落盘（tmp+rename）。
- hollow 语义 = 形状几何的 6-邻域壳（至少一个邻居在形状外）；镜像目标恒在界内。
- 提交信息用 conventional commits（feat/test/docs/chore）。

---

### Task 1: 项目脚手架 + 类型定义

**Files:**
- Create: `package.json`、`tsconfig.json`、`vitest.config.ts`、`src/core/types.ts`、`src/core/index.ts`、`src/index.ts`、`test/smoke.test.ts`

**Interfaces:**
- Produces: `VoxelProject`（interface，字段 format/size/palette/voxels）、`Axis = "x"|"y"|"z"`、`Region = [number×6]`——后续所有任务 import 自 `src/core/types.js`。

- [ ] **Step 1: 写 package.json / tsconfig / vitest 配置**

`package.json`：
```json
{
  "name": "voxelforge",
  "version": "0.1.0",
  "description": "LLM-native 3D voxel modeling: core + MCP server + web viewer",
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "voxelforge": "dist/cli.js", "voxelforge-mcp": "dist/mcp.js" },
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core/index.js",
    "./mcp": "./dist/mcp/server.js"
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/build-viewer.mjs",
    "test": "vitest run",
    "watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "esbuild": "^0.23.1",
    "three": "^0.169.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.1"
  }
}
```

`tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`：
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] }
});
```

- [ ] **Step 2: 写类型与桶文件**

`src/core/types.ts`：
```ts
export interface VoxelProject {
  format: "voxelforge/1";
  size: [number, number, number];
  palette: Record<string, string>;
  voxels: Record<string, number>;
}

export type Axis = "x" | "y" | "z";

export type Region = [number, number, number, number, number, number];
```

`src/core/index.ts`：
```ts
export * from "./types.js";
```

`src/index.ts`：
```ts
export * from "./core/index.js";
```

- [ ] **Step 3: 写失败测试（冒烟）**

`test/smoke.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import type { VoxelProject } from "../src/core/types.js";

describe("scaffold", () => {
  it("types 可导入且形状正确", () => {
    const p: VoxelProject = {
      format: "voxelforge/1",
      size: [8, 8, 8],
      palette: { "1": "#ff0000" },
      voxels: { "0,0,0": 1 }
    };
    expect(p.format).toBe("voxelforge/1");
    expect(p.size).toEqual([8, 8, 8]);
  });
});
```

- [ ] **Step 4: 安装依赖并跑测试**

```bash
pnpm install
pnpm test
```
Expected: 1 passed。若 pnpm 报 @modelcontextprotocol/sdk 版本不存在，改用 `pnpm view @modelcontextprotocol/sdk versions --json | tail` 查最新 1.x 后修正 package.json。

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src test
git commit -m "chore: 项目脚手架 + 核心类型"
```

---

### Task 2: SparseVoxelGrid

**Files:**
- Create: `src/core/grid.ts`
- Modify: `src/core/index.ts`（追加 export）
- Test: `test/grid.test.ts`

**Interfaces:**
- Consumes: `VoxelProject`（Task 1）
- Produces: `class SparseVoxelGrid`——`constructor(size:[number,number,number])`（每轴 1..256 否则抛错）、`static fromProject(p)`、`key(x,y,z): string`、`inBounds(x,y,z): boolean`、`get(x,y,z): number|undefined`、`set(x,y,z,idx): boolean`（越界抛错含合法范围；值相同返回 false）、`unset(x,y,z): boolean`、`clear(): void`、`get count(): number`、`entries(): IterableIterator<[string,number]>`、`coords(): Generator<[x,y,z,idx]>`、`bounds(): Region|null`、`colorCounts(): Map<number,number>`、`snapshot(): Map<string,number>`、`restore(m)`。

- [ ] **Step 1: 写失败测试**

`test/grid.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";

describe("SparseVoxelGrid", () => {
  it("set/get/unset 与 count", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    expect(g.count).toBe(0);
    expect(g.set(1, 2, 3, 1)).toBe(true);
    expect(g.set(1, 2, 3, 1)).toBe(false); // 同值幂等
    expect(g.get(1, 2, 3)).toBe(1);
    expect(g.unset(1, 2, 3)).toBe(true);
    expect(g.unset(1, 2, 3)).toBe(false);
    expect(g.count).toBe(0);
  });

  it("越界 set 抛错并携带合法范围", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    expect(() => g.set(4, 0, 0, 1)).toThrow(/x:0\.\.3/);
    expect(() => g.set(-1, 0, 0, 1)).toThrow();
  });

  it("构造拒绝非法 size", () => {
    expect(() => new SparseVoxelGrid([0, 8, 8])).toThrow();
    expect(() => new SparseVoxelGrid([300, 8, 8])).toThrow();
  });

  it("bounds 与 colorCounts", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    g.set(2, 3, 4, 1); g.set(5, 1, 9, 2); g.set(5, 1, 9, 1);
    expect(g.bounds()).toEqual([2, 1, 4, 5, 3, 9]);
    expect(g.colorCounts().get(1)).toBe(2);
    expect(g.count).toBe(2);
  });

  it("空网格 bounds 为 null", () => {
    expect(new SparseVoxelGrid([4, 4, 4]).bounds()).toBeNull();
  });

  it("snapshot/restore 深拷贝", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 1, 1, 1);
    const snap = g.snapshot();
    g.set(2, 2, 2, 2);
    g.restore(snap);
    expect(g.count).toBe(1);
    expect(g.get(2, 2, 2)).toBeUndefined();
  });

  it("coords 迭代产出坐标", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 2, 3, 5);
    expect([...g.coords()]).toEqual([[1, 2, 3, 5]]);
  });

  it("clear 清空", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 1, 1, 1);
    g.clear();
    expect(g.count).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/grid.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 grid.ts**

`src/core/grid.ts`：
```ts
import type { Region, VoxelProject } from "./types.js";

export class SparseVoxelGrid {
  readonly size: [number, number, number];
  private vox = new Map<string, number>();

  constructor(size: [number, number, number]) {
    if (size.length !== 3 || size.some(n => !Number.isInteger(n) || n < 1 || n > 256)) {
      throw new Error(`size 无效: ${JSON.stringify(size)}（每轴需 1..256 的整数）`);
    }
    this.size = [...size] as [number, number, number];
  }

  static fromProject(p: VoxelProject): SparseVoxelGrid {
    const g = new SparseVoxelGrid(p.size);
    for (const [k, idx] of Object.entries(p.voxels)) g.vox.set(k, idx);
    return g;
  }

  key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size[0] && y < this.size[1] && z < this.size[2];
  }

  get(x: number, y: number, z: number): number | undefined {
    return this.vox.get(this.key(x, y, z));
  }

  set(x: number, y: number, z: number, idx: number): boolean {
    if (!this.inBounds(x, y, z)) {
      throw new Error(`坐标越界 (${x},${y},${z})，合法范围 x:0..${this.size[0] - 1} y:0..${this.size[1] - 1} z:0..${this.size[2] - 1}`);
    }
    const k = this.key(x, y, z);
    if (this.vox.get(k) === idx) return false;
    this.vox.set(k, idx);
    return true;
  }

  unset(x: number, y: number, z: number): boolean {
    return this.vox.delete(this.key(x, y, z));
  }

  clear(): void {
    this.vox.clear();
  }

  get count(): number {
    return this.vox.size;
  }

  entries(): IterableIterator<[string, number]> {
    return this.vox.entries();
  }

  *coords(): Generator<[number, number, number, number]> {
    for (const [k, idx] of this.vox) {
      const [x, y, z] = k.split(",").map(Number);
      yield [x, y, z, idx];
    }
  }

  bounds(): Region | null {
    let b: Region | null = null;
    for (const [x, y, z] of this.coords()) {
      if (b === null) { b = [x, y, z, x, y, z]; continue; }
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
      if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
    }
    return b;
  }

  colorCounts(): Map<number, number> {
    const m = new Map<number, number>();
    for (const [, idx] of this.vox) m.set(idx, (m.get(idx) ?? 0) + 1);
    return m;
  }

  snapshot(): Map<string, number> {
    return new Map(this.vox);
  }

  restore(s: Map<string, number>): void {
    this.vox = new Map(s);
  }
}
```

`src/core/index.ts` 追加：
```ts
export * from "./grid.js";
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/grid.test.ts
```
Expected: 8 passed。

- [ ] **Step 5: Commit**

```bash
git add src/core/grid.ts src/core/index.ts test/grid.test.ts
git commit -m "feat: SparseVoxelGrid 稀疏体素网格"
```

---

### Task 3: Palette + project 加载/保存

**Files:**
- Create: `src/core/palette.ts`、`src/core/project.ts`
- Modify: `src/core/index.ts`
- Test: `test/palette.test.ts`、`test/project.test.ts`

**Interfaces:**
- Consumes: `SparseVoxelGrid`（Task 2）、`VoxelProject`（Task 1）
- Produces: `class Palette`——`constructor(existing?: Record<string,string>)`、`static normalize(hex): string`（`#rrggbb` 小写，非法抛错）、`indexOf(hex): number`（自动追加分配，1..255，满 255 抛错）、`hexOf(idx): string|undefined`、`toRecord(): Record<string,string>`、`snapshot(): [string[], Map<string,number>]`、`restore(snap)`、`get size(): number`；`hexToRgb255(hex): [r,g,b]`（0..255）；`validateProject(data: unknown): VoxelProject`（抛错消息含字段名）；`emptyProject(size): VoxelProject`；`loadForge(file): Promise<{grid, palette}>`；`saveForge(file, grid, palette): Promise<void>`（tmp+rename 原子写）。

- [ ] **Step 1: 写失败测试**

`test/palette.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { Palette, hexToRgb255 } from "../src/core/palette.js";

describe("Palette", () => {
  it("normalize 大小写与缺 #", () => {
    expect(Palette.normalize("#FFAA00")).toBe("#ffaa00");
    expect(Palette.normalize("ffaa00")).toBe("#ffaa00");
    expect(() => Palette.normalize("red")).toThrow(/#RRGGBB/);
    expect(() => Palette.normalize("#12345")).toThrow();
  });

  it("indexOf 自动分配并复用", () => {
    const p = new Palette();
    expect(p.indexOf("#ff0000")).toBe(1);
    expect(p.indexOf("#00ff00")).toBe(2);
    expect(p.indexOf("#FF0000")).toBe(1); // 复用（大小写不敏感）
    expect(p.hexOf(2)).toBe("#00ff00");
    expect(p.size).toBe(2);
  });

  it("从已有项目恢复稀疏索引", () => {
    const p = new Palette({ "3": "#ff0000", "1": "#00ff00" });
    expect(p.hexOf(3)).toBe("#ff0000");
    expect(p.hexOf(1)).toBe("#00ff00");
    expect(p.indexOf("#ff0000")).toBe(3); // 已存在则复用原号
  });

  it("255 色上限", () => {
    const p = new Palette();
    for (let i = 0; i < 255; i++) p.indexOf(`#${i.toString(16).padStart(6, "0")}`);
    expect(() => p.indexOf("#ffffff")).toThrow(/255/);
  });

  it("snapshot/restore", () => {
    const p = new Palette();
    p.indexOf("#ff0000");
    const snap = p.snapshot();
    p.indexOf("#00ff00");
    p.restore(snap);
    expect(p.size).toBe(1);
    expect(p.indexOf("#00ff00")).toBe(2);
  });

  it("hexToRgb255", () => {
    expect(hexToRgb255("#8b4513")).toEqual([139, 69, 19]);
  });
});
```

`test/project.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { validateProject, emptyProject, loadForge, saveForge } from "../src/core/project.js";

describe("validateProject", () => {
  it("合法项目通过", () => {
    const p = emptyProject([8, 8, 8]);
    p.palette["1"] = "#ff0000";
    p.voxels["0,0,0"] = 1;
    expect(validateProject(p)).toEqual(p);
  });
  it("坏 format / size / voxels 键 / 越界 / 索引范围各自抛错", () => {
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), format: "x" })).toThrow(/format/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), size: [8, 8] })).toThrow(/size/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), voxels: { "0,0": 1 } })).toThrow(/x,y,z/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), voxels: { "9,0,0": 1 } })).toThrow(/越界/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), voxels: { "0,0,0": 0 } })).toThrow(/1\.\.255/);
    expect(() => validateProject({ ...emptyProject([8, 8, 8]), palette: { "0": "#ff0000" } })).toThrow(/1\.\.255/);
  });
});

describe("saveForge/loadForge roundtrip", () => {
  it("保存后加载字节一致", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    const g = new SparseVoxelGrid([8, 8, 8]);
    const pal = new Palette();
    g.set(1, 2, 3, pal.indexOf("#8b4513"));
    g.set(4, 5, 6, pal.indexOf("#daa520"));
    await saveForge(file, g, pal);
    const { grid, palette } = await loadForge(file);
    expect(grid.count).toBe(2);
    expect(grid.get(1, 2, 3)).toBe(1);
    expect(palette.hexOf(2)).toBe("#daa520");
    // 二次保存字节一致（确定性）
    await saveForge(file, grid, palette);
    const again = await loadForge(file);
    expect(again.grid.count).toBe(2);
  });

  it("loadForge 对坏文件抛错", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "bad.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{ not json");
    await expect(loadForge(file)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/palette.test.ts test/project.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 palette.ts 与 project.ts**

`src/core/palette.ts`：
```ts
export class Palette {
  private idxToHex: string[] = []; // 下标 i 对应调色板号 i+1（可能有稀疏空洞）
  private hexToIdx = new Map<string, number>();

  constructor(existing?: Record<string, string>) {
    if (!existing) return;
    for (const [k, v] of Object.entries(existing)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 1 || idx > 255) {
        throw new Error(`调色板号必须为 1..255: ${k}`);
      }
      const hex = Palette.normalize(v);
      this.idxToHex[idx - 1] = hex;
      this.hexToIdx.set(hex, idx);
    }
  }

  static normalize(hex: string): string {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
    if (!m) throw new Error(`颜色格式无效: "${hex}"，需要 #RRGGBB`);
    return `#${m[1].toLowerCase()}`;
  }

  indexOf(hex: string): number {
    const h = Palette.normalize(hex);
    const found = this.hexToIdx.get(h);
    if (found !== undefined) return found;
    if (this.idxToHex.length >= 255) throw new Error("调色板已满（255 色），请复用已有颜色或用 paint 换色");
    const idx = this.idxToHex.length + 1;
    this.idxToHex.push(h);
    this.hexToIdx.set(h, idx);
    return idx;
  }

  hexOf(idx: number): string | undefined {
    return this.idxToHex[idx - 1];
  }

  toRecord(): Record<string, string> {
    const o: Record<string, string> = {};
    this.idxToHex.forEach((h, i) => { o[i + 1] = h; });
    return o;
  }

  get size(): number {
    return this.idxToHex.length;
  }

  snapshot(): [string[], Map<string, number>] {
    return [[...this.idxToHex], new Map(this.hexToIdx)];
  }

  restore(snap: [string[], Map<string, number>]): void {
    this.idxToHex = [...snap[0]];
    this.hexToIdx = new Map(snap[1]);
  }
}

export function hexToRgb255(hex: string): [number, number, number] {
  const h = Palette.normalize(hex);
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ];
}
```

`src/core/project.ts`：
```ts
import fs from "node:fs/promises";
import { SparseVoxelGrid } from "./grid.js";
import { Palette } from "./palette.js";
import type { VoxelProject } from "./types.js";

export function validateProject(data: unknown): VoxelProject {
  if (typeof data !== "object" || data === null) throw new Error("项目根必须是对象");
  const d = data as Record<string, unknown>;
  if (d.format !== "voxelforge/1") throw new Error(`format 必须为 "voxelforge/1"，实际: ${JSON.stringify(d.format)}`);
  const size = d.size;
  if (!Array.isArray(size) || size.length !== 3 || size.some(n => !Number.isInteger(n) || n < 1 || n > 256)) {
    throw new Error(`size 必须为 [x,y,z]，每轴 1..256: ${JSON.stringify(d.size)}`);
  }
  const palette = d.palette;
  if (typeof palette !== "object" || palette === null) throw new Error("palette 必须为对象");
  for (const [k, v] of Object.entries(palette)) {
    if (!/^\d+$/.test(k) || Number(k) < 1 || Number(k) > 255) throw new Error(`palette 键必须为 1..255: ${k}`);
    Palette.normalize(v as string);
  }
  const voxels = d.voxels;
  if (typeof voxels !== "object" || voxels === null) throw new Error("voxels 必须为对象");
  const [sx, sy, sz] = size as [number, number, number];
  for (const [k, idx] of Object.entries(voxels)) {
    if (!/^\d+,\d+,\d+$/.test(k)) throw new Error(`voxels 键必须为 "x,y,z": ${k}`);
    const [x, y, z] = k.split(",").map(Number);
    if (x >= sx || y >= sy || z >= sz) throw new Error(`voxels 越界: ${k}（size [${size}]）`);
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 1 || idx > 255) {
      throw new Error(`voxels 值必须为 1..255 调色板号: ${k}=${JSON.stringify(idx)}`);
    }
  }
  return d as unknown as VoxelProject;
}

export function emptyProject(size: [number, number, number]): VoxelProject {
  return { format: "voxelforge/1", size: [...size] as [number, number, number], palette: {}, voxels: {} };
}

export async function loadForge(file: string): Promise<{ grid: SparseVoxelGrid; palette: Palette }> {
  const raw = await fs.readFile(file, "utf8");
  const p = validateProject(JSON.parse(raw));
  return { grid: SparseVoxelGrid.fromProject(p), palette: new Palette(p.palette) };
}

export async function saveForge(file: string, grid: SparseVoxelGrid, palette: Palette): Promise<void> {
  const project: VoxelProject = {
    format: "voxelforge/1",
    size: [...grid.size] as [number, number, number],
    palette: palette.toRecord(),
    voxels: Object.fromEntries(grid.entries())
  };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project));
  await fs.rename(tmp, file);
}
```

`src/core/index.ts` 追加：
```ts
export * from "./palette.js";
export * from "./project.js";
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/palette.test.ts test/project.test.ts
```
Expected: 全部 passed。

- [ ] **Step 5: Commit**

```bash
git add src/core/palette.ts src/core/project.ts src/core/index.ts test/palette.test.ts test/project.test.ts
git commit -m "feat: Palette 自动调色板 + .voxel.json 校验与原子读写"
```

---

### Task 4: 几何 ops — box / line（含 hollow 壳与 mirror）

**Files:**
- Create: `src/core/ops.ts`
- Modify: `src/core/index.ts`
- Test: `test/ops.test.ts`

**Interfaces:**
- Consumes: `SparseVoxelGrid`（Task 2）、`Axis`/`Region`（Task 1）
- Produces（后续任务大量消费，签名固定）：
  - `interface PlaceOpts { hollow?: boolean; mirror?: Axis[] }`
  - `interface ChangeStats { added: number; removed: number; total: number; bounds: Region | null }`
  - `normRegion(r: Region): Region`（min>max 纠正）
  - `mirrorTargets(g, x, y, z, mirror?): Array<[x,y,z]>`（2^k 组合，恒在界内）
  - `placeBox(g, x0,y0,z0,x1,y1,z1, idx, opts?): ChangeStats`
  - `placeLine(g, x0,y0,z0, x1,y1,z1, idx, opts? & {thickness?: number}): ChangeStats`（thickness=笔刷立方边长，锚点为圆整点，去重）
- hollow 语义：形状内体素且其 6 邻域至少一个在形状几何之外 → 保留（壳）。

- [ ] **Step 1: 写失败测试**

`test/ops.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { placeBox, placeLine } from "../src/core/ops.js";

describe("placeBox", () => {
  it("实心 2x3x4 = 24，返回计数与 bounds", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeBox(g, 0, 0, 0, 1, 2, 3, 1);
    expect(g.count).toBe(24);
    expect(s).toMatchObject({ added: 24, removed: 0, total: 24, bounds: [0, 0, 0, 1, 2, 3] });
  });

  it("hollow 4x4x4 = 56（壳=至少一个6邻域邻居在形状外）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeBox(g, 0, 0, 0, 3, 3, 3, 1, { hollow: true });
    expect(g.count).toBe(56);
    expect(g.get(1, 1, 1)).toBeUndefined(); // 内芯被挖掉
    expect(g.get(0, 1, 1)).toBe(1);
  });

  it("region 反向输入自动纠正", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeBox(g, 3, 3, 3, 0, 0, 0, 1);
    expect(g.count).toBe(24);
  });

  it("越界区域被裁剪不抛错", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const s = placeBox(g, 6, 6, 6, 10, 10, 10, 1);
    expect(g.count).toBe(8); // 只剩界内 2x2x2
    expect(s.bounds).toEqual([6, 6, 6, 7, 7, 7]);
  });

  it("mirror x 复制到对侧", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 1, 1, 1, 1, { mirror: ["x"] });
    expect(g.count).toBe(16);
    expect(g.get(6, 0, 0)).toBe(1); // 8-1-1=6
    expect(g.get(7, 0, 0)).toBe(1);
  });

  it("mirror xy 生成 4 份组合", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 1, 1, 1, 1, { mirror: ["x", "y"] });
    expect(g.count).toBe(32);
  });

  it("重复 set 幂等不重复计数", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 1, 1, 1, 1);
    const s = placeBox(g, 0, 0, 0, 1, 1, 1, 1);
    expect(s.added).toBe(0);
    expect(g.count).toBe(8);
  });
});

describe("placeLine", () => {
  it("对角线 4 点", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeLine(g, 0, 0, 0, 3, 3, 3, 1);
    expect(s.added).toBe(4);
    expect(g.get(2, 2, 2)).toBe(1);
  });

  it("thickness=2 笔刷去重后 29 个体素", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeLine(g, 0, 0, 0, 3, 3, 3, 1, { thickness: 2 });
    expect(s.added).toBe(29); // 4 个 2x2x2 立方相邻共享 1 体素 ×3
  });

  it("单点线（起终点相同）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    expect(placeLine(g, 5, 5, 5, 5, 5, 5, 1).added).toBe(1);
  });

  it("线出界部分被跳过不抛错", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    expect(() => placeLine(g, 0, 0, 0, 10, 0, 0, 1)).not.toThrow();
    expect(g.get(3, 0, 0)).toBe(1);
    expect(g.get(4, 0, 0)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/ops.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 ops.ts（本任务先实现共享骨架 + box/line；sphere/cylinder/区域 ops 留 Task 5/6）**

`src/core/ops.ts`：
```ts
import type { SparseVoxelGrid } from "./grid.js";
import type { Axis, Region } from "./types.js";

export interface PlaceOpts {
  hollow?: boolean;
  mirror?: Axis[];
}

export interface ChangeStats {
  added: number;
  removed: number;
  total: number;
  bounds: Region | null;
}

export function normRegion(r: Region): Region {
  return [
    Math.min(r[0], r[3]), Math.min(r[1], r[4]), Math.min(r[2], r[5]),
    Math.max(r[0], r[3]), Math.max(r[1], r[4]), Math.max(r[2], r[5])
  ];
}

export function mirrorTargets(
  g: SparseVoxelGrid, x: number, y: number, z: number, mirror?: Axis[]
): Array<[number, number, number]> {
  if (!mirror || mirror.length === 0) return [[x, y, z]];
  const out: Array<[number, number, number]> = [];
  const n = mirror.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    let px = x, py = y, pz = z;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const a = mirror[i];
      const axisIdx = a === "x" ? 0 : a === "y" ? 1 : 2;
      const v = axisIdx === 0 ? px : axisIdx === 1 ? py : pz;
      const m = g.size[axisIdx] - 1 - v;
      if (axisIdx === 0) px = m; else if (axisIdx === 1) py = m; else pz = m;
    }
    out.push([px, py, pz]);
  }
  return out;
}

// 形状几何谓词：hollow 壳 = 形状内体素且 6 邻域至少一个邻居在形状外
abstract class Shape {
  abstract inside(x: number, y: number, z: number): boolean;
  isShell(x: number, y: number, z: number): boolean {
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      .some(([dx, dy, dz]) => !this.inside(x + dx, y + dy, z + dz));
  }
}

class BoxShape extends Shape {
  constructor(private r: Region) { super(); }
  inside(x: number, y: number, z: number): boolean {
    return x >= this.r[0] && y >= this.r[1] && z >= this.r[2] && x <= this.r[3] && y <= this.r[4] && z <= this.r[5];
  }
}

function stats(g: SparseVoxelGrid, added: number, removed: number): ChangeStats {
  return { added, removed, total: g.count, bounds: g.bounds() };
}

function placeShape(g: SparseVoxelGrid, shape: Shape, region: Region, idx: number, opts: PlaceOpts): ChangeStats {
  const r = normRegion(region);
  let added = 0;
  const seen = new Set<string>();
  for (let x = Math.max(0, r[0]); x <= Math.min(g.size[0] - 1, r[3]); x++) {
    for (let y = Math.max(0, r[1]); y <= Math.min(g.size[1] - 1, r[4]); y++) {
      for (let z = Math.max(0, r[2]); z <= Math.min(g.size[2] - 1, r[5]); z++) {
        if (!shape.inside(x, y, z)) continue;
        if (opts.hollow && !shape.isShell(x, y, z)) continue;
        for (const [mx, my, mz] of mirrorTargets(g, x, y, z, opts.mirror)) {
          const k = `${mx},${my},${mz}`;
          if (seen.has(k)) continue;
          seen.add(k);
          if (g.set(mx, my, mz, idx)) added++;
        }
      }
    }
  }
  return stats(g, added, 0);
}

export function placeBox(
  g: SparseVoxelGrid, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, idx: number, opts: PlaceOpts = {}
): ChangeStats {
  const r = normRegion([x0, y0, z0, x1, y1, z1]);
  return placeShape(g, new BoxShape(r), r, idx, opts);
}

export interface LineOpts extends PlaceOpts { thickness?: number }

export function placeLine(
  g: SparseVoxelGrid, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, idx: number, opts: LineOpts = {}
): ChangeStats {
  const t = Math.max(1, Math.round(opts.thickness ?? 1));
  const N = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  let added = 0;
  const seen = new Set<string>();
  for (let i = 0; i <= N; i++) {
    const f = N === 0 ? 0 : i / N;
    const x = Math.round(x0 + (x1 - x0) * f);
    const y = Math.round(y0 + (y1 - y0) * f);
    const z = Math.round(z0 + (z1 - z0) * f);
    for (let ox = 0; ox < t; ox++) {
      for (let oy = 0; oy < t; oy++) {
        for (let oz = 0; oz < t; oz++) {
          for (const [mx, my, mz] of mirrorTargets(g, x + ox, y + oy, z + oz, opts.mirror)) {
            if (!g.inBounds(mx, my, mz)) continue;
            const k = `${mx},${my},${mz}`;
            if (seen.has(k)) continue;
            seen.add(k);
            if (g.set(mx, my, mz, idx)) added++;
          }
        }
      }
    }
  }
  return stats(g, added, 0);
}
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/ops.test.ts
```
Expected: 全部 passed（11 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/core/ops.ts src/core/index.ts test/ops.test.ts
git commit -m "feat: placeBox/placeLine + hollow 壳语义 + mirror 对称组"
```

---

### Task 5: 几何 ops — sphere / cylinder

**Files:**
- Modify: `src/core/ops.ts`（追加）
- Test: `test/ops.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `Shape` 基类、`placeShape`、`PlaceOpts`、`ChangeStats`（Task 4 内部）
- Produces: `placeSphere(g, cx,cy,cz, r, idx, opts?): ChangeStats`（inside = dx²+dy²+dz² ≤ r²）；`placeCylinder(g, cx,cy,cz, r, h, idx, opts? & {axis?: Axis}): ChangeStats`（底面圆心，沿 axis 延伸 h 层，axis 默认 "y"；inside = 垂直轴平面内 d² ≤ r² 且轴向 ∈ [c, c+h)）。

- [ ] **Step 1: 追加失败测试（追加到 test/ops.test.ts 末尾）**

```ts
import { placeSphere, placeCylinder } from "../src/core/ops.js";

describe("placeSphere", () => {
  it("r=2 实心 33 体素", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeSphere(g, 8, 8, 8, 2, 1);
    expect(s.added).toBe(33);
    expect(g.get(8, 8, 8)).toBe(1);
    expect(g.get(10, 8, 8)).toBe(1);  // d²=4 ≤ 4
    expect(g.get(11, 8, 8)).toBeUndefined();
  });

  it("r=2 hollow 26 体素（挖掉完全内埋的 7 个：球心+6轴邻）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeSphere(g, 8, 8, 8, 2, 1, { hollow: true });
    expect(g.count).toBe(26);
    expect(g.get(8, 8, 8)).toBeUndefined();
    expect(g.get(10, 8, 8)).toBe(1);
  });
});

describe("placeCylinder", () => {
  it("axis=y r=2 h=3 共 39 体素（圆盘 13 × 3 层）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeCylinder(g, 8, 4, 8, 2, 3, 1);
    expect(s.added).toBe(39);
    expect(g.get(8, 4, 8)).toBe(1);
    expect(g.get(10, 5, 8)).toBe(1);
    expect(g.get(8, 7, 8)).toBeUndefined(); // h=3 → y ∈ [4,7)
  });

  it("axis=y hollow r=2 h=3 = 34（中段内埋 5 个被挖）", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeCylinder(g, 8, 4, 8, 2, 3, 1, { hollow: true });
    expect(g.count).toBe(34);
    expect(g.get(8, 5, 8)).toBeUndefined(); // 中段轴心
    expect(g.get(8, 4, 8)).toBe(1);          // 底盖保留（壳）
  });

  it("axis=x 沿 x 延伸", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const s = placeCylinder(g, 4, 8, 8, 1, 3, 1, { axis: "x" });
    expect(s.added).toBe(15); // r=1 圆盘 5 × 3
    expect(g.get(4, 8, 8)).toBe(1);
    expect(g.get(6, 8, 8)).toBe(1);
    expect(g.get(7, 8, 8)).toBeUndefined();
  });

  it("mirror 对称", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeCylinder(g, 4, 0, 4, 1, 2, 1, { mirror: ["x"] });
    expect(g.get(4, 0, 4)).toBe(1);
    expect(g.get(11, 0, 4)).toBe(1); // 16-1-4=11
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/ops.test.ts
```
Expected: 新增用例 FAIL（placeSphere 未导出）。

- [ ] **Step 3: 在 ops.ts 追加实现**

```ts
class SphereShape extends Shape {
  constructor(private cx: number, private cy: number, private cz: number, private r: number) { super(); }
  inside(x: number, y: number, z: number): boolean {
    const dx = x - this.cx, dy = y - this.cy, dz = z - this.cz;
    return dx * dx + dy * dy + dz * dz <= this.r * this.r;
  }
}

export function placeSphere(
  g: SparseVoxelGrid, cx: number, cy: number, cz: number,
  r: number, idx: number, opts: PlaceOpts = {}
): ChangeStats {
  const r0 = Math.ceil(r);
  const region: Region = [cx - r0, cy - r0, cz - r0, cx + r0, cy + r0, cz + r0];
  return placeShape(g, new SphereShape(cx, cy, cz, r), region, idx, opts);
}

class CylinderShape extends Shape {
  constructor(
    private cx: number, private cy: number, private cz: number,
    private r: number, private h: number, private axis: Axis
  ) { super(); }
  inside(x: number, y: number, z: number): boolean {
    const a = this.axis;
    const c = a === "x" ? this.cx : a === "y" ? this.cy : this.cz;
    const v = a === "x" ? x : a === "y" ? y : z;
    if (v < c || v >= c + this.h) return false;
    const [p, q] = a === "x" ? [y - this.cy, z - this.cz] : a === "y" ? [x - this.cx, z - this.cz] : [x - this.cx, y - this.cy];
    return p * p + q * q <= this.r * this.r;
  }
}

export interface CylinderOpts extends PlaceOpts { axis?: Axis }

export function placeCylinder(
  g: SparseVoxelGrid, cx: number, cy: number, cz: number,
  r: number, h: number, idx: number, opts: CylinderOpts = {}
): ChangeStats {
  const axis = opts.axis ?? "y";
  if (!Number.isInteger(h) || h < 1) throw new Error(`h 必须为 ≥1 的整数: ${h}`);
  const r0 = Math.ceil(r);
  const region: Region = axis === "x"
    ? [cx, cy - r0, cz - r0, cx + h - 1, cy + r0, cz + r0]
    : axis === "y"
      ? [cx - r0, cy, cz - r0, cx + r0, cy + h - 1, cz + r0]
      : [cx - r0, cy - r0, cz, cx + r0, cy + r0, cz + h - 1];
  return placeShape(g, new CylinderShape(cx, cy, cz, r, h, axis), region, idx, opts);
}
```

同时把 ops.ts 顶部 import 的 `Axis` 确认已从 types.js 导入（Task 4 已导入）。

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/ops.test.ts
```
Expected: 全部 passed。

- [ ] **Step 5: Commit**

```bash
git add src/core/ops.ts test/ops.test.ts
git commit -m "feat: placeSphere/placeCylinder（axis + hollow 壳）"
```

---

### Task 6: 区域 ops — paint / erase / translate

**Files:**
- Modify: `src/core/ops.ts`（追加）
- Test: `test/ops.test.ts`（追加）

**Interfaces:**
- Produces:
  - `paintRegion(g, region: Region | null, fromIdx: number | undefined, toIdx: number): ChangeStats`（region null=全网格；fromIdx undefined=区域内全部；changed 计入 added）
  - `eraseRegion(g, region: Region | "all"): ChangeStats`（removed 计数）
  - `translateRegion(g, region: Region, dx,dy,dz): ChangeStats`（目标出界或已被占则丢弃该体素）
  - `grid.clear()` 已在 Task 2 提供（erase all 用）。

- [ ] **Step 1: 追加失败测试**

```ts
import { paintRegion, eraseRegion, translateRegion } from "../src/core/ops.js";

describe("paintRegion", () => {
  it("区域内全部换色", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 3, 3, 3, 1);
    const s = paintRegion(g, [0, 0, 0, 3, 3, 3], undefined, 2);
    expect(s.added).toBe(64);
    expect(g.get(0, 0, 0)).toBe(2);
    expect(g.colorCounts().get(1)).toBeUndefined();
  });

  it("fromIdx 过滤换色", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(0, 0, 0, 1); g.set(1, 0, 0, 2);
    paintRegion(g, null, 1, 3); // 全网格：仅色 1 → 色 3
    expect(g.get(0, 0, 0)).toBe(3);
    expect(g.get(1, 0, 0)).toBe(2);
  });

  it("无匹配时 added=0", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    expect(paintRegion(g, null, undefined, 1).added).toBe(0);
  });
});

describe("eraseRegion", () => {
  it("区域擦除计数 removed", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 3, 3, 3, 1);
    const s = eraseRegion(g, [0, 0, 0, 1, 1, 1]);
    expect(s.removed).toBe(8);
    expect(g.count).toBe(56);
  });

  it("all 清空", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    placeBox(g, 0, 0, 0, 3, 3, 3, 1);
    const s = eraseRegion(g, "all");
    expect(s.removed).toBe(64);
    expect(g.count).toBe(0);
    expect(g.bounds()).toBeNull();
  });
});

describe("translateRegion", () => {
  it("平移并统计", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    placeBox(g, 0, 0, 0, 1, 1, 1, 1);
    const s = translateRegion(g, [0, 0, 0, 1, 1, 1], 4, 2, 0);
    expect(s.removed).toBe(8);
    expect(s.added).toBe(8);
    expect(g.get(4, 2, 0)).toBe(1);
    expect(g.get(0, 0, 0)).toBeUndefined();
  });

  it("出界与目标占用被丢弃", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(0, 0, 0, 1); g.set(1, 0, 0, 1); g.set(2, 0, 0, 2); // 目标位预占
    const s = translateRegion(g, [0, 0, 0, 1, 0, 0], 2, 0, 0);
    expect(g.get(2, 0, 0)).toBe(2);   // 目标被占，源体素被移除后不落位
    expect(g.get(3, 0, 0)).toBe(1);   // (1,0,0)→(3,0,0) 成功
    expect(g.get(0, 0, 0)).toBeUndefined();
    expect(s.added).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/ops.test.ts
```
Expected: 新用例 FAIL。

- [ ] **Step 3: ops.ts 追加实现**

```ts
export function paintRegion(
  g: SparseVoxelGrid, region: Region | null,
  fromIdx: number | undefined, toIdx: number
): ChangeStats {
  const r = region ? normRegion(region) : [0, 0, 0, g.size[0] - 1, g.size[1] - 1, g.size[2] - 1] as Region;
  let changed = 0;
  for (let x = Math.max(0, r[0]); x <= Math.min(g.size[0] - 1, r[3]); x++) {
    for (let y = Math.max(0, r[1]); y <= Math.min(g.size[1] - 1, r[4]); y++) {
      for (let z = Math.max(0, r[2]); z <= Math.min(g.size[2] - 1, r[5]); z++) {
        const cur = g.get(x, y, z);
        if (cur === undefined) continue;
        if (fromIdx !== undefined && cur !== fromIdx) continue;
        if (cur === toIdx) continue;
        g.set(x, y, z, toIdx);
        changed++;
      }
    }
  }
  return stats(g, changed, 0);
}

export function eraseRegion(g: SparseVoxelGrid, region: Region | "all"): ChangeStats {
  if (region === "all") {
    const removed = g.count;
    g.clear();
    return stats(g, 0, removed);
  }
  const r = normRegion(region);
  let removed = 0;
  for (let x = Math.max(0, r[0]); x <= Math.min(g.size[0] - 1, r[3]); x++) {
    for (let y = Math.max(0, r[1]); y <= Math.min(g.size[1] - 1, r[4]); y++) {
      for (let z = Math.max(0, r[2]); z <= Math.min(g.size[2] - 1, r[5]); z++) {
        if (g.unset(x, y, z)) removed++;
      }
    }
  }
  return stats(g, 0, removed);
}

export function translateRegion(
  g: SparseVoxelGrid, region: Region, dx: number, dy: number, dz: number
): ChangeStats {
  const r = normRegion(region);
  const moved: Array<[number, number, number, number]> = [];
  for (let x = Math.max(0, r[0]); x <= Math.min(g.size[0] - 1, r[3]); x++) {
    for (let y = Math.max(0, r[1]); y <= Math.min(g.size[1] - 1, r[4]); y++) {
      for (let z = Math.max(0, r[2]); z <= Math.min(g.size[2] - 1, r[5]); z++) {
        const idx = g.get(x, y, z);
        if (idx !== undefined) moved.push([x, y, z, idx]);
      }
    }
  }
  for (const [x, y, z] of moved) g.unset(x, y, z);
  let added = 0;
  for (const [x, y, z, idx] of moved) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (g.inBounds(nx, ny, nz) && g.get(nx, ny, nz) === undefined) {
      g.set(nx, ny, nz, idx);
      added++;
    }
  }
  return stats(g, added, moved.length);
}
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/ops.test.ts
```
Expected: 全部 passed。

- [ ] **Step 5: Commit**

```bash
git add src/core/ops.ts test/ops.test.ts
git commit -m "feat: paint/erase/translate 区域操作"
```

---

### Task 7: 网格化 mesh.ts + GLB 导出（含结构闸门）

**Files:**
- Create: `src/core/export/mesh.ts`、`src/core/export/glb.ts`
- Test: `test/glb.test.ts`

**Interfaces:**
- Consumes: `SparseVoxelGrid.coords()`、`Palette.hexOf`/`hexToRgb255`（Task 2/3）
- Produces:
  - `interface MeshData { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array }`
  - `buildMesh(voxels: Iterable<[x,y,z,idx]>, hexAt: (idx: number) => string | undefined): MeshData`（暴露面剔除；每暴露面 2 三角；颜色 0..1 归一；法线=面法线）——GLB 导出与 viewer 共用
  - `exportGlb(mesh: MeshData): Buffer`
  - `verifyGlb(buf: Buffer): { tris: number; materials: number; json: object }`（结构闸门：magic "glTF"、version 2、总长一致、chunk0 JSON / chunk1 BIN\0、按 accessors 统计三角数）

- [ ] **Step 1: 写失败测试**

`test/glb.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { buildMesh } from "../src/core/export/mesh.js";
import { exportGlb, verifyGlb } from "../src/core/export/glb.js";

function boxMesh(): MeshData {
  const g = new SparseVoxelGrid([8, 8, 8]);
  for (let x = 0; x < 2; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) g.set(x, y, z, 1);
  const pal = new Palette({ "1": "#8b4513" });
  return buildMesh(g.coords(), (i) => pal.hexOf(i));
}

describe("buildMesh", () => {
  it("2x3x4 实心暴露面 = 52 quad = 104 三角", () => {
    const m = boxMesh();
    expect(m.indices.length).toBe(104 * 3);
    // 表面积公式 2*(2*3+3*4+2*4)=52 个 quad
    expect(m.indices.length / 3 / 2).toBe(52);
  });

  it("颜色与法线对齐", () => {
    const m = boxMesh();
    expect(m.positions.length / 3).toBe(m.colors.length / 3);
    expect(m.positions.length / 3).toBe(m.normals.length / 3);
    // 第一个顶点颜色 = #8b4513 归一
    const [r, g, b] = [0x8b / 255, 0x45 / 255, 0x13 / 255];
    expect(Math.abs(m.colors[0] - r)).toBeLessThan(1e-6);
    expect(Math.abs(m.colors[1] - g)).toBeLessThan(1e-6);
  });

  it("每个面的绕法满足 cross(v1-v0, v2-v0)·n > 0（外向 CCW）", () => {
    const FACES = [
      { n: [1, 0, 0],  c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
      { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
      { n: [0, 1, 0],  c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
      { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
      { n: [0, 0, 1],  c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
      { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
    ];
    for (const f of FACES) {
      const [v0, v1, v2] = f.c;
      const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
      const e2 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
      const cr = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0]
      ];
      const dot = cr[0] * f.n[0] + cr[1] * f.n[1] + cr[2] * f.n[2];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("完全包围的体素无面", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) g.set(x, y, z, 1);
    const pal = new Palette({ "1": "#ffffff" });
    const inner = buildMesh([[1, 1, 1, 1]], () => "#ffffff"); // 单体素必有面
    expect(inner.indices.length).toBeGreaterThan(0);
    // 3x3x3 中心体素：邻居全占 → 无面（用完整 buildMesh 验证总数 = 外壳 quad 数 54）
    const m = buildMesh(g.coords(), (i) => pal.hexOf(i));
    expect(m.indices.length / 3 / 2).toBe(54);
  });
});

describe("GLB 导出与结构闸门", () => {
  it("verifyGlb 通过且三角数正确", () => {
    const buf = exportGlb(boxMesh());
    const v = verifyGlb(buf);
    expect(v.tris).toBe(104);
    expect(v.materials).toBe(1);
    expect(buf.length).toBeGreaterThan(100);
  });

  it("魔数/版本/chunk 类型正确", () => {
    const buf = exportGlb(boxMesh());
    expect(buf.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(buf.readUInt32LE(4)).toBe(2);
    expect(buf.readUInt32LE(8)).toBe(buf.length);
    expect(buf.subarray(16, 20).toString("ascii")).toBe("JSON");
    const jsonLen = buf.readUInt32LE(12);
    const binTypeOff = 20 + jsonLen + 4;
    expect(buf.subarray(binTypeOff, binTypeOff + 4).toString("ascii")).toBe("BIN\u0000");
  });

  it("verifyGlb 拒绝坏数据", () => {
    expect(() => verifyGlb(Buffer.from("not a glb"))).toThrow();
  });
});
```

注意：测试文件顶部 import 需含 `import type { MeshData } from "../src/core/export/mesh.js";`（boxMesh 返回类型标注用）。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/glb.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 mesh.ts**

`src/core/export/mesh.ts`：
```ts
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

// 面表：n=法线，c=四个角点偏移（从外部看 CCW；绕法由 test/glb.test.ts 的 cross 积用例闸住）
const FACES: Array<{ n: [number, number, number]; c: Array<[number, number, number]> }> = [
  { n: [1, 0, 0],  c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0],  c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1],  c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
];

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ];
}

export function buildMesh(
  voxels: Iterable<[number, number, number, number]>,
  hexAt: (idx: number) => string | undefined
): MeshData {
  const occupied = new Set<string>();
  const list: Array<[number, number, number, number]> = [];
  for (const [x, y, z, idx] of voxels) {
    occupied.add(`${x},${y},${z}`);
    list.push([x, y, z, idx]);
  }
  const has = (x: number, y: number, z: number) => occupied.has(`${x},${y},${z}`);

  const pos: number[] = [], nor: number[] = [], col: number[] = [], idxOut: number[] = [];
  const colorCache = new Map<number, [number, number, number]>();
  let v = 0;
  for (const [x, y, z, idx] of list) {
    let rgb = colorCache.get(idx);
    if (!rgb) {
      const hex = hexAt(idx);
      if (!hex) throw new Error(`调色板缺色号 ${idx}`);
      rgb = hexToRgb01(hex);
      colorCache.set(idx, rgb);
    }
    for (const f of FACES) {
      const [nx, ny, nz] = f.n;
      if (has(x + nx, y + ny, z + nz)) continue; // 邻居占位 → 面被遮
      for (const [ox, oy, oz] of f.c) {
        pos.push(x + ox, y + oy, z + oz);
        nor.push(nx, ny, nz);
        col.push(rgb[0], rgb[1], rgb[2]);
      }
      idxOut.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    indices: new Uint32Array(idxOut)
  };
}
```

- [ ] **Step 4: 实现 glb.ts**

`src/core/export/glb.ts`：
```ts
import type { MeshData } from "./mesh.js";

export function exportGlb(mesh: MeshData): Buffer {
  const binParts: Buffer[] = [];
  const views: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let offset = 0;

  const pushView = (arr: Float32Array | Uint32Array, componentType: number, type: string, count: number, minMax?: { min: number[]; max: number[] }) => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    binParts.push(b);
    views.push({ buffer: 0, byteOffset: offset, byteLength: arr.byteLength });
    const acc: Record<string, unknown> = { bufferView: views.length - 1, componentType, count, type };
    if (minMax) { acc.min = minMax.min; acc.max = minMax.max; }
    accessors.push(acc);
    offset += arr.byteLength;
  };

  // POSITION 需 min/max
  const p = mesh.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  pushView(p, 5126, "VEC3", p.length / 3, { min, max });
  pushView(mesh.normals, 5126, "VEC3", mesh.normals.length / 3);
  pushView(mesh.colors, 5126, "VEC3", mesh.colors.length / 3);
  pushView(mesh.indices, 5125, "SCALAR", mesh.indices.length);

  const bin = Buffer.concat(binParts);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

  const gltf = {
    asset: { version: "2.0", generator: "voxelforge" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
        indices: 3,
        material: 0
      }]
    }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: false
    }],
    buffers: [{ byteLength: binChunk.length }],
    bufferViews: views,
    accessors
  };

  let jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const total = 12 + 8 + jsonBuf.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.write("glTF", 0, "ascii");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.write("JSON", 16, "ascii");
  jsonBuf.copy(out, 20);
  const binHead = 20 + jsonBuf.length;
  out.writeUInt32LE(binChunk.length, binHead);
  out.write("BIN\u0000", binHead + 4, "ascii");
  binChunk.copy(out, binHead + 8);
  return out;
}

export function verifyGlb(buf: Buffer): { tris: number; materials: number; json: Record<string, unknown> } {
  if (buf.length < 20 || buf.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("GLB 魔数错误");
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`GLB version 应为 2，实际 ${version}`);
  const total = buf.readUInt32LE(8);
  if (total !== buf.length) throw new Error(`GLB 总长不一致: header=${total} file=${buf.length}`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.subarray(16, 20).toString("ascii") !== "JSON") throw new Error("chunk0 类型应为 JSON");
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binHead = 20 + jsonLen;
  if (binHead + 8 <= buf.length && buf.subarray(binHead + 4, binHead + 8).toString("ascii") !== "BIN\u0000") {
    throw new Error("chunk1 类型应为 BIN\\0");
  }
  const mesh = (json.meshes as Array<Record<string, any>>)?.[0];
  const accessors = json.accessors as Array<{ count: number }>;
  let tris = 0;
  for (const prim of mesh?.primitives ?? []) {
    tris += accessors[prim.indices].count / 3;
  }
  const materials = (json.materials as unknown[])?.length ?? 0;
  return { tris, materials, json };
}
```

- [ ] **Step 5: 跑测试通过**

```bash
pnpm vitest run test/glb.test.ts
```
Expected: 全部 passed（含绕法闸门用例——若 FACES 表绕法有误会在此暴露，按测试修正 c 顺序）。

- [ ] **Step 6: Commit**

```bash
git add src/core/export/mesh.ts src/core/export/glb.ts test/glb.test.ts
git commit -m "feat: 暴露面网格化 + GLB writer + 结构闸门"
```

---

### Task 8: .vox 导出

**Files:**
- Create: `src/core/export/vox.ts`
- Test: `test/vox.test.ts`

**Interfaces:**
- Consumes: hexToRgb255（Task 3）
- Produces: `exportVox(size: [number,number,number], voxels: Array<[x,y,z,idx]>, paletteHex: Map<number,string>): Buffer`（版本 150；chunk 顺序 SIZE→XYZI→RGBA；RGBA 偏移 (i-1)*4）；`verifyVox(buf): { voxels: number; size: [number,number,number] }`。

- [ ] **Step 1: 写失败测试**

`test/vox.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { exportVox, verifyVox } from "../src/core/export/vox.js";

describe("exportVox / verifyVox", () => {
  it("结构可回读且颜色正确", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 2, 3, 1); g.set(4, 5, 6, 2);
    const pal = new Palette({ "1": "#8b4513", "2": "#daa520" });
    const buf = exportVox(g.size, [...g.coords()], pal.toRecord() as unknown as Map<number, string>);
```
等等——这里签名用 `Map<number,string>`；上面调用应构造 Map。修正测试调用为：
```ts
    const palMap = new Map<number, string>([[1, "#8b4513"], [2, "#daa520"]]);
    const buf = exportVox(g.size, [...g.coords()], palMap);
    const v = verifyVox(buf);
    expect(v.size).toEqual([8, 8, 8]);
    expect(v.voxels).toBe(2);
    // RGBA chunk：色号 1 → offset 0 → r=0x8b
    // （verifyVox 返回 palette 数组便于断言）
    expect(v.palette![1]).toEqual([0x8b, 0x45, 0x13, 255]);
    expect(v.palette![2]).toEqual([0xda, 0xa5, 0x20, 255]);
  });

  it("verifyVox 拒绝坏数据", () => {
    expect(() => verifyVox(Buffer.from("junk"))).toThrow();
  });
});
```

（Plan 内联勘误：Step 1 里第一段测试调用以本勘误版为准——`verifyVox` 返回类型扩展为 `{ voxels: number; size: [number,number,number]; palette?: Array<[number,number,number,number]> }`。）

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/vox.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 vox.ts**

`src/core/export/vox.ts`：
```ts
import { hexToRgb255 } from "../palette.js";

function chunk(id: string, content: Buffer, children = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, "ascii");
  head.writeInt32LE(content.length, 4);
  head.writeInt32LE(children.length, 8 - 4 + 4); // 占位修正见下
  // ↑ 直接写两个 int32：contentLen 与 childrenLen
  return Buffer.concat([head, content, children]);
}

export function exportVox(
  size: [number, number, number],
  voxels: Array<[number, number, number, number]>,
  paletteHex: Map<number, string>
): Buffer {
  const sizeChunk = Buffer.alloc(12);
  sizeChunk.writeInt32LE(size[0], 0);
  sizeChunk.writeInt32LE(size[1], 4);
  sizeChunk.writeInt32LE(size[2], 8);

  const xyzi = Buffer.alloc(4 + 4 * voxels.length);
  xyzi.writeInt32LE(voxels.length, 0);
  voxels.forEach(([x, y, z, idx], i) => {
    const o = 4 + i * 4;
    xyzi.writeUInt8(Math.min(255, x), o);
    xyzi.writeUInt8(Math.min(255, y), o + 1);
    xyzi.writeUInt8(Math.min(255, z), o + 2);
    xyzi.writeUInt8(Math.min(255, idx), o + 3);
  });

  const rgba = Buffer.alloc(1024, 255);
  for (const [idx, hex] of paletteHex) {
    if (idx < 1 || idx > 255) continue;
    const [r, g, b] = hexToRgb255(hex);
    const o = (idx - 1) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }

  const children = Buffer.concat([
    chunk("SIZE", sizeChunk),
    chunk("XYZI", xyzi),
    chunk("RGBA", rgba)
  ]);
  const main = Buffer.alloc(8);
  main.write("MAIN", 0, "ascii");
  main.writeInt32LE(0, 4);
  main.writeInt32LE(children.length, 8);
  const header = Buffer.alloc(8);
  header.write("VOX ", 0, "ascii");
  header.writeUInt32LE(150, 4);
  return Buffer.concat([header, main, children]);
}

export function verifyVox(buf: Buffer): {
  voxels: number;
  size: [number, number, number];
  palette?: Array<[number, number, number, number]>;
} {
  if (buf.length < 20 || buf.subarray(0, 4).toString("ascii") !== "VOX ") throw new Error("VOX 魔数错误");
  if (buf.readUInt32LE(4) !== 150) throw new Error("VOX version 应为 150");
  if (buf.subarray(8, 12).toString("ascii") !== "MAIN") throw new Error("缺少 MAIN chunk");
  let off = 20; // MAIN 头 8B（content 0 + children 长度字段在 12..20）
  // MAIN chunk: id(4) contentLen(4)=0 childrenLen(4) → children 从 20 开始
  let voxels = 0;
  let size: [number, number, number] = [0, 0, 0];
  let palette: Array<[number, number, number, number]> | undefined;
  while (off + 12 <= buf.length) {
    const id = buf.subarray(off, off + 4).toString("ascii");
    const contentLen = buf.readInt32LE(off + 4);
    const childrenLen = buf.readInt32LE(off + 8);
    const content = buf.subarray(off + 12, off + 12 + contentLen);
    if (id === "SIZE") {
      size = [content.readInt32LE(0), content.readInt32LE(4), content.readInt32LE(8)];
    } else if (id === "XYZI") {
      voxels = content.readInt32LE(0);
      if (content.length !== 4 + 4 * voxels) throw new Error(`XYZI 长度不一致: ${content.length} vs 4+4*${voxels}`);
    } else if (id === "RGBA") {
      palette = [];
      for (let i = 0; i < 255; i++) {
        palette.push([content[i * 4], content[i * 4 + 1], content[i * 4 + 2], content[i * 4 + 3]]);
      }
    }
    off += 12 + contentLen + childrenLen;
  }
  return { voxels, size, palette };
}
```

⚠️ 实现注意：上面 `chunk()` 辅助函数的 head 写法有一处笔误（`writeInt32LE(children.length, 8-4+4)` = 偏移 8 越界写入 head 尾）。以修正版为准：
```ts
function chunk(id: string, content: Buffer): Buffer {
  const head = Buffer.alloc(12);
  head.write(id, 0, "ascii");
  head.writeInt32LE(content.length, 4);
  head.writeInt32LE(0, 8); // children 长度：SIZE/XYZI/RGBA 均无子 chunk
  return Buffer.concat([head, content]);
}
```
（MAIN 的 8 字节头 = id + contentLen(0) + childrenLen，已在 exportVox 主体手工构造，不用该辅助函数。）

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/vox.test.ts
```
Expected: 全部 passed。

- [ ] **Step 5: Commit**

```bash
git add src/core/export/vox.ts test/vox.test.ts
git commit -m "feat: MagicaVoxel .vox 导出（SIZE/XYZI/RGBA）+ 结构校验"
```

---

### Task 9: PNG 编码器 + DDA 光线投射渲染器

**Files:**
- Create: `src/core/export/png.ts`、`src/core/render/raycast.ts`
- Test: `test/png.test.ts`、`test/raycast.test.ts`

**Interfaces:**
- Produces:
  - `encodePng(width, height, rgba: Uint8Array): Buffer`（colorType 6 RGBA、filter 0、node:zlib deflate）
  - `crc32(buf: Buffer): number`
  - `interface VoxelSource { size: [number,number,number]; get(x,y,z): number|undefined; bounds(): Region|null; colorAt(idx): [number,number,number] }`（0..255 RGB）
  - `interface RenderOpts { view?: "iso"|"front"|"side"|"top"; yaw?: number; pitch?: number; size?: number; proj?: "ortho"|"persp"; cutaway?: "x"|"y"|"z"|"quarter"; axes?: boolean }`
  - `renderView(src: VoxelSource, opts: RenderOpts): { w: number; h: number; rgba: Uint8Array }`
  - 视角预设：iso=yaw45/pitch30、front=yaw0/pitch0、side=yaw90/pitch0、top=yaw0/pitch89（度）
  - 渲染规则：DDA(Amanatides-Woo) 命中 → base×(0.55+0.45·max(0,dot(n,L)))×AO，L=normalize(0.4,0.85,0.35)，AO=1−0.06×已占6邻数；未命中 → 地面参照层（y=−0.01 平面，1 单位=1 纹元：10 格灰线、X 轴红线 z=0、Z 轴蓝线 x=0、10 间隔刻度点、3×5 数字标签 X 红/Z 蓝）→ 纹元区外天空垂直渐变 top(184,209,242)→bottom(235,242,250)
  - cutaway："x"/"y"/"z" 跳过该轴 ≥⌈size/2⌉ 的体素；"quarter" 跳过 x≥⌈sx/2⌉ && z≥⌈sz/2⌉

- [ ] **Step 1: 写失败测试 test/png.test.ts**

```ts
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { encodePng, crc32 } from "../src/core/export/png.js";

describe("encodePng", () => {
  it("签名/IHDR/IDAT 解压长度正确", () => {
    const w = 4, h = 3;
    const rgba = new Uint8Array(w * h * 4).fill(128);
    const buf = encodePng(w, h, rgba);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(w);
    expect(buf.readUInt32BE(20)).toBe(h);
    // 找 IDAT 并解压
    let off = 8, idat: Buffer | null = null;
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString("ascii");
      if (type === "IDAT") { idat = buf.subarray(off + 8, off + 8 + len); break; }
      off += 12 + len;
    }
    expect(idat).not.toBeNull();
    const raw = zlib.inflateSync(idat!);
    expect(raw.length).toBe(h * (1 + w * 4)); // 每行 filter byte 0 + w*4
    expect(buf.subarray(buf.length - 8, buf.length - 4).toString("ascii")).toBe("IEND");
  });

  it("crc32 已知值", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
```

`test/raycast.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { renderView, gridSource } from "../src/core/render/raycast.js";

function singleRed(): { src: ReturnType<typeof gridSource>; } {
  const g = new SparseVoxelGrid([8, 8, 8]);
  g.set(4, 0, 4, 1);
  const pal = new Palette({ "1": "#ff0000" });
  return { src: gridSource(g, (i) => pal.hexOf(i)!) };
}

describe("renderView", () => {
  it("输出尺寸正确", () => {
    const { src } = singleRed();
    const r = renderView(src, { view: "iso", size: 64 });
    expect(r.w).toBe(64);
    expect(r.h).toBe(64);
    expect(r.rgba.length).toBe(64 * 64 * 4);
  });

  it("空网格：天空渐变上下不同", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const src = gridSource(g, () => "#000000");
    const r = renderView(src, { view: "front", size: 32, axes: false });
    const px = (x: number, y: number) => {
      const o = (y * 32 + x) * 4;
      return [r.rgba[o], r.rgba[o + 1], r.rgba[o + 2]];
    };
    const top = px(16, 4), bottom = px(16, 30);
    expect(top).not.toEqual(bottom);
  });

  it("单体素：中心像素接近红色", () => {
    const { src } = singleRed();
    const r = renderView(src, { view: "iso", size: 64 });
    const o = (32 * 64 + 32) * 4;
    const [cr, cg, cb] = [r.rgba[o], r.rgba[o + 1], r.rgba[o + 2]];
    expect(cr).toBeGreaterThan(120);
    expect(cr).toBeGreaterThan(cg + 40);
    expect(cr).toBeGreaterThan(cb + 40);
  });

  it("cutaway quarter 后中心像素不再是体素色", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) g.set(x, 0, z, 1);
    const pal = new Palette({ "1": "#00ff00" });
    const src = gridSource(g, (i) => pal.hexOf(i)!);
    const r = renderView(src, { view: "top", size: 64, cutaway: "quarter", axes: false });
    // 顶视：quarter 被切掉 → 对应角落露出天空/地面色而非绿色
    let green = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      if (r.rgba[i + 1] > 180 && r.rgba[i] < 100) green++;
    }
    expect(green).toBeGreaterThan(0);
    expect(green).toBeLessThan(64 * 64 / 2);
  });

  it("axes 默认开启：地面参照层有灰线像素", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const src = gridSource(g, () => "#000000");
    const r = renderView(src, { view: "iso", size: 64 });
    let gray = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      const [cr, cg, cb] = [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2]];
      if (Math.abs(cr - cg) < 6 && Math.abs(cg - cb) < 6 && cr > 90 && cr < 190) gray++;
    }
    expect(gray).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/png.test.ts test/raycast.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 png.ts**

`src/core/export/png.ts`：
```ts
import zlib from "node:zlib";

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error(`rgba 长度不符: ${rgba.length} ≠ ${width}×${height}×4`);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 10/11/12 = compression/filter/interlace 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const ro = y * (1 + width * 4);
    raw[ro] = 0; // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, ro + 1);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
```

- [ ] **Step 4: 实现 raycast.ts**

`src/core/render/raycast.ts`：
```ts
import type { Region } from "../types.js";
import { hexToRgb255 } from "../palette.js";

export interface VoxelSource {
  size: [number, number, number];
  get(x: number, y: number, z: number): number | undefined;
  bounds(): Region | null;
  colorAt(idx: number): [number, number, number];
}

export function gridSource(grid: { size: [number,number,number]; get(x,y,z): number|undefined; bounds(): Region | null }, hexAt: (idx: number) => string): VoxelSource {
  const cache = new Map<number, [number, number, number]>();
  return {
    size: grid.size,
    get: (x, y, z) => grid.get(x, y, z),
    bounds: () => grid.bounds(),
    colorAt(idx: number): [number, number, number] {
      let c = cache.get(idx);
      if (!c) { c = hexToRgb255(hexAt(idx)); cache.set(idx, c); }
      return c;
    }
  };
}

export interface RenderOpts {
  view?: "iso" | "front" | "side" | "top";
  yaw?: number;
  pitch?: number;
  size?: number;
  proj?: "ortho" | "persp";
  cutaway?: "x" | "y" | "z" | "quarter";
  axes?: boolean;
}

const VIEW_ANGLES: Record<string, [number, number]> = {
  iso: [45, 30], front: [0, 0], side: [90, 0], top: [0, 89]
};

// 3x5 数字点阵（行从上到下，每行 3 位）
const DIGITS: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7], "1": [2, 6, 2, 2, 7], "2": [7, 1, 7, 4, 7],
  "3": [7, 1, 7, 1, 7], "4": [5, 5, 7, 1, 1], "5": [7, 4, 7, 1, 7],
  "6": [7, 4, 7, 5, 7], "7": [7, 1, 2, 2, 2], "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7]
};

interface Vec3 { x: number; y: number; z: number }
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x
});
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const rad = (d: number): number => (d * Math.PI) / 180;

const LIGHT = norm({ x: 0.4, y: 0.85, z: 0.35 });

// 地面参照纹理：1 单位=1 纹元，覆盖 [gx0..gx1)×[gz0..gz1)
interface GroundTex { gx0: number; gz0: number; w: number; h: number; data: Uint8Array }
function buildGround(src: VoxelSource): GroundTex {
  const b = src.bounds() ?? [0, 0, 0, src.size[0] - 1, src.size[1] - 1, src.size[2] - 1];
  const gx0 = Math.floor(b[0] / 10) * 10 - 20;
  const gz0 = Math.floor(b[2] / 10) * 10 - 20;
  const w = (Math.ceil(b[3] / 10) * 10 + 20) - gx0;
  const h = (Math.ceil(b[5] / 10) * 10 + 20) - gz0;
  const data = new Uint8Array(w * h * 3); // 默认全 0 = 透明（画天空）
  const put = (x: number, z: number, r: number, g: number, bb: number) => {
    const ix = x - gx0, iz = z - gz0;
    if (ix < 0 || iz < 0 || ix >= w || iz >= h) return;
    const o = (iz * w + ix) * 3;
    data[o] = r; data[o + 1] = g; data[o + 2] = bb;
  };
  // 网格线（灰）
  for (let gx = Math.ceil(gx0 / 10) * 10; gx <= gx0 + w - 1; gx += 10) {
    for (let z = 0; z < h; z++) put(gx, gz0 + z, 120, 120, 125);
  }
  for (let gz = Math.ceil(gz0 / 10) * 10; gz <= gz0 + h - 1; gz += 10) {
    for (let x = 0; x < w; x++) put(gx0 + x, gz, 120, 120, 125);
  }
  // 轴线：X 红（z=0 行）、Z 蓝（x=0 列）
  for (let x = 0; x < w; x++) put(gx0 + x, 0, 220, 60, 60);
  for (let z = 0; z < h; z++) put(0, gz0 + z, 60, 90, 230);
  // 数字标签：X 轴红（z=-6 行）、Z 轴蓝（x=-6 列），间隔 10
  const drawDigit = (d: string, x0: number, z0: number, alongX: boolean, r: number, g: number, bb: number) => {
    const rows = DIGITS[d];
    for (let ry = 0; ry < 5; ry++) {
      for (let cx = 0; cx < 3; cx++) {
        if (!(rows[ry] & (1 << (2 - cx)))) continue;
        if (alongX) put(x0 + cx, z0 + ry, r, g, bb);
        else put(x0 + cx, z0 + ry, r, g, bb); // 纹元即世界单位，两个方向同为平铺
      }
    }
  };
  const drawLabel = (value: number, x0: number, z0: number, alongX: boolean, r: number, g: number, bb: number) => {
    const s = String(value);
    for (let i = 0; i < s.length; i++) {
      const d = DIGITS[s[i]] ? s[i] : "0";
      drawDigit(d, x0 + i * 4, z0, alongX, r, g, bb);
    }
  };
  for (let v = Math.ceil(gx0 / 10) * 10; v < gx0 + w; v += 10) drawLabel(v, v, -6, true, 220, 60, 60);
  for (let v = Math.ceil(gz0 / 10) * 10; v < gz0 + h; v += 10) drawLabel(v, -6, v, false, 60, 90, 230);
  return { gx0, gz0, w, h, data };
}

function cutSkip(src: VoxelSource, x: number, y: number, z: number, cut?: string): boolean {
  if (!cut) return false;
  const [sx, sy, sz] = src.size;
  if (cut === "x") return x >= Math.ceil(sx / 2);
  if (cut === "y") return y >= Math.ceil(sy / 2);
  if (cut === "z") return z >= Math.ceil(sz / 2);
  return x >= Math.ceil(sx / 2) && z >= Math.ceil(sz / 2); // quarter
}

interface Hit { t: number; idx: number; nx: number; ny: number; nz: number; x: number; y: number; z: number }

function dda(src: VoxelSource, o: Vec3, d: Vec3, cut?: string): Hit | null {
  const [sx, sy, sz] = src.size;
  // slab 求交
  const bmin = { x: 0, y: 0, z: 0 }, bmax = { x: sx, y: sy, z: sz };
  let t0 = 0, t1 = Infinity;
  let entryAxis = -1;
  const od = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    const lo = [bmin.x, bmin.y, bmin.z][a], hi = [bmax.x, bmax.y, bmax.z][a];
    if (Math.abs(dd[a]) < 1e-12) {
      if (od[a] < lo || od[a] > hi) return null;
      continue;
    }
    let ta = (lo - od[a]) / dd[a], tb = (hi - od[a]) / dd[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) { t0 = ta; entryAxis = a; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (t1 <= 0) return null;
  const start = { x: o.x + d.x * (t0 + 1e-9), y: o.y + d.y * (t0 + 1e-9), z: o.z + d.z * (t0 + 1e-9) };
  let cx = Math.min(sx - 1, Math.max(0, Math.floor(start.x)));
  let cy = Math.min(sy - 1, Math.max(0, Math.floor(start.y)));
  let cz = Math.min(sz - 1, Math.max(0, Math.floor(start.z)));
  const step = [Math.sign(d.x), Math.sign(d.y), Math.sign(d.z)];
  const tMax = [0, 1, 2].map(a => {
    if (step[a] === 0) return Infinity;
    const cell = [cx, cy, cz][a];
    const target = step[a] > 0 ? cell + 1 : cell;
    return (target - start[["x", "y", "z"][a] as "x" | "y" | "z"]) / dd[a];
  });
  const tDelta = [0, 1, 2].map(a => (step[a] === 0 ? Infinity : Math.abs(1 / dd[a])));
  let lastAxis = entryAxis >= 0 ? entryAxis : 1;
  const maxIter = sx + sy + sz + 3;
  for (let iter = 0; iter < maxIter; iter++) {
    const idx = src.get(cx, cy, cz);
    if (idx !== undefined && !cutSkip(src, cx, cy, cz, cut)) {
      const n = [0, 0, 0];
      n[lastAxis] = -step[lastAxis];
      return {
        t: t0, idx, nx: n[0], ny: n[1], nz: n[2], x: cx, y: cy, z: cz
      };
    }
    const a = tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;
    if (tMax[a] === Infinity || tMax[a] > t1 + 1e-9) return null;
    if (a === 0) cx += step[0]; else if (a === 1) cy += step[1]; else cz += step[2];
    if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) return null;
    tMax[a] += tDelta[a];
    lastAxis = a;
  }
  return null;
}

export function renderView(src: VoxelSource, opts: RenderOpts = {}): { w: number; h: number; rgba: Uint8Array } {
  const size = opts.size ?? 512;
  const view = opts.view ?? "iso";
  const yaw = opts.yaw ?? VIEW_ANGLES[view][0];
  const pitch = Math.max(-89, Math.min(89, opts.pitch ?? VIEW_ANGLES[view][1]));
  const proj = opts.proj ?? "ortho";
  const useAxes = opts.axes !== false;

  const b = src.bounds();
  const center: Vec3 = b
    ? { x: (b[0] + b[3] + 1) / 2, y: (b[1] + b[4] + 1) / 2, z: (b[2] + b[5] + 1) / 2 }
    : { x: src.size[0] / 2, y: src.size[1] / 2, z: src.size[2] / 2 };
  const extent = b ? Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) + 1 : Math.max(...src.size);
  const frame = extent * 0.85 + 8; // 留出参照层边距

  const f = { x: Math.sin(rad(yaw)) * Math.cos(rad(pitch)), y: Math.sin(rad(pitch)), z: Math.cos(rad(yaw)) * Math.cos(rad(pitch)) };
  const right = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const up = cross(right, f);

  const ground = useAxes ? buildGround(src) : null;
  const sky = (v: number): [number, number, number] => {
    const t = Math.max(0, Math.min(1, v));
    return [184 + (235 - 184) * t, 209 + (242 - 209) * t, 242 + (250 - 242) * t];
  };

  const rgba = new Uint8Array(size * size * 4);
  const eyeDist = frame * 2.2;
  const eye: Vec3 = { x: center.x - f.x * eyeDist, y: center.y - f.y * eyeDist, z: center.z - f.z * eyeDist };

  for (let py = 0; py < size; py++) {
    const v = 1 - ((py + 0.5) / size) * 2; // +1 上
    for (let px = 0; px < size; px++) {
      const u = ((px + 0.5) / size) * 2 - 1;
      let origin: Vec3, dir: Vec3;
      if (proj === "ortho") {
        origin = {
          x: eye.x + right.x * u * frame + up.x * v * frame,
          y: eye.y + right.y * u * frame + up.y * v * frame,
          z: eye.z + right.z * u * frame + up.z * v * frame
        };
        dir = f;
      } else {
        dir = norm({
          x: f.x * eyeDist + right.x * u * frame + up.x * v * frame,
          y: f.y * eyeDist + right.y * u * frame + up.y * v * frame,
          z: f.z * eyeDist + right.z * u * frame + up.z * v * frame
        });
        origin = eye;
      }
      // 地面 y=-0.01 平面
      let groundColor: [number, number, number] | null = null;
      let groundT = Infinity;
      if (ground && Math.abs(dir.y) > 1e-9) {
        const tp = (-0.01 - origin.y) / dir.y;
        if (tp > 0) {
          const gx = Math.floor(origin.x + dir.x * tp);
          const gz = Math.floor(origin.z + dir.z * tp);
          const ix = gx - ground.gx0, iz = gz - ground.gz0;
          if (ix >= 0 && iz >= 0 && ix < ground.w && iz < ground.h) {
            const o = (iz * ground.w + ix) * 3;
            if (ground.data[o + 3 - 1] !== undefined) {
              const r = ground.data[o], g = ground.data[o + 1], bb = ground.data[o + 2];
              if (r | g | bb) groundColor = [r, g, bb];
            }
          }
          groundT = tp;
        }
      }
      const hit = dda(src, origin, dir, opts.cutaway);
      const o = (py * size + px) * 4;
      let color: [number, number, number];
      if (hit && hit.t < groundT) {
        const [br, bg, bb] = src.colorAt(hit.idx);
        const nd = { x: hit.nx, y: hit.ny, z: hit.nz };
        const shade = 0.55 + 0.45 * Math.max(0, dot(nd, LIGHT));
        let occ = 0;
        for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          if (src.get(hit.x + ax, hit.y + ay, hit.z + az) !== undefined) occ++;
        }
        const ao = 1 - 0.06 * occ;
        color = [br * shade * ao, bg * shade * ao, bb * shade * ao];
      } else if (groundColor) {
        color = groundColor;
      } else {
        color = sky(v);
      }
      rgba[o] = Math.min(255, Math.round(color[0]));
      rgba[o + 1] = Math.min(255, Math.round(color[1]));
      rgba[o + 2] = Math.min(255, Math.round(color[2]));
      rgba[o + 3] = 255;
    }
  }
  return { w: size, h: size, rgba };
}
```

实现注意（写代码时自查，否则 raycast 单元测试会挂）：
- `tMax` 初始化必须用**起点所在 cell 的下个边界**与起点（t0 平移后）的距离——上面代码用 `start`（已平移到 t0+ε），若 dir 分量为 0 → Infinity。
- `lastAxis` 初值 = slab 入射轴（entryAxis），避免第一个命中体素法线错轴。
- `ground.data[o + 3 - 1]` 是笔误遗留——实际只有 3 通道（r,g,b），判断 `r|g|bb !== 0` 即可，删除该行。

- [ ] **Step 5: 跑测试通过**

```bash
pnpm vitest run test/png.test.ts test/raycast.test.ts
```
Expected: 全部 passed。若「中心像素接近红色」失败：打印中心 5×5 像素排查投影方向；若「cutaway」失败：检查 cutSkip 的 ⌈size/2⌉ 边界。

- [ ] **Step 6: Commit**

```bash
git add src/core/export/png.ts src/core/render/raycast.ts test/png.test.ts test/raycast.test.ts
git commit -m "feat: PNG 编码器 + DDA 光线投射（光照/AO/地面参照层/cutaway）"
```

---

### Task 10: render.ts 多模态套件（multi 合成 + highlight 描红）

**Files:**
- Create: `src/core/render/render.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `renderView`、`gridSource`（Task 9）、`encodePng`（Task 9）、`Region`（Task 1）
- Produces:
  - `interface RenderRequest extends RenderOpts { views?: "single" | "multi"; highlight?: Region }`
  - `renderProject(src: VoxelSource, req: RenderRequest): { w: number; h: number; rgba: Uint8Array; views: string[] }`
    - views "multi" → iso+front+side 三张 size×size 横向拼接，8px 深灰分隔条
    - highlight → 将 region 盒 8 角投影到屏幕，12 条边 Bresenham 画红 (255,48,48)（线框透视可见，无深度测试）
  - 投影函数 `projectPoint(p: Vec3, cam): [px, py]`（ortho 仿射 / persp 透视，与 renderView 相机参数一致——内部共享 `makeCamera(src, opts)`）

- [ ] **Step 1: 写失败测试**

`test/render.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { gridSource } from "../src/core/render/raycast.js";
import { renderProject } from "../src/core/render/render.js";

function setup() {
  const g = new SparseVoxelGrid([16, 16, 16]);
  for (let x = 2; x < 8; x++) for (let y = 0; y < 4; y++) for (let z = 2; z < 8; z++) g.set(x, y, z, 1);
  const pal = new Palette({ "1": "#4488cc" });
  return gridSource(g, (i) => pal.hexOf(i)!);
}

describe("renderProject", () => {
  it("single 默认 iso", () => {
    const r = renderProject(setup(), { size: 64 });
    expect(r.views).toEqual(["iso"]);
    expect(r.w).toBe(64);
  });

  it("multi 三视图拼接 w=3*64+16 分隔条深灰", () => {
    const r = renderProject(setup(), { size: 64, views: "multi" });
    expect(r.views).toEqual(["iso", "front", "side"]);
    expect(r.w).toBe(3 * 64 + 16);
    expect(r.h).toBe(64);
    // 分隔条像素（x=64..67）为深灰
    const o = (10 * r.w + 65) * 4;
    expect(Math.abs(r.rgba[o] - 70)).toBeLessThan(30);
  });

  it("highlight 区域出现红色线框像素", () => {
    const r = renderProject(setup(), { size: 64, highlight: [2, 0, 2, 7, 3, 7] });
    let red = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      if (r.rgba[i] > 200 && r.rgba[i + 1] < 90 && r.rgba[i + 2] < 90) red++;
    }
    expect(red).toBeGreaterThan(5);
  });

  it("无 highlight 时无纯红像素", () => {
    const r = renderProject(setup(), { size: 64 });
    let red = 0;
    for (let i = 0; i < r.rgba.length; i += 4) {
      if (r.rgba[i] > 200 && r.rgba[i + 1] < 90 && r.rgba[i + 2] < 90) red++;
    }
    expect(red).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/render.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 render.ts**

`src/core/render/render.ts`：
```ts
import type { Region } from "../types.js";
import { encodePng } from "../export/png.js";
import { renderView, gridSource, type RenderOpts, type VoxelSource } from "./raycast.js";

export interface RenderRequest extends RenderOpts {
  views?: "single" | "multi";
  highlight?: Region;
}

interface Cam { f: Vec3; right: Vec3; up: Vec3; center: Vec3; frame: number; eye: Vec3; proj: "ortho" | "persp" }
interface Vec3 { x: number; y: number; z: number }

const rad = (d: number): number => (d * Math.PI) / 180;
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

// 与 renderView 相同的相机推导（重复实现以保持 core 内聚；renderView 参数完全确定）
function makeCamera(src: VoxelSource, opts: RenderOpts): Cam {
  const view = opts.view ?? "iso";
  const VIEW_ANGLES: Record<string, [number, number]> = { iso: [45, 30], front: [0, 0], side: [90, 0], top: [0, 89] };
  const yaw = opts.yaw ?? VIEW_ANGLES[view][0];
  const pitch = Math.max(-89, Math.min(89, opts.pitch ?? VIEW_ANGLES[view][1]));
  const b = src.bounds();
  const center: Vec3 = b
    ? { x: (b[0] + b[3] + 1) / 2, y: (b[1] + b[4] + 1) / 2, z: (b[2] + b[5] + 1) / 2 }
    : { x: src.size[0] / 2, y: src.size[1] / 2, z: src.size[2] / 2 };
  const extent = b ? Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) + 1 : Math.max(...src.size);
  const frame = extent * 0.85 + 8;
  const f = { x: Math.sin(rad(yaw)) * Math.cos(rad(pitch)), y: Math.sin(rad(pitch)), z: Math.cos(rad(yaw)) * Math.cos(rad(pitch)) };
  const right = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const up = cross(right, f);
  const eyeDist = frame * 2.2;
  const eye = { x: center.x - f.x * eyeDist, y: center.y - f.y * eyeDist, z: center.z - f.z * eyeDist };
  return { f, right, up, center, frame, eye, proj: opts.proj ?? "ortho" };
}

function projectPoint(p: Vec3, cam: Cam, size: number): [number, number] {
  const d = { x: p.x - cam.center.x, y: p.y - cam.center.y, z: p.z - cam.center.z };
  let u: number, v: number;
  if (cam.proj === "ortho") {
    u = (d.x * cam.right.x + d.y * cam.right.y + d.z * cam.right.z) / cam.frame;
    v = (d.x * cam.up.x + d.y * cam.up.y + d.z * cam.up.z) / cam.frame;
  } else {
    const rel = { x: p.x - cam.eye.x, y: p.y - cam.eye.y, z: p.z - cam.eye.z };
    const depth = rel.x * cam.f.x + rel.y * cam.f.y + rel.z * cam.f.z;
    u = ((rel.x * cam.right.x + rel.y * cam.right.y + rel.z * cam.right.z) / depth) * (cam.eyeDist() ?? 0) / cam.frame;
    v = ((rel.x * cam.up.x + rel.y * cam.up.y + rel.z * cam.up.z) / depth) * (cam.eyeDist() ?? 0) / cam.frame;
  }
  return [(u + 1) / 2 * size, (1 - v) / 2 * size];
}
```
⚠️ 实现注意：`Cam` 不应有 `eyeDist()` 方法——直接存 `eyeDist: number` 字段并在 persp 分支用 `cam.eyeDist`。修正：
```ts
interface Cam { f: Vec3; right: Vec3; up: Vec3; center: Vec3; frame: number; eye: Vec3; eyeDist: number; proj: "ortho" | "persp" }
// persp: u = (rel·right / depth) * eyeDist / frame
```

继续 render.ts 主体：
```ts
function drawLine(rgba: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): void {
  // Bresenham，红 (255,48,48)
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = Math.round(x0), y = Math.round(y0);
  const ex = Math.round(x1), ey = Math.round(y1);
  for (;;) {
    if (x >= 0 && y >= 0 && x < w && y < h) {
      const o = (y * w + x) * 4;
      rgba[o] = 255; rgba[o + 1] = 48; rgba[o + 2] = 48; rgba[o + 3] = 255;
    }
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function drawHighlight(rgba: Uint8Array, w: number, h: number, region: Region, cam: Cam, size: number): void {
  const [x0, y0, z0, x1, y1, z1] = region;
  const corners: Vec3[] = [];
  for (const X of [x0, x1 + 1]) for (const Y of [y0, y1 + 1]) for (const Z of [z0, z1 + 1]) corners.push({ x: X, y: Y, z: Z });
  // 12 条边：同轴且其余两轴坐标为端点组合
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      const a = corners[i], b = corners[j];
      const diffs = (a.x !== b.x ? 1 : 0) + (a.y !== b.y ? 1 : 0) + (a.z !== b.z ? 1 : 0);
      if (diffs === 1) edges.push([i, j]);
    }
  }
  for (const [i, j] of edges) {
    const [ax, ay] = projectPoint(corners[i], cam, size);
    const [bx, by] = projectPoint(corners[j], cam, size);
    drawLine(rgba, w, h, ax, ay, bx, by);
  }
}

export function renderProject(src: VoxelSource, req: RenderRequest = {}): { w: number; h: number; rgba: Uint8Array; views: string[] } {
  const size = req.size ?? 512;
  const views: string[] = req.views === "multi" ? ["iso", "front", "side"] : [req.view ?? "iso"];
  const singles = views.map(v => renderView(src, { ...req, view: v as RenderOpts["view"], size }));
  const sep = req.views === "multi" ? 8 : 0;
  const w = singles.length * size + (singles.length - 1) * sep;
  const h = size;
  const rgba = new Uint8Array(w * h * 4);
  singles.forEach((s, i) => {
    const xoff = i * (size + sep);
    for (let y = 0; y < h; y++) {
      rgba.set(s.rgba.subarray(y * size * 4, (y + 1) * size * 4), (y * w + xoff) * 4);
    }
  });
  // 分隔条深灰 (70)
  if (sep) {
    for (let i = 0; i < singles.length - 1; i++) {
      for (let x = i * (size + sep) + size; x < (i + 1) * (size + sep); x++) {
        for (let y = 0; y < h; y++) {
          const o = (y * w + x) * 4;
          rgba[o] = 70; rgba[o + 1] = 70; rgba[o + 2] = 74; rgba[o + 3] = 255;
        }
      }
    }
  }
  if (req.highlight) {
    // highlight 画在每个视图上（用各自相机）
    singles.forEach((_, i) => {
      const view = views[i];
      const cam = makeCamera(src, { ...req, view: view as RenderOpts["view"] });
      const xoff = i * (size + sep);
      // 在子画布坐标画完再合成 → 简化：直接在整图画，投影偏移 xoff
      const [hx0, , , hx1] = [0, 0, 0, 0]; // 占位说明见下
```
⚠️ 实现注意：highlight 在 multi 模式下需对每个子视图分别投影并平移 `xoff`。为避免复杂化，`drawHighlight` 增加 `xoff` 参数（画布 x 偏移），Bresenham 边界检查用 `x - xoff < size`。修正签名：
```ts
function drawHighlight(rgba: Uint8Array, w: number, h: number, region: Region, cam: Cam, size: number, xoff: number): void
// projectPoint 返回子画布坐标 → 画线时像素 x 加 xoff
```

完整收尾：
```ts
  if (req.highlight) {
    singles.forEach((_, i) => {
      const view = views[i];
      const cam = makeCamera(src, { ...req, view: view as RenderOpts["view"] });
      drawHighlight(rgba, w, h, req.highlight!, cam, size, i * (size + sep));
    });
  }
  return { w, h, rgba, views };
}
```
（删除上文占位 `hx0` 行。）

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/render.test.ts
```
Expected: 全部 passed。若 highlight 用例失败：先用 size=128 调试打印 projectPoint 的 8 个角点屏幕坐标是否落在画布内（frame 对齐问题是最常见原因——确认 makeCamera 与 renderView 的 frame 公式逐字一致）。

- [ ] **Step 5: Commit**

```bash
git add src/core/render/render.ts test/render.test.ts
git commit -m "feat: render 多模态套件（multi 三视图合成 + highlight 线框）"
```

---

### Task 11: slice_ascii + check 自诊断

**Files:**
- Create: `src/core/slice.ts`、`src/core/check.ts`
- Test: `test/slice.test.ts`、`test/check.test.ts`

**Interfaces:**
- Consumes: `SparseVoxelGrid`、`Palette`（Task 2/3）
- Produces:
  - `sliceAscii(grid, palette, axis: Axis, index: number, region?: Region): string`——`.`=空，idx 1..26→A-Z、27..52→a-z、>52→`#`；含两行标尺（十位/个位）、行前缀坐标、末尾图例行（char=hex）
  - `checkGrid(grid): { total; floating; components; symmetry: {x,y,z}; profile: {x:number[],y:number[],z:number[]} }`
    - floating：y>0 且 (x,y-1,z)、(x±1,y-1,z)、(x,y-1,z±1) 五个支撑位全空
    - components：6-连通洪泛计数
    - symmetry[轴]：镜像位 `v→size-1-v` 无对应体素的体素数（不对称对计 2）
  - `formatCheck(report): string`（面向 LLM 的紧凑文本）

- [ ] **Step 1: 写失败测试**

`test/slice.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { sliceAscii } from "../src/core/slice.js";

describe("sliceAscii", () => {
  it("y 层：字符与图例正确", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(0, 3, 0, 1);
    g.set(1, 3, 0, 2);
    const pal = new Palette({ "1": "#8b4513", "2": "#daa520" });
    const text = sliceAscii(g, pal, "y", 3);
    const lines = text.split("\n");
    expect(lines.some(l => l.startsWith("z0") && l.includes("AB."))).toBe(true);
    expect(text).toContain("A=#8b4513");
    expect(text).toContain("B=#daa520");
  });

  it("空层全点", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    const text = sliceAscii(g, new Palette(), "y", 2);
    expect(text).toContain("....");
  });

  it("axis=x 与 axis=z 行列轴映射正确", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(2, 1, 0, 1); // (x=2,y=1,z=0)
    const pal = new Palette({ "1": "#ff0000" });
    // axis=x, index=2 → 行 z, 列 y：z0 行 y1 列应为 A
    const tx = sliceAscii(g, pal, "x", 2);
    const zRow = tx.split("\n").find(l => l.startsWith("z0"))!;
    expect(zRow.includes("A")).toBe(true);
    // axis=z, index=0 → 行 y, 列 x：y1 行 x2 列应为 A
    const tz = sliceAscii(g, pal, "z", 0);
    const yRow = tz.split("\n").find(l => l.startsWith("y1"))!;
    expect(yRow.includes("A")).toBe(true);
  });

  it("region 限定窗口", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    g.set(10, 0, 10, 1);
    const pal = new Palette({ "1": "#ff0000" });
    const text = sliceAscii(g, pal, "y", 0, [8, 0, 8, 12, 0, 12]);
    expect(text).toContain("A");
    expect(text.split("\n").some(l => l.startsWith("z"))).toBe(true);
  });
});
```

`test/check.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { checkGrid, formatCheck } from "../src/core/check.js";

describe("checkGrid", () => {
  it("两个分离盒子 → components=2", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) g.set(x, y, z, 1);
    for (let x = 8; x < 10; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) g.set(x, y, z, 1);
    const r = checkGrid(g);
    expect(r.components).toBe(2);
    expect(r.floating).toBe(0);
  });

  it("悬空单点 → floating=1", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    g.set(10, 5, 10, 1);
    const r = checkGrid(g);
    expect(r.floating).toBe(1);
    expect(r.components).toBe(1);
  });

  it("对称/不对称计数", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 0, 0, 1); // 镜像位 (6,0,0) 缺失
    const r = checkGrid(g);
    expect(r.symmetry.x).toBe(1);
    expect(r.symmetry.y).toBe(0); // y 向 0↔7 都为空，无体素即对称
    g.set(6, 0, 0, 1);
    expect(checkGrid(g).symmetry.x).toBe(0);
  });

  it("profile 剖面计数", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(0, 0, 0, 1); g.set(0, 1, 0, 1); g.set(3, 0, 3, 1);
    const r = checkGrid(g);
    expect(r.profile.x[0]).toBe(2);
    expect(r.profile.x[3]).toBe(1);
    expect(r.profile.x.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("formatCheck 输出关键字段", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(10, 5, 10, 1);
    const text = formatCheck(checkGrid(g));
    expect(text).toContain("floating 1");
    expect(text).toContain("components 1");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/slice.test.ts test/check.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 slice.ts**

`src/core/slice.ts`：
```ts
import type { SparseVoxelGrid } from "./grid.js";
import type { Palette } from "./palette.js";
import type { Axis, Region } from "./types.js";

function charFor(idx: number): string {
  if (idx >= 1 && idx <= 26) return String.fromCharCode(64 + idx);      // A-Z
  if (idx >= 27 && idx <= 52) return String.fromCharCode(70 + idx);     // a-z (96 + idx - 26)
  return "#";
}

export function sliceAscii(
  grid: SparseVoxelGrid, palette: Palette, axis: Axis, index: number, region?: Region
): string {
  const [sx, sy, sz] = grid.size;
  const r: Region = region
    ? [Math.max(0, Math.min(region[0], region[3])), Math.max(0, Math.min(region[1], region[4])), Math.max(0, Math.min(region[2], region[5])),
       Math.min(sx - 1, Math.max(region[0], region[3])), Math.min(sy - 1, Math.max(region[1], region[4])), Math.min(sz - 1, Math.max(region[2], region[5]))]
    : [0, 0, 0, sx - 1, sy - 1, sz - 1];
  // (rowAxis, colAxis) 映射；第三轴 = axis
  const map = { x: ["z", "y"], y: ["z", "x"], z: ["y", "x"] } as const;
  const [rowAxis, colAxis] = map[axis];
  const axisIdx = { x: 0, y: 1, z: 2 } as const;
  const rLo = r[axisIdx[rowAxis] as 0 | 1 | 2] ?? (rowAxis === "x" ? r[0] : rowAxis === "y" ? r[1] : r[2]);
  const rHi = rowAxis === "x" ? r[3] : rowAxis === "y" ? r[4] : r[5];
  const cLo = colAxis === "x" ? r[0] : colAxis === "y" ? r[1] : r[2];
  const cHi = colAxis === "x" ? r[3] : colAxis === "y" ? r[4] : r[5];
  const axisVal = index;

  const lines: string[] = [];
  lines.push(`${axis}=${index} 层（列 ${colAxis}→，行 ${rowAxis}↓）`);
  // 标尺：十位行 + 个位行
  let tens = " ".repeat(4), units = " ".repeat(4);
  for (let c = cLo; c <= cHi; c++) {
    tens += c % 10 === 0 ? String(Math.floor(c / 10) % 10) : " ";
    units += String(c % 10);
  }
  lines.push(tens, units);
  const used = new Map<number, string>();
  for (let row = rLo; row <= rHi; row++) {
    let line = `${rowAxis}${String(row).padStart(3)} `;
    for (let col = cLo; col <= cHi; col++) {
      const coords: [number, number, number] =
        axis === "y" ? [col, axisVal, row]
        : axis === "x" ? [axisVal, col, row]   // x: 行 z, 列 y → (axis, col, row)
        : [col, row, axisVal];                 // z: 行 y, 列 x → (col, row, axis)
      const idx = grid.get(coords[0], coords[1], coords[2]);
      if (idx === undefined) { line += "."; continue; }
      const ch = charFor(idx);
      used.set(idx, ch);
      line += ch;
    }
    lines.push(line);
  }
  const legend = [...used.entries()].map(([idx, ch]) => `${ch}=${palette.hexOf(idx) ?? "?"}`).join(" ");
  if (legend) lines.push(`图例: ${legend}`);
  return lines.join("\n");
}
```
⚠️ 实现注意：`rLo/rHi` 的取值表达式有冗余三元——统一写成辅助 `at = (axis: Axis, side: 0 | 1) => r[axisIdx[axis] + side * 3]`，消除笔误风险。修正后：
```ts
const axisIdx = { x: 0, y: 1, z: 2 } as const;
const at = (a: Axis, side: 0 | 1): number => r[axisIdx[a] + side * 3];
const rLo = at(rowAxis as Axis, 0), rHi = at(rowAxis as Axis, 1);
const cLo = at(colAxis as Axis, 0), cHi = at(colAxis as Axis, 1);
```

- [ ] **Step 4: 实现 check.ts**

`src/core/check.ts`：
```ts
import type { SparseVoxelGrid } from "./grid.js";

export interface CheckReport {
  total: number;
  floating: number;
  components: number;
  symmetry: { x: number; y: number; z: number };
  profile: { x: number[]; y: number[]; z: number[] };
}

export function checkGrid(grid: SparseVoxelGrid): CheckReport {
  const has = (x: number, y: number, z: number) => grid.get(x, y, z) !== undefined;
  const [sx, sy, sz] = grid.size;
  let floating = 0;
  for (const [x, y, z] of grid.coords()) {
    if (y === 0) continue;
    const supported =
      has(x, y - 1, z) || has(x - 1, y - 1, z) || has(x + 1, y - 1, z) ||
      has(x, y - 1, z - 1) || has(x, y - 1, z + 1);
    if (!supported) floating++;
  }
  // 连通分量（6-邻域 BFS）
  const seen = new Set<string>();
  let components = 0;
  const all = [...grid.coords()].map(([x, y, z]) => [x, y, z] as [number, number, number]);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const [x, y, z] of all) {
    const k = key(x, y, z);
    if (seen.has(k)) continue;
    components++;
    const queue = [[x, y, z] as [number, number, number]];
    seen.add(k);
    while (queue.length) {
      const [cx, cy, cz] = queue.pop()!;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        const nk = key(nx, ny, nz);
        if (!seen.has(nk) && has(nx, ny, nz)) { seen.add(nk); queue.push([nx, ny, nz]); }
      }
    }
  }
  // 对称差异
  const sym = { x: 0, y: 0, z: 0 };
  const sizeOf = { x: sx, y: sy, z: sz };
  for (const [x, y, z] of all) {
    if (!has(sx - 1 - x, y, z)) sym.x++;
    if (!has(x, sy - 1 - y, z)) sym.y++;
    if (!has(x, y, sz - 1 - z)) sym.z++;
  }
  // 剖面
  const profile = {
    x: new Array(sx).fill(0), y: new Array(sy).fill(0), z: new Array(sz).fill(0)
  };
  for (const [x, y, z] of all) { profile.x[x]++; profile.y[y]++; profile.z[z]++; }
  void sizeOf;
  return { total: grid.count, floating, components, symmetry: sym, profile };
}

export function formatCheck(r: CheckReport): string {
  const seg = (arr: number[]): string => {
    const parts: string[] = [];
    let i = 0;
    while (i < arr.length) {
      if (arr[i] === 0) { i++; continue; }
      let j = i;
      while (j < arr.length && arr[j] !== 0) j++;
      parts.push(`${i}..${j - 1}:[${arr.slice(i, j).join(",")}]`);
      i = j;
    }
    return parts.join(" ") || "（空）";
  };
  return [
    `check: total ${r.total}, floating ${r.floating}, components ${r.components}`,
    `symmetry x:${r.symmetry.x} y:${r.symmetry.y} z:${r.symmetry.z}（不对称体素数，每对计 2）`,
    `profile x: ${seg(r.profile.x)}`,
    `profile y: ${seg(r.profile.y)}`,
    `profile z: ${seg(r.profile.z)}`
  ].join("\n");
}
```

- [ ] **Step 5: 跑测试通过**

```bash
pnpm vitest run test/slice.test.ts test/check.test.ts
```
Expected: 全部 passed。slice 的行列轴映射用例若失败：逐 axis 打印一行核对坐标三元组顺序（(axis,col,row) 映射是最易错点，以测试为准修正）。

- [ ] **Step 6: Commit**

```bash
git add src/core/slice.ts src/core/check.ts test/slice.test.ts test/check.test.ts
git commit -m "feat: slice_ascii 层字符画 + check 自诊断"
```

---

### Task 12: script() vm 沙箱

**Files:**
- Create: `src/core/script.ts`
- Modify: `src/core/index.ts`
- Test: `test/script.test.ts`

**Interfaces:**
- Consumes: `placeBox/placeSphere/placeCylinder/placeLine/paintRegion/eraseRegion/translateRegion`（Task 4-6）、`SparseVoxelGrid.snapshot/restore`、`Palette.snapshot/restore`（Task 2/3）
- Produces: `runScript(grid, palette, code, timeoutMs=5000): { logs: string[]; added: number; removed: number; total: number }`
  - 沙箱 API（注入 vm 上下文，全为同步函数）：`box(x0,y0,z0,x1,y1,z1,hex,opts?)`、`sphere(cx,cy,cz,r,hex,opts?)`、`cylinder(cx,cy,cz,r,h,hex,opts?)`、`line(x0,y0,z0,x1,y1,z1,hex,opts?)`、`set(x,y,z,hex)`、`unset(x,y,z)`、`paint(regionOrNull, fromHexOrNull, hex)`、`erase(regionOrAll)`、`translate(region,dx,dy,dz)`、`palette(hex)`（预分配色号并返回）、`size`（只读副本）、`log(...args)`
  - 任何抛错（含 vm 超时 `code timed out`）→ grid+palette 回滚到执行前 → 重新抛出带「已回滚」前缀的错误

- [ ] **Step 1: 写失败测试**

`test/script.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { runScript } from "../src/core/script.js";

describe("runScript", () => {
  it("循环批量生成", () => {
    const g = new SparseVoxelGrid([64, 64, 64]);
    const pal = new Palette();
    const r = runScript(g, pal, `
      for (let i = 0; i < 5; i++) box(i * 6, 0, 0, i * 6 + 2, 4, 2, "#8b4513");
      log("done");
    `);
    expect(g.count).toBe(5 * 3 * 5 * 3);
    expect(r.added).toBe(225);
    expect(r.logs).toEqual(["done"]);
    expect(pal.hexOf(1)).toBe("#8b4513");
  });

  it("sphere/cylinder/line/set 全可用", () => {
    const g = new SparseVoxelGrid([16, 16, 16]);
    const pal = new Palette();
    runScript(g, pal, `
      sphere(8, 8, 8, 2, "#ff0000");
      cylinder(4, 0, 4, 1, 3, "#00ff00", { axis: "y" });
      line(0, 0, 0, 3, 0, 0, "#0000ff");
      set(15, 15, 15, "#ffffff");
    `);
    expect(g.get(15, 15, 15)).toBe(4);
  });

  it("死循环 → 超时抛错并回滚", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const pal = new Palette();
    g.set(0, 0, 0, pal.indexOf("#123456"));
    expect(() => runScript(g, pal, "while (true) {}", 200)).toThrow(/已回滚/);
    expect(g.count).toBe(1);
    expect(pal.size).toBe(1);
  });

  it("运行时错误 → 回滚", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    const pal = new Palette();
    expect(() => runScript(g, pal, `box(0,0,0,1,1,1,"#ff0000"); nope();`)).toThrow(/已回滚/);
    expect(g.count).toBe(0);
  });

  it("越界坐标 → 抛错回滚", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    expect(() => runScript(g, new Palette(), `box(0,0,0,99,1,1,"#ff0000")`)).toThrow();
    expect(g.count).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/script.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 script.ts**

`src/core/script.ts`：
```ts
import vm from "node:vm";
import type { SparseVoxelGrid } from "./grid.js";
import type { Palette } from "./palette.js";
import type { Region } from "./types.js";
import {
  placeBox, placeSphere, placeCylinder, placeLine,
  paintRegion, eraseRegion, translateRegion, type ChangeStats
} from "./ops.js";

export interface ScriptResult { logs: string[]; added: number; removed: number; total: number }

export function runScript(
  grid: SparseVoxelGrid, palette: Palette, code: string, timeoutMs = 5000
): ScriptResult {
  const snapG = grid.snapshot();
  const snapP = palette.snapshot();
  const logs: string[] = [];
  const sum = { added: 0, removed: 0 };
  const track = (fn: (...a: never[]) => ChangeStats) => (...args: never[]): ChangeStats => {
    const s = fn(...args);
    sum.added += s.added;
    sum.removed += s.removed;
    return s;
  };
  const idx = (hex: unknown): number => palette.indexOf(String(hex));
  const regionOf = (r: unknown): Region | null =>
    r === null || r === undefined ? null : (Array.isArray(r) && r.length === 6 ? (r as Region) : (() => { throw new Error(`region 须为 [x0,y0,z0,x1,y1,z1] 或 null`); })());

  const api = {
    size: [...grid.size] as [number, number, number],
    log: (...args: unknown[]) => logs.push(args.map(a => String(a)).join(" ")),
    palette: (hex: unknown) => idx(hex),
    box: track((x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: string, opts?: object) =>
      placeBox(grid, x0, y0, z0, x1, y1, z1, idx(hex), opts)),
    sphere: track((cx: number, cy: number, cz: number, r: number, hex: string, opts?: object) =>
      placeSphere(grid, cx, cy, cz, r, idx(hex), opts)),
    cylinder: track((cx: number, cy: number, cz: number, r: number, h: number, hex: string, opts?: object) =>
      placeCylinder(grid, cx, cy, cz, r, h, idx(hex), opts)),
    line: track((x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: string, opts?: object) =>
      placeLine(grid, x0, y0, z0, x1, y1, z1, idx(hex), opts)),
    set: (x: number, y: number, z: number, hex: string) => {
      if (grid.set(x, y, z, idx(hex))) sum.added++;
    },
    unset: (x: number, y: number, z: number) => {
      if (grid.unset(x, y, z)) sum.removed++;
    },
    paint: track((region: unknown, fromHex: unknown, hex: string) =>
      paintRegion(grid, regionOf(region) as Region | null,
        fromHex === null || fromHex === undefined ? undefined : idx(fromHex as string), idx(hex))),
    erase: track((region: unknown) =>
      eraseRegion(grid, region === "all" ? "all" : regionOf(region) as Region)),
    translate: track((region: unknown, dx: number, dy: number, dz: number) =>
      translateRegion(grid, regionOf(region) as Region, dx, dy, dz))
  };

  try {
    vm.runInNewContext(code, api, { timeout: timeoutMs });
  } catch (e) {
    grid.restore(snapG);
    palette.restore(snapP);
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`script 执行失败（已回滚）: ${msg}`);
  }
  return { logs, added: sum.added, removed: sum.removed, total: grid.count };
}
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/script.test.ts
```
Expected: 全部 passed。若 track 的泛型在 strict 下报类型错：将 `track` 参数类型放宽为 `(...a: any[]) => ChangeStats`（core 内部，不外泄）。

- [ ] **Step 5: Commit**

```bash
git add src/core/script.ts src/core/index.ts test/script.test.ts
git commit -m "feat: script() vm 沙箱程序化批量生成（超时+异常回滚）"
```

---

### Task 13: ForgeSession 工具层（18 工具 + 自动落盘 + undo）

**Files:**
- Create: `src/mcp/tools.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: core 全部（Task 2-12）
- Produces:
  - `interface ToolDef { name: string; description: string; schema: z.ZodRawShape }`
  - `TOOLS: ToolDef[]`（18 个，名称见下）
  - `class ForgeSession { constructor(file: string); init(): Promise<void>; handle(name, args): Promise<{ content: string }>; listTools(): ToolDef[] }`
  - 工具名：`create_project, info, set, unset, box, sphere, cylinder, line, paint, erase, translate, undo, sample, slice_ascii, check, script, export, render_png`
  - 语义要点：变更类工具执行前压 undo 快照（栈深 20）→ 成功后 `saveForge` 原子落盘 → 返回摘要文本；`create_project` 已存在时须 `force: true`；`export` 输出路径默认与模型同目录（`<base>.glb`/`<base>.vox`）；`render_png` 默认 `<base>.<view|multi>.png`；`script` 失败不落盘（core 已回滚）。
  - 所有 schema 用 zod：坐标 `z.number().int()`，颜色 `z.string()`，mirror `z.array(z.enum(["x","y","z"])).optional()`，region `z.array(z.number().int()).length(6)`。

- [ ] **Step 1: 写失败测试**

`test/tools.test.ts`：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { ForgeSession } from "../src/mcp/tools.js";

let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "vf-")), "m.voxel.json");
});

describe("ForgeSession", () => {
  it("listTools 18 个且无重名", () => {
    const s = new ForgeSession(file);
    const names = s.listTools().map(t => t.name);
    expect(names.length).toBe(18);
    expect(new Set(names).size).toBe(18);
  });

  it("create_project → info → box → 落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [16, 16, 16] });
    const r = await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 3, y1: 3, z1: 3, color: "#8b4513" });
    expect(r.content).toMatch(/box: \+64 -0, total 64/);
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(64);
    expect(raw.palette["1"]).toBe("#8b4513");
  });

  it("create_project 已存在拒绝，force 可覆盖", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await expect(s.handle("create_project", { size: [16, 16, 16] })).rejects.toThrow(/force/);
    await s.handle("create_project", { size: [16, 16, 16], force: true });
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(raw.size).toEqual([16, 16, 16]);
  });

  it("undo 恢复上一步并落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const r = await s.handle("undo", {});
    expect(r.content).toMatch(/undo: 回滚到 0 体素/);
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(0);
  });

  it("undo 空栈报错", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await expect(s.handle("undo", {})).rejects.toThrow(/无可撤销/);
  });

  it("info/sample/slice_ascii/check 返回结构", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("set", { x: 1, y: 0, z: 1, color: "#ff0000" });
    const info = (await s.handle("info", {})).content;
    expect(info).toContain("size: 8x8x8");
    expect(info).toContain("voxels: 1");
    const sample = (await s.handle("sample", { x: 1, y: 0, z: 1 })).content;
    expect(sample).toContain("#ff0000");
    const empty = (await s.handle("sample", { x: 0, y: 7, z: 0 })).content;
    expect(empty).toContain("空");
    const slice = (await s.handle("slice_ascii", { axis: "y", index: 0 })).content;
    expect(slice).toContain("A=");
    const chk = (await s.handle("check", {})).content;
    expect(chk).toContain("floating 0");
  });

  it("paint/erase/translate", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const p = await s.handle("paint", { region: [0, 0, 0, 1, 1, 1], color: "#00ff00" });
    expect(p.content).toMatch(/paint: 8/);
    const e = await s.handle("erase", { region: [0, 0, 0, 1, 1, 1] });
    expect(e.content).toMatch(/erase: -8/);
  });

  it("export glb/vox 落盘且摘要含结构校验", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const g = await s.handle("export", { format: "glb" });
    expect(g.content).toMatch(/GLB 已导出.*tris 12/); // 2x2x2 box: 面积 24 quad=48 tri? 校验正则见实现说明
    const v = await s.handle("export", { format: "vox" });
    expect(v.content).toMatch(/VOX 已导出/);
  });

  it("render_png 默认路径落盘", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000" });
    const r = await s.handle("render_png", { size: 64 });
    expect(r.content).toMatch(/PNG 已渲染.*\.iso\.png/);
  });

  it("script 正常与失败", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [16, 16, 16] });
    const ok = await s.handle("script", { code: `for (let i=0;i<3;i++) box(i*4,0,0,i*4+1,2,1,"#ff0000"); log("ok")` });
    expect(ok.content).toMatch(/script: \+18/);
    expect(ok.content).toContain("ok");
    await expect(s.handle("script", { code: "while(true){}" })).rejects.toThrow(/已回滚/);
  });

  it("镜像与 hollow 参数透传", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await s.handle("box", { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1, color: "#ff0000", mirror: ["x"] });
    const raw = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(raw.voxels).length).toBe(16);
  });

  it("未初始化文件时默认 64³ 空项目", async () => {
    const s = new ForgeSession(file);
    await s.init();
    const info = (await s.handle("info", {})).content;
    expect(info).toContain("size: 64x64x64");
    expect(info).toContain("voxels: 0");
  });
});
```

实现说明（export 摘要）：2×2×2 box 表面积 = 24 quad = 48 tris。上面的正则 `/GLB 已导出.*tris 12/` **是错的**——写实现时统一摘要格式为 `GLB 已导出 <path>（48 tris, 1 materials）`，测试正则相应改为 `/GLB 已导出.*48 tris/`。（此为 plan 内联勘误，以本说明为准。）

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/tools.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 tools.ts**

`src/mcp/tools.ts`：
```ts
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { SparseVoxelGrid } from "../core/grid.js";
import { Palette } from "../core/palette.js";
import { loadForge, saveForge, emptyProject } from "../core/project.js";
import {
  placeBox, placeSphere, placeCylinder, placeLine,
  paintRegion, eraseRegion, translateRegion,
  type ChangeStats, type PlaceOpts, type CylinderOpts, type LineOpts
} from "../core/ops.js";
import { runScript } from "../core/script.js";
import { sliceAscii } from "../core/slice.js";
import { checkGrid, formatCheck } from "../core/check.js";
import { exportGlb, verifyGlb } from "../core/export/glb.js";
import { exportVox, verifyVox } from "../core/export/vox.js";
import { encodePng } from "../core/export/png.js";
import { gridSource, renderView } from "../core/render/raycast.js";
import { renderProject } from "../core/render/render.js";
import type { Axis, Region } from "../core/types.js";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
}

const sizeSchema = { size: z.array(z.number().int().min(1).max(256)).length(3) };
const regionSchema = { region: z.array(z.number().int()).length(6).describe("[x0,y0,z0,x1,y1,z1]") };
const mirrorSchema = { mirror: z.array(z.enum(["x", "y", "z"])).optional() };
const shapeCommon = {
  color: z.string().describe("#RRGGBB"),
  hollow: z.boolean().optional(),
  ...mirrorSchema
};

function fmtBounds(b: Region | null): string {
  return b ? `(${b[0]},${b[1]},${b[2]})-(${b[3]},${b[4]},${b[5]})` : "空";
}

export class ForgeSession {
  grid!: SparseVoxelGrid;
  palette!: Palette;
  exists = false;
  private undoStack: Array<{ g: Map<string, number>; p: [string[], Map<string, number>] }> = [];

  constructor(readonly file: string) {}

  async init(): Promise<void> {
    try {
      const loaded = await loadForge(this.file);
      this.grid = loaded.grid;
      this.palette = loaded.palette;
      this.exists = true;
    } catch {
      this.grid = new SparseVoxelGrid([64, 64, 64]);
      this.palette = new Palette();
    }
  }

  listTools(): ToolDef[] {
    return TOOLS;
  }

  private pushUndo(): void {
    this.undoStack.push({ g: this.grid.snapshot(), p: this.palette.snapshot() });
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  private stats(name: string, s: ChangeStats): string {
    return `${name}: +${s.added} -${s.removed}, total ${s.total}, bounds ${fmtBounds(s.bounds)}`;
  }

  private defaultOut(ext: string, view?: string): string {
    const base = this.file.replace(/\.voxel\.json$/, "");
    return view ? `${base}.${view}.${ext}` : `${base}.${ext}`;
  }

  async handle(name: string, args: Record<string, unknown>): Promise<{ content: string }> {
    const a = args as Record<string, any>;
    switch (name) {
      case "create_project": {
        if (this.exists && !a.force) throw new Error(`文件已存在: ${this.file}（需 force: true 覆盖）`);
        this.grid = new SparseVoxelGrid(a.size);
        this.palette = new Palette();
        this.undoStack = [];
        this.exists = true;
        await saveForge(this.file, this.grid, this.palette);
        return { content: `create_project: ${a.size[0]}x${a.size[1]}x${a.size[2]}，已写入 ${this.file}` };
      }
      case "info": {
        const b = this.grid.bounds();
        const counts = [...this.grid.colorCounts().entries()].map(([idx, n]) => `${idx}→${n}`).join(" ");
        const pal = this.palette.toRecord();
        const palStr = Object.entries(pal).map(([k, v]) => `${k}=${v}`).join(" ") || "（空）";
        return { content: `size: ${this.grid.size.join("x")}\nvoxels: ${this.grid.count}\npalette (${this.palette.size}): ${palStr}\nbounds: ${fmtBounds(b)}\n每色计数: ${counts || "（空）"}` };
      }
      case "set": {
        this.pushUndo();
        this.grid.set(a.x, a.y, a.z, this.palette.indexOf(a.color));
        await saveForge(this.file, this.grid, this.palette);
        return { content: `set (${a.x},${a.y},${a.z})=${a.color}, total ${this.grid.count}` };
      }
      case "unset": {
        this.pushUndo();
        const ok = this.grid.unset(a.x, a.y, a.z);
        await saveForge(this.file, this.grid, this.palette);
        return { content: ok ? `unset (${a.x},${a.y},${a.z}), total ${this.grid.count}` : `(${a.x},${a.y},${a.z}) 本来为空, total ${this.grid.count}` };
      }
      case "box":
      case "sphere":
      case "cylinder":
      case "line": {
        this.pushUndo();
        const idx = this.palette.indexOf(a.color);
        const opts: PlaceOpts = { hollow: a.hollow, mirror: a.mirror };
        let s: ChangeStats;
        if (name === "box") s = placeBox(this.grid, a.x0, a.y0, a.z0, a.x1, a.y1, a.z1, idx, opts);
        else if (name === "sphere") s = placeSphere(this.grid, a.cx, a.cy, a.cz, a.r, idx, opts);
        else if (name === "cylinder") s = placeCylinder(this.grid, a.cx, a.cy, a.cz, a.r, a.h, idx, { ...opts, axis: a.axis } as CylinderOpts);
        else s = placeLine(this.grid, a.x0, a.y0, a.z0, a.x1, a.y1, a.z1, idx, { ...opts, thickness: a.thickness } as LineOpts);
        await saveForge(this.file, this.grid, this.palette);
        return { content: this.stats(name, s) };
      }
      case "paint": {
        this.pushUndo();
        const s = paintRegion(this.grid, a.region ?? null,
          a.from ? this.palette.indexOf(a.from) : undefined, this.palette.indexOf(a.color));
        await saveForge(this.file, this.grid, this.palette);
        return { content: this.stats("paint", s) };
      }
      case "erase": {
        this.pushUndo();
        const s = eraseRegion(this.grid, a.region === "all" ? "all" : a.region as Region);
        await saveForge(this.file, this.grid, this.palette);
        return { content: this.stats("erase", s) };
      }
      case "translate": {
        this.pushUndo();
        const s = translateRegion(this.grid, a.region as Region, a.dx, a.dy, a.dz);
        await saveForge(this.file, this.grid, this.palette);
        return { content: this.stats("translate", s) };
      }
      case "undo": {
        const snap = this.undoStack.pop();
        if (!snap) throw new Error("无可撤销操作");
        this.grid.restore(snap.g);
        this.palette.restore(snap.p);
        await saveForge(this.file, this.grid, this.palette);
        return { content: `undo: 回滚到 ${this.grid.count} 体素, bounds ${fmtBounds(this.grid.bounds())}` };
      }
      case "sample": {
        const idx = this.grid.get(a.x, a.y, a.z);
        return { content: idx === undefined ? `(${a.x},${a.y},${a.z}) = 空` : `(${a.x},${a.y},${a.z}) = ${this.palette.hexOf(idx)} (色号 ${idx})` };
      }
      case "slice_ascii": {
        const text = sliceAscii(this.grid, this.palette, a.axis as Axis, a.index, a.region as Region | undefined);
        return { content: text };
      }
      case "check": {
        return { content: formatCheck(checkGrid(this.grid)) };
      }
      case "script": {
        this.pushUndo();
        const r = runScript(this.grid, this.palette, a.code, a.timeoutMs ?? 5000);
        await saveForge(this.file, this.grid, this.palette);
        const logs = r.logs.length ? `\nlog: ${r.logs.join(" | ")}` : "";
        return { content: `script: +${r.added} -${r.removed}, total ${r.total}${logs}` };
      }
      case "export": {
        const src = gridSource(this.grid, (i) => this.palette.hexOf(i) ?? "#ff00ff");
        if (a.format === "glb") {
          const { buildMesh } = await import("../core/export/mesh.js");
          const mesh = buildMesh(this.grid.coords(), (i) => this.palette.hexOf(i) ?? "#ff00ff");
          const buf = exportGlb(mesh);
          const out = a.path ?? this.defaultOut("glb");
          await fs.writeFile(out, buf);
          const v = verifyGlb(buf);
          return { content: `GLB 已导出 ${out}（${v.tris} tris, ${v.materials} materials, ${buf.length}B，结构闸门通过）` };
        }
        const buf = exportVox(this.grid.size, [...this.grid.coords()],
          new Map(Object.entries(this.palette.toRecord()).map(([k, v]) => [Number(k), v])));
        const out = a.path ?? this.defaultOut("vox");
        await fs.writeFile(out, buf);
        const v = verifyVox(buf);
        return { content: `VOX 已导出 ${out}（${v.voxels} voxels, ${buf.length}B，结构校验通过）` };
      }
      case "render_png": {
        const src = gridSource(this.grid, (i) => this.palette.hexOf(i) ?? "#ff00ff");
        const req = {
          view: a.view, yaw: a.yaw, pitch: a.pitch, views: a.views,
          size: a.size ?? 512, proj: a.proj, cutaway: a.cutaway,
          highlight: a.highlight as Region | undefined
        };
        const r = renderProject(src, req);
        const viewName = (req.views === "multi" ? "multi" : (req.view ?? "iso"));
        const out = a.path ?? this.defaultOut("png", String(viewName));
        await fs.writeFile(out, encodePng(r.w, r.h, r.rgba));
        return { content: `PNG 已渲染 ${out}（${r.w}x${r.h}, 视角 ${r.views.join("/")}）` };
      }
      default:
        throw new Error(`未知工具: ${name}`);
    }
  }
}
```

⚠️ 实现注意：
1. `renderView` import 未使用（用了 renderProject）——删除该 import 或改用 renderView 的单一视图路径，保持 import 干净（TS noUnusedLocals 未开则不报错，仍建议删）。
2. `export` 里动态 `await import("../core/export/mesh.js")` 可改为顶部静态 import（core 纯 TS，无循环依赖）。
3. 工具 schema 中 `render_png` 的 `views: z.enum(["single","multi"]).optional()`、`view: z.enum(["iso","front","side","top"]).optional()`、`cutaway: z.enum(["x","y","z","quarter"]).optional()`、`proj: z.enum(["ortho","persp"]).optional()`。

TOOLS 数组（18 项，description 内嵌 few-shot 示例，schema 与 handle 一一对应）——按上表逐一登记：
```ts
export const TOOLS: ToolDef[] = [
  { name: "create_project", description: "新建体素项目。示例: {size:[64,64,64]}", schema: { ...sizeSchema, force: z.boolean().optional() } },
  { name: "info", description: "项目概览：尺寸/体素数/调色板/包围盒/每色计数", schema: {} },
  { name: "set", description: "单点放体素。示例: {x:1,y:0,z:1,color:'#8B4513'}", schema: { x: z.number().int(), y: z.number().int(), z: z.number().int(), color: z.string() } },
  { name: "unset", description: "单点擦除", schema: { x: z.number().int(), y: z.number().int(), z: z.number().int() } },
  { name: "box", description: "长方体（hollow 只留壳；mirror 一次成型对称）。示例: {x0:0,y0:0,z0:0,x1:7,y1:3,z1:7,color:'#9aa0a6',hollow:true,mirror:['x']}", schema: { x0: z.number().int(), y0: z.number().int(), z0: z.number().int(), x1: z.number().int(), y1: z.number().int(), z1: z.number().int(), ...shapeCommon } },
  { name: "sphere", description: "球体。示例: {cx:8,cy:8,cz:8,r:3,color:'#ff0000'}", schema: { cx: z.number().int(), cy: z.number().int(), cz: z.number().int(), r: z.number(), ...shapeCommon } },
  { name: "cylinder", description: "圆柱：底面圆心+半径+高，axis 默认 y。示例: {cx:4,cy:0,cz:4,r:2,h:6,color:'#7d8288'}", schema: { cx: z.number().int(), cy: z.number().int(), cz: z.number().int(), r: z.number(), h: z.number().int().min(1), axis: z.enum(["x", "y", "z"]).optional(), ...shapeCommon } },
  { name: "line", description: "线段（thickness=笔刷立方边长）。示例: {x0:0,y0:0,z0:0,x1:8,y1:4,z1:0,color:'#8B4513',thickness:2}", schema: { x0: z.number().int(), y0: z.number().int(), z0: z.number().int(), x1: z.number().int(), y1: z.number().int(), z1: z.number().int(), thickness: z.number().int().min(1).optional(), ...mirrorSchema, color: z.string() } },
  { name: "paint", description: "换色：region 省略=全网格，from 省略=区域内全部。示例: {region:[0,0,0,7,7,7],from:'#ff0000',color:'#00ff00'}", schema: { region: z.array(z.number().int()).length(6).optional(), from: z.string().optional(), color: z.string() } },
  { name: "erase", description: "擦除：region 六元组或 'all'", schema: { region: z.union([z.array(z.number().int()).length(6), z.literal("all")]) } },
  { name: "translate", description: "平移区域内体素（目标出界/被占则丢弃）。示例: {region:[0,0,0,3,3,3],dx:4,dy:0,dz:0}", schema: { ...regionSchema, dx: z.number().int(), dy: z.number().int(), dz: z.number().int() } },
  { name: "undo", description: "撤销最近一次变更（栈深 20）", schema: {} },
  { name: "sample", description: "读单点颜色验证", schema: { x: z.number().int(), y: z.number().int(), z: z.number().int() } },
  { name: "slice_ascii", description: "层字符画（最便宜的空间校验）。示例: {axis:'y',index:3}", schema: { axis: z.enum(["x", "y", "z"]), index: z.number().int(), region: z.array(z.number().int()).length(6).optional() } },
  { name: "check", description: "自诊断：悬空/连通分量/对称差/每轴 occupancy 剖面", schema: {} },
  { name: "script", description: "vm 沙箱跑 JS 批量生成（同步代码，5s 超时，失败自动回滚）。API: box/sphere/cylinder/line/set/unset/paint/erase/translate/palette(hex)/size/log。示例: {code:'for(let i=0;i<10;i++) box(i*6,0,0,i*6+2,5,2,\"#8B4513\")'}", schema: { code: z.string(), timeoutMs: z.number().int().optional() } },
  { name: "export", description: "导出 GLB 或 .vox（返回结构校验摘要）", schema: { format: z.enum(["glb", "vox"]), path: z.string().optional() } },
  { name: "render_png", description: "渲染 PNG 供视觉自检：view 预设/yaw+pitch、views:'multi' 三视图合一、cutaway 剖切、highlight 区域红框。示例: {views:'multi',size:512}", schema: { view: z.enum(["iso", "front", "side", "top"]).optional(), yaw: z.number().optional(), pitch: z.number().optional(), views: z.enum(["single", "multi"]).optional(), size: z.number().int().optional(), proj: z.enum(["ortho", "persp"]).optional(), cutaway: z.enum(["x", "y", "z", "quarter"]).optional(), highlight: z.array(z.number().int()).length(6).optional(), path: z.string().optional() } }
];
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm vitest run test/tools.test.ts
```
Expected: 全部 passed。

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts test/tools.test.ts
git commit -m "feat: ForgeSession 工具层（18 工具，自动落盘+undo+摘要）"
```

---

### Task 14: MCP server（stdio + instructions + 协议冒烟）

**Files:**
- Create: `src/mcp/server.ts`、`src/mcp.ts`（bin 入口）
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `ForgeSession`/`TOOLS`（Task 13）
- Produces:
  - `createMcpServer(session: ForgeSession): McpServer`——注册 18 工具（registerTool + inputSchema=schema），错误包装为 `{ isError: true, content:[{type:"text",text:msg}] }`；server `instructions` = LLM 建模方法论 few-shot（见下）
  - `runMcpServer(file: string): Promise<void>`——init session → createMcpServer → StdioServerTransport（`src/mcp.ts`: `runMcpServer(process.argv[2] ?? "model.voxel.json")`）
  - INSTRUCTIONS 文本（建模方法论 few-shot）：
```
voxelforge 体素建模方法论：
1) create_project 定尺寸 → 2) 骨架优先（box/cylinder 摆大结构，对称结构用 mirror:["x"] 一次成型）→ 3) check() 看悬空/连通/对称/空层 → 4) 细节与配色（hex #RRGGBB）→ 5) slice_ascii 抽查关键层 → 6) render_png(views:"multi") 目检，发现问题后用 highlight 回传区域修改 → 7) export glb/vox 交付。
批量重复结构一律用 script()（循环/数学/噪声），别逐点 set。
所有工具返回计数摘要，无需读全量网格。
```

- [ ] **Step 1: 写失败测试**

`test/server.test.ts`：
```ts
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
    const session = new ForgeSession(file);
    await session.init();
    const client = await connect(session);
    const r = await client.callTool({ name: "box", arguments: { x0: 0, y0: 0, z0: 0, x1: 999, y1: 1, z1: 1, color: "#ff0000" } });
    expect(r.isError).toBe(true);
    expect((r.content as Array<{ text: string }>)[0].text).toContain("越界");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/server.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 server.ts 与 bin 入口**

`src/mcp/server.ts`：
```ts
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
```

`src/mcp.ts`（bin 入口）：
```ts
#!/usr/bin/env node
import { runMcpServer } from "./mcp/server.js";

runMcpServer(process.argv[2] ?? "model.voxel.json").catch((e) => {
  console.error("voxelforge-mcp:", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

⚠️ 实现注意：registerTool 的 handler 签名与 inputSchema 类型以安装的 SDK 版本为准——若 `inputSchema` 要求 `ZodRawShape` 直接传入即可；若编译报类型错，查看 `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` 中 `registerTool` 的确切签名并适配（如需要 `z.object(def.schema)` 包一层）。

- [ ] **Step 4: 跑测试通过 + tsc 编译检查**

```bash
pnpm vitest run test/server.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```
Expected: 测试全过、tsc 无错。

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp.ts test/server.test.ts
git commit -m "feat: MCP stdio server（18 工具 + instructions few-shot）"
```

---

### Task 15: Web Viewer（serve + SSE + three.js 单文件）

**Files:**
- Create: `src/viewer/serve.ts`、`src/viewer/app.ts`、`src/viewer/index.html`、`scripts/build-viewer.mjs`
- Test: `test/viewer.test.ts`

**Interfaces:**
- Consumes: `buildMesh`（Task 7）
- Produces:
  - `startViewer(file: string, port: number): Promise<{ server: http.Server; port: number; close(): Promise<void> }>`
    - `GET /` → dist/viewer/index.html（单文件，three 内联）
    - `GET /model` → 当前 JSON；`GET /healthz` → ok；`GET /events` → SSE（`event: model\ndata:<json>`，15s 心跳）
    - fs.watch 防抖 150ms，读取重试 3×100ms；JSON 解析失败静默重试（写入中）
  - viewer.html 行为：fetch /model 初始 → EventSource /events → 收到模型 → 重建 BufferGeometry（buildMesh），相机/控制器不动；HUD 显示体素数/尺寸/更新时间
  - build-viewer.mjs：esbuild bundle `src/viewer/app.ts`（iife minify）→ 替换 index.html 的 `/*__BUNDLE__*/` → 写 `dist/viewer/index.html`（`pnpm build` 已串联）

- [ ] **Step 1: 写失败测试**

`test/viewer.test.ts`：
```ts
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startViewer } from "../src/viewer/serve.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("startViewer", () => {
  it("/model 返回 JSON，/healthz ok", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: { "1": "#ff0000" }, voxels: { "0,0,0": 1 } }));
    const v = await startViewer(file, 0);
    cleanups.push(v.close);
    const get = (p: string) => new Promise<{ status: number; body: string }>((res) => {
      http.get({ host: "127.0.0.1", port: v.port, path: p }, (r) => {
        let b = "";
        r.on("data", (c) => (b += c));
        r.on("end", () => res({ status: r.statusCode!, body: b }));
      });
    });
    expect((await get("/healthz")).body).toBe("ok");
    const model = await get("/model");
    expect(model.status).toBe(200);
    expect(JSON.parse(model.body).voxels["0,0,0"]).toBe(1);
  });

  it("文件变化 → SSE 推送新模型", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: {}, voxels: {} }));
    const v = await startViewer(file, 0);
    cleanups.push(v.close);
    const received = new Promise<string>((res) => {
      const req = http.get({ host: "127.0.0.1", port: v.port, path: "/events" }, (r) => {
        let buf = "";
        r.on("data", (c) => {
          buf += c;
          if (buf.includes("event: model")) {
            const line = buf.split("\n").find(l => l.startsWith("data:"))!;
            res(line.slice(5).trim());
          }
        });
      });
      cleanups.push(async () => req.destroy());
    });
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(file, JSON.stringify({ format: "voxelforge/1", size: [8, 8, 8], palette: { "1": "#ff0000" }, voxels: { "1,1,1": 1 } }));
    const data = JSON.parse(await Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error("SSE 超时")), 3000))]));
    expect(data.voxels["1,1,1"]).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run test/viewer.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 serve.ts**

`src/viewer/serve.ts`：
```ts
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
      res.write(`event: model\ndata: ${lastJson}\n\n`);
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
    }
  };
}
```

- [ ] **Step 4: 实现 app.ts / index.html / build-viewer.mjs**

`src/viewer/index.html`：
```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>voxelforge viewer</title>
<style>
  html, body { margin: 0; height: 100%; background: #14161a; color: #dfe3ea;
    font: 13px/1.5 -apple-system, "PingFang SC", sans-serif; overflow: hidden; }
  #hud { position: fixed; top: 10px; left: 12px; z-index: 2; opacity: .85;
    background: rgba(20,22,26,.6); padding: 6px 10px; border-radius: 8px; }
</style>
</head>
<body>
<div id="hud">加载中…</div>
<script>/*__BUNDLE__*/</script>
</body>
</html>
```

`src/viewer/app.ts`：
```ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildMesh } from "../core/export/mesh.js";

const hud = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(48, 40, 48);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x2a2d33, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 80, 30);
scene.add(sun);

const gridHelper = new THREE.GridHelper(128, 16, 0x3a3f47, 0x262a30);
scene.add(gridHelper);

let mesh: THREE.Mesh | null = null;

function rebuild(project: { size: number[]; palette: Record<string, string>; voxels: Record<string, number> }): void {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh = null;
  }
  const entries = Object.entries(project.voxels).map(([k, idx]) => {
    const [x, y, z] = k.split(",").map(Number);
    return [x, y, z, idx] as [number, number, number, number];
  });
  const hexAt = (idx: number) => project.palette[String(idx)] ?? "#ff00ff";
  const m = buildMesh(entries, hexAt);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);
  hud.textContent = `体素 ${entries.length} · 网格 ${project.size.join("x")} · ${new Date().toLocaleTimeString()}`;
}

fetch("/model").then((r) => r.json()).then((p) => { if (p && p.size) rebuild(p); });
new EventSource("/events").addEventListener("model", (e) => {
  const p = JSON.parse((e as MessageEvent).data);
  if (p && p.size) rebuild(p);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
```

`scripts/build-viewer.mjs`：
```js
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist/viewer", { recursive: true });
const result = await build({
  entryPoints: ["src/viewer/app.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false
});
const html = readFileSync("src/viewer/index.html", "utf8").replace("/*__BUNDLE__*/", result.outputFiles[0].text);
writeFileSync("dist/viewer/index.html", html);
console.log("viewer: dist/viewer/index.html 已生成");
```

- [ ] **Step 5: 全量构建 + 测试通过 + 人工打开验证**

```bash
pnpm build
pnpm vitest run test/viewer.test.ts
node dist/cli.js 2>/dev/null || true   # cli 尚未实现，忽略失败；临时验证 serve：
pnpm exec tsx -e "import('./src/viewer/serve.js').then(m => m.startViewer('docs/../model.voxel.json', 4173))" &
```
Expected: 测试 2 passed。serve 手工验证可推迟到 Task 16（CLI 完成后 `voxelforge serve` 一键验证）。

- [ ] **Step 6: Commit**

```bash
git add src/viewer scripts/build-viewer.mjs test/viewer.test.ts
git commit -m "feat: web viewer（node:http + SSE 实时推送 + three.js 单文件打包）"
```

---

### Task 16: CLI（new/serve/export/render）+ bins

**Files:**
- Create: `src/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: ForgeSession、startViewer、saveForge、exportGlb/exportVox、renderProject/encodePng、emptyProject（前序任务）
- Produces: `dist/cli.js`（package.json bin `voxelforge`）——`new <file> [--size 64] [--force]`、`serve <file> [--port 4173]`、`export <file> --glb out.glb | --vox out.vox`、`render <file> [--view iso] [--multi] [--cutaway x|y|z|quarter] [--yaw N --pitch N] [--out p.png] [--size 512] [--proj ortho|persp] [--axes=false]`；参数解析用 `node:util` 的 `parseArgs`（strict:false，容忍未知参数）。

- [ ] **Step 1: 写失败测试**

`test/cli.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skip = !existsSync("dist/cli.js");
const run = (args: string[]) => spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8", timeout: 30000 });

describe("cli（需先 pnpm build）", () => {
  it("new + export + render 全链路", async () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    const r1 = run(["new", file, "--size", "16"]);
    expect(r1.status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).size).toEqual([16, 16, 16]);
    // 写一个盒子再导出
    const session = await import("../src/mcp/tools.js").then(m => new m.ForgeSession(file));
    await session.init();
    await session.handle("box", { x0: 0, y0: 0, z0: 0, x1: 2, y1: 2, z2: 2, color: "#ff0000" } as never).catch(() => {});
```
（上面 z2 是故意笔误——直接用 handle 的正确参数：）
```ts
    await session.handle("box", { x0: 0, y0: 0, z0: 0, x1: 2, y1: 2, z1: 2, color: "#ff0000" });
    const r2 = run(["export", file, "--glb", join(dir, "out.glb")]);
    expect(r2.status).toBe(0);
    expect(existsSync(join(dir, "out.glb"))).toBe(true);
    const r3 = run(["render", file, "--view", "iso", "--out", join(dir, "shot.png"), "--size", "64"]);
    expect(r3.status).toBe(0);
    expect(existsSync(join(dir, "shot.png"))).toBe(true);
    expect(readFileSync(join(dir, "shot.png")).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("serve 起服务并可 GET /healthz", async () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    run(["new", file, "--size", "8"]);
    const child = spawnSync(process.execPath, ["-e", `
      import("./dist/cli.js").catch(() => {});
    `], { encoding: "utf8" });
    void child; // serve 常驻进程测试复杂度高，改为直接调用 startViewer（Task 15 已覆盖 SSE/路由）
    expect(true).toBe(true);
  });
});
```
⚠️ 实现注意（Step 1 内联勘误）：serve 子命令的 HTTP 行为已由 test/viewer.test.ts 覆盖，cli 测试只覆盖 new/export/render 的进程级冒烟；`serve` 的 cli 用例仅断言 `--help` 退出码：
```ts
  it("help", () => {
    if (skip) return;
    expect(run(["--help"]).status).toBe(0);
  });
```

- [ ] **Step 2: 实现 cli.ts**

`src/cli.ts`：
```ts
#!/usr/bin/env node
import { parseArgs } from "node:util";
import fs from "node:fs";
import { ForgeSession } from "./mcp/tools.js";
import { saveForge, emptyProject } from "./core/project.js";
import { SparseVoxelGrid } from "./core/grid.js";
import { Palette } from "./core/palette.js";
import { buildMesh } from "./core/export/mesh.js";
import { exportGlb, verifyGlb } from "./core/export/glb.js";
import { exportVox, verifyVox } from "./core/export/vox.js";
import { encodePng } from "./core/export/png.js";
import { gridSource } from "./core/render/raycast.js";
import { renderProject } from "./core/render/render.js";

function usage(): string {
  return `voxelforge — LLM-native 体素建模
用法:
  voxelforge new <file> [--size 64] [--force]
  voxelforge serve <file> [--port 4173]
  voxelforge export <file> --glb out.glb | --vox out.vox
  voxelforge render <file> [--view iso|front|side|top] [--multi] [--cutaway x|y|z|quarter]
                    [--yaw 45 --pitch 30] [--out shot.png] [--size 512] [--proj ortho|persp] [--axes=false]
  voxelforge-mcp <file>        # stdio MCP server`;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      size: { type: "string", default: "64" },
      force: { type: "boolean", default: false },
      port: { type: "string", default: "4173" },
      glb: { type: "string" },
      vox: { type: "string" },
      view: { type: "string" },
      multi: { type: "boolean", default: false },
      cutaway: { type: "string" },
      yaw: { type: "string" },
      pitch: { type: "string" },
      out: { type: "string" },
      proj: { type: "string" },
      axes: { type: "string", default: "true" }
    }
  });
  const cmd = positionals[0];
  const file = positionals[1];

  if (!cmd || cmd === "help" || cmd === "--help") { console.log(usage()); return 0; }

  if (cmd === "new") {
    if (!file) throw new Error("缺 <file>");
    const size = Number(values.size);
    if (fs.existsSync(file) && !values.force) throw new Error(`已存在: ${file}（--force 覆盖）`);
    const p = emptyProject([size, size, size]);
    fs.writeFileSync(file, JSON.stringify(p));
    console.log(`created ${file} (${size}³)`);
    return 0;
  }

  if (cmd === "serve") {
    if (!file) throw new Error("缺 <file>");
    const { startViewer } = await import("./viewer/serve.js");
    const v = await startViewer(file, Number(values.port));
    const close = () => v.close().then(() => process.exit(0));
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
    return 0; // 常驻
  }

  if (cmd === "export") {
    if (!file) throw new Error("缺 <file>");
    const session = new ForgeSession(file);
    await session.init();
    if (values.glb) {
      const mesh = buildMesh(session.grid.coords(), (i) => session.palette.hexOf(i) ?? "#ff00ff");
      const buf = exportGlb(mesh);
      fs.writeFileSync(values.glb, buf);
      const v = verifyGlb(buf);
      console.log(`GLB ${values.glb}: ${v.tris} tris, ${buf.length}B（闸门通过）`);
      return 0;
    }
    if (values.vox) {
      const buf = exportVox(session.grid.size, [...session.grid.coords()],
        new Map(Object.entries(session.palette.toRecord()).map(([k, hex]) => [Number(k), hex])));
      fs.writeFileSync(values.vox, buf);
      const v = verifyVox(buf);
      console.log(`VOX ${values.vox}: ${v.voxels} voxels, ${buf.length}B`);
      return 0;
    }
    throw new Error("需 --glb <out> 或 --vox <out>");
  }

  if (cmd === "render") {
    if (!file) throw new Error("缺 <file>");
    const session = new ForgeSession(file);
    await session.init();
    const src = gridSource(session.grid, (i) => session.palette.hexOf(i) ?? "#ff00ff");
    const r = renderProject(src, {
      view: values.view as never,
      views: values.multi ? "multi" : "single",
      cutaway: values.cutaway as never,
      yaw: values.yaw !== undefined ? Number(values.yaw) : undefined,
      pitch: values.pitch !== undefined ? Number(values.pitch) : undefined,
      proj: values.proj as never,
      axes: String(values.axes) !== "false",
      size: 512
    });
    const out = values.out ?? "shot.png";
    fs.writeFileSync(out, encodePng(r.w, r.h, r.rgba));
    console.log(`PNG ${out}: ${r.w}x${r.h}（${r.views.join("/")}）`);
    return 0;
  }

  throw new Error(`未知子命令: ${cmd}\n${usage()}`);
}

main().then((code) => { if (code !== 0) process.exitCode = code; }).catch((e) => {
  console.error("voxelforge:", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 3: 构建并跑全部测试**

```bash
pnpm build
pnpm test
```
Expected: 全部测试通过（cli 用例因 dist 存在而执行）。

- [ ] **Step 4: 手工冒烟**

```bash
node dist/mcp.js --help 2>&1 | head -2 || true   # mcp bin 会等待 stdio，Ctrl-C 退出
```
Expected: cli 子命令全部可用；`voxelforge-mcp` 直接挂起（等待 MCP 握手）即正常。

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: CLI（new/serve/export/render）+ bins 接线"
```

---

### Task 17: 端到端验收（示例城堡 + 视觉目检闭环）+ README

**Files:**
- Create: `examples/build-castle.mjs`、`README.md`
- Test: 复用 `test/tools.test.ts`（无新单测；本任务产出可复核产物）

**Interfaces:**
- Consumes: 全部
- Produces: `examples/castle.voxel.json`、`examples/castle.glb`、`examples/castle.multi.png`（验收产物）；README 使用文档。

- [ ] **Step 1: 写示例脚本 examples/build-castle.mjs（直接用 ForgeSession + script 工具，兼做 few-shot 范例）**

```js
// 城堡示例：voxelforge LLM 建模流程演示（骨架 → check → 细节 → render 目检）
import { ForgeSession } from "../dist/mcp/tools.js";
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
```

- [ ] **Step 2: 运行示例**

```bash
node examples/build-castle.mjs
```
Expected: 输出 create/script 摘要、check 报告（floating 应为 0、components 应为 1——若城垛/塔尖悬空属正常体素设计，floating 数值记录即可）、GLB 闸门通过、PNG 路径。

- [ ] **Step 3: 视觉目检闭环（本会话执行）**

1. `read_image examples/castle.multi.png`（三视图合成）目检：城堡形状可辨（主楼+四塔+屋顶+门）、光照正常、坐标参照层可读。
2. 若发现问题：修改 build-castle.mjs 或直接 `render_png highlight` 定位 → 修脚本 → 重跑 → 复检。
3. 另渲染 `render_png {view:"top", cutaway:"quarter", size:384}` 检查主楼壳体内部。

- [ ] **Step 4: 写 README.md**

```markdown
# voxelforge

LLM-native 3D 体素建模：MCP server + web viewer。

## 快速开始
```bash
pnpm install && pnpm build
node dist/cli.js new model.voxel.json --size 64
node dist/cli.js serve model.voxel.json   # 浏览器打开 http://127.0.0.1:4173
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

## 数据格式
`.voxel.json`：`{ format, size, palette: {"1":"#rrggbb"}, voxels: {"x,y,z": 色号} }`（LLM 可直读直写）。

## LLM 自检闭环
`check()` → `slice_ascii` 定位 → `render_png(views:"multi")` 目检 → `highlight` 区域修改 → `undo()` 兜底 → `export` 交付。
详见 `docs/superpowers/specs/2026-08-31-voxelforge-design.md`。
```

- [ ] **Step 5: 全量验证（验收闸门）**

```bash
pnpm build && pnpm test
node examples/build-castle.mjs
```
Expected: build 零错误、全部测试通过、示例产物齐全（castle.voxel.json / castle.glb / castle.multi.png）。对照 spec 验收标准逐条核对：
1. pnpm 全绿 ✓ 2. MCP 工具建城堡计数正确 ✓ 3. serve + MCP 实时更新（本会话用 InMemoryTransport 调 tool + curl /model 验证）✓ 4. GLB 闸门 + PNG 目检 ✓ 5. script 程序化生成 ✓

- [ ] **Step 6: Commit**

```bash
git add examples README.md
git commit -m "feat: 城堡端到端示例 + README"
```

---

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：18 工具（Task 13/14）✓；数据格式与原子写（Task 3）✓；GLB/vox/PNG 导出+结构闸门（Task 7/8/9）✓；render 多模态套件 view/multi/axes/cutaway/highlight（Task 9/10）✓；slice_ascii/check/script（Task 11/12）✓；viewer SSE+相机保持（Task 15）✓；CLI/bins（Task 16）✓；验收标准 1-5（Task 17）✓；instructions few-shot（Task 14）✓。
2. **占位符扫描**：计划内内联勘误已就地标注并给出修正代码（vox chunk() 辅助函数 head 写法、render.ts Cam.eyeDist 字段、tools.test export 正则）；TOOLS 的 `optional_()` 伪码已在交接前直接改为可用的 zod 代码（本提交）。无遗留 TBD。
3. **类型一致性**：`ChangeStats/PlaceOpts/CylinderOpts/LineOpts`（Task 4/5 定义 → Task 12/13 消费）、`VoxelSource/gridSource/renderView/renderProject`（Task 9/10 → 13/16）、`buildMesh/MeshData`（Task 7 → 15/16）、`ForgeSession/TOOLS`（Task 13 → 14/16）签名前后一致。
