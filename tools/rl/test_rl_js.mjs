/** JS 推理与 Python 策略对拍。 */
import { readFileSync } from "node:fs";
import { createState } from "../../src/rules.js";
import { rlActionIndex } from "../../src/ai-rl.js";

const rows = JSON.parse(readFileSync("_extract/rl2/diag/rl-js-parity.json", "utf8"));
let ok = 0;
const t0 = Date.now();
for (const row of rows) {
  const st = row.state;
  const s = createState(st.firstPlayer, { drawMode: st.drawMode });
  s.vWall.set(st.vWall);
  s.hWall.set(st.hWall);
  s.topWall.set(st.topWall);
  s.players = st.players.map((p) => ({ c: p.c, r: p.r }));
  s.turn = st.turn;
  s.firstPlayer = st.firstPlayer;
  s.wallsPlaced = st.wallsPlaced;
  s.wallLimit = st.wallLimit.slice();
  s.wallsUsed = st.wallsUsed.slice();
  s.tolerance = st.tolerance;
  s.winner = st.winner;
  s.plies = st.plies;
  const idx = rlActionIndex(s);
  if (idx === row.py_action) ok++;
  else console.log("mismatch", idx, row.py_action);
}
console.log(`parity ${ok}/${rows.length}, ${(Date.now() - t0) / rows.length} ms/state`);
process.exit(ok === rows.length ? 0 : 1);
