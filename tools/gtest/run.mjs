/** G-test：G7+ vs G9+，固定宗师结构，3s + 100ms 缓冲，缓存关闭。 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createMasterAI } from "../../src/ai-master.js";
import { applyAction, validateAction, distanceOf } from "../../src/rules.js";
import { createGrandmasterConfig } from "../../src/plus-config.js";
import { makeOpenings, makeRng, replayOpening, mapOutcome, PLY_CAP } from "../p0/lib.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const arm = arg("arm", "G7");
const depth = arm === "G7" ? 7 : 9;
const count = Number(arg("count", 135));
const startId = Number(arg("start-id", 115));
const endId = Number(arg("end-id", 134));
const shard = Number(arg("shard", 0));
const shards = Number(arg("shards", 8));
const label = arg("label", `${arm}-s${shard}`);
const runId = arg("run-id", "gtest");
const outDir = `_extract/gtest/runs/${runId}`;
mkdirSync(outDir, { recursive: true });
const atomicWrite = (p, t) => { const tmp = p + ".tmp"; writeFileSync(tmp, t); renameSync(tmp, p); };

const sourceCommit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const dirtyTracked = (() => { try { return execSync("git status --porcelain --untracked-files=no", { encoding: "utf8" }).trim().length > 0; } catch { return true; } })();

const all = makeOpenings(Math.max(count, endId + 1));
const range = all.filter((o) => o.id >= startId && o.id <= endId);
const mine = range.filter((o) => o.id % shards === shard);
const openingsText = range.map((o) => JSON.stringify(o)).join("\n") + "\n";
const openingsHash = createHash("sha256").update(openingsText).digest("hex");
const opPath = `${outDir}/openings_${startId}_${endId}.jsonl`;
if (existsSync(opPath)) {
  if (createHash("sha256").update(readFileSync(opPath, "utf8")).digest("hex") !== openingsHash) throw new Error("openings hash mismatch");
} else atomicWrite(opPath, openingsText);

const candCfg = createGrandmasterConfig({
  maxDepth: depth, endgameDepth: 9, returnBuffer: 100, pathCache: false, evalRaceMode: "legacy",
});
const oppCfg = createGrandmasterConfig();
atomicWrite(`${outDir}/config_${label}.json`, JSON.stringify({
  arm, depth, shard, shards, sourceCommit, dirtyTracked, candCfg, oppCfg, openingsHash,
}, null, 1));

const rows = [];
for (const op of mine) {
  for (const seat of [0, 1]) {
    const candAI = createMasterAI(candCfg);
    const oppAI = createMasterAI(oppCfg);
    const bySeat = seat === 0 ? [candAI, oppAI] : [oppAI, candAI];
    const rng = makeRng(101000 + op.id * 2 + seat);
    let s = replayOpening(op.actions);
    const actions = [];
    const moves = [];
    let plies = 0;
    while (s.winner === null && plies < PLY_CAP) {
      const ai = bySeat[s.turn];
      const isCand = s.turn === seat;
      const t0 = process.hrtime.bigint();
      const a = ai(s, rng);
      const extMs = Number(process.hrtime.bigint() - t0) / 1e6;
      if (!a || !validateAction(s, a).ok) throw new Error("illegal action");
      actions.push(a);
      if (isCand) {
        const log = ai.stats.lastLog;
        const exits = s.topWall.filter((x) => x === 0).length;
        const d0 = distanceOf(s, 0), d1 = distanceOf(s, 1);
        const endgame = exits <= 4 && Number.isFinite(d0) && Number.isFinite(d1) && Math.max(d0, d1) <= 5;
        moves.push({
          extMs: Math.round(extMs), tInt: Math.round(log.tTotal ?? 0),
          depth: log.depthLast, nodes: log.nodes, source: log.source,
          endgame, legal: true,
        });
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error("apply failed");
      s = r.state;
      plies++;
    }
    const outcome = mapOutcome(s.winner, seat, plies);
    const ext = moves.map((m) => m.extMs);
    rows.push({
      arm, depth, openingId: op.id, seat, seed: 101000 + op.id * 2 + seat,
      sourceCommit, dirtyTracked, openingsHash, plies, actions, moves,
      winner: s.winner, ...outcome,
      extTotal: ext.reduce((x, y) => x + y, 0),
      extMax: ext.length ? Math.max(...ext) : 0,
      extP99: ext.length ? [...ext].sort((a, b) => a - b)[Math.floor(ext.length * 0.99)] : 0,
      overCount: ext.filter((x) => x > 3000).length,
      endgameMoves: moves.filter((m) => m.endgame).length,
      depthAvg: moves.length ? Number((moves.reduce((a, m) => a + (m.depth || 0), 0) / moves.length).toFixed(2)) : 0,
      nodesAvg: moves.length ? Math.round(moves.reduce((a, m) => a + (m.nodes || 0), 0) / moves.length) : 0,
      sourceCounts: moves.reduce((m, x) => { m[x.source] = (m[x.source] || 0) + 1; return m; }, {}),
      finalHash: createHash("sha256").update(JSON.stringify({ p: s.players, turn: s.turn, plies })).digest("hex").slice(0, 12),
    });
  }
}
if (rows.length !== mine.length * 2) throw new Error("bad count");
atomicWrite(`${outDir}/games_${label}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(JSON.stringify({ arm, label, games: rows.length }, null, 1));
