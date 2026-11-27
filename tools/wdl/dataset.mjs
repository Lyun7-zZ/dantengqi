/** W1：从历史对局提取状态、标签与按开局划分。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createState, applyAction } from "../../src/rules.js";
import { extractFeatures } from "./features.mjs";

const OUT = "_extract/wdl";
mkdirSync(OUT, { recursive: true });

function load(f) { return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
function openings(f) {
  const m = new Map();
  for (const l of readFileSync(f, "utf8").trim().split("\n")) {
    const o = JSON.parse(l);
    m.set(o.id, o.actions);
  }
  return m;
}

const sources = [
  { name: "B2", games: "_extract/b2/games_raw.jsonl", op: "_extract/b2/runs/b2/openings_75_94.jsonl" },
  { name: "B2b", games: "_extract/b2b/games_raw.jsonl", op: "_extract/b2b/runs/b2b/openings_95_114.jsonl" },
  { name: "Gtest", games: "_extract/gtest/games_raw.jsonl", op: "_extract/gtest/runs/gtest/openings_115_134.jsonl" },
];

const rows = [];
const meta = { sources: {}, games: 0, excludedU: 0, states: 0 };

for (const src of sources) {
  const om = openings(src.op);
  const games = load(src.games);
  meta.sources[src.name] = games.length;
  for (const g of games) {
    if (g.winner === null || !om.has(g.openingId)) { meta.excludedU++; continue; }
    let s = createState(0);
    for (const a of om.get(g.openingId)) {
      const r = applyAction(s, a);
      if (!r.ok) break;
      s = r.state;
    }
    if (s.winner !== null) continue;
    meta.games++;
    let nth = 0;
    for (let i = 0; i < g.actions.length; i++) {
      if (s.winner !== null) break;
      if (s.turn === g.seat) {
        nth++;
        if (nth % 4 === 0) {
          const label = g.winner === "draw" ? "D" : g.winner === g.seat ? "W" : "L";
          rows.push({
            source: src.name, openingId: g.openingId, seat: g.seat, ply: s.plies,
            label, features: extractFeatures(s, g.seat),
          });
          meta.states++;
        }
      }
      const r = applyAction(s, g.actions[i]);
      if (!r.ok) break;
      s = r.state;
    }
  }
}

const ids = [...new Set(rows.map((r) => r.openingId))].sort((a, b) => a - b);
const split = new Map();
ids.forEach((id, i) => {
  const p = i / ids.length;
  split.set(id, p < 0.6 ? "train" : p < 0.8 ? "val" : "test");
});
for (const r of rows) r.split = split.get(r.openingId);

writeFileSync(`${OUT}/dataset.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const dist = (k) => rows.filter((r) => r[k] === "train" || r[k] === "val" || r[k] === "test").length;
const summary = {
  featureVersion: "w0.1", schema: "wdl-dataset-v1", meta,
  openings: ids.length, splits: {
    train: rows.filter((r) => r.split === "train").length,
    val: rows.filter((r) => r.split === "val").length,
    test: rows.filter((r) => r.split === "test").length,
  },
  labels: {
    all: rows.reduce((m, r) => { m[r.label] = (m[r.label] || 0) + 1; return m; }, {}),
    bySplit: Object.fromEntries(["train", "val", "test"].map((sp) => {
      const m = {};
      for (const r of rows.filter((x) => x.split === sp)) m[r.label] = (m[r.label] || 0) + 1;
      return [sp, m];
    })),
  },
  splitIds: Object.fromEntries(["train", "val", "test"].map((sp) => [sp, ids.filter((id) => split.get(id) === sp)])),
};
writeFileSync(`${OUT}/dataset_summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
