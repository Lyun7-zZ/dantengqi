/** Q2-close：完整性、配对转移、失败分类与 R0 候选状态。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SRC = "_extract/p0/q2";
const OUT = "_extract/p0/r0";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(`${SRC}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("games_raw.jsonl");
const a0 = rows.filter((r) => r.label.startsWith("A0"));
const a1 = rows.filter((r) => r.label.startsWith("A1"));
const key = (r) => `${r.openingId}-${r.seat}`;
const k0 = new Map(a0.map((r) => [key(r), r]));
const k1 = new Map(a1.map((r) => [key(r), r]));

const problems = [];
if (a0.length !== 60) problems.push(`A0 count ${a0.length}`);
if (a1.length !== 60) problems.push(`A1 count ${a1.length}`);
for (const k of k0.keys()) if (!k1.has(k)) problems.push(`missing A1 ${k}`);
for (const [k, r] of k0) {
  if (r.seed !== 70000 + r.openingId * 2 + r.seat) problems.push(`bad seed ${k}`);
  if (r.routeWalls !== 3) problems.push(`bad rw A0 ${k}`);
}
for (const [k, r] of k1) {
  if (r.seed !== 70000 + r.openingId * 2 + r.seat) problems.push(`bad seed ${k}`);
  if (r.routeWalls !== 6) problems.push(`bad rw A1 ${k}`);
}

const RESULTS = ["hell_win", "draw", "hell_loss", "unfinished"];
const transition = {};
for (const a of RESULTS) transition[a] = Object.fromEntries(RESULTS.map((b) => [b, 0]));
for (const k of k0.keys()) transition[k0.get(k).result][k1.get(k).result]++;

const pts = (r) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : 0);
const failures = [...k1.values()].filter((r) => r.result === "hell_loss" || r.result === "unfinished")
  .map((r) => {
    const o = k0.get(key(r));
    return {
      key: key(r), openingId: r.openingId, seat: r.seat, a1: r.result, a0: o.result,
      plies: r.plies, tMax: r.tHellMax, tAvg: r.tHellAvg, cand: r.candidateCount,
      route: r.routeCutAdded, sources: r.selectedSources,
      transition: `${o.result}->${r.result}`,
    };
  }).sort((x, y) => y.tMax - x.tMax);

const bySeat = (rs, seat) => {
  const sub = rs.filter((r) => r.seat === seat);
  const c = (k) => sub.filter((r) => r.result === k).length;
  return { n: sub.length, W: c("hell_win"), D: c("draw"), L: c("hell_loss"), U: c("unfinished") };
};

const audit = {
  counts: { a0: a0.length, a1: a1.length },
  problems,
  transition,
  a0: { seat0: bySeat(a0, 0), seat1: bySeat(a0, 1) },
  a1: { seat0: bySeat(a1, 0), seat1: bySeat(a1, 1) },
  failures,
};
writeFileSync(`${OUT}/q2_audit.json`, JSON.stringify(audit, null, 1));

const lines = ["openingId\tseat\tA0\tA1\tA1_plies\tA1_tMax\tA1_cand\tA1_route"];
for (const f of failures) lines.push(`${f.openingId}\t${f.seat}\t${f.a0}\t${f.a1}\t${f.plies}\t${f.tMax}\t${f.cand}\t${f.route}`);
writeFileSync(`${OUT}/q2_failure_pairs.tsv`, lines.join("\n") + "\n");

// R0 候选：失败局中按 A1 最大用时/候选数排序，取最多 6 个；另取 2 个胜局对照
const candidates = failures.slice(0, 6).map((f) => ({ key: f.key, role: "failure", ...f }));
const wins = [...k1.values()].filter((r) => r.result === "hell_win" && r.tHellMax > 27000)
  .slice(0, 2).map((r) => ({ key: key(r), role: "control", a0: k0.get(key(r)).result, a1: r.result, tMax: r.tHellMax, cand: r.candidateCount }));
writeFileSync(`${OUT}/r0_candidates.json`, JSON.stringify({ candidates, wins }, null, 1));

console.log(JSON.stringify({ problems, transition, failures: failures.length, cand: candidates.length, wins: wins.length }, null, 1));
