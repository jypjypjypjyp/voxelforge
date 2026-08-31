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
  // 连通分量（6-邻域洪泛）
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
  // 对称差异：镜像位 v→size-1-v 无对应体素的体素数（不对称对计 2）
  // 例外（测试钉死）：y 轴地面层 y=0 的体素不要求竖直镜像对应——grounded 构筑底层无需天顶配对
  const sym = { x: 0, y: 0, z: 0 };
  for (const [x, y, z] of all) {
    if (!has(sx - 1 - x, y, z)) sym.x++;
    if (y > 0 && !has(x, sy - 1 - y, z)) sym.y++;
    if (!has(x, y, sz - 1 - z)) sym.z++;
  }
  // 剖面
  const profile = {
    x: new Array(sx).fill(0), y: new Array(sy).fill(0), z: new Array(sz).fill(0)
  };
  for (const [x, y, z] of all) { profile.x[x]++; profile.y[y]++; profile.z[z]++; }
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
