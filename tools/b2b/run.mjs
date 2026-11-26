/** B2b：H0+C vs H1+C，双方缓存开启，仅 routeWalls 3/6 不同。 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createMasterAI } from "../../src/ai-master.js";
import { applyAction, validateAction } from "../../src/rules.js";
import { createGrandmasterPlusConfig, createGrandmasterConfig } from "../../src/plus-config.js";
import { makeOpenings, makeRng, replayOpening, mapOutcome, PLY_CAP } from "../p0/lib.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const arm = arg("arm", "H0C");
const routeWalls = arm === "H0C" ? 3 : 6;
const count = Number(arg("count", 115));
const startId = Number(arg("start-id", 95));
const endId = Number(arg("end-id", 114));
const shard = Number(arg("shard", 0));
const shards = Number(arg("shards", 8));
const label = arg("label", `${arm}-s${shard}`);
const runId = arg("run-id", "b2b");
const outDir = `_extract/b2b/runs/${runId}`;
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

const candCfg = createGrandmasterPlusConfig({ routeWalls, pathCache: true });
const oppCfg = createGrandmasterConfig();
atomicWrite(`${outDir}/config_${label}.json`, JSON.stringify({
  arm, routeWalls, cache: true, shard, shards, sourceCommit, dirtyTracked, candCfg, oppCfg, openingsHash,
}, null, 1));

const rows = [];
for (const op of mine) {
  for (const seat of [0, 1]) {
    const candAI = createMasterAI(candCfg);
    const oppAI = createMasterAI(oppCfg);
    const bySeat = seat === 0 ? [candAI, oppAI] : [oppAI, candAI];
    const rng = makeRng(97000 + op.id * 2 + seat);
    let s = replayOpening(op.actions);
    const actions = [];
    const times = [];
    const depths = [];
    const nodes = [];
    let cacheStats = null;
    let plies = 0;
    while (s.winner === null && plies < PLY_CAP) {
      const ai = bySeat[s.turn];
      const a = ai(s, rng);
      if (!a || !validateAction(s, a).ok) throw new Error("illegal action");
      actions.push(a);
      if (s.turn === seat) {
        const log = ai.stats.lastLog;
        times.push(Number(log.tTotal ?? 0));
        depths.push(Number(log.depthLast ?? 0));
        nodes.push(Number(log.nodes ?? 0));
        if (log.pathCache) cacheStats = log.pathCache;
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error("apply failed");
      s = r.state;
      plies++;
    }
    const outcome = mapOutcome(s.winner, seat, plies);
    const total = times.reduce((x, y) => x + y, 0);
    rows.push({
      arm, routeWalls, cache: true, openingId: op.id, seat, seed: 97000 + op.id * 2 + seat,
      sourceCommit, dirtyTracked, openingsHash, plies, actions,
      winner: s.winner, ...outcome,
      moves: times.length,
      tTotal: Math.round(total),
      tAvg: times.length ? Math.round(total / times.length) : 0,
      tMax: times.length ? Math.round(Math.max(...times)) : 0,
      timeoutCount: times.filter((x) => x > 3000).length,
      depthAvg: depths.length ? Number((depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(2)) : 0,
      depthMax: depths.length ? Math.max(...depths) : 0,
      nodesAvg: nodes.length ? Math.round(nodes.reduce((a, b) => a + b, 0) / nodes.length) : 0,
      cacheStats,
      finalHash: createHash("sha256").update(JSON.stringify({ p: s.players, turn: s.turn, plies })).digest("hex").slice(0, 12),
    });
  }
}
if (rows.length !== mine.length * 2) throw new Error("bad count");
atomicWrite(`${outDir}/games_${label}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(JSON.stringify({ arm, label, games: rows.length }, null, 1));
