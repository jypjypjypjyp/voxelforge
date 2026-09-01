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
