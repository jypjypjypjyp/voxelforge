import { hexToRgb255 } from "../palette.js";

function chunk(id: string, content: Buffer): Buffer {
  const head = Buffer.alloc(12);
  head.write(id, 0, "ascii");
  head.writeInt32LE(content.length, 4);
  head.writeInt32LE(0, 8); // children 长度：SIZE/XYZI/RGBA 均无子 chunk
  return Buffer.concat([head, content]);
}

function u8(v: number, name: string): number {
  if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`${name} 越界: ${v}（.vox 需 0..255 整数）`);
  return v;
}

export function exportVox(
  size: [number, number, number],
  voxels: Array<[number, number, number, number]>,
  paletteHex: Map<number, string>
): Buffer {
  const sizeChunk = Buffer.alloc(12);
  sizeChunk.writeInt32LE(size[0], 0);
  sizeChunk.writeInt32LE(size[1], 4);
  sizeChunk.writeInt32LE(size[2], 8);

  const xyzi = Buffer.alloc(4 + 4 * voxels.length);
  xyzi.writeInt32LE(voxels.length, 0);
  voxels.forEach(([x, y, z, idx], i) => {
    const o = 4 + i * 4;
    xyzi.writeUInt8(u8(x, "x"), o);
    xyzi.writeUInt8(u8(y, "y"), o + 1);
    xyzi.writeUInt8(u8(z, "z"), o + 2);
    xyzi.writeUInt8(u8(idx, "色号"), o + 3);
  });

  const rgba = Buffer.alloc(1024, 255);
  for (const [idx, hex] of paletteHex) {
    if (idx < 1 || idx > 255) continue;
    const [r, g, b] = hexToRgb255(hex);
    const o = (idx - 1) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  }

  const children = Buffer.concat([
    chunk("SIZE", sizeChunk),
    chunk("XYZI", xyzi),
    chunk("RGBA", rgba)
  ]);
  // MAIN chunk 头：id(4) + contentLen(4)=0 + childrenLen(4) = 12 字节
  const main = Buffer.alloc(12);
  main.write("MAIN", 0, "ascii");
  main.writeInt32LE(0, 4);
  main.writeInt32LE(children.length, 8);
  const header = Buffer.alloc(8);
  header.write("VOX ", 0, "ascii");
  header.writeUInt32LE(150, 4);
  return Buffer.concat([header, main, children]);
}

export function verifyVox(buf: Buffer): {
  voxels: number;
  size: [number, number, number];
  palette?: Array<[number, number, number, number]>;
} {
  if (buf.length < 20 || buf.subarray(0, 4).toString("ascii") !== "VOX ") throw new Error("VOX 魔数错误");
  if (buf.readUInt32LE(4) !== 150) throw new Error("VOX version 应为 150");
  if (buf.subarray(8, 12).toString("ascii") !== "MAIN") throw new Error("缺少 MAIN chunk");
  let off = 20; // MAIN 头 8B（content 0 + children 长度字段在 12..20）
  // MAIN chunk: id(4) contentLen(4)=0 childrenLen(4) → children 从 20 开始
  let voxels = 0;
  let size: [number, number, number] = [0, 0, 0];
  let palette: Array<[number, number, number, number]> | undefined;
  while (off + 12 <= buf.length) {
    const id = buf.subarray(off, off + 4).toString("ascii");
    const contentLen = buf.readInt32LE(off + 4);
    const childrenLen = buf.readInt32LE(off + 8);
    if (contentLen < 0 || childrenLen < 0) throw new Error(`chunk 长度非法: content=${contentLen} children=${childrenLen}`);
    if (off + 12 + contentLen > buf.length) throw new Error(`chunk 内容越界: ${id}`);
    const content = buf.subarray(off + 12, off + 12 + contentLen);
    if (id === "SIZE") {
      size = [content.readInt32LE(0), content.readInt32LE(4), content.readInt32LE(8)];
    } else if (id === "XYZI") {
      voxels = content.readInt32LE(0);
      if (content.length !== 4 + 4 * voxels) throw new Error(`XYZI 长度不一致: ${content.length} vs 4+4*${voxels}`);
    } else if (id === "RGBA") {
      if (content.length < 255 * 4) throw new Error(`RGBA chunk 截断: ${content.length}B`);
      palette = [];
      for (let i = 0; i < 255; i++) {
        palette.push([content[i * 4], content[i * 4 + 1], content[i * 4 + 2], content[i * 4 + 3]]);
      }
    }
    off += 12 + contentLen + childrenLen;
  }
  return { voxels, size, palette };
}
