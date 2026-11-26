/** S1 资格：S0 / deep / S1 / H1+C 同状态对比（开发 24 + 保留 12）。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { applyAction, validateAction, distanceOf } from "../../src/rules.js";
import { createMasterAI } from "../../src/ai-master.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { s1Choose, s1Evaluate } from "../../src/s1-planner.js";
import { buildStates, buildHoldout } from "../s0/states.mjs";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/s1";
mkdirSync(OUT, { recursive: true });
const dev = buildStates();
const hold = buildHoldout();
const rows = [];

function margin(s, root) { return distanceOf(s, 1 - root) - distanceOf(s, root); }

for (const split of ["dev", "hold"]) {
  const items = split === "dev" ? dev : hold;
  for (const item of items) {
    const s = item.state;
    const root = s.turn;
    const M0 = margin(s, root);

    const h1 = createMasterAI(createGrandmasterPlusConfig({ pathCache: true }));
    const ah = h1(s, makeRng(90000));
    const lh = h1.stats.lastLog;
    const rh = ah ? applyAction(s, ah) : { ok: false };
    const Mh = rh.ok ? margin(rh.state, root) : null;

    const arms = {};
    for (const mode of ["s0", "deep", "s1"]) {
      const t0 = Date.now();
      const r = s1Choose(s, { timeMs: 3000, bufferMs: 100, mode });
      const rr = r.action ? applyAction(s, r.action) : { ok: false };
      arms[mode] = { action: r.action, source: r.source, depth: r.depth, nodes: r.nodes,
        elapsed: r.elapsed, generated: r.generated, M: rr.ok ? margin(rr.state, root) : null,
        legal: !!(r.action && validateAction(s, r.action).ok) };
    }

    // 独立短程参考：对四个动作做 V3（同参考器）
    const refs = {};
    const actions = { h1: ah, ...Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, v.action])) };
    for (const [k, a] of Object.entries(actions)) {
      if (!a) { refs[k] = null; continue; }
      const ev = s1Evaluate(s, a, { depth: 3, timeMs: 20000 });
      refs[k] = ev ? ev.value : null;
    }
    const validRefs = Object.values(refs).filter((x) => x !== null);
    const bestRef = validRefs.length ? Math.max(...validRefs) : null;

    rows.push({ split, name: item.name, category: item.category, M0,
      h1: { action: ah, source: lh.source, M: Mh, tTotal: Math.round(lh.tTotal ?? 0), legal: !!(ah && validateAction(s, ah).ok) },
      arms,
      refs, bestRef,
      regrets: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v === null ? null : bestRef - v])),
    });
  }
}
writeFileSync(`${OUT}/cases.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

function summarize(sel) {
  const xs = rows.filter(sel);
  const out = { n: xs.length, illegal: 0, maxS1Ms: 0, sources: {}, protect: 0, avgM: {}, avgRegret: {}, winsM: 0 };
  for (const r of xs) {
    for (const k of ["s0", "deep", "s1"]) {
      if (!r.arms[k].legal) out.illegal++;
      if (r.arms[k].source === "protect") out.protect++;
      out.maxS1Ms = Math.max(out.maxS1Ms, r.arms[k].elapsed);
      out.avgM[k] = (out.avgM[k] || 0) + (r.arms[k].M ?? 0);
      const rg = r.regrets[k];
      if (rg !== null && rg !== undefined) out.avgRegret[k] = (out.avgRegret[k] || 0) + rg;
    }
    if (r.arms.s1.M !== null && r.h1.M !== null && r.arms.s1.M > r.h1.M) out.winsM++;
  }
  for (const k of ["s0", "deep", "s1"]) {
    out.avgM[k] = Number((out.avgM[k] / xs.length).toFixed(3));
    out.avgRegret[k] = Number(((out.avgRegret[k] || 0) / xs.length).toFixed(3));
  }
  return out;
}
const summary = { dev: summarize((r) => r.split === "dev"), hold: summarize((r) => r.split === "hold"),
  s1ProtectDev: rows.filter((r) => r.split === "dev" && r.arms.s1.source === "protect").length,
  s1ProtectHold: rows.filter((r) => r.split === "hold" && r.arms.s1.source === "protect").length,
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
