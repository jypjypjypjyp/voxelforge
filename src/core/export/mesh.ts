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
