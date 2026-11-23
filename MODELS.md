# 模型快照与校验和

本仓库**不包含**模型权重文件（共 36 个 `.zip`，约 182 MB），只保留报告、代码与结果数据。
权重文件位于本地 `_extract/rl2/`，需要外发时按下面的 SHA256 校验。

## 关键快照

| 文件 | 说明 |
|---|---|
| `rl2-1h.zip` | RL2 1 小时快照（后续实验的共同起点） |
| `rl2b-11h.zip` | RL2 12 小时最终快照 |
| `rl21-c0-final.zip` | RL2.1 C0 对照（ent_coef=0，60 分钟） |
| `rl21-e0-30min.zip` | RL2.1 E0 探索臂 30 分钟（E1/C1 的共同起点） |
| `rl21-e0-final.zip` | RL2.1 E0 探索臂 60 分钟 |
| `rl21-c1-final.zip` | E1/C1 对照臂（原对手，30 分钟） |
| `rl21-e1-final.zip` | **实验难度使用的模型**（封墙对手，30 分钟） |

`src/ai-rl-weights.js` 是从 `rl21-e1-final.zip` 导出的 float32 权重（base64），
由 `_extract/export_rl_weights.py` 生成，用于浏览器端实验难度推理。

## 校验和

完整清单见 [`_extract/rl2/SHA256SUMS`](_extract/rl2/SHA256SUMS)（36 个文件，格式：SHA256、文件名、大小）。

示例：

```
274c55af0588aa1272211f1977b2ed1bb4cc9e9a72343fa33cdabffc13dc35f2  rl2-1h.zip        7 MB
790d9733f4738b42b529c90950584db8800fad3cd246003f958447c066bc0fda  rl21-c0-final.zip 7 MB
```

## 外置下载

模型压缩包与网盘链接待项目负责人补充；下载后请用 `SHA256SUMS` 校验。
