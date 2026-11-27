/** H-ACS：H-safe + 牵制威胁识别与保护候选（实验，默认关闭）。 */

import { applyAction, validateAction, legalActions, distanceOf } from "./rules.js";
import { debugEvalBreakdown } from "./ai-master.js";
import { hSafeChoose, actionAllowsLoss } from "./h-safe.js";

const WIN = 1e6;

function wallCenter(a) {
  if (a.kind === "v") return [a.c + 0.5, a.r];
  if (a.kind === "h") return [a.c, a.r + 0.5];
  return [a.c, 0.5];
}
function allLegal(s) {
  const out = [];
  for (const a of legalActions(s)) if (validateAction(s, a).ok) out.push(a);
  return out;
}
function oppValue(state, root) {
  // 对手最佳静态应手，折算到 root 视角
  let best = -Infinity;
  for (const a of allLegal(state)) {
    const r = applyAction(state, a);
    if (!r.ok) continue;
    const v = r.state.winner !== null
      ? (r.state.winner === "draw" ? 0 : r.state.winner === 1 - root ? WIN : -WIN)
      : debugEvalBreakdown(r.state).eval;
    if (v > best) best = v;
  }
  return best === -Infinity ? debugEvalBreakdown(state).eval : -best;
}

function containmentThreat(state, action, root) {
  const r = applyAction(state, action);
  if (!r.ok || r.state.winner !== null) return 0;
  const before = distanceOf(r.state, root);
  if (!Number.isFinite(before)) return 0;
  let worst = 0;
  for (const a of allLegal(r.state)) {
    if (a.type !== "wall") continue;
    const rr = applyAction(r.state, a);
    if (!rr.ok) continue;
    const after = distanceOf(rr.state, root);
    if (Number.isFinite(after)) worst = Math.max(worst, after - before);
  }
  return worst;
}

function protectCandidates(state, root, limit = 8) {
  const me = root;
  const p = state.players[me];
  const dM = distanceOf(state, me), dO = distanceOf(state, 1 - me);
  const out = [];
  for (const a of allLegal(state)) {
    if (a.type !== "wall") continue;
    const c = wallCenter(a);
    if (Math.abs(c[0] - p.c) + Math.abs(c[1] - p.r) > 2.5) continue;
    const r = applyAction(state, a);
    if (!r.ok) continue;
    const dm = distanceOf(r.state, me), dop = distanceOf(r.state, 1 - me);
    if (!Number.isFinite(dm) || dm - dM > 1) continue;
    if (!Number.isFinite(dop) || dop - dO < -0.5) continue;
    out.push({ a, dm, dop });
  }
  out.sort((x, y) => (x.dm - dM) - (y.dm - dM) || (y.dop - dO) - (x.dop - dO));
  return out.slice(0, limit).map((x) => x.a);
}

export function hAcsChoose(state, { timeMs = 3000, bufferMs = 100 } = {}) {
  const t0 = Date.now();
  const base = hSafeChoose(state, { timeMs, bufferMs });
  if (base.source === "safe") return { ...base, acs: false, threat: 0, reason: "safety" };
  const root = state.turn;
  const threat = containmentThreat(state, base.action, root);
  if (threat < 2) return { ...base, acs: false, threat, reason: "no-threat" };

  const baseVal = oppValue(applyAction(state, base.action).state, root);
  let best = base.action, bestVal = baseVal, source = base.source, acs = false;
  for (const a of protectCandidates(state, root)) {
    if (actionAllowsLoss(state, a)) continue;
    const r = applyAction(state, a);
    if (!r.ok) continue;
    const v = r.state.winner !== null ? (r.state.winner === "draw" ? 0 : r.state.winner === root ? WIN : -WIN) : oppValue(r.state, root);
    if (v > bestVal + 20) { bestVal = v; best = a; source = "acs-protect"; acs = true; }
  }
  return { ...base, action: best, source, acs, threat, tTotal: Date.now() - t0,
    legal: !!(best && validateAction(state, best).ok) };
}
