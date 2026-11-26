/** E1a 资格：28 状态 legacy/race 对照、规则保护与成本。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createMasterAI } from "../../src/ai-master.js";
import { applyAction, createState } from "../../src/rules.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";
import { staticRaceResult } from "../../src/ai-master.js";

const OUT = "_extract/m2b1";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("_extract/b2b/games_raw.jsonl");
const h0 = rows.filter((r) => r.arm === "H0C");
const h1 = rows.filter((r) => r.arm === "H1C");
const key = (r) => `${r.openingId}-${r.seat}`;
const i0 = new Map(h0.map((r) => [key(r), r]));
const i1 = new Map(h1.map((r) => [key(r), r]));
const RISK = new Set(["hell_loss", "unfinished"]);

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
const cases = [];
for (const r of h1.filter((x) => RISK.has(x.result))) {
  cases.push({ key: key(r), role: "failure", result: r.result, state: stateAt(r, 0.7) });
}
for (const g of h0.filter((r) => RISK.has(r.result) && i1.get(key(r)).result === "hell_win").slice(0, 4)) {
  cases.push({ key: key(g), role: "gain", result: "hell_win", state: stateAt(g, 0.7) });
}
for (const r of h1.filter((x) => x.result === "hell_win").slice(0, 3)) {
  cases.push({ key: key(r), role: "win", result: "hell_win", state: stateAt(r, 0.7) });
}
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
  cases.push({ key: name, role: "rule", result: "-", state: build() });
}

function immExit(s) {
  const p = s.players[s.turn];
  if (p.r !== 0) return null;
  const r = applyAction(s, { type: "move", dir: "up" });
  return r.ok && r.state.winner !== null ? r.state.winner : null;
}

const trials = [];
for (const c of cases) {
  for (const mode of ["legacy", "race"]) {
    for (const depth of [5, 6, 7]) {
      const ai = createMasterAI(createGrandmasterPlusConfig({ timeMs: 120000, maxDepth: depth, evalRaceMode: mode }));
      const t0 = Date.now();
      const a = ai(c.state, makeRng(21000 + depth));
      trials.push({ key: c.key, role: c.role, mode, depth, action: a,
        score: ai.stats.lastLog.score, nodes: ai.stats.lastLog.nodes,
        wall: Date.now() - t0, race: staticRaceResult(c.state) });
    }
    const ai = createMasterAI(createGrandmasterPlusConfig({ evalRaceMode: mode }));
    const a = ai(c.state, makeRng(22000));
    trials.push({ key: c.key, role: c.role, mode, depth: "3s", action: a,
      score: ai.stats.lastLog.score, source: ai.stats.lastLog.source,
      tTotal: Math.round(ai.stats.lastLog.tTotal), nodes: ai.stats.lastLog.nodes,
      race: staticRaceResult(c.state) });
  }
}
writeFileSync(`${OUT}/eval_trace.jsonl`, trials.map((t) => JSON.stringify(t)).join("\n") + "\n");

const summary = { cases: cases.length };
for (const mode of ["legacy", "race"]) {
  const rs = trials.filter((t) => t.mode === mode && t.depth === 6);
  summary[`${mode}MedianMs`] = rs.map((r) => r.wall).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
}
summary.costPct = summary.legacyMedianMs
  ? Number((((summary.raceMedianMs - summary.legacyMedianMs) / summary.legacyMedianMs) * 100).toFixed(1))
  : 0;
// 立即越线保护
summary.missedImmediate = cases.filter((c) => immExit(c.state) !== null).filter((c) => {
  const t = trials.find((x) => x.key === c.key && x.mode === "race" && x.depth === "3s");
  return !(t.action.type === "move" && t.action.dir === "up");
}).length;
summary.ruleCases = cases.filter((c) => c.role === "rule").map((c) => {
  const t = trials.find((x) => x.key === c.key && x.mode === "race" && x.depth === "3s");
  return { key: c.key, immediate: immExit(c.state), action: t.action, race: t.race };
});
// 95-0/106-0 稳定性
summary.parityCases = ["95-0", "106-0"].map((k) => {
  const out = {};
  for (const mode of ["legacy", "race"]) {
    out[mode] = trials.filter((t) => t.key === k && t.mode === mode && typeof t.depth === "number")
      .map((t) => ({ d: t.depth, score: t.score, action: t.action }));
  }
  return { key: k, ...out };
});
writeFileSync(`${OUT}/qualification_summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
