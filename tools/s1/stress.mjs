/** S1 300 次 3 秒压力。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { validateAction } from "../../src/rules.js";
import { s1Choose } from "../../src/s1-planner.js";
import { buildStates, buildHoldout } from "../s0/states.mjs";

const OUT = "_extract/s1";
mkdirSync(OUT, { recursive: true });
const states = [...buildStates(), ...buildHoldout()];
const rows = [];
for (let i = 0; i < 300; i++) {
  const s = states[i % states.length].state;
  const t0 = Date.now();
  const r = s1Choose(s, { timeMs: 3000, bufferMs: 100, mode: "s1" });
  const ms = Date.now() - t0;
  rows.push({ i, ms, over: ms > 3000, legal: !!(r.action && validateAction(s, r.action).ok),
    source: r.source, depth: r.depth, nodes: r.nodes, generated: r.generated });
  if (i % 50 === 0) console.log("done", i);
}
writeFileSync(`${OUT}/stress.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const ts = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({ n: rows.length, over: rows.filter((r) => r.over).length,
  illegal: rows.filter((r) => !r.legal).length, max: ts[299], p50: ts[150], p95: ts[285], p99: ts[297] }, null, 1));
