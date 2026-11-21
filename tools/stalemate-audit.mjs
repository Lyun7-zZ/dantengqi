/**
 * 僵局审计：复现长局，统计重复局面、最后 40 手的行动构成。
 *
 * 用法：node tools/stalemate-audit.mjs [预算ms] [局数]
 */

import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction, distanceOf } from "../src/rules.js";
import { COLS, ROWS } from "../src/board.js";

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

function hash(state) {
  let h = 0x811c9dc5;
  const mix = (n) => { h ^= n & 0xff; h = Math.imul(h, 0x01000193); };
  for (const p of state.players) { mix(p.c); mix(p.r); }
  for (const v of state.vWall) mix(v);
  for (const v of state.hWall) mix(v);
  for (const v of state.topWall) mix(v);
  mix(state.turn);
  return (h >>> 0).toString(16);
}

const bots = [makeBot(), makeBot()];
let capped = 0;
const cappedGames = [];

for (let g = 0; g < GAMES; g++) {
  bots[0].reset();
  bots[1].reset();
  let s = createState(g % 2, { drawMode: "firstOnly" });
  let ply = 0;
  const seen = new Map();
  const tail = [];
  while (s.winner === null && ply < 220) {
    const h = hash(s);
    seen.set(h, (seen.get(h) || 0) + 1);
    const side = s.turn;
    const before = {
      m: distanceOf(s, 1 - side) - distanceOf(s, side),
      exits: s.topWall.filter((v) => v === 0).length,
    };
    const a = bots[side](s, Math.random);
    if (tail.length >= 40) tail.shift();
    tail.push({
      ply, side, a,
      m: before.m,
      exits: before.exits,
      source: bots[side].stats.lastLog?.source,
    });
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  const repeats = [...seen.values()].filter((v) => v > 1).length;
  const maxRepeat = Math.max(0, ...seen.values());
  const d = [distanceOf(s, 0), distanceOf(s, 1)];
  const exits = s.topWall.filter((v) => v === 0).length;
  console.log(`\n第 ${g + 1} 局：${s.winner === null ? "未分" : s.winner === "draw" ? "平" : `玩家${s.winner}胜`}，${ply} 手`);
  console.log(`  唯一局面 ${seen.size}，重复局面 ${repeats}（最高重复 ${maxRepeat} 次）`);
  console.log(`  终局距离 ${d[0]}:${d[1]}，开放出口 ${exits}`);
  if (s.winner === null) {
    capped++;
    cappedGames.push(tail);
    const moves = tail.filter((x) => x.a.type === "move");
    const walls = tail.filter((x) => x.a.type === "wall");
    const dirs = {};
    for (const x of moves) dirs[x.a.dir] = (dirs[x.a.dir] || 0) + 1;
    console.log(`  最后 40 手：走子 ${moves.length}（${JSON.stringify(dirs)}），封墙 ${walls.length}`);
    console.log(`  最后 10 手 margin：${tail.slice(-10).map((x) => x.m).join(",")}`);
    console.log(`  最后 10 手来源：${tail.slice(-10).map((x) => x.source).join(",")}`);
  }
}

console.log(`\n未分局 ${capped}/${GAMES}`);
