/**
 * 镜像实验室：你执先手，电脑执后手，电脑用「镜像策略」应手。
 *
 * 运行：
 *   node tools/mirror-lab.mjs
 *
 * 目的：验证「后手镜像 ⇒ 先手赢不了」。
 * 电脑会把你的每一步沿中线镜像：
 *   走子：左右互换
 *   竖墙：c -> 8-c
 *   横墙：c -> 9-c
 *   顶部封口：c -> 9-c
 * 镜像非法时（例如你封了中线那面竖墙），退回贪心应手。
 *
 * 命令：
 *   u / d / l / r        走一步
 *   w v <c> <r>          竖墙：c 0..8，r 0..11
 *   w h <c> <r>          横墙：c 0..9，r 0..10
 *   w t <c>              顶部封口：c 0..9
 *   help / quit
 */

import {
  createState, applyAction, validateAction, distanceOf, legalDirs, wallPlaced,
} from "../src/rules.js";
import { allWallSlots, COL_NAMES, ROWS, wallName } from "../src/board.js";

const COLS = 10;
const ME = 0;      // 你：先手
const BOT = 1;     // 电脑：后手

let state = createState(ME, { drawMode: "firstOnly" });
let lastAction = null;
let mirrored = 0;
let fallback = 0;

const DIR_WORD = { up: "向上", down: "向下", left: "向左", right: "向右" };

function cellAt(c, r) {
  if (state.players[0].c === c && state.players[0].r === r) return " ●  ";
  if (state.players[1].c === c && state.players[1].r === r) return " ○  ";
  return "    ";
}

function vBar(c, r) {
  if (c === 0) return "│";
  const on = state.vWall[(c - 1) * ROWS + r] === 1;
  return on ? "┃" : "│";
}

function hBar(c, r) {
  const on = r < ROWS - 1 && state.hWall[c * (ROWS - 1) + r] === 1;
  return on ? "━━━━" : "────";
}

function render() {
  const lines = [];
  lines.push("      " + Array.from(COL_NAMES).slice(0, COLS).map((n) => n.padEnd(5)).join(""));
  const topSeg = [];
  for (let c = 0; c < COLS; c++) topSeg.push(state.topWall[c] ? "████" : "┄┄┄┄");
  lines.push("    ┌" + topSeg.join("┬") + "┐");
  for (let r = 0; r < ROWS; r++) {
    let line = " " + String(r + 1).padStart(2) + " │";
    for (let c = 0; c < COLS; c++) {
      line += cellAt(c, r) + vBar(c + 1, r);
    }
    lines.push(line);
    if (r < ROWS - 1) {
      let bar = "    ├";
      for (let c = 0; c < COLS; c++) bar += hBar(c, r) + (c < COLS - 1 ? "┼" : "┤");
      lines.push(bar);
    }
  }
  const botSeg = [];
  for (let c = 0; c < COLS; c++) botSeg.push("────");
  lines.push("    └" + botSeg.join("┴") + "┘");
  lines.push(`  你 ●（先手）  电脑 ○（后手）  手数 ${state.plies}  距离 ${distanceOf(state, 0)} : ${distanceOf(state, 1)}`);
  return lines.join("\n");
}

function mirrorOf(a) {
  if (!a) return null;
  if (a.type === "move") {
    const dir = a.dir === "left" ? "right" : a.dir === "right" ? "left" : a.dir;
    return { type: "move", dir };
  }
  if (a.kind === "v") return { type: "wall", kind: "v", c: COLS - 2 - a.c, r: a.r };
  if (a.kind === "h") return { type: "wall", kind: "h", c: COLS - 1 - a.c, r: a.r };
  if (a.kind === "top") return { type: "wall", kind: "top", c: COLS - 1 - a.c, r: 0 };
  return null;
}

