/**
 * 地狱 A/B 评估（座位分离 + 固定种子）。
 *
 * 用法：node tools/hell-ab.mjs <预算ms> <每个座位局数> [变体A] [变体B]
 *   默认对比：worstGap 开 vs 关
 *
 * 指标：
 *   先手转化率：新 AI 执先手时的胜率
 *   后手防守率：新 AI 执后手时的不败率（胜+平）
 *   先手优势：所有对局中先手方的胜率
 */

import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction } from "../src/rules.js";

const BUDGET = Number(process.argv[2] || 800);
const PER_SEAT = Number(process.argv[3] || 6);

/** mulberry32：可复现的随机源 */
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
  timeMs: BUDGET, maxDepth: 8, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
};
const newAI = createMasterAI({ ...base, worstGap: true, behindMode: true });
const oldAI = createMasterAI({ ...base, worstGap: true, behindMode: false });

function play(newIsFirst, seed) {
  newAI.reset();
  oldAI.reset();
  const rng = makeRng(seed);
  const newSide = newIsFirst ? 0 : 1;
  let s = createState(0, { drawMode: "firstOnly" }); // 先手固定为 0，座位由 AI 分配
  let ply = 0;
  let newTime = 0;
  let newMoves = 0;
  while (s.winner === null && ply < 220) {
    const isNew = s.turn === newSide;
    const t0 = Date.now();
    const a = isNew ? newAI(s, rng) : oldAI(s, rng);
    if (isNew) { newTime += Date.now() - t0; newMoves++; }
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  return { winner: s.winner, plies: ply, newSide, avg: newMoves ? newTime / newMoves : 0 };
}

function summarize(label, rows) {
  const w = rows.filter((r) => r.winner === r.newSide).length;
  const d = rows.filter((r) => r.winner === "draw" || r.winner === null).length;
  const l = rows.length - w - d;
  const avg = rows.reduce((a, r) => a + r.avg, 0) / Math.max(1, rows.length);
  console.log(
    `${label}：${rows.length} 局 → ${w} 胜 / ${d} 平 / ${l} 负` +
    `（胜率 ${(w / rows.length * 100).toFixed(0)}%，不败 ${((w + d) / rows.length * 100).toFixed(0)}%）` +
    `，每手均值 ${avg.toFixed(0)}ms`,
  );
  return { w, d, l, n: rows.length };
}

const asFirst = [];
const asSecond = [];
console.log(`预算 ${BUDGET}ms，每个座位 ${PER_SEAT} 局\n`);

for (let i = 0; i < PER_SEAT; i++) {
  const seed = 1000 + i;
  const r1 = play(true, seed);
  asFirst.push(r1);
  const r2 = play(false, seed + 500);
  asSecond.push(r2);
  const fmt = (r) => `${r.winner === null ? "未分" : r.winner === "draw" ? "平" : r.winner === r.newSide ? "新胜" : "旧胜"}(${r.plies}手)`;
  console.log(`第 ${i + 1} 组：新先手 ${fmt(r1)} | 新后手 ${fmt(r2)}`);
}

console.log("");
const f = summarize("新地狱执先手", asFirst);
const s = summarize("新地狱执后手", asSecond);

// 先手优势：所有对局里先手方（固定为玩家0）的胜负
const all = [...asFirst, ...asSecond];
const firstWins = all.filter((r) => r.winner === 0).length;
const draws = all.filter((r) => r.winner === "draw" || r.winner === null).length;
console.log(`\n先手（玩家0）胜率：${(firstWins / all.length * 100).toFixed(0)}%（平 ${draws}/${all.length}）`);
console.log(`\n结论：先手转化 ${f.w}/${f.n}，后手不败 ${(s.w + s.d)}/${s.n}`);
