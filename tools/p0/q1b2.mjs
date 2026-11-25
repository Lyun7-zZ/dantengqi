/**
 * Q1b-2：全前缀重放（RNG + 计划/历史）与失败局决策复现。
 * 只做诊断，不改 A1 决策逻辑。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createState, applyAction } from "../../src/rules.js";
import { createMasterAI } from "../../src/ai-master.js";
import { createHellConfig } from "../../src/hell-config.js";
import { replayOpening, makeRng } from "./lib.mjs";

const DIR = "_extract/p0";
const OUT = `${DIR}/q1b2`;
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(`${DIR}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const a0 = load("03_games_raw_A0e.jsonl");
const a1 = load("03_games_raw_A1e.jsonl");
const openings = load("openings.jsonl");
const opMap = new Map(openings.map((o) => [o.id, o]));
const idx = (rs) => new Map(rs.map((r) => [`${r.openingId}-${r.seat}`, r]));
const i0 = idx(a0), i1 = idx(a1);

const gmCfg = {
  timeMs: 3000, maxDepth: 7, usePlan: true, netWalls: true,
  avoidRepeat: true, repeatPenalty: 160, planMoves: true, planFallback: true,
  necessaryPathGuard: "soft", endgameDepth: 9,
};

function firstDivergence(r0, r1) {
  let s = replayOpening(opMap.get(r0.openingId).actions);
  let i = 0;
  while (i < r0.actions.length && i < r1.actions.length &&
         JSON.stringify(r0.actions[i]) === JSON.stringify(r1.actions[i])) {
    const r = applyAction(s, r0.actions[i]);
    s = r.state; i++;
  }
  return { state: s, index: i };
}

/**
 * 全前缀重放：逐步调用当方 AI（保持 RNG/计划/历史），但执行记录动作；
 * 在分歧点调用 AI 并记录实际选择。
 */
function replayPrefix(rec, divIndex, routeWalls) {
  const hellCfg = createHellConfig({ timeMs: 28000, routeWalls });
  const hell = createMasterAI(hellCfg);
  const gm = createMasterAI(gmCfg);
  const rng = makeRng(rec.seed);
  let s = replayOpening(opMap.get(rec.openingId).actions);
  const hellSeat = rec.seat;
  for (let i = 0; i < divIndex; i++) {
    const ai = s.turn === hellSeat ? hell : gm;
    ai(s, rng); // 保持内部状态与 RNG 消耗
    const r = applyAction(s, rec.actions[i]);
    if (!r.ok) throw new Error("replay illegal at " + i);
    s = r.state;
  }
  const ai = s.turn === hellSeat ? hell : gm;
  const chosen = ai(s, rng);
  const log = ai.stats?.lastLog ?? {};
  return {
    chosen, recorded: rec.actions[divIndex],
    match: JSON.stringify(chosen) === JSON.stringify(rec.actions[divIndex]),
    source: log.source, depth: log.depthLast ?? log.depth, nodes: log.nodes,
    tTotal: log.tTotal, candidateCount: log.candidateCount,
    routeCutAdded: log.routeCutAdded, stateHash: JSON.stringify(s.players) + "|" + s.plies,
  };
}

const plan = [
  { key: "23-0", runs: 3 },
  { key: "22-1", runs: 3 },
  { key: "13-0", runs: 3 },
  { key: "20-0", runs: 1 },
];

const results = [];
for (const p of plan) {
  const r0 = i0.get(p.key), r1 = i1.get(p.key);
  const d = firstDivergence(r0, r1);
  for (let k = 0; k < p.runs; k++) {
    const routeWalls = 6;
    const t0 = Date.now();
    const r = replayPrefix(r1, d.index, routeWalls);
    results.push({ key: p.key, run: k, divIndex: d.index, routeWalls,
      elapsed: Math.round((Date.now() - t0) / 1000), ...r });
    console.log(p.key, k, r.match ? "MATCH" : "DIFF", "div", d.index, "t", r.tTotal, r.elapsed + "s");
  }
}

// 18-1 对齐：找最后共同可行动作
function alignTerminal(r0, r1) {
  let s = replayOpening(opMap.get(r0.openingId).actions);
  const n = Math.min(r0.actions.length, r1.actions.length);
  let i = 0;
  while (i < n && JSON.stringify(r0.actions[i]) === JSON.stringify(r1.actions[i])) {
    const r = applyAction(s, r0.actions[i]);
    s = r.state; i++;
    if (s.winner !== null) break;
  }
  return { commonPrefix: i, state: { ply: s.plies, turn: s.turn, winner: s.winner, players: s.players },
    lenA0: r0.actions.length, lenA1: r1.actions.length };
}
const t18 = alignTerminal(i0.get("18-1"), i1.get("18-1"));

writeFileSync(`${OUT}/replay_attempts.jsonl`, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(`${OUT}/terminal_alignment.json`, JSON.stringify(t18, null, 1));
const summary = {
  cases: plan.map((p) => {
    const rs = results.filter((r) => r.key === p.key);
    return { key: p.key, divIndex: rs[0]?.divIndex, runs: rs.length,
      matches: rs.filter((r) => r.match).length,
      chosen: rs.map((r) => r.chosen), recorded: rs[0]?.recorded,
      depth: rs.map((r) => r.depth), tTotal: rs.map((r) => r.tTotal),
      elapsed: rs.map((r) => r.elapsed) };
  }),
  terminal18: t18,
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
