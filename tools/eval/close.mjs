/** BS-EVAL-CLOSE：统一 240 截点、最终 U、53 局审计。 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { applyAction, distanceOf } from "../../src/rules.js";
import { jsonToState } from "../../src/game-library.js";

const OUT = "_extract/eval/close";
mkdirSync(OUT, { recursive: true });
const docs = [], ids = new Set();
for (const runId of ["pilot", "full"]) {
  const dir = `_extract/eval/${runId}/games`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    if (ids.has(d.meta.gameId)) throw new Error("duplicate " + d.meta.gameId);
    ids.add(d.meta.gameId);
    docs.push(d);
  }
}
const SIZE = ["8x8", "10x12", "12x12", "18x18"];
const bySize = {};
for (const s of SIZE) bySize[s] = { n: 0, w0: 0, w1: 0, d: 0, u: 0, cut240: 0, u240: 0 };
for (const d of docs) {
  const b = bySize[d.meta.sizeKey];
  b.n++;
  if (d.result === "W0") b.w0++; else if (d.result === "W1") b.w1++;
  else if (d.result === "D") b.d++; else b.u++;
  if (d.cut240) { b.cut240++; b.u240++; }
  else if (d.meta.cap === 240 && d.result === "U") b.u240++;
}
const hashState = (s) => createHash("sha1").update(JSON.stringify({ p: s.players, t: s.turn, v: Array.from(s.vWall), h: Array.from(s.hWall), top: Array.from(s.topWall) })).digest("hex").slice(0, 12);
const uCases = [];
for (const d of docs.filter((x) => x.result === "U")) {
  let s = jsonToState(d.gl.initialState);
  const seen = new Map();
  const walls0 = s.wallsPlaced;
  const dists = [];
  for (const step of d.gl.actions) {
    const k = hashState(s);
    seen.set(k, (seen.get(k) || 0) + 1);
    dists.push([distanceOf(s, 0), distanceOf(s, 1)]);
    const r = applyAction(s, step.action);
    if (!r.ok) break;
    s = r.state;
  }
  const maxRep = Math.max(1, ...seen.values());
  const last = dists.slice(-50);
  const p0 = last.length ? last.at(-1)[0] - last[0][0] : 0;
  const p1 = last.length ? last.at(-1)[1] - last[0][1] : 0;
  const wallDelta = s.wallsPlaced - walls0;
  let kind;
  if (maxRep >= 5) kind = "重复/循环";
  else if (wallDelta >= 20 && Math.min(p0, p1) >= 0) kind = "持续封墙/无进展";
  else if (Math.min(p0, p1) >= 0) kind = "长局僵持";
  else kind = "收官/推进不足";
  uCases.push({ gameId: d.meta.gameId, sizeKey: d.meta.sizeKey, combo: d.meta.combo, plies: d.diag.plies, maxRep, wallDelta, p0, p1, kind });
}
const out = {
  games: docs.length, uniqueIds: ids.size, bySize,
  u240: Object.values(bySize).reduce((a, b) => a + b.u240, 0),
  finalU: uCases.length,
  uKinds: uCases.reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m; }, {}),
  uCases,
};
writeFileSync(`${OUT}/close_summary.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ games: out.games, u240: out.u240, finalU: out.finalU, kinds: out.uKinds, bySize }, null, 1));
