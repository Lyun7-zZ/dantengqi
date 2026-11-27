# 多规格棋盘版本部署交接

## 版本

| 项 | 值 |
|---|---|
| main | `ce6163f` |
| 产品代码提交 | `34f47d4` |
| 发布标签 | `release-bs-multisize-2026-11-27` → `ce6163f` |
| 回退标签 | `pre-bs-release-2026-11-27` → `01a65ca` |
| 构建 | `dist/蛋疼棋.html`，约 3.18MB |

## 实际安装参数（与 `deploy/install.sh` 一致）

| 变量 | 默认值 |
|---|---|
| `APP_DIR` | `/opt/danteng` |
| `SERVICE_NAME` | `danteng` |
| systemd unit | `/etc/systemd/system/danteng.service` |
| 环境文件 | `/etc/danteng.env`（600） |
| 服务账号 | `danteng` |
| 端口 | `6657` |
| GL 数据目录 | `/opt/danteng/data/gamelib` |

安装脚本把 `server/`、`src/`、`dist/` 复制到 `APP_DIR`，不会创建工作区。**不要在 `/opt/danteng/src` 里执行 Git 命令**；源码更新在独立仓库目录完成。

## 升级步骤

```bash
set -euo pipefail

# 1. 备份（失败即停止）
TS=$(date +%Y%m%d-%H%M)
BACKUP=/opt/danteng/backup-$TS
install -d -m 700 "$BACKUP"
tar -czf "$BACKUP/data.tgz" -C /opt/danteng data
tar -czf "$BACKUP/app.tgz" -C /opt/danteng app
cp -a /etc/danteng.env "$BACKUP/danteng.env"
chmod 600 "$BACKUP/danteng.env"
test -s "$BACKUP/data.tgz"
test -s "$BACKUP/app.tgz"

# 2. 在独立源码目录更新（不是 APP_DIR）
cd /opt/danteng-src
git fetch origin
git status --porcelain   # 必须为空，否则先人工处理
git checkout main
git merge --ff-only origin/main
test "$(git rev-parse HEAD)" = "<部署提交>"

# 3. 安装
sudo APP_DIR=/opt/danteng SERVICE_NAME=danteng PORT=6657 \
  bash deploy/install.sh

# 4. 仅检查变量存在，不输出值
sudo test -s /etc/danteng.env
sudo systemctl is-active danteng
```

## 上线验证

1. `GET /health` 正常；
2. 新建默认 12×12；四预设与自定义 8–18 可用；
3. 8×8 与 18×18 房间同时创建、加入、行动与结算，互不串状态；
4. 非法尺寸 7/19、非整数、数组长度不符、越界动作被拒；
5. 旧 10×12 棋谱导入、复盘正常；
6. 新尺寸棋谱上传、服务端重放、去重、匿名删除；
7. 管理导出 `?cols=12&rows=12` 只返回对应尺寸；
8. 断网/服务不可用时本地保存与复盘不受影响。

## 回退

回退前先单独备份新尺寸数据与 `/etc/danteng.env`，保留新数据不覆盖。

```bash
set -euo pipefail
cd /opt/danteng-src
git fetch origin
git checkout pre-bs-release-2026-11-27
test "$(git rev-parse HEAD)" = "01a65ca"
sudo APP_DIR=/opt/danteng SERVICE_NAME=danteng PORT=6657 \
  bash deploy/install.sh
sudo systemctl restart danteng
```

旧程序不应重写或误读新尺寸记录；失败时保留新数据并回退到确认的 `01a65ca` 或运维既有版本。

## 安全

- 管理令牌只从 `Authorization: Bearer` 读取，不进前端、Git、日志；
- 不输出 `/etc/danteng.env` 内容；
- 生产开启 HTTPS，限制后端直连；
- 不把用户棋谱或令牌提交 Git。
