/** V2-1a：32 状态全合法参考评估与基线动作对账。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction, validateAction, legalActions, distanceOf } from "../../src/rules.js";
import { debugEvalBreakdown } from "../../src/ai-master.js";
import { enablePathCache, disablePathCache } from "../../src/path-cache.js";
import { replayOpening } from "../p0/lib.mjs";

const OUT = "_extract/v21";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("_extract/b2b/games_raw.jsonl").filter((r) => r.arm === "H1C");
const RISK = new Set(["hell_loss", "unfinished"]);
const opMap = new Map();
for (const l of readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  opMap.set(o.id, o);
}
enablePathCache(200000, false);

function allLegal(s) {
  return legalActions(s).filter((a) => validateAction(s, a).ok);
}
function evalState(s) {
  return debugEvalBreakdown(s).eval;
}
function pick(r, frac) {
  let s = replayOpening(opMap.get(r.openingId).actions);
  const target = Math.max(0, Math.floor(r.actions.length * frac));
  let chosen = null, chosenAction = null;
  for (let i = 0; i < r.actions.length; i++) {
    if (s.winner !== null) break;
    if (s.turn === r.seat && i >= target) { chosen = s; chosenAction = r.actions[i]; break; }
    const rr = applyAction(s, r.actions[i]);
    if (!rr.ok) break;
    s = rr.state;
  }
  return { state: chosen, action: chosenAction };
}

const risk = rows.filter((r) => RISK.has(r.result)).sort((a, b) => a.openingId - b.openingId || a.seat - b.seat).slice(0, 16);
const controls = rows.filter((r) => r.result === "hell_win").sort((a, b) => a.openingId - b.openingId || a.seat - b.seat).slice(0, 8);
const cases = [];
for (const r of risk) {
  const p = pick(r, 0.6);
  if (p.state) cases.push({ key: `${r.openingId}-${r.seat}`, role: "risk", state: p.state, actual: p.action });
}
for (const r of controls) {
  const p = pick(r, 0.6);
  if (p.state) cases.push({ key: `${r.openingId}-${r.seat}`, role: "control", state: p.state, actual: p.action });
}
function build(name, fn) { cases.push({ key: name, role: "boundary", state: fn(), actual: null }); }
build("b-draw", () => { const s = createState(0); s.players = [{ c: 5, r: 0 }, { c: 6, r: 0 }]; return s; });
build("b-win", () => { const s = createState(0); s.players = [{ c: 5, r: 0 }, { c: 5, r: 1 }]; return s; });
build("b-second", () => { const s = createState(0); s.players = [{ c: 5, r: 1 }, { c: 6, r: 0 }]; s.turn = 1; return s; });
build("b-threat", () => { const s = createState(0); s.players = [{ c: 3, r: 1 }, { c: 6, r: 0 }]; return s; });
build("b-single", () => { const s = createState(0); s.players = [{ c: 4, r: 1 }, { c: 6, r: 2 }]; for (let c = 0; c < 10; c++) if (c !== 4) s.topWall[c] = 1; return s; });
build("b-equal", () => { const s = createState(0); s.players = [{ c: 3, r: 2 }, { c: 6, r: 2 }]; return s; });
build("b-lag1", () => { const s = createState(0); s.players = [{ c: 3, r: 2 }, { c: 6, r: 1 }]; return s; });
build("b-lead1", () => { const s = createState(0); s.players = [{ c: 3, r: 1 }, { c: 6, r: 2 }]; return s; });

function refValue(s, a, topOpp = 999) {
  const r1 = applyAction(s, a);
  if (!r1.ok) return null;
  if (r1.state.winner !== null) return r1.state.winner === "draw" ? 0 : (r1.state.winner === s.turn ? 1e6 : -1e6);
  const oppActs = allLegal(r1.state);
  let bestOpp = -Infinity;
  for (const oa of oppActs.slice(0, topOpp)) {
    const r2 = applyAction(r1.state, oa);
    if (!r2.ok) continue;
    const v = r2.state.winner !== null
      ? (r2.state.winner === "draw" ? 0 : 1e6)
      : evalState(r2.state);
    if (v > bestOpp) bestOpp = v;
  }
  if (bestOpp === -Infinity) return null;
  return -bestOpp;
}

const rowsOut = [];
const perCase = [];
for (const c of cases) {
  const acts = allLegal(c.state);
  const l1 = [];
  for (const a of acts) {
    const r1 = applyAction(c.state, a);
    if (!r1.ok) continue;
    const v = r1.state.winner === null ? -evalState(r1.state) : (r1.state.winner === "draw" ? 0 : (r1.state.winner === c.state.turn ? 1e6 : -1e6));
    l1.push({ a, v });
  }
  l1.sort((x, y) => y.v - x.v);
  const best = l1[0]?.v ?? null;
  const top = l1.slice(0, 6);
  if (c.actual && !top.some((x) => JSON.stringify(x.a) === JSON.stringify(c.actual))) {
    const av = l1.find((x) => JSON.stringify(x.a) === JSON.stringify(c.actual));
    if (av) top.push(av);
  }
  const l2 = top.map((x) => ({ ...x, v2: refValue(c.state, x.a) }));
  const valid = l2.filter((x) => x.v2 !== null);
  const refBest = valid.length ? Math.max(...valid.map((x) => x.v2)) : null;
  const R = valid.filter((x) => x.v2 >= refBest - 100);
  const actualKey = JSON.stringify(c.actual);
  const inR = c.actual ? R.some((x) => JSON.stringify(x.a) === actualKey) : null;
  const actualRank = c.actual ? l1.findIndex((x) => JSON.stringify(x.a) === actualKey) + 1 : null;
  perCase.push({ key: c.key, role: c.role, legal: acts.length, top: l1.length, valid: valid.length,
    refBest, inR, actualRank, actualInTop6: c.actual ? top.some((x) => JSON.stringify(x.a) === actualKey) : null,
    R: R.map((x) => x.a) });
  for (const x of l2) rowsOut.push({ key: c.key, role: c.role, action: x.a, l1: x.v, l2: x.v2,
    inR: R.some((y) => JSON.stringify(y.a) === JSON.stringify(x.a)) });
}
disablePathCache();

const summ = {};
for (const role of ["risk", "control", "boundary"]) {
  const xs = perCase.filter((x) => x.role === role);
  summ[role] = { states: xs.length, valid: xs.filter((x) => x.valid > 0).length,
    baselineInR: xs.filter((x) => x.inR === true).length, baselineInTop6: xs.filter((x) => x.actualInTop6 === true).length,
    medianRank: xs.filter((x) => x.actualRank).map((x) => x.actualRank).sort((a, b) => a - b)[Math.floor(xs.length / 2)] || null };
}
const out = { cases: perCase.length, summary: summ, hash: createHash("sha256").update(JSON.stringify(perCase)).digest("hex").slice(0, 16) };
writeFileSync(`${OUT}/coverage_summary.json`, JSON.stringify(out, null, 1));
writeFileSync(`${OUT}/reference_actions.jsonl`, rowsOut.map((x) => JSON.stringify(x)).join("\n") + "\n");
writeFileSync(`${OUT}/state_manifest.jsonl`, cases.map((c) => JSON.stringify({ key: c.key, role: c.role,
  turn: c.state.turn, firstPlayer: c.state.firstPlayer, plies: c.state.plies,
  players: c.state.players, exits: c.state.topWall.filter((x) => x === 0).length,
  actual: c.actual })).join("\n") + "\n");
console.log(JSON.stringify(out, null, 1));
