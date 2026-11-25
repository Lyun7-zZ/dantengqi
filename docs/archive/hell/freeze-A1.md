# 地狱 A1 冻结配置

- 冻结标签：`hell-a1-freeze-2026-11-25`
- 源码提交：`4134567`（与 A0 共享；通过 `createHellConfig()` 区分）
- 配置哈希：`1ffffc1d`
- 状态：**地狱推荐冻结版本 / 暂定产品候选**

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
  "routeWalls": 6,
  "smartExit": true
}
```

## 冻结时结果

Q2 独立开局（25–54，30 开局 × 双座位 = 60 局，28s vs 3s）：

| 指标 | 值 |
|---|---|
| W / D / L / U | 42 / 4 / 11 / 3 |
| 胜率 | 70.0% |
| 负率 | 18.3% |
| 完局率 | 95.0% |

阶段结果：

| 开局集 | W/D/L/U | 胜率 |
|---|---|---|
| 0–9（20 局） | 18 / 1 / 1 / 0 | 90% |
| 10–24（30 局） | 24 / 0 / 5 / 1 | 80% |
| 25–54（60 局） | 42 / 4 / 11 / 3 | 70% |

**注意：A1 未达到「胜率 ≥70%、负率 ≤10%」的正式验收标准，仅作为冻结候选。**

## 复现

```bash
node tools/p0/run.mjs --count 55 --start-id 25 --end-id 54 \
  --shards 4 --shard 0 --hell-ms 28000 --gm-ms 3000 \
  --route-walls 6 --label A1-freeze
node tools/p0/summarize.mjs _extract/p0/runs/<runId>/03_games_raw_A1-freeze.jsonl
```
