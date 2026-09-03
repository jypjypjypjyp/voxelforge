import type { MeshData } from "./export/mesh.js";
import { sampleField, type SdfField } from "./sdf.js";

// 最小厚度约束：节点值是 8 邻胞 SDF 的三线性平均，节点严格为负才有面。
// 因此模型中必须存在 2×2×2 全实心胞块（某格点 8 邻胞全实）。
// 1×1 线材 / 单层薄片（无 2×2 截面）在任何分辨率与 smooth 下都无负节点——
// 提高 res 无效；模型其他部分有面时薄特征会被静默丢弃（不报错）。
export const SURFACE_EMPTY_MSG =
  "SDF 表面未捕捉到任何面：模型缺少 2×2×2 全实心胞块（1×1 线材/单层薄片在任何分辨率与 smooth 下都无负节点），或模型占满/全空——把特征截面加厚到 ≥2×2；方块导出无此限制（export glb）";

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
  // 世界范围 = 完整体素网格（场可能被 bbox 裁剪，origin 负责定位）
  const ws = field.worldSize ?? field.size;
  const maxA = Math.max(ws[0], ws[1], ws[2]);
  const clampV = (v: number) => Math.min(Math.max(v, 1), 256);
  const ox = clampV(Math.round((res * ws[0]) / maxA));
  const oy = clampV(Math.round((res * ws[1]) / maxA));
  const oz = clampV(Math.round((res * ws[2]) / maxA));
  const nx = ox + 1, ny = oy + 1, nz = oz + 1;
  const csx = ws[0] / ox, csy = ws[1] / oy, csz = ws[2] / oz;

  const NI = (i: number, j: number, k: number) => i + j * nx + k * nx * ny;
  const nodeField = new Float32Array(nx * ny * nz);
  // 活跃 cell（8 角点变号）：nodeField 填充时滚动检查——node(i,j,k) 写完即查 cell(i-1,j-1,k-1)
  const active: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = sampleField(field, i * csx, j * csy, k * csz);
        nodeField[NI(i, j, k)] = v;
        if (i > 0 && j > 0 && k > 0) {
          // cell (i-1,j-1,k-1) 的 8 角点此刻全部就绪
          const a = i - 1, b = j - 1, c = k - 1;
          let hasIn = false, hasOut = false;
          for (let q = 0; q < 8; q++) {
            const cr = CORN[q];
            if (nodeField[NI(a + cr[0], b + cr[1], c + cr[2])] < 0) hasIn = true; else hasOut = true;
            if (hasIn && hasOut) { active.push(a + b * ox + c * ox * oy); break; }
          }
        }
      }

  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const vertexAt = new Int32Array(ox * oy * oz).fill(-1);

  // 法线：nodeField 中心差分（数据已采样在手，免 6 次三线性重采样）
  const gradAt = (i: number, j: number, k: number): [number, number, number] => {
    const i0 = i > 0 ? i - 1 : i, i1 = i < ox ? i + 1 : i;
    const j0 = j > 0 ? j - 1 : j, j1 = j < oy ? j + 1 : j;
    const k0 = k > 0 ? k - 1 : k, k1 = k < oz ? k + 1 : k;
    const gx = nodeField[NI(i1, j, k)] - nodeField[NI(i0, j, k)];
    const gy = nodeField[NI(i, j1, k)] - nodeField[NI(i, j0, k)];
    const gz = nodeField[NI(i, j, k1)] - nodeField[NI(i, j, k0)];
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
    const [gnx, gny, gnz] = gradAt(i, j, k);
    const [r, g, b] = colorAt(wx, wy, wz);
    vertexAt[cIdx] = pos.length / 3;
    pos.push(wx, wy, wz);
    nor.push(gnx, gny, gnz);
    col.push(r, g, b);
  };

  const inside = (v: number) => v < 0;
  const idxArr: number[] = [];
  const pushQuad = (v0: number, v1: number, v2: number, v3: number): void => {
    const p0x = pos[3 * v0], p0y = pos[3 * v0 + 1], p0z = pos[3 * v0 + 2];
    const p1x = pos[3 * v1], p1y = pos[3 * v1 + 1], p1z = pos[3 * v1 + 2];
    const p2x = pos[3 * v2], p2y = pos[3 * v2 + 1], p2z = pos[3 * v2 + 2];
    const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
    const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
    const ng = e1y * e2z - e1z * e2y;
    const ngY = e1z * e2x - e1x * e2z;
    const ngZ = e1x * e2y - e1y * e2x;
    const na0 = nor[3 * v0] + nor[3 * v1] + nor[3 * v2] + nor[3 * v3];
    const na1 = nor[3 * v0 + 1] + nor[3 * v1 + 1] + nor[3 * v2 + 1] + nor[3 * v3 + 1];
    const na2 = nor[3 * v0 + 2] + nor[3 * v1 + 2] + nor[3 * v2 + 2] + nor[3 * v3 + 2];
    const dot = ng * na0 + ngY * na1 + ngZ * na2;
    if (dot < 0) { idxArr.push(v0, v3, v2, v0, v2, v1); }
    else { idxArr.push(v0, v1, v2, v0, v2, v3); }
  };

  // 每条变号边恰好由其"所有者 cell"发射一次（边的最小角所在 cell）：
  //   X 边 (a,b,c)-(a+1,b,c)（b,c≥1）→ owner (a,b-1,c-1)
  //   Y 边 (a,b,c)-(a,b+1,c)（a,c≥1）→ owner (a-1,b,c-1)
  //   Z 边 (a,b,c)-(a,b,c+1)（a,b≥1）→ owner (a-1,b-1,c)
  // 活跃 cell 必含其 owner 边的两端角点 → 变号边的 owner 必活跃，遍历活跃集即可无遗漏无重复。
  for (const cIdx of active) {
    const i = cIdx % ox, j = Math.floor(cIdx / ox) % oy, k = Math.floor(cIdx / (ox * oy));
    // X 边 (i, j+1, k+1)：cells (i,j,k)(i,j+1,k)(i,j+1,k+1)(i,j,k+1)
    if (j + 1 <= oy - 1 && k + 1 <= oz - 1) {
      const fa = nodeField[NI(i, j + 1, k + 1)], fb = nodeField[NI(i + 1, j + 1, k + 1)];
      if (inside(fa) !== inside(fb)) {
        cellVertices(i, j, k); cellVertices(i, j + 1, k); cellVertices(i, j + 1, k + 1); cellVertices(i, j, k + 1);
        const q = [vertexAt[cIdx], vertexAt[i + (j + 1) * ox + k * ox * oy],
          vertexAt[i + (j + 1) * ox + (k + 1) * ox * oy], vertexAt[i + j * ox + (k + 1) * ox * oy]];
        if (!q.some((x) => x < 0)) pushQuad(q[0], q[1], q[2], q[3]);
      }
    }
    // Y 边 (i+1, j, k+1)：cells (i,j,k)(i,j,k+1)(i+1,j,k+1)(i+1,j,k)
    if (i + 1 <= ox - 1 && k + 1 <= oz - 1) {
      const fa = nodeField[NI(i + 1, j, k + 1)], fb = nodeField[NI(i + 1, j + 1, k + 1)];
      if (inside(fa) !== inside(fb)) {
        cellVertices(i, j, k); cellVertices(i, j, k + 1); cellVertices(i + 1, j, k + 1); cellVertices(i + 1, j, k);
        const q = [vertexAt[cIdx], vertexAt[i + j * ox + (k + 1) * ox * oy],
          vertexAt[(i + 1) + j * ox + (k + 1) * ox * oy], vertexAt[(i + 1) + j * ox + k * ox * oy]];
        if (!q.some((x) => x < 0)) pushQuad(q[0], q[1], q[2], q[3]);
      }
    }
    // Z 边 (i+1, j+1, k)
    if (i + 1 <= ox - 1 && j + 1 <= oy - 1) {
      const fa = nodeField[NI(i + 1, j + 1, k)], fb = nodeField[NI(i + 1, j + 1, k + 1)];
      if (inside(fa) !== inside(fb)) {
        cellVertices(i, j, k); cellVertices(i + 1, j, k); cellVertices(i + 1, j + 1, k); cellVertices(i, j + 1, k);
        const q = [vertexAt[cIdx], vertexAt[(i + 1) + j * ox + k * ox * oy],
          vertexAt[(i + 1) + (j + 1) * ox + k * ox * oy], vertexAt[i + (j + 1) * ox + k * ox * oy]];
        if (!q.some((x) => x < 0)) pushQuad(q[0], q[1], q[2], q[3]);
      }
    }
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
