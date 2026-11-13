/**
 * 随机与随机数工具。
 */

import { legalActions, autoMove } from "./rules.js";

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

export function randomAI(state, seat, rng) {
  const actions = legalActions(state, seat).filter((a) => a.type !== "wall" || rng() < 0.15);
  if (actions.length === 0) return autoMove(state, seat);
  return actions[Math.floor(rng() * actions.length)];
}
