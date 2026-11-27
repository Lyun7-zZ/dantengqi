/** BS-EVAL 运行器：按冻结清单对局，断点续跑。 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { makeRng } from "../p0/lib.mjs";
import { createGameRecord, recordAction, finalizeGame, replayGame, stateToJson } from "../../src/game-library.js";
import { AI } from "../../src/ai.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : d; };
const scheduleName = arg("schedule", "pilot");
const runId = arg("run-id", scheduleName);
const shard = Number(arg("shard", 0));
const shards = Number(arg("shards", 1));
const skipPilot = process.argv.includes("--skip-pilot");
const OUT = `_extract/eval/${runId}`;
mkdirSync(`${OUT}/games`, { recursive: true });
const schedule = JSON.parse(readFileSync(`_extract/eval/${scheduleName}.json`, "utf8"));
const mine = schedule.filter((_, i) => i % shards === shard)
  .filter((it) => !(skipPilot && it.family === 0));
const atomic = (p, text) => { const t = p + ".tmp"; writeFileSync(t, text); renameSync(t, p); };

for (const item of mine) {
  const path = `${OUT}/games/${item.gameId}.json`;
  if (existsSync(path)) continue;
  const t0 = Date.now();
  let s = createState(0, { cols: item.cols, rows: item.rows });
  for (const a of item.openingActions) {
    const rr = applyAction(s, a);
    if (!rr.ok) throw new Error("opening illegal: " + rr.error + " " + item.gameId);
    s = rr.state;
  }
  const rec = createGameRecord({ mode: "ai", seat: 0, firstPlayer: item.firstPlayer, state: s,
    config: { levels: item.levels, openingId: item.family, cap: item.cap }, source: "bs_eval" });
  const moves = [];
  let cut240 = null, seed = Number("0x" + createHash("sha1").update(item.gameId).digest("hex").slice(0, 8));
  let plies = 0;
  while (s.winner === null && plies < item.cap) {
    if (plies === 240 && item.cap > 240) {
      cut240 = { state: stateToJson(s), plies, hash: createHash("sha256").update(JSON.stringify(stateToJson(s))).digest("hex").slice(0, 16) };
    }
    const level = item.levels[s.turn];
    const ai = AI[level];
    const st = Date.now();
    const a = ai(s, makeRng(seed + plies));
    const ext = Date.now() - st;
    if (!a || !validateAction(s, a).ok) throw new Error("illegal " + item.gameId + " " + JSON.stringify(a));
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
  const doc = {
    schemaVersion: 2, kind: "game", meta: {
      runId, schedule: scheduleName, gameId: item.gameId, sizeKey: item.sizeKey, cols: item.cols, rows: item.rows,
      combo: item.combo, levels: item.levels, family: item.family, public: item.public,
      openingHash: item.openingHash, cap: item.cap, firstPlayer: item.firstPlayer,
      commit: (() => { try { return JSON.parse(readFileSync("_extract/eval/manifest.json")).commit; } catch { return "unknown"; } })(),
    },
    gl: rec, result, cut240,
    diag: { elapsedMs: Date.now() - t0, plies, moves },
  };
  atomic(path, JSON.stringify(doc));
  appendFileSync(`${OUT}/index_s${shard}.jsonl`, JSON.stringify({ gameId: item.gameId, result, plies, sizeKey: item.sizeKey, combo: item.combo }) + "\n");
  if (plies >= item.cap) console.log("U", item.gameId);
}
console.log(JSON.stringify({ runId, shard, games: mine.length }, null, 1));
