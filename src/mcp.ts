#!/usr/bin/env node
import { runMcpServer } from "./mcp/server.js";

runMcpServer(process.argv[2] ?? "model.voxel.json").catch((e) => {
  console.error("voxelforge-mcp:", e instanceof Error ? e.message : e);
  process.exit(1);
});
