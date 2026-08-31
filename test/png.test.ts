import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { encodePng, crc32 } from "../src/core/export/png.js";

describe("encodePng", () => {
  it("签名/IHDR/IDAT 解压长度正确", () => {
    const w = 4, h = 3;
    const rgba = new Uint8Array(w * h * 4).fill(128);
    const buf = encodePng(w, h, rgba);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(w);
    expect(buf.readUInt32BE(20)).toBe(h);
    // 找 IDAT 并解压
    let off = 8, idat: Buffer | null = null;
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString("ascii");
      if (type === "IDAT") { idat = buf.subarray(off + 8, off + 8 + len); break; }
      off += 12 + len;
    }
    expect(idat).not.toBeNull();
    const raw = zlib.inflateSync(idat!);
    expect(raw.length).toBe(h * (1 + w * 4)); // 每行 filter byte 0 + w*4
    expect(buf.subarray(buf.length - 8, buf.length - 4).toString("ascii")).toBe("IEND");
  });

  it("crc32 已知值", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