function greedyZ() {
  const me = state.turn;
  let best = -Infinity;
  let pool = [];
  const tryA = (a) => {
    const r = applyAction(state, a);
    if (!r.ok) return;
    const z = distanceOf(r.state, 1 - me) - distanceOf(r.state, me);
    if (z > best) { best = z; pool = [a]; }
    else if (z === best) pool.push(a);
  };
  const p = state.players[me];
  for (const dir of legalDirs(state, p.c, p.r)) tryA({ type: "move", dir });
  for (const w of allWallSlots()) {
    if (wallPlaced(state, w.kind, w.c, w.r)) continue;
    const a = { type: "wall", kind: w.kind, c: w.c, r: w.r };
    if (validateAction(state, a).ok) tryA(a);
  }
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function describe(a) {
  if (a.type === "move") return `走子${DIR_WORD[a.dir] || a.dir}`;
  return `封墙 ${wallName(a.kind, a.c, a.r)}`;
}

function apply(a) {
  const r = applyAction(state, a);
  if (!r.ok) return false;
  state = r.state;
  return true;
}

function checkEnd() {
  if (state.winner === null) return false;
  const w = state.winner;
  console.log("\n" + render());
  if (w === "draw") console.log("\n结果：平局");
  else if (w === ME) console.log("\n结果：你赢了");
  else console.log("\n结果：电脑赢了");
  console.log(`镜像成功 ${mirrored} 次，退化 ${fallback} 次`);
  return true;
}

function botTurn() {
  const cand = mirrorOf(lastAction);
  let action = null;
  if (cand && validateAction(state, cand).ok) {
    action = cand;
    mirrored++;
    console.log(`\n电脑（镜像）：${describe(action)}`);
  } else {
    action = greedyZ();
    fallback++;
    console.log(`\n电脑（镜像不可用，退化为贪心）：${action ? describe(action) : "无"}`);
  }
  if (!action) return false;
  apply(action);
  return true;
}

function help() {
  console.log(`
命令：
  u / d / l / r       走一步（上/下/左/右）
  w v <c> <r>         竖墙（c 0-8，r 0-11）
  w h <c> <r>         横墙（c 0-9，r 0-10）
  w t <c>             顶部封口（c 0-9）
  help / quit
坐标从 0 开始；棋盘上方一排 ████ 表示该列已被封顶。`);
}

console.log("镜像实验室：你执先手（●），电脑执后手（○）并用镜像应手。输入 help 看命令。\n");
console.log(render());
help();

const rl = (await import("node:readline/promises")).createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(prompt) {
  return new Promise((resolve) => {
    let done = false;
    const onClose = () => {
      if (done) return;
      done = true;
      resolve(null);
    };
    rl.once("close", onClose);
    rl.question(prompt).then((v) => {
      if (done) return;
      done = true;
      rl.off("close", onClose);
      resolve(v);
    });
  });
}

while (state.winner === null) {
  const answer = await ask("\n你的操作 > ");
  if (answer === null) break;
  const raw = answer.trim().toLowerCase();
  if (!raw) continue;
  if (raw === "quit" || raw === "exit") break;
  if (raw === "help") { help(); continue; }

  let action = null;
  if (["u", "d", "l", "r"].includes(raw)) {
    action = { type: "move", dir: { u: "up", d: "down", l: "left", r: "right" }[raw] };
  } else if (raw.startsWith("w")) {
    const parts = raw.split(/\s+/);
    if (parts[1] === "v" || parts[1] === "h") {
      action = { type: "wall", kind: parts[1], c: Number(parts[2]), r: Number(parts[3]) };
    } else if (parts[1] === "t") {
      action = { type: "wall", kind: "top", c: Number(parts[2]), r: 0 };
    }
  }
  if (!action) { console.log("看不懂，输入 help"); continue; }

  const check = validateAction(state, action);
  if (!check.ok) { console.log(`这一步不合法：${check.error}`); continue; }

  apply(action);
  lastAction = action;
  console.log(render());
  if (checkEnd()) break;

  botTurn();
  console.log(render());
  if (checkEnd()) break;
}

rl.close();
