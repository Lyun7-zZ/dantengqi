/** GL-AI-CLOSE：720 局分层、U 审计、困难胜局与冻结清单。 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { applyAction, distanceOf } from "../../src/rules.js";
import { jsonToState } from "../../src/game-library.js";

const OUT = "_extract/glai/close";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

const docs = [];
for (const runId of ["pilot", "full"]) {
  const dir = `_extract/glai/${runId}/games`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    docs.push(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
  }
}

const byLevel = {}, self = {}, bySeat = { seat0: { w: 0, d: 0, l: 0, u: 0 }, seat1: { w: 0, d: 0, l: 0, u: 0 } };
const uCases = [], hardWins = [];
const hashState = (s) => createHash("sha1").update(JSON.stringify({ p: s.players, t: s.turn, v: Array.from(s.vWall), h: Array.from(s.hWall), top: Array.from(s.topWall) })).digest("hex").slice(0, 12);

for (const d of docs) {
  const [a, b] = d.meta.levels;
  if (d.result === "W0") bySeat.seat0.w++; else if (d.result === "W1") bySeat.seat1.w++;
  else if (d.result === "D") { bySeat.seat0.d++; bySeat.seat1.d++; } else { bySeat.seat0.u++; bySeat.seat1.u++; }
  if (a === b) {
    const x = self[a] || (self[a] = { n: 0, w0: 0, w1: 0, d: 0, u: 0 });
    x.n++;
    if (d.result === "W0") x.w0++; else if (d.result === "W1") x.w1++; else if (d.result === "D") x.d++; else x.u++;
    continue;
  }
  for (const lvl of [a, b]) {
    const x = byLevel[lvl] || (byLevel[lvl] = { n: 0, w: 0, d: 0, l: 0, u: 0 });
    x.n++;
    if (d.result === "D") x.d++;
    else if (d.result === "U") x.u++;
    else if ((d.result === "W0" && lvl === a) || (d.result === "W1" && lvl === b)) x.w++;
    else x.l++;
  }
  if (d.result !== "U" && d.result !== "D" && ((a === "hard" && ["master", "grandmaster", "grandmasterPlus"].includes(b)) || (b === "hard" && ["master", "grandmaster", "grandmasterPlus"].includes(a)))) {
    const winner = d.result === "W0" ? a : b;
    if (winner === "hard") hardWins.push({ gameId: d.meta.gameId, opponent: a === "hard" ? b : a, levels: d.meta.levels, plies: d.diag.plies });
  }
  if (d.result === "U") {
    let s = jsonToState(d.gl.initialState);
    const seen = new Map();
    let walls0 = s.wallsPlaced;
    const dists = [];
    for (const step of d.gl.actions) {
      const k = hashState(s);
      seen.set(k, (seen.get(k) || 0) + 1);
      dists.push([distanceOf(s, 0), distanceOf(s, 1)]);
      const r = applyAction(s, step.action);
      if (!r.ok) break;
      s = r.state;
    }
    const repeats = [...seen.values()].filter((n) => n > 1).reduce((x, y) => x + (y - 1), 0);
    const maxRep = Math.max(1, ...seen.values());
    const last = dists.slice(-50);
    const progress0 = last.length ? last[last.length - 1][0] - last[0][0] : 0;
    const progress1 = last.length ? last[last.length - 1][1] - last[0][1] : 0;
    const wallDelta = s.wallsPlaced - walls0;
    let kind;
    if (maxRep >= 5) kind = "重复/循环";
    else if (wallDelta >= 20 && Math.min(progress0, progress1) >= 0) kind = "持续封墙/无进展";
    else if (Math.min(progress0, progress1) >= 0) kind = "长局僵持";
    else kind = "收官/推进不足";
    uCases.push({ gameId: d.meta.gameId, levels: d.meta.levels, plies: d.diag.plies,
      repeats, maxRep, wallDelta, progress0, progress1, kind });
  }
}

// 第二轮：所有 U（含自我对弈）统一审计
uCases.length = 0;
for (const d of docs) {
  if (d.result !== "U") continue;
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
  const repeats = [...seen.values()].filter((n) => n > 1).reduce((x, y) => x + (y - 1), 0);
  const maxRep = Math.max(1, ...seen.values());
  const last = dists.slice(-50);
  const progress0 = last.length ? last[last.length - 1][0] - last[0][0] : 0;
  const progress1 = last.length ? last[last.length - 1][1] - last[0][1] : 0;
  const wallDelta = s.wallsPlaced - walls0;
  let kind;
  if (maxRep >= 5) kind = "重复/循环";
  else if (wallDelta >= 20 && Math.min(progress0, progress1) >= 0) kind = "持续封墙/无进展";
  else if (Math.min(progress0, progress1) >= 0) kind = "长局僵持";
  else kind = "收官/推进不足";
  uCases.push({ gameId: d.meta.gameId, levels: d.meta.levels, plies: d.diag.plies,
    repeats, maxRep, wallDelta, progress0, progress1, kind });
}

const out = { total: docs.length, bySeat, byLevel, self, hardWins: hardWins.length, u: uCases.length,
  uKinds: uCases.reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m; }, {}),
  hardWinsList: hardWins.slice(0, 30) };
writeFileSync(`${OUT}/close_summary.json`, JSON.stringify(out, null, 1));
writeFileSync(`${OUT}/u_cases.jsonl`, uCases.map((x) => JSON.stringify(x)).join("\n") + "\n");
writeFileSync(`${OUT}/hard_wins.jsonl`, hardWins.map((x) => JSON.stringify(x)).join("\n") + "\n");
console.log(JSON.stringify(out, null, 1));
