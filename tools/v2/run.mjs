/** GL-AI-V2 运行器：逐手落盘、截点快照、断点续跑。 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { makeRng } from "../p0/lib.mjs";
import { createGameRecord, recordAction, finalizeGame, replayGame, stateToJson } from "../../src/game-library.js";
import { AI } from "../../src/ai.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : d; };
const scheduleName = arg("schedule", "pilot");
const runId = arg("run-id", scheduleName);
const shard = Number(arg("shard", 0)), shards = Number(arg("shards", 1));
const skipPilot = process.argv.includes("--skip-pilot");
const OUT = `_extract/v2/${runId}`;
mkdirSync(`${OUT}/games`, { recursive: true });
const schedule = JSON.parse(readFileSync(`_extract/v2/${scheduleName}.json`, "utf8"));
const pilotIds = new Set(JSON.parse(readFileSync("_extract/v2/pilot.json", "utf8")).map((x) => x.gameId));
const mine = schedule.filter((_, i) => i % shards === shard).filter((it) => !(skipPilot && pilotIds.has(it.gameId)));
const atomic = (p, text) => { const t = p + ".tmp"; writeFileSync(t, text); renameSync(t, p); };

for (const item of mine) {
  const path = `${OUT}/games/${item.gameId}.json`;
  if (existsSync(path)) continue;
  const t0 = Date.now();
  let s = createState(item.firstPlayer, { cols: item.cols, rows: item.rows });
  for (const a of item.openingActions) {
    const rr = applyAction(s, a);
    if (!rr.ok) throw new Error("opening " + rr.error + " " + item.gameId);
    s = rr.state;
  }
  const rec = createGameRecord({ mode: "ai", seat: 0, firstPlayer: item.firstPlayer, state: s,
    config: { levels: item.levels, openingId: item.openingId }, source: "gl_ai_v2" });
  const moves = [];
  const cuts = {};
  let seed = Number("0x" + createHash("sha1").update(item.gameId).digest("hex").slice(0, 8));
  let plies = 0;
  while (s.winner === null && plies < item.cap) {
    if ([240, 360, 600, 1200].includes(plies)) cuts[plies] = stateToJson(s);
    const level = item.levels[s.turn];
    const st = Date.now();
    const a = AI[level](s, makeRng(seed + plies));
    const ext = Date.now() - st;
    if (!a || !validateAction(s, a).ok) throw new Error("illegal " + item.gameId);
    const r = applyAction(s, a);
    if (!r.ok) throw new Error("apply " + r.error);
    recordAction(rec, a, s.turn);
    moves.push({ ply: s.plies + 1, level, action: a, extMs: ext });
    s = r.state;
    plies++;
  }
  finalizeGame(rec, s, s.winner === null ? "ply_cap" : "normal_terminal");
  const rp = replayGame(rec);
  if (!rp.ok) throw new Error("replay " + rp.error);
  const result = s.winner === "draw" ? "D" : s.winner === 0 ? "W0" : s.winner === 1 ? "W1" : "U";
  atomic(path, JSON.stringify({
    schemaVersion: 2, kind: "game",
    meta: { ...item, gameId: item.gameId, commit: JSON.parse(readFileSync("_extract/v2/manifest.json")).commit },
    gl: rec, result, cuts, diag: { elapsedMs: Date.now() - t0, plies, moves },
  }));
  appendFileSync(`${OUT}/index_s${shard}.jsonl`, JSON.stringify({ gameId: item.gameId, result, plies, sizeKey: item.sizeKey, unitId: item.unitId }) + "\n");
  if (result === "U") console.log("U", item.gameId);
}
console.log(JSON.stringify({ runId, shard, games: mine.length }, null, 1));
