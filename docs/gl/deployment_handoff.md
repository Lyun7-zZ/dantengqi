# 宗师+ 测试版部署交接说明（2026-11-27）

> 本文件只描述部署，不表示服务器已更新。实际部署由团队运维执行。

## 版本

| 项 | 值 |
|---|---|
| 发布标签 | `release-gl-gp-2026-11-27` |
| 回退标签 | `pre-gl-release-2026-11-27`（main@0941e85） |
| 发布分支 | `release/gl-gp-2026-11-27` |
| 发布内容 | 宗师+（测试版）+ 本地棋谱库 + GL4 中央上传 |
| 最新 main | 以远程 `origin/main` HEAD 为准，应包含标签 `release-gl-gp-2026-11-27` |

## 更新与部署

```bash
git fetch --tags origin
git checkout main
git pull --ff-only origin main
# 可选：核对发布标签
git describe --tags --exact-match
# 构建（仓库已含 dist，可省略；改前端时必须执行）
node tools/build-single.mjs
# 部署
sudo bash deploy/install.sh
```

- 默认端口 6657，可用 `PORT=...` 覆盖；
- 安装脚本复制 `server/ src/ dist/` 到 `/opt/danteng`，注册 systemd `danteng`；
- 升级前先记录当前 `git rev-parse HEAD`，便于回退。

## GL4 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `GL_ADMIN_TOKEN` | 管理接口必需 | 随机长字符串；只放服务端环境，不下发前端 |
| `GL_DATA_DIR` | 可选 | 默认 `/opt/danteng/data/gamelib`；需持久化 |
| `PORT` | 可选 | 默认 6657 |

systemd 示例：

```ini
Environment=GL_ADMIN_TOKEN=<强随机值>
Environment=GL_DATA_DIR=/opt/danteng/data/gamelib
```

- 管理令牌只通过 `Authorization: Bearer <token>` 传递；
- 服务端已拒绝 URL `?token=`，避免进入访问日志；
- 前端、Git、构建产物、日志中不得出现令牌；
- `deploy/install.sh` 首次运行会创建 `/etc/danteng.env`（600 权限，含 `GL_ADMIN_TOKEN`、`GL_DATA_DIR`）；
- 升级不会覆盖该文件；systemd unit 通过 `EnvironmentFile` 读取，不要手工把令牌写进 unit。

## 数据存储与备份

- 原始数据：`$GL_DATA_DIR/games.jsonl`、`$GL_DATA_DIR/positions.jsonl`；
- 每行一条，含 `contentHash`、`deleteTokenHash`、`storedAt`、`source`、`data`；
- 建议每日备份整个目录，保留 7–30 天；
- 备份与恢复需保持文件权限最小化（仅服务账号可读）；
- 数据目录不进入 Git，不随部署脚本覆盖。

## HTTPS 与安全

- 建议前置 Caddy/Nginx 终止 TLS，反代到 127.0.0.1:6657；
- 上传限制已内置：正文 ≤512KB、动作 ≤600、每 IP 每分钟 30 次；
- 反向代理侧建议再设 `client_max_body_size 1m`、连接/请求超时与访问日志脱敏；
- 不暴露管理令牌到浏览器；管理端只允许受控网络或额外鉴权；
- 上传内容按不可信数据处理，服务端逐手重放校验后才入库。

## 部署后验证清单

1. `curl -fsS https://<域名>/health` 返回 `{"ok":true}`；
2. 首页出现「宗师+（测试版）」，位于宗师与地狱之间；
3. 宗师/地狱原入口与配置不变；
4. 本地对局结束出现「保存棋谱 / 下载棋谱 / 贡献棋谱 / 复盘本局」；
5. 保存后刷新页面，棋谱仍在；导出→导入可复盘；
6. 保存局面→从局面继续可正常对弈；
7. 棋盘仍可正常落子、封墙、越线、结算；
8. 上传一局完成棋谱，返回 201 或 duplicate；
9. 服务端文件出现该记录；管理接口用 Authorization 头可查询；
10. 重复上传同局返回 duplicate；非法动作被 400 拒绝；
11. 使用删除令牌可删除；无令牌/错令牌 403；对局与局面均支持；
12. 上传棋谱缺少 `result`/`endReason`、行动方或逐手序号错误时返回 400；
13. 断网或服务不可用时，本地保存/复盘不受影响。

## 回退

```bash
git checkout pre-gl-release-2026-11-27
sudo bash deploy/install.sh
```

- 或 `git revert` 发布合并提交后重新部署；
- 回退不删除 `$GL_DATA_DIR` 中的用户棋谱；
- 回退后旧版页面不会展示棋谱库入口，但数据仍保留，可再次升级恢复。

## 已知限制

- 测试版未达 70/10，不构成正式棋力验收；
- WDL/S0/S1/H-ACS 等实验模块未接入；
- 12 局流程测试为无头产品生命周期测试，非全浏览器自动化；
- GL4 线上端到端需部署后按清单验证。
