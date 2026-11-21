/**
 * 计划层消融：地狱（带计划） vs 地狱（关闭计划），座位分离 + 随机开局。
 * 用法：node tools/plan-ab.mjs [预算ms] [每座位局数]
 */

import { createMasterAI } from "../src/ai-master.js";
import {
  createState, applyAction, legalDirs, validateAction,
} from "../src/rules.js";
import { shortestPathWalls } from "../src/path.js";

const BUDGET = Number(process.argv[2] || 800);
const PER_SEAT = Number(process.argv[3] || 4);
const SEED_BASE = Number(process.argv[4] || 5000);

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = {
  timeMs: BUDGET, maxDepth: 12,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  endgameDepth: 12, routeWalls: 3, smartExit: true,
};
const withPlan = createMasterAI({
  ...base, usePlan: true, planMoves: true, planFallback: true, necessaryPathGuard: "soft",
});
const noPlan = createMasterAI({ ...base, usePlan: false });

function randomOpening(state, rng) {
  const acts = [];
  const me = state.turn;
  const p = state.players[me];
  for (const dir of legalDirs(state, p.c, p.r)) acts.push({ type: "move", dir });
  for (const w of shortestPathWalls(state, state.players[0].c, state.players[0].r)) acts.push(w);
  for (const w of shortestPathWalls(state, state.players[1].c, state.players[1].r)) acts.push(w);
  for (let i = acts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [acts[i], acts[j]] = [acts[j], acts[i]];
  }
  for (const a of acts) if (validateAction(state, a).ok) return a;
  return null;
}

function play(planIsFirst, seed) {
  withPlan.reset();
  noPlan.reset();
  const rng = makeRng(seed);
  const planSide = planIsFirst ? 0 : 1;
  let s = createState(0, { drawMode: "firstOnly" });
  let ply = 0;
  while (s.winner === null && ply < 220) {
    if (ply < 6) {
      const a = randomOpening(s, rng);
      if (!a) break;
      s = applyAction(s, a).state;
      ply++;
      continue;
    }
    const isPlan = s.turn === planSide;
    const a = isPlan ? withPlan(s, rng) : noPlan(s, rng);
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  return { winner: s.winner, plies: ply, planSide };
}

let planWins = 0, draws = 0, losses = 0;
for (let i = 0; i < PER_SEAT; i++) {
  for (const planFirst of [true, false]) {
    const r = play(planFirst, SEED_BASE + i * 2 + (planFirst ? 0 : 1));
    if (r.winner === null || r.winner === "draw") draws++;
    else if (r.winner === r.planSide) planWins++;
    else losses++;
    console.log(
      `第 ${i + 1} 组（计划方${planFirst ? "先手" : "后手"}）：` +
      `${r.winner === null ? "未分" : r.winner === "draw" ? "平" : r.winner === r.planSide ? "带计划胜" : "关计划胜"}` +
      `，${r.plies} 手`,
    );
  }
}
console.log(`\n带计划 ${planWins} 胜 / ${draws} 平 / ${losses} 负（共 ${planWins + draws + losses} 局）`);
