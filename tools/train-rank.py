"""Stage 2：成对排序模型（教师根候选分数）。

用法：python tools/train-rank.py _extract/labels.jsonl
"""

import json
import sys
from collections import defaultdict

import numpy as np

FEATURES = [
    "dMe", "dOpp", "margin", "exits", "pathsMe", "pathsOpp",
    "movesMe", "movesOpp", "wallsPlaced",
    "gainMe", "gainOpp", "net", "cut",
    "gapWorst", "gapBest", "gapMean", "dGapWorst", "dGapBest",
    "overlapRatio", "dOverlap", "isMove", "isTop", "isWall",
]


def load(path):
    positions = defaultdict(list)
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        positions[r["gid"]].append(r)
    return positions


GAP = 20

def build(positions):
    pairs = []          # (gid, diff_features)
    labels = []
    for gid, ps in positions.items():
        for p in ps:
            items = p["items"]
            for i in range(len(items)):
                for j in range(len(items)):
                    if i == j:
                        continue
                    gap = items[i]["score"] - items[j]["score"]
                    if gap < GAP:
                        continue
                    fi = np.array([items[i]["f"][k] for k in FEATURES], dtype=float)
                    fj = np.array([items[j]["f"][k] for k in FEATURES], dtype=float)
                    pairs.append((gid, fi - fj, p["ply"]))
                    labels.append(1)
                    pairs.append((gid, fj - fi, p["ply"]))
                    labels.append(0)
    return pairs, np.array(labels)


def train_logistic(X, y, epochs=2000, lr=0.2, l2=1e-3):
    n, d = X.shape
    w = np.zeros(d)
    b = 0.0
    for _ in range(epochs):
        z = X @ w + b
        p = 1.0 / (1.0 + np.exp(-z))
        w -= lr * (X.T @ (p - y) / n + l2 * w)
        b -= lr * float(np.mean(p - y))
    return w, b


def topk_recall(positions, w, b, mean, std, k):
    hits = 0
    total = 0
    for gid, ps in positions.items():
        for p in ps:
            items = p["items"]
            if len(items) < 2:
                continue
            raw = [(np.array([it["f"][f] for f in FEATURES], dtype=float) - mean) / std for it in items]
            scores = [float(w @ x + b) for x in raw]
            best = max(range(len(items)), key=lambda i: items[i]["score"])
            order = sorted(range(len(items)), key=lambda i: -scores[i])
            if best in order[:k]:
                hits += 1
            total += 1
    return hits / max(1, total), total


def baseline_topk(positions, key, k):
    hits = 0
    total = 0
    for gid, ps in positions.items():
        for p in ps:
            items = p["items"]
            if len(items) < 2:
                continue
            best = max(range(len(items)), key=lambda i: items[i]["score"])
            order = sorted(range(len(items)), key=lambda i: -items[i]["f"][key])
            if best in order[:k]:
                hits += 1
            total += 1
    return hits / max(1, total), total


def main():
    global GAP
    path = sys.argv[1] if len(sys.argv) > 1 else "_extract/labels.jsonl"
    GAP = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    positions = load(path)
    gids = sorted(positions)
    val_gids = set(gids[::5])
    train_pos = {g: positions[g] for g in gids if g not in val_gids}
    val_pos = {g: positions[g] for g in gids if g in val_gids}

    pairs, labels = build(train_pos)
    if not pairs:
        print("没有足够的成对样本")
        return
    gids_pairs = [g for g, _, _ in pairs]
    X = np.array([d for _, d, _ in pairs])
    y = np.array(labels, dtype=float)
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std == 0] = 1.0
    Xn = (X - mean) / std
    w, b = train_logistic(Xn, y)

    # 成对准确率（验证集）
    val_pairs, _ = build(val_pos)
    if val_pairs:
        Xv = (np.array([d for _, d, _ in val_pairs]) - mean) / std
        pv = 1 / (1 + np.exp(-(Xv @ w + b)))
        acc = float((pv > 0.5).mean())
    else:
        acc = float("nan")

    print(f"局面 {len(positions)}（训练 {len(train_pos)}，验证 {len(val_pos)}）")
    ptr = 1 / (1 + np.exp(-(Xn @ w + b)))
    acc_tr = float(((ptr > 0.5) == (y > 0.5)).mean())
    print(f"成对样本 {len(X)}；训练成对准确率 {acc_tr:.3f}，验证 {acc:.3f}（gap≥{GAP}）")
    for k in (1, 3, 5):
        r, n = topk_recall(val_pos, w, b, mean, std, k)
        print(f"Top-{k} 召回：{r:.3f}（{n} 个局面）")
    print("\n基线（按 net 排序）：")
    for k in (1, 3, 5):
        r, n = baseline_topk(val_pos, "net", k)
        print(f"  Top-{k}：{r:.3f}")

    print("\n权重：")
    for name, wt in sorted(zip(FEATURES, w), key=lambda x: -abs(x[1])):
        print(f"  {name:12s} {wt:+.3f}")


if __name__ == "__main__":
    main()
