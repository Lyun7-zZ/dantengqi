/**
 * 截图工具：起一个无头 Edge，进入本地对局走一步，截当前界面。
 *   node tools/shot.mjs [url] [out.png]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
let url = process.argv[2] ?? "http://127.0.0.1:5173/?nodice=1";
if (url === "--file") {
  url = "file:///" + encodeURI(resolve(process.argv[3]).replace(/\\/g, "/"));
}
const out = process.argv[4] ?? (process.argv[3]?.endsWith(".png") ? process.argv[3] : "_shots/shot.png");
const PORT = 9444;
const profile = mkdtempSync(join(tmpdir(), "danteng-shot-"));

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,900", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* 等浏览器 */ }
    await sleep(250);
  }
  throw new Error("没有找到页面 target");
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(1500);

const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true })).result?.result?.value;

// 开局：本地对战，走一步
await evalJs("document.getElementById('menuLocal').click()");
await sleep(400);
await evalJs("document.querySelector('.cell[data-c=\"0\"][data-r=\"10\"]').click()");
await sleep(150);
await evalJs("document.getElementById('confirm').click()");
await sleep(900);

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("saved", out);

ws.close();
proc.kill();
