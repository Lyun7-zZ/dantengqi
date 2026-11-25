# M0 预注册：宗师+ 3 秒基线

- 分支：`grandmaster-plus`（不合并 main）
- 日期：2026-11-25
- 依据：《宗师+算法优化指导书 V1.0》第 3–4 节

## 目标

在相同 3,000ms 整次决策预算下，比较三种基线的棋力与风险：

| 组 | 被测方 | 对手 |
|---|---|---|
| G0 | 固定宗师 3s | 同版宗师 3s |
| H0 | A0 地狱算法 3s（routeWalls=3） | 固定宗师 3s |
| H1 | A1 地狱算法 3s（routeWalls=6） | 固定宗师 3s |

本阶段只选开发基线，不是正式验收。

## 冻结项

- 宗师：`timeMs=3000, maxDepth=7, usePlan, netWalls, avoidRepeat, repeatPenalty=160, planMoves, planFallback, necessaryPathGuard=soft, endgameDepth=9`
- H0：`createHellA0Config({ timeMs: 3000 })`
- H1：`createHellConfig({ timeMs: 3000 })`
- 手数上限：240；结果字段：W/D/L/U 单列
- 开局：id 55–74，共 20 个全新开局
- 种子：`90000 + openingId * 2 + seat`
- 双座位各一局；每组 40 局，合计 120 局
- 8 个 shard，按组顺序执行（G0 → H0 → H1）
- 同一机器、同一 Node、同一并发；组间不并行

## 统计

- 主表：W / D / L / U（计划局数分母）
- 辅助：积分 (W+0.5D)/N（U=0）、保守风险 (L+U)/N、完局率
- 座位分层；逐手耗时 p50/p90/p99/max、超时数、完成深度、候选数
- 组间比较使用同批开局，描述性报告；不把 G0 当正式对手以外用途

## 异常与停止

- 非法动作、超时（tTotal > 3000ms）立即停止该 shard 并报告
- 仅基础设施故障允许按预注册整批重跑；保留首次记录
- 不追加样本至过线；不做选择性重跑

## 交付

`m0_preregister.md`、`games_raw.jsonl`、`m0_summary.json`、`m0_report.docx`、
`next_arm_draft.md`（下一项单变量实验草案）。

完成后 **HARD PAUSE**，不自动启动 M1–M4。
