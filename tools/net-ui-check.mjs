/**
 * 联机 UI 端到端自检（服务器版）：起一个本地服务端，开两个浏览器实例，
 * 走「创建房间 → 加入 → 掷骰 → 选边 → 开局 → 走一步 → 校验状态一致」。
 *
 *   node tools/net-ui-check.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startServer } from "../server/index.js";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = await startServer({
  port: 0,
  host: "127.0.0.1",
  publicRoot: resolve("dist"),
});
const APP = `http://127.0.0.1:${srv.port}/`;
console.log("服务端端口", srv.port);

async function launch(port) {
  const profile = mkdtempSync(join(tmpdir(), `netui-${port}-`));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, APP,
  ], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith(APP));
      if (page) return { proc, page };
    } catch { /* 等启动 */ }
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
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
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
  a = await launch(9411);
  b = await launch(9412);
  const A = await connect(a.page);
  const B = await connect(b.page);

  await waitFor(async () => (await A.evaluate("!!window.__danteng")) && (await B.evaluate("!!window.__danteng")));
  for (const P of [A, B]) {
    await P.evaluate("window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(e.message + ' @' + e.lineno)); true");
  }

  // A 创建房间
  await A.evaluate("document.getElementById('menuNet').click(); document.getElementById('netCreate').click(); true");
  const code = await waitFor(async () => {
    const v = await A.evaluate("document.getElementById('roomCode').textContent");
    return v && v !== "------" ? v : null;
  });
  check("创建房间并拿到 6 位房间码", !!code && code.length === 6, code || "超时");

  // B 加入
  await B.evaluate("document.getElementById('menuNet').click(); document.getElementById('netJoinBtn').click(); true");
  await B.evaluate(`document.getElementById('roomInput').value = ${JSON.stringify(code)}; true`);
  await B.evaluate("document.getElementById('joinGo').click(); true");

  const bothDice = await waitFor(async () => {
    const ha = await A.evaluate("!document.getElementById('diceOverlay').hidden");
    const hb = await B.evaluate("!document.getElementById('diceOverlay').hidden");
    return ha && hb;
  });
  check("双方进入掷骰界面", !!bothDice);

  const diceView = await A.evaluate("JSON.stringify({d0:document.getElementById('dice0').textContent, d1:document.getElementById('dice1').textContent, n0:document.getElementById('diceName0').textContent, n1:document.getElementById('diceName1').textContent, desc:document.getElementById('diceDesc').textContent})");
  const dv = JSON.parse(diceView);
  check("骰子显示点数", /^[1-6]$/.test(dv.d0) && /^[1-6]$/.test(dv.d1), diceView);
  check("骰子标注归属", ["你", "对方"].includes(dv.n0) && ["你", "对方"].includes(dv.n1) && dv.n0 !== dv.n1, diceView);

  // 大点者点「我要先手」
  const chooserIsA = await waitFor(async () => {
    const aHas = await A.evaluate("!!document.querySelector('#diceChoices [data-priority=\"first\"]')");
    const bHas = await B.evaluate("!!document.querySelector('#diceChoices [data-priority=\"first\"]')");
    return aHas ? "A" : bHas ? "B" : null;
  });
  const diceState = await A.evaluate("JSON.stringify({overlay:!document.getElementById('diceOverlay').hidden, sub:document.getElementById('diceSub').textContent, btns:document.querySelectorAll('#diceChoices button').length, errs:window.__errs})");
  check("有一方拿到先手/选边按钮", !!chooserIsA, diceState);

  const chooser = chooserIsA === "A" ? A : B;
  const picker = chooserIsA === "A" ? B : A;
  await chooser.evaluate("document.querySelector('#diceChoices [data-priority=\"first\"]').click(); true");

  const pickerHasSide = await waitFor(async () =>
    (await picker.evaluate("!!document.querySelector('#diceChoices [data-side]')")));
  check("对方收到选边按钮", !!pickerHasSide);
  await picker.evaluate("document.querySelector('#diceChoices [data-side=\"0\"]').click(); true");

  const started = await waitFor(async () => {
    const sa = await A.evaluate("window.__danteng.started && window.__danteng.mode === 'online'");
    const sb = await B.evaluate("window.__danteng.started && window.__danteng.mode === 'online'");
    return sa && sb;
  });
  check("双方进入对局", !!started);

  const seats = await A.evaluate("[window.__danteng.mySeat, window.__danteng.state.turn, window.__danteng.state.plies]");
  check("拿到自己的座位与手数", Array.isArray(seats) && seats[2] === 0, JSON.stringify(seats));

  // 当前行动方走一步
  const turnSeat = seats[1];
  const mover = (await A.evaluate("window.__danteng.mySeat")) === turnSeat ? A : B;
  // 点自己棋子正上方那一格（双方起始都在第 12 行，向上一定合法）
  const pos = await mover.evaluate("window.__danteng.state.players[window.__danteng.mySeat]");
  const targetRow = pos.r > 0 ? pos.r - 1 : pos.r + 1;
  await mover.evaluate(
    `document.querySelector('.cell[data-c="${pos.c}"][data-r="${targetRow}"]').click(); true`,
  );
  await mover.evaluate("document.getElementById('confirm').click(); true");

  const moved = await waitFor(async () => {
    const pa = await A.evaluate("window.__danteng.state.plies");
    const pb = await B.evaluate("window.__danteng.state.plies");
    return pa === 1 && pb === 1;
  });
  check("走一步后双方手数都变成 1", !!moved);

  const hashes = await Promise.all([
    A.evaluate(`(async () => {
      const m = await import("/src/net/ws-client.js").catch(() => null);
      return window.__danteng.state.plies + ":" + window.__danteng.state.turn;
    })()`),
    B.evaluate("window.__danteng.state.plies + ':' + window.__danteng.state.turn"),
  ]);
  check("双方回合状态一致", hashes[0] === hashes[1], hashes.join(" / "));

  // ---- 暂停：A 请求 → B 同意 → 双方封盘 ---- 
  await A.evaluate("document.getElementById('pause').click(); true");
  const pauseAsked = await waitFor(async () =>
    !(await B.evaluate("document.getElementById('undoOverlay').hidden")));
  check("对方收到暂停请求", !!pauseAsked);
  await B.evaluate("document.getElementById('undoYes').click(); true");
  const paused = await waitFor(async () => {
    const pa = await A.evaluate("!document.getElementById('pauseOverlay').hidden && document.getElementById('boardWrap').hidden");
    const pb = await B.evaluate("!document.getElementById('pauseOverlay').hidden && document.getElementById('boardWrap').hidden");
    return pa && pb;
  });
  check("双方进入封盘状态", !!paused);

  // 暂停页可以暂存对局
  await A.evaluate("document.getElementById('pauseSave').click(); true");
  const saved = await waitFor(async () => {
    const raw = await A.evaluate("localStorage.getItem('danteng.slots.v1')");
    return raw && raw.includes('"id"');
  });
  check("暂停页可暂存对局", !!saved);

  // 继续对局：需要对方同意
  await A.evaluate("document.getElementById('pauseResume').click(); true");
  const resumeAsked = await waitFor(async () =>
    !(await B.evaluate("document.getElementById('pauseAnswer').hidden")));
  check("对方收到继续请求", !!resumeAsked);
  await B.evaluate("document.getElementById('pauseAccept').click(); true");
  const resumed = await waitFor(async () => {
    const ra = await A.evaluate("document.getElementById('pauseOverlay').hidden && !document.getElementById('boardWrap').hidden");
    const rb = await B.evaluate("document.getElementById('pauseOverlay').hidden && !document.getElementById('boardWrap').hidden");
    return ra && rb;
  });
  check("双方恢复对局", !!resumed);

  // ---- 悔棋：没走的那方发起，走的那方同意 ----
  const other = mover === A ? B : A;
  await other.evaluate("document.getElementById('undo').click(); true");
  const undoAsked = await waitFor(async () =>
    !(await mover.evaluate("document.getElementById('undoOverlay').hidden")));
  check("对方收到悔棋请求", !!undoAsked);
  await mover.evaluate("document.getElementById('undoYes').click(); true");
  const rolledBack = await waitFor(async () => {
    const pa = await A.evaluate("window.__danteng.state.plies");
    const pb = await B.evaluate("window.__danteng.state.plies");
    return pa === 0 && pb === 0;
  });
  check("悔棋后双方回到 0 手", !!rolledBack);

  // ---- 认输：点两次确认 ----
  await mover.evaluate("document.getElementById('resign').click(); document.getElementById('resign').click(); true");
  const over = await waitFor(async () => {
    const oa = await A.evaluate("!document.getElementById('overlay').hidden");
    const ob = await B.evaluate("!document.getElementById('overlay').hidden");
    return oa && ob;
  });
  check("认输后双方都结束", !!over);
  const titles = await Promise.all([
    A.evaluate("document.getElementById('panelTitle').textContent"),
    B.evaluate("document.getElementById('panelTitle').textContent"),
  ]);
  check("胜负显示相反", titles[0] !== titles[1], titles.join(" / "));

  // ---- 再来一局：请求 → 同意 → 重新掷骰 ----
  await A.evaluate("document.getElementById('again').click(); true");
  const rematchAsked = await waitFor(async () =>
    !(await B.evaluate("document.getElementById('undoOverlay').hidden")));
  check("对方收到再来一局请求", !!rematchAsked);
  await B.evaluate("document.getElementById('undoYes').click(); true");
  const backToDice = await waitFor(async () => {
    const da = await A.evaluate("!document.getElementById('diceOverlay').hidden");
    const db = await B.evaluate("!document.getElementById('diceOverlay').hidden");
    return da && db;
  });
  check("同意后双方重新掷骰", !!backToDice);
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
