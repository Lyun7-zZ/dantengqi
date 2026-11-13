/**
 * 打包成单文件 HTML：双击即可玩，不需要服务器。
 *
 *   node tools/build-single.mjs
 * → dist/蛋疼棋.html
 *
 * 做法：把 src/*.js 与 app.js 按依赖顺序拼接，去掉 import/export 语句，
 * 包进一个 IIFE，再把 CSS 与脚本内联进 index.html。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const rd = (p) => readFile(join(root, p), "utf-8");

/** 去掉 import 语句（支持多行）与 export 关键字。 */
function stripModuleSyntax(code) {
  const lines = code.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      if (/\bfrom\s+["'][^"']+["']/.test(line)) skipping = false;
      continue;
    }
    if (/^import\s/.test(line)) {
      if (!/\bfrom\s+["'][^"']+["']/.test(line)) skipping = true;
      continue;
    }
    out.push(line.replace(/^export\s+(function|const|let|class|async)/, "$1"));
  }
  return out.join("\n");
}

const order = [
  "src/config.js",
  "src/board.js",
  "src/path.js",
  "src/rules.js",
  "src/clock.js",
  "src/ai.js",
  "src/net/protocol.js",
  "src/net/code.js",
  "src/net/transport.js",
  "src/net/session.js",
  "src/net/peer.js",
  "src/net/manual.js",
  "app.js",
];

const parts = [];
for (const f of order) {
  const code = stripModuleSyntax(await rd(f));
  if (code.includes("export ")) {
    throw new Error(`${f} 里还有未处理的 export`);
  }
  parts.push(`/* ===== ${f} ===== */\n${code}`);
}

const bundle = `(function () {\n"use strict";\n${parts.join("\n")}\n})();`;

let html = await rd("index.html");
const css = await rd("styles.css");

html = html.replace(
  /<link rel="stylesheet" href="\.\/styles\.css" \/>/,
  `<style>\n${css}\n</style>`,
);
html = html.replace(
  /<script type="module" src="\.\/app\.js"><\/script>/,
  `<script>\n${bundle}\n</script>`,
);

if (html.includes('src="./app.js"') || html.includes('href="./styles.css"')) {
  throw new Error("HTML 中的外链没有被替换掉");
}

await mkdir(join(root, "dist"), { recursive: true });
const outFile = join(root, "dist", "蛋疼棋.html");
await writeFile(outFile, html, "utf-8");

console.log(`打包完成：${outFile}（${(html.length / 1024).toFixed(1)} KB）`);
