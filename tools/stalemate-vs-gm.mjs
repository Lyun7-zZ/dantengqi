/**
 * 僵局审计（地狱 vs 宗师）：复现真实配对，统计长局与最后 40 手。
 * 用法：node tools/stalemate-vs-gm.mjs [地狱ms] [宗师ms] [局数]
 */

import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction, distanceOf } from "../src/rules.js";

const HELL_MS = Number(process.argv[2] || 800);
const GM_MS = Number(process.argv[3] || 300);
const GAMES = Number(process.argv[4] || 4);

const hell = createMasterAI({
  timeMs: HELL_MS, maxDepth: 12, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
  routeWalls: 3, smartExit: true,
});
const gm = createMasterAI({
  timeMs: GM_MS, maxDepth: 7, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 9,
});

let capped = 0;
for (let g = 0; g < GAMES; g++) {
  hell.reset();
  gm.reset();
  const hellSide = g % 2;
  let s = createState(0, { drawMode: "firstOnly" });
  let ply = 0;
  const tail = [];
  while (s.winner === null && ply < 240) {
    const side = s.turn;
    const m = distanceOf(s, 1 - side) - distanceOf(s, side);
    const exits = s.topWall.filter((v) => v === 0).length;
    const a = side === hellSide ? hell(s, Math.random) : gm(s, Math.random);
    if (tail.length >= 40) tail.shift();
    tail.push({ a, m, exits, side });
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  const d = [distanceOf(s, 0), distanceOf(s, 1)];
  const exits = s.topWall.filter((v) => v === 0).length;
  console.log(`\n第 ${g + 1} 局（地狱${hellSide === 0 ? "先手" : "后手"}）：${s.winner === null ? "未分" : s.winner === "draw" ? "平" : s.winner === hellSide ? "地狱胜" : "宗师胜"}，${ply} 手`);
  console.log(`  终局距离 ${d[0]}:${d[1]}，开放出口 ${exits}`);
  if (s.winner === null) {
    capped++;
    const moves = tail.filter((x) => x.a.type === "move");
    const walls = tail.filter((x) => x.a.type === "wall");
    const dirs = {};
    for (const x of moves) dirs[x.a.dir] = (dirs[x.a.dir] || 0) + 1;
    console.log(`  最后 40 手：走子 ${moves.length}（${JSON.stringify(dirs)}），封墙 ${walls.length}`);
    console.log(`  最后 10 手 margin：${tail.slice(-10).map((x) => x.m).join(",")}`);
  }
}
console.log(`\n未分局 ${capped}/${GAMES}`);
