/**
 * 界面交互自检：通过 CDP 发送真实鼠标事件（不是 element.click()），
 * 因此能发现“图层挡住点击”这类问题。
 *
 *   node tools/serve.js 5173
 *   node tools/ui-check.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
let URL_ = process.argv[2] ?? "http://127.0.0.1:5173/?nodice=1";
if (URL_ === "--file") {
  const p = process.argv[3];
  const q = process.argv[4] ? "?" + process.argv[4] : "";
  URL_ = "file:///" + encodeURI(resolve(p).replace(/\\/g, "/")) + q;
}
const BASE = URL_.split("?")[0];
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "danteng-edge-"));

const proc = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1440,900",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* 等浏览器起来 */ }
    await sleep(250);
  }
  throw new Error("没有找到页面 target");
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
};

try {
  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let seq = 0;
  const pending = new Map();

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Page.javascriptDialogOpening") {
      ws.send(JSON.stringify({ id: ++seq, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };

  await send("Page.enable");
  const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__DSH_NODICE = true;",
  });
  await send("Page.navigate", { url: BASE });
  await sleep(350);

  // 等页面脚本就绪
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate("!!(window.__danteng && window.__danteng.state)").catch(() => false);
    if (ready) break;
    await sleep(150);
  }

  async function center(selector) {
    return evaluate(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width, h: r.height };
    })()`);
  }

  async function hit(selector) {
    return evaluate(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return t ? (t.className || t.tagName) : null;
    })()`);
  }

  async function click(selector, label = selector) {
    const pt = await center(selector);
    if (!pt) { check(`找到元素 ${label}`, false); return; }
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await sleep(60);
  }

  const state = (expr) => evaluate(`(() => { const g = window.__danteng; const s = g.state; return (${expr}); })()`);

  // 0. 主菜单：未开始时应暂停，且能进入人机子菜单
  check("主菜单默认可见", (await evaluate("!document.getElementById('homeOverlay').hidden")) === true);
  const beforeStart = await evaluate("window.__danteng.started");
  check("未开始时处于暂停状态", beforeStart === false);

  const cBefore = await evaluate("document.getElementById('clk0').textContent");
  await sleep(1200);
  const cAfter = await evaluate("document.getElementById('clk0').textContent");
  check("未开始时计时不走", cBefore === cAfter, `${cBefore} → ${cAfter}`);

  await click("#menuAI", "人机对战");
  check("打开人机难度子菜单", (await evaluate("!document.getElementById('homeAI').hidden")) === true);
  await click("#aiBack", "返回");
  check("可以从子菜单返回", (await evaluate("!document.getElementById('homeMain').hidden")) === true);

  await click("#menuRules", "游戏规则");
  check("主菜单可打开规则", (await evaluate("!document.getElementById('rulesOverlay').hidden")) === true);
  await click("#rulesClose", "知道了");

  await click("#menuLocal", "玩家对战");
  check("点击玩家对战进入对局", (await evaluate("window.__danteng.started")) === true);
  check("主菜单已隐藏", (await evaluate("document.getElementById('homeOverlay').hidden")) === true);

  // 0. 命中检测：格子中心点必须命中 .cell，而不是被图层挡住
  check("格子中心可被鼠标命中", (await hit('.cell[data-c="0"][data-r="10"]'))?.includes("cell"));
  check("墙位中心可被鼠标命中", (await hit('.slot[data-kind="v"][data-c="0"][data-r="9"]'))?.includes("slot"));

  // 热区收窄：距格线 1.8% 板宽的位置应仍属于格子，而不是墙位
  const nearLine = await evaluate(`(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const x = b.x + b.width * (0.10 * 3 + 0.018);
    const y = b.y + b.height * (5.5 / 12);
    const t = document.elementFromPoint(x, y);
    return t ? t.className : null;
  })()`);
  check("靠近格线但不压线时命中格子", String(nearLine).includes("cell"));

  // 1. 点击格子生成移动预览
  await click('.cell[data-c="0"][data-r="10"]', "A-11");
  check("点击格子生成移动预览", (await state("!!g.preview && g.preview.action.dir === 'up'")) === true);
  check("预览后确认按钮可用", (await evaluate("!document.getElementById('confirm').disabled")) === true);

  // 2. 确认落子
  await click("#confirm", "确认");
  check("确认后棋子移动到位", (await state("s.players[0].c === 0 && s.players[0].r === 10")) === true);
  check("行动后切换回合", (await state("s.turn === 1")) === true);

  // 橙方预选应使用橙色样式
  await click('.cell[data-c="9"][data-r="10"]', "J-11");
  check("橙方预选格带 p1 样式",
    (await evaluate("!!document.querySelector('.cell.preview.p1')")) === true);
  await click("#cancel", "取消");

  // 3. 封墙（棋盘中部，不是终点排）
  await click('.slot[data-kind="v"][data-c="0"][data-r="9"]', "墙 A-B-10");
  check("点击中部墙位生成预览", (await state("!!g.preview && g.preview.action.type === 'wall'")) === true);
  await click("#confirm", "确认");
  check("中部墙已放置", (await state("s.vWall[0 * 12 + 9] === 1")) === true);
  check("封墙计数 +1", (await state("s.wallsPlaced === 1")) === true);

  // 4. 已占用的墙位不响应
  const turnBefore = await state("s.turn");
  await click('.slot[data-kind="v"][data-c="0"][data-r="9"]', "已占用墙位");
  check("已占用墙位不响应",
    (await state("s.wallsPlaced === 1")) === true && (await state("s.turn")) === turnBefore);

  // 5. 非相邻格子不产生预览
  await click('.cell[data-c="5"][data-r="5"]', "远处格子");
  check("非相邻格子不产生预览", (await state("g.preview === null")) === true);

  // 6. 封顶（终点排）
  await click('.slot[data-kind="top"][data-c="2"]', "C 列顶端格线");
  check("点击顶端格线生成封顶预览",
    (await state("!!g.preview && g.preview.action.kind === 'top'")) === true);
  await click("#cancel", "取消");
  check("取消后预览清空", (await state("g.preview === null")) === true);

  // 列标签不再是墙位：站在别处时点击标签不应产生任何预览
  await click('.colSlot[data-c="4"]', "E 列标签");
  check("列标签不再作为墙位响应", (await state("g.preview === null")) === true);

  // 7. 重新开始（会弹确认框，脚本自动接受）
  await click("#restart", "重新开始");
  await sleep(200);
  check("重新开始后回到初始局面",
    (await state("s.plies === 0 && s.wallsPlaced === 0 && s.players[0].c === 0 && s.players[0].r === 11")) === true);

  // 8. 悔棋：只走一步时，对手也能撤回（这是之前静默失败的情况）
  await click('.cell[data-c="0"][data-r="10"]', "A-11");
  await click("#confirm", "确认");
  check("走一步后共 1 手", (await state("s.plies === 1")) === true);

  await click("#undo", "悔棋");
  check("悔棋弹出对方确认框", (await evaluate("!document.getElementById('undoOverlay').hidden")) === true);
  await click("#undoNo", "拒绝");
  check("对方拒绝后局面不变", (await state("s.plies === 1")) === true);

  await click("#undo", "悔棋");
  await click("#undoYes", "同意");
  await sleep(150);
  check("单步也能悔棋", (await state("s.plies === 0 && s.turn === 0")) === true);
  check("悔棋后棋子回位", (await state("s.players[0].c === 0 && s.players[0].r === 11")) === true);
  check("悔棋次数扣减到发起方", (await state("g.undoLeft[1] === 2")) === true);

  // 8b. 双方各走一步后，撤销最近一手
  await click('.cell[data-c="0"][data-r="10"]', "A-11");
  await click("#confirm", "确认");
  await click('.cell[data-c="9"][data-r="10"]', "J-11");
  await click("#confirm", "确认");
  check("双方各走一步后共 2 手", (await state("s.plies === 2")) === true);

  await click("#undo", "悔棋");
  await click("#undoYes", "同意");
  await sleep(150);
  check("撤销最近一手后剩 1 手", (await state("s.plies === 1 && s.turn === 1")) === true);
  check("被撤销的棋子回到原位", (await state("s.players[1].c === 9 && s.players[1].r === 11")) === true);

  // 9. 计时器在倒数（读取当前行棋方的计时块）
  const cur = await state("s.turn");
  const c0 = Number(await evaluate(`document.getElementById('clk${cur}').textContent`));
  await sleep(1300);
  const c1 = Number(await evaluate(`document.getElementById('clk${cur}').textContent`));
  check("计时器在倒数", c1 < c0, `${c0} → ${c1}`);

  // 10. 超时代走：把当前方本步与时间库清零，等待自动走子
  const pliesBefore = await state("s.plies");
  const turnBefore2 = await state("s.turn");
  await evaluate(`(() => {
    const g = window.__danteng;
    const t = g.state.turn;
    g.clocks.moveLeft = 0.2;
    g.clocks.banks[t] = 0;
    g.lastTs = performance.now();
  })()`);
  await sleep(900);
  check("超时后系统自动走了一步", (await state("s.plies")) === pliesBefore + 1);
  check("超时后切换到对方回合", (await state("s.turn")) === 1 - turnBefore2);

  // 11. 人机：从主菜单进入“人机 · 普通”
  await click("#homeBtn", "菜单");
  await sleep(250);
  await click("#menuAI", "人机对战");
  await click('.menuItem[data-level="normal"]', "普通");
  await sleep(150);
  check("进入人机模式", (await evaluate("window.__danteng.aiSeat !== null")) === true);
  const aiPlies = await state("s.plies");
  await click('.cell[data-c="0"][data-r="10"]', "A-11");
  await click("#confirm", "确认");
  await sleep(1400);
  check("人机模式电脑自动应手", (await state("s.plies")) === aiPlies + 2);
  check("电脑应手后轮回人类", (await state("s.turn")) === 0);

  // 12. 返回主菜单 + 设置
  await click("#homeBtn", "菜单");
  await sleep(250);
  check("可以返回主菜单",
    (await evaluate("!document.getElementById('homeOverlay').hidden")) === true
    && (await evaluate("window.__danteng.started")) === false);

  await click("#menuSettings", "设置");
  check("打开设置面板", (await evaluate("!document.getElementById('settingsOverlay').hidden")) === true);
  await evaluate(`(() => {
    document.getElementById('setMove').value = '40';
    document.getElementById('setBank').value = '200';
    document.getElementById('setUndo').value = '2';
  })()`);
  await click("#settingsSave", "保存");
  check("设置写入状态",
    (await evaluate("window.__danteng.settings.perMove")) === 40
    && (await evaluate("window.__danteng.settings.undoLimit")) === 2);

  await click("#menuLocal", "玩家对战");
  check("新局按设置初始化悔棋次数", (await evaluate("window.__danteng.undoLeft[0]")) === 2);
  const cNew = Number(await evaluate("document.getElementById('clk0').textContent"));
  check("新局按设置初始化计时", cNew >= 38 && cNew <= 40, `显示 ${cNew}`);

  // 13. 越线：站在第 1 行时，点自己的格子即可越线
  await evaluate(`(() => {
    const g = window.__danteng;
    g.state.players[0] = { c: 0, r: 0 };
    g.state.players[1] = { c: 9, r: 4 };
    g.state.turn = 0;
    g.state.topWall[0] = 0;
  })()`);
  await click('.cell[data-c="0"][data-r="0"]', "自己所在的格子");
  check("点自己的格子触发越线预览",
    (await state("g.preview && g.preview.action.dir === 'up'")) === true);
  await click("#confirm", "确认");
  await sleep(450);
  check("越线后判定获胜", (await state("s.winner === 0")) === true);
  check("结算页显示获胜",
    (await evaluate("document.getElementById('panelTitle').textContent")) === "左方获胜");

  // 14. 掷骰选边：移除“跳过掷骰”的注入脚本后重新加载
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await send("Page.navigate", { url: BASE });
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const ready = await evaluate("!!(window.__danteng && window.__danteng.state)").catch(() => false);
    if (ready) break;
  }
  await click("#menuLocal", "玩家对战");
  check("开局进入掷骰界面", (await evaluate("!document.getElementById('diceOverlay').hidden")) === true);

  let rolled = false;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    rolled = await evaluate("!!document.querySelector('#diceChoices [data-priority]')");
    if (rolled) break;
  }
  check("掷骰后出现“先手 / 选边”选项", rolled);

  // 大点者选“先手”：小点者去选边
  const chooser = await evaluate("window.__danteng.diceChooser");
  await click('[data-priority="first"]', "我要先手");
  check("选先手后由对方选边", (await evaluate("!!document.querySelector('#diceChoices [data-side]')")) === true);
  check("先手方是大点者", (await evaluate("window.__danteng.diceFirstPerson")) === chooser);

  await click('[data-side="0"]', "执左");
  await sleep(120);
  check("选边后进入对局", (await evaluate("window.__danteng.started")) === true);
  check("先手方执右（对方选了左）", (await state("s.turn")) === 1);

  // 再开一局，测“我要选边”分支
  await send("Page.navigate", { url: BASE });
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const ready = await evaluate("!!(window.__danteng && window.__danteng.state)").catch(() => false);
    if (ready) break;
  }
  await click("#menuLocal", "玩家对战");
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    rolled = await evaluate("!!document.querySelector('#diceChoices [data-priority]')");
    if (rolled) break;
  }
  await click('[data-priority="side"]', "我要选边");
  check("选边分支由自己选边", (await evaluate("!!document.querySelector('#diceChoices [data-side]')")) === true);
  const chooser2 = await evaluate("window.__danteng.diceChooser");
  check("选边时先手是对方", (await evaluate("window.__danteng.diceFirstPerson")) !== chooser2);
  await click('[data-side="0"]', "执左");
  await sleep(120);
  check("先手方执右（自己选了左）", (await state("s.turn")) === 1);

  // 15. 所有模式都有认输：本地局点两次即可结束
  check("对局中显示认输按钮", (await evaluate("!document.getElementById('resign').hidden")) === true);
  await click("#resign", "认输");
  await click("#resign", "认输");
  await sleep(500);
  check("认输后结束对局", (await evaluate("window.__danteng.gameOver")) === true);
  check("结算页说明是认输",
    (await evaluate("document.getElementById('panelDesc').textContent")).includes("认输"));

  ws.close();
} catch (e) {
  check("执行过程", false, e.message);
} finally {
  proc.kill();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exitCode = 1;
}
