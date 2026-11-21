/**
 * 逐手日志工具：记录每手的决策来源、深度、分数、节点数、耗时。
 *
 * 用法：node tools/ai-trace.mjs <预算ms> <输出文件> [局数]
 * 例：  node tools/ai-trace.mjs 2000 _extract/trace.jsonl 1
 */

import { writeFileSync } from "node:fs";
import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction } from "../src/rules.js";

const BUDGET = Number(process.argv[2] || 2000);
const OUT = process.argv[3] || "_extract/trace.jsonl";
const GAMES = Number(process.argv[4] || 1);

const base = {
  timeMs: BUDGET, maxDepth: 12, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
};
const bot = createMasterAI(base);

const rows = [];
for (let g = 0; g < GAMES; g++) {
  bot.reset();
  let s = createState(g % 2, { drawMode: "firstOnly" });
  let ply = 0;
  while (s.winner === null && ply < 200) {
    const side = s.turn;
    const t0 = Date.now();
    const a = bot(s, Math.random);
    const dt = Date.now() - t0;
    const log = bot.stats.lastLog || {};
    rows.push({
      game: g,
      ply,
      side,
      first: s.firstPlayer,
      elapsed: dt,
      ...log,
      chosen: a,
    });
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  rows.push({ game: g, result: s.winner === null ? "unfinished" : s.winner, plies: ply });
}

writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`写入 ${OUT}：${rows.length} 条`);
const sources = {};
for (const r of rows) if (r.source) sources[r.source] = (sources[r.source] || 0) + 1;
console.log("决策来源分布：", sources);
