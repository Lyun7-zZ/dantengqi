/**
 * S0 多策略对抗规划原型（实验，默认不接入生产）。
 *
 * 目标：以 ACS（抗牵制）净步数差为核心，比较推进/进攻/保护/多步策略。
 * 不使用固定坐标特例，不强制自封。
 */

import { applyAction, validateAction, legalActions, distanceOf } from "./rules.js";

const WIN = 1e6;

function legalActionsAll(state) {
  const out = [];
  for (const a of legalActions(state)) if (validateAction(state, a).ok) out.push(a);
  return out;
}

function terminalValue(state, root) {
  if (state.winner === null) return null;
  if (state.winner === "draw") return 0;
  return state.winner === root ? WIN : -WIN;
}

function margin(state, root) {
  const dm = distanceOf(state, root);
  const dop = distanceOf(state, 1 - root);
  if (!Number.isFinite(dm) || !Number.isFinite(dop)) return -WIN / 2;
  return dop - dm;
}

/** 墙排序：进攻收益优先，其次保持己方距离。 */
function rankWalls(state, root, limit) {
  const me = root, opp = 1 - root;
  const dM = distanceOf(state, me), dO = distanceOf(state, opp);
  const out = [];
  for (const a of legalActionsAll(state)) {
    if (a.type !== "wall") continue;
    const r = applyAction(state, a);
    if (!r.ok) continue;
    const dm = distanceOf(r.state, me), dop = distanceOf(r.state, opp);
    const du = Number.isFinite(dm) ? dm - dM : 100;
    const dv = Number.isFinite(dop) ? dop - dO : 100;
    let s = dv * 2 - du * 2;
    if (du === 0 && dv <= 0) s += 0.2;
    out.push({ a, s, du, dv });
  }
  out.sort((x, y) => y.s - x.s);
  return out.slice(0, limit);
}

function proposals(state, root) {
  const moves = legalActionsAll(state).filter((a) => a.type === "move");
  const walls = rankWalls(state, root, 14);
  const protect = rankWalls(state, root, 80).filter((w) => w.du === 0 && w.dv <= 0).slice(0, 4);
  const out = [];
  const seen = new Set();
  const add = (a, source) => {
    const k = a.type === "move" ? `m:${a.dir}` : `w:${a.kind}:${a.c}:${a.r}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ a, source });
  };
  for (const m of moves) add(m, "advance");
  for (const w of walls) add(w.a, w.du === 0 && w.dv <= 0 ? "protect" : "attack");
  for (const w of protect) add(w.a, "protect");
  return out;
}

function bestFollowup(state, root) {
  const moves = legalActionsAll(state).filter((a) => a.type === "move");
  let best = null, bestM = -Infinity;
  for (const a of moves) {
    const r = applyAction(state, a);
    if (!r.ok) continue;
    const v = terminalValue(r.state, root);
    const m = v !== null ? (v > 0 ? WIN : v < 0 ? -WIN : 0) : margin(r.state, root);
    if (m > bestM) { bestM = m; best = a; }
  }
  return { action: best, value: bestM };
}

function opponentReplies(state, root) {
  const opp = 1 - root;
  const moves = legalActionsAll(state).filter((a) => a.type === "move");
  const walls = rankWalls(state, opp, 8).map((w) => w.a);
  return [...moves, ...walls];
}

/**
 * @param {object} state 规则状态
 * @param {{timeMs?:number, bufferMs?:number, seed?:number}} opts
 */
export function s0Choose(state, { timeMs = 3000, bufferMs = 100, maxCandidates = 18 } = {}) {
  const root = state.turn;
  const start = Date.now();
  const deadline = start + Math.max(50, timeMs - bufferMs);
  const M0 = margin(state, root);
  const cands = proposals(state, root).slice(0, maxCandidates);
  let nodes = 0, best = null, bestScore = -Infinity, bestSource = null;
  const strategies = {};

  for (const c of cands) {
    if (Date.now() >= deadline) break;
    const r1 = applyAction(state, c.a);
    if (!r1.ok) continue;
    nodes++;
    let cv;
    const tv = terminalValue(r1.state, root);
    if (tv !== null) cv = tv;
    else {
      const replies = opponentReplies(r1.state, root);
      let worst = Infinity;
      for (const b of replies) {
        const r2 = applyAction(r1.state, b);
        if (!r2.ok) continue;
        nodes++;
        const tv2 = terminalValue(r2.state, root);
        let v;
        if (tv2 !== null) v = tv2;
        else {
          const fu = bestFollowup(r2.state, root);
          nodes++;
          v = fu.value;
        }
        if (v < worst) worst = v;
        if (worst <= -WIN) break;
      }
      cv = worst === Infinity ? margin(r1.state, root) : worst;
    }
    const s = c.a.type === "move" ? "advance" : c.source;
    strategies[s] = (strategies[s] || 0) + 1;
    if (cv > bestScore) { bestScore = cv; best = c.a; bestSource = s; }
  }

  const elapsed = Date.now() - start;
  return {
    action: best || legalActionsAll(state)[0],
    source: bestSource,
    score: bestScore,
    M0,
    A1: bestScore,
    R1: M0 - bestScore,
    nodes,
    elapsed,
    strategies,
    root,
  };
}
