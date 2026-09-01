# Voxelforge 体素 → SDF → Surface Nets → mesh 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 voxelforge 新增"体素 → 有符号距离场(SDF) → 可调分辨率 Surface Nets 重建 → 平滑网格 GLB"能力，并把同一管线接到 web viewer（平滑网格模式 + 分辨率滑杆）。

**Architecture:** 新增两个 core 模块 `sdf.ts`（8SSEDT 距离变换→有符号距离场）与 `surfaceNets.ts`（三线性插值采样 + Surface Nets 重建出 MeshData），复用现有 `exportGlb`/`verifyGlb`/`MeshData`。入口为一个新工具 `sdf_mesh`（进 ForgeSession）+ CLI 子命令 `voxelforge remesh`；viewer（`viewer/app.ts`）用同一套函数在浏览器实时重算并渲染平滑网格。

**Tech Stack:** TypeScript / Node ≥20 / pnpm / ESM（本项目已有：zod、esbuild、vitest、three）。core 零新增运行时依赖。

## Global Constraints

- core 模块**零运行时依赖**；只用现有 zod（工具 schema）、`exportGlb`/`verifyGlb`、`MeshData`。
- 颜色一律 `#RRGGBB`；工具入参经 zod 校验；失败不污染 undo 栈 / 不落盘。
- 坐标约定：x 右、y 上、z 前；region 六元组含两端；工具输出路径字段是 **`path`**。
- 工具集 Count 从 **18 → 19**（`test/tools.test.ts` 里 `names.length` 断言须同步改）。
- `resolution` 为立方**最大轴**边长（1..256 整数），其余轴按比例换算（`out[axis] = clamp(round(res * size[axis] / maxAxis))`）。
- `smooth` 为 SDF 盒式平滑迭代次数（0..8，0=不平滑），默认 0。
- 顶点色：默认采样最近占用体素色；传 `color` 时平涂单色。

---

### Task 1: `src/core/sdf.ts` —— 有符号距离场

**Files:**
- Create: `src/core/sdf.ts`
- Test: `test/sdf.test.ts`

**Interfaces:**
- Produces:
  - `interface SdfField { data: Float32Array; size: [number, number, number] }`
  - `computeSignedDistance(grid: SparseVoxelGrid, opts?: { smooth?: number }): SdfField` —— 原生分辨率有符号距离场（cell 中心值；占用=负、空=正）。
  - `sampleField(f: SdfField, wx: number, wy: number, wz: number): number` —— 三线性插值采样。

- [ ] **Step 1: 写失败测试**

```ts
// test/sdf.test.ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { computeSignedDistance, sampleField } from "../src/core/sdf.js";

function boxGrid(size: [number, number, number], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): SparseVoxelGrid {
  const g = new SparseVoxelGrid(size);
  for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) g.set(a, b, c, 1);
  return g;
}

describe("computeSignedDistance", () => {
  it("单盒：内部为负、外部为正、边界附近过零", () => {
    const g = boxGrid([8, 8, 8], 2, 2, 2, 5, 5, 5);
    const f = computeSignedDistance(g);
    expect(sampleField(f, 4, 4, 4)).toBeLessThan(0);      // 盒心内部
    expect(sampleField(f, 0, 0, 0)).toBeGreaterThan(0);   // 角落外部
    expect(sampleField(f, 1.5, 4, 4)).toBeLessThan(0);    // 紧贴盒内(距面0.5)
    expect(sampleField(f, 6.5, 4, 4)).toBeGreaterThan(0); // 紧贴盒外
  });

  it("空网格：全部为正（无体）", () => {
    const g = new SparseVoxelGrid([4, 4, 4]);
    const f = computeSignedDistance(g);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) {
      expect(sampleField(f, x + 0.5, y + 0.5, z + 0.5)).toBeGreaterThan(0);
    }
  });

  it("smooth 使场更平滑（相邻样本差更小）", () => {
    const g = boxGrid([8, 8, 8], 2, 2, 2, 5, 5, 5);
    const raw = computeSignedDistance(g);
    const sm = computeSignedDistance(g, { smooth: 2 });
    const dRaw = Math.abs(sampleField(raw, 3.5, 4, 4) - sampleField(raw, 4.5, 4, 4));
    const dSm = Math.abs(sampleField(sm, 3.5, 4, 4) - sampleField(sm, 4.5, 4, 4));
    expect(dSm).toBeLessThan(dRaw);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/sdf.test.ts`
Expected: FAIL，报 `Cannot find module '../src/core/sdf.js'` 或 `computeSignedDistance is not defined`。

- [ ] **Step 3: 实现 `src/core/sdf.ts`**

