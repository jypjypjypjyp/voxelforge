import type { Region, VoxelProject } from "./types.js";

export class SparseVoxelGrid {
  readonly size: [number, number, number];
  private vox = new Map<string, number>();

  constructor(size: [number, number, number]) {
    if (size.length !== 3 || size.some(n => !Number.isInteger(n) || n < 1 || n > 256)) {
      throw new Error(`size 无效: ${JSON.stringify(size)}（每轴需 1..256 的整数）`);
    }
    this.size = [...size] as [number, number, number];
  }

  static fromProject(p: VoxelProject): SparseVoxelGrid {
    const g = new SparseVoxelGrid(p.size);
    for (const [k, idx] of Object.entries(p.voxels)) g.vox.set(k, idx);
    return g;
  }

  key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size[0] && y < this.size[1] && z < this.size[2];
  }

  get(x: number, y: number, z: number): number | undefined {
    return this.vox.get(this.key(x, y, z));
  }

  set(x: number, y: number, z: number, idx: number): boolean {
    if (!this.inBounds(x, y, z)) {
      throw new Error(`坐标越界 (${x},${y},${z})，合法范围 x:0..${this.size[0] - 1} y:0..${this.size[1] - 1} z:0..${this.size[2] - 1}`);
    }
    const k = this.key(x, y, z);
    if (this.vox.get(k) === idx) return false;
    this.vox.set(k, idx);
    return true;
  }

  unset(x: number, y: number, z: number): boolean {
    return this.vox.delete(this.key(x, y, z));
  }

  clear(): void {
    this.vox.clear();
  }

  get count(): number {
    return this.vox.size;
  }

  entries(): IterableIterator<[string, number]> {
    return this.vox.entries();
  }

  *coords(): Generator<[number, number, number, number]> {
    for (const [k, idx] of this.vox) {
      const [x, y, z] = k.split(",").map(Number);
      yield [x, y, z, idx];
    }
  }

  bounds(): Region | null {
    let b: Region | null = null;
    for (const [x, y, z] of this.coords()) {
      if (b === null) { b = [x, y, z, x, y, z]; continue; }
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
      if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
    }
    return b;
  }

  colorCounts(): Map<number, number> {
    const m = new Map<number, number>();
    for (const [, idx] of this.vox) m.set(idx, (m.get(idx) ?? 0) + 1);
    return m;
  }

  snapshot(): Map<string, number> {
    return new Map(this.vox);
  }

  restore(s: Map<string, number>): void {
    this.vox = new Map(s);
  }
}
