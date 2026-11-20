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
const TOTAL = Number(process.argv[4] || 12);
const START = Number(process.argv[5] || 0);
const COUNT = Number(process.argv[6] || TOTAL);

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
  adaptive: false,
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

console.log(`地狱 ${HELL_MS}ms vs 宗师 ${GM_MS}ms，共 ${TOTAL} 局，本进程 ${START}..${START + COUNT - 1}\n`);
const asFirst = [];
const asSecond = [];

const t0 = Date.now();
for (let i = START; i < START + COUNT; i++) {
  const hellIsFirst = i % 2 === 0;
  const seed = 3000 + i;
  const r = play(hellIsFirst, seed);
  if (hellIsFirst) asFirst.push(r); else asSecond.push(r);
  const fmt = (x) =>
    `${x.winner === null ? "未分" : x.winner === "draw" ? "平" : x.winner === x.hellSide ? "地狱胜" : "宗师胜"}(${x.plies}手, ${(x.avg / 1000).toFixed(1)}s/手)`;
  console.log(`第 ${i + 1} 局（地狱${hellIsFirst ? "先手" : "后手"}）：${fmt(r)}  累计 ${((Date.now() - t0) / 60000).toFixed(0)} 分钟`);
}

console.log("");
const f = asFirst.length ? summarize("地狱执先手", asFirst) : { w: 0, d: 0, l: 0, n: 0 };
const s = asSecond.length ? summarize("地狱执后手", asSecond) : { w: 0, d: 0, l: 0, n: 0 };
console.log(`\n本片：先手 ${f.w}胜${f.d}平${f.l}负，后手 ${s.w}胜${s.d}平${s.l}负，合计负 ${f.l + s.l}`);
