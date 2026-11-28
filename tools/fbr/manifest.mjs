/** FB-1A-R：120 局新开局族扩样。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createState, legalActions, validateAction, applyAction } from "../../src/rules.js";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/fbr";
mkdirSync(OUT, { recursive: true });
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const ALGOS = ["hard", "grandmaster", "grandmasterPlus"];
const RULES = ["fb0", "fb1"];

function opening(family) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let s = createState(0, { cols: 12, rows: 12 });
    const rng = makeRng(70000 + family * 131 + attempt * 7919);
    const acts = [];
    for (let i = 0; i < 6; i++) {
      const legal = legalActions(s).filter((a) => validateAction(s, a).ok);
      if (!legal.length) break;
      const a = legal[Math.floor(rng() * legal.length)];
      acts.push(a);
      const r = applyAction(s, a);
      if (!r.ok) break;
      s = r.state;
    }
    let t = createState(0, { cols: 12, rows: 12 }), ok = true;
    for (const a of acts) { const r = applyAction(t, a); if (!r.ok) { ok = false; break; } t = r.state; }
    if (ok) return acts;
  }
  throw new Error("opening " + family);
}

const ops = Array.from({ length: 10 }, (_, f) => opening(f));
const schedule = [];
for (const rule of RULES) for (const algo of ALGOS) {
  for (let fam = 0; fam < 10; fam++) for (const firstPlayer of [0, 1]) {
    schedule.push({
      gameId: `fbr-${rule}-${algo}-${fam}-p${firstPlayer}`,
      rule, algo, levels: [algo, algo], firstPlayer, family: fam,
      openingActions: ops[fam], openingHash: sha(ops[fam]),
      cols: 12, rows: 12, cap: 360,
    });
  }
}
if (schedule.length !== 120) throw new Error("schedule " + schedule.length);
const commit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ schema: "fb-r-v1", commit, total: 120, hash: sha(schedule) }, null, 1));
writeFileSync(`${OUT}/schedule.json`, JSON.stringify(schedule, null, 1));
console.log(JSON.stringify({ total: 120, hash: sha(schedule) }, null, 1));
