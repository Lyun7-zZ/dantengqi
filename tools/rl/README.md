# RL 环境原型（R0-1）

## 动作编码（232）

| 区间 | 数量 | 含义 |
|---|---|---|
| 0–3 | 4 | 走子：up / down / left / right |
| 4–111 | 108 | 竖墙：`4 + c*12 + r`，c 0–8，r 0–11 |
| 112–221 | 110 | 横墙：`112 + c*11 + r`，c 0–9，r 0–10 |
| 222–231 | 10 | 顶部封口：`222 + c`，c 0–9 |

`actions.mjs` 提供 `encode / decode / selfTest`，已通过 232 项双射自测。

## 常驻服务协议（JSON Lines over stdio）

请求：

```json
{"id": 1, "op": "ping"}
{"id": 2, "op": "mask", "state": {...}}
{"id": 3, "op": "step", "state": {...}, "index": 17}
{"id": 4, "op": "legal", "state": {...}}
```

响应：

```json
{"id": 2, "ok": true, "mask": [0,1,...], "count": 14}
{"id": 3, "ok": true, "state": {...}, "winner": null, "plies": 21}
```

状态字段：`vWall / hWall / topWall / players / turn / firstPlayer / wallsPlaced`。

## 基准

```bash
node tools/rl/bench-r01.mjs 120
```

输出进程内与 IPC 的掩码、单步、批量耗时与吞吐估算。

## 当前结论

- IPC 在掩码往返中只占约 11%，状态 JSON 平均 0.6 KB；
- 掩码生成（232 次合法性检查）约 0.5ms，是主要成本；
- 单 worker 约 1700 次掩码/秒、14000 次单步/秒；
- 现阶段不需要 Python 移植，保留 JS 为规则真值。
