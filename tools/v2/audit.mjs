/** V2-0：F0 覆盖审计与冻结清单。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { applyAction, validateAction, legalActions, distanceOf } from "../../src/rules.js";
import { replayOpening } from "../p0/lib.mjs";

const OUT = "_extract/v2";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("_extract/b2b/games_raw.jsonl").filter((r) => r.arm === "H1C");
const RISK = new Set(["hell_loss", "unfinished"]);
const opMap = new Map();
for (const l of readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  opMap.set(o.id, o);
}

function wallCount(s) {
  let n = 0;
  for (const a of legalActions(s)) {
    if (a.type !== "wall") continue;
    if (validateAction(s, a).ok) n++;
  }
  return n;
}

const stateRows = [];
const byRole = { risk: [], control: [] };
for (const r of rows) {
  const role = RISK.has(r.result) ? "risk" : "control";
  let s = replayOpening(opMap.get(r.openingId).actions);
  const entry = { key: `${r.openingId}-${r.seat}`, role, decisions: 0, minWalls: Infinity, zeroWalls: 0,
    minExits: 10, anySmall: 0, wallsUsedMax: [0, 0] };
  for (let i = 0; i < r.actions.length; i++) {
    if (s.winner !== null) break;
    if (s.turn === r.seat) {
      const lw = wallCount(s);
      const exits = s.topWall.filter((x) => x === 0).length;
      const dU = distanceOf(s, r.seat), dT = distanceOf(s, 1 - r.seat);
      entry.decisions++;
      entry.minWalls = Math.min(entry.minWalls, lw);
      if (lw === 0) entry.zeroWalls++;
      entry.minExits = Math.min(entry.minExits, exits);
      if (exits <= 4 && Math.max(dU, dT) <= 5) entry.anySmall++;
      entry.wallsUsedMax[0] = Math.max(entry.wallsUsedMax[0], s.wallsUsed[0]);
      entry.wallsUsedMax[1] = Math.max(entry.wallsUsedMax[1], s.wallsUsed[1]);
      stateRows.push({ key: entry.key, role, ply: s.plies, legalWalls: lw, exits, dU, dT,
        wallsUsed: s.wallsUsed.slice(), wallLimit: s.wallLimit });
    }
    const rr = applyAction(s, r.actions[i]);
    if (!rr.ok) break;
    s = rr.state;
  }
  byRole[role].push(entry);
}

const agg = {};
for (const role of ["risk", "control"]) {
  const xs = byRole[role];
  agg[role] = {
    games: xs.length,
    decisions: xs.reduce((s, x) => s + x.decisions, 0),
    zeroWallGames: xs.filter((x) => x.zeroWalls > 0).length,
    zeroWallStates: xs.reduce((s, x) => s + x.zeroWalls, 0),
    minWalls: Math.min(...xs.map((x) => x.minWalls)),
    smallStates: xs.reduce((s, x) => s + x.anySmall, 0),
  };
}
const wallLimit = stateRows.length ? stateRows[0].wallLimit : null;
const summary = {
  head: (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })(),
  wallLimit,
  states: stateRows.length,
  agg,
  f1Justified: agg.risk.zeroWallGames >= 3,
  note: "F1 资格要求至少 3 个独立风险开局存在可证明子空间；本审计只看墙耗尽/小状态覆盖，不等于可解。",
};
writeFileSync(`${OUT}/f0_states.jsonl`, stateRows.map((x) => JSON.stringify(x)).join("\n") + "\n");
writeFileSync(`${OUT}/f0_summary.json`, JSON.stringify(summary, null, 1));
writeFileSync(`${OUT}/f0_coverage.tsv`,
  ["key\trole\tply\tlegalWalls\texits\tdU\tdT\twallsUsed0\twallsUsed1"]
    .concat(stateRows.map((x) => [x.key, x.role, x.ply, x.legalWalls, x.exits, x.dU, x.dT, x.wallsUsed[0], x.wallsUsed[1]].join("\t")))
    .join("\n") + "\n");
console.log(JSON.stringify(summary, null, 1));
