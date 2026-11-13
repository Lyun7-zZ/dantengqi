/**
 * 打包成单文件 HTML：双击即可玩，不需要服务器。
 *
 *   node tools/build-single.mjs
 * → dist/蛋疼棋.html
 *
 * 双模式：回合制（app.js）与异步（app-async.js）各打成一个函数作用域，
 * 避免两套规则引擎里同名函数（createState / applyAction / setWall…）互相覆盖。
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
    if (/^export\s*\{/.test(line)) continue;
    out.push(line.replace(/^export\s+(function|const|let|class|async)/, "$1"));
  }
  return out.join("\n");
}

const TURN = [
  "src/config.js",
  "src/board.js",
  "src/path.js",
  "src/rules.js",
  "src/clock.js",
  "src/ai-random.js",
  "src/ai-master.js",
  "src/ai.js",
  "src/net/protocol.js",
  "src/net/code.js",
  "src/net/transport.js",
  "src/net/session.js",
  "src/net/peer.js",
  "src/net/manual.js",
  "src/storage.js",
  "app.js",
];

const ASYNC = [
  "src/config.js",
  "src/board.js",
  "src/path-async.js",
  "src/rules-async.js",
  "src/clock.js",
  "src/ai-random-async.js",
  "src/ai-async.js",
  "src/net/protocol-async.js",
  "src/net/code.js",
  "src/net/transport.js",
  "src/net/session-async.js",
  "src/net/peer.js",
  "src/net/manual.js",
  "src/storage.js",
  "app-async.js",
];

async function bundle(files, fnName) {
  const parts = [];
  for (const f of files) {
    const code = stripModuleSyntax(await rd(f));
    if (code.includes("export ")) throw new Error(`${f} 里还有未处理的 export`);
    parts.push(`/* ===== ${f} ===== */\n${code}`);
  }
  return `function ${fnName}() {\n${parts.join("\n")}\n}`;
}

const turnBundle = await bundle(TURN, "__dantengTurn");
const asyncBundle = await bundle(ASYNC, "__dantengAsync");

// loader.js 顶层有 await import(...)，内联时改成直接调用
let loader = stripModuleSyntax(await rd("loader.js"));
loader = loader.replace(
  /await import\([^)]*\);/,
  'if (play === "async") __dantengAsync(); else __dantengTurn();',
);
if (!loader.includes("__dantengTurn")) throw new Error("loader 的 import 没被替换");

const bundleCode = `(function () {\n"use strict";\n${turnBundle}\n\n${asyncBundle}\n\n${loader}\n})();`;

let html = await rd("index.html");
const css = await rd("styles.css");

html = html.replace(
  /<link rel="stylesheet" href="\.\/styles\.css" \/>/,
  `<style>\n${css}\n</style>`,
);
html = html.replace(
  /<script type="module" src="\.\/loader\.js"><\/script>/,
  `<script>\n${bundleCode}\n</script>`,
);

if (html.includes('src="./loader.js"') || html.includes('href="./styles.css"')) {
  throw new Error("HTML 中的外链没有被替换掉");
}

await mkdir(join(root, "dist"), { recursive: true });
const outFile = join(root, "dist", "蛋疼棋.html");
await writeFile(outFile, html, "utf-8");

console.log(`打包完成：${outFile}（${(html.length / 1024).toFixed(1)} KB）`);
