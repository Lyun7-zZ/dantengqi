/**
 * 静态文件服务：只暴露一个目录，防目录穿越，带简单缓存头。
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** "/" 依次尝试的入口文件。 */
const INDEX_CANDIDATES = ["index.html", "蛋疼棋.html"];

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = resolve(join(root, normalized));
  const rootAbs = resolve(root) + sep;
  if (full !== resolve(root) && !full.startsWith(rootAbs)) return null;
  return full;
}

async function fileAt(p) {
  try {
    const st = await stat(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

export async function serveStatic(req, res, root) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  // 去掉查询串：/?play=async 也要按根路径处理
  const url = (req.url || "/").split("?")[0] || "/";
  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  let target = url === "/" ? null : safeJoin(root, url);
  if (url === "/") {
    for (const name of INDEX_CANDIDATES) {
      const p = join(root, name);
      if (await fileAt(p)) { target = p; break; }
    }
  }
  if (!target) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const st = await fileAt(target);
  if (!st) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const type = TYPES[extname(target).toLowerCase()] || "application/octet-stream";
  const isHtml = type.startsWith("text/html");
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": st.size,
    "Cache-Control": isHtml ? "no-store" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}
