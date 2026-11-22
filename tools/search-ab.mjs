/**
 * 搜索增强消融：地狱（TT+PVS+killer） vs 地狱（关闭增强）。
 * 用法：node tools/search-ab.mjs [预算ms] [每座位局数] [seed基]
 */

import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction, legalDirs, validateAction } from "../src/rules.js";
import { shortestPathWalls } from "../src/path.js";

const BUDGET = Number(process.argv[2] || 800);
const PER_SEAT = Number(process.argv[3] || 6);
const SEED_BASE = Number(process.argv[4] || 8000);

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
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
  routeWalls: 3, smartExit: true, usePlan: true,
};
const fast = createMasterAI({ ...base, tt: true, pvs: true, killers: true });
const slow = createMasterAI({ ...base });

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

function play(fastIsFirst, seed) {
  fast.reset();
  slow.reset();
  const rng = makeRng(seed);
  const fastSide = fastIsFirst ? 0 : 1;
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
    const isFast = s.turn === fastSide;
    const a = isFast ? fast(s, rng) : slow(s, rng);
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  return { winner: s.winner, plies: ply, fastSide };
}

let wins = 0, draws = 0, losses = 0;
for (let i = 0; i < PER_SEAT; i++) {
  for (const fastFirst of [true, false]) {
    const r = play(fastFirst, SEED_BASE + i * 2 + (fastFirst ? 0 : 1));
    if (r.winner === null || r.winner === "draw") draws++;
    else if (r.winner === r.fastSide) wins++;
    else losses++;
    console.log(
      `第 ${i + 1} 组（增强方${fastFirst ? "先手" : "后手"}）：` +
      `${r.winner === null ? "未分" : r.winner === "draw" ? "平" : r.winner === r.fastSide ? "增强胜" : "原版胜"}` +
      `，${r.plies} 手`,
    );
  }
}
console.log(`\n增强 ${wins} 胜 / ${draws} 平 / ${losses} 负（共 ${wins + draws + losses} 局）`);
