/** GL-AI-0：冻结六难度、开局池与 720 局任务清单。 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { makeOpenings } from "../p0/lib.mjs";

const OUT = "_extract/glai";
mkdirSync(OUT, { recursive: true });
const LEVELS = ["easy", "normal", "hard", "master", "grandmaster", "grandmasterPlus"];
const NAMES = ["简单", "普通", "困难", "大师", "宗师", "宗师+"];
const POOL = makeOpenings(600).slice(400, 560);
if (POOL.length !== 160) throw new Error("opening pool");
const common = POOL.slice(0, 10);
const pairOpen = new Map();
let p = 10;
for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
  pairOpen.set(`${i}-${j}`, POOL.slice(p, p + 10));
  p += 10;
}
if (p !== 160) throw new Error("pool split " + p);

const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const commit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();

const schedule = [];
const add = (runId, pairKey, a, b, op, seatSwap) => {
  const levels = seatSwap ? [b, a] : [a, b];
  schedule.push({
    gameId: `glai-${runId}-${pairKey}-${op.id}-${seatSwap ? "s" : "n"}`,
    runId, pairKey, levels, openingId: op.id, openingActions: op.actions,
    openingHash: sha(op.actions), seat0: levels[0], seat1: levels[1], firstPlayer: 0,
  });
};

for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
  const key = `${i}-${j}`;
  for (const op of common) for (const swap of [false, true]) add("full", key, LEVELS[i], LEVELS[j], op, swap);
  for (const op of pairOpen.get(key)) for (const swap of [false, true]) add("full", key, LEVELS[i], LEVELS[j], op, swap);
}
for (let i = 0; i < 6; i++) {
  for (const op of common) for (const swap of [false, true]) add("full", `self-${i}`, LEVELS[i], LEVELS[i], op, swap);
}

const pilot = [];
for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
  for (const swap of [false, true]) addPilot(i, j, common[0], swap);
}
function addPilot(i, j, op, swap) {
  const key = `${i}-${j}`;
  const levels = swap ? [LEVELS[j], LEVELS[i]] : [LEVELS[i], LEVELS[j]];
  pilot.push({
    gameId: `glai-pilot-${key}-${op.id}-${swap ? "s" : "n"}`,
    runId: "pilot", pairKey: key, levels,
    openingId: op.id, openingActions: op.actions, openingHash: sha(op.actions),
    seat0: levels[0], seat1: levels[1], firstPlayer: 0,
  });
}

if (schedule.length !== 720) throw new Error("schedule " + schedule.length);
if (pilot.length !== 30) throw new Error("pilot " + pilot.length);
const manifest = {
  schema: "glai-manifest-v1", createdAt: new Date().toISOString(), commit,
  levels: LEVELS, names: NAMES, pools: { common: common.map((o) => o.id), pairCount: 150 },
  total: schedule.length, pilot: pilot.length,
  scheduleHash: sha(schedule), pilotHash: sha(pilot),
  levelsHash: sha(LEVELS),
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
writeFileSync(`${OUT}/schedule.json`, JSON.stringify(schedule, null, 1));
writeFileSync(`${OUT}/pilot.json`, JSON.stringify(pilot, null, 1));
writeFileSync(`${OUT}/openings.json`, JSON.stringify(POOL, null, 1));
console.log(JSON.stringify(manifest, null, 1));
