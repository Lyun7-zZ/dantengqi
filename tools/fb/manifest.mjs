/** FB-0/FB-1：240 局公平性初筛清单。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const OUT = "_extract/fb";
mkdirSync(OUT, { recursive: true });
const evalSchedule = JSON.parse(readFileSync("_extract/eval/schedule.json", "utf8"));
const ops = {};
for (const it of evalSchedule) {
  if (it.sizeKey === "12x12" && !(it.family in ops)) ops[it.family] = it.openingActions;
}
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const ALGOS = ["hard", "grandmaster", "grandmasterPlus"];
const RULES = ["fb0", "fb1"];
const schedule = [];
for (const rule of RULES) {
  for (const algo of ALGOS) {
    for (let fam = 0; fam < 10; fam++) {
      for (const firstPlayer of [0, 1]) {
        for (const rep of [0, 1]) {
          schedule.push({
            gameId: `fb-${rule}-${algo}-${fam}-p${firstPlayer}-r${rep}`,
            rule, algo, levels: [algo, algo], firstPlayer,
            family: fam, rep, openingActions: ops[fam], openingHash: sha(ops[fam]),
            cols: 12, rows: 12, cap: 360,
          });
        }
      }
    }
  }
}
if (schedule.length !== 240) throw new Error("schedule " + schedule.length);
const commit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  schema: "fb-v1", commit, rules: RULES, algos: ALGOS, total: schedule.length,
  hash: sha(schedule), createdAt: new Date().toISOString(),
}, null, 1));
writeFileSync(`${OUT}/schedule.json`, JSON.stringify(schedule, null, 1));
console.log(JSON.stringify({ total: schedule.length, hash: sha(schedule) }, null, 1));
