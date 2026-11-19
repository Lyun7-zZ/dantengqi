# 服务器部署

蛋疼棋联机需要一台能跑 Node 的 Linux 服务器。一个进程、一个端口，同时提供页面和 WebSocket。

## 前置条件

| 项 | 要求 |
|---|---|
| 系统 | Ubuntu / Debian / CentOS / Rocky / Alma（脚本自动识别 apt / dnf / yum） |
| 权限 | root（或 sudo） |
| 网络 | 云控制台安全组放行 `6657/tcp`（或你自选的端口） |
| 内存 | 512 MB 起，2 GB 很宽裕 |

## 部署（三步）

**1. 在本地打包页面**

```bash
node tools/build-single.mjs
```

产物：`dist/蛋疼棋.html`（单文件，含客户端全部代码）。

**2. 把整个项目传到服务器**

任选其一：

```bash
# 方式 A：git
git clone <仓库地址> dantengqi && cd dantengqi && git checkout server

# 方式 B：本地打包上传
tar czf dantengqi.tgz server src dist deploy
scp dantengqi.tgz root@<服务器IP>:/root/
```

**3. 在服务器上执行安装脚本**

```bash
sudo bash deploy/install.sh
# 或指定端口
sudo PORT=8080 bash deploy/install.sh
```

脚本会：安装 Node 20 → 复制到 `/opt/danteng` → 装依赖（只有 `ws`）→ 注册 systemd 服务 → 放行防火墙 → 自检。

看到 `蛋疼棋服务器已就绪` 即成功。

## 验证

```bash
curl http://127.0.0.1:6657/health     # {"ok":true}
```

浏览器打开 `http://<服务器公网IP>:6657/`，两个窗口分别「创建房间」「加入房间」即可对局。

## 常用运维

```bash
systemctl status danteng      # 状态
journalctl -u danteng -f      # 实时日志
systemctl restart danteng     # 重启
systemctl stop danteng        # 停止
```

## 升级

拉新代码、重新打包，再执行一次安装脚本即可（幂等，只替换程序文件并重启服务）：

```bash
git pull && node tools/build-single.mjs
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
| 页面能开、建房失败 | 浏览器控制台看 WebSocket 是否连上；`journalctl -u danteng` 有无报错 |
| 服务起不来 | `journalctl -u danteng -n 50`；多半是 Node 版本过低或端口被占 |
| 端口被占 | `ss -lntp | grep 6657`，改 `PORT` 重装 |
| 连接频繁断开 | 检查云厂商是否对长连接有超时策略 |

## 端口与安全

- 服务默认监听 `0.0.0.0:6657`，无 TLS（明文 WebSocket），适合朋友间使用；
- 将来有域名可以加 Caddy/Nginx 反代上 HTTPS/wss，客户端会自动用 `wss://`（同源判断已内置）；
- 房间与对局**只存内存**，服务重启会丢失进行中的对局。

## 服务端代码位置

```
server/            服务端（index.js / game.js / rooms.js / protocol.js / static.js）
src/               规则引擎（服务端直接 import，与客户端同一份）
dist/              打包后的页面（服务端静态托管）
deploy/install.sh  一键安装脚本
```
