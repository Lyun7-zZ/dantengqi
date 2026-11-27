/** 宗师+ 300 次 3 秒产品配置压力。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createMasterAI } from "../../src/ai-master.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { validateAction, applyAction } from "../../src/rules.js";
import { makeRng, replayOpening } from "../p0/lib.mjs";

const OUT = "_extract/release";
mkdirSync(OUT, { recursive: true });
const states = [];
for (const [file, opfile] of [
  ["_extract/b2b/games_raw.jsonl", "_extract/b2b/runs/b2b/openings_95_114.jsonl"],
  ["_extract/b2/games_raw.jsonl", "_extract/b2/runs/b2/openings_75_94.jsonl"],
]) {
  const op = new Map();
  for (const l of readFileSync(opfile, "utf8").trim().split("\n")) {
    const o = JSON.parse(l);
    op.set(o.id, o.actions);
  }
  for (const l of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const g = JSON.parse(l);
    if (!op.has(g.openingId)) continue;
    let s = replayOpening(op.get(g.openingId));
    for (let i = 0; i < Math.min(40, g.actions.length); i++) {
      const r = applyAction(s, g.actions[i]);
      if (!r.ok) break;
      s = r.state;
      if (s.winner !== null) break;
    }
    if (s.winner === null) states.push(s);
  }
}
const rows = [];
for (let i = 0; i < 300; i++) {
  const s = states[i % states.length];
  const ai = createMasterAI(createGrandmasterPlusConfig({ pathCache: true }));
  const t0 = Date.now();
  const a = ai(s, makeRng(120000 + i));
  const ms = Date.now() - t0;
  rows.push({ i, ms, over: ms > 3000, legal: !!(a && validateAction(s, a).ok),
    depth: ai.stats.lastLog.depthLast, tTotal: Math.round(ai.stats.lastLog.tTotal ?? 0) });
  if (i % 50 === 0) console.log("done", i);
}
writeFileSync(`${OUT}/pressure.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const ts = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({ n: rows.length, over: rows.filter((r) => r.over).length,
  illegal: rows.filter((r) => !r.legal).length, max: ts[299], p99: ts[297] }, null, 1));
