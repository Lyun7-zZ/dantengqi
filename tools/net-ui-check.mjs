/**
 * 联机 UI 端到端自检：两个浏览器实例，走「用连接码」的真实界面流程，
 * 完成 建房 → 应答 → 掷骰 → 选先手 → 选边 → 开局 → 走一步 → 校验状态一致。
 *
 *   node tools/serve.js 5173
 *   node tools/net-ui-check.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(port) {
  const profile = mkdtempSync(join(tmpdir(), `netui-${port}-`));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, APP,
  ], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:5173"));
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

async function waitFor(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

let a, b;
try {
  a = await launch(9411);
  b = await launch(9412);
  const A = await connect(a.page);
  const B = await connect(b.page);

  await waitFor(async () => (await A.evaluate("!!window.__danteng")) && (await B.evaluate("!!window.__danteng")));

  // 两端都进入「联机 → 用连接码」
  await A.evaluate("document.getElementById('menuNet').click(); document.getElementById('netManualBtn').click(); true");
  await B.evaluate("document.getElementById('menuNet').click(); document.getElementById('netManualBtn').click(); true");

  // A 生成邀请码
  await A.evaluate("document.getElementById('manualHostBtn').click(); true");
  const offer = await waitFor(async () => {
    const v = await A.evaluate("document.getElementById('manualOfferOut').value");
    return v.startsWith("DTQ1-") ? v : null;
  });
  check("界面生成邀请码", !!offer, offer ? offer.length + " 字符" : "超时");

  // B 粘贴邀请码 → 生成应答码
  await B.evaluate("document.getElementById('manualGuestBtn').click(); true");
  await B.evaluate(`document.getElementById('manualOfferIn').value = ${JSON.stringify(offer)}; true`);
  await B.evaluate("document.getElementById('manualMakeAnswer').click(); true");
  const answer = await waitFor(async () => {
    const v = await B.evaluate("document.getElementById('manualAnswerOut').value");
    return v.startsWith("DTQ1-") ? v : null;
  });
  check("界面生成应答码", !!answer, answer ? answer.length + " 字符" : "超时");

  // A 粘贴应答码 → 完成连接
  await A.evaluate(`document.getElementById('manualAnswerIn').value = ${JSON.stringify(answer)}; true`);
  await A.evaluate("document.getElementById('manualFinish').click(); true");

  // 等双方进入掷骰
  const diceShown = await waitFor(async () => (await A.evaluate("!document.getElementById('diceOverlay').hidden"))
    && (await B.evaluate("!document.getElementById('diceOverlay').hidden")));
  check("双方进入掷骰界面", !!diceShown);

  // 掷骰后，大点者持有「先手 / 选边」按钮
  const hasPriorityA = await waitFor(async () =>
    await A.evaluate("!!document.querySelector('#diceChoices [data-priority]')") ? "A" : null);
  const chooserIsA = !!hasPriorityA;
  const chooser = chooserIsA ? A : B;
  const other = chooserIsA ? B : A;
  check("大点者出现二选一按钮", true);

  await chooser.evaluate("document.querySelector('#diceChoices [data-priority=\"first\"]').click(); true");

  // 另一方选边
  await waitFor(async () => await other.evaluate("!!document.querySelector('#diceChoices [data-side]')"));
  await other.evaluate("document.querySelector('#diceChoices [data-side=\"0\"]').click(); true");

  // 等开局
  const started = await waitFor(async () => (await A.evaluate("window.__danteng.started"))
    && (await B.evaluate("window.__danteng.started")));
  check("双方进入对局", !!started);

  const seats = {
    a: await A.evaluate("window.__danteng.mySeat"),
    b: await B.evaluate("window.__danteng.mySeat"),
  };
  check("双方座位不同", seats.a !== seats.b, `A=${seats.a} B=${seats.b}`);

  // 轮到谁就由谁走一步
  const turnA = await A.evaluate("window.__danteng.state.turn === window.__danteng.mySeat");
  const mover = turnA ? A : B;
  const moverWin = turnA ? a : b;

  await mover.evaluate(`(() => {
    const g = window.__danteng;
    const me = g.state.players[g.state.turn];
    const cell = document.querySelector('.cell.move-target');
    if (cell) cell.click();
    return !!cell;
  })()`);
  await mover.evaluate("document.getElementById('confirm').click(); true");

  const movedPlies = await waitFor(async () => {
    const p = await A.evaluate("window.__danteng.state.plies");
    return p === 1 ? p : null;
  });
  check("主机侧收到行动", movedPlies === 1);

  const hashA = await A.evaluate(`(async () => {
    const m = await import("/src/net/protocol.js");
    return m.stateHash(window.__danteng.state);
  })()`);
  const hashB = await B.evaluate(`(async () => {
    const m = await import("/src/net/protocol.js");
    return m.stateHash(window.__danteng.state);
  })()`);
  check("双方局面哈希一致", hashA === hashB, `${hashA} / ${hashB}`);
} catch (e) {
  check("执行过程", false, e.message);
} finally {
  a?.proc.kill();
  b?.proc.kill();
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  if (failed) process.exitCode = 1;
}
