// P0 公共库：开局库、结果映射、汇总。

import { createState, applyAction, legalDirs, validateAction } from "../../src/rules.js";
import { shortestPathWalls } from "../../src/path.js";

export const PLY_CAP = 240;

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成固定 6 手开局；返回 { id, actions }，保证不提前终局。 */
export function makeOpenings(count, seedBase = 9000) {
  const out = [];
  for (let id = 0; id < count; id++) {
    const rng = makeRng(seedBase + id);
    let s = createState(0, { drawMode: "firstOnly" });
    const actions = [];
    let ok = true;
    for (let ply = 0; ply < 6; ply++) {
      const a = randomOpeningAction(s, rng);
      if (!a) { ok = false; break; }
      const r = applyAction(s, a);
      if (!r.ok) { ok = false; break; }
      s = r.state;
      actions.push(a);
      if (s.winner !== null) { ok = false; break; }
    }
    if (ok) out.push({ id, actions });
  }
  return out;
}

function randomOpeningAction(state, rng) {
  const acts = [];
  const me = state.turn;
  const p = state.players[me];
  for (const dir of legalDirs(state, p.c, p.r)) acts.push({ type: "move", dir });
  for (const w of shortestPathWalls(state, state.players[0].c, state.players[0].r)) acts.push(w);
  for (const w of shortestPathWalls(state, state.players[1].c, state.players[1].r)) acts.push(w);
  for (let i = acts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [acts[i], acts[j]] = [acts[j], acts[i]];
  }
  for (const a of acts) if (validateAction(state, a).ok) return a;
  return null;
}

/** 从固定动作序列重放，得到开局状态。 */
export function replayOpening(actions) {
  let s = createState(0, { drawMode: "firstOnly" });
  for (const a of actions) {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error("opening illegal: " + r.error);
    s = r.state;
  }
  return s;
}

/** 结果映射：未完成必须单列，不能当平局。 */
export function mapOutcome(winner, hellSide, plies) {
  if (winner === null || winner === undefined) {
    return { result: "unfinished", endReason: "ply_cap", adjudication: "aborted", isCompleted: false };
  }
  const endReason = "normal_terminal";
  const adjudication = "rules";
  if (winner === "draw") return { result: "draw", endReason, adjudication, isCompleted: true };
  if (winner === hellSide) return { result: "hell_win", endReason, adjudication, isCompleted: true };
  return { result: "hell_loss", endReason, adjudication, isCompleted: true };
}

export function summarize(records) {
  const counts = { hell_win: 0, draw: 0, hell_loss: 0, unfinished: 0 };
  const reasons = {};
  const seats = { 0: { win: 0, draw: 0, loss: 0, unfinished: 0 }, 1: { win: 0, draw: 0, loss: 0, unfinished: 0 } };
  for (const r of records) {
    if (!(r.result in counts)) throw new Error("bad result: " + r.result);
    counts[r.result]++;
    reasons[r.endReason] = (reasons[r.endReason] ?? 0) + 1;
    const s = seats[r.seat];
    if (r.result === "hell_win") s.win++;
    else if (r.result === "draw") s.draw++;
    else if (r.result === "hell_loss") s.loss++;
    else s.unfinished++;
  }
  const total = records.length;
  const completed = total - counts.unfinished;
  return {
    total,
    ...counts,
    completed,
    completionRate: total ? Number((completed / total).toFixed(4)) : 0,
    winRate: total ? Number((counts.hell_win / total).toFixed(4)) : 0,
    winRateCompleted: completed ? Number((counts.hell_win / completed).toFixed(4)) : 0,
    drawRate: total ? Number((counts.draw / total).toFixed(4)) : 0,
    lossRate: total ? Number((counts.hell_loss / total).toFixed(4)) : 0,
    score: total ? Number(((counts.hell_win + 0.5 * counts.draw) / total).toFixed(4)) : 0,
    reasons,
    seats,
  };
}
