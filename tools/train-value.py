"""线性价值模型试点：读取自对弈 JSONL，训练逻辑回归并报告离线指标。

用法：python tools/train-value.py _extract/selfplay/all.jsonl

只使用：agent=hell、source=search、非截断对局。
标签：该手行动方的最终结果（胜=1，平/负=0）。
按整局划分训练/验证，避免同局泄漏。
"""

import json
import sys
import math

import numpy as np

FEATURES = [
    "ply", "isFirst", "dMe", "dOpp", "margin", "exits",
    "pathsMe", "pathsOpp", "movesMe", "movesOpp",
    "colDiff", "rowDiff", "wallsPlaced",
    "atRow0Me", "atRow0Opp",
    "gapWorst", "gapBest",
    "overlap", "overlapRatio",
    "bestWallNet", "bestWallCut",
]


def rows_from(path):
    games = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            games.setdefault(r["g"], []).append(r)
    return games


def build(games):
    X, y, gids = [], [], []
    for gid, rows in games.items():
        result = None
        moves = []
        for r in rows:
            if "result" in r:
                result = r["result"]
            else:
                moves.append(r)
        if result in (None, "truncated"):
            continue
        for r in moves:
            if r.get("agent") != "hell" or r.get("source") != "search":
                continue
            side = r["side"]
            won = 1 if result == side else 0
            feat = [float(r[name]) for name in FEATURES]
            X.append(feat)
            y.append(won)
            gids.append(gid)
    return np.array(X, dtype=np.float64), np.array(y, dtype=np.float64), np.array(gids)


def auc(y, p):
    order = np.argsort(p)
    y_sorted = y[order]
    pos = y_sorted.sum()
    neg = len(y_sorted) - pos
    if pos == 0 or neg == 0:
        return float("nan")
    # 平均秩
    ranks = np.empty(len(p), dtype=np.float64)
    i = 0
    while i < len(p):
        j = i
        while j + 1 < len(p) and p[order[j + 1]] == p[order[i]]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2.0 + 1
        i = j + 1
    return (ranks[y == 1].sum() - pos * (pos + 1) / 2.0) / (pos * neg)


def train_logistic(X, y, epochs=3000, lr=0.15, l2=1e-3):
    n, d = X.shape
    w = np.zeros(d)
    b = 0.0
    for _ in range(epochs):
        z = X @ w + b
        p = 1.0 / (1.0 + np.exp(-z))
        grad_w = X.T @ (p - y) / n + l2 * w
        grad_b = float(np.mean(p - y))
        w -= lr * grad_w
        b -= lr * grad_b
    return w, b


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "_extract/selfplay/all.jsonl"
    games = rows_from(path)
    X, y, gids = build(games)
    if len(X) == 0:
        print("没有可用样本")
        return

    uniq = np.unique(gids)
    val_games = set(uniq[::5].tolist())
    val_mask = np.array([g in val_games for g in gids])
    Xtr, ytr = X[~val_mask], y[~val_mask]
    Xva, yva = X[val_mask], y[val_mask]

    mean = Xtr.mean(axis=0)
    std = Xtr.std(axis=0)
    std[std == 0] = 1.0
    Xtr_n = (Xtr - mean) / std
    Xva_n = (Xva - mean) / std

    w, b = train_logistic(Xtr_n, ytr)
    p_tr = 1 / (1 + np.exp(-(Xtr_n @ w + b)))
    p_va = 1 / (1 + np.exp(-(Xva_n @ w + b)))

    print(f"样本 {len(X)} 手，{len(uniq)} 局；训练 {len(Xtr)}，验证 {len(Xva)}")
    print(f"胜率：训练 {ytr.mean():.2f}，验证 {yva.mean():.2f}")
    print(f"AUC：训练 {auc(ytr, p_tr):.3f}，验证 {auc(yva, p_va):.3f}")
    acc = float(((p_va > 0.5) == (yva > 0.5)).mean())
    base = float(max(yva.mean(), 1 - yva.mean()))
    print(f"验证准确率 {acc:.3f}（多数类基线 {base:.3f}）")

    # 基线：单特征直接排序
    mi = FEATURES.index("margin")
    print(f"AUC 基线 margin：{auc(yva, Xva[:, mi]):.3f}")
    di = FEATURES.index("dMe")
    print(f"AUC 基线 -dMe：{auc(yva, -Xva[:, di]):.3f}")
    print(f"AUC 基线 -dOpp：{auc(yva, Xva[:, FEATURES.index('dOpp')]):.3f}")

    print("\n特征权重（标准化后）：")
    for name, wt in sorted(zip(FEATURES, w), key=lambda x: -abs(x[1]))[:10]:
        print(f"  {name:16s} {wt:+.3f}")

    model = {
        "features": FEATURES,
        "mean": mean.tolist(),
        "std": std.tolist(),
        "weights": w.tolist(),
        "bias": b,
        "auc_val": float(auc(yva, p_va)),
    }
    out = path.replace(".jsonl", "-model.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, indent=1)
    print(f"\n模型已保存：{out}")


if __name__ == "__main__":
    main()
