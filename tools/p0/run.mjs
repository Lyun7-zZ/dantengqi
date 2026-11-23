/**
 * P0 配对评测：固定 6 手开局，地狱/宗师换边各一局，输出 JSONL。
 *
 * 用法：
 *   node tools/p0/run.mjs --count 10 --hell-ms 28000 --gm-ms 3000 --route-walls 3 --label A0
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createMasterAI } from "../../src/ai-master.js";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { createHellConfig, configHash } from "../../src/hell-config.js";
import { makeOpenings, makeRng, replayOpening, mapOutcome, summarize, PLY_CAP } from "./lib.mjs";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function pct(xs, p) {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))]);
}

const count = Number(arg("count", 10));
const hellMs = Number(arg("hell-ms", 28000));
const gmMs = Number(arg("gm-ms", 3000));
const routeWalls = Number(arg("route-walls", 3));
const label = arg("label", "A0");
const shard = Number(arg("shard", 0));
const shards = Number(arg("shards", 1));
const outDir = "_extract/p0";
mkdirSync(outDir, { recursive: true });

const sourceCommit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const dirty = (() => { try { return execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0; } catch { return true; } })();

const hellCfg = createHellConfig({ timeMs: hellMs, routeWalls });
const gmCfg = {
  timeMs: gmMs, maxDepth: 7, usePlan: true, netWalls: true,
  avoidRepeat: true, repeatPenalty: 160, planMoves: true, planFallback: true,
  necessaryPathGuard: "soft", endgameDepth: 9,
};

const allOpenings = makeOpenings(count);
const openings = allOpenings.filter((o) => o.id % shards === shard);
const openingsText = allOpenings.map((o) => JSON.stringify(o)).join("\n") + "\n";
const openingsHash = sha256(openingsText);
writeFileSync(`${outDir}/openings.jsonl`, openingsText);
writeFileSync(`${outDir}/01_config_snapshot_${label}.json`, JSON.stringify({
  label, shard, shards, hell: hellCfg, gm: gmCfg, hellHash: configHash(hellCfg),
  openingsHash, openings: count, plyCap: PLY_CAP, sourceCommit, dirty,
}, null, 1));

const hell = createMasterAI(hellCfg);
const gm = createMasterAI(gmCfg);
const records = [];

for (const op of openings) {
  for (const hellSeat of [0, 1]) {
    hell.reset();
    gm.reset();
    const seed = 70000 + op.id * 2 + hellSeat;
    const rng = makeRng(seed);
    let s = replayOpening(op.actions);
    const actions = [];
    const hellTimes = [];
    const cand = { candidateCount: 0, routeCutAdded: 0, searchedCount: 0 };
    const sources = {};
    let plies = 0;
    while (s.winner === null && plies < PLY_CAP) {
      const isHell = s.turn === hellSeat;
      const ai = isHell ? hell : gm;
      const a = ai(s, rng);
      if (!a || !validateAction(s, a).ok) throw new Error(`illegal action at opening ${op.id}`);
      actions.push(a);
      if (isHell) {
        const log = ai.stats?.lastLog ?? {};
        hellTimes.push(Number(log.tTotal ?? 0));
        cand.candidateCount += Number(log.candidateCount ?? 0);
        cand.routeCutAdded += Number(log.routeCutAdded ?? 0);
        cand.searchedCount += Number(log.searchedCount ?? 0);
        sources[log.source ?? "unknown"] = (sources[log.source ?? "unknown"] ?? 0) + 1;
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error("apply failed: " + r.error);
      s = r.state;
      plies++;
    }
    const outcome = mapOutcome(s.winner, hellSeat, plies);
    const hellMoves = hellTimes.length;
    const total = hellTimes.reduce((x, y) => x + y, 0);
    records.push({
      matchId: `${label}-${op.id}-${hellSeat}`,
      label,
      openingId: op.id,
      seat: hellSeat,
      seed,
      sourceCommit,
      dirty,
      configHash: configHash(hellCfg),
      openingsHash,
      hellMs,
      gmMs,
      routeWalls,
      ...outcome,
      plies,
      hellMoves,
      actions,
      tHellTotal: Math.round(total),
      tHellAvg: hellMoves ? Math.round(total / hellMoves) : 0,
      tHellP50: pct(hellTimes, 0.5),
      tHellP90: pct(hellTimes, 0.9),
      tHellP99: pct(hellTimes, 0.99),
      tHellMax: hellTimes.length ? Math.round(Math.max(...hellTimes)) : 0,
      timeoutCount: hellTimes.filter((x) => x > hellMs).length,
      candidateCount: cand.candidateCount,
      routeCutAdded: cand.routeCutAdded,
      searchedCount: cand.searchedCount,
      selectedSources: sources,
    });
  }
}

const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(`${outDir}/03_games_raw_${label}.jsonl`, jsonl);
const summary = summarize(records);
writeFileSync(`${outDir}/04_summary_${label}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ label, ...summary }, null, 1));
