import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist/viewer", { recursive: true });
const result = await build({
  entryPoints: ["src/viewer/app.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false
});
const html = readFileSync("src/viewer/index.html", "utf8").replace("/*__BUNDLE__*/", result.outputFiles[0].text);
writeFileSync("dist/viewer/index.html", html);
console.log("viewer: dist/viewer/index.html 已生成");