```ts
import type { SparseVoxelGrid } from "./grid.js";

export interface SdfField {
  data: Float32Array; // index = x + y*sx + z*sx*sy
  size: [number, number, number];
}

const DELTAS: Array<[number, number, number]> = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      if (dx || dy || dz) DELTAS.push([dx, dy, dz]);

function edgeWeight(dx: number, dy: number, dz: number): number {
  const n = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
  return n === 1 ? 3 : n === 2 ? 4 : 5;
}

// 8SSEDT（3-4-5 chamfer 权重）近似欧氏距离场：mask[i]=1 → 源(距离=0)
function edt(mask: Uint8Array, [sx, sy, sz]: [number, number, number]): Float32Array {
  const N = sx * sy * sz;
  const dist = new Float64Array(N);
  const INF = 1e9;
  const idx = (x: number, y: number, z: number) => x + y * sx + z * sx * sy;
  for (let i = 0; i < N; i++) dist[i] = mask[i] ? 0 : INF;
  // 前向
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++) {
        const i = idx(x, y, z);
        for (const [dx, dy, dz] of DELTAS) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          const earlier = nz < z || (nz === z && (ny < y || (ny === y && nx < x)));
          if (!earlier) continue;
          const j = idx(nx, ny, nz);
          const cand = dist[j] + edgeWeight(dx, dy, dz);
          if (cand < dist[i]) dist[i] = cand;
        }
      }
  // 后向
  for (let z = sz - 1; z >= 0; z--)
    for (let y = sy - 1; y >= 0; y--)
      for (let x = sx - 1; x >= 0; x--) {
        const i = idx(x, y, z);
        for (const [dx, dy, dz] of DELTAS) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          const later = nz > z || (nz === z && (ny > y || (ny === y && nx > x)));
          if (!later) continue;
          const j = idx(nx, ny, nz);
          const cand = dist[j] + edgeWeight(dx, dy, dz);
          if (cand < dist[i]) dist[i] = cand;
        }
      }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = dist[i] / 3;
  return out;
}

function boxBlurLine(s: Float32Array, d: Float32Array, start: number, len: number, stride: number, radius: number): void {
  for (let i = 0; i < len; i++) {
    let sum = 0, cnt = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= len) continue;
      sum += s[start + j * stride];
      cnt++;
    }
    d[start + i * stride] = sum / cnt;
  }
}

function boxBlur(data: Float32Array, [sx, sy, sz]: [number, number, number], radius: number): void {
  if (radius <= 0) return;
  const N = sx * sy * sz;
  let a = Float32Array.from(data);
  let b = new Float32Array(N);
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) boxBlurLine(a, b, y * sx + z * sx * sy, sx, 1, radius);
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) boxBlurLine(b, a, x + z * sx * sy, sy, sx, radius);
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) boxBlurLine(a, b, x + y * sx, sz, sx * sy, radius);
  data.set(b);
}

export function computeSignedDistance(grid: SparseVoxelGrid, opts: { smooth?: number } = {}): SdfField {
  const [sx, sy, sz] = grid.size;
  const N = sx * sy * sz;
  const idx = (x: number, y: number, z: number) => x + y * sx + z * sx * sy;
  const occ = new Uint8Array(N);
  for (const [x, y, z] of grid.coords()) occ[idx(x, y, z)] = 1;
  const empty = new Uint8Array(N);
  const solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) { empty[i] = occ[i] ? 0 : 1; solid[i] = occ[i] ? 1 : 0; }
  const dEmpty = edt(empty, grid.size);
  const dSolid = edt(solid, grid.size);
  const data = new Float32Array(N);
  for (let i = 0; i < N; i++) data[i] = occ[i] ? -dEmpty[i] : dSolid[i];
  const s = opts.smooth ?? 0;
  if (s > 0) boxBlur(data, [sx, sy, sz], s * 3);
  return { data, size: grid.size };
}

export function sampleField(f: SdfField, wx: number, wy: number, wz: number): number {
  const [sx, sy, sz] = f.size;
  const d = f.data;
  const nx = Math.min(Math.max(wx - 0.5, 0), sx - 1);
  const ny = Math.min(Math.max(wy - 0.5, 0), sy - 1);
  const nz = Math.min(Math.max(wz - 0.5, 0), sz - 1);
  const x0 = Math.floor(nx), y0 = Math.floor(ny), z0 = Math.floor(nz);
  const x1 = Math.min(x0 + 1, sx - 1), y1 = Math.min(y0 + 1, sy - 1), z1 = Math.min(z0 + 1, sz - 1);
  const tx = nx - x0, ty = ny - y0, tz = nz - z0;
  const I = (x: number, y: number, z: number) => x + y * sx + z * sx * sy;
  const c000 = d[I(x0, y0, z0)], c100 = d[I(x1, y0, z0)], c010 = d[I(x0, y1, z0)], c110 = d[I(x1, y1, z0)];
  const c001 = d[I(x0, y0, z1)], c101 = d[I(x1, y0, z1)], c011 = d[I(x0, y1, z1)], c111 = d[I(x1, y1, z1)];
  const c00 = c000 * (1 - tx) + c100 * tx, c10 = c010 * (1 - tx) + c110 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx, c11 = c011 * (1 - tx) + c111 * tx;
  const c0 = c00 * (1 - ty) + c10 * ty, c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run test/sdf.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/core/sdf.ts test/sdf.test.ts
git commit -m "feat: 8SSEDT 有符号距离场（computeSignedDistance + sampleField）"
```

