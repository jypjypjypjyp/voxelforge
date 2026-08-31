import type { MeshData } from "./mesh.js";

export function exportGlb(mesh: MeshData): Buffer {
  if (mesh.positions.length === 0) throw new Error("空网格无法导出 GLB（无顶点）");
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
  const accessors = json.accessors as Array<{ count: number; min?: unknown[]; max?: unknown[] }>;
  let tris = 0;
  for (const prim of mesh?.primitives ?? []) {
    tris += accessors[prim.indices].count / 3;
  }
  const materials = (json.materials as unknown[])?.length ?? 0;
  const prims = mesh?.primitives ?? [];
  for (const prim of prims) {
    const posAcc = accessors[prim.attributes?.POSITION];
    if (!posAcc || !Array.isArray(posAcc.min) || !posAcc.min.every((n: unknown) => typeof n === "number") ||
        !Array.isArray(posAcc.max) || !posAcc.max.every((n: unknown) => typeof n === "number")) {
      throw new Error("POSITION accessor 缺少有效 min/max");
    }
  }
  return { tris, materials, json };
}
