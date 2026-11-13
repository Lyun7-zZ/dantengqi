/**
 * 用大师 AI 比较三种越线判定：
 *   symmetric  — 容差 1，谁越线都看对手是否一步可到（现行）
 *   firstOnly  — 容差 1，只补偿后手（方案 B）
 *   tol0       — 先到即胜
 *
 *   node tools/draw-mode-test.mjs --games 20 --ms 100
 */

import { createState, applyAction, distanceOf } from "../src/rules.js";
import { createMasterAI } from "../src/ai-master.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const games = Number(arg("games", 20));
const ms = Number(arg("ms", 100));
const maxPlies = Number(arg("maxPlies", 400));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playGame({ tolerance, drawMode, firstSeat, seed }) {
  const rng = mulberry32(seed);
  const ais = [
    createMasterAI({ timeMs: ms, maxDepth: 6, usePlan: true }),
    createMasterAI({ timeMs: ms, maxDepth: 6, usePlan: true }),
  ];

  let state = createState(firstSeat, { tolerance, drawMode });
  while (state.winner === null && state.plies < maxPlies) {
    const ai = ais[state.turn];
    const action = ai(state, rng);
    const res = applyAction(state, action);
    if (!res.ok) throw new Error(`非法行动 ${JSON.stringify(action)}: ${res.error}`);
    state = res.state;
  }
  return { winner: state.winner, plies: state.plies, loserDist: state.winner === null || state.winner === "draw" ? null : distanceOf(state, 1 - state.winner) };
}

function run(name, { tolerance, drawMode }) {
  let win0 = 0, win1 = 0, draw = 0, timeout = 0, totalPlies = 0, margin1 = 0;
  const t0 = Date.now();

  for (let i = 0; i < games; i++) {
    const firstSeat = i % 2; // 交换先后手
    const r = playGame({ tolerance, drawMode, firstSeat, seed: 7000 + i * 131 });
    totalPlies += r.plies;
    if (r.loserDist === 1) margin1++;
    if (r.winner === null) timeout++;
    else if (r.winner === "draw") draw++;
    else if (r.winner === 0) win0++;
    else win1++;
  }

  const decided = win0 + win1;
  const firstWins = win0;
  const secondWins = win1;
  const firstRate = decided ? (firstWins / decided * 100).toFixed(1) : "-";

  console.log(
    `${name.padEnd(16)} 先手胜 ${String(firstWins).padStart(2)}  后手胜 ${String(secondWins).padStart(2)}`
    + `  平 ${String(draw).padStart(2)}  超时 ${timeout}`
    + `  先手胜率(已决) ${firstRate}%  平局率 ${(draw / games * 100).toFixed(1)}%`
    + `  平均 ${(totalPlies / games).toFixed(0)} 手  (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
}

console.log(`大师 AI（${ms}ms 预算，${games} 局/组，每组交换先后手）\n`);
run("A 对称容差1", { tolerance: 1, drawMode: "symmetric" });
run("B 只补偿后手", { tolerance: 1, drawMode: "firstOnly" });
run("C 先到即胜", { tolerance: 0, drawMode: "symmetric" });
