/**
 * 异步模式联机端到端：本地服务端 + 两个浏览器（?play=async）。
 * 流程：建房 → 加入 → 掷骰选边 → 双方各提交一手 → 回合结算。
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startServer } from "../server/index.js";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = await startServer({ port: 0, host: "127.0.0.1", publicRoot: resolve("dist") });
const APP = `http://127.0.0.1:${srv.port}/?play=async`;

async function launch(port) {
  const profile = mkdtempSync(join(tmpdir(), `asyncui-${port}-`));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, APP,
  ], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${srv.port}`));
      if (page) return { proc, page };
    } catch { /* wait */ }
    await sleep(250);
  }
  throw new Error("浏览器启动失败 " + port);
}

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve: res, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else res(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  return { evaluate };
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });
async function waitFor(fn, ms = 15000, step = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

let a;
let b;
try {
  a = await launch(9421);
  b = await launch(9422);
  const A = await connect(a.page);
  const B = await connect(b.page);

  const ready = await waitFor(async () =>
    (await A.evaluate("!!window.__danteng")) && (await B.evaluate("!!window.__danteng")));
  check("双方页面就绪", !!ready);

  await A.evaluate("document.getElementById('menuNet').click(); document.getElementById('netCreate').click(); true");
  const code = await waitFor(async () => {
    const v = await A.evaluate("document.getElementById('roomCode').textContent");
    return v && v !== "------" ? v : null;
  });
  check("异步房间创建成功", !!code && code.length === 6, code || "超时");

  await B.evaluate("document.getElementById('menuNet').click(); document.getElementById('netJoinBtn').click(); true");
  await B.evaluate(`document.getElementById('roomInput').value = ${JSON.stringify(code)}; true`);
  await B.evaluate("document.getElementById('joinGo').click(); true");

  await waitFor(async () => (await A.evaluate("!document.getElementById('diceOverlay').hidden"))
    && (await B.evaluate("!document.getElementById('diceOverlay').hidden")));
  check("双方进入掷骰", true);

  const chooserIsA = await waitFor(async () => {
    const aHas = await A.evaluate("!!document.querySelector('#diceChoices [data-priority=\"first\"]')");
    const bHas = await B.evaluate("!!document.querySelector('#diceChoices [data-priority=\"first\"]')");
    return aHas ? "A" : bHas ? "B" : null;
  });
  const chooser = chooserIsA === "A" ? A : B;
  const picker = chooserIsA === "A" ? B : A;
  await chooser.evaluate("document.querySelector('#diceChoices [data-priority=\"first\"]').click(); true");
  await waitFor(async () => (await picker.evaluate("!!document.querySelector('#diceChoices [data-side]')")));
  await picker.evaluate("document.querySelector('#diceChoices [data-side=\"0\"]').click(); true");

  const started = await waitFor(async () => {
    const sa = await A.evaluate("window.__danteng.started && window.__danteng.mode === 'online'");
    const sb = await B.evaluate("window.__danteng.started && window.__danteng.mode === 'online'");
    return sa && sb;
  });
  check("双方进入异步对局", !!started);

  // 双方各提交一手：点自己棋子上方一格
  for (const P of [A, B]) {
    const pos = await P.evaluate("window.__danteng.state.players[window.__danteng.mySeat]");
    const row = pos.r > 0 ? pos.r - 1 : pos.r + 1;
    await P.evaluate(`document.querySelector('.cell[data-c="${pos.c}"][data-r="${row}"]').click(); true`);
    await P.evaluate("document.getElementById('confirm').click(); true");
    await sleep(150);
  }

  const resolved = await waitFor(async () => {
    const pa = await A.evaluate("window.__danteng.state.plies");
    const pb = await B.evaluate("window.__danteng.state.plies");
    return pa === 1 && pb === 1;
  });
  check("双方提交后结算一回合", !!resolved);

  // 暂停：A 请求 → B 同意 → 双方封盘 → 恢复
  await A.evaluate("document.getElementById('pause').click(); true");
  const asked = await waitFor(async () => !(await B.evaluate("document.getElementById('undoOverlay').hidden")));
  check("对方收到暂停请求", !!asked);
  await B.evaluate("document.getElementById('undoYes').click(); true");
  const paused = await waitFor(async () => {
    const pa = await A.evaluate("!document.getElementById('pauseOverlay').hidden && document.getElementById('boardWrap').hidden");
    const pb = await B.evaluate("!document.getElementById('pauseOverlay').hidden && document.getElementById('boardWrap').hidden");
    return pa && pb;
  });
  check("双方进入封盘状态", !!paused);

  await A.evaluate("document.getElementById('pauseResume').click(); true");
  const resumeAsked = await waitFor(async () => !(await B.evaluate("document.getElementById('pauseAnswer').hidden")));
  check("对方收到继续请求", !!resumeAsked);
  await B.evaluate("document.getElementById('pauseAccept').click(); true");
  const resumed = await waitFor(async () => {
    const ra = await A.evaluate("document.getElementById('pauseOverlay').hidden && !document.getElementById('boardWrap').hidden");
    const rb = await B.evaluate("document.getElementById('pauseOverlay').hidden && !document.getElementById('boardWrap').hidden");
    return ra && rb;
  });
  check("双方恢复对局", !!resumed);
} catch (e) {
  check("执行过程", false, e.message);
} finally {
  a?.proc.kill();
  b?.proc.kill();
  await srv.close();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exitCode = 1;
}
