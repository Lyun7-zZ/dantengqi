/** FB 运行器。 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { makeRng } from "../p0/lib.mjs";
import { createGameRecord, recordAction, finalizeGame, replayGame, stateToJson } from "../../src/game-library.js";
import { AI } from "../../src/ai.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : d; };
const shard = Number(arg("shard", 0)), shards = Number(arg("shards", 1));
const OUT = "_extract/fb/run";
mkdirSync(`${OUT}/games`, { recursive: true });
const schedule = JSON.parse(readFileSync("_extract/fb/schedule.json", "utf8"));
const mine = schedule.filter((_, i) => i % shards === shard);
const atomic = (p, text) => { const t = p + ".tmp"; writeFileSync(t, text); renameSync(t, p); };

for (const item of mine) {
  const path = `${OUT}/games/${item.gameId}.json`;
  if (existsSync(path)) continue;
  const t0 = Date.now();
  let s = createState(item.firstPlayer, { cols: item.cols, rows: item.rows, endMode: item.rule });
  for (const a of item.openingActions) {
    const rr = applyAction(s, a);
    if (!rr.ok) throw new Error("opening " + rr.error + " " + item.gameId);
    s = rr.state;
  }
  const rec = createGameRecord({ mode: "ai", seat: 0, firstPlayer: item.firstPlayer, state: s,
    config: { levels: item.levels, rule: item.rule, opening: item.family }, source: "fb" });
  const moves = [];
  let cut240 = null, seed = Number("0x" + createHash("sha1").update(item.gameId).digest("hex").slice(0, 8));
  let plies = 0;
  while (s.winner === null && plies < item.cap) {
    if (plies === 240) cut240 = { state: stateToJson(s), plies };
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
    meta: { ...item, gameId: item.gameId, commit: JSON.parse(readFileSync("_extract/fb/manifest.json")).commit },
    gl: rec, result, cut240, diag: { elapsedMs: Date.now() - t0, plies, moves },
  }));
  appendFileSync(`${OUT}/index_s${shard}.jsonl`, JSON.stringify({ gameId: item.gameId, rule: item.rule, algo: item.algo, firstPlayer: item.firstPlayer, result, plies }) + "\n");
}
console.log(JSON.stringify({ shard, games: mine.length }, null, 1));
