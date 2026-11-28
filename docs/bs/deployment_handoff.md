# 多规格棋盘版本部署交接

## 版本

| 项 | 完整值 |
|---|---|
| main | `c79ba127cdcf033eb149dbba9d3b6dff2e631e20` |
| 产品代码提交 | `34f47d4dd0efa56a6253e2aab0013b95af7d263f` |
| 发布标签 | `release-bs-multisize-2026-11-27` → `c79ba127cdcf033eb149dbba9d3b6dff2e631e20` |
| 回退标签 | `pre-bs-release-2026-11-27` → `01a65ca7c2185f96f1fb40e128bf5fec958e1d1d` |
| 构建 | `dist/蛋疼棋.html`，约 3.18MB |

标签解引用后的完整 SHA 才是比较对象；不要用 7 位短码做 `test`。

## 实际安装布局

| 项 | 值 |
|---|---|
| `APP_DIR` | `/opt/danteng` |
| 安装内容 | `${APP_DIR}/server`、`${APP_DIR}/src`、`${APP_DIR}/dist`、`${APP_DIR}/data/gamelib` |
| systemd | `/etc/systemd/system/danteng.service` |
| 环境文件 | `/etc/danteng.env`（600） |
| 服务账号 | `danteng` |
| 端口 | `6657` |
| 源码工作区 | 独立目录，例如 `/opt/danteng-src`；不是 `${APP_DIR}/src` |

安装脚本只复制程序文件，不创建 Git 工作区。

## 升级步骤

```bash
set -euo pipefail
APP_DIR=/opt/danteng
ENV=/etc/danteng.env
TS=$(date +%Y%m%d-%H%M)
BACKUP=/opt/danteng/backup-$TS
install -d -m 700 "$BACKUP"

# 1. 一致性备份：程序三目录 + 实际 GL 数据 + 环境文件
tar -czf "$BACKUP/server.tgz" -C "$APP_DIR" server
tar -czf "$BACKUP/src.tgz" -C "$APP_DIR" src
tar -czf "$BACKUP/dist.tgz" -C "$APP_DIR" dist
tar -czf "$BACKUP/data.tgz" -C "$APP_DIR" data
cp -a "$ENV" "$BACKUP/danteng.env"
chmod 600 "$BACKUP/danteng.env"
for f in server src dist data; do test -s "$BACKUP/$f.tgz"; done
test -s "$BACKUP/danteng.env"

# 2. 独立源码目录更新
cd /opt/danteng-src
git fetch origin
test -z "$(git status --porcelain)"
git checkout main
git merge --ff-only origin/main
test "$(git rev-parse HEAD)" = "c79ba127cdcf033eb149dbba9d3b6dff2e631e20"

# 3. 安装
sudo APP_DIR=/opt/danteng SERVICE_NAME=danteng PORT=6657 \
  bash deploy/install.sh

# 4. 只做布尔检查，不输出值
sudo test -f "$ENV"
sudo grep -q '^GL_DATA_DIR=' "$ENV"
sudo grep -q '^GL_ADMIN_TOKEN=' "$ENV"
sudo systemctl is-active danteng
```

## 上线验证

1. `GET /health` 正常；
2. 默认 12×12，四预设与自定义 8–18 可用；
3. 8×8 与 18×18 房间同时创建、加入、行动与结算，互不串状态；
4. 非法尺寸 7/19、非整数、数组长度不符、越界动作被拒；
5. 旧 10×12 棋谱导入、复盘正常；
6. 新尺寸棋谱上传、服务端重放、去重、匿名删除；
7. 管理导出 `?cols=12&rows=12` 只返回对应尺寸；
8. 断网时本地保存与复盘不受影响。

## 回退

回退前单独备份新尺寸数据与环境文件，保留新数据。

```bash
set -euo pipefail
cd /opt/danteng-src
git fetch origin
git checkout pre-bs-release-2026-11-27
test "$(git rev-parse HEAD)" = "01a65ca7c2185f96f1fb40e128bf5fec958e1d1d"
sudo APP_DIR=/opt/danteng SERVICE_NAME=danteng PORT=6657 \
  bash deploy/install.sh
sudo systemctl restart danteng
```

旧程序不应重写或误读新尺寸记录；失败时保留新数据并回退到上述完整 SHA 或运维既有版本。

## 安全

- 管理令牌只从 `Authorization: Bearer` 读取，不进前端、Git、日志；
- 不输出 `/etc/danteng.env` 内容；
- 生产开启 HTTPS，限制后端直连；
- 不把用户棋谱或令牌提交 Git。