---

### Task 2: `src/core/surfaceNets.ts` —— Surface Nets 重建

**Files:**
- Create: `src/core/surfaceNets.ts`
- Test: `test/surfaceNets.test.ts`

**Interfaces:**
- Consumes: `SdfField`/`sampleField`（Task 1）；`MeshData`（`../core/export/mesh.js`）。
- Produces:
  - `surfaceNets(field: SdfField, res: number, colorAt: (x,y,z)=>[r,g,b]): MeshData` —— 在 `res`（最大轴边长）采样网格上重建平滑 mesh。
  - `signedVolume(m: MeshData): number` —— 三角网格有符号体积。
  - `bboxOf(m: MeshData): { min: [number,number,number]; max: [number,number,number] }`。

- [ ] **Step 1: 写失败测试**

```ts
// test/surfaceNets.test.ts
import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { computeSignedDistance } from "../src/core/sdf.js";
import { surfaceNets, signedVolume, bboxOf } from "../src/core/surfaceNets.js";

function boxGrid(size: [number, number, number], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): SparseVoxelGrid {
  const g = new SparseVoxelGrid(size);
  for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) g.set(a, b, c, 1);
  return g;
}

describe("surfaceNets", () => {
  it("单盒包围盒≈盒、体积≈体素体积", () => {
    // 盒 cells 4..11 → 世界 [4,12]，体积 8^3=512
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [1, 0, 0]);
    const bb = bboxOf(m);
    expect(bb.min[0]).toBeGreaterThan(3.5); expect(bb.min[0]).toBeLessThan(4.6);
    expect(bb.max[0]).toBeGreaterThan(11.4); expect(bb.max[0]).toBeLessThan(12.5);
    expect(Math.abs(signedVolume(m) - 512) / 512).toBeLessThan(0.2);
  });

  it("三角数随分辨率增大而单调增加", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m8 = surfaceNets(f, 8, () => [1, 0, 0]);
    const m16 = surfaceNets(f, 16, () => [1, 0, 0]);
    const m32 = surfaceNets(f, 32, () => [1, 0, 0]);
    expect(m32.indices.length).toBeGreaterThan(m16.indices.length);
    expect(m16.indices.length).toBeGreaterThan(m8.indices.length);
  });

  it("封闭/水密：每条无向边恰 2 面", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [1, 0, 0]);
    const count = new Map<string, number>();
    const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
        const k = key(u, v);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    for (const [, cnt] of count) expect(cnt).toBe(2);
  });

  it("法线近似轴向（盒面法线沿轴）", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [1, 0, 0]);
    // 取 x 最小面上顶点，法线应接近 -x
    let best: number[] | undefined;
    let minX = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (m.positions[i] < minX) { minX = m.positions[i]; best = [m.normals[i], m.normals[i + 1], m.normals[i + 2]]; }
    }
    expect(best!).toBeDefined();
    expect(best![0]).toBeLessThan(-0.8); // 主体指向 -x
  });

  it("顶点色来源 colorAt", () => {
    const g = boxGrid([16, 16, 16], 4, 4, 4, 11, 11, 11);
    const f = computeSignedDistance(g);
    const m = surfaceNets(f, 32, () => [0.5, 0.25, 0.75]);
    expect(m.colors.length).toBe(m.positions.length);
    expect(Math.abs(m.colors[0] - 0.5)).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run test/surfaceNets.test.ts`
Expected: FAIL，`Cannot find module '../src/core/surfaceNets.js'`。

- [ ] **Step 3: 实现 `src/core/surfaceNets.ts`**

