# Stage 0 审计

数据：_extract/sp2/all.jsonl

- 总对局：202
- 正常结束：176
- 截断（240 手上限）：26

## 1. 对局结果分布

| 类型 | 玩家0胜 | 玩家1胜 | 平局 |
|---|---|---|---|
| 自对弈 | 67 | 61 | 11 |
| 对宗师 | 22 | 13 | 2 |

## 2. 截断局分析

| 局 | 手数 | 重复局面 | 终局距离 | 出口 | 墙数 | 最后40手行动 |
|---|---|---|---|---|---|---|
| 30005 | 240 | 0 | 6:12 | 1 | 90 | move:down×13, move:left×9, move:up×9, wall:v×5 |
| 30008 | 240 | 2 | 8:41 | 1 | 95 | move:up×11, wall:v×8, move:right×8, move:down×7 |
| 30024 | 240 | 0 | 50:18 | 1 | 98 | wall:v×10, move:up×8, move:right×8, move:down×8 |
| 31023 | 240 | 1 | 34:3 | 1 | 97 | move:left×15, move:up×11, move:down×6, wall:v×4 |
| 31025 | 240 | 1 | 9:58 | 1 | 101 | move:down×11, move:up×7, move:left×7, wall:v×6 |
| 31026 | 240 | 1 | 29:3 | 1 | 96 | move:left×11, move:right×9, move:down×8, move:up×8 |
| 32000 | 240 | 0 | 4:8 | 1 | 80 | move:right×11, move:up×10, move:down×9, wall:v×5 |
| 32007 | 240 | 0 | 6:12 | 1 | 90 | move:down×13, move:left×9, move:up×9, wall:v×5 |
| 32008 | 240 | 0 | 36:9 | 1 | 95 | move:right×11, move:up×10, move:down×8, wall:h×4 |
| 32015 | 240 | 1 | 10:49 | 1 | 97 | move:down×10, move:up×9, move:right×8, move:left×8 |
| 32025 | 240 | 0 | 14:17 | 1 | 99 | move:right×12, move:up×12, move:left×9, move:down×5 |
| 32026 | 240 | 0 | 14:3 | 1 | 85 | move:down×15, move:up×12, wall:v×7, move:right×6 |
| 33014 | 240 | 2 | 15:22 | 1 | 99 | wall:v×11, move:up×11, move:down×8, move:left×6 |
| 34002 | 240 | 0 | 39:6 | 1 | 95 | move:up×9, move:right×9, move:left×9, move:down×7 |
| 34004 | 240 | 1 | 19:13 | 1 | 92 | move:up×12, move:left×8, move:down×8, wall:v×5 |
| 34006 | 240 | 0 | 7:21 | 1 | 82 | move:up×12, move:left×12, move:down×8, wall:h×4 |
| 34013 | 240 | 0 | 9:1 | 1 | 92 | move:up×14, move:left×13, move:right×7, move:down×6 |
| 34020 | 240 | 1 | 12:19 | 1 | 97 | move:up×11, wall:v×8, move:right×8, move:left×8 |
| 34024 | 240 | 0 | 25:10 | 1 | 93 | move:left×16, move:down×12, move:up×7, move:right×4 |
| 35013 | 240 | 1 | 13:52 | 1 | 97 | move:up×12, move:down×10, wall:v×8, move:left×7 |
| 35014 | 240 | 0 | 34:2 | 1 | 98 | wall:h×10, move:right×10, move:left×9, move:down×5 |
| 35016 | 240 | 0 | 3:16 | 1 | 71 | move:up×13, move:right×10, move:left×8, wall:v×4 |
| 35018 | 240 | 1 | 2:53 | 1 | 89 | move:right×16, move:left×11, move:up×8, move:down×5 |
| 40013 | 240 | 0 | 4:6 | 1 | 74 | move:up×10, move:left×8, move:right×7, wall:v×6 |
| 40017 | 240 | 0 | 11:38 | 1 | 55 | move:left×19, move:down×7, move:right×6, move:up×5 |
| 41018 | 240 | 1 | 8:41 | 1 | 73 | move:up×11, move:down×10, move:right×9, move:left×7 |

## 3. 特征共线

样本 29526 行，特征 28 个。
- 零方差特征：无
- |相关系数| ≥ 0.9 的特征对：16 组
  - ply ↔ wallsPlaced：+0.958
  - ply ↔ wallDensity：+0.958
  - dMe ↔ pathLenMe：+1.000
  - dOpp ↔ pathLenOpp：+1.000
  - margin ↔ gapWorst：+0.978
  - margin ↔ gapBest：+0.978
  - margin ↔ gapMean：+0.999
  - exits ↔ nearMe：+0.927
  - exits ↔ nearOpp：+0.928
  - exits ↔ exitCount：+1.000
  - nearMe ↔ exitCount：+0.927
  - nearOpp ↔ exitCount：+0.928
  - wallsPlaced ↔ wallDensity：+1.000
  - gapWorst ↔ gapBest：+0.915
  - gapWorst ↔ gapMean：+0.978
  - gapBest ↔ gapMean：+0.978
- 标准化矩阵条件数：490251100890.6

## 4. 标签随阶段分布

| 阶段 | 样本 | 胜标签 | 平/负标签 |
|---|---|---|---|
| 开局 ply<30 | 3589 | 1744 | 1845 |
| 中局 30-59 | 4520 | 2197 | 2323 |
| 后段 60+ | 17365 | 8195 | 9170 |

## 5. 开局多样性

- 不同首手：3 种，共 176 局
- 最常见首手：[('{"dir": "up", "type": "move"}', 81), ('{"dir": "right", "type": "move"}', 48), ('{"dir": "left", "type": "move"}', 47)]
