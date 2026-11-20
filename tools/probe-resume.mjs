import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2] || "http://127.0.0.1:5173/?nodice=1";
const PORT = 9888;
const profile = mkdtempSync(join(tmpdir(), "danteng-resume-"));
const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p) return p;
    } catch { /* wait */ }
    await sleep(250);
  }
  throw new Error("no target");
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Page.javascriptDialogOpening") {
    send("Page.handleJavaScriptDialog", { accept: true });
    return;
  }
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
};
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return "EXC " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
await sleep(1800);

const state = async (label) => console.log(label, await ev("JSON.stringify({started:window.__danteng.started, plies:window.__danteng.state?window.__danteng.state.plies:null, paused:window.__danteng.paused, gameOver:window.__danteng.gameOver, home:!document.getElementById('homeOverlay').hidden})"));

await state("载入");
await ev("document.getElementById('menuLocal').click(); true");
await sleep(400);
await state("开局");
await ev("document.querySelector('.cell[data-c=\"0\"][data-r=\"10\"]').click(); document.getElementById('confirm').click(); true");
await sleep(300);
await state("走一步");
await ev("document.getElementById('pause').click(); true");
await sleep(300);
await state("暂停");
await ev("document.getElementById('pauseSave').click(); true");
await sleep(300);
console.log("存档：", await ev("localStorage.getItem('danteng.slots.v1') ? 'yes' : 'no'"));
await ev("document.getElementById('pauseExit').click(); true");
await sleep(500);
await state("退出");
await ev("document.getElementById('menuSlots').click(); true");
await sleep(300);
console.log("条目数：", await ev("document.querySelectorAll('#slotList .slotRow').length"));
await ev("(() => { const b = document.querySelector('#slotList .btn.primary'); if (b) b.click(); return !!b; })()");
await sleep(400);
await state("继续存档");
console.log("页面错误：", errors.length ? errors.slice(0, 2) : "无");

ws.close();
proc.kill();
