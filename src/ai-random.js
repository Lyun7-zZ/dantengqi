/**
 * 随机与随机数工具：被 ai.js 与 ai-master.js 共用，避免循环依赖。
 */

import { legalActions, legalDirs, validateAction } from "./rules.js";

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomAI(state, rng) {
  const actions = legalActions(state);
  // 随机墙可能封死通路，需要按规则校验；连续命中非法时退化为走子。
  for (let i = 0; i < 200; i++) {
    const a = actions[Math.floor(rng() * actions.length)];
    if (a.type === "move") return a;
    if (validateAction(state, a).ok) return a;
  }
  const p = state.players[state.turn];
  const dirs = legalDirs(state, p.c, p.r);
  return { type: "move", dir: dirs[Math.floor(rng() * dirs.length)] };
}
