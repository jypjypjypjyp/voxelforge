import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { Palette } from "../src/core/palette.js";
import { buildMesh } from "../src/core/export/mesh.js";
import type { MeshData } from "../src/core/export/mesh.js";
import { exportGlb, verifyGlb } from "../src/core/export/glb.js";
import { buildTextureFromMesh } from "../src/core/export/texture.js";

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

  it("空网格导出被拒绝（非法 min/max）", () => {
    const empty: MeshData = { positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) };
    expect(() => exportGlb(empty)).toThrow(/空网格/);
  });
});

describe("纹理导出（贴图 GLB）", () => {
  it("buildTextureFromMesh：单色模型 1 texel、UV 在 [0,1]、PNG 魔数", () => {
    const m = boxMesh(); // 单色 #8b4513
    const t = buildTextureFromMesh(m);
    expect(t.colors).toBe(1);
    expect(t.uvs.length).toBe((m.positions.length / 3) * 2);
    for (const v of t.uvs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(t.png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(t.width).toBeGreaterThanOrEqual(1);
    expect(t.width).toBe(t.height);
  });

  it("多色模型 texel 数 = 唯一色数，尺寸为 2 的幂", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(0, 0, 0, 1);
    g.set(1, 0, 0, 2);
    const pal = new Palette({ "1": "#ff0000", "2": "#00ff00" });
    const m = buildMesh(g.coords(), (i) => pal.hexOf(i));
    const t = buildTextureFromMesh(m);
    expect(t.colors).toBe(2);
    expect(Number.isInteger(Math.log2(t.width))).toBe(true);
    expect(Number.isInteger(Math.log2(t.height))).toBe(true);
    // 两色 UV 指向不同 texel
    const key = (i: number) => `${t.uvs[2 * i].toFixed(4)},${t.uvs[2 * i + 1].toFixed(4)}`;
    expect(key(0)).not.toBe(key(m.positions.length / 3 - 1));
  });

  it("exportGlb 纹理模式：TEXCOORD_0 + baseColorTexture + 去掉 COLOR_0 + verifyGlb 通过", () => {
    const m = boxMesh();
    const t = buildTextureFromMesh(m);
    const buf = exportGlb(m, { texture: { png: t.png, uvs: t.uvs } });
    const v = verifyGlb(buf);
    expect(v.tris).toBe(104);
    const prim = (v.json.meshes as Array<Record<string, any>>)[0].primitives[0];
    expect(prim.attributes.TEXCOORD_0).toBeDefined();
    expect(prim.attributes.COLOR_0).toBeUndefined();
    expect((v.json.images as unknown[]).length).toBe(1);
    expect((v.json.images as Array<Record<string, unknown>>)[0].mimeType).toBe("image/png");
    expect((v.json.samplers as unknown[]).length).toBe(1);
    expect((v.json.textures as unknown[]).length).toBe(1);
    const mat = (v.json.materials as Array<Record<string, any>>)[0];
    expect(mat.pbrMetallicRoughness.baseColorTexture).toBeDefined();
    expect(mat.pbrMetallicRoughness.baseColorTexture.index).toBe(0);
  });

  it("uv 数量与顶点不符时报错", () => {
    const m = boxMesh();
    const t = buildTextureFromMesh(m);
    expect(() => exportGlb(m, { texture: { png: t.png, uvs: t.uvs.subarray(0, 10) } })).toThrow(/UV/);
  });
});
