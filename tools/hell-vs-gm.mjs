/**
 * 地狱 vs 宗师 基线（座位分离 + 固定种子）。
 *
 * 真实预算比例：地狱 28s : 宗师 3s ≈ 9.3:1
 * 默认代理：地狱 2800ms : 宗师 300ms
 *
 * 用法：node tools/hell-vs-gm.mjs [地狱预算] [宗师预算] [每座位局数]
 */

import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction } from "../src/rules.js";

const HELL_MS = Number(process.argv[2] || 2800);
const GM_MS = Number(process.argv[3] || 300);
const PER_SEAT = Number(process.argv[4] || 6);

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

const hell = createMasterAI({
  timeMs: HELL_MS, maxDepth: 12, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
  adaptive: false, worstGap: true, behindMode: true,
});

const gm = createMasterAI({
  timeMs: GM_MS, maxDepth: 7, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 9,
});

function play(hellIsFirst, seed) {
  hell.reset();
  gm.reset();
  const rng = makeRng(seed);
  const hellSide = hellIsFirst ? 0 : 1;
  let s = createState(0, { drawMode: "firstOnly" }); // 先手固定为玩家 0
  let ply = 0;
  let hellTime = 0;
  let hellMoves = 0;
  while (s.winner === null && ply < 240) {
    const isHell = s.turn === hellSide;
    const t0 = Date.now();
    const a = isHell ? hell(s, rng) : gm(s, rng);
    if (isHell) { hellTime += Date.now() - t0; hellMoves++; }
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  return { winner: s.winner, plies: ply, hellSide, avg: hellMoves ? hellTime / hellMoves : 0 };
}

function summarize(label, rows) {
  const w = rows.filter((r) => r.winner === r.hellSide).length;
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

console.log(`地狱 ${HELL_MS}ms vs 宗师 ${GM_MS}ms，每座位 ${PER_SEAT} 局\n`);
const asFirst = [];
const asSecond = [];

for (let i = 0; i < PER_SEAT; i++) {
  const seed = 2000 + i;
  const r1 = play(true, seed);
  asFirst.push(r1);
  const r2 = play(false, seed + 700);
  asSecond.push(r2);
  const fmt = (r) =>
    `${r.winner === null ? "未分" : r.winner === "draw" ? "平" : r.winner === r.hellSide ? "地狱胜" : "宗师胜"}(${r.plies}手)`;
  console.log(`第 ${i + 1} 组：地狱先手 ${fmt(r1)} | 地狱后手 ${fmt(r2)}`);
}

console.log("");
const f = summarize("地狱执先手", asFirst);
const s = summarize("地狱执后手", asSecond);
console.log(`\n对照目标：20 局负率 0%（当前代理每个座位 ${PER_SEAT} 局）`);
console.log(`先手转化 ${f.w}/${f.n}，后手不败 ${s.w + s.d}/${s.n}，合计负 ${f.l + s.l}`);
