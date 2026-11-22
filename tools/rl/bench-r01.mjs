/**
 * R0-1 基准：JS 进程内 vs 常驻服务 IPC 的状态转换 / 掩码 / 序列化耗时。
 *
 * 用法：node tools/rl/bench-r01.mjs [样本数]
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createState, applyAction, validateAction } from "../../src/rules.js";
import { decode, encode, selfTest, N_ACTIONS } from "./actions.mjs";

const SAMPLES = Number(process.argv[2] || 120);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "env-server.mjs");

const errors = selfTest();
if (errors.length) {
  console.error("动作编码双射失败：", errors.slice(0, 3));
  process.exit(1);
}

function replayStates(path, want) {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const games = new Map();
  for (const line of lines) {
    const r = JSON.parse(line);
    if (!games.has(r.g)) games.set(r.g, []);
    if (!("result" in r)) games.get(r.g).push(r);
  }
  const states = [];
  const plies = new Set([10, 30, 50, 70, 90, 110]);
  for (const [, moves] of games) {
    if (states.length >= want) break;
    if (!moves.length) continue;
    let s = createState(moves[0].first, { drawMode: "firstOnly" });
    for (const m of moves) {
      if (plies.has(m.ply) && states.length < want) states.push(snapshot(s));
      const r = applyAction(s, m.action);
      if (!r.ok) break;
      s = r.state;
    }
  }
  return states;
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
  return s;
}

function stats(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const med = a[Math.floor(a.length / 2)] ?? 0;
  const p95 = a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] ?? 0;
  const avg = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return { avg, med, p95, max: a[a.length - 1] ?? 0 };
}

function inProcessMask(state) {
  let n = 0;
  for (let i = 0; i < N_ACTIONS; i++) {
    if (validateAction(state, decode(i)).ok) n++;
  }
  return n;
}

const states = replayStates("_extract/sp2/all.jsonl", SAMPLES);
if (states.length < 10) {
  console.error("样本不足");
  process.exit(1);
}
console.log(`样本 ${states.length} 个局面（来自已重放的 202 局）`);

// ---- 进程内 ----
const maskMs = [];
const stepMs = [];
let jsonBytes = 0;
for (const st of states) {
  const s = restore(st);
  let t0 = performance.now();
  inProcessMask(s);
  maskMs.push(performance.now() - t0);

  const legal = decode(
    (() => {
      for (let i = 0; i < N_ACTIONS; i++) if (validateAction(s, decode(i)).ok) return i;
      return 0;
    })(),
  );
  t0 = performance.now();
  applyAction(s, legal);
  stepMs.push(performance.now() - t0);
  jsonBytes += Buffer.byteLength(JSON.stringify(st));
}

// ---- IPC ----
const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: child.stdout, terminal: false });
let seq = 0;
const pending = new Map();
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  const p = pending.get(msg.id);
  if (p) {
    pending.delete(msg.id);
    p(msg);
  }
});

function call(op, payload = {}) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ id, op, ...payload }) + "\n");
  });
}

await call("ping");
const ipcMaskMs = [];
const ipcStepMs = [];
for (const st of states) {
  let t0 = performance.now();
  const m = await call("mask", { state: st });
  ipcMaskMs.push(performance.now() - t0);
  if (!m.ok) throw new Error("mask failed: " + m.error);

  let idx = -1;
  for (let i = 0; i < N_ACTIONS; i++) if (m.mask[i]) { idx = i; break; }
  t0 = performance.now();
  const r = await call("step", { state: st, index: idx });
  ipcStepMs.push(performance.now() - t0);
  if (!r.ok) throw new Error("step failed: " + r.error);
}

// 批量：100 个 mask 请求一次性发出
const batchStart = performance.now();
const batch = [];
for (let i = 0; i < 100; i++) {
  const st = states[i % states.length];
  batch.push(call("mask", { state: st }));
}
await Promise.all(batch);
const batchTotal = performance.now() - batchStart;

child.stdin.end();
child.kill();

const f = (x) => `${x.avg.toFixed(2)} / ${x.med.toFixed(2)} / ${x.p95.toFixed(2)} / ${x.max.toFixed(2)}`;
console.log("\n单位：毫秒（平均 / 中位 / P95 / 最大）");
console.log("进程内 掩码232 :", f(stats(maskMs)));
console.log("进程内 单步转换 :", f(stats(stepMs)));
console.log("IPC    掩码232 :", f(stats(ipcMaskMs)));
console.log("IPC    单步转换 :", f(stats(ipcStepMs)));
console.log(`IPC    批量100次掩码总耗时：${batchTotal.toFixed(0)}ms（${(batchTotal / 100).toFixed(2)}ms/次）`);
console.log(`状态 JSON 平均大小：${(jsonBytes / states.length / 1024).toFixed(1)} KB`);

const ipcShare = (stats(ipcMaskMs).med - stats(maskMs).med) / stats(ipcMaskMs).med;
console.log(`\nIPC 在掩码往返中的占比（中位）：${(ipcShare * 100).toFixed(0)}%`);
console.log(`单 worker 估算：掩码 ${(1000 / stats(ipcMaskMs).med).toFixed(0)} 次/秒，单步 ${(1000 / stats(ipcStepMs).med).toFixed(0)} 步/秒`);
