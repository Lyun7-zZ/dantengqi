/** H 资格：H-base / H-safe / H-ACS 同状态对比。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { applyAction, validateAction, distanceOf } from "../../src/rules.js";
import { createMasterAI } from "../../src/ai-master.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { hSafeChoose, actionAllowsLoss } from "../../src/h-safe.js";
import { hAcsChoose } from "../../src/h-acs.js";
import { buildStates, buildHoldout, buildNew16 } from "../s0/states.mjs";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/h";
mkdirSync(OUT, { recursive: true });
const sets = [
  ["dev", buildStates()],
  ["hold", buildHoldout()],
  ["new", buildNew16()],
];
const rows = [];

for (const [split, items] of sets) {
  for (const item of items) {
    const s = item.state;
    const root = s.turn;
    const M0 = distanceOf(s, 1 - root) - distanceOf(s, root);

    const ai = createMasterAI(createGrandmasterPlusConfig({ pathCache: true }));
    const t0 = Date.now();
    const ah = ai(s, makeRng(93000));
    const lh = ai.stats.lastLog;
    const th = Date.now() - t0;
    const rh = ah ? applyAction(s, ah) : { ok: false };
    const Mh = rh.ok ? distanceOf(rh.state, 1 - root) - distanceOf(rh.state, root) : null;
    const lossH = ah ? actionAllowsLoss(s, ah) : true;

    const th0 = Date.now();
    const hs = hSafeChoose(s, { timeMs: 3000, bufferMs: 100 });
    const ths = Date.now() - th0;
    const rhs = hs.action ? applyAction(s, hs.action) : { ok: false };
    const Mhs = rhs.ok ? distanceOf(rhs.state, 1 - root) - distanceOf(rhs.state, root) : null;
    const lossHS = hs.action ? actionAllowsLoss(s, hs.action) : true;

    const ta0 = Date.now();
    const ha = hAcsChoose(s, { timeMs: 3000, bufferMs: 100 });
    const tas = Date.now() - ta0;
    const rha = ha.action ? applyAction(s, ha.action) : { ok: false };
    const Mha = rha.ok ? distanceOf(rha.state, 1 - root) - distanceOf(rha.state, root) : null;
    const lossHA = ha.action ? actionAllowsLoss(s, ha.action) : true;

    rows.push({ split, name: item.name, category: item.category, M0,
      hbase: { action: ah, source: lh.source, M: Mh, ms: th, loss: lossH, legal: !!(ah && validateAction(s, ah).ok) },
      hsafe: { action: hs.action, source: hs.source, M: Mhs, ms: ths, loss: lossHS, unsafe: hs.unsafe, legal: hs.legal },
      hacs: { action: ha.action, source: ha.source, M: Mha, ms: tas, loss: lossHA, acs: ha.acs, threat: ha.threat, legal: ha.legal },
    });
  }
}
writeFileSync(`${OUT}/cases.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const summary = {};
for (const split of ["dev", "hold", "new", "all"]) {
  const xs = split === "all" ? rows : rows.filter((r) => r.split === split);
  summary[split] = {
    n: xs.length,
    illegal: xs.reduce((s, r) => s + [r.hbase, r.hsafe, r.hacs].filter((x) => !x.legal).length, 0),
    lossHbase: xs.filter((r) => r.hbase.loss).length,
    lossHsafe: xs.filter((r) => r.hsafe.loss).length,
    lossHacs: xs.filter((r) => r.hacs.loss).length,
    safetyTriggered: xs.filter((r) => r.hsafe.unsafe).length,
    acsOverride: xs.filter((r) => r.hacs.acs).length,
    avgM: {
      hbase: Number((xs.reduce((s, r) => s + (r.hbase.M || 0), 0) / xs.length).toFixed(3)),
      hsafe: Number((xs.reduce((s, r) => s + (r.hsafe.M || 0), 0) / xs.length).toFixed(3)),
      hacs: Number((xs.reduce((s, r) => s + (r.hacs.M || 0), 0) / xs.length).toFixed(3)),
    },
    maxMs: Math.max(...xs.map((r) => Math.max(r.hbase.ms, r.hsafe.ms, r.hacs.ms))),
  };
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
