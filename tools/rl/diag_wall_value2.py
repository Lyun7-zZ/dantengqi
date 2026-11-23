"""D1-R：用重放恢复的完整状态重算封墙选择质量。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO

from env import DantengEnv

ROOT = Path(__file__).resolve().parents[2]
POS = ROOT / "_extract/rl2/diag/d1r-positions.jsonl"
MOVES = ["up", "down", "left", "right"]


def encode(a):
    if a["type"] == "move":
        return MOVES.index(a["dir"])
    if a["kind"] == "v":
        return 4 + a["c"] * 12 + a["r"]
    if a["kind"] == "h":
        return 112 + a["c"] * 11 + a["r"]
    return 222 + a["c"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    rows = [json.loads(l) for l in POS.read_text(encoding="utf-8").splitlines() if l.strip()]
    print(f"D1-R 局面 {len(rows)}；教师最佳墙合法 {sum(1 for r in rows if r['teacherLegal'])}")
    models = {}
    for part in args.models.split(","):
        name, path = part.split("=")
        models[name] = MaskablePPO.load(path, device="cpu")

    env = DantengEnv(seed=0, opponent="random")
    res = {}
    try:
        for name, model in models.items():
            wall_mass, p_best, rank, greedy_wall, match, topk = [], [], [], [], [], {1: 0, 3: 0, 5: 0}
            in_mask_bad = 0
            for row in rows:
                st = row["state"]
                env.state = st
                env.learner = st["turn"]
                obs = env._obs()
                mask = env.action_masks()
                bi = encode(row["teacher"])
                if not mask[bi]:
                    in_mask_bad += 1
                obs_t, _ = model.policy.obs_to_tensor(obs)
                mask_t = torch.as_tensor(mask, dtype=torch.bool).unsqueeze(0)
                dist = model.policy.get_distribution(obs_t, action_masks=mask_t)
                probs = dist.distribution.probs.detach().cpu().numpy()[0]
                wall_mass.append(float(probs[4:].sum()))
                p_best.append(float(probs[bi]))
                order = np.argsort(-probs)
                rk = int(np.where(order == bi)[0][0]) + 1
                rank.append(rk)
                g = int(order[0])
                greedy_wall.append(1 if g >= 4 else 0)
                match.append(1 if g == bi else 0)
                for k in (1, 3, 5):
                    if rk <= k:
                        topk[k] += 1
            n = len(rows)
            res[name] = {
                "n": n,
                "teacher_in_mask_bad": in_mask_bad,
                "wall_mass": round(float(np.mean(wall_mass)), 4),
                "p_teacher_wall": round(float(np.mean(p_best)), 5),
                "mean_rank": round(float(np.mean(rank)), 2),
                "top1": round(topk[1] / n, 3),
                "top3": round(topk[3] / n, 3),
                "top5": round(topk[5] / n, 3),
                "greedy_wall_rate": round(float(np.mean(greedy_wall)), 3),
                "greedy_matches_teacher": round(float(np.mean(match)), 3),
            }
            print(name, json.dumps(res[name], ensure_ascii=False))
    finally:
        env.close()
    if args.out:
        Path(args.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
