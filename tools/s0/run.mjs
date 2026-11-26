/** S0 资格：H1+C vs S0 同状态对比。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { applyAction, distanceOf, validateAction } from "../../src/rules.js";
import { createMasterAI } from "../../src/ai-master.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { s0Choose } from "../../src/s0-planner.js";
import { buildStates } from "./states.mjs";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/s0";
mkdirSync(OUT, { recursive: true });
const states = buildStates();
const rows = [];
for (const item of states) {
  const s = item.state;
  const M0 = distanceOf(s, 1 - s.turn) - distanceOf(s, s.turn);

  const h1 = createMasterAI(createGrandmasterPlusConfig({ pathCache: true }));
  const a1 = h1(s, makeRng(81000));
  const l1 = h1.stats.lastLog;
  const r1 = a1 ? applyAction(s, a1) : { ok: false };
  const M1 = r1.ok ? distanceOf(r1.state, 1 - s.turn) - distanceOf(r1.state, s.turn) : null;

  const t0 = Date.now();
  const s0 = s0Choose(s, { timeMs: 3000, bufferMs: 100 });
  const r2 = s0.action ? applyAction(s, s0.action) : { ok: false };
  const M2 = r2.ok ? distanceOf(r2.state, 1 - s.turn) - distanceOf(r2.state, s.turn) : null;

  rows.push({
    name: item.name, category: item.category,
    M0,
    h1: { action: a1, source: l1.source, M1, tTotal: Math.round(l1.tTotal ?? 0), depth: l1.depthLast, legal: !!(a1 && validateAction(s, a1).ok) },
    s0: { action: s0.action, source: s0.source, M1: M2, score: s0.score, nodes: s0.nodes,
      elapsed: s0.elapsed, strategies: s0.strategies, legal: !!(s0.action && validateAction(s, s0.action).ok) },
    diffM: M2 !== null && M1 !== null ? M2 - M1 : null,
  });
}
writeFileSync(`${OUT}/cases.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const byCat = {};
for (const r of rows) {
  byCat[r.category] = byCat[r.category] || { n: 0, s0Sources: {}, h1Sources: {}, diff: [] };
  byCat[r.category].n++;
  byCat[r.category].s0Sources[r.s0.source] = (byCat[r.category].s0Sources[r.s0.source] || 0) + 1;
  byCat[r.category].h1Sources[r.h1.source] = (byCat[r.category].h1Sources[r.h1.source] || 0) + 1;
  if (r.diffM !== null) byCat[r.category].diff.push(r.diffM);
}
const summary = {
  states: rows.length,
  categories: byCat,
  illegal: rows.filter((r) => !r.h1.legal || !r.s0.legal).length,
  maxS0Ms: Math.max(...rows.map((r) => r.s0.elapsed)),
  maxH1Ms: Math.max(...rows.map((r) => r.h1.tTotal)),
  s0Sources: rows.reduce((m, r) => { m[r.s0.source] = (m[r.s0.source] || 0) + 1; return m; }, {}),
  avgDiffM: rows.filter((r) => r.diffM !== null).reduce((s, r) => s + r.diffM, 0) / rows.filter((r) => r.diffM !== null).length,
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