```ts
import type { MeshData } from "./export/mesh.js";
import { sampleField, type SdfField } from "./sdf.js";

// cell 角点偏移（第 i 个角）：i = a*4 + b*2 + c → (a,b,c)
const CORN: Array<[number, number, number]> = [];
for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) CORN.push([a, b, c]);
// cell 12 条边（角对）：沿 x / 沿 y / 沿 z 各 4 条
const EDGES: Array<[number, number]> = [
  [0, 4], [1, 5], [2, 6], [3, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 1], [4, 5], [2, 3], [6, 7]
];

export function surfaceNets(field: SdfField, res: number, colorAt: (x: number, y: number, z: number) => [number, number, number]): MeshData {
  const [sx, sy, sz] = field.size;
  const maxA = Math.max(sx, sy, sz);
  const clampV = (v: number) => Math.min(Math.max(v, 1), 256);
  const ox = clampV(Math.round((res * sx) / maxA));
  const oy = clampV(Math.round((res * sy) / maxA));
  const oz = clampV(Math.round((res * sz) / maxA));
  const nx = ox + 1, ny = oy + 1, nz = oz + 1;
  const csx = sx / ox, csy = sy / oy, csz = sz / oz;

  const NI = (i: number, j: number, k: number) => i + j * nx + k * nx * ny;
  const nodeField = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        nodeField[NI(i, j, k)] = sampleField(field, i * csx, j * csy, k * csz);

  const inside = (v: number) => v < 0;
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const vertexAt = new Int32Array(ox * oy * oz).fill(-1);

  const gradAt = (wx: number, wy: number, wz: number): [number, number, number] => {
    const e = 0.5;
    const gx = sampleField(field, wx + e, wy, wz) - sampleField(field, wx - e, wy, wz);
    const gy = sampleField(field, wx, wy + e, wz) - sampleField(field, wx, wy - e, wz);
    const gz = sampleField(field, wx, wy, wz + e) - sampleField(field, wx, wy, wz - e);
    const L = Math.hypot(gx, gy, gz) || 1;
    return [gx / L, gy / L, gz / L];
  };

  // 收集 cell 12 条边交点 → 顶点（corner-pair 枚举）
  const cellVertices = (i: number, j: number, k: number): void => {
    const cIdx = i + j * ox + k * ox * oy;
    if (vertexAt[cIdx] >= 0) return;
    let sumX = 0, sumY = 0, sumZ = 0, cnt = 0;
    for (const [e0, e1] of EDGES) {
      const c0 = CORN[e0], c1 = CORN[e1];
      const x0 = i + c0[0], y0 = j + c0[1], z0 = k + c0[2];
      const x1 = i + c1[0], y1 = j + c1[1], z1 = k + c1[2];
      const fa = nodeField[NI(x0, y0, z0)];
      const fb = nodeField[NI(x1, y1, z1)];
      if (inside(fa) === inside(fb)) continue;
      const t = fa / (fa - fb);
      sumX += x0 + t * (x1 - x0);
      sumY += y0 + t * (y1 - y0);
      sumZ += z0 + t * (z1 - z0);
      cnt++;
    }
    if (!cnt) return;
    const nodeX = sumX / cnt, nodeY = sumY / cnt, nodeZ = sumZ / cnt;
    const wx = nodeX * csx, wy = nodeY * csy, wz = nodeZ * csz;
    const [gnx, gny, gnz] = gradAt(wx, wy, wz);
    const [r, g, b] = colorAt(wx, wy, wz);
    vertexAt[cIdx] = pos.length / 3;
    pos.push(wx, wy, wz);
    nor.push(gnx, gny, gnz);
    col.push(r, g, b);
  };

  const idxArr: number[] = [];
  const pushQuad = (v0: number, v1: number, v2: number, v3: number): void => {
    const P = (v: number) => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
    const p0 = P(v0), p1 = P(v1), p2 = P(v2);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const ng = e1[1] * e2[2] - e1[2] * e2[1];
    const ngY = e1[2] * e2[0] - e1[0] * e2[2];
    const ngZ = e1[0] * e2[1] - e1[1] * e2[0];
    const na = [nor[3 * v0] + nor[3 * v1] + nor[3 * v2] + nor[3 * v3],
      nor[3 * v0 + 1] + nor[3 * v1 + 1] + nor[3 * v2 + 1] + nor[3 * v3 + 1],
      nor[3 * v0 + 2] + nor[3 * v1 + 2] + nor[3 * v2 + 2] + nor[3 * v3 + 2]];
    const dot = ng * na[0] + ngY * na[1] + ngZ * na[2];
    if (dot < 0) { idxArr.push(v0, v3, v2, v0, v2, v1); }
    else { idxArr.push(v0, v1, v2, v0, v2, v3); }
  };

  // X 边 (a,b,c)-(a+1,b,c)：cross 时 4 cells (a,b-1,c-1)(a,b-1,c)(a,b,c)(a,b,c-1)
  for (let a = 0; a < ox; a++)
    for (let b = 1; b < oy; b++)
      for (let c = 1; c < oz; c++) {
        const fa = nodeField[NI(a, b, c)], fb = nodeField[NI(a + 1, b, c)];
        if (inside(fa) === inside(fb)) continue;
        cellVertices(a, b - 1, c - 1); cellVertices(a, b - 1, c); cellVertices(a, b, c); cellVertices(a, b, c - 1);
        const q = [vertexAt[a + (b - 1) * ox + (c - 1) * ox * oy], vertexAt[a + (b - 1) * ox + c * ox * oy],
          vertexAt[a + b * ox + c * ox * oy], vertexAt[a + b * ox + (c - 1) * ox * oy]];
        if (q.some((x) => x < 0)) continue;
        pushQuad(q[0], q[1], q[2], q[3]);
      }
  // Y 边 (a,b,c)-(a,b+1,c)：cells (a-1,b,c-1)(a-1,b,c)(a,b,c)(a,b,c-1)
  for (let b = 0; b < oy; b++)
    for (let a = 1; a < ox; a++)
      for (let c = 1; c < oz; c++) {
        const fa = nodeField[NI(a, b, c)], fb = nodeField[NI(a, b + 1, c)];
        if (inside(fa) === inside(fb)) continue;
        cellVertices(a - 1, b, c - 1); cellVertices(a - 1, b, c); cellVertices(a, b, c); cellVertices(a, b, c - 1);
        const q = [vertexAt[(a - 1) + b * ox + (c - 1) * ox * oy], vertexAt[(a - 1) + b * ox + c * ox * oy],
          vertexAt[a + b * ox + c * ox * oy], vertexAt[a + b * ox + (c - 1) * ox * oy]];
        if (q.some((x) => x < 0)) continue;
        pushQuad(q[0], q[1], q[2], q[3]);
      }
  // Z 边 (a,b,c)-(a,b,c+1)：cells (a-1,b-1,c)(a-1,b,c)(a,b,c)(a,b-1,c)
  for (let c = 0; c < oz; c++)
    for (let a = 1; a < ox; a++)
      for (let b = 1; b < oy; b++) {
        const fa = nodeField[NI(a, b, c)], fb = nodeField[NI(a, b, c + 1)];
        if (inside(fa) === inside(fb)) continue;
        cellVertices(a - 1, b - 1, c); cellVertices(a - 1, b, c); cellVertices(a, b, c); cellVertices(a, b - 1, c);
        const q = [vertexAt[(a - 1) + (b - 1) * ox + c * ox * oy], vertexAt[(a - 1) + b * ox + c * ox * oy],
          vertexAt[a + b * ox + c * ox * oy], vertexAt[a + (b - 1) * ox + c * ox * oy]];
        if (q.some((x) => x < 0)) continue;
        pushQuad(q[0], q[1], q[2], q[3]);
      }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    indices: new Uint32Array(idxArr)
  };
}

export function signedVolume(m: MeshData): number {
  const p = m.positions;
  let vol = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const bx = p[3 * b], by = p[3 * b + 1], bz = p[3 * b + 2];
    const cx = p[3 * c], cy = p[3 * c + 1], cz = p[3 * c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

export function bboxOf(m: MeshData): { min: [number, number, number]; max: [number, number, number] } {
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minx) minx = p[i]; if (p[i + 1] < miny) miny = p[i + 1]; if (p[i + 2] < minz) minz = p[i + 2];
    if (p[i] > maxx) maxx = p[i]; if (p[i + 1] > maxy) maxy = p[i + 1]; if (p[i + 2] > maxz) maxz = p[i + 2];
  }
  return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run test/surfaceNets.test.ts`
