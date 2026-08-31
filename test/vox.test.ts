import { describe, it, expect } from "vitest";
import { SparseVoxelGrid } from "../src/core/grid.js";
import { exportVox, verifyVox } from "../src/core/export/vox.js";

describe("exportVox / verifyVox", () => {
  it("结构可回读且颜色正确", () => {
    const g = new SparseVoxelGrid([8, 8, 8]);
    g.set(1, 2, 3, 1); g.set(4, 5, 6, 2);
    // 勘误：签名用 Map<number,string>，直接构造
    const palMap = new Map<number, string>([[1, "#8b4513"], [2, "#daa520"]]);
    const buf = exportVox(g.size, [...g.coords()], palMap);
    const v = verifyVox(buf);
    expect(v.size).toEqual([8, 8, 8]);
    expect(v.voxels).toBe(2);
    // RGBA chunk：色号 1 → offset 0 → r=0x8b
    // （verifyVox 返回 palette 数组便于断言；palette 为 255 项 [r,g,b,a]，
    //   0 基镜像 RGBA 内容：palette[i] = 色号 i+1）
    expect(v.palette![0]).toEqual([0x8b, 0x45, 0x13, 255]);
    expect(v.palette![1]).toEqual([0xda, 0xa5, 0x20, 255]);
  });

  it("verifyVox 拒绝坏数据", () => {
    expect(() => verifyVox(Buffer.from("junk"))).toThrow();
  });
});
