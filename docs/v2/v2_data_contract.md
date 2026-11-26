# V2 数据契约（V2-0）

所有日志 UTF-8 JSONL；一行一个对象；字段缺失写 null，不补造。

## 1. 状态快照 `state`

```json
{
  "v": 1,
  "gameId": "b2b-95-0",
  "openingId": 95,
  "seat": 0,
  "ply": 42,
  "turn": 0,
  "firstPlayer": 0,
  "tolerance": 1,
  "drawMode": "firstOnly",
  "wallLimit": [null, null],
  "wallsUsed": [3, 2],
  "players": [[2, 8], [7, 6]],
  "vWall": "base64",
  "hWall": "base64",
  "topWall": "base64",
  "winner": null
}
```

`wallLimit` 的 Infinity 用 null 表示；读取时恢复为 Infinity。

## 2. 候选 `candidate`

```json
{
  "stateId": "b2b-95-0:42",
  "candidateId": "w:v:4:7",
  "action": {"type": "wall", "kind": "v", "c": 4, "r": 7},
  "generatedBy": "move|exit|plan|routeCut|scan|planFallback",
  "legal": true,
  "enteredSearch": true,
  "completed": false,
  "selected": false,
  "orderScore": 12.5,
  "searchScore": null,
  "bound": "exact|lower|upper|null",
  "depth": 6
}
```

## 3. 搜索 `search`

```json
{
  "stateId": "b2b-95-0:42",
  "mode": "legacy|race|v2-e",
  "maxDepth": 12,
  "completedDepth": 8,
  "nodes": 18234,
  "candidates": 214,
  "searched": 96,
  "cutoff": false,
  "elapsedMs": 2870,
  "externalMs": 2912,
  "aborted": false
}
```

## 4. 决策 `decision`

```json
{
  "stateId": "b2b-95-0:42",
  "chosen": "w:v:4:7",
  "source": "search|plan|plan-new|exit|safeDraw|deadline|guard",
  "score": 5523,
  "proven": null,
  "risk": null,
  "fallback": false,
  "externalMs": 2912,
  "overBudget": false
}
```

## 5. 对手条件标签 `label`

```json
{
  "stateId": "b2b-95-0:42",
  "seeds": [1001, 1002, 1003],
  "continuations": 6,
  "w": 3, "d": 1, "l": 2, "u": 0,
  "pWin": 0.5, "pDraw": 0.167, "pLoss": 0.333,
  "opponent": "grandmaster-3s@<commit>",
  "calibrated": false,
  "notes": "固定宗师 + 多种子续局；按 openingId 隔离"
}
```

## 6. 对局 `game`

```json
{
  "gameId": "v2c-120-1",
  "openingId": 120,
  "seat": 1,
  "seed": 112001,
  "sourceCommit": "<sha>",
  "configHash": "<hash>",
  "result": "hell_win|draw|hell_loss|unfinished",
  "plies": 143,
  "actions": [],
  "decisions": [],
  "externalMax": 2940,
  "illegal": 0,
  "timeout": 0
}
```

## 7. 版本与校验

- 每个文件首行可写 `{"schema":"v2.0"}`；
- 关键文件附 SHA-256；
- 配置以完整有效对象记录，不写工厂名；
- 缓存开启/关闭、evalRaceMode、pathCache 必须显式。