Expected: PASS（5 个用例）。若"边恰 2 面"或"包围盒/体积"失败，先检查 `cellVertices` 的 12 条边是否覆盖全部且交点采样正确。

- [ ] **Step 5: 提交**

```bash
git add src/core/surfaceNets.ts test/surfaceNets.test.ts
git commit -m "feat: Surface Nets 多分辨率重建（surfaceNets/signedVolume/bboxOf）"
```

---

### Task 3: 工具 `sdf_mesh` 接入 ForgeSession + core 导出

**Files:**
- Modify: `src/core/index.ts`（末尾补两行导出）
- Modify: `src/tools.ts`（TOOLS 数组加 `sdf_mesh`；`handle` 加 `case "sdf_mesh"`；顶部 import）
- Test: `test/tools.test.ts`（`listTools` 18→19；新增 sdf_mesh 用例）

**Interfaces:**
- Consumes: `computeSignedDistance`/`sampleField`（Task1），`surfaceNets`/`signedVolume`/`bboxOf`（Task2），`hexToRgb01`（`../core/export/mesh.js`，已导出）。
- Produces: `TOOLS` 新条目 `sdf_mesh`；`handle("sdf_mesh")` 返回摘要字符串。

- [ ] **Step 1: 改 `src/core/index.ts` 导出**

在文件末尾追加：

```ts
export * from "./sdf.js";
export * from "./surfaceNets.js";
```

- [ ] **Step 2: 写工具测试（先红）**

在 `test/tools.test.ts` 顶部 import 处加：

```ts
import { existsSync } from "node:fs";
```

把 `it("listTools 18 个且无重名", ...)` 里 `expect(names.length).toBe(18)` 改为 `toBe(19)`。

新增用例（追加在 ForgeSession describe 内）：

```ts
  it("sdf_mesh 出平滑 GLB（默认色采样 + 可强制单色）", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [16, 16, 16] });
    await s.handle("box", { x0: 4, y0: 4, z0: 4, x1: 11, y1: 11, z1: 11, color: "#8b4513" });
    const r = await s.handle("sdf_mesh", { resolution: 24 });
    expect(r.content).toMatch(/sdf_mesh: GLB .*_sdf_r24\.glb/);
    expect(r.content).toMatch(/结构闸门通过/);
    expect(existsSync(file.replace(/\.voxel\.json$/, "") + "_sdf_r24.glb")).toBe(true);
    // 强制单色路径
    const r2 = await s.handle("sdf_mesh", { resolution: 16, color: "#ff0000", path: file + ".hue.glb" });
    expect(r2.content).toMatch(/sdf_mesh: GLB/);
    expect(r2.content).toMatch(/结构闸门通过/);
    expect(existsSync(file + ".hue.glb")).toBe(true);
  });

  it("sdf_mesh 空网格报错", async () => {
    const s = new ForgeSession(file);
    await s.init();
    await s.handle("create_project", { size: [8, 8, 8] });
    await expect(s.handle("sdf_mesh", {})).rejects.toThrow(/空/);
  });
```

