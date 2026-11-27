/** GL-AI 本地对弈运行器（headless，断点续跑）。 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { AI } from "../../src/ai.js";
import { replayOpening, makeRng } from "../p0/lib.mjs";
import { createGameRecord, recordAction, finalizeGame, replayGame } from "../../src/game-library.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : d; };
const scheduleName = arg("schedule", "pilot");
const runId = arg("run-id", scheduleName);
const shard = Number(arg("shard", 0));
const shards = Number(arg("shards", 1));
const skipPilot = process.argv.includes("--skip-pilot");
const OUT = `_extract/glai/${runId}`;
mkdirSync(`${OUT}/games`, { recursive: true });
const schedule = JSON.parse(readFileSync(`_extract/glai/${scheduleName}.json`, "utf8"));
const mine = schedule.filter((_, i) => i % shards === shard)
  .filter((it) => !(skipPilot && !it.pairKey.startsWith("self") && it.openingId === 400));
const indexFile = `${OUT}/index_s${shard}.jsonl`;
const atomic = (p, text) => { const t = p + ".tmp"; writeFileSync(t, text); renameSync(t, p); };

for (const item of mine) {
  const path = `${OUT}/games/${item.gameId}.json`;
  if (existsSync(path)) continue;
  const t0 = Date.now();
  let s = replayOpening(item.openingActions);
  const initial = s;
  const rec = createGameRecord({ mode: "ai", seat: 0, firstPlayer: item.firstPlayer, state: s,
    config: { levels: item.levels, openingId: item.openingId }, source: "ai_round_robin" });
  const moves = [];
  let illegal = 0, seed = Number("0x" + createHash("sha1").update(item.gameId).digest("hex").slice(0, 8));
  let plies = 0;
  while (s.winner === null && plies < 240) {
    const level = item.levels[s.turn];
    const ai = AI[level];
    if (!ai) throw new Error("no ai " + level);
    const rng = makeRng(seed + plies);
    const st = Date.now();
    const a = ai(s, rng);
    const ext = Date.now() - st;
    if (!a || !validateAction(s, a).ok) { illegal++; throw new Error("illegal " + level + " " + JSON.stringify(a)); }
    const r = applyAction(s, a);
    if (!r.ok) { illegal++; throw new Error("apply " + r.error); }
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
      runId, schedule: scheduleName, gameId: item.gameId, pairKey: item.pairKey,
      levels: item.levels, openingId: item.openingId, openingHash: item.openingHash,
      firstPlayer: item.firstPlayer, commit: (() => { try { return JSON.parse(readFileSync("_extract/glai/manifest.json")).commit; } catch { return "unknown"; } })(),
    },
    gl: rec, result,
    diag: { elapsedMs: Date.now() - t0, plies, illegal, moves },
  };
  atomic(path, JSON.stringify(doc));
  appendFileSync(indexFile, JSON.stringify({ gameId: item.gameId, result, plies, levels: item.levels, elapsedMs: doc.diag.elapsedMs }) + "\n");
  if (plies >= 240) console.log("U", item.gameId);
}
console.log(JSON.stringify({ runId, shard, games: mine.length }, null, 1));
