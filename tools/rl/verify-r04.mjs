/**
 * R0-4：随机可达状态对拍 + 终局行为。
 * 用法：node tools/rl/verify-r04.mjs [目标状态数]
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createState, applyAction, validateAction } from "../../src/rules.js";
import { decode, N_ACTIONS } from "./actions.mjs";

const TARGET = Number(process.argv[2] || 1000);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "env-server.mjs");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    wallsUsed: s.wallsUsed.slice(),
    tolerance: s.tolerance,
    drawMode: s.drawMode,
    winner: s.winner,
  };
}

function directMask(s) {
  const m = new Array(N_ACTIONS).fill(0);
  for (let i = 0; i < N_ACTIONS; i++) if (validateAction(s, decode(i)).ok) m[i] = 1;
  return m;
}

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

const rng = mulberry32(20261122);
const states = [];
let games = 0, terminalStates = 0;

while (states.length < TARGET && games < 400) {
  games++;
  let s = createState(games % 2, { drawMode: "firstOnly" });
  for (let ply = 0; ply < 240; ply++) {
    if (s.winner !== null) { terminalStates++; break; }
    if (rng() < 0.15 && states.length < TARGET) states.push(snapshot(s));
    const m = directMask(s);
    const legal = [];
    for (let i = 0; i < N_ACTIONS; i++) if (m[i]) legal.push(i);
    if (!legal.length) break;
    const idx = legal[Math.floor(rng() * legal.length)];
    const r = applyAction(s, decode(idx));
    if (!r.ok) break;
    s = r.state;
  }
}

let maskDiff = 0, terminalBad = 0, illegalAccepted = 0;
for (let k = 0; k < states.length; k++) {
  const st = states[k];
  const s = createState(st.firstPlayer, { drawMode: "firstOnly" });
  s.vWall.set(st.vWall); s.hWall.set(st.hWall); s.topWall.set(st.topWall);
  s.players = st.players.map((p) => ({ c: p.c, r: p.r }));
  s.turn = st.turn; s.firstPlayer = st.firstPlayer; s.wallsPlaced = st.wallsPlaced;
  s.wallLimit = st.wallLimit.slice(); s.wallsUsed = st.wallsUsed.slice();
  s.tolerance = st.tolerance; s.drawMode = st.drawMode; s.winner = st.winner;

  const res = await call("mask", { state: st });
  if (!res.ok) throw new Error(res.error);
  const dm = directMask(s);
  for (let i = 0; i < N_ACTIONS; i++) if (dm[i] !== res.mask[i]) { maskDiff++; break; }
  if (s.winner !== null && res.mask.some((v) => v === 1)) terminalBad++;

  // 非法动作必须被拒绝且不改变状态
  const badIdx = dm.findIndex((v) => v === 0);
  if (badIdx >= 0) {
    const r = await call("step", { state: st, index: badIdx });
    if (r.ok) illegalAccepted++;
  }
}

// 显式终局：掩码必须全 0，step 必须拒绝
let terminalCases = 0, terminalCaseBad = 0;
for (const w of [0, 1, "draw"]) {
  const s = createState(0, { drawMode: "firstOnly" });
  s.winner = w;
  const st = snapshot(s);
  const m = await call("mask", { state: st });
  terminalCases++;
  if (!m.ok || m.mask.some((v) => v === 1)) terminalCaseBad++;
  const r = await call("step", { state: st, index: 0 });
  if (r.ok) terminalCaseBad++;
}

child.stdin.end();
child.kill();

console.log(`随机对局 ${games}，抽样状态 ${states.length}，含终局 ${terminalStates}`);
console.log(`掩码差异：${maskDiff}`);
console.log(`终局仍有合法动作：${terminalBad}`);
console.log(`非法动作被接受：${illegalAccepted}`);
console.log(`显式终局 ${terminalCases} 个，异常 ${terminalCaseBad}`);
const ok = maskDiff === 0 && terminalBad === 0 && illegalAccepted === 0 && terminalCaseBad === 0;
console.log(ok ? "R0-4 通过" : "R0-4 未通过");
process.exit(ok ? 0 : 1);
