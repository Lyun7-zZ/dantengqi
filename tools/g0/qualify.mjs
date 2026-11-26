/** G0-qual：G7+ / G9+ 固定状态资格（3s，缓存关闭）。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createMasterAI } from "../../src/ai-master.js";
import { applyAction, validateAction, createState } from "../../src/rules.js";
import { createGrandmasterConfig } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/g0";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("_extract/b2b/games_raw.jsonl");
const h0 = rows.filter((r) => r.arm === "H0C");
const h1 = rows.filter((r) => r.arm === "H1C");
const i0 = new Map(h0.map((r) => [`${r.openingId}-${r.seat}`, r]));
const i1 = new Map(h1.map((r) => [`${r.openingId}-${r.seat}`, r]));
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
for (const r of h1.filter((x) => RISK.has(x.result))) cases.push({ key: `${r.openingId}-${r.seat}`, role: "failure", state: stateAt(r, 0.7) });
for (const r of h1.filter((x) => x.result === "hell_win").slice(0, 3)) cases.push({ key: `${r.openingId}-${r.seat}`, role: "win", state: stateAt(r, 0.7) });
for (const [name, build] of [
  ["rule-draw", () => { const s = createState(0); s.players = [{ c: 5, r: 0 }, { c: 6, r: 0 }]; return s; }],
  ["rule-win", () => { const s = createState(0); s.players = [{ c: 5, r: 0 }, { c: 5, r: 1 }]; return s; }],
  ["rule-threat", () => { const s = createState(0); s.players = [{ c: 3, r: 1 }, { c: 6, r: 0 }]; return s; }],
  ["rule-single", () => { const s = createState(0); s.players = [{ c: 4, r: 1 }, { c: 6, r: 2 }]; for (let c = 0; c < 10; c++) if (c !== 4) s.topWall[c] = 1; return s; }],
]) cases.push({ key: name, role: "rule", state: build() });

const trials = [];
for (const c of cases) {
  for (const depth of [7, 9]) {
    for (let rep = 0; rep < 2; rep++) {
      const ai = createMasterAI(createGrandmasterConfig({ maxDepth: depth, returnBuffer: 100, pathCache: false }));
      const t0 = Date.now();
      const a = ai(c.state, makeRng(41000 + depth * 10 + rep));
      const log = ai.stats.lastLog;
      trials.push({ key: c.key, role: c.role, depthLimit: depth, rep,
        action: a, legal: validateAction(c.state, a).ok,
        tTotal: Math.round(log.tTotal ?? 0), wall: Date.now() - t0,
        depth: log.depthLast, nodes: log.nodes, source: log.source });
    }
  }
}
writeFileSync(`${OUT}/g_qualify.jsonl`, trials.map((t) => JSON.stringify(t)).join("\n") + "\n");

const summary = {};
for (const d of [7, 9]) {
  const rs = trials.filter((t) => t.depthLimit === d);
  summary[`G${d}+`] = {
    runs: rs.length,
    illegal: rs.filter((t) => !t.legal).length,
    maxTotal: Math.max(...rs.map((t) => t.tTotal)),
    over3000: rs.filter((t) => t.tTotal > 3000).length,
    avgDepth: Number((rs.reduce((s, t) => s + (t.depth || 0), 0) / rs.length).toFixed(2)),
    avgNodes: Math.round(rs.reduce((s, t) => s + (t.nodes || 0), 0) / rs.length),
  };
}
writeFileSync(`${OUT}/g_qualify_summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
