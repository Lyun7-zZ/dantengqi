# 多规格棋盘版本部署交接

## 版本

| 项 | 值 |
|---|---|
| main | `34f47d4` |
| 发布标签 | `release-bs-multisize-2026-11-27` → `34f47d4` |
| 回退标签 | `pre-bs-release-2026-11-27` → `01a65ca` |
| 分支 | `bs-core`（检查点 `d3cb64c`） |
| 构建产物 | `dist/蛋疼棋.html`，约 3.18MB |

## 变更

- 新建对局默认 **12×12**；
- 预设 8×8、10×12 经典、12×12、18×18；自定义列/行 8–18 整数；
- 规则、寻路、AI、异步规则、联机房间、GL4 均携带 `cols/rows`；
- 旧 10×12 棋谱继续按 10×12 重放，不填充、不重标；
- GL4 上传记录保存尺寸，管理导出支持 `?cols=&rows=` 过滤；
- 管理令牌仍只从 `Authorization: Bearer` 读取。

## 部署步骤

```bash
# 1. 备份
sudo systemctl stop dantengqi 2>/dev/null || true
sudo tar -czf /opt/danteng/backup-$(date +%Y%m%d-%H%M).tgz \
  /opt/danteng/app /opt/danteng/data 2>/dev/null || true

# 2. 更新代码
cd /opt/danteng/src && git fetch origin
git checkout main
git reset --hard 34f47d4

# 3. 安装
sudo bash deploy/install.sh

# 4. 确认环境文件未被覆盖
sudo grep -E 'GL_DATA_DIR|GL_ADMIN_TOKEN' /etc/dantengqi.env
```

`deploy/install.sh` 首次创建 `/etc/dantengqi.env`（600），升级不会覆盖；systemd 通过 `EnvironmentFile` 读取。

## 上线验证

1. `GET /health` 正常；
2. 新建对局默认 12×12，四预设与自定义可用；
3. 8×8 与 18×18 房间可同时创建，互不串状态；
4. 非法尺寸 7/19、非整数、数组长度不符被拒；
5. 旧 10×12 棋谱可导入、复盘；
6. GL4 上传 12×12 棋谱，服务端重放通过；
7. 管理导出 `?cols=12&rows=12` 只返回对应尺寸；
8. 删除令牌正确/错误行为符合预期；
9. 断网时本地保存/复盘正常。

## 回退

```bash
sudo systemctl stop dantengqi
cd /opt/danteng/src
git checkout pre-bs-release-2026-11-27
sudo bash deploy/install.sh
sudo systemctl start dantengqi
```

回退前备份 `/opt/danteng/data`；新版本写入的 `cols/rows` 字段不影响旧版本读取旧 10×12 数据，但不要用旧版本重写新尺寸棋谱。

## 注意

- 本文件不表示已部署；服务器由团队负责人操作；
- 不把用户棋谱、管理令牌写入 Git；
- 生产开启 HTTPS 后限制后端直连；
- 大棋盘 18×18 的 AI 决策更慢，保持原有预算，不额外加时。
