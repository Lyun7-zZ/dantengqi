/** S0 测试状态集：16 个历史 + 8 个构造。 */

import { readFileSync } from "node:fs";
import { createState, applyAction, distanceOf } from "../../src/rules.js";
import { replayOpening } from "../p0/lib.mjs";

const rows = readFileSync("_extract/b2b/games_raw.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const h1 = rows.filter((r) => r.arm === "H1C");
const b2rows = readFileSync("_extract/b2/games_raw.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const b2 = b2rows.filter((r) => r.arm === "B2-1");
const b2op = new Map();
for (const l of readFileSync("_extract/b2/runs/b2/openings_75_94.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  b2op.set(o.id, o);
}
const RISK = new Set(["hell_loss", "unfinished"]);
const opMap = new Map();
for (const l of readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  opMap.set(o.id, o);
}
function stateAt(r, frac) {
  let s = replayOpening(opMap.get(r.openingId).actions);
  const target = Math.floor(r.actions.length * frac);
  for (let i = 0; i < r.actions.length; i++) {
    if (s.winner !== null) break;
    if (s.turn === r.seat && i >= target) return s;
    const rr = applyAction(s, r.actions[i]);
    if (!rr.ok) break;
    s = rr.state;
  }
  return null;
}

function mk(name, category, p0, p1, turn, walls = []) {
  let s = createState(0);
  s.players = [{ c: p0[0], r: p0[1] }, { c: p1[0], r: p1[1] }];
  for (const w of walls) {
    const r = applyAction(s, { type: "wall", ...w });
    if (r.ok) s = r.state;
  }
  s.turn = turn;
  if (!Number.isFinite(distanceOf(s, 0)) || !Number.isFinite(distanceOf(s, 1))) return null;
  return { name, category, state: s };
}

export function buildStates() {
  const out = [];
  const risk = h1.filter((r) => RISK.has(r.result)).sort((a, b) => a.openingId - b.openingId || a.seat - b.seat).slice(0, 8);
  const wins = h1.filter((r) => r.result === "hell_win").sort((a, b) => a.openingId - b.openingId || a.seat - b.seat).slice(0, 8);  for (const r of risk) {
    const st = stateAt(r, 0.6);
    if (st) out.push({ name: `hist-risk-${r.openingId}-${r.seat}`, category: "historical-risk", state: st });
  }
  for (const r of wins) {
    const st = stateAt(r, 0.6);
    if (st) out.push({ name: `hist-win-${r.openingId}-${r.seat}`, category: "historical-win", state: st });
  }
  const sbpWalls = [
    { kind: "h", c: 0, r: 10 }, { kind: "h", c: 1, r: 9 },
    { kind: "v", c: 7, r: 10 }, { kind: "v", c: 7, r: 11 },
    { kind: "h", c: 9, r: 9 },
  ];
  const extra = [
    mk("sbp-pocket", "protect-effective", [9, 11], [0, 11], 0, sbpWalls),
    mk("complex-D12-H11", "complex", [3, 11], [7, 10], 0, [
      { kind: "h", c: 3, r: 10 }, { kind: "h", c: 7, r: 9 },
    ]),
    mk("open-race", "open", [0, 11], [9, 11], 0),
    mk("open-mid", "open", [2, 8], [7, 8], 0),
    mk("attack-near", "attack", [9, 11], [5, 0], 0),
    mk("attack-near-2", "attack", [0, 11], [4, 0], 0),
    mk("both-protect", "protect-both", [0, 11], [9, 11], 0, [
      { kind: "v", c: 0, r: 11 }, { kind: "v", c: 8, r: 11 },
    ]),
    mk("multi-step", "multi-step", [4, 10], [5, 10], 0, [
      { kind: "h", c: 4, r: 9 }, { kind: "h", c: 5, r: 9 },
    ]),
  ].filter(Boolean);
  return [...out, ...extra];
}

/** 12 个保留状态：B2 批次（75–94），与开发集不同开局。 */
export function buildHoldout() {
  const out = [];
  const risk = b2.filter((r) => RISK.has(r.result)).sort((a, b) => a.openingId - b.openingId || a.seat - b.seat).slice(0, 6);
  const wins = b2.filter((r) => r.result === "hell_win").sort((a, b) => a.openingId - b.openingId || a.seat - b.seat).slice(0, 6);
  for (const r of [...risk, ...wins]) {
    if (!b2op.has(r.openingId)) continue;
    let s = replayOpening(b2op.get(r.openingId).actions);
    const target = Math.floor(r.actions.length * 0.6);
    let chosen = null;
    for (let i = 0; i < r.actions.length; i++) {
      if (s.winner !== null) break;
      if (s.turn === r.seat && i >= target) { chosen = s; break; }
      const rr = applyAction(s, r.actions[i]);
      if (!rr.ok) break;
      s = rr.state;
    }
    if (chosen) out.push({ name: `hold-${RISK.has(r.result) ? "risk" : "win"}-${r.openingId}-${r.seat}`,
      category: RISK.has(r.result) ? "holdout-risk" : "holdout-win", state: chosen });
  }
  return out;
}
