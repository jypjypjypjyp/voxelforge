import type { SparseVoxelGrid } from "./grid.js";
import type { Palette } from "./palette.js";
import type { Axis, Region } from "./types.js";

function charFor(idx: number): string {
  if (idx >= 1 && idx <= 26) return String.fromCharCode(64 + idx);      // A-Z
  if (idx >= 27 && idx <= 52) return String.fromCharCode(70 + idx);     // a-z (96 + idx - 26)
  return "#";
}

export function sliceAscii(
  grid: SparseVoxelGrid, palette: Palette, axis: Axis, index: number, region?: Region
): string {
  const [sx, sy, sz] = grid.size;
  const r: Region = region
    ? [Math.max(0, Math.min(region[0], region[3])), Math.max(0, Math.min(region[1], region[4])), Math.max(0, Math.min(region[2], region[5])),
       Math.min(sx - 1, Math.max(region[0], region[3])), Math.min(sy - 1, Math.max(region[1], region[4])), Math.min(sz - 1, Math.max(region[2], region[5]))]
    : [0, 0, 0, sx - 1, sy - 1, sz - 1];
  // (rowAxis, colAxis) 映射；第三轴 = axis
  const map = { x: ["z", "y"], y: ["z", "x"], z: ["y", "x"] } as const;
  const [rowAxis, colAxis] = map[axis];
  const axisIdx = { x: 0, y: 1, z: 2 } as const;
  const at = (a: Axis, side: 0 | 1): number => r[axisIdx[a] + side * 3];
  const rLo = at(rowAxis as Axis, 0), rHi = at(rowAxis as Axis, 1);
  const cLo = at(colAxis as Axis, 0), cHi = at(colAxis as Axis, 1);
  const axisVal = index;

  const lines: string[] = [];
  lines.push(`${axis}=${index} 层（列 ${colAxis}→，行 ${rowAxis}↓）`);
  // 标尺：十位行 + 个位行（前缀 4 空格，与行前缀等宽对齐）
  let tens = " ".repeat(4), units = " ".repeat(4);
  for (let c = cLo; c <= cHi; c++) {
    tens += c % 10 === 0 ? String(Math.floor(c / 10) % 10) : " ";
    units += String(c % 10);
  }
  lines.push(tens, units);
  const used = new Map<number, string>();
  for (let row = rLo; row <= rHi; row++) {
    // 行前缀固定 4 字符（轴名 + 左对齐行号），与标尺 4 空格前缀对齐；测试钉死 "z0" 开头
    let line = `${rowAxis}${String(row).padEnd(3)}`;
    for (let col = cLo; col <= cHi; col++) {
      const coords: [number, number, number] =
        axis === "y" ? [col, axisVal, row]
        : axis === "x" ? [axisVal, col, row]   // x: 行 z, 列 y → (axis, col, row)
        : [col, row, axisVal];                 // z: 行 y, 列 x → (col, row, axis)
      const idx = grid.get(coords[0], coords[1], coords[2]);
      if (idx === undefined) { line += "."; continue; }
      const ch = charFor(idx);
      used.set(idx, ch);
      line += ch;
    }
    lines.push(line);
  }
  const legend = [...used.entries()].map(([idx, ch]) => `${ch}=${palette.hexOf(idx) ?? "?"}`).join(" ");
  if (legend) lines.push(`图例: ${legend}`);
  return lines.join("\n");
}
