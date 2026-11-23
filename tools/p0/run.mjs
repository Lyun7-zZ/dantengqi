/**
 * P0 配对评测：固定 6 手开局，地狱/宗师换边各一局，输出 JSONL。
 *
 * 用法：
 *   node tools/p0/run.mjs --count 10 --hell-ms 28000 --gm-ms 3000 --route-walls 3 --label A0
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createMasterAI } from "../../src/ai-master.js";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { createHellConfig, configHash } from "../../src/hell-config.js";
import { makeOpenings, makeRng, replayOpening, mapOutcome, summarize, PLY_CAP } from "./lib.mjs";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : def;
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

const hellCfg = createHellConfig({ timeMs: hellMs, routeWalls });
const gmCfg = {
  timeMs: gmMs, maxDepth: 7, usePlan: true, netWalls: true,
  avoidRepeat: true, repeatPenalty: 160, planMoves: true, planFallback: true,
  necessaryPathGuard: "soft", endgameDepth: 9,
};

const allOpenings = makeOpenings(count);
const openings = allOpenings.filter((o) => o.id % shards === shard);
writeFileSync(`${outDir}/openings.jsonl`, openings.map((o) => JSON.stringify(o)).join("\n") + "\n");
writeFileSync(`${outDir}/01_config_snapshot.json`, JSON.stringify({
  label, hell: hellCfg, gm: gmCfg, hellHash: configHash(hellCfg), openings: count, plyCap: PLY_CAP,
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
    let tHell = 0;
    let hellMoves = 0;
    let plies = 0;
    while (s.winner === null && plies < PLY_CAP) {
      const isHell = s.turn === hellSeat;
      const ai = isHell ? hell : gm;
      const a = ai(s, rng);
      if (!a || !validateAction(s, a).ok) throw new Error(`illegal action at opening ${op.id}`);
      if (isHell) {
        hellMoves++;
        tHell += Number(ai.stats?.lastLog?.tTotal ?? 0);
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error("apply failed: " + r.error);
      s = r.state;
      plies++;
    }
    const outcome = mapOutcome(s.winner, hellSeat, plies);
    records.push({
      matchId: `${label}-${op.id}-${hellSeat}`,
      label,
      openingId: op.id,
      seat: hellSeat,
      seed,
      commit: process.env.GIT_COMMIT ?? "worktree",
      configHash: configHash(hellCfg),
      hellMs,
      gmMs,
      routeWalls,
      ...outcome,
      plies,
      hellMoves,
      tHellTotal: Math.round(tHell),
      tHellAvg: hellMoves ? Math.round(tHell / hellMoves) : 0,
    });
  }
}

const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(`${outDir}/03_games_raw_${label}.jsonl`, jsonl);
const summary = summarize(records);
writeFileSync(`${outDir}/04_summary_${label}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ label, ...summary }, null, 1));
