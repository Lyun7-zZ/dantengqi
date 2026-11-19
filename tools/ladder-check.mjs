/**
 * 难度阶梯自检：确认「简单 < 普通 < 困难 < 大师」的顺序没被打乱。
 *
 *   node tools/ladder-check.mjs                    # 默认 4 局/档、40ms 预算
 *   node tools/ladder-check.mjs --games 8 --ms 80
 *
 * 为什么用「对简单档的胜率」而不是两两对拍：
 * 这游戏先手优势很大，两两对拍时座位效应会盖过实力差，小样本几乎总是 50%。
 * 固定一个弱基准（简单档），各档对它的胜率就能拉开梯度。
 *
 * 高两档是搜索型，按生产预算比例缩放：困难 350ms、大师 1200ms。
 * 每局重建 AI 实例（大师的计划状态会跨局残留）。
 */

import { AI } from "../src/ai.js";
import { createMasterAI } from "../src/ai-master.js";
import { createState, applyAction } from "../src/rules.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const games = Number(arg("games", 4));
const ms = Number(arg("ms", 40));
const maxPlies = Number(arg("maxPlies", 400));

const HARD_MS = Math.max(10, Math.round(ms));
const MASTER_MS = Math.max(20, Math.round(ms * 1200 / 350));

/** 各档对「简单」的最低预期胜率。 */
const EXPECT = { normal: 0.6, hard: 0.75, master: 0.85 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function factory(level) {
  if (level === "easy") return () => AI.easy;
  if (level === "normal") return () => AI.normal;
  if (level === "hard") return () => createMasterAI({ timeMs: HARD_MS, maxDepth: 4, usePlan: false });
  return () => createMasterAI({ timeMs: MASTER_MS, maxDepth: 6, usePlan: true });
}

function playGame(strong, weak, strongSeat, seed) {
  const rng = mulberry32(seed);
  const bySeat = [null, null];
  bySeat[strongSeat] = strong;
  bySeat[1 - strongSeat] = weak;

  let state = createState(0, { drawMode: "firstOnly" });
  while (state.winner === null && state.plies < maxPlies) {
    const res = applyAction(state, bySeat[state.turn](state, rng));
    if (!res.ok) throw new Error(`非法行动 ${JSON.stringify(res.action)}: ${res.error}`);
    state = res.state;
  }
  return { winner: state.winner, plies: state.plies };
}

function runTier(level) {
  const makeStrong = factory(level);
  const makeWeak = factory("easy");
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let timeouts = 0;
  let plies = 0;
  const t0 = Date.now();

  for (let i = 0; i < games; i++) {
    const strongSeat = i % 2; // 交替先后手
    const r = playGame(makeStrong(), makeWeak(), strongSeat, 4000 + i * 173);
    plies += r.plies;
    if (r.winner === null) timeouts++;
    else if (r.winner === "draw") draws++;
    else if (r.winner === strongSeat) wins++;
    else losses++;
  }

  const rate = wins / games;
  const floor = level === "easy" ? 0 : EXPECT[level];
  const pass = level === "easy" ? true : rate >= floor;
  console.log(
    `${pass ? "✓" : "✗"} ${level.padEnd(7)} 对简单：${String(wins).padStart(2)} 胜 `
    + `${String(losses).padStart(2)} 负 ${String(draws).padStart(2)} 平`
    + `  胜率 ${(rate * 100).toFixed(0)}%  要求 ≥ ${(floor * 100).toFixed(0)}%`
    + `  平均 ${(plies / games).toFixed(0)} 手  ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  return { level, rate, pass };
}

console.log(
  `难度阶梯自检：每档对简单 ${games} 局（交替先后手），困难 ${HARD_MS}ms、大师 ${MASTER_MS}ms，规则 1.3\n`,
);

const rows = ["easy", "normal", "hard", "master"].map(runTier);

// 单调性：后一档的胜率不应低于前一档（允许 1 局以内的噪声）
const monotonic = rows.every((r, i) => i === 0 || r.rate >= rows[i - 1].rate - 1 / games);
const allPass = rows.every((r) => r.pass) && monotonic;

console.log(
  monotonic
    ? "\n梯度单调：简单 ≤ 普通 ≤ 困难 ≤ 大师"
    : "\n⚠ 梯度不单调：有高档对简单档的胜率低于低档",
);

if (allPass) {
  console.log("阶梯正常 ✓");
} else {
  console.error("阶梯异常 ✗：检查评估函数或搜索预算");
  process.exitCode = 1;
}
