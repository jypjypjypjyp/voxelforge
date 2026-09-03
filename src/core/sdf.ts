import type { SparseVoxelGrid } from "./grid.js";

export interface SdfField {
  data: Float32Array; // index = x + y*sx + z*sx*sy（场空间）
  size: [number, number, number]; // 场数组维度（bbox+pad 裁剪后）
  origin: [number, number, number]; // 场 cell(0,0,0) 对应的体素格坐标；cell 中心世界坐标 = origin+i+0.5
  worldSize: [number, number, number]; // 完整体素网格尺寸（世界范围，网格化定位用）
}

// 26 邻域扁平化（避免元组解构开销）：dx/dy/dz + 步权(3/4/5) + 前向/后向方向标记
const ND = 26;
const DX = new Int8Array(ND), DY = new Int8Array(ND), DZ = new Int8Array(ND), W = new Uint8Array(ND);
const FWD = new Uint8Array(ND), BWD = new Uint8Array(ND);
{
  let n = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        DX[n] = dx; DY[n] = dy; DZ[n] = dz;
        const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        W[n] = m === 1 ? 3 : m === 2 ? 4 : 5;
        // 前向扫描只看"光栅序更早"的邻居；后向反之
        FWD[n] = dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))) ? 1 : 0;
        BWD[n] = dz > 0 || (dz === 0 && (dy > 0 || (dy === 0 && dx > 0))) ? 1 : 0;
        n++;
      }
}

const INF16 = 65535;

// 单次 8SSEDT（3-4-5 chamfer）：种子=界面胞（26 邻域有异相邻居），seed 值=到异相邻居的最小步权。
// 就地在 Uint16 上松弛；真实 chamfer 语义下与双 EDT 等价（docs/specs/2026-09-02 附录论证）。
function edtSeeded(seed: Uint16Array, [sx, sy, sz]: [number, number, number]): Uint16Array {
  const dist = seed;
  const plane = sx * sy;
  // 前向
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++) {
        const i = x + y * sx + z * plane;
        let d = dist[i];
        for (let n = 0; n < ND; n++) {
          if (!FWD[n]) continue;
          const nx = x + DX[n], ny = y + DY[n], nz = z + DZ[n];
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          const dj = dist[nx + ny * sx + nz * plane];
          if (dj >= INF16) continue;
          const cand = dj + W[n];
          if (cand < d) d = cand;
        }
        dist[i] = d;
      }
  // 后向
  for (let z = sz - 1; z >= 0; z--)
    for (let y = sy - 1; y >= 0; y--)
      for (let x = sx - 1; x >= 0; x--) {
        const i = x + y * sx + z * plane;
        let d = dist[i];
        for (let n = 0; n < ND; n++) {
          if (!BWD[n]) continue;
          const nx = x + DX[n], ny = y + DY[n], nz = z + DZ[n];
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          const dj = dist[nx + ny * sx + nz * plane];
          if (dj >= INF16) continue;
          const cand = dj + W[n];
          if (cand < d) d = cand;
        }
        dist[i] = d;
      }
  return dist;
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

export interface SignedFieldResult {
  field: SdfField;
  /** 场空间逐 cell 调色板索引（0=空），与 field 同维度——供颜色密集采样 */
  idx: Uint8Array;
}

export function buildSignedField(grid: SparseVoxelGrid, opts: { smooth?: number } = {}): SignedFieldResult {
  const [wx, wy, wz] = grid.size;
  const smooth = opts.smooth ?? 0;
  // pad：smooth>0 时保证零穿越面距场边界 > 平滑影响半径（boxBlur 半径 1 × smooth 次）
  const pad = smooth > 0 ? smooth + 1 : 1;
  const b = grid.bounds();
  const bx0 = b ? Math.max(0, b[0] - pad) : 0, bx1 = b ? Math.min(wx - 1, b[3] + pad) : wx - 1;
  const by0 = b ? Math.max(0, b[1] - pad) : 0, by1 = b ? Math.min(wy - 1, b[4] + pad) : wy - 1;
  const bz0 = b ? Math.max(0, b[2] - pad) : 0, bz1 = b ? Math.min(wz - 1, b[5] + pad) : wz - 1;
  const sx = bx1 - bx0 + 1, sy = by1 - by0 + 1, sz = bz1 - bz0 + 1;
  const plane = sx * sy, N = sx * sy * sz;

  // 一遍构建占用 + 调色板索引（密集，裁剪场空间）
  const occ = new Uint8Array(N);
  const idx = new Uint8Array(N);
  for (const [x, y, z, pi] of grid.coords()) {
    const i = (x - bx0) + (y - by0) * sx + (z - bz0) * plane;
    occ[i] = 1;
    idx[i] = pi;
  }

  // 种子：界面胞（26 邻域含异相）→ 到异相邻居的最小步权；非界面 = INF
  const dist = new Uint16Array(N).fill(INF16);
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++) {
        const i = x + y * sx + z * plane;
        const o = occ[i];
        let m = INF16;
        for (let n = 0; n < ND; n++) {
          const nx = x + DX[n], ny = y + DY[n], nz = z + DZ[n];
          if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
          if (occ[nx + ny * sx + nz * plane] !== o) {
            const w = W[n];
            if (w < m) m = w;
          }
        }
        if (m < INF16) dist[i] = m;
      }

  edtSeeded(dist, [sx, sy, sz]);

  const data = new Float32Array(N);
  for (let i = 0; i < N; i++) data[i] = occ[i] ? -dist[i] / 3 : dist[i] / 3;
  if (smooth > 0) for (let it = 0; it < smooth; it++) boxBlur(data, [sx, sy, sz], 1);

  return {
    field: { data, size: [sx, sy, sz], origin: [bx0, by0, bz0], worldSize: [wx, wy, wz] },
    idx
  };
}

export function computeSignedDistance(grid: SparseVoxelGrid, opts: { smooth?: number } = {}): SdfField {
  return buildSignedField(grid, opts).field;
}

export function sampleField(f: SdfField, wx: number, wy: number, wz: number): number {
  const [sx, sy, sz] = f.size;
  const d = f.data;
  const [ox, oy, oz] = f.origin;
  const nx = Math.min(Math.max(wx - 0.5 - ox, 0), sx - 1);
  const ny = Math.min(Math.max(wy - 0.5 - oy, 0), sy - 1);
  const nz = Math.min(Math.max(wz - 0.5 - oz, 0), sz - 1);
  const x0 = Math.floor(nx), y0 = Math.floor(ny), z0 = Math.floor(nz);
  const x1 = Math.min(x0 + 1, sx - 1), y1 = Math.min(y0 + 1, sy - 1), z1 = Math.min(z0 + 1, sz - 1);
  const tx = nx - x0, ty = ny - y0, tz = nz - z0;
  const plane = sx * sy;
  const c000 = d[x0 + y0 * sx + z0 * plane], c100 = d[x1 + y0 * sx + z0 * plane];
  const c010 = d[x0 + y1 * sx + z0 * plane], c110 = d[x1 + y1 * sx + z0 * plane];
  const c001 = d[x0 + y0 * sx + z1 * plane], c101 = d[x1 + y0 * sx + z1 * plane];
  const c011 = d[x0 + y1 * sx + z1 * plane], c111 = d[x1 + y1 * sx + z1 * plane];
  const c00 = c000 * (1 - tx) + c100 * tx, c10 = c010 * (1 - tx) + c110 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx, c11 = c011 * (1 - tx) + c111 * tx;
  const c0 = c00 * (1 - ty) + c10 * ty, c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}