Run: `pnpm vitest run test/tools.test.ts`
Expected: FAIL（`sdf_mesh` 未知工具；`listTools` 断言失败）。

- [ ] **Step 3: 实现 `src/tools.ts`**

顶部 import 加：

```ts
import { computeSignedDistance } from "./core/sdf.js";
import { surfaceNets, signedVolume, bboxOf } from "./core/surfaceNets.js";
import { buildMesh, hexToRgb01 } from "./core/export/mesh.js";
```

`TOOLS` 数组末尾（`render_png` 之后）加：

```ts
  { name: "sdf_mesh", description: "体素→有符号距离场→Surface Nets 重建平滑网格并出 GLB。参数: resolution(立方最大轴边长,默认=体素size), color(平涂单色,缺省采样最近体素色), smooth, path。示例: {resolution:32}", schema: { resolution: z.number().int().min(1).max(256).optional(), color: z.string().optional(), smooth: z.number().int().min(0).max(8).optional(), path: z.string().optional() } }
```

`handle` 的 switch 里，在 `case "export":` 之前加：

```ts
      case "sdf_mesh": {
        if (this.grid.count === 0) throw new Error("空网格无法从 SDF 重建");
        const gsize = this.grid.size;
        const maxAxis = Math.max(gsize[0], gsize[1], gsize[2]);
        const res = a.resolution ?? maxAxis;
        const field = computeSignedDistance(this.grid, { smooth: a.smooth ?? 0 });
        const colorAt = (x: number, y: number, z: number): [number, number, number] => {
          if (a.color !== undefined) return hexToRgb01(String(a.color));
          const vx = Math.min(Math.max(Math.round(x - 0.5), 0), gsize[0] - 1);
          const vy = Math.min(Math.max(Math.round(y - 0.5), 0), gsize[1] - 1);
          const vz = Math.min(Math.max(Math.round(z - 0.5), 0), gsize[2] - 1);
          const idx = this.grid.get(vx, vy, vz);
          const hex = idx === undefined ? "#888888" : (this.palette.hexOf(idx) ?? "#888888");
          return hexToRgb01(hex);
        };
        const mesh = surfaceNets(field, res, colorAt);
        if (mesh.indices.length === 0) throw new Error("SDF 表面未捕捉到任何面（模型可能占满/全空，或分辨率过小）");
        const buf = exportGlb(mesh);
        const out = a.path ?? `${this.file.replace(/\.voxel\.json$/, "")}_sdf_r${res}.glb`;
        await fs.writeFile(out, buf);
        const v = verifyGlb(buf);
        const bb = bboxOf(mesh);
        const vol = signedVolume(mesh);
        return { content: `sdf_mesh: GLB ${out}（${v.tris} tris, ${mesh.positions.length / 3} verts, bbox (${bb.min[0].toFixed(1)},${bb.min[1].toFixed(1)},${bb.min[2].toFixed(1)})-(${bb.max[0].toFixed(1)},${bb.max[1].toFixed(1)},${bb.max[2].toFixed(1)}), 体积 ${vol.toFixed(1)}, 结构闸门通过）` };
      }
```

> `exportGlb`/`verifyGlb`/`fs` 已在本文件顶部存在，无需重复 import。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run test/tools.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/index.ts src/tools.ts test/tools.test.ts
git commit -m "feat: 工具 sdf_mesh（体素→SDF→Surface Nets→GLB）+ core 导出"
```

---

### Task 4: CLI 子命令 `remesh`

**Files:**
- Modify: `src/cli.ts`（parseArgs options 加 `res`/`smooth`/`color`；加 `remesh` 分支；usage 补一行）
- Test: `test/cli.test.ts`（加 remesh 用例）

**Interfaces:**
- Consumes: `ForgeSession.handle("sdf_mesh")`（Task 3）。

- [ ] **Step 1: 写失败测试**

在 `test/cli.test.ts` 里追加：

```ts
  it("remesh 出平滑网格 GLB", async () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "vf-"));
    const file = join(dir, "m.voxel.json");
    expect(run(["new", file, "--size", "16"]).status).toBe(0);
    const session = new ForgeSession(file);
    await session.init();
    await session.handle("box", { x0: 4, y0: 4, z0: 4, x1: 11, y1: 11, z1: 11, color: "#ff0000" });
    const out = join(dir, "smooth.glb");
    const r = run(["remesh", file, "--res", "24", "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/sdf_mesh: GLB/);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).subarray(0, 4).toString("ascii")).toBe("glTF");
  });
