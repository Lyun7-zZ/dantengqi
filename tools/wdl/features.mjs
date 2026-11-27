/** W0：局面特征提取（独立离线）。 */

import { distanceOf, legalActions, validateAction } from "../../src/rules.js";
import { debugEvalBreakdown, debugPathCount } from "../../src/ai-master.js";

export const FEATURE_VERSION = "w0.1";

export function extractFeatures(state, seat) {
  const opp = 1 - seat;
  const dM = distanceOf(state, seat);
  const dO = distanceOf(state, opp);
  const exits = state.topWall.filter((x) => x === 0).length;
  const pathMe = debugPathCount(state, seat, 24);
  const pathOpp = debugPathCount(state, opp, 24);
  let mobilityMe = 0, mobilityOpp = 0;
  for (const a of legalActions(state)) {
    if (a.type !== "move" || !validateAction(state, a).ok) continue;
    if (state.turn === seat) mobilityMe++; else mobilityOpp++;
  }
  const ev = debugEvalBreakdown(state).eval;
  return {
    dM, dO, M: dO - dM,
    firstIsMe: state.firstPlayer === seat ? 1 : 0,
    exits,
    wallsUsedMe: state.wallsUsed[seat],
    wallsUsedOpp: state.wallsUsed[opp],
    pathMe, pathOpp,
    pathSatMe: pathMe >= 24 ? 1 : 0,
    pathSatOpp: pathOpp >= 24 ? 1 : 0,
    mobilityMe, mobilityOpp,
    ply: state.plies,
    legacyEval: ev,
    oppAtExit: dO === 1 ? 1 : 0,
    meAtExit: dM === 1 ? 1 : 0,
  };
}

export const FEATURE_KEYS = [
  "dM", "dO", "M", "firstIsMe", "exits", "wallsUsedMe", "wallsUsedOpp",
  "pathMe", "pathOpp", "pathSatMe", "pathSatOpp", "mobilityMe", "mobilityOpp",
  "ply", "legacyEval", "oppAtExit", "meAtExit",
];

export function toVector(f, keys) {
  return keys.map((k) => {
    const v = f[k];
    return Number.isFinite(v) ? v : 0;
  });
}
