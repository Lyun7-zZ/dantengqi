# GL0 棋谱格式规范（v2）

## 目标

统一保存完整对局与任意时刻局面，支持导入导出、复盘、历史整合与未来中央库上传；默认仅本地存储。

## 对局对象

```json
{
  "schemaVersion": 2,
  "kind": "game",
  "gameId": "g...",
  "createdAt": "2026-11-27T...",
  "endedAt": "2026-11-27T...",
  "mode": "local|easy|normal|hard|online",
  "seat": 0,
  "firstPlayer": 0,
  "source": "human-vs-ai|human-vs-human|online|position",
  "config": {},
  "initialState": { "vWall": [], "hWall": [], "topWall": [], "players": [], "turn": 0,
    "firstPlayer": 0, "drawMode": "firstOnly", "tolerance": 1,
    "wallLimit": ["unlimited", "unlimited"], "wallsUsed": [0,0],
    "plies": 0, "wallsPlaced": 0, "winner": null },
  "actions": [ { "ply": 1, "by": 0, "action": { "type": "move", "dir": "up" } } ],
  "result": { "winner": 0, "endReason": "normal_terminal", "plies": 42, "finalState": {} }
}
```

- 核心可重放信息 = `initialState + actions`；普通棋谱不逐手存完整棋盘。
- `result.finalState` 用于快速校验与展示，不作为重放唯一来源。
- `wallLimit` 的 Infinity 编码为 `"unlimited"`。
- 未完成：`result.winner = null`、`endReason = "unfinished"`。

## 局面对象

```json
{
  "schemaVersion": 2,
  "kind": "position",
  "positionId": "p...",
  "createdAt": "...",
  "name": "用户命名",
  "note": "",
  "mode": "local",
  "config": {},
  "state": {}
}
```

## 结束原因

`normal_terminal | resign | timeout | disconnect | ply_cap | manual_stop | unfinished`

## 导入校验

1. `schemaVersion === 2`；
2. `kind` 合法；
3. 对局逐手 `applyAction` 重放，失败拒绝；
4. 局面字段可 `normalizeState`；
5. 未知版本隔离，不进入训练集。

## 存储

- 本地：`localStorage` 两个 key（games / positions），上限分别 500 / 300 条，超出淘汰最旧。
- 未来中央库：同一对象上传，服务端重放校验、内容哈希幂等、访问控制；前端不嵌入写权限令牌。

## 隐私

默认本地、默认不上传；上传需用户主动确认；不要求姓名、邮箱。
