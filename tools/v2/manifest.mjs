/** GL-AI-V2-0：840 槽位、三规格、七难度、开局与试运行清单。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createState, legalActions, validateAction, applyAction } from "../../src/rules.js";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/v2";
mkdirSync(OUT, { recursive: true });
const LEVELS = ["easy", "normal", "hard", "master", "grandmaster", "grandmasterPlus", "hell"];
const SIZES = [[8, 8], [12, 12], [18, 18]];
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

function opening(cols, rows, seed) {
  for (let attempt = 0; attempt < 30; attempt++) {
    let s = createState(0, { cols, rows });
    const rng = makeRng(seed + attempt * 7919);
    const acts = [];
    for (let i = 0; i < 6; i++) {
      const legal = legalActions(s).filter((a) => validateAction(s, a).ok);
      if (!legal.length) break;
      const a = legal[Math.floor(rng() * legal.length)];
      acts.push(a); const r = applyAction(s, a); if (!r.ok) break; s = r.state;
    }
    let t = createState(0, { cols, rows }), ok = true;
    for (const a of acts) { const r = applyAction(t, a); if (!r.ok) { ok = false; break; } t = r.state; }
    if (ok) return acts;
  }
  throw new Error("opening");
}

const units = [];
for (let i = 0; i < LEVELS.length; i++) {
  for (let j = i; j < LEVELS.length; j++) {
    const a = LEVELS[i], b = LEVELS[j];
    units.push({ unitId: i === j ? `self-${a}` : `${a}-${b}`, levels: [a, b], self: i === j });
  }
}
if (units.length !== 28) throw new Error("units " + units.length);

const openingsBySize = new Map();
for (const [cols, rows] of SIZES) {
  const key = `${cols}x${rows}`;
  openingsBySize.set(key, {
    pub0: { id: `pub0-${key}`, actions: opening(cols, rows, 90000 + cols * 100 + rows), public: true },
    pub1: { id: `pub1-${key}`, actions: opening(cols, rows, 91000 + cols * 100 + rows), public: true },
  });
}

const schedule = [], pilot = [];
for (const [cols, rows] of SIZES) {
  const key = `${cols}x${rows}`;
  const pub = openingsBySize.get(key);
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    const sp0 = { id: `u${ui}-0-${key}`, actions: opening(cols, rows, 100000 + ui * 101 + cols * 7), public: false };
    const sp1 = { id: `u${ui}-1-${key}`, actions: opening(cols, rows, 200000 + ui * 103 + rows * 11), public: false };
    const ops = [
      { id: `std-${key}`, actions: [], public: true, standard: true },
      pub.pub0, pub.pub1, sp0, sp1,
    ];
    for (const op of ops) {
      for (const firstPlayer of [0, 1]) {
        const gameId = `v2-${key}-${u.unitId}-${op.id}-p${firstPlayer}`;
        const item = {
          gameId, slotId: gameId, pairId: `${key}-${u.unitId}-${op.id}`,
          sizeKey: key, cols, rows, unitId: u.unitId, levels: u.levels, self: u.self,
          openingId: op.id, openingActions: op.actions, openingHash: sha(op.actions),
          public: op.public, standard: !!op.standard, firstPlayer, cap: 2400,
        };
        schedule.push(item);
        if (op.standard && ["self-easy", "hard-grandmasterPlus", "self-grandmasterPlus", "grandmasterPlus-hell"].includes(u.unitId)) pilot.push(item);
      }
    }
  }
}
if (schedule.length !== 840) throw new Error("schedule " + schedule.length);
if (pilot.length !== 24) throw new Error("pilot " + pilot.length);
const commit = (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  schema: "gl-ai-v2", commit, levels: LEVELS, sizes: SIZES, units: units.length,
  total: schedule.length, pilot: pilot.length, scheduleHash: sha(schedule), pilotHash: sha(pilot),
  createdAt: new Date().toISOString(),
}, null, 1));
writeFileSync(`${OUT}/schedule.json`, JSON.stringify(schedule, null, 1));
writeFileSync(`${OUT}/pilot.json`, JSON.stringify(pilot, null, 1));
console.log(JSON.stringify({ total: 840, pilot: 24, units: 28, hash: sha(schedule) }, null, 1));
