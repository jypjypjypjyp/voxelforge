import { z } from "zod";
import fs from "node:fs/promises";
import { SparseVoxelGrid } from "./core/grid.js";
import { Palette } from "./core/palette.js";
import { loadForge, saveForge } from "./core/project.js";
import {
  placeBox, placeSphere, placeCylinder, placeLine,
  paintRegion, eraseRegion, translateRegion, normRegion,
  type ChangeStats, type PlaceOpts, type CylinderOpts, type LineOpts
} from "./core/ops.js";
import { runScript } from "./core/script.js";
import { sliceAscii } from "./core/slice.js";
import { checkGrid, formatCheck } from "./core/check.js";
import { exportGlb, verifyGlb } from "./core/export/glb.js";
import { buildMesh, hexToRgb01 } from "./core/export/mesh.js";
import { computeSignedDistance } from "./core/sdf.js";
import { surfaceNets, signedVolume, bboxOf } from "./core/surfaceNets.js";
import { sampleVoxelColor } from "./core/color.js";
import { exportVox, verifyVox } from "./core/export/vox.js";
import { encodePng } from "./core/export/png.js";
import { gridSource } from "./core/render/raycast.js";
import { renderProject, type RenderRequest } from "./core/render/render.js";
import type { Axis, Region } from "./core/types.js";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
}

const sizeSchema = { size: z.array(z.number().int().min(1).max(256)).length(3) };
// regionSchema 仅供「必填 region」工具（translate）整体展开；
// 「可选 region」工具（paint/slice_ascii）须把 optional 字段内联写，避免把 optional 扩散给必填语义。
const regionSchema = { region: z.array(z.number().int()).length(6).describe("[x0,y0,z0,x1,y1,z1]") };
const mirrorSchema = { mirror: z.array(z.enum(["x", "y", "z"])).optional() };
const shapeCommon = {
  color: z.string().describe("#RRGGBB"),
  hollow: z.boolean().optional(),
  ...mirrorSchema
};

function fmtBounds(b: Region | null): string {
  return b ? `(${b[0]},${b[1]},${b[2]})-(${b[3]},${b[4]},${b[5]})` : "空";
}

