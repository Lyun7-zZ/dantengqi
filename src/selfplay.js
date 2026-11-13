/**
 * 自对弈与统计。
 */

import { createState, resolveRound } from "./rules.js";
import { AI, makeRng } from "./ai.js";

export function playGame({ ai = "greedy", seed = 1, firstPlayer = 0, maxPlies = 80, tolerance = 1, wallLimit = Infinity } = {}) {
  const names = Array.isArray(ai) ? ai : [ai, ai];
  const policies = names.map((n) => AI[n]);
  policies.forEach((p) => p.reset?.());
  const rng = makeRng(seed);
  let state = createState(firstPlayer, { tolerance, wallLimit });

  while (state.winner === null && state.plies < maxPlies) {
    const pair = [policies[0](state, 0, rng), policies[1](state, 1, rng)];
    const res = resolveRound(state, pair);
    if (!res.ok) throw new Error(`AI produced illegal action: ${JSON.stringify(pair)} (${res.error})`);
    state = res.state;
  }

  return {
    winner: state.winner,
    plies: state.plies,
    walls: state.wallsPlaced,
    timeout: state.winner === null,
  };
}

export function runBatch(games, options = {}) {
  const stats = {
    games,
    win0: 0,
    win1: 0,
    draw: 0,
    timeout: 0,
    totalPlies: 0,
    totalWalls: 0,
    maxPlies: 0,
  };

  for (let i = 0; i < games; i++) {
    const seed = (options.seed ?? 12345) + i * 7919;
    const r = playGame({ ...options, seed });
    if (r.timeout || r.winner === null) stats.timeout += 1;
    else if (r.winner === 0) stats.win0 += 1;
    else if (r.winner === 1) stats.win1 += 1;
    else if (r.winner === "draw") stats.draw += 1;

    stats.totalPlies += r.plies;
    stats.totalWalls += r.walls;
    stats.maxPlies = Math.max(stats.maxPlies, r.plies);
  }

  const decided = stats.win0 + stats.win1;
  return {
    ...stats,
    avgPlies: +(stats.totalPlies / games).toFixed(1),
    avgWalls: +(stats.totalWalls / games).toFixed(1),
    drawRate: +(stats.draw / games).toFixed(3),
    win0Rate: +(stats.win0 / games).toFixed(3),
    win1Rate: +(stats.win1 / games).toFixed(3),
    firstPlayerWinRateAmongDecided: decided ? +(stats.win0 / decided).toFixed(3) : null,
  };
}
