/** M1b 资格：路径查询审计、精确缓存等价性与 G7+/G9+ 固定状态对照。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createMasterAI } from "../../src/ai-master.js";
import { createState, applyAction, validateAction, legalActions } from "../../src/rules.js";
import { createGrandmasterPlusConfig, createGrandmasterConfig } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/m1b";
mkdirSync(OUT, { recursive: true });
const openings = makeOpenings(75);
const opMap = new Map(openings.map((o) => [o.id, o]));

function hash(s) {
  return createHash("sha256").update(JSON.stringify({
    v: Array.from(s.vWall), h: Array.from(s.hWall), t: Array.from(s.topWall),
    p: s.players, turn: s.turn, plies: s.plies,
  })).digest("hex").slice(0, 16);
}
function scripted(id, plies) {
  let s = replayOpening(opMap.get(id).actions);
  for (let i = 0; i < plies; i++) {
    const acts = legalActions(s);
    let a = acts[(i * 7 + 3) % acts.length];
    if (!a || !validateAction(s, a).ok) a = { type: "move", dir: "up" };
    const r = applyAction(s, a);
    if (!r.ok || r.state.winner !== null) break;
    s = r.state;
  }
  return s;
}
function endgame() {
  const s = createState(0);
  s.players = [{ c: 4, r: 1 }, { c: 5, r: 2 }];
  for (let c = 0; c < 10; c++) if (c !== 4 && c !== 5) s.topWall[c] = 1;
  for (let c = 0; c < 10; c++) s.hWall[c * 11 + 1] = 1;
  s.hWall[4 * 11] = 0;
  s.hWall[5 * 11] = 0;
  s.plies = 88;
  return s;
}

const states = [];
for (const id of [55, 65]) states.push({ name: `early-${id}`, phase: "开局", state: replayOpening(opMap.get(id).actions) });
for (const id of [56, 61]) states.push({ name: `mid-${id}`, phase: "中局", state: scripted(id, 26) });
for (const id of [70, 71]) states.push({ name: `end-${id}`, phase: "残局", state: scripted(id, 80) });
states.push({ name: "end-synth", phase: "残局", state: endgame() });
for (let k = 0; k < 16; k++) {
  const id = 56 + k;
  const ply = [14, 34][k % 2];
  states.push({ name: `gen-${id}-${ply}`, phase: ply < 20 ? "开局" : "中局", state: scripted(id, ply) });
}
for (const st of states) st.hash = hash(st.state);

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

// B0：3s 决策内的查询审计
const b0 = [];
for (const st of states.slice(0, 6)) {
  for (let rep = 0; rep < 3; rep++) {
    const ai = createMasterAI(createGrandmasterPlusConfig({ pathCache: true }));
    const a = ai(st.state, makeRng(30000 + rep));
    const log = ai.stats.lastLog;
    b0.push({ state: st.name, rep, tTotal: Math.round(log.tTotal), action: a, cache: log.pathCache });
  }
}
writeFileSync(`${OUT}/path_query_audit.json`, JSON.stringify(b0, null, 1));

// B1：固定深度 6，cache off/on 交错
const b1 = [];
for (const st of states) {
  for (let rep = 0; rep < 3; rep++) {
    for (const cache of [false, true]) {
      const ai = createMasterAI(createGrandmasterPlusConfig({
        timeMs: 120000, maxDepth: 6, pathCache: cache,
      }));
      const t0 = Date.now();
      const a = ai(st.state, makeRng(40000 + rep));
      const log = ai.stats.lastLog;
      b1.push({
        state: st.name, hash: st.hash, rep, cache, action: a,
        tTotal: Math.round(log.tTotal), wall: Date.now() - t0,
        nodes: log.nodes, depth: log.depthLast, cacheStats: log.pathCache,
      });
    }
  }
}
writeFileSync(`${OUT}/bench_raw.jsonl`, b1.map((x) => JSON.stringify(x)).join("\n") + "\n");

const b1sum = [];
for (const st of states) {
  const rs = b1.filter((x) => x.state === st.name);
  const off = rs.filter((x) => !x.cache);
  const on = rs.filter((x) => x.cache);
  const toff = median(off.map((x) => x.tTotal));
  const ton = median(on.map((x) => x.tTotal));
  const eq = off.every((o) => on.some((n) => n.rep === o.rep &&
    JSON.stringify(n.action) === JSON.stringify(o.action) && n.nodes === o.nodes));
  b1sum.push({
    state: st.name, hash: st.hash, toff, ton,
    speedup: toff ? Number(((toff - ton) / toff).toFixed(4)) : 0,
    equivalent: eq,
    nodes: off[0]?.nodes, depth: off[0]?.depth,
    hitRate: median(on.map((x) => x.cacheStats?.hitRate || 0)),
    unique: on[0]?.cacheStats?.uniqueKeys,
  });
}
const overall = {
  states: b1sum.length,
  medianSpeedup: median(b1sum.map((x) => x.speedup)),
  equivalent: b1sum.every((x) => x.equivalent),
  medianHit: median(b1sum.map((x) => x.hitRate)),
};
writeFileSync(`${OUT}/equivalence.json`, JSON.stringify({ overall, rows: b1sum }, null, 1));

// G7+/G9+：同一 Plus 限时，只改深度上限
const g = [];
for (const st of states.slice(0, 6)) {
  for (const depth of [7, 9]) {
    for (let rep = 0; rep < 3; rep++) {
      const ai = createMasterAI(createGrandmasterConfig({ maxDepth: depth, returnBuffer: 100 }));
      const a = ai(st.state, makeRng(50000 + rep));
      const log = ai.stats.lastLog;
      g.push({ state: st.name, depthLimit: depth, rep, action: a,
        tTotal: Math.round(log.tTotal), depth: log.depthLast, nodes: log.nodes });
    }
  }
}
writeFileSync(`${OUT}/gm_depth.json`, JSON.stringify(g, null, 1));
console.log(JSON.stringify({ b0: b0.length, overall, g: g.length }, null, 1));
