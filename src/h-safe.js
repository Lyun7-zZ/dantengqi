/** H-safe：H1+C 动作 + 一步安全检查（实验，默认关闭）。 */

import { applyAction, validateAction, legalActions, distanceOf } from "./rules.js";
import { createMasterAI, debugEvalBreakdown } from "./ai-master.js";
import { createGrandmasterPlusConfig } from "./plus-config.js";

const WIN = 1e6;
const rng = () => 0.5;

export function immediateWin(state, player) {
  if (state.winner !== null) return state.winner;
  if (state.turn !== player) return null;
  if (state.players[player].r !== 0) return null;
  const r = applyAction(state, { type: "move", dir: "up" });
  if (!r.ok) return null;
  return r.state.winner;
}

export function actionAllowsLoss(state, action) {
  const r = applyAction(state, action);
  if (!r.ok) return true;
  if (r.state.winner !== null) return false;
  return immediateWin(r.state, 1 - state.turn) === 1 - state.turn;
}

function safeAlternatives(state) {
  const out = [];
  for (const a of legalActions(state)) {
    if (!validateAction(state, a).ok) continue;
    const r = applyAction(state, a);
    if (!r.ok) continue;
    if (r.state.winner !== null) {
      out.push({ a, v: r.state.winner === "draw" ? 0 : r.state.winner === state.turn ? WIN : -WIN });
      continue;
    }
    if (immediateWin(r.state, 1 - state.turn) === 1 - state.turn) continue;
    out.push({ a, v: debugEvalBreakdown(r.state).eval });
  }
  out.sort((x, y) => y.v - x.v);
  return out;
}

/**
 * 先跑 H1+C，再对返回动作做一步安全检查。
 * @param {object} state
 * @param {{timeMs?:number, bufferMs?:number}} opts
 */
export function hSafeChoose(state, { timeMs = 3000, bufferMs = 100 } = {}) {
  const t0 = Date.now();
  const ai = createMasterAI(createGrandmasterPlusConfig({ pathCache: true, timeMs: Math.max(500, timeMs - 250), returnBuffer: bufferMs }));
  const h1Action = ai(state, rng);
  const log = ai.stats.lastLog;
  const unsafe = actionAllowsLoss(state, h1Action);
  let action = h1Action;
  let source = "h1";
  if (unsafe) {
    const alts = safeAlternatives(state);
    if (alts.length) { action = alts[0].a; source = "safe"; }
  }
  return { action, source, h1Action, unsafe, tTotal: Date.now() - t0,
    tH1: Math.round(log.tTotal ?? 0), legal: !!(action && validateAction(state, action).ok) };
}
