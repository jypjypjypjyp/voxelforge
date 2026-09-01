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
