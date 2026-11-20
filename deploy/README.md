# 服务器部署

蛋疼棋的在线版只需要一台能跑 Node 的 Linux 服务器：**一个进程、一个端口**，
同时提供页面和 WebSocket（`/ws`），不需要 Nginx 反向代理。

## 前置条件

| 项 | 要求 |
|---|---|
| 系统 | Ubuntu / Debian / CentOS / Rocky / Alma（脚本自动识别 apt / dnf / yum） |
| 权限 | root（或 sudo） |
| 网络 | 云控制台安全组放行 `6657/tcp`（或自选端口） |
| 内存 | 512 MB 起 |
| 外网 | 安装脚本需要联网装 Node.js 20 与 `ws` |

## 部署（三步）

**1. 把项目放到服务器**

```bash
# 推荐：直接克隆（仓库里已含打包好的 dist/，不需要在服务器上构建）
git clone <仓库地址> dantengqi && cd dantengqi

# 或者：本地打包上传
tar czf dantengqi.tgz server src dist deploy
scp dantengqi.tgz root@<服务器IP>:/root/
```

**2. 执行安装脚本**

```bash
sudo bash deploy/install.sh
# 换端口
sudo PORT=8080 bash deploy/install.sh
```

脚本会：安装 Node 20（已满足则跳过）→ 复制到 `/opt/danteng` → 装依赖（只有 `ws`）→
注册 systemd 服务 `danteng`（开机自启、崩溃重启）→ 尝试放行本机防火墙 → 自检。

看到 `蛋疼棋服务器已就绪` 即成功。脚本**可重复执行**，升级时重跑即可。

**3. 打开页面**

```
http://<服务器公网IP>:6657/                回合制（默认）
http://<服务器公网IP>:6657/?play=async     同时行动模式
```

两种模式都同时支持「联机 / 同屏 / 人机」，联机在页面里点「联机对战」建房或加入。

## 验证

```bash
curl http://127.0.0.1:6657/health      # {"ok":true}
curl -I http://127.0.0.1:6657/         # 200，返回页面
```

然后用两个浏览器窗口：一个「创建房间」拿 6 位房间码，另一个「加入房间」。

## 常用运维

```bash
systemctl status danteng        # 状态
journalctl -u danteng -f        # 实时日志
systemctl restart danteng       # 重启
systemctl stop danteng          # 停止
```

改动端口、服务名、安装目录：

```bash
sudo PORT=8080 SERVICE_NAME=danteng APP_DIR=/opt/danteng bash deploy/install.sh
```

## 升级

```bash
git pull
sudo bash deploy/install.sh
```

如果改了客户端源码，需要先重新打包（服务器上要装 Node 才能构建，或在本地构建后提交）：

```bash
node tools/build-single.mjs
sudo bash deploy/install.sh
```

## 卸载

```bash
sudo systemctl disable --now danteng
sudo rm -f /etc/systemd/system/danteng.service
sudo systemctl daemon-reload
sudo rm -rf /opt/danteng
sudo userdel danteng 2>/dev/null || true
```

## 故障排查

| 现象 | 排查 |
|---|---|
| 打不开页面 | 安全组/防火墙是否放行端口；`curl 127.0.0.1:6657/health` 本机是否通 |
| 页面能开、建房失败 | 浏览器控制台看 WebSocket（`/ws`）是否连上；`journalctl -u danteng` 有无报错 |
| 服务起不来 | `journalctl -u danteng -n 50`；多半是 Node 版本过低或端口被占 |
| 端口被占 | `ss -lntp | grep 6657`，换 `PORT` 重装 |
| 联机提示版本不一致 | 双方刷新页面；客户端与服务器版本不同（`PROTOCOL_VERSION` / `RULES_VERSION`） |
| 连接频繁断开 | 检查云厂商是否对长连接有超时策略 |

## 端口与安全

- 默认监听 `0.0.0.0:6657`，明文 WebSocket，适合朋友间使用；
- 有域名时可加 Caddy/Nginx 反代上 HTTPS，客户端会按同源自动用 `wss://`；
- 房间与对局**只存内存**，重启服务会丢失进行中的对局（暂停中的房间保留 12 小时）。

## 装了什么

```
/opt/danteng/
  server/     服务端代码（index.js / rooms.js / game.js / async-game.js / protocol.js / static.js）
  src/        规则引擎（服务端与客户端共用同一份）
  dist/       打包好的页面（静态托管）
systemd: /etc/systemd/system/danteng.service
```
