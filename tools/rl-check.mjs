/** 用无头 Edge 打开单文件，捕获异常并点进实验难度。 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const file = resolve("dist/蛋疼棋.html");
const url = "file:///" + encodeURI(file.replace(/\\/g, "/")) + "?nodice=1";
const PORT = 9455;
const profile = mkdtempSync(join(tmpdir(), "danteng-rlcheck-"));
const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,900", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === "page");
    if (page) break;
  } catch {}
  await sleep(250);
}
if (!page) throw new Error("no page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push(m.params.args.map((a) => a.value || a.description).join(" "));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
await sleep(2500);
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
console.log("title", await evalJs("document.title"));
console.log("levels", await evalJs("[...document.querySelectorAll('[data-level]')].map(e=>e.dataset.level).join(',')"));
await evalJs("document.getElementById('menuAI').click()");
await sleep(300);
await evalJs("document.querySelector('[data-level=\"experiment\"]').click()");
await sleep(1500);
console.log("mode", await evalJs("window.__danteng?.state?.mode ?? 'unknown'"));
console.log("started", await evalJs("window.__danteng?.started ?? false"));
console.log("errors", JSON.stringify(errors.slice(0, 5), null, 1));
proc.kill();
process.exit(errors.length ? 1 : 0);
