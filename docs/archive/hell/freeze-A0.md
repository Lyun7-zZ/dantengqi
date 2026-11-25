# 地狱 A0 冻结配置

- 冻结标签：`hell-a0-freeze-2026-11-25`
- 源码提交：`4134567`（与 A1 共享；通过 `createHellA0Config()` 区分）
- 配置哈希：`9b33f828`
- 状态：**回退版本 / 历史对照**，不作为当前生产默认

## 完整配置

```json
{
  "timeMs": 28000,
  "maxDepth": 12,
  "usePlan": true,
  "netWalls": true,
  "avoidRepeat": true,
  "repeatPenalty": 160,
  "planMoves": true,
  "planFallback": true,
  "necessaryPathGuard": "soft",
  "endgameDepth": 12,
  "routeWalls": 3,
  "smartExit": true
}
```

## 冻结时结果

Q2 独立开局（25–54，30 开局 × 双座位 = 60 局，28s vs 3s）：

| 指标 | 值 |
|---|---|
| W / D / L / U | 38 / 4 / 13 / 5 |
| 胜率 | 63.3% |
| 负率 | 21.7% |
| 完局率 | 91.7% |

历史结果：A0 20 局配对 12 胜 1 平 6 负 1 未完成（完局胜率 63.2%）。

## 复现

```bash
node tools/p0/run.mjs --count 55 --start-id 25 --end-id 54 \
  --shards 4 --shard 0 --hell-ms 28000 --gm-ms 3000 \
  --route-walls 3 --label A0-freeze
node tools/p0/summarize.mjs _extract/p0/runs/<runId>/03_games_raw_A0-freeze.jsonl
```

## 如何切回 A0

把 `src/ai.js` 与 `src/ai-worker.js` 中的 `createHellConfig()` 改为 `createHellA0Config()`，
重新执行 `node tools/build-single.mjs`。
