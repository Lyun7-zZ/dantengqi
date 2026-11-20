import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2] || "http://127.0.0.1:5173/?nodice=1";
const PORT = 9777;
const profile = mkdtempSync(join(tmpdir(), "danteng-probe2-"));
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
};
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return "EXC " + JSON.stringify(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(1500);

await ev("document.getElementById('menuLocal').click(); true");
await sleep(500);
console.log("开局后：", await ev("JSON.stringify({started:window.__danteng.started, gameOver:window.__danteng.gameOver, paused:window.__danteng.paused, pauseHidden:document.getElementById('pause').hidden, boardHidden:document.getElementById('boardWrap').hidden, mode:window.__danteng.mode})"));
await ev("document.querySelector('.cell[data-c=\"0\"][data-r=\"10\"]').click(); document.getElementById('confirm').click(); true");
await sleep(300);
console.log("走一步后：", await ev("JSON.stringify({plies:window.__danteng.state.plies, pauseHidden:document.getElementById('pause').hidden, gameOver:window.__danteng.gameOver})"));
await ev("document.getElementById('pause').click(); true");
await sleep(200);
console.log("点暂停后：", await ev("JSON.stringify({paused:window.__danteng.paused, overlay:!document.getElementById('pauseOverlay').hidden, board:document.getElementById('boardWrap').hidden})"));

ws.close();
proc.kill();
