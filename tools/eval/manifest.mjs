/** BS-EVAL-0：冻结 560 局清单与开局。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createState, legalActions, validateAction, applyAction } from "../../src/rules.js";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/eval";
mkdirSync(OUT, { recursive: true });
const SIZES = [[8, 8], [10, 12], [12, 12], [18, 18]];
const COMBOS = [
  ["hard", "master"], ["hard", "grandmaster"], ["hard", "grandmasterPlus"],
  ["hard", "hard"], ["master", "grandmaster"], ["grandmaster", "grandmasterPlus"],
  ["grandmasterPlus", "grandmasterPlus"],
];
const CAP = { "8x8": 240, "10x12": 240, "12x12": 360, "18x18": 600 };
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

function replayOk(cols, rows, actions) {
  let s = createState(0, { cols, rows });
  for (const a of actions) {
    const r = applyAction(s, a);
    if (!r.ok) return false;
    s = r.state;
  }
  return true;
}

function opening(cols, rows, family) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let s = createState(0, { cols, rows });
    const rng = makeRng(42000 + family * 97 + attempt * 7919);
    const acts = [];
    for (let i = 0; i < 6; i++) {
      const legal = legalActions(s).filter((a) => validateAction(s, a).ok);
      if (!legal.length) break;
      const a = legal[Math.floor(rng() * legal.length)];
      acts.push(a);
      const r = applyAction(s, a);
      if (!r.ok) break;
      s = r.state;
    }
    if (replayOk(cols, rows, acts)) return acts;
  }
  throw new Error(`opening failed ${cols}x${rows} family ${family}`);
}

const schedule = [];
const pilot = [];
for (const [cols, rows] of SIZES) {
  const sizeKey = `${cols}x${rows}`;
  const cap = CAP[sizeKey];
  const ops = Array.from({ length: 10 }, (_, fam) => {
    const actions = opening(cols, rows, fam);
    return { family: fam, public: fam < 5, actions, hash: sha(actions) };
  });
  for (const [a, b] of COMBOS) {
    const combo = `${a}-${b}`;
    for (const op of ops) {
      for (const swap of [false, true]) {
        const levels = swap ? [b, a] : [a, b];
        const item = {
          gameId: `eval-${sizeKey}-${combo}-${op.family}-${swap ? "s" : "n"}`,
          sizeKey, cols, rows, cap, combo, levels,
          family: op.family, public: op.public, openingActions: op.actions, openingHash: op.hash,
          firstPlayer: 0, seat0: levels[0], seat1: levels[1],
        };
        schedule.push(item);
        if (op.family === 0) pilot.push(item);
      }
    }
  }
}
if (schedule.length !== 560) throw new Error("schedule " + schedule.length);
if (pilot.length !== 56) throw new Error("pilot " + pilot.length);
const commit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const manifest = {
  schema: "bs-eval-v1", createdAt: new Date().toISOString(), commit,
  sizes: SIZES, combos: COMBOS, caps: CAP, total: schedule.length, pilot: pilot.length,
  openingFamilies: 10, publicFamilies: 5,
  scheduleHash: sha(schedule), pilotHash: sha(pilot),
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
writeFileSync(`${OUT}/schedule.json`, JSON.stringify(schedule, null, 1));
writeFileSync(`${OUT}/pilot.json`, JSON.stringify(pilot, null, 1));
writeFileSync(`${OUT}/openings.json`, JSON.stringify(schedule.map((x) => ({ gameId: x.gameId, hash: x.openingHash })), null, 0));
console.log(JSON.stringify(manifest, null, 1));