export const TOOLS: ToolDef[] = [
  { name: "create_project", description: "新建体素项目。示例: {size:[64,64,64]}", schema: { ...sizeSchema, force: z.boolean().optional() } },
  { name: "info", description: "项目概览：尺寸/体素数/调色板/包围盒/每色计数", schema: {} },
  { name: "set", description: "单点放体素。示例: {x:1,y:0,z:1,color:'#8B4513'}", schema: { x: z.number().int(), y: z.number().int(), z: z.number().int(), color: z.string() } },
  { name: "unset", description: "单点擦除", schema: { x: z.number().int(), y: z.number().int(), z: z.number().int() } },
  { name: "box", description: "长方体（hollow 只留壳；mirror 一次成型对称）。示例: {x0:0,y0:0,z0:0,x1:7,y1:3,z1:7,color:'#9aa0a6',hollow:true,mirror:['x']}", schema: { x0: z.number().int(), y0: z.number().int(), z0: z.number().int(), x1: z.number().int(), y1: z.number().int(), z1: z.number().int(), ...shapeCommon } },
  { name: "sphere", description: "球体。示例: {cx:8,cy:8,cz:8,r:3,color:'#ff0000'}", schema: { cx: z.number().int(), cy: z.number().int(), cz: z.number().int(), r: z.number(), ...shapeCommon } },
  { name: "cylinder", description: "圆柱：底面圆心+半径+高，axis 默认 y。示例: {cx:4,cy:0,cz:4,r:2,h:6,color:'#7d8288'}", schema: { cx: z.number().int(), cy: z.number().int(), cz: z.number().int(), r: z.number(), h: z.number().int().min(1), axis: z.enum(["x", "y", "z"]).optional(), ...shapeCommon } },
  { name: "line", description: "线段（thickness=笔刷立方边长）。示例: {x0:0,y0:0,z0:0,x1:8,y1:4,z1:0,color:'#8B4513',thickness:2}", schema: { x0: z.number().int(), y0: z.number().int(), z0: z.number().int(), x1: z.number().int(), y1: z.number().int(), z1: z.number().int(), thickness: z.number().int().min(1).optional(), ...mirrorSchema, color: z.string() } },
  { name: "paint", description: "换色：region 省略=全网格，from 省略=区域内全部。示例: {region:[0,0,0,7,7,7],from:'#ff0000',color:'#00ff00'}", schema: { region: z.array(z.number().int()).length(6).optional(), from: z.string().optional(), color: z.string() } },
  { name: "erase", description: "擦除：region 六元组或 'all'", schema: { region: z.union([z.array(z.number().int()).length(6), z.literal("all")]) } },
  { name: "translate", description: "平移区域内体素（目标出界/被占则丢弃）。示例: {region:[0,0,0,3,3,3],dx:4,dy:0,dz:0}", schema: { ...regionSchema, dx: z.number().int(), dy: z.number().int(), dz: z.number().int() } },
  { name: "undo", description: "撤销最近一次变更（栈深 20）", schema: {} },
  { name: "sample", description: "读单点颜色验证", schema: { x: z.number().int(), y: z.number().int(), z: z.number().int() } },
  { name: "slice_ascii", description: "层字符画（最便宜的空间校验）。示例: {axis:'y',index:3}", schema: { axis: z.enum(["x", "y", "z"]), index: z.number().int(), region: z.array(z.number().int()).length(6).optional() } },
  { name: "check", description: "自诊断：悬空/连通分量/对称差/每轴 occupancy 剖面（对称差中 y 轴的 y=0 贴地层豁免竖直镜像对应）", schema: {} },
  { name: "script", description: "vm 沙箱跑 JS 批量生成（同步代码，5s 超时，失败自动回滚）。API: box/sphere/cylinder/line/set/unset/paint/erase/translate/palette(hex)/size/log。示例: {code:'for(let i=0;i<10;i++) box(i*6,0,0,i*6+2,5,2,\"#8B4513\")'}", schema: { code: z.string(), timeoutMs: z.number().int().optional() } },
  { name: "export", description: "导出 GLB 或 .vox（返回结构校验摘要）", schema: { format: z.enum(["glb", "vox"]), path: z.string().optional() } },
  { name: "render_png", description: "渲染 PNG 供视觉自检：view 预设/yaw+pitch、views:'multi' 三视图合一、cutaway 剖切、highlight 区域红框。axes 地面参照层默认单视图开启、multi 关闭（避免与 highlight 红框冲突）。示例: {views:'multi',size:512}", schema: { view: z.enum(["iso", "front", "side", "top"]).optional(), yaw: z.number().optional(), pitch: z.number().optional(), views: z.enum(["single", "multi"]).optional(), size: z.number().int().optional(), proj: z.enum(["ortho", "persp"]).optional(), cutaway: z.enum(["x", "y", "z", "quarter"]).optional(), highlight: z.array(z.number().int()).length(6).optional(), axes: z.boolean().optional(), path: z.string().optional() } },
  { name: "sdf_mesh", description: "体素→有符号距离场→Surface Nets 重建平滑网格并出 GLB。参数: resolution(立方最大轴边长,默认=体素size), color(平涂单色,缺省采样最近体素色), smooth, path。示例: {resolution:32}", schema: { resolution: z.number().int().min(1).max(256).optional(), color: z.string().optional(), smooth: z.number().int().min(0).max(8).optional(), path: z.string().optional() } }
];

export class ForgeSession {
  grid!: SparseVoxelGrid;
  palette!: Palette;
  exists = false;
  private undoStack: Array<{ g: Map<string, number>; p: [string[], Map<string, number>] }> = [];

  constructor(readonly file: string) {}

  async init(): Promise<void> {
    try {
      const loaded = await loadForge(this.file);
      this.grid = loaded.grid;
      this.palette = loaded.palette;
      this.exists = true;
    } catch {
      this.grid = new SparseVoxelGrid([64, 64, 64]);
      this.palette = new Palette();
    }
  }

  listTools(): ToolDef[] {
    return TOOLS;
  }

