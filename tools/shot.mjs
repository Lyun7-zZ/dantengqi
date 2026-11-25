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
  const raw = process.argv[3] || "";
  const [fp, q] = raw.split("?");
  url = "file:///" + encodeURI(resolve(fp).replace(/\\/g, "/")) + (q ? "?" + q : "");
}
const out = process.argv.slice(2).find((a) => a.endsWith(".png")) ?? "_shots/shot.png";
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
if (process.argv.includes("--home")) {
  // 只截主菜单
} else if (process.argv.includes("--levels")) {
  await evalJs("document.getElementById('menuAI').click()");
  await sleep(600);
} else {
  await evalJs("document.getElementById('menuLocal').click()");
  await sleep(400);
  if (!process.argv.includes("--nomove")) {
    await evalJs("document.querySelector('.cell[data-c=\"0\"][data-r=\"10\"]').click()");
    await sleep(150);
    await evalJs("document.getElementById('confirm').click()");
    await sleep(900);
  }
}

if (process.argv.includes("--ai") || process.argv.includes("--probe")) {
  const level = process.argv.includes("--probe") ? "hell" : "normal";
  await evalJs("document.getElementById('menuAI').click()");
  await sleep(250);
  await evalJs(`document.querySelector('.menuItem[data-level="${level}"]').click()`);
  await sleep(400);
  await evalJs("document.querySelector('.cell[data-c=\"0\"][data-r=\"10\"]').click()");
  await sleep(120);
  await evalJs("document.getElementById('confirm').click()");
  await sleep(120);
  if (process.argv.includes("--probe")) {
    const t0 = Date.now();
    await evalJs("1 + 1");
    const lag = Date.now() - t0;
    const thinking = await evalJs("window.__danteng.aiThinking");
    console.log(`主线程探测延迟 ${lag}ms，aiThinking=${thinking}`);
    await sleep(2500);
    const lag2 = await (async () => { const t = Date.now(); await evalJs("2 + 2"); return Date.now() - t; })();
    const left = await evalJs("[document.getElementById('clk0').textContent, document.getElementById('clk1').textContent].join('/')");
    const bar = await evalJs("document.getElementById('turnBarFill').style.width");
    console.log(`再次探测 ${lag2}ms，左上角倒计时=${left}，计时条=${bar}`);
  }
  await sleep(250);
}

if (process.argv.includes("--bank")) {
  await evalJs(`(() => {
    const c = window.__danteng.clocks;
    c.moveLeft = 0;
    c.inBank = true;
    c.banks[0] = 150;
  })()`);
  await sleep(400);
}

if (process.argv.includes("--split")) {
  await evalJs(`(() => {
    const f = document.getElementById("resultFull");
    f.hidden = false;
    document.getElementById("rfLeft").textContent = "你赢了";
    document.getElementById("rfRight").textContent = "你输了";
    document.getElementById("rfLeftHalf").classList.add("win");
    document.getElementById("rfRightHalf").classList.add("lose");
  })()`);
  await sleep(300);
}

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("saved", out);

ws.close();
proc.kill();
