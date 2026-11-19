/**
 * 服务端测试用的 WebSocket 客户端：记录所有消息，按条件等待，超时给出诊断。
 */

import { WebSocket } from "ws";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const seen = [];
    ws.on("message", (raw) => seen.push(JSON.parse(raw.toString())));
    ws.on("error", reject);
    ws.on("open", () => resolve({
      ws,
      seen,
      send: (obj) => ws.send(JSON.stringify(obj)),
      async wait(pred, label = "message", ms = 3000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const idx = seen.findIndex(pred);
          if (idx >= 0) return seen.splice(idx, 1)[0];
          await sleep(5);
        }
        throw new Error(`等待 ${label} 超时；已收到：${JSON.stringify(seen.map((m) => m.t))}`);
      },
      close: () => ws.close(),
    }));
  });
}