  private pushUndo(): { g: Map<string, number>; p: [string[], Map<string, number>] } {
    const snap = { g: this.grid.snapshot(), p: this.palette.snapshot() };
    this.undoStack.push(snap);
    if (this.undoStack.length > 20) this.undoStack.shift();
    return snap;
  }

  private stats(name: string, s: ChangeStats): string {
    return `${name}: +${s.added} -${s.removed}, total ${s.total}, bounds ${fmtBounds(s.bounds)}`;
  }

  private defaultOut(ext: string, view?: string): string {
    const base = this.file.replace(/\.voxel\.json$/, "");
    return view ? `${base}.${view}.${ext}` : `${base}.${ext}`;
  }

  // 防幻影查找：只查不分配（indexOf 缺色时会自动占用新的调色板条目）
  private findPaletteIndex(hex: string): number | undefined {
    const h = Palette.normalize(hex);
    for (const [k, v] of Object.entries(this.palette.toRecord())) {
      if (v === h) return Number(k);
    }
    return undefined;
  }

  async handle(name: string, args: Record<string, unknown>): Promise<{ content: string }> {
    const a = args as Record<string, any>;
    switch (name) {
      case "create_project": {
        if (this.exists && !a.force) throw new Error(`文件已存在: ${this.file}（需 force: true 覆盖）`);
        this.grid = new SparseVoxelGrid(a.size);
        this.palette = new Palette();
        this.undoStack = [];
        this.exists = true;
        await saveForge(this.file, this.grid, this.palette);
        return { content: `create_project: ${a.size[0]}x${a.size[1]}x${a.size[2]}，已写入 ${this.file}` };
      }
      case "info": {
        const b = this.grid.bounds();
        const counts = [...this.grid.colorCounts().entries()].map(([idx, n]) => `${idx}→${n}`).join(" ");
        const pal = this.palette.toRecord();
        const palStr = Object.entries(pal).map(([k, v]) => `${k}=${v}`).join(" ") || "（空）";
        return { content: `size: ${this.grid.size.join("x")}\nvoxels: ${this.grid.count}\npalette (${this.palette.size}): ${palStr}\nbounds: ${fmtBounds(b)}\n每色计数: ${counts || "（空）"}` };
      }
      case "set": {
        const snap = this.pushUndo();
        try {
          const idx = this.palette.indexOf(a.color);
          this.grid.set(a.x, a.y, a.z, idx);
        } catch (e) {
          // 失败不占 undo 栈，且回滚 indexOf 可能已分配的调色板条目（否则幻影色号随下次保存落盘）
          this.undoStack.pop();
          this.palette.restore(snap.p);
          throw e;
        }
        await saveForge(this.file, this.grid, this.palette);
        return { content: `set (${a.x},${a.y},${a.z})=${a.color}, total ${this.grid.count}` };
      }
      case "unset": {
        const snap = this.pushUndo();
        let ok: boolean;
        try {
          ok = this.grid.unset(a.x, a.y, a.z);
        } catch (e) {
          this.undoStack.pop();
          this.palette.restore(snap.p);
          throw e;
        }
        await saveForge(this.file, this.grid, this.palette);
        return { content: ok ? `unset (${a.x},${a.y},${a.z}), total ${this.grid.count}` : `(${a.x},${a.y},${a.z}) 本来为空, total ${this.grid.count}` };
      }
      case "box":
      case "sphere":
      case "cylinder":
      case "line": {
        const snap = this.pushUndo();
        let s: ChangeStats;
        try {
          const idx = this.palette.indexOf(a.color);
          const opts: PlaceOpts = { hollow: a.hollow, mirror: a.mirror };
          if (name === "box") s = placeBox(this.grid, a.x0, a.y0, a.z0, a.x1, a.y1, a.z1, idx, opts);
          else if (name === "sphere") s = placeSphere(this.grid, a.cx, a.cy, a.cz, a.r, idx, opts);
          else if (name === "cylinder") s = placeCylinder(this.grid, a.cx, a.cy, a.cz, a.r, a.h, idx, { ...opts, axis: a.axis } as CylinderOpts);
          else s = placeLine(this.grid, a.x0, a.y0, a.z0, a.x1, a.y1, a.z1, idx, { ...opts, thickness: a.thickness } as LineOpts);
        } catch (e) {
          this.undoStack.pop();
          this.palette.restore(snap.p);
          throw e;
        }
        await saveForge(this.file, this.grid, this.palette);
        return { content: this.stats(name, s) };
      }
      case "paint": {
        this.pushUndo();
        // 防幻影：from 必须已在调色板中（indexOf 缺色会自动分配新条目）；to 仅在确有体素要改色时才分配
        let fromIdx: number | undefined;
        if (a.from !== undefined) {
          fromIdx = this.findPaletteIndex(a.from);
          if (fromIdx === undefined) {
            this.undoStack.pop(); // 失败不占 undo 栈
            throw new Error(`颜色 ${a.from} 不在调色板中，无法作为 from 过滤（可用 paint 不带 from 全局换色，或先 set 该颜色）`);
          }
        }
        // 预检：区域内确有将被改色的体素才继续；否则早退（不落盘、不分配 to）
        const r = a.region ? normRegion(a.region as Region) : null;
        let hasTarget = false;
        for (const [x, y, z, idx] of this.grid.coords()) {
          if (r && (x < r[0] || y < r[1] || z < r[2] || x > r[3] || y > r[4] || z > r[5])) continue;
          if (fromIdx === undefined || idx === fromIdx) { hasTarget = true; break; }
        }
        if (!hasTarget) {
          this.undoStack.pop(); // 空操作不占 undo 栈
          return { content: `paint: 0 处换色, total ${this.grid.count}` };
        }
        const toIdx = this.palette.indexOf(a.color);
        const s = paintRegion(this.grid, a.region ?? null, fromIdx, toIdx);
        await saveForge(this.file, this.grid, this.palette);
        // paint 是换色而非增删，摘要不计 +/-，报换色处数
        return { content: `paint: ${s.added} 处换色, total ${s.total}, bounds ${fmtBounds(s.bounds)}` };
      }
      case "erase": {
        const snap = this.pushUndo();
        let s: ChangeStats;
        try {
          s = eraseRegion(this.grid, a.region === "all" ? "all" : a.region as Region);
        } catch (e) {
          this.undoStack.pop();
          this.palette.restore(snap.p);
          throw e;
        }
        await saveForge(this.file, this.grid, this.palette);
        // erase 只减不增，摘要只报擦除数
        return { content: `erase: -${s.removed}, total ${s.total}, bounds ${fmtBounds(s.bounds)}` };
      }
      case "translate": {
        const snap = this.pushUndo();
        let s: ChangeStats;
        try {
          s = translateRegion(this.grid, a.region as Region, a.dx, a.dy, a.dz);
        } catch (e) {
          this.undoStack.pop();
          this.palette.restore(snap.p);
          throw e;
        }
        await saveForge(this.file, this.grid, this.palette);
        return { content: this.stats("translate", s) };
      }
      case "undo": {
        const snap = this.undoStack.pop();
        if (!snap) throw new Error("无可撤销操作");
        this.grid.restore(snap.g);
        this.palette.restore(snap.p);
        await saveForge(this.file, this.grid, this.palette);
        return { content: `undo: 回滚到 ${this.grid.count} 体素, bounds ${fmtBounds(this.grid.bounds())}` };
      }
      case "sample": {
        const idx = this.grid.get(a.x, a.y, a.z);
        return { content: idx === undefined ? `(${a.x},${a.y},${a.z}) = 空` : `(${a.x},${a.y},${a.z}) = ${this.palette.hexOf(idx)} (色号 ${idx})` };
      }
      case "slice_ascii": {
        const text = sliceAscii(this.grid, this.palette, a.axis as Axis, a.index, a.region as Region | undefined);
        return { content: text };
      }
      case "check": {
        return { content: formatCheck(checkGrid(this.grid)) };
      }
      case "script": {
        this.pushUndo();
        let r;
        try {
          r = runScript(this.grid, this.palette, a.code, a.timeoutMs ?? 5000);
        } catch (e) {
          // 仅 runScript 失败（core 已回滚 grid/palette）才弹栈；saveForge 失败时 grid 已有改动，须保留 undo
          this.undoStack.pop();
          throw e;
        }
        await saveForge(this.file, this.grid, this.palette);
        const logs = r.logs.length ? `\nlog: ${r.logs.join(" | ")}` : "";
        return { content: `script: +${r.added} -${r.removed}, total ${r.total}${logs}` };
      }
      case "sdf_mesh": {
        if (this.grid.count === 0) throw new Error("空网格无法从 SDF 重建");
        const gsize = this.grid.size;
        const maxAxis = Math.max(gsize[0], gsize[1], gsize[2]);
        const res = a.resolution ?? maxAxis;
        const field = computeSignedDistance(this.grid, { smooth: a.smooth ?? 0 });
        const colorAt = (x: number, y: number, z: number): [number, number, number] => {
          if (a.color !== undefined) { const c = String(a.color); Palette.normalize(c); return hexToRgb01(c); }
          return sampleVoxelColor(this.grid, (i) => this.palette.hexOf(i) ?? "#888888", x, y, z);
        };
        const mesh = surfaceNets(field, res, colorAt);
        if (mesh.indices.length === 0) throw new Error("SDF 表面未捕捉到任何面（模型可能占满/全空，或分辨率过小）");
        const buf = exportGlb(mesh);
        const out = a.path ?? `${this.file.replace(/\.voxel\.json$/, "")}_sdf_r${res}.glb`;
        await fs.writeFile(out, buf);
        const v = verifyGlb(buf);
        const bb = bboxOf(mesh);
        const vol = signedVolume(mesh);
        return { content: `sdf_mesh: GLB ${out}（${v.tris} tris, ${mesh.positions.length / 3} verts, bbox (${bb.min[0].toFixed(1)},${bb.min[1].toFixed(1)},${bb.min[2].toFixed(1)})-(${bb.max[0].toFixed(1)},${bb.max[1].toFixed(1)},${bb.max[2].toFixed(1)}), 体积 ${vol.toFixed(1)}, 结构闸门通过）` };
      }
      case "export": {
        if (a.format === "glb") {
          const mesh = buildMesh(this.grid.coords(), (i) => this.palette.hexOf(i) ?? "#ff00ff");
          const buf = exportGlb(mesh);
          const out = a.path ?? this.defaultOut("glb");
          await fs.writeFile(out, buf);
          const v = verifyGlb(buf);
          return { content: `GLB 已导出 ${out}（${v.tris} tris, ${v.materials} materials, ${buf.length}B，结构闸门通过）` };
        }
        const buf = exportVox(this.grid.size, [...this.grid.coords()],
          new Map(Object.entries(this.palette.toRecord()).map(([k, v]) => [Number(k), v])));
        const out = a.path ?? this.defaultOut("vox");
        await fs.writeFile(out, buf);
        const v = verifyVox(buf);
        return { content: `VOX 已导出 ${out}（${v.voxels} voxels, ${buf.length}B，结构校验通过）` };
      }
      case "render_png": {
        const src = gridSource(this.grid, (i) => this.palette.hexOf(i) ?? "#ff00ff");
        // Task 10 勘误：renderProject 默认关闭地面参照层（其 X 轴红线会污染「红色=highlight」契约）。
        // 默认语义：单视图 axes: true（坐标参照层默认开启）；views:"multi" 时 axes: false
        //（避免轴红线与 highlight 红框在合成图上语义冲突，与 Task 10 决议一致）；调用方显式传 axes 时以其为准。
        const req: RenderRequest = {
          view: a.view, yaw: a.yaw, pitch: a.pitch, views: a.views,
          size: a.size ?? 512, proj: a.proj, cutaway: a.cutaway,
          highlight: a.highlight as Region | undefined,
          axes: a.axes ?? (a.views === "multi" ? false : true)
        };
        const r = renderProject(src, req);
        const viewName = (req.views === "multi" ? "multi" : (req.view ?? "iso"));
        const out = a.path ?? this.defaultOut("png", String(viewName));
        await fs.writeFile(out, encodePng(r.w, r.h, r.rgba));
        return { content: `PNG 已渲染 ${out}（${r.w}x${r.h}, 视角 ${r.views.join("/")}）` };
      }
      default:
        throw new Error(`未知工具: ${name}`);
    }
  }
}
