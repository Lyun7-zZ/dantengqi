/**
 * 实验：后手镜像策略 vs 大师。
 * 后手每步把先手刚才的动作沿中线镜像（列 c -> 9-c），
 * 镜像非法时退回「max z」贪心。
 */

import { createMasterAI } from "../src/ai-master.js";
import {
  createState, applyAction, validateAction, distanceOf, legalDirs, wallPlaced,
} from "../src/rules.js";
import { allWallSlots } from "../src/board.js";

const COLS = 10;
const master = createMasterAI({
  timeMs: 150, maxDepth: 5, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
});

function mirrorAction(a) {
  if (!a) return null;
  if (a.type === "move") {
    const dir = a.dir === "left" ? "right" : a.dir === "right" ? "left" : a.dir;
    return { type: "move", dir };
  }
  if (a.kind === "v") return { type: "wall", kind: "v", c: COLS - 2 - a.c, r: a.r };
  if (a.kind === "h") return { type: "wall", kind: "h", c: COLS - 1 - a.c, r: a.r };
  if (a.kind === "t" || a.kind === "top") return { type: "wall", kind: a.kind, c: COLS - 1 - a.c, r: a.r };
  return null;
}

function mirrorMove(state, lastAction) {
  const cand = mirrorAction(lastAction);
  if (cand && validateAction(state, cand).ok) return cand;
  return greedy(state);
}

function greedy(state) {
  const me = state.turn;
  let best = -Infinity;
  let pool = [];
  const tryA = (a) => {
    const r = applyAction(state, a);
    if (!r.ok) return;
    const z = distanceOf(r.state, 1 - me) - distanceOf(r.state, me);
    if (z > best) { best = z; pool = [a]; }
    else if (z === best) pool.push(a);
  };
  const p = state.players[me];
  for (const dir of legalDirs(state, p.c, p.r)) tryA({ type: "move", dir });
  for (const w of allWallSlots()) {
    if (wallPlaced(state, w.kind, w.c, w.r)) continue;
    const a = { type: "wall", kind: w.kind, c: w.c, r: w.r };
    if (validateAction(state, a).ok) tryA(a);
  }
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function playGame(mirrorIsSecond = true) {
  const mirrorSide = mirrorIsSecond ? 1 : 0;
  let s = createState(mirrorIsSecond ? 0 : 1, { drawMode: "firstOnly" });
  let ply = 0;
  let lastAction = null;
  let mirrored = 0;
  let fallback = 0;
  while (s.winner === null && ply < 200) {
    let a;
    if (s.turn === mirrorSide) {
      a = mirrorMove(s, lastAction);
      if (a && mirrorAction(lastAction) && validateAction(s, a).ok && JSON.stringify(a) === JSON.stringify(mirrorAction(lastAction))) mirrored++;
      else fallback++;
    } else {
      a = master(s, Math.random);
    }
    if (!a) break;
    const r = applyAction(s, a);
    if (!r.ok) {
      const alt = greedy(s);
      if (!alt) break;
      const r2 = applyAction(s, alt);
      if (!r2.ok) break;
      s = r2.state;
      lastAction = alt;
      ply++;
      continue;
    }
    lastAction = a;
    s = r.state;
    ply++;
  }
  return { winner: s.winner, plies: ply, mirrored, fallback };
}

const N = Number(process.argv[2] || 6);
let wins = 0, draws = 0, losses = 0;
for (let i = 0; i < N; i++) {
  const t0 = Date.now();
  const g = playGame(true);
  const mirrorSide = 1;
  let tag;
  if (g.winner === null) { draws++; tag = "未分胜负"; }
  else if (g.winner === "draw") { draws++; tag = "平"; }
  else if (g.winner === mirrorSide) { wins++; tag = "镜像胜"; }
  else { losses++; tag = "大师胜"; }
  console.log(`第 ${i + 1} 局：${tag}，${g.plies} 手（镜像 ${g.mirrored} 次，退化 ${g.fallback} 次），${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(`\n后手镜像 vs 大师：${wins} 胜 / ${draws} 平 / ${losses} 负`);
