/** W2/W3：B0/B1/B2/WDL-F 多项逻辑回归与独立评价。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "_extract/wdl";
mkdirSync(OUT, { recursive: true });
const rows = readFileSync(`${OUT}/dataset.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const CLASSES = ["W", "D", "L"];
const IDX = { W: 0, D: 1, L: 2 };

const B1 = ["dM", "dO", "M", "firstIsMe"];
const B2 = [...B1, "legacyEval"];
const F = [...B2, "exits", "pathMe", "pathOpp", "pathSatMe", "pathSatOpp",
  "mobilityMe", "mobilityOpp", "wallsUsedMe", "wallsUsedOpp", "oppAtExit", "meAtExit"];

function vec(r, keys) { return keys.map((k) => Number(r.features[k]) || 0); }
function standardize(rows, keys) {
  const n = rows.length, d = keys.length;
  const mean = Array(d).fill(0), sd = Array(d).fill(0);
  for (const r of rows) { const v = vec(r, keys); for (let j = 0; j < d; j++) mean[j] += v[j] / n; }
  for (const r of rows) { const v = vec(r, keys); for (let j = 0; j < d; j++) sd[j] += (v[j] - mean[j]) ** 2 / n; }
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  return { mean, sd };
}
function norm(v, st) { return v.map((x, j) => (x - st.mean[j]) / st.sd[j]); }

function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}
function predict(model, x) {
  const z = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    z[k] = model.b[k];
    for (let j = 0; j < x.length; j++) z[k] += model.w[k][j] * x[j];
  }
  return softmax(z);
}
function trainLogistic(rows, keys, { epochs = 400, lr = 0.1, l2 = 1e-3 } = {}) {
  const st = standardize(rows, keys);
  const data = rows.map((r) => ({ x: norm(vec(r, keys), st), y: IDX[r.label] }));
  const d = keys.length;
  const w = [Array(d).fill(0), Array(d).fill(0), Array(d).fill(0)];
  const b = [0, 0, 0];
  for (let ep = 0; ep < epochs; ep++) {
    const gw = [Array(d).fill(0), Array(d).fill(0), Array(d).fill(0)];
    const gb = [0, 0, 0];
    for (const { x, y } of data) {
      const p = predict({ w, b }, x);
      for (let k = 0; k < 3; k++) {
        const g = p[k] - (y === k ? 1 : 0);
        gb[k] += g;
        for (let j = 0; j < d; j++) gw[k][j] += g * x[j];
      }
    }
    for (let k = 0; k < 3; k++) {
      b[k] -= lr * gb[k] / data.length;
      for (let j = 0; j < d; j++) w[k][j] -= lr * (gw[k][j] / data.length + l2 * w[k][j]);
    }
  }
  return { keys, mean: st.mean, sd: st.sd, w, b };
}
function metrics(model, rows, keys, prior) {
  let ll = 0, brier = 0, acc = 0;
  const yCount = [0, 0, 0], predCount = [0, 0, 0];
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, hit: 0 }));
  for (const r of rows) {
    const p = model ? predict(model, norm(vec(r, keys), { mean: model.mean, sd: model.sd })) : prior.slice();
    const y = IDX[r.label];
    ll += -Math.log(Math.max(1e-12, p[y]));
    brier += p.reduce((s, q, k) => s + (q - (k === y ? 1 : 0)) ** 2, 0);
    const pred = p.indexOf(Math.max(...p));
    if (pred === y) acc++;
    yCount[y]++; predCount[pred]++;
    const conf = Math.max(...p);
    const bi = Math.min(9, Math.floor(conf * 10));
    bins[bi].n++; bins[bi].conf += conf; bins[bi].hit += (pred === y ? 1 : 0);
  }
  return {
    n: rows.length,
    logLoss: Number((ll / rows.length).toFixed(4)),
    brier: Number((brier / rows.length).toFixed(4)),
    accuracy: Number((acc / rows.length).toFixed(4)),
    classCounts: yCount, predCounts: predCount,
    calibration: bins.filter((b) => b.n).map((b) => ({ n: b.n, conf: Number((b.conf / b.n).toFixed(3)), acc: Number((b.hit / b.n).toFixed(3)) })),
  };
}

const train = rows.filter((r) => r.split === "train");
const val = rows.filter((r) => r.split === "val");
const test = rows.filter((r) => r.split === "test");
const priorCounts = [0, 0, 0];
for (const r of train) priorCounts[IDX[r.label]]++;
const prior = priorCounts.map((n) => n / train.length);

const models = {
  B0: { name: "B0 先验", model: null, keys: [], metrics: { val: metrics(null, val, [], prior), test: metrics(null, test, [], prior) } },
  B1: { name: "B1 距离", keys: B1 },
  B2: { name: "B2 legacy", keys: B2 },
  WDLF: { name: "WDL-F 战略特征", keys: F },
};

for (const key of ["B1", "B2", "WDLF"]) {
  const m = trainLogistic(train, models[key].keys);
  models[key].model = m;
  models[key].metrics = {
    val: metrics(m, val, models[key].keys, prior),
    test: metrics(m, test, models[key].keys, prior),
  };
}

const out = {
  schema: "wdl-eval-v1",
  data: { train: train.length, val: val.length, test: test.length, features: F },
  prior,
  models: Object.fromEntries(Object.entries(models).map(([k, v]) => [k, {
    name: v.name, keys: v.keys, metrics: v.metrics,
    weights: v.model ? { w: v.model.w, b: v.model.b, mean: v.model.mean, sd: v.model.sd } : null,
  }])),
};
writeFileSync(`${OUT}/model_eval.json`, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.models)) {
  console.log(k, "val", v.metrics.val.logLoss, v.metrics.val.brier, v.metrics.val.accuracy,
    "test", v.metrics.test.logLoss, v.metrics.test.brier, v.metrics.test.accuracy);
}
