/**
 * R0-3：202 局逐手对拍（直调 vs 桥接）+ 边界案例。
 *
 * 用法：node tools/rl/verify-r03.mjs
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createState, applyAction, validateAction, legalActions, setWall } from "../../src/rules.js";
import { decode, encode, N_ACTIONS } from "./actions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "env-server.mjs");

function snapshot(s) {
  return {
    vWall: Array.from(s.vWall),
    hWall: Array.from(s.hWall),
    topWall: Array.from(s.topWall),
    players: s.players.map((p) => ({ c: p.c, r: p.r })),
    turn: s.turn,
    firstPlayer: s.firstPlayer,
    wallsPlaced: s.wallsPlaced,
    wallLimit: s.wallLimit.map((v) => (Number.isFinite(v) ? v : 9999)),
    wallsUsed: s.wallsUsed,
    tolerance: s.tolerance,
    drawMode: s.drawMode,
    winner: s.winner,
  };
}

function restore(st) {
  const s = createState(st.firstPlayer ?? 0, { drawMode: "firstOnly" });
  s.vWall.set(st.vWall);
  s.hWall.set(st.hWall);
  s.topWall.set(st.topWall);
  s.players = st.players.map((p) => ({ c: p.c, r: p.r }));
  s.turn = st.turn;
  s.firstPlayer = st.firstPlayer ?? 0;
  s.wallsPlaced = st.wallsPlaced ?? 0;
  s.winner = st.winner ?? null;
  s.wallLimit = Array.isArray(st.wallLimit) ? st.wallLimit.map((v) => (Number.isFinite(v) ? v : 9999)) : [9999, 9999];
  s.wallsUsed = Array.isArray(st.wallsUsed) ? [st.wallsUsed[0], st.wallsUsed[1]] : [0, 0];
  s.tolerance = st.tolerance ?? 1;
  s.drawMode = st.drawMode ?? "firstOnly";
  return s;
}

function directMask(s) {
  const m = new Array(N_ACTIONS).fill(0);
  for (let i = 0; i < N_ACTIONS; i++) if (validateAction(s, decode(i)).ok) m[i] = 1;
  return m;
}

function eqMask(a, b) {
  for (let i = 0; i < N_ACTIONS; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- 边界案例 ----
function boundaryCases() {
  const cases = [];
  const base = () => createState(0, { drawMode: "firstOnly" });

  // 1) 出界走子（最左列向左）
  {
    const s = base();
    s.players[0] = { c: 0, r: 0 };
    cases.push({ name: "出界走子（最左列向左）", state: s, index: encode({ type: "move", dir: "left" }), expect: false });
  }
  // 2) 墙已存在
  {
    const s = base();
    setWall(s, "v", 1, 5);
    cases.push({ name: "重复放墙", state: s, index: encode({ type: "wall", kind: "v", c: 1, r: 5 }), expect: false });
  }
  // 3) 封死唯一出口（只剩 col 5，顶部封口会归零）
  {
    const s = base();
    for (let c = 0; c < 10; c++) s.topWall[c] = c === 5 ? 0 : 1;
    s.players[0] = { c: 5, r: 0 };
    cases.push({ name: "封死唯一出口", state: s, index: encode({ type: "wall", kind: "top", c: 5 }), expect: false });
  }
  // 4) 顶部封口是棋盘墙，任意位置可放（合法）
  {
    const s = base();
    s.players[0] = { c: 5, r: 5 };
    cases.push({ name: "顶部封口（规则允许）", state: s, index: encode({ type: "wall", kind: "top", c: 5 }), expect: true });
  }
  // 5) 墙数用尽
  {
    const s = base();
    s.wallLimit = [0, 0];
    s.wallsUsed = [0, 0];
    cases.push({ name: "墙数用尽仍尝试放墙", state: s, index: encode({ type: "wall", kind: "v", c: 2, r: 2 }), expect: false });
  }
  // 6) 合法走子
  {
    const s = base();
    cases.push({ name: "合法走子（向上）", state: s, index: encode({ type: "move", dir: "up" }), expect: true });
  }
  // 7) 合法放墙
  {
    const s = base();
    cases.push({ name: "合法放墙", state: s, index: encode({ type: "wall", kind: "v", c: 2, r: 2 }), expect: true });
  }
  return cases;
}

// ---- IPC ----
const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: child.stdout, terminal: false });
let seq = 0;
const pending = new Map();
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  const p = pending.get(msg.id);
  if (p) { pending.delete(msg.id); p(msg); }
});
function call(op, payload = {}) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ id, op, ...payload }) + "\n");
  });
}
await call("ping");

// 边界案例
let boundaryFail = 0;
for (const c of boundaryCases()) {
  const st = snapshot(c.state);
  const m = await call("mask", { state: st });
  if (!m.ok) throw new Error("mask failed: " + m.error);
  const got = m.mask[c.index] === 1;
  if (got !== c.expect) {
    boundaryFail++;
    console.log(`✗ 边界失败：${c.name}，期望 ${c.expect}，实际 ${got}`);
  }
}
console.log(`边界案例：${boundaryCases().length} 个，失败 ${boundaryFail}`);

// ---- 202 局逐手 ----
const lines = readFileSync("_extract/sp2/all.jsonl", "utf8").split("\n").filter(Boolean);
const games = new Map();
for (const line of lines) {
  const r = JSON.parse(line);
  if (!games.has(r.g)) games.set(r.g, []);
  if (!("result" in r)) games.get(r.g).push(r);
}

let plies = 0, maskDiff = 0, stepDiff = 0, stepChecked = 0, encodedBad = 0;
let legalSupersetBad = 0;
for (const [gid, moves] of games) {
  if (!moves.length) continue;
  let s = createState(moves[0].first, { drawMode: "firstOnly" });
  for (const mv of moves) {
    const st = snapshot(s);
    const m = await call("mask", { state: st });
    if (!m.ok) throw new Error("mask failed: " + m.error);
    const dm = directMask(s);
    if (!eqMask(dm, m.mask)) maskDiff++;
    plies++;

    // legalActions 的每一项都必须能编码且落在掩码内
    for (const la of legalActions(s)) {
      const idx = encode(la);
      if (!Number.isInteger(idx) || idx < 0 || idx >= N_ACTIONS) { encodedBad++; continue; }
      if (dm[idx] !== 1) legalSupersetBad++;
    }

    // 抽样比较 step 状态
    if (mv.ply % 10 === 0) {
      for (let i = 0; i < N_ACTIONS; i++) {
        if (!dm[i]) continue;
        const r1 = applyAction(s, decode(i));
        if (!r1.ok) continue;
        const r2 = await call("step", { state: st, index: i });
        if (!r2.ok) { stepDiff++; continue; }
        const h1 = JSON.stringify(snapshot(r1.state));
        const h2 = JSON.stringify(r2.state);
        if (h1 !== h2) stepDiff++;
        stepChecked++;
      }
    }
    const r = applyAction(s, mv.action);
    if (!r.ok) break;
    s = r.state;
  }
}

child.stdin.end();
child.kill();

console.log(`对局 ${games.size}，逐手 ${plies}`);
console.log(`掩码差异：${maskDiff}`);
console.log(`legalActions 编码异常：${encodedBad}，不在掩码内：${legalSupersetBad}`);
console.log(`step 抽样 ${stepChecked} 次，差异：${stepDiff}`);
const ok = maskDiff === 0 && stepDiff === 0 && encodedBad === 0 && boundaryFail === 0;
console.log(ok ? "R0-3 通过" : "R0-3 未通过");
process.exit(ok ? 0 : 1);
