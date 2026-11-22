/**
 * R0-2：冻结 232 动作编码表，输出带版本与哈希的 JSON，并做完整性测试。
 * 用法：node tools/rl/freeze-encoding.mjs
 */

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decode, encode, N_ACTIONS } from "./actions.mjs";

const entries = [];
const counts = { move: 0, v: 0, h: 0, top: 0 };
for (let i = 0; i < N_ACTIONS; i++) {
  const a = decode(i);
  if (encode(a) !== i) throw new Error(`双射失败：${i}`);
  counts[a.type === "move" ? "move" : a.kind]++;
  entries.push({ index: i, action: a });
}

const expect = { move: 4, v: 108, h: 110, top: 10 };
for (const [k, v] of Object.entries(expect)) {
  if (counts[k] !== v) throw new Error(`数量不符：${k} ${counts[k]} != ${v}`);
}

for (const bad of [-1, 232, 1.5, "1", null]) {
  let threw = false;
  try { decode(bad); } catch { threw = true; }
  if (!threw) throw new Error(`非法索引未被拒绝：${bad}`);
}

const body = { version: "r0-2", count: N_ACTIONS, counts, entries };
const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
const out = { ...body, sha256: hash };
writeFileSync(new URL("./action-table.json", import.meta.url), JSON.stringify(out, null, 1) + "\n", "utf8");
console.log(`动作表已冻结：${N_ACTIONS} 项，sha256 ${hash.slice(0, 16)}…`);
console.log("分类计数：", counts);
