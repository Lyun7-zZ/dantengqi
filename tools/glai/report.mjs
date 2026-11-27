/** GL-AI 统计：重放、去重、矩阵、热图数据。 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { replayGame } from "../../src/game-library.js";

const LEVELS = ["easy", "normal", "hard", "master", "grandmaster", "grandmasterPlus"];
const NAMES = { easy: "简单", normal: "普通", hard: "困难", master: "大师", grandmaster: "宗师", grandmasterPlus: "宗师+" };
const rows = [];
let invalid = 0;
for (const runId of ["pilot", "full"]) {
  const dir = `_extract/glai/${runId}/games`;
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { continue; }
  for (const f of files) {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const rp = replayGame(d.gl);
    if (!rp.ok) invalid++;
    const [a, b] = d.meta.levels;
    const winnerLevel = d.result === "W0" ? a : d.result === "W1" ? b : null;
    const loserLevel = d.result === "W0" ? b : d.result === "W1" ? a : null;
    const acts = d.gl.actions.map((x) => x.action);
    rows.push({
      runId, gameId: d.meta.gameId, pair: d.meta.pairKey, a, b, winnerLevel, loserLevel,
      result: d.result, plies: d.diag.plies, ms: d.diag.elapsedMs, openingId: d.meta.openingId,
      walls: acts.filter((x) => x.type === "wall").length,
      moves: acts.filter((x) => x.type === "move").length,
      contentHash: createHash("sha256").update(JSON.stringify(d.gl)).digest("hex").slice(0, 16),
    });
  }
}

const matrix = {};
for (const a of LEVELS) { matrix[a] = {}; for (const b of LEVELS) matrix[a][b] = { w: 0, d: 0, l: 0, u: 0 }; }
const self = {};
for (const r of rows) {
  if (r.a === r.b) {
    const x = self[r.a] || (self[r.a] = { n: 0, w0: 0, w1: 0, d: 0, u: 0 });
    x.n++;
    if (r.result === "W0") x.w0++; else if (r.result === "W1") x.w1++;
    else if (r.result === "D") x.d++; else x.u++;
    continue;
  }
  if (r.winnerLevel) {
    matrix[r.winnerLevel][r.loserLevel].w++;
    matrix[r.loserLevel][r.winnerLevel].l++;
  } else if (r.result === "D") {
    matrix[r.a][r.b].d++; matrix[r.b][r.a].d++;
  } else {
    matrix[r.a][r.b].u++; matrix[r.b][r.a].u++;
  }
}

const perLevel = {};
for (const a of LEVELS) {
  let w = 0, d = 0, l = 0, u = 0, n = 0, ms = 0, plies = 0, walls = 0, moves = 0;
  for (const b of LEVELS) {
    if (a === b) continue;
    const x = matrix[a][b];
    w += x.w; d += x.d; l += x.l; u += x.u; n += x.w + x.d + x.l + x.u;
  }
  for (const r of rows.filter((r) => r.a !== r.b && (r.a === a || r.b === a))) {
    ms += r.ms; plies += r.plies; walls += r.walls; moves += r.moves;
  }
  perLevel[a] = { name: NAMES[a], n, w, d, l, u, score: n ? Number(((w + 0.5 * d) / n).toFixed(4)) : 0,
    winRate: n ? Number((w / n).toFixed(3)) : 0, lossRate: n ? Number((l / n).toFixed(3)) : 0,
    risk: n ? Number(((l + u) / n).toFixed(3)) : 0,
    avgMs: n ? Math.round(ms / n) : 0, avgPlies: n ? Number((plies / n).toFixed(1)) : 0,
    avgWalls: n ? Number((walls / n).toFixed(1)) : 0, avgMoves: n ? Number((moves / n).toFixed(1)) : 0 };
}

const hashes = {};
for (const r of rows) hashes[r.contentHash] = (hashes[r.contentHash] || 0) + 1;
const duplicates = Object.values(hashes).filter((n) => n > 1).length;

const out = {
  schema: "glai-summary-v1", games: rows.length, invalidReplays: invalid,
  uniqueOpenings: new Set(rows.map((r) => r.openingId)).size,
  duplicateGames: duplicates,
  results: rows.reduce((m, r) => { m[r.result] = (m[r.result] || 0) + 1; return m; }, {}),
  avgMs: Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length),
  maxMs: Math.max(...rows.map((r) => r.ms)),
  avgPlies: Number((rows.reduce((s, r) => s + r.plies, 0) / rows.length).toFixed(1)),
  perLevel, matrix, self,
};
writeFileSync("_extract/glai/summary_all.json", JSON.stringify(out, null, 1));
const csv = ["level," + LEVELS.join(",")];
for (const a of LEVELS) {
  csv.push(a + "," + LEVELS.map((b) => a === b ? "-" : `${matrix[a][b].w}/${matrix[a][b].d}/${matrix[a][b].l}/${matrix[a][b].u}`).join(","));
}
writeFileSync("_extract/glai/matrix.csv", csv.join("\n") + "\n");
console.log(JSON.stringify({ games: out.games, invalid: out.invalidReplays, results: out.results, duplicateGames: duplicates, perLevel }, null, 1));
