# GL0–GL3 实现说明

## GL0 格式

- `docs/gl/gl0_schema.md`；
- `schemaVersion=2`，`kind=game|position`；
- 对局 = 初始状态 + 有序动作 + 结果；普通棋谱不逐手存完整棋盘；
- `wallLimit` 的 Infinity 编码为 `"unlimited"`；
- 预留中央库上传字段与校验流程。

## GL1 记录

- 新开局创建 `S.recorder`；
- `advance` 逐手记录 `{ply, by, action}`；
- 终局自动 finalize 并保存；
- 悔棋后按 history 重建 recorder，避免动作与局面不一致。

## GL2 本地库

- localStorage 两个 key：games / positions；
- 保存、列表、删除、导出 JSON、导入 JSON；
- 导入逐手 `applyAction` 重放校验，失败拒绝；
- 默认仅本地，不上传。

## GL3 复盘

- 棋谱库 → 复盘；
- 自绘 10×12 棋盘，显示墙、出口、双方位置；
- 支持开头/上一步/下一步/末尾、点击任意手跳转；
- 独立模态，不改变当前对局状态。

## 局面资产

- 工具栏「保存局面」：保存任意时刻棋盘；
- 「导入」支持局面 JSON；
- 局面列表「从此局面继续」：载入为新对局；
- 支持未结束局面，便于保存复杂战略案例。

## 入口

- 左下角工具栏：棋谱库 / 保存局面 / 导入；
- 结算面板：保存棋谱 / 下载棋谱 / 复盘本局。

## 测试

- `test/game-library.test.js`：3 项通过；
- 单文件构建通过；
- 既有 UI 冒烟 71/71。
