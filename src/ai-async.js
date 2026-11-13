/**
 * 同时行动下的 AI。每方只看当前局面选一步，看不到对方这一步的选择。
 */

import {
  resolveRound, legalActions, autoMove, validateAction, distanceOf,
} from "./rules-async.js";
import { shortestPathWalls } from "./path-async.js";
import { makeRng, randomAI } from "./ai-random-async.js";

export { makeRng, randomAI };

function scoreFor(state, seat) {
  if (state.winner === seat) return 1e9;
  if (state.winner === "draw") return 0;
  if (state.winner === 1 - seat) return -1e9;
  return distanceOf(state, 1 - seat) - distanceOf(state, seat);
}

function opponentSamples(state, opp, wide) {
  const samples = [autoMove(state, opp)];
  if (!wide) return samples;
  if (state.bank[opp] === 0) samples.push({ type: "store" });
  const me = 1 - opp;
  const mine = state.players[me];
  const walls = shortestPathWalls(state, mine.c, mine.r, me);
  const limit = wide === "master" ? walls.length : 3;
  for (const w of walls.slice(0, limit)) {
    const a = { type: "wall", kind: w.kind, c: w.c, r: w.r };
    if (validateAction(state, opp, a).ok) samples.push(a);
  }
  return samples;
}

function myCandidates(state, seat, rng) {
  const all = legalActions(state, seat);
  const moves = all.filter((a) => a.type !== "wall");
  const walls = all.filter((a) => a.type === "wall");
  const mine = state.players[1 - seat];
  const along = new Set(
    shortestPathWalls(state, mine.c, mine.r, 1 - seat).map((w) => `${w.kind}:${w.c}:${w.r}`),
  );
  const picked = walls.filter((w) => along.has(`${w.kind}:${w.c}:${w.r}`));
  for (let i = 0; i < 4 && walls.length; i++) {
    picked.push(walls[Math.floor(rng() * walls.length)]);
  }
  return moves.concat(picked);
}

function choose(state, seat, rng, wide) {
  const mine = myCandidates(state, seat, rng);
  const samples = opponentSamples(state, 1 - seat, wide);
  let best = null;
  let bestScore = -Infinity;
  for (const a of mine) {
    let total = 0;
    let n = 0;
    for (const b of samples) {
      const pair = seat === 0 ? [a, b] : [b, a];
      const res = resolveRound(state, pair);
      if (!res.ok) continue;
      total += scoreFor(res.state, seat);
      n += 1;
    }
    if (n === 0) continue;
    let score = total / n + rng() * 0.05;
    if (a.type === "store") score -= 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ?? autoMove(state, seat);
}

export function greedyAI(state, seat, rng = Math.random) {
  return choose(state, seat, rng, false);
}

export function easyAI(state, seat, rng = Math.random) {
  if (rng() < 0.25) return randomAI(state, seat, rng);
  return greedyAI(state, seat, rng);
}

export function hardAI(state, seat, rng = Math.random) {
  return choose(state, seat, rng, true);
}

export function masterAI(state, seat, rng = Math.random) {
  return choose(state, seat, rng, "master");
}

export const AI = {
  random: randomAI,
  greedy: greedyAI,
  easy: easyAI,
  normal: greedyAI,
  hard: hardAI,
  master: masterAI,
};

export function createMasterAI() {
  return masterAI;
}
