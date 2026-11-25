/**
 * Q1b：失败局同状态重放与反事实对照（不改 A1 决策代码）。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction } from "../../src/rules.js";
import { createMasterAI } from "../../src/ai-master.js";
import { createHellConfig } from "../../src/hell-config.js";
import { replayOpening, makeRng } from "./lib.mjs";

const DIR = "_extract/p0";
const OUT = `${DIR}/q1b`;
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(`${DIR}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const a0 = load("03_games_raw_A0e.jsonl");
const a1 = load("03_games_raw_A1e.jsonl");
const openings = load("openings.jsonl");
const opMap = new Map(openings.map((o) => [o.id, o]));
const idx0 = new Map(a0.map((r) => [`${r.openingId}-${r.seat}`, r]));
const idx1 = new Map(a1.map((r) => [`${r.openingId}-${r.seat}`, r]));

const bad = a1.filter((r) => r.result === "hell_loss" || r.result === "unfinished");
const controls = [
  idx1.get("11-1"), idx1.get("12-1"), idx1.get("14-0"), idx1.get("21-0"),
].filter(Boolean);

function hashState(s) {
  const h = createHash("sha256");
  h.update(JSON.stringify({
    v: Array.from(s.vWall), h: Array.from(s.hWall), t: Array.from(s.topWall),
    p: s.players, turn: s.turn, wp: s.wallsPlaced, wu: s.wallsUsed,
  }));
  return h.digest("hex").slice(0, 16);
}

function firstDivergence(r0, r1) {
  const op = opMap.get(r0.openingId);
  let s = replayOpening(op.actions);
  let i = 0;
  while (i < r0.actions.length && i < r1.actions.length &&
         JSON.stringify(r0.actions[i]) === JSON.stringify(r1.actions[i])) {
    const r = applyAction(s, r0.actions[i]);
    s = r.state; i++;
  }
  return { state: s, index: i, a0: r0.actions[i], a1: r1.actions[i] };
}

function run(cfg, state, seed) {
  const ai = createMasterAI(cfg);
  ai.reset();
  const before = hashState(state);
  const a = ai(state, makeRng(seed));
  const log = ai.stats?.lastLog ?? {};
  return {
    action: a, stateHash: before, source: log.source, depth: log.depthLast ?? log.depth,
    nodes: log.nodes, tTotal: log.tTotal, tPlan: log.tPlan, tCandidate: log.tCandidate,
    tOrder: log.tOrder, tSearch: log.tSearch, candidateCount: log.candidateCount,
    routeCutAdded: log.routeCutAdded, searchedCount: log.searchedCount, abort: log.abort,
  };
}

const hell = createHellConfig();
const a0Cfg = createHellConfig({ routeWalls: 3 });
const a1Cfg = createHellConfig({ routeWalls: 6 });

const rows = [];
for (const rec of [...bad, ...controls]) {
  const key = `${rec.openingId}-${rec.seat}`;
  const r0 = idx0.get(key), r1 = idx1.get(key);
  const d = firstDivergence(r0, r1);
  const state = d.state;
  const legalCount = (() => {
    // 通过一次不修改的枚举统计合法数
    let n = 0;
    const s = state;
    // 使用 applyAction 试探全部动作
    for (let i = 0; i < 232; i++) {
      const a = decode(i);
      if (applyAction(s, a).ok) n++;
    }
    return n;
  })();
  const runs = { a0: [], a1: [] };
  for (let k = 0; k < 3; k++) {
    runs.a0.push(run(a0Cfg, state, 9000 + k));
    runs.a1.push(run(a1Cfg, state, 9100 + k));
  }
  // 固定深度对照（各自配置，depth 6，给足时间）
  const fixed0 = run({ ...a0Cfg, timeMs: 120000, maxDepth: 6 }, state, 9200);
  const fixed1 = run({ ...a1Cfg, timeMs: 120000, maxDepth: 6 }, state, 9201);
  rows.push({
    key, result: rec.result, openingId: rec.openingId, seat: rec.seat,
    divergenceIndex: d.index, gameA0: d.a0, gameA1: d.a1,
    stateHash: hashState(state),
    state: {
      ply: state.plies, turn: state.turn, players: state.players,
      exits: state.topWall.filter((v) => v === 0).length, wallsPlaced: state.wallsPlaced,
      wallsUsed: state.wallsUsed,
    },
    legalCount, runs, fixed: { a0: fixed0, a1: fixed1 },
  });
  console.log("done", key, rec.result);
}

writeFileSync(`${OUT}/failure_replay.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(`${OUT}/failure_summary.json`, JSON.stringify(rows.map((r) => ({
  key: r.key, result: r.result, divergenceIndex: r.divergenceIndex,
  gameA0: r.gameA0, gameA1: r.gameA1,
  a0Actions: r.runs.a0.map((x) => x.action),
  a1Actions: r.runs.a1.map((x) => x.action),
  a0Sources: r.runs.a0.map((x) => x.source),
  a1Sources: r.runs.a1.map((x) => x.source),
  fixedA0: r.fixed.a0.action, fixedA1: r.fixed.a1.action,
})), null, 1));
console.log("rows", rows.length);

function decode(i) {
  if (i < 4) return { type: "move", dir: ["up", "down", "left", "right"][i] };
  if (i < 112) { const k = i - 4; return { type: "wall", kind: "v", c: Math.floor(k / 12), r: k % 12 }; }
  if (i < 222) { const k = i - 112; return { type: "wall", kind: "h", c: Math.floor(k / 11), r: k % 11 }; }
  return { type: "wall", kind: "top", c: i - 222, r: 0 };
}
