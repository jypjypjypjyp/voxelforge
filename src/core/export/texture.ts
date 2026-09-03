import type { MeshData } from "./mesh.js";
import { encodePng } from "./png.js";

export interface MeshTexture {
  png: Buffer;
  /** 每顶点 2 分量 UV，指向所属颜色 texel 中心（glTF 顶点序） */
  uvs: Float32Array;
  colors: number;
  width: number;
  height: number;
}

// 量化到 1e-5 抵消浮点尾差，归并同色顶点
const quant = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * 顶点色 → 调色板图集贴图（每唯一色一 texel，POT 尺寸，近邻采样零渗色）。
 * 颜色以 8bit 精度写回（hexToRgb01 本就来自 /255，round 恢复原字节，零损失）。
 */
export function buildTextureFromMesh(mesh: MeshData): MeshTexture {
  const n = mesh.positions.length / 3;
  if (n === 0) throw new Error("空网格无法生成纹理");
  const keyAt = (i: number) =>
    `${quant(mesh.colors[3 * i])},${quant(mesh.colors[3 * i + 1])},${quant(mesh.colors[3 * i + 2])}`;
  const slot = new Map<string, number>();
  const order: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const k = keyAt(i);
    if (!slot.has(k)) {
      slot.set(k, order.length);
      order.push([mesh.colors[3 * i], mesh.colors[3 * i + 1], mesh.colors[3 * i + 2]]);
    }
  }
  const K = order.length;
  const side = Math.max(1, 2 ** Math.ceil(Math.log2(Math.ceil(Math.sqrt(K)))));
  if (K > side * side) throw new Error(`纹理 texel 数溢出: ${K} > ${side}²`);
  const rgba = new Uint8Array(side * side * 4);
  for (let c = 0; c < K; c++) {
    const [r, g, b] = order[c];
    const o = (Math.floor(c / side) * side + (c % side)) * 4;
    rgba[o] = Math.round(r * 255);
    rgba[o + 1] = Math.round(g * 255);
    rgba[o + 2] = Math.round(b * 255);
    rgba[o + 3] = 255;
  }
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const c = slot.get(keyAt(i))!;
    uvs[2 * i] = ((c % side) + 0.5) / side;
    uvs[2 * i + 1] = (Math.floor(c / side) + 0.5) / side;
  }
  return { png: encodePng(side, side, rgba), uvs, colors: K, width: side, height: side };
}
