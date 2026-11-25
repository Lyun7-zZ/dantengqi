/** 独立汇总：从 JSONL 重算 W/D/L/U，可与 04_summary 对拍。 */

import { readFileSync, writeFileSync } from "node:fs";
import { summarize } from "./lib.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node tools/p0/summarize.mjs <jsonl> [out.json]");
const records = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const s = summarize(records);
console.log(JSON.stringify(s, null, 1));
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(s, null, 1));
