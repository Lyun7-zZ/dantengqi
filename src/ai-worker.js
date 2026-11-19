/**
 * AI 专用 Worker：把搜索放到后台线程，主线程的计时与动画不再被阻塞。
 * 开发时以 module worker 加载；单文件版由 build-single 内联成 Blob。
 */

import { createMasterAI } from "./ai-master.js";

const CONFIG = {
  hard: { timeMs: 350, maxDepth: 4, usePlan: false },
  master: { timeMs: 1200, maxDepth: 6, usePlan: true },
  hell: { timeMs: 5000, maxDepth: 20, usePlan: true },
};

let ai = null;
let level = null;

self.onmessage = (e) => {
  const d = e.data;
  if (!d) return;
  if (d.type === "reset") {
    ai = null;
    level = null;
    return;
  }
  const cfg = CONFIG[d.level];
  if (!cfg) {
    self.postMessage({ id: d.id, ok: false, error: "no-level" });
    return;
  }
  if (!ai || level !== d.level) {
    ai = createMasterAI(cfg);
    level = d.level;
  }
  try {
    const action = ai(d.state, Math.random);
    self.postMessage({ id: d.id, ok: true, action });
  } catch (err) {
    self.postMessage({ id: d.id, ok: false, error: String(err) });
  }
};
