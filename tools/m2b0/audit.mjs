/** M2b-0：失败口径对账、评估审计、固定深度奇偶与规则检查。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createMasterAI, debugEvalBreakdown } from "../../src/ai-master.js";
import { createState, applyAction, validateAction, distanceOf } from "../../src/rules.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/m2b0";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("_extract/b2b/games_raw.jsonl");
const h0 = rows.filter((r) => r.arm === "H0C");
const h1 = rows.filter((r) => r.arm === "H1C");
const key = (r) => `${r.openingId}-${r.seat}`;
const i0 = new Map(h0.map((r) => [key(r), r]));
const i1 = new Map(h1.map((r) => [key(r), r]));
const keys = [...i0.keys()].sort();

const RISK = new Set(["hell_loss", "unfinished"]);
const recon = {
  commonRisk: 0, commonLoss: 0, newRisk: 0, nonWinToRisk: 0,
  h0WinH1Risk: 0, h0DrawH1Risk: 0, h0RiskH1Win: 0,
};
for (const k of keys) {
  const a = i0.get(k).result, b = i1.get(k).result;
  if (RISK.has(a) && RISK.has(b)) {
    recon.commonRisk++;
    if (a === "hell_loss" && b === "hell_loss") recon.commonLoss++;
  }
  if (!RISK.has(a) && RISK.has(b)) {
    recon.newRisk++;
    if (a === "hell_win") recon.h0WinH1Risk++;
    if (a === "draw") recon.h0DrawH1Risk++;
    recon.nonWinToRisk++;
  }
  if (RISK.has(a) && b === "hell_win") recon.h0RiskH1Win++;
}

const opMap = new Map();
for (const l of readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  opMap.set(o.id, o);
}
function stateAt(r, frac) {
  let s = replayOpening(opMap.get(r.openingId).actions);
  const n = Math.max(0, Math.min(r.actions.length - 1, Math.floor(r.actions.length * frac)));
  for (let i = 0; i < n; i++) {
    const rr = applyAction(s, r.actions[i]);
    if (!rr.ok || rr.state.winner !== null) break;
    s = rr.state;
  }
  return s;
}
function immExit(s) {
  const p = s.players[s.turn];
  if (p.r !== 0) return null;
  const r = applyAction(s, { type: "move", dir: "up" });
  return r.ok && r.state.winner !== null ? r.state.winner : null;
}

const cases = [];
const failRows = h1.filter((r) => RISK.has(r.result));
for (const r of failRows) {
  cases.push({ key: key(r), role: "failure", result: r.result, h0: i0.get(key(r)).result, frac: 0.7, state: stateAt(r, 0.7) });
}
for (const g of h0.filter((r) => RISK.has(r.result) && i1.get(key(r)).result === "hell_win").slice(0, 4)) {
  cases.push({ key: key(g), role: "gain", result: "hell_win", h0: g.result, frac: 0.7, state: stateAt(g, 0.7) });
}
const winControls = h1.filter((r) => r.result === "hell_win").slice(0, 3);
for (const r of winControls) cases.push({ key: key(r), role: "win", result: "hell_win", h0: i0.get(key(r)).result, frac: 0.7, state: stateAt(r, 0.7) });
// 规则边界状态
for (const [name, build] of [
  ["rule-first-can-only-draw", () => {
    const s = createState(0);
    s.players = [{ c: 5, r: 0 }, { c: 5, r: 1 }];
    return s;
  }],
  ["rule-second-exit-wins", () => {
    const s = createState(0);
    s.players = [{ c: 5, r: 1 }, { c: 5, r: 0 }];
    s.turn = 1;
    return s;
  }],
  ["rule-single-exit", () => {
    const s = createState(0);
    s.players = [{ c: 4, r: 1 }, { c: 6, r: 2 }];
    for (let c = 0; c < 10; c++) if (c !== 4) s.topWall[c] = 1;
    return s;
  }],
  ["rule-opponent-threat", () => {
    const s = createState(0);
    s.players = [{ c: 3, r: 1 }, { c: 6, r: 0 }];
    return s;
  }],
]) {
  cases.push({ key: name, role: "rule", result: "-", h0: "-", frac: 0, state: build() });
}

const trials = [];
for (const c of cases) {
  const ev = debugEvalBreakdown(c.state);
  const immediate = immExit(c.state);
  for (const depth of [5, 6, 7]) {
    const ai = createMasterAI(createGrandmasterPlusConfig({ timeMs: 120000, maxDepth: depth }));
    const a = ai(c.state, makeRng(11000 + depth));
    const log = ai.stats.lastLog;
    trials.push({ key: c.key, role: c.role, result: c.result, h0: c.h0, frac: c.frac, depth,
      action: a, score: log.score, depthDone: log.depthLast, nodes: log.nodes, source: log.source, eval: ev, immediate });
  }
  const ai = createMasterAI(createGrandmasterPlusConfig());
  const a = ai(c.state, makeRng(12000));
  const log = ai.stats.lastLog;
  trials.push({ key: c.key, role: c.role, result: c.result, h0: c.h0, frac: c.frac, depth: "3s",
    action: a, score: log.score, depthDone: log.depthLast, nodes: log.nodes, source: log.source,
    tTotal: Math.round(log.tTotal), eval: ev, immediate });
}
writeFileSync(`${OUT}/state_cases.jsonl`, cases.map((c) => JSON.stringify({ ...c, state: undefined })).join("\n") + "\n");
writeFileSync(`${OUT}/trials.jsonl`, trials.map((t) => JSON.stringify(t)).join("\n") + "\n");
writeFileSync(`${OUT}/reconcile.json`, JSON.stringify(recon, null, 1));

// 奇偶：同状态 depth5/6/7 的分数符号与动作
const parity = [];
for (const c of cases) {
  const rs = trials.filter((t) => t.key === c.key && typeof t.depth === "number");
  const actions = rs.map((t) => JSON.stringify(t.action));
  const scores = rs.map((t) => t.score);
  const signs = scores.map((s) => Math.sign(s));
  parity.push({
    key: c.key, role: c.role, actions, scores,
    actionUnstable: new Set(actions).size > 1,
    signUnstable: new Set(signs).size > 1,
  });
}
writeFileSync(`${OUT}/parity.json`, JSON.stringify(parity, null, 1));

// 立即终局被忽略的案例
const missed = trials.filter((t) => t.depth === "3s" && t.immediate !== null)
  .filter((t) => !(t.action.type === "move" && t.action.dir === "up"));
writeFileSync(`${OUT}/missed_immediate.json`, JSON.stringify(missed, null, 1));
console.log(JSON.stringify({
  recon, cases: cases.length,
  parityUnstable: parity.filter((p) => p.actionUnstable).length,
  signUnstable: parity.filter((p) => p.signUnstable).length,
  missedImmediate: missed.length,
}, null, 1));
