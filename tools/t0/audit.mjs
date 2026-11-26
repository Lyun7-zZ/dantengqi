/** G-test-close + T0：证据冻结与即时战术事件筛选。 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction, validateAction, legalActions, distanceOf } from "../../src/rules.js";
import { replayOpening } from "../p0/lib.mjs";

const OUT = "_extract/t0";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ---- G-test-close ----
const g = load("_extract/gtest/games_raw.jsonl");
const g7 = g.filter((r) => r.arm === "G7"), g9 = g.filter((r) => r.arm === "G9");
const gk = (r) => `${r.openingId}-${r.seat}`;
const g7i = new Map(g7.map((r) => [gk(r), r])), g9i = new Map(g9.map((r) => [gk(r), r]));
const gProblems = [];
if (g7.length !== 40 || g9.length !== 40) gProblems.push("count");
if (new Set(g7.map(gk)).size !== 40 || new Set(g9.map(gk)).size !== 40) gProblems.push("dup");
for (const k of g7i.keys()) if (!g9i.has(k)) gProblems.push("missing " + k);
const go = [...new Set(g.map((r) => r.openingId))];
const cfg = [];
for (const f of ["G7-s0", "G9-s0"]) {
  const p = `_extract/gtest/runs/gtest/config_${f}.json`;
  if (existsSync(p)) {
    const c = JSON.parse(readFileSync(p, "utf8"));
    cfg.push({ arm: c.arm, maxDepth: c.candCfg.maxDepth, endgameDepth: c.candCfg.endgameDepth,
      buffer: c.candCfg.returnBuffer, cache: !!c.candCfg.pathCache, evalmode: c.candCfg.evalRaceMode,
      sourceCommit: c.sourceCommit });
  }
}
const gclose = {
  problems: gProblems, games: g.length, openings: go,
  config: cfg,
  maxExt: { G7: Math.max(...g7.map((r) => r.extMax)), G9: Math.max(...g9.map((r) => r.extMax)) },
  over: { G7: g7.reduce((s, r) => s + r.overCount, 0), G9: g9.reduce((s, r) => s + r.overCount, 0) },
  dataHash: createHash("sha256").update(JSON.stringify(g)).digest("hex").slice(0, 16),
};

// ---- T0 ----
const b2b = load("_extract/b2b/games_raw.jsonl");
const h1 = b2b.filter((r) => r.arm === "H1C");
const RISK = new Set(["hell_loss", "unfinished"]);
const opMap = new Map();
for (const l of readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  opMap.set(o.id, o);
}

function ownImmediate(s, player) {
  if (s.players[player].r !== 0) return null;
  const r = applyAction({ ...s, turn: player }, { type: "move", dir: "up" });
  return r.ok && r.state.winner !== null ? r.state.winner : null;
}
function opponentThreat(s, opp) {
  if (s.winner !== null || s.turn !== opp) return false;
  if (s.players[opp].r !== 0) return false;
  const r = applyAction(s, { type: "move", dir: "up" });
  return r.ok && r.state.winner === opp;
}
function safeAlternatives(state, seat, chosen) {
  const acts = legalActions(state);
  let safe = 0, total = 0;
  for (const a of acts) {
    if (JSON.stringify(a) === JSON.stringify(chosen)) continue;
    if (!validateAction(state, a).ok) continue;
    total++;
    const r = applyAction(state, a);
    if (!r.ok) continue;
    if (!opponentThreat(r.state, 1 - seat)) safe++;
  }
  return { safe, total };
}

const events = [];
for (const r of h1) {
  if (!opMap.has(r.openingId)) continue;
  let s = replayOpening(opMap.get(r.openingId).actions);
  const role = RISK.has(r.result) ? "failure" : "control";
  let lastLead = null;
  for (let i = 0; i < r.actions.length; i++) {
    if (s.winner !== null) break;
    const isCand = s.turn === r.seat;
    const a = r.actions[i];
    if (isCand) {
      const win = ownImmediate(s, r.seat);
      const dMe = distanceOf(s, r.seat), dOpp = distanceOf(s, 1 - r.seat);
      if (win === r.seat && !(a.type === "move" && a.dir === "up")) {
        events.push({ key: `${r.openingId}-${r.seat}`, role, ply: s.plies, type: "missed-own-win",
          action: a, evidence: "rule-proven" });
      } else if (win === "draw" && !(a.type === "move" && a.dir === "up")) {
        events.push({ key: `${r.openingId}-${r.seat}`, role, ply: s.plies, type: "missed-own-draw",
          action: a, evidence: "rule-proven" });
      }
      const rr = applyAction(s, a);
      if (rr.ok && opponentThreat(rr.state, 1 - r.seat)) {
        const alt = safeAlternatives(s, r.seat, a);
        events.push({ key: `${r.openingId}-${r.seat}`, role, ply: s.plies,
          type: alt.safe > 0 ? "avoidable-immediate-loss" : "unavoidable-immediate-loss",
          action: a, alternatives: alt, evidence: "rule-proven" });
      }
      // 领先但 20 手无进展
      if (Number.isFinite(dMe) && Number.isFinite(dOpp) && dOpp - dMe >= 2) {
        if (lastLead && dMe === lastLead.d && s.plies - lastLead.ply >= 20) {
          events.push({ key: `${r.openingId}-${r.seat}`, role, ply: s.plies, type: "lead-no-progress",
            dMe, dOpp, evidence: "replay-supported" });
        }
        if (!lastLead || dMe < lastLead.d) lastLead = { d: dMe, ply: s.plies };
      }
    }
    const rr = applyAction(s, a);
    if (!rr.ok) break;
    s = rr.state;
  }
}
writeFileSync(`${OUT}/failure_events.jsonl`, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

const avoidable = events.filter((e) => e.type === "avoidable-immediate-loss");
const avoidOpenings = new Set(avoidable.map((e) => e.key.split("-")[0]));
const summary = {
  events: events.length,
  missedOwnWin: events.filter((e) => e.type === "missed-own-win").length,
  missedOwnDraw: events.filter((e) => e.type === "missed-own-draw").length,
  avoidableLoss: avoidable.length,
  avoidableOpenings: [...avoidOpenings],
  unavoidableLoss: events.filter((e) => e.type === "unavoidable-immediate-loss").length,
  leadNoProgress: events.filter((e) => e.type === "lead-no-progress").length,
  t1Qualified: avoidOpenings.size >= 2,
};
writeFileSync(`${OUT}/t0_summary.json`, JSON.stringify({ gclose, summary }, null, 1));
console.log(JSON.stringify({ gclose, summary }, null, 1));
