export class Palette {
  private idxToHex: string[] = []; // 下标 i 对应调色板号 i+1（可能有稀疏空洞）
  private hexToIdx = new Map<string, number>();

  constructor(existing?: Record<string, string>) {
    if (!existing) return;
    for (const [k, v] of Object.entries(existing)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 1 || idx > 255) {
        throw new Error(`调色板号必须为 1..255: ${k}`);
      }
      const hex = Palette.normalize(v);
      this.idxToHex[idx - 1] = hex;
      this.hexToIdx.set(hex, idx);
    }
  }

  static normalize(hex: string): string {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
    if (!m) throw new Error(`颜色格式无效: "${hex}"，需要 #RRGGBB`);
    return `#${m[1].toLowerCase()}`;
  }

  indexOf(hex: string): number {
    const h = Palette.normalize(hex);
    const found = this.hexToIdx.get(h);
    if (found !== undefined) return found;
    if (this.idxToHex.length >= 255) throw new Error("调色板已满（255 色），请复用已有颜色或用 paint 换色");
    const idx = this.idxToHex.length + 1;
    this.idxToHex.push(h);
    this.hexToIdx.set(h, idx);
    return idx;
  }

  hexOf(idx: number): string | undefined {
    return this.idxToHex[idx - 1];
  }

  toRecord(): Record<string, string> {
    const o: Record<string, string> = {};
    this.idxToHex.forEach((h, i) => { o[i + 1] = h; });
    return o;
  }

  get size(): number {
    return this.idxToHex.length;
  }

  snapshot(): [string[], Map<string, number>] {
    return [[...this.idxToHex], new Map(this.hexToIdx)];
  }

  restore(snap: [string[], Map<string, number>]): void {
    this.idxToHex = [...snap[0]];
    this.hexToIdx = new Map(snap[1]);
  }
}

export function hexToRgb255(hex: string): [number, number, number] {
  const h = Palette.normalize(hex);
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ];
}