```

Run: `pnpm vitest run test/cli.test.ts`（需先 `pnpm build`）。
Expected: FAIL（`remesh` 未知子命令）。

- [ ] **Step 2: 实现 `src/cli.ts`**

`usage()` 字符串里，`render` 那一行之后加一行：

```
  voxelforge remesh <file> [--res 64] [--smooth 1] [--color #hex] --out out.glb   # 体素→SDF→平滑网格 GLB
```

`main()` 里 `parseArgs` 的 options 加：

```ts
      res: { type: "string" },
      smooth: { type: "string" },
      color: { type: "string" },
```

在 `if (cmd === "serve")` 之前加：

```ts
  if (cmd === "remesh") {
    if (!file) throw new Error("缺 <file>");
    const session = new ForgeSession(file);
    await session.init();
    const args: Record<string, unknown> = {};
    if (values.res !== undefined) args.resolution = Number(values.res);
    if (values.smooth !== undefined) args.smooth = Number(values.smooth);
    if (typeof values.color === "string") args.color = values.color;
    if (typeof values.out === "string") args.path = values.out;
    const { content } = await session.handle("sdf_mesh", args);
    console.log(content);
    return 0;
  }
```

- [ ] **Step 3: 运行确认通过**

Run: `pnpm build && pnpm vitest run test/cli.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: CLI voxelforge remesh 子命令"
```

---

### Task 5: web viewer 平滑网格模式

**Files:**
- Modify: `src/viewer/index.html`（加工具栏：切换按钮 + 分辨率滑杆）
- Modify: `src/viewer/app.ts`（加 mesh 模式：复用 computeSignedDistance + surfaceNets 实时重建）

**Interfaces:**
- Consumes: `SparseVoxelGrid`（`../core/grid.js`）、`computeSignedDistance`（`../core/sdf.js`）、`surfaceNets`（`../core/surfaceNets.js`）、`hexToRgb01`（`../core/export/mesh.js`）。

- [ ] **Step 1: 改 `src/viewer/index.html`**

在 `<div id="hud">…</div>` 之后、`<script>` 之前插入：

```html
<div id="toolbar" style="position:fixed;top:44px;left:12px;z-index:2;display:flex;gap:10px;align-items:center;background:rgba(20,22,26,.6);padding:6px 10px;border-radius:8px;">
  <button id="modeBtn">体素</button>
  <label id="resWrap" style="display:none;align-items:center;gap:6px;">分辨率
    <input id="resSlider" type="range" min="8" max="128" value="64" style="width:120px;">
    <span id="resVal">64</span>
  </label>
</div>
```

- [ ] **Step 2: 改 `src/viewer/app.ts`（全量替换）**

```ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparseVoxelGrid } from "../core/grid.js";
import { computeSignedDistance } from "../core/sdf.js";
import { surfaceNets } from "../core/surfaceNets.js";
import { buildMesh, hexToRgb01 } from "../core/export/mesh.js";
import type { VoxelProject } from "../core/types.js";

const hud = document.getElementById("hud")!;
const modeBtn = document.getElementById("modeBtn")! as HTMLButtonElement;
const resWrap = document.getElementById("resWrap")! as HTMLElement;
const resSlider = document.getElementById("resSlider")! as HTMLInputElement;
const resVal = document.getElementById("resVal")! as HTMLElement;

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
scene.add(new THREE.GridHelper(128, 16, 0x3a3f47, 0x262a30));

type Proj = VoxelProject;
let mode: "voxel" | "mesh" = "voxel";
let meshRes = 64;
let current: Proj | null = null;
let obj: THREE.Mesh | null = null;

function clearObj(): void {
  if (obj) { scene.remove(obj); obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); obj = null; }
}

function buildVoxel(p: Proj): void {
  const entries = Object.entries(p.voxels).map(([k, idx]) => {
    const [x, y, z] = k.split(",").map(Number);
    return [x, y, z, idx] as [number, number, number, number];
  });
  const m = buildMesh(entries, (i) => p.palette[String(i)] ?? "#ff00ff");
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  obj = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(obj);
  hud.textContent = `体素 ${entries.length} · 网格 ${p.size.join("x")} · ${new Date().toLocaleTimeString()}`;
}

