"""D1：快照两两对弈矩阵（固定先后手、多种子开局）。"""

from __future__ import annotations

import argparse
import json
from itertools import combinations
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from env import DantengEnv

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "_extract" / "rl2" / "diag"
OUT.mkdir(parents=True, exist_ok=True)


def match(a_model, b_model, side: int, seeds, per_seed: int, opening: int):
    res = {"W": 0, "D": 0, "L": 0, "T": 0, "plies": []}
    for seed in seeds:
        env = DantengEnv(seed=seed, opponent="model", opponent_model=b_model,
                         learner_side=side, opening_plies=opening)
        try:
            for _ in range(per_seed):
                obs, _ = env.reset()
                done = False
                r = 0.0
                term = trunc = False
                while not done:
                    mask = env.action_masks()
                    act, _ = a_model.predict(obs, action_masks=mask, deterministic=True)
                    obs, r, term, trunc, _ = env.step(int(act))
                    done = term or trunc
                res["plies"].append(env.state["plies"])
                if term:
                    if r > 0:
                        res["W"] += 1
                    elif r < 0:
                        res["L"] += 1
                    else:
                        res["D"] += 1
                else:
                    res["T"] += 1
        finally:
            env.close()
    res["mean_plies"] = round(float(np.mean(res["plies"])), 1) if res["plies"] else 0
    res.pop("plies", None)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="0,1,2")
    ap.add_argument("--per-seed", type=int, default=2)
    ap.add_argument("--opening", type=int, default=2)
    args = ap.parse_args()
    paths = {
        "0h": ROOT / "_extract/rl2/rl2-0h.zip",
        "1h": ROOT / "_extract/rl2/rl2-1h.zip",
        "3h": ROOT / "_extract/rl2/rl2b-2h.zip",
        "6h": ROOT / "_extract/rl2/rl2b-5h.zip",
        "12h": ROOT / "_extract/rl2/rl2b-11h.zip",
    }
    seeds = [int(x) for x in args.seeds.split(",")]
    models = {k: MaskablePPO.load(str(v), device="cpu") for k, v in paths.items()}
    matrix = {}
    rows = []
    for a, b in combinations(models, 2):
        sa = match(models[a], models[b], 0, seeds, args.per_seed, args.opening)
        sb = match(models[a], models[b], 1, seeds, args.per_seed, args.opening)
        total = {k: sa[k] + sb[k] for k in ("W", "D", "L", "T")}
        n = sum(total.values())
        score = (total["W"] + 0.5 * total["D"]) / max(n, 1)
        matrix[f"{a} vs {b}"] = {"seat0": sa, "seat1": sb, "total": total, "score_a": round(score, 3)}
        rows.append((a, b, total["W"], total["D"], total["L"], total["T"], round(score, 3)))
        rows.append((b, a, total["L"], total["D"], total["W"], total["T"], round(1 - score, 3)))
    print(f"{'A':4s} {'B':4s} {'W':3s} {'D':3s} {'L':3s} {'T':3s} {'score':>6s}")
    for r in rows:
        print(f"{r[0]:4s} {r[1]:4s} {r[2]:3d} {r[3]:3d} {r[4]:3d} {r[5]:3d} {r[6]:6.3f}")
    (OUT / "snapshot-matrix.json").write_text(json.dumps(matrix, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
