/** BS-AI：7 难度 ×121 尺寸基础兼容矩阵。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createState, validateAction } from "../../src/rules.js";
import { AI } from "../../src/ai.js";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/bs";
mkdirSync(OUT, { recursive: true });
const LEVELS = ["easy", "normal", "hard", "master", "grandmaster", "grandmasterPlus", "hell"];
const rows = [];
for (const level of LEVELS) {
  for (let cols = 8; cols <= 18; cols++) {
    for (let rowsN = 8; rowsN <= 18; rowsN++) {
      const s = createState(0, { cols, rows: rowsN });
      const t0 = Date.now();
      let action = null, error = null, legal = false;
      try {
        action = AI[level](s, makeRng(cols * 1000 + rowsN));
        legal = !!action && validateAction(s, action).ok;
        if (!legal) error = "illegal";
      } catch (e) {
        error = String(e.message || e);
      }
      rows.push({ level, cols, rows: rowsN, ms: Date.now() - t0, legal, error,
        action: action ? action.type : null });
      if ((cols * 19 + rowsN) % 20 === 0) console.log(level, cols, rowsN);
    }
  }
}
writeFileSync(`${OUT}/ai_matrix.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const bad = rows.filter((r) => !r.legal);
console.log(JSON.stringify({ total: rows.length, illegal: bad.length, byLevel: Object.fromEntries(LEVELS.map((l) => [l, rows.filter((r) => r.level === l).length])) }, null, 1));
