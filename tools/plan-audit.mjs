/**
 * 计划层审计：统计决策来源占比、各来源耗时、阶段分布。
 *
 * 用法：node tools/plan-audit.mjs [预算ms] [局数]
 */

import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction } from "../src/rules.js";

const BUDGET = Number(process.argv[2] || 800);
const GAMES = Number(process.argv[3] || 4);

function makeBot() {
  return createMasterAI({
    timeMs: BUDGET, maxDepth: 12, usePlan: true,
    netWalls: true, avoidRepeat: true, repeatPenalty: 160,
    planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
    routeWalls: 3, smartExit: true,
  });
}

const bots = [makeBot(), makeBot()];
const rows = [];

for (let g = 0; g < GAMES; g++) {
  bots[0].reset();
  bots[1].reset();
  let s = createState(g % 2, { drawMode: "firstOnly" });
  let ply = 0;
  while (s.winner === null && ply < 200) {
    const side = s.turn;
    const t0 = Date.now();
    const a = bots[side](s, Math.random);
    const dt = Date.now() - t0;
    const log = bots[side].stats.lastLog || {};
    rows.push({ ply, side, source: log.source || "?", elapsed: dt, depth: log.depth });
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  rows.push({ ply, source: "result", result: s.winner === null ? "unfinished" : s.winner });
}

const moves = rows.filter((r) => r.source !== "result");
const bySource = {};
for (const r of moves) {
  bySource[r.source] = bySource[r.source] || { n: 0, ms: 0 };
  bySource[r.source].n++;
  bySource[r.source].ms += r.elapsed;
}
console.log(`预算 ${BUDGET}ms，${GAMES} 局，共 ${moves.length} 手\n`);
for (const [src, v] of Object.entries(bySource).sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `${src.padEnd(18)} ${String(v.n).padStart(4)} 手  ${(v.n / moves.length * 100).toFixed(1).padStart(5)}%` +
    `  平均 ${(v.ms / v.n).toFixed(0)}ms`,
  );
}

const planSources = ["plan", "plan-new", "plan-old", "guard"];
const phases = [
  ["开局 ply<30", (r) => r.ply < 30],
  ["中局 30-59", (r) => r.ply >= 30 && r.ply < 60],
  ["后段 60+", (r) => r.ply >= 60],
];
console.log("\n阶段分布：");
for (const [name, f] of phases) {
  const rs = moves.filter(f);
  if (!rs.length) continue;
  const plan = rs.filter((r) => planSources.includes(r.source)).length;
  console.log(`${name}: ${rs.length} 手，计划/保护层直接决定 ${plan} 手（${(plan / rs.length * 100).toFixed(0)}%）`);
}

const results = rows.filter((r) => r.source === "result");
console.log("\n对局结果：", results.map((r) => r.result).join(", "));
