#!/usr/bin/env node
import { parseArgs } from "node:util";
import fs from "node:fs";
import { z } from "zod";
import { ForgeSession, TOOLS } from "./tools.js";
import { emptyProject } from "./core/project.js";
import { buildMesh } from "./core/export/mesh.js";
import { exportGlb, verifyGlb } from "./core/export/glb.js";
import { exportVox, verifyVox } from "./core/export/vox.js";
import { encodePng } from "./core/export/png.js";
import { gridSource } from "./core/render/raycast.js";
import { renderProject } from "./core/render/render.js";

function usage(): string {
  return `voxelforge — LLM-native 体素建模
用法:
  voxelforge new <file> [--size 64] [--force]
  voxelforge serve <file> [--port 4173]
  voxelforge export <file> --glb out.glb | --vox out.vox
  voxelforge render <file> [--view iso|front|side|top] [--multi] [--cutaway x|y|z|quarter]
                    [--yaw 45 --pitch 30] [--out shot.png] [--size 512] [--proj ortho|persp] [--axes=false]
  voxelforge remesh <file> [--res 64] [--smooth 1] [--color #hex] [--texture] --out out.glb   # 体素→SDF→平滑网格 GLB（--texture 带调色板贴图+UV）
  voxelforge tools                            # 列出全部 19 个建模工具
  voxelforge tool <file> <name> [jsonArgs]    # 直调任一工具，参数为 JSON 对象
                                              # 例: voxelforge tool m.voxel.json box '{"x0":0,"y0":0,"z0":0,"x1":7,"y1":3,"z1":7,"color":"#9aa0a6","hollow":true}'
`;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      size: { type: "string" },
      force: { type: "boolean", default: false },
      port: { type: "string", default: "4173" },
      glb: { type: "string" },
      vox: { type: "string" },
      view: { type: "string" },
      multi: { type: "boolean", default: false },
      cutaway: { type: "string" },
      yaw: { type: "string" },
      pitch: { type: "string" },
      out: { type: "string" },
      proj: { type: "string" },
      axes: { type: "string", default: "true" },
      res: { type: "string" },
      smooth: { type: "string" },
      color: { type: "string" },
      texture: { type: "boolean", default: false }
    }
  });
  const cmd = positionals[0];
  const file = positionals[1];

  if (!cmd || cmd === "help" || cmd === "--help") { console.log(usage()); return 0; }

  if (cmd === "tools") {
    for (const t of TOOLS) console.log(`${t.name.padEnd(15)} ${t.description.split("。")[0]}`);
    return 0;
  }

  if (cmd === "tool") {
    // tool <file> <name> [jsonArgs] —— 直调任一 ForgeSession 工具（zod 校验）
    const [, name, jsonArg] = positionals.slice(1);
    if (!file || !name) throw new Error("用法: voxelforge tool <file> <name> [jsonArgs]（tools 查看列表）");
    const def = TOOLS.find((t) => t.name === name);
    if (!def) throw new Error(`未知工具: ${name}（voxelforge tools 查看列表）`);
    let args: Record<string, unknown> = {};
    if (jsonArg !== undefined) {
      try {
        args = JSON.parse(jsonArg);
      } catch (e) {
        throw new Error(`参数 JSON 解析失败: ${(e as Error).message}`);
      }
      if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("参数须为 JSON 对象");
    }
    const parsed = z.object(def.schema).safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数校验失败: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    }
    const session = new ForgeSession(file);
    await session.init();
    const { content } = await session.handle(name, parsed.data as Record<string, unknown>);
    console.log(content);
    return 0;
  }

  if (cmd === "new") {
    if (!file) throw new Error("缺 <file>");
    const size = Number(values.size ?? "64");
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`size 需为 1..256 整数: ${values.size}`);
    if (fs.existsSync(file) && !values.force) throw new Error(`已存在: ${file}（--force 覆盖）`);
    const p = emptyProject([size, size, size]);
    fs.writeFileSync(file, JSON.stringify(p));
    console.log(`created ${file} (${size}³)`);
    return 0;
  }

  if (cmd === "remesh") {
    if (!file) throw new Error("缺 <file>");
    const session = new ForgeSession(file);
    await session.init();
    const args: Record<string, unknown> = {};
    if (values.res !== undefined) args.resolution = Number(values.res);
    if (values.smooth !== undefined) args.smooth = Number(values.smooth);
    if (typeof values.color === "string") args.color = values.color;
    if (values.texture) args.texture = true;
    if (typeof values.out === "string") args.path = values.out;
    const def = TOOLS.find((t) => t.name === "sdf_mesh")!;
    const parsed = z.object(def.schema).safeParse(args);
    if (!parsed.success) {
      throw new Error(`参数校验失败: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    }
    const { content } = await session.handle("sdf_mesh", parsed.data as Record<string, unknown>);
    console.log(content);
    return 0;
  }

  if (cmd === "serve") {
    if (!file) throw new Error("缺 <file>");
    const { startViewer } = await import("./viewer/serve.js");
    const v = await startViewer(file, Number(values.port));
    const close = () => v.close().then(() => process.exit(0));
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
    return 0; // 常驻：事件循环由 http server 保持
  }

  if (cmd === "export") {
    if (!file) throw new Error("缺 <file>");
    const session = new ForgeSession(file);
    await session.init();
    const glb = typeof values.glb === "string" ? values.glb : undefined;
    if (glb) {
      const mesh = buildMesh(session.grid.coords(), (i) => session.palette.hexOf(i) ?? "#ff00ff");
      const buf = exportGlb(mesh);
      fs.writeFileSync(glb, buf);
      const v = verifyGlb(buf);
      console.log(`GLB ${glb}: ${v.tris} tris, ${buf.length}B（闸门通过）`);
      return 0;
    }
    const vox = typeof values.vox === "string" ? values.vox : undefined;
    if (vox) {
      const buf = exportVox(session.grid.size, [...session.grid.coords()],
        new Map(Object.entries(session.palette.toRecord()).map(([k, hex]) => [Number(k), hex])));
      fs.writeFileSync(vox, buf);
      const v = verifyVox(buf);
      console.log(`VOX ${vox}: ${v.voxels} voxels, ${buf.length}B`);
      return 0;
    }
    throw new Error("需 --glb <out> 或 --vox <out>");
  }

  if (cmd === "render") {
    if (!file) throw new Error("缺 <file>");
    const session = new ForgeSession(file);
    await session.init();
    const src = gridSource(session.grid, (i) => session.palette.hexOf(i) ?? "#ff00ff");
    const r = renderProject(src, {
      view: values.view as never,
      views: values.multi ? "multi" : "single",
      cutaway: values.cutaway as never,
      yaw: values.yaw !== undefined ? Number(values.yaw) : undefined,
      pitch: values.pitch !== undefined ? Number(values.pitch) : undefined,
      proj: values.proj as never,
      axes: String(values.axes) !== "false",
      size: values.size !== undefined ? Number(values.size) : 512
    });
    const out = (typeof values.out === "string" ? values.out : undefined) ?? "shot.png";
    fs.writeFileSync(out, encodePng(r.w, r.h, r.rgba));
    console.log(`PNG ${out}: ${r.w}x${r.h}（${r.views.join("/")}）`);
    return 0;
  }

  throw new Error(`未知子命令: ${cmd}\n${usage()}`);
}

main().then((code) => { if (code !== 0) process.exitCode = code; }).catch((e) => {
  console.error("voxelforge:", e instanceof Error ? e.message : e);
  process.exit(1);
});
