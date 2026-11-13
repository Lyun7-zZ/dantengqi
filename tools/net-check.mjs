/**
 * 浏览器内 WebRTC 连通性自检：开两个标签页，用手动连接码互连，
 * 验证 DataChannel 能打开并双向传消息。不依赖任何外部服务器。
 *
 *   node tools/serve.js 5173
 *   node tools/net-check.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(port) {
  const profile = mkdtempSync(join(tmpdir(), `net-${port}-`));
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
  throw new Error(`浏览器 ${port} 启动失败`);
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result?.value;
  };
  return { ws, evaluate };
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });

let a, b;
try {
  a = await launch(9401);
  b = await launch(9402);
  const A = await connect(a.page);
  const B = await connect(b.page);

  // 等页面就绪
  for (let i = 0; i < 40; i++) {
    const okA = await A.evaluate("!!window.__danteng").catch(() => false);
    const okB = await B.evaluate("!!window.__danteng").catch(() => false);
    if (okA && okB) break;
    await sleep(150);
  }

  const offerCode = await A.evaluate(`(async () => {
    const m = await import("/src/net/manual.js");
    window.__h = await m.createManualOffer();
    return window.__h.code;
  })()`);
  check("主机生成邀请码", typeof offerCode === "string" && offerCode.startsWith("DTQ1-"), `${offerCode?.length ?? 0} 字符`);

  const answerCode = await B.evaluate(`(async () => {
    const m = await import("/src/net/manual.js");
    window.__g = await m.answerManualOffer(${JSON.stringify(offerCode)});
    return window.__g.code;
  })()`);
  check("客机生成应答码", typeof answerCode === "string" && answerCode.startsWith("DTQ1-"), `${answerCode?.length ?? 0} 字符`);

  await A.evaluate(`(async () => { await window.__h.complete(${JSON.stringify(answerCode)}); return true; })()`);

  // 等通道打开
  let openA = false, openB = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    openA = await A.evaluate("window.__h.transport.state === 'open'");
    openB = await B.evaluate("window.__g.transport.state === 'open'");
    if (openA && openB) break;
  }
  check("主机 DataChannel 已打开", openA);
  check("客机 DataChannel 已打开", openB);

  // 双向传消息
  await B.evaluate(`window.__got = null; window.__g.transport.onMessage = (m) => { window.__got = m; }; true`);
  await A.evaluate(`window.__h.transport.send({ t: "hello", from: "host" }); true`);
  await sleep(400);
  const got = await B.evaluate("window.__got");
  check("消息可由主机传到客机", got?.t === "hello" && got?.from === "host");

  await A.evaluate(`window.__got2 = null; window.__h.transport.onMessage = (m) => { window.__got2 = m; }; true`);
  await B.evaluate(`window.__g.transport.send({ t: "pong", from: "guest" }); true`);
  await sleep(400);
  const got2 = await A.evaluate("window.__got2");
  check("消息可由客机传到主机", got2?.t === "pong" && got2?.from === "guest");
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
