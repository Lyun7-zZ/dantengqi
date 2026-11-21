/**
 * 汇总 hell-vs-gm 的日志：按座位统计胜平负、未分与耗时。
 * 用法：node tools/aggregate-gm.mjs _extract/gm-real3-a.log ...
 */

import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
const stats = {
  先手: { win: 0, draw: 0, loss: 0, unfinished: 0, times: [] },
  后手: { win: 0, draw: 0, loss: 0, unfinished: 0, times: [] },
};

for (const f of files) {
  let text;
  try {
    const buf = readFileSync(f);
    if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString("utf16le");
    else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.toString("utf8").slice(1);
    else text = buf.toString("utf8");
  } catch { continue; }
  for (const line of text.split("\n")) {
    const m = line.match(/第 \d+ 局（地狱(先手|后手)）：(地狱胜|宗师胜|平|未分)\((\d+)手, ([\d.]+)s\/手\)/);
    if (!m) continue;
    const [, seat, result, plies, sec] = m;
    const s = stats[seat];
    if (result === "地狱胜") s.win++;
    else if (result === "平") s.draw++;
    else if (result === "未分") s.unfinished++;
    else s.loss++;
    s.times.push(Number(sec));
  }
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
let total = { win: 0, draw: 0, loss: 0, unfinished: 0 };
for (const seat of ["先手", "后手"]) {
  const s = stats[seat];
  const n = s.win + s.draw + s.loss + s.unfinished;
  total.win += s.win; total.draw += s.draw; total.loss += s.loss; total.unfinished += s.unfinished;
  if (!n) continue;
  console.log(
    `${seat}：${n} 局 → ${s.win} 胜 / ${s.draw} 平 / ${s.loss} 负 / ${s.unfinished} 未分` +
    `，胜率 ${(s.win / n * 100).toFixed(0)}%，负率 ${(s.loss / n * 100).toFixed(0)}%` +
    `，每手均值 ${avg(s.times).toFixed(1)}s`,
  );
}
const n = total.win + total.draw + total.loss + total.unfinished;
console.log(`\n合计：${n} 局 → ${total.win} 胜 / ${total.draw} 平 / ${total.loss} 负 / ${total.unfinished} 未分`);
console.log(`胜率 ${(total.win / n * 100).toFixed(1)}%，负率 ${(total.loss / n * 100).toFixed(1)}%，不败率 ${((total.win + total.draw) / n * 100).toFixed(1)}%`);
