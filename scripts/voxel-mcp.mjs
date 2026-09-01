#!/usr/bin/env node
// voxel-mcp — 一键开/关 DSH 里的 voxelforge MCP（web + headless 两个 profile）
//
// 用法:
//   node voxel-mcp.mjs status   查看两个 profile 的当前状态
//   node voxel-mcp.mjs off      关闭（写入行级 disabled: true，loader 热应用）
//   node voxel-mcp.mjs on       开启（移除 disabled 行）
//
// 原理: cordis patch 的行级 disabled 字段使 mcp-voxelforge 条目整体停用，
// dsh-mcp-client 支持配置热应用（断开+重连，无需重启 dsh web）。
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ID = "mcp-voxelforge";
const FILES = [
  join(homedir(), ".dsh/profiles/web/cordis.patch.yml"),
  join(homedir(), ".dsh/profiles/headless/cordis.patch.yml"),
];

function applyMode(text, mode) {
  const lines = text.split("\n");
  const idLine = `    - id: ${ID}`;
  const idIdx = lines.indexOf(idLine);
  if (idIdx === -1) return { found: false, hasDisabled: false, changed: false, text };
  // entry 范围: id 行之后到下一个同层列表项（4 空格 "- "）为止
  let end = idIdx + 1;
  while (end < lines.length && !lines[end].startsWith("    - ")) end++;
  const body = lines.slice(idIdx + 1, end);
  const hasDisabled = body.some((l) => l.trim() === "disabled: true");
  let changed = false;
  if (mode === "off" && !hasDisabled) {
    lines.splice(idIdx + 1, 0, "      disabled: true");
    changed = true;
  } else if (mode === "on" && hasDisabled) {
    const di = lines.findIndex((l, i) => i > idIdx && i < end + 1 && l.trim() === "disabled: true");
    if (di !== -1) { lines.splice(di, 1); changed = true; }
  }
  return { found: true, hasDisabled, changed, text: lines.join("\n") };
}

const mode = process.argv[2];
if (!["on", "off", "status"].includes(mode)) {
  console.log("用法: node voxel-mcp.mjs on|off|status");
  process.exit(1);
}
for (const f of FILES) {
  const label = f.includes("/web/") ? "web     " : "headless";
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    console.log(`${label}: ${f} 不存在，跳过`);
    continue;
  }
  const r = applyMode(text, mode);
  if (!r.found) {
    console.log(`${label}: 未找到 ${ID} 条目`);
    continue;
  }
  if (mode !== "status" && r.changed) writeFileSync(f, r.text);
  if (mode === "status") {
    console.log(`${label}: ${r.hasDisabled ? "OFF (disabled)" : "ON"}`);
  } else {
    console.log(`${label}: ${r.changed ? `已${mode === "off" ? "关闭" : "开启"}` : `本来就是${mode === "off" ? "关" : "开"}的`}`);
  }
}
if (mode !== "status") {
  console.log("生效: 运行中的 dsh web 由 mcp-client HMR 热应用（新会话即刻生效）；若旧会话仍见工具，重启 dsh web。headless 每次启动重新读取，天然生效。");
}