function buildSdf(p: Proj): void {
  const grid = SparseVoxelGrid.fromProject(p);
  const sdf = computeSignedDistance(grid, { smooth: 1 });
  const sizeS = grid.size;
  const colorAt = (x: number, y: number, z: number): [number, number, number] => {
    const vx = Math.min(Math.max(Math.round(x - 0.5), 0), sizeS[0] - 1);
    const vy = Math.min(Math.max(Math.round(y - 0.5), 0), sizeS[1] - 1);
    const vz = Math.min(Math.max(Math.round(z - 0.5), 0), sizeS[2] - 1);
    const idx = grid.get(vx, vy, vz);
    return idx === undefined ? [0.55, 0.55, 0.55] : hexToRgb01(p.palette[String(idx)] ?? "#ffffff");
  };
  const m = surfaceNets(sdf, meshRes, colorAt);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(m.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  obj = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(obj);
  hud.textContent = `平滑网格 res ${meshRes} · tris ${m.indices.length / 3} · ${new Date().toLocaleTimeString()}`;
}

function rebuild(p: Proj): void {
  clearObj();
  if (mode === "voxel") buildVoxel(p);
  else buildSdf(p);
}

function onProject(p: Proj): void {
  current = p;
  const maxAxis = Math.max(...p.size);
  resSlider.value = String(maxAxis);
  resVal.textContent = String(maxAxis);
  meshRes = maxAxis;
  rebuild(p);
}

modeBtn.addEventListener("click", () => {
  mode = mode === "voxel" ? "mesh" : "voxel";
  modeBtn.textContent = mode === "voxel" ? "体素" : "平滑网格";
  resWrap.style.display = mode === "mesh" ? "flex" : "none";
  if (current) rebuild(current);
});
resSlider.addEventListener("input", () => {
  meshRes = Number(resSlider.value);
  resVal.textContent = String(meshRes);
  if (current && mode === "mesh") rebuild(current);
});

fetch("/model").then((r) => r.json()).then((p) => { if (p && p.size) onProject(p); });
new EventSource("/events").addEventListener("model", (e) => {
  const p = JSON.parse((e as MessageEvent).data);
  if (p && p.size) onProject(p);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
```

- [ ] **Step 3: 构建并冒烟验证**

Run: `pnpm build`
Expected: `viewer: dist/viewer/index.html 已生成`，无 TS/bundle 报错。

手动画检：`pnpm build` 后 `node dist/cli.js new /tmp/m.voxel.json --size 32` → `node dist/cli.js tool /tmp/m.voxel.json box '{"x0":8,"y0":4,"z0":8,"x1":23,"y1":20,"z1":23,"color":"#8b4513"}'` → `node dist/cli.js serve /tmp/m.voxel.json` → 浏览器打开，点"平滑网格"出现圆润网格，拖分辨率滑杆三角数变化、相机不跳。

- [ ] **Step 4: 提交**

```bash
git add src/viewer/index.html src/viewer/app.ts
git commit -m "feat: web viewer 平滑网格模式（复用 SDF/Surface Nets + 分辨率滑杆）"
```

---

### Task 6: 文档（skill + README）

**Files:**
- Modify: `skill/SKILL.md`（工具表加 `sdf_mesh`、18→19）
- Modify: `README.md`（CLI 表加 `remesh`、工具说明补 `sdf_mesh`）
- Modify: `src/cli.ts` 顶部的 `usage()` 已含 remesh（Task 4 已加）。

- [ ] **Step 1: 更新 `skill/SKILL.md`**

`## 18 工具速查` 标题与表格末尾（`render_png` 行后）加：

```markdown
| `sdf_mesh` | 体素→平滑网格 | `{resolution:32}`（立方最大轴边长,默认=体素size）；`color` 平涂单色/缺省采样最近体素色；`smooth` 0-8；出 GLB（结构闸门通过） |
```

标题 `## 18 工具速查` → `## 19 工具速查`。另在 `## 语义坑` 之后追加一条：

```markdown
- `sdf_mesh` 的网格是**连续曲面**（Surface Nets 重建），非方块体素——体积与包围盒≈体素模型但有平滑圆角；薄壁/小特征分辨率过低可能闭合不上内壳。
- 分辨率越高三角越多越平滑；在 viewer 切"平滑网格"模式可拖分辨率滑杆交互探索。
```

- [ ] **Step 2: 更新 `README.md`**

CLI 表加一行：

```markdown
| `voxelforge remesh <file> [--res N] [--smooth S] [--color #hex] --out out.glb` | 体素→SDF→Surface Nets→平滑网格 GLB |
```

数据格式/工具相关段落补一句：`sdf_mesh` 工具可从体素网格重建连续平滑网格（复用 core 的 `computeSignedDistance`/`surfaceNets`）。

- [ ] **Step 3: 提交**

```bash
git add skill/SKILL.md README.md
git commit -m "docs: skill/README 补 sdf_mesh 与 remesh"
```

---

### Task 7: 全量验证

- [ ] **Step 1: 构建 + 全量测试**

Run: `pnpm build && pnpm test`
Expected: 全绿。

- [ ] **Step 2: 端到端 CLI 冒烟**

```bash
node dist/cli.js new /tmp/e.voxel.json --size 32
node dist/cli.js tool /tmp/e.voxel.json box '{"x0":10,"y0":8,"z0":10,"x1":21,"y1":20,"z1":21,"color":"#9aa0a6"}'
node dist/cli.js remesh /tmp/e.voxel.json --res 48 --out /tmp/e.glb
node dist/cli.js tools   # 应列出 sdf_mesh
```
Expected: remesh 输出 `sdf_mesh: GLB ...（... tris, ... verts, bbox ..., 体积 ..., 结构闸门通过）`。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: sdf_mesh 能力收尾（构建/测试通过）"
```
