# 地狱难度归档与宗师+决策（2026-11-25）

状态：**HARD PAUSE**。本轮只归档、冻结与记录，不启动新算法研发、不改生产代码、不新增 UI 难度入口。

## 正式决策

- 新增难度：宗师+（内部 ID `grandmasterPlus`），层级为 宗师 → 宗师+ → 地狱；
- 宗师+ 整次决策预算 ≤ 3,000 ms；
- 验收：200 局独立配对开局，胜率 ≥70%（≥140 胜）、负率 ≤10%（≤20 负），未完成/非法/超时均为 0；
- 地狱保留 28 秒机制，与宗师+ 独立管理；
- 本轮只记录决策，M0 未执行。

## 地狱冻结

| 版本 | 标签 | 配置哈希 | 定位 |
|---|---|---|---|
| A0 | `hell-a0-freeze-2026-11-25` | `9b33f828` | 回退版本 / 历史对照 |
| A1 | `hell-a1-freeze-2026-11-25` | `1ffffc1d` | 推荐冻结版本 / 暂定候选 |

两者共享源码提交 `4134567`，通过配置区分：

- A0：`createHellA0Config()`，`routeWalls=3`；
- A1：`createHellConfig()`，`routeWalls=6`。

A1 的 Q2 结果为 42/4/11/3（70.0% 胜、18.3% 负），**未达到正式验收标准**，仅作冻结候选。

## 归档清单

| 文件 | 内容 |
|---|---|
| [研发决策意见书 v1.1](蛋疼棋_新增宗师Plus难度_研发决策意见书_v1.1_2026-11-25.docx) | 本轮决策原文 |
| [宗师+算法优化指导书 V1.0](蛋疼棋_宗师Plus算法优化指导书_V1.0_2026-11-25.docx) | M0–M4 的实施指南（未启动） |
| [A0 冻结配置](freeze-A0.md) | 配置、哈希、结果、复现 |
| [A1 冻结配置](freeze-A1.md) | 配置、哈希、结果、复现 |
| [config-A0.json](config-A0.json) | 机器可读配置快照 |
| [config-A1.json](config-A1.json) | 机器可读配置快照 |
| [失败棋谱索引](failure-cases.md) | Q2 的 14 个失败/未完成 |
| [未执行方案](unexecuted-proposals.md) | R0-lite、A1-R、A1-S、A2、B1、Q3 |
| [M0 预备方案](m0-preplan.md) | G0/H0/H1，未执行 |

原始数据仍保留在：

- `_extract/p0/q2/`：Q2 120 局完整 JSONL、配对表、汇总；
- `_extract/p0/q0q1/`、`_extract/p0/q1b/`、`_extract/p0/q1b2/`：审计与诊断；
- `_extract/p0/r0/`：失败分类；
- `tools/p0/`：评测与诊断脚本。

## 暂停任务

R0、A1-R、A1-S、A2、B1、Q3、M0–M4 均暂停，等待单独授权。
未来 M0 的启动协议、分组、计时与统计口径以《宗师+算法优化指导书 V1.0》为准。

## 复现入口

```bash
node tools/p0/run.mjs --count 55 --start-id 25 --end-id 54 \
  --shards 4 --shard 0 --hell-ms 28000 --gm-ms 3000 \
  --route-walls 6 --label A1-freeze
```

评测数据写入 `_extract/`（已 gitignore），不进入版本库。
