/** 合并 shard JSONL 并重算汇总。 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { summarize } from "./lib.mjs";

const label = process.argv[2] ?? "A0";
const shards = Number(process.argv[3] ?? 4);
const records = [];
for (let i = 0; i < shards; i++) {
  const f = `_extract/p0/03_games_raw_${label}-s${i}.jsonl`;
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (line.trim()) records.push(JSON.parse(line));
  }
}
const s = summarize(records);
writeFileSync(`_extract/p0/03_games_raw_${label}.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(`_extract/p0/04_summary_${label}.json`, JSON.stringify(s, null, 1));
console.log(JSON.stringify({ label, ...s }, null, 1));
