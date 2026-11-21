/**
 * 候选枚举对照：对比「全部合法着法」与「AI 实际生成的候选」。
 *
 * 用法：node tools/candidate-audit.mjs [预算ms] [采样局面数]
 */

import { createMasterAI, debugCandidates, debugPathCount } from "../src/ai-master.js";
import {
  createState, applyAction, validateAction, legalDirs, wallPlaced, distanceOf,
} from "../src/rules.js";
import { allWallSlots } from "../src/board.js";

const BUDGET = Number(process.argv[2] || 800);
const SAMPLES = Number(process.argv[3] || 20);

const bot = createMasterAI({
  timeMs: BUDGET, maxDepth: 8, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
});

const keyOf = (a) => (a.type === "move" ? "m:" + a.dir : "w:" + a.kind + ":" + a.c + ":" + a.r);

function allLegal(state) {
  const me = state.turn;
  const p = state.players[me];
  const out = [];
  for (const dir of legalDirs(state, p.c, p.r)) out.push({ type: "move", dir });
  for (const w of allWallSlots()) {
    if (wallPlaced(state, w.kind, w.c, w.r)) continue;
    const a = { type: "wall", kind: w.kind, c: w.c, r: w.r };
    if (validateAction(state, a).ok) out.push(a);
  }
  return out;
}

function marginOf(state) {
  return distanceOf(state, 1 - state.turn) - distanceOf(state, state.turn);
}

/** 该墙是否减少了对手的最短路条数（延迟收益）。 */
function routeCut(state, w) {
  const opp = 1 - state.turn;
  const before = debugPathCount(state, opp);
  const r = applyAction(state, w);
  if (!r.ok) return 0;
  return before - debugPathCount(r.state, opp);
}

const samples = [];
let games = 0;
while (samples.length < SAMPLES && games < 6) {
  bot.reset();
  let s = createState(games % 2, { drawMode: "firstOnly" });
  let ply = 0;
  while (s.winner === null && ply < 120 && samples.length < SAMPLES) {
    if (ply >= 8 && ply % 6 === 0) {
      const legal = allLegal(s);
      const gen = debugCandidates(s, { netWalls: true });
      const genSet = new Set(gen.map(keyOf));
      const missing = legal.filter((a) => !genSet.has(keyOf(a)));
      const missingWalls = missing.filter((a) => a.type === "wall");
      let routeCutWalls = 0;
      let topWalls = 0;
      let positive = 0;
      const examples = [];
      for (const w of missingWalls) {
        const rc = routeCut(s, w);
        if (rc > 0) routeCutWalls++;
        if (w.kind === "top") topWalls++;
        const r = applyAction(s, w);
        if (r.ok) {
          const before = marginOf(s);
          const after = distanceOf(r.state, 1 - r.state.turn) - distanceOf(r.state, r.state.turn);
          void after;
          if (marginOf(r.state) > before) positive++;
        }
        if (rc > 0 && examples.length < 3) examples.push({ w, rc });
      }
      samples.push({
        ply,
        legal: legal.length,
        gen: gen.length,
        missing: missing.length,
        missingWalls: missingWalls.length,
        routeCutWalls,
        topWalls,
        examples,
      });
    }
    const r = applyAction(s, bot(s, Math.random));
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  games++;
}

const sum = (f) => samples.reduce((a, x) => a + f(x), 0);
console.log(`采样 ${samples.length} 个局面（${games} 局）`);
console.log(`平均合法着法 ${(sum((x) => x.legal) / samples.length).toFixed(0)}，生成候选 ${(sum((x) => x.gen) / samples.length).toFixed(0)}`);
console.log(`平均遗漏 ${(sum((x) => x.missing) / samples.length).toFixed(0)}，其中墙 ${(sum((x) => x.missingWalls) / samples.length).toFixed(0)}`);
console.log(`遗漏墙里：减少对手路数的 ${(sum((x) => x.routeCutWalls) / samples.length).toFixed(1)} 面/局面，顶墙 ${(sum((x) => x.topWalls) / samples.length).toFixed(1)} 面/局面`);
const withExamples = samples.filter((x) => x.examples.length);
for (const x of withExamples.slice(0, 5)) {
  console.log(`\nply ${x.ply}:`, x.examples.map((e) => `${e.w.kind}(${e.w.c},${e.w.r}) 砍路 ${e.rc}`).join("；"));
}
