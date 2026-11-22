"""Stage 0 审计：截断局、特征共线、标签分布。

用法：python tools/audit-stage0.py _extract/sp2/all.jsonl
输出：_extract/stage0-audit.md
"""

import json
import sys
from collections import Counter, defaultdict

import numpy as np

FEATURES = [
    "ply", "isFirst", "dMe", "dOpp", "margin", "exits", "nearMe", "nearOpp",
    "pathsMe", "pathsOpp", "movesMe", "movesOpp", "colDiff", "rowDiff",
    "wallsPlaced", "wallDensity", "atRow0Me", "atRow0Opp",
    "exitCount", "gapWorst", "gapBest", "gapMean",
    "pathLenMe", "pathLenOpp", "overlap", "overlapRatio",
    "bestWallNet", "bestWallCut",
]


def load(path):
    games = defaultdict(list)
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            games[r["g"]].append(r)
    return games


def split(games):
    results, truncated = {}, {}
    for gid, rows in games.items():
        res = None
        moves = []
        for r in rows:
            if "result" in r:
                res = r["result"]
            else:
                moves.append(r)
        if res == "truncated":
            truncated[gid] = moves
        else:
            results[gid] = (res, moves)
    return results, truncated


def action_mix(moves):
    c = Counter()
    for r in moves:
        a = r.get("action") or {}
        if a.get("type") == "move":
            c["move:" + a.get("dir", "?")] += 1
        else:
            c["wall:" + a.get("kind", "?")] += 1
    return c


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "_extract/sp2/all.jsonl"
    games = load(path)
    results, truncated = split(games)
    out = []
    out.append("# Stage 0 审计\n")
    out.append(f"数据：{path}\n")
    out.append(f"- 总对局：{len(games)}")
    out.append(f"- 正常结束：{len(results)}")
    out.append(f"- 截断（240 手上限）：{len(truncated)}\n")

    # ---- 1. 标签分布 ----
    out.append("## 1. 对局结果分布\n")
    by = Counter()
    for gid, (res, moves) in results.items():
        vs_gm = any(r.get("agent") == "gm" for r in moves)
        tag = "自对弈" if not vs_gm else "对宗师"
        by[(tag, res)] += 1
    out.append("| 类型 | 玩家0胜 | 玩家1胜 | 平局 |")
    out.append("|---|---|---|---|")
    for tag in ["自对弈", "对宗师"]:
        out.append(f"| {tag} | {by[(tag, 0)]} | {by[(tag, 1)]} | {by[(tag, 'draw')]} |")
    out.append("")

    # ---- 2. 截断局分析 ----
    out.append("## 2. 截断局分析\n")
    out.append("| 局 | 手数 | 重复局面 | 终局距离 | 出口 | 墙数 | 最后40手行动 |")
    out.append("|---|---|---|---|---|---|---|")
    for gid, moves in sorted(truncated.items()):
        if not moves:
            continue
        last = moves[-1]
        hashes = [r.get("hash") for r in moves if r.get("hash")]
        dup = len(hashes) - len(set(hashes))
        mix = action_mix(moves[-40:])
        mix_s = ", ".join(f"{k}×{v}" for k, v in mix.most_common(4))
        out.append(
            f"| {gid} | {len(moves)} | {dup} | {last.get('dMe')}:{last.get('dOpp')} | "
            f"{last.get('exits')} | {last.get('wallsPlaced')} | {mix_s} |"
        )
    out.append("")

    # ---- 3. 特征共线 ----
    X = []
    for gid, (res, moves) in results.items():
        for r in moves:
            X.append([float(r[f]) for f in FEATURES])
    X = np.array(X)
    out.append("## 3. 特征共线\n")
    out.append(f"样本 {len(X)} 行，特征 {len(FEATURES)} 个。")
    std = X.std(axis=0)
    dead = [FEATURES[i] for i in range(len(FEATURES)) if std[i] == 0]
    out.append(f"- 零方差特征：{dead if dead else '无'}")
    corr = np.corrcoef(X, rowvar=False)
    pairs = []
    for i in range(len(FEATURES)):
        for j in range(i + 1, len(FEATURES)):
            if abs(corr[i, j]) >= 0.9:
                pairs.append((FEATURES[i], FEATURES[j], corr[i, j]))
    out.append(f"- |相关系数| ≥ 0.9 的特征对：{len(pairs)} 组")
    for a, b, c in pairs:
        out.append(f"  - {a} ↔ {b}：{c:+.3f}")
    # 条件数
    Z = (X - X.mean(axis=0)) / np.where(std == 0, 1, std)
    s = np.linalg.svd(Z, compute_uv=False)
    out.append(f"- 标准化矩阵条件数：{s[0] / max(s[-1], 1e-9):.1f}")
    out.append("")

    # ---- 4. 标签与阶段 ----
    out.append("## 4. 标签随阶段分布\n")
    out.append("| 阶段 | 样本 | 胜标签 | 平/负标签 |")
    out.append("|---|---|---|---|")
    buckets = [("开局 ply<30", lambda p: p < 30), ("中局 30-59", lambda p: 30 <= p < 60), ("后段 60+", lambda p: p >= 60)]
    for name, f in buckets:
        n = w = 0
        for gid, (res, moves) in results.items():
            for r in moves:
                if r.get("agent") != "hell" or r.get("source") != "search":
                    continue
                if not f(r["ply"]):
                    continue
                n += 1
                if res == r["side"]:
                    w += 1
        out.append(f"| {name} | {n} | {w} | {n - w} |")
    out.append("")

    # ---- 5. 开局多样性 ----
    out.append("## 5. 开局多样性\n")
    first_moves = Counter()
    for gid, (res, moves) in results.items():
        if moves:
            a = moves[0].get("action") or {}
            first_moves[json.dumps(a, sort_keys=True)] += 1
    out.append(f"- 不同首手：{len(first_moves)} 种，共 {sum(first_moves.values())} 局")
    out.append(f"- 最常见首手：{first_moves.most_common(3)}")
    out.append("")

    text = "\n".join(out)
    with open("_extract/stage0-audit.md", "w", encoding="utf-8") as f:
        f.write(text)
    print(text)


if __name__ == "__main__":
    main()
