/** T0 补核 + E2-0 离线路径脆弱性审计。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { cloneState, applyAction, validateAction, legalActions, distanceOf } from "../../src/rules.js";
import { debugPathCount } from "../../src/ai-master.js";
import { replayOpening } from "../p0/lib.mjs";

const OUT = "_extract/e2";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("_extract/b2b/games_raw.jsonl");
const h1 = rows.filter((r) => r.arm === "H1C");
const RISK = new Set(["hell_loss", "unfinished"]);
const opMap = new Map();
for (const l of readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  opMap.set(o.id, o);
}

function legalCount(s) {
  let n = 0;
  for (const a of legalActions(s)) if (validateAction(s, a).ok) n++;
  return n;
}
function ownExit(s, player) {
  if (s.players[player].r !== 0) return null;
  const t = cloneState(s); t.turn = player;
  const r = applyAction(t, { type: "move", dir: "up" });
  return r.ok && r.state.winner !== null ? r.state.winner : null;
}
function oppThreat(s, opp) {
  if (s.winner !== null || s.turn !== opp) return false;
  return ownExit(s, opp) === opp;
}

// ---- T0 补核 ----
const t0 = { decisions: 0, events: [], failures: 0, controls: 0 };
for (const r of h1) {
  const role = RISK.has(r.result) ? "failure" : "control";
  if (role === "failure") t0.failures++; else t0.controls++;
  let s = replayOpening(opMap.get(r.openingId).actions);
  for (let i = 0; i < r.actions.length; i++) {
    if (s.winner !== null) break;
    if (s.turn === r.seat) {
      t0.decisions++;
      const total = legalCount(s);
      const a = r.actions[i];
      const win = ownExit(s, r.seat);
      if (win !== null && !(a.type === "move" && a.dir === "up")) {
        t0.events.push({ key: `${r.openingId}-${r.seat}`, role, ply: s.plies,
          type: win === r.seat ? "missed-own-win" : "missed-own-draw", total });
      }
      const rr = applyAction(s, a);
      if (rr.ok && oppThreat(rr.state, 1 - r.seat)) {
        let safe = 0;
        for (const alt of legalActions(s)) {
          if (JSON.stringify(alt) === JSON.stringify(a)) continue;
          if (!validateAction(s, alt).ok) continue;
          const r2 = applyAction(s, alt);
          if (r2.ok && !oppThreat(r2.state, 1 - r.seat)) safe++;
        }
        t0.events.push({ key: `${r.openingId}-${r.seat}`, role, ply: s.plies,
          type: safe > 0 ? "avoidable-immediate-loss" : "no-safe-found", total, safe });
      }
    }
    const rr = applyAction(s, r.actions[i]);
    if (!rr.ok) break;
    s = rr.state;
  }
}
const t0Summary = {
  decisions: t0.decisions,
  failures: t0.failures,
  controls: t0.controls,
  missedWin: t0.events.filter((e) => e.type === "missed-own-win").length,
  missedDraw: t0.events.filter((e) => e.type === "missed-own-draw").length,
  avoidable: t0.events.filter((e) => e.type === "avoidable-immediate-loss").length,
  noSafeFound: t0.events.filter((e) => e.type === "no-safe-found").length,
  noSafeGames: [...new Set(t0.events.filter((e) => e.type === "no-safe-found").map((e) => e.key))].length,
  events: t0.events,
};
writeFileSync(`${OUT}/t0_close.json`, JSON.stringify(t0Summary, null, 1));

// ---- E2 采样 ----
function pickState(r) {
  let s = replayOpening(opMap.get(r.openingId).actions);
  let best = null, bestNet = -Infinity;
  for (let i = 0; i < r.actions.length; i++) {
    if (s.winner !== null) break;
    if (s.turn === r.seat) {
      const net = distanceOf(s, r.seat) - distanceOf(s, 1 - r.seat);
      if (net > bestNet) { bestNet = net; best = s; }
    }
    const rr = applyAction(s, r.actions[i]);
    if (!rr.ok) break;
    s = rr.state;
  }
  return best;
}
const controls = h1.filter((r) => r.result === "hell_win").slice(0, 8);
const risk = h1.filter((r) => RISK.has(r.result));
const cases = [];
for (const r of [...risk, ...controls]) {
  const st = pickState(r);
  if (st) cases.push({ key: `${r.openingId}-${r.seat}`, role: RISK.has(r.result) ? "risk" : "control", state: st });
}

function audit(state) {
  const U = state.turn, T = 1 - U;
  const dU0 = distanceOf(state, U), dT0 = distanceOf(state, T);
  const pU = [debugPathCount(state, U, 20), debugPathCount(state, U, 24)];
  const pT = [debugPathCount(state, T, 20), debugPathCount(state, T, 24)];
  let maxF = 0, maxSelf = 0, bestWall = null, high = 0;
  let oppState = cloneState(state); oppState.turn = T;
  for (const w of legalActions(oppState)) {
    if (w.type !== "wall") continue;
    if (!validateAction(oppState, w).ok) continue;
    const r = applyAction(oppState, w);
    if (!r.ok) continue;
    const dU1 = distanceOf(r.state, U), dT1 = distanceOf(r.state, T);
    const du = dU1 - dU0, dt = dT1 - dT0;
    const F = du - dt;
    if (du >= 3 && F >= 2) high++;
    if (F > maxF) { maxF = F; bestWall = w; maxSelf = du; }
  }
  return { dU0, dT0, pU, pT, maxF, maxSelf, bestWall, high };
}

const audits = [];
for (const c of cases) {
  const a = audit(c.state);
  audits.push({ key: c.key, role: c.role, ...a,
    exits: c.state.topWall.filter((x) => x === 0).length,
    wallsUsed: c.state.wallsUsed.slice() });
}
const agg = {};
for (const role of ["risk", "control"]) {
  const xs = audits.filter((x) => x.role === role);
  agg[role] = {
    states: xs.length,
    avgMaxF: Number((xs.reduce((s, x) => s + x.maxF, 0) / xs.length).toFixed(2)),
    maxF: Math.max(...xs.map((x) => x.maxF)),
    highStates: xs.filter((x) => x.high > 0).length,
    avgHigh: Number((xs.reduce((s, x) => s + x.high, 0) / xs.length).toFixed(1)),
  };
}
const out = {
  head: (() => { try { return process.env.GIT_HEAD || "unknown"; } catch { return "unknown"; } })(),
  t0: t0Summary,
  sample: { risk: risk.length, controls: controls.length, states: audits.length },
  agg,
  audits,
  hash: createHash("sha256").update(JSON.stringify(audits)).digest("hex").slice(0, 16),
};
writeFileSync(`${OUT}/e2_summary.json`, JSON.stringify(out, null, 1));
writeFileSync(`${OUT}/wall_audit.tsv`,
  ["key\trole\tdU\tdT\tpathU20\tpathU24\tpathT20\tpathT24\tmaxF\tmaxSelf\thighWalls\tbestWall"]
    .concat(audits.map((x) => [x.key, x.role, x.dU0, x.dT0, x.pU[0], x.pU[1], x.pT[0], x.pT[1],
      x.maxF, x.maxSelf, x.high, x.bestWall ? `${x.bestWall.kind}:${x.bestWall.c}:${x.bestWall.r}` : "-"].join("\t")))
    .join("\n") + "\n");
console.log(JSON.stringify({ t0: t0Summary, sample: out.sample, agg }, null, 1));
