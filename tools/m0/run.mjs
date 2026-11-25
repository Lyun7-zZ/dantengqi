/**
 * M0 3 秒基线：G0（宗师 vs 宗师）/ H0（A0 3s vs 宗师）/ H1（A1 3s vs 宗师）。
 * 只跑对局与记录，不改 AI 决策代码。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createMasterAI } from "../../src/ai-master.js";
import { applyAction, validateAction } from "../../src/rules.js";
import { createHellConfig, createHellA0Config, configHash } from "../../src/hell-config.js";
import { makeOpenings, makeRng, replayOpening, mapOutcome, summarize, PLY_CAP } from "../p0/lib.mjs";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const sha256 = (t) => createHash("sha256").update(t).digest("hex");
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))]);
};

const arm = arg("arm", "G0");
const ms = Number(arg("ms", 3000));
const count = Number(arg("count", 75));
const startId = Number(arg("start-id", 55));
const endId = Number(arg("end-id", 74));
const shard = Number(arg("shard", 0));
const shards = Number(arg("shards", 8));
const label = arg("label", `M0-${arm}-s${shard}`);
const runId = arg("run-id", "m0");
const outDir = `_extract/m0/runs/${runId}`;
mkdirSync(outDir, { recursive: true });
const atomicWrite = (p, t) => { const tmp = p + ".tmp"; writeFileSync(tmp, t); renameSync(tmp, p); };

const sourceCommit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const dirtyTracked = (() => { try { return execSync("git status --porcelain --untracked-files=no", { encoding: "utf8" }).trim().length > 0; } catch { return true; } })();

const GM = {
  timeMs: ms, maxDepth: 7, usePlan: true, netWalls: true, avoidRepeat: true,
  repeatPenalty: 160, planMoves: true, planFallback: true,
  necessaryPathGuard: "soft", endgameDepth: 9,
};
const candidateCfg = arm === "H0"
  ? createHellA0Config({ timeMs: ms })
  : arm === "H1"
    ? createHellConfig({ timeMs: ms })
    : GM;
const candidateName = arm === "H0" ? "A0" : arm === "H1" ? "A1" : "GM";

const all = makeOpenings(Math.max(count, endId + 1));
const range = all.filter((o) => o.id >= startId && o.id <= endId);
const mine = range.filter((o) => o.id % shards === shard);
const openingsText = range.map((o) => JSON.stringify(o)).join("\n") + "\n";
const openingsHash = sha256(openingsText);
const opPath = `${outDir}/openings_${startId}_${endId}.jsonl`;
if (existsSync(opPath)) {
  if (sha256(readFileSync(opPath, "utf8")) !== openingsHash) throw new Error("openings hash mismatch");
} else atomicWrite(opPath, openingsText);

atomicWrite(`${outDir}/config_${label}.json`, JSON.stringify({
  arm, candidate: candidateName, ms, shard, shards, sourceCommit, dirtyTracked,
  candidateCfg, gmCfg: GM, candidateHash: configHash(candidateCfg), openingsHash,
}, null, 1));

const records = [];

for (const op of mine) {
  for (const seat of [0, 1]) {
    const candAI = createMasterAI(candidateCfg);
    const oppAI = createMasterAI(GM);
    const bySeat = arm === "G0" ? [candAI, createMasterAI(GM)] : seat === 0 ? [candAI, oppAI] : [oppAI, candAI];
    const seed = 90000 + op.id * 2 + seat;
    const rng = makeRng(seed);
    let s = replayOpening(op.actions);
    const candTimes = [];
    const candDepths = [];
    const candNodes = [];
    const candCands = [];
    const sources = {};
    let plies = 0;
    while (s.winner === null && plies < PLY_CAP) {
      const isCand = arm === "G0" ? s.turn === seat : s.turn === seat;
      const ai = bySeat[s.turn];
      const a = ai(s, rng);
      if (!a || !validateAction(s, a).ok) throw new Error(`illegal at opening ${op.id}`);
      if (isCand) {
        const log = ai.stats?.lastLog ?? {};
        candTimes.push(Number(log.tTotal ?? 0));
        candDepths.push(Number(log.depthLast ?? 0));
        candNodes.push(Number(log.nodes ?? 0));
        candCands.push(Number(log.candidateCount ?? 0));
        const src = log.source ?? "unknown";
        sources[src] = (sources[src] ?? 0) + 1;
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error("apply failed");
      s = r.state;
      plies++;
    }
    const outcome = mapOutcome(s.winner, seat, plies);
    const total = candTimes.reduce((x, y) => x + y, 0);
    records.push({
      arm, candidate: candidateName, openingId: op.id, seat, seed,
      sourceCommit, dirtyTracked, configHash: configHash(candidateCfg), openingsHash, ms,
      ...outcome, winner: s.winner, plies,
      moves: candTimes.length,
      tTotal: Math.round(total),
      tAvg: candTimes.length ? Math.round(total / candTimes.length) : 0,
      tP50: pct(candTimes, 0.5), tP90: pct(candTimes, 0.9), tP99: pct(candTimes, 0.99),
      tMax: candTimes.length ? Math.round(Math.max(...candTimes)) : 0,
      timeoutCount: candTimes.filter((x) => x > ms).length,
      depthAvg: candDepths.length ? Number((candDepths.reduce((a, b) => a + b, 0) / candDepths.length).toFixed(2)) : 0,
      depthMax: candDepths.length ? Math.max(...candDepths) : 0,
      nodesAvg: candNodes.length ? Math.round(candNodes.reduce((a, b) => a + b, 0) / candNodes.length) : 0,
      candAvg: candCands.length ? Number((candCands.reduce((a, b) => a + b, 0) / candCands.length).toFixed(1)) : 0,
      selectedSources: sources,
    });
  }
}

if (records.length !== mine.length * 2) throw new Error("unexpected game count");
atomicWrite(`${outDir}/03_games_${label}.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
const summary = summarize(records);
atomicWrite(`${outDir}/04_summary_${label}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ label, arm, ...summary }, null, 1));
