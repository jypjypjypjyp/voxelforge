import { describe, it, expect } from "vitest";
import type { VoxelProject } from "../src/core/types.js";

describe("scaffold", () => {
  it("types 可导入且形状正确", () => {
    const p: VoxelProject = {
      format: "voxelforge/1",
      size: [8, 8, 8],
      palette: { "1": "#ff0000" },
      voxels: { "0,0,0": 1 }
    };
    expect(p.format).toBe("voxelforge/1");
    expect(p.size).toEqual([8, 8, 8]);
  });
});
