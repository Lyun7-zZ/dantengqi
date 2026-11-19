/**
 * 评估函数 A/B：同一引擎、同一预算，v1（旧）vs v2（新）。
 *   node tools/eval-ab.mjs --games 8 --ms 150
 */

import { createMasterAI } from "../src/ai-master.js";
import { createMasterAI as createV1 } from "./baselines/ai-master-v1.mjs";
import { createState, applyAction } from "../src/rules.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const games = Number(arg("games", 8));
const ms = Number(arg("ms", 150));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let v2w = 0, v1w = 0, dr = 0;

for (let i = 0; i < games; i++) {
  const v2Seat = i % 2;
  const bySeat = [null, null];
  bySeat[v2Seat] = createMasterAI({ timeMs: ms, maxDepth: 6, usePlan: true });
  bySeat[1 - v2Seat] = createV1({ timeMs: ms, maxDepth: 6, usePlan: true });

  const rng = mulberry32(700 + i * 97);
  let state = createState(0, { drawMode: "firstOnly" });
  let plies = 0;
  while (state.winner === null && plies < 400) {
    const res = applyAction(state, bySeat[state.turn](state, rng));
    if (!res.ok) throw new Error(res.error);
    state = res.state;
    plies++;
  }

  if (state.winner === "draw") dr++;
  else if (state.winner === v2Seat) v2w++;
  else v1w++;
  console.log(`第 ${i + 1} 局：v2 执${v2Seat === 0 ? "先" : "后"} → ${state.winner === "draw" ? "平" : state.winner === v2Seat ? "v2 胜" : "v1 胜"}（${plies} 手）`);
}

console.log(`\nv2 ${v2w} 胜 / v1 ${v1w} 胜 / 平 ${dr}`);
