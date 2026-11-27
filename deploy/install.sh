#!/usr/bin/env bash
#
# 蛋疼棋联机服务器 · 一键安装 / 升级脚本
#
#   sudo bash deploy/install.sh              # 默认端口 6657
#   sudo PORT=8080 bash deploy/install.sh    # 指定端口
#
# 做的事：
#   1. 识别 apt / dnf / yum 并安装基础依赖
#   2. 安装 Node.js 20（已满足则跳过）
#   3. 把 server/、src/、dist/ 复制到 /opt/danteng
#   4. 安装生产依赖（只有 ws）
#   5. 注册 systemd 服务 danteng，开机自启、崩溃自动重启
#   6. 尝试放行防火墙端口
#
# 可重复执行：升级时重跑一次即可，只替换程序文件，保留服务配置。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/danteng}"
SERVICE_NAME="${SERVICE_NAME:-danteng}"
SERVICE_USER="${SERVICE_USER:-danteng}"
PORT="${PORT:-6657}"
NODE_MAJOR="${NODE_MAJOR:-20}"

log() { printf '\033[36m[danteng]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[danteng]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[danteng] 错误：%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash deploy/install.sh"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -d "$SRC_DIR/server" ] || die "找不到 server/ 目录（请在仓库根目录执行）"
[ -d "$SRC_DIR/dist" ] || die "找不到 dist/ 目录，请先运行 node tools/build-single.mjs"

# ---------- 1. 包管理器 ----------
if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG=yum
else
  die "只支持 apt / dnf / yum 系统"
fi
log "包管理器：$PKG"

install_pkg() {
  case "$PKG" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
  esac
}

if [ "$PKG" = apt ]; then
  apt-get update -y >/dev/null
fi
install_pkg curl ca-certificates >/dev/null

# ---------- 2. Node.js ----------
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge "$NODE_MAJOR" ]
}

if node_ok; then
  log "Node.js 已满足：$(node -v)"
else
  log "安装 Node.js ${NODE_MAJOR}.x ..."
  case "$PKG" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      install_pkg nodejs >/dev/null
      ;;
    dnf|yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      install_pkg nodejs >/dev/null
      ;;
  esac
  node_ok || die "Node.js 安装失败"
  log "Node.js：$(node -v)"
fi
NODE_BIN="$(command -v node)"

# ---------- 3. 服务账号与目录 ----------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
    || useradd --system --no-create-home --shell /sbin/nologin "$SERVICE_USER"
  log "创建服务账号：$SERVICE_USER"
fi

mkdir -p "$APP_DIR/server" "$APP_DIR/src" "$APP_DIR/dist" "$APP_DIR/data/gamelib"
cp -a "$SRC_DIR/server/." "$APP_DIR/server/"
cp -a "$SRC_DIR/src/." "$APP_DIR/src/"
cp -a "$SRC_DIR/dist/." "$APP_DIR/dist/"

# 环境文件：只在不存在时创建，升级不覆盖令牌与数据目录
ENV_FILE="/etc/${SERVICE_NAME}.env"
if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
GL_DATA_DIR=${APP_DIR}/data/gamelib
GL_ADMIN_TOKEN=${TOKEN}
EOF
  chmod 600 "$ENV_FILE"
  log "已创建环境文件 $ENV_FILE（请妥善保存管理令牌）"
else
  log "沿用已有环境文件 $ENV_FILE"
fi
log "已复制程序文件到 $APP_DIR"

# 去掉开发用的测试目录，减小体积
rm -rf "$APP_DIR/server/test" "$APP_DIR/server/testlib"

# ---------- 4. 依赖 ----------
log "安装生产依赖（ws）..."
( cd "$APP_DIR/server" && npm install --omit=dev --no-audit --no-fund >/dev/null )
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
chmod 700 "$APP_DIR/data/gamelib" 2>/dev/null || true

# ---------- 5. systemd ----------
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
cat > "$UNIT" <<EOF
[Unit]
Description=Dantengqi game server
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}/server
ExecStart=${NODE_BIN} ${APP_DIR}/server/index.js --port ${PORT}
Restart=always
RestartSec=3
EnvironmentFile=-${ENV_FILE}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"
sleep 1
systemctl is-active --quiet "$SERVICE_NAME" || {
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager || true
  die "服务启动失败，请查看上面的日志"
}
log "服务已启动：$SERVICE_NAME"

# ---------- 6. 防火墙 ----------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null && log "ufw 放行 ${PORT}/tcp"
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then
  firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null
  firewall-cmd --reload >/dev/null
  log "firewalld 放行 ${PORT}/tcp"
else
  warn "未检测到启用的本机防火墙；如果访问不通，请在云控制台安全组放行 ${PORT}/tcp"
fi

# ---------- 7. 自检 ----------
if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  log "本机健康检查通过"
else
  warn "本机健康检查未通过，请检查 journalctl -u ${SERVICE_NAME}"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

========================================
 蛋疼棋服务器已就绪
 内网地址：http://${IP}:${PORT}/
 公网地址：http://<服务器公网IP>:${PORT}/

 常用命令：
   systemctl status ${SERVICE_NAME}
   journalctl -u ${SERVICE_NAME} -f
   systemctl restart ${SERVICE_NAME}

 升级：拉新代码后重新执行本脚本即可。
========================================
EOF
