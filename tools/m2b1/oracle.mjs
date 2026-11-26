/** E1a 规则 oracle：静态竞速结果 vs 规则引擎最短路模拟。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createState, applyAction } from "../../src/rules.js";
import { staticRaceResult } from "../../src/ai-master.js";

const OUT = "_extract/m2b1";
mkdirSync(OUT, { recursive: true });

function makeState(firstPlayer, turn, dM, dO) {
  const s = createState(firstPlayer, { drawMode: "firstOnly", tolerance: 1 });
  s.players = [{ c: 2, r: dM - 1 }, { c: 7, r: dO - 1 }];
  s.turn = turn;
  return s;
}

function simulate(s) {
  let st = s;
  const startTurn = s.turn;
  for (let i = 0; i < 200 && st.winner === null; i++) {
    const r = applyAction(st, { type: "move", dir: "up" });
    if (!r.ok) return "ILLEGAL";
    st = r.state;
  }
  if (st.winner === null) return "UNFINISHED";
  if (st.winner === "draw") return "D";
  return st.winner === startTurn ? "W" : "L";
}

const rows = [];
let mismatches = 0;
for (const drawMode of ["firstOnly", "symmetric"]) {
  for (const firstPlayer of [0, 1]) {
    for (const turn of [0, 1]) {
      for (let dM = 1; dM <= 8; dM++) {
        for (let dO = 1; dO <= 8; dO++) {
          for (const tolerance of [0, 1, 2]) {
            const s = makeState(firstPlayer, turn, dM, dO);
            s.drawMode = drawMode;
            s.tolerance = tolerance;
            const pred = staticRaceResult(s);
            const real = simulate(s);
            const ok = pred === real;
            if (!ok) mismatches++;
            rows.push({ drawMode, firstPlayer, turn, dM, dO, tolerance, pred, real, ok });
          }
        }
      }
    }
  }
}
writeFileSync(`${OUT}/rule_oracle.json`, JSON.stringify({ total: rows.length, mismatches, rows }, null, 1));
console.log(JSON.stringify({ total: rows.length, mismatches }, null, 1));
if (mismatches) {
  console.log(JSON.stringify(rows.filter((r) => !r.ok).slice(0, 10), null, 1));
}
