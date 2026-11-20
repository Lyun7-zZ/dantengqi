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
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
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

const state = async () => JSON.parse(await ev("JSON.stringify({started:window.__danteng.started, plies:window.__danteng.state?window.__danteng.state.plies:null, paused:window.__danteng.paused, gameOver:window.__danteng.gameOver, home:!document.getElementById('homeOverlay').hidden, pauseOverlay:!document.getElementById('pauseOverlay').hidden, boardHidden:document.getElementById('boardWrap').hidden})"));

check("页面载入", (await state()).home === true);

await ev("document.getElementById('menuLocal').click(); true");
await sleep(400);
check("本地开局", (await state()).started === true);

await ev("document.querySelector('.cell[data-c=\"0\"][data-r=\"10\"]').click(); document.getElementById('confirm').click(); true");
await sleep(300);
check("走一步", (await state()).plies === 1);

await ev("document.getElementById('pause').click(); true");
await sleep(300);
let st = await state();
check("暂停后封盘", st.paused === true && st.pauseOverlay === true && st.boardHidden === true, JSON.stringify(st));

await ev("document.getElementById('pauseSave').click(); true");
await sleep(300);
check("暂停页可暂存", (await ev("!!localStorage.getItem('danteng.slots.v1')")) === true);

await ev("document.getElementById('pauseExit').click(); true");
await sleep(500);
check("退出回主菜单", (await state()).home === true);

await ev("document.getElementById('menuSlots').click(); true");
await sleep(300);
check("存档列表有一条", (await ev("document.querySelectorAll('#slotList .slotRow').length")) === 1);

await ev("(() => { const b = document.querySelector('#slotList .btn.primary'); if (b) b.click(); return true; })()");
await sleep(400);
st = await state();
check("从存档继续：棋盘恢复", st.started === true && st.paused === false && st.boardHidden === false, JSON.stringify(st));
check("从存档继续：手数保留", st.plies === 1, JSON.stringify(st));
check("无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;

ws.close();
proc.kill();
