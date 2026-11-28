/** 当前版本 24 局面固定深度决策。 */

import { readFileSync, writeFileSync } from "node:fs";
import { jsonToState } from "../../src/game-library.js";
import { createMasterAI } from "../../src/ai-master.js";
import { makeRng } from "../p0/lib.mjs";

const positions = JSON.parse(readFileSync("_extract/diag/positions24.json", "utf8"));
const ai = createMasterAI({ maxDepth: 4, timeMs: 60000, usePlan: false, pathCache: false });
const out = [];
for (let i = 0; i < positions.length; i++) {
  const s = jsonToState(positions[i].state);
  const a = ai(s, makeRng(1000 + i));
  out.push({ i, bucket: positions[i].bucket, action: a });
}
writeFileSync("_extract/diag/current_actions.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ total: out.length }, null, 1));
