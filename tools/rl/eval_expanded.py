"""扩充评估：固定先后手 + 多种子/开局，统计 W/D/L/T 与动作构成。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from env import DantengEnv

ROOT = Path(__file__).resolve().parents[2]


def run_games(model, opponent: str, side: int, seeds: list[int], per_seed: int, opening: int):
    stats = {"W": 0, "D": 0, "L": 0, "T": 0, "plies": [], "move": 0, "wall": 0, "top": 0,
             "first_wall": 0, "games": 0}
    for seed in seeds:
        env = DantengEnv(seed=seed, opponent=opponent, learner_side=side, opening_plies=opening)
        try:
            for _ in range(per_seed):
                obs, _ = env.reset()
                done = False
                r = 0.0
                term = trunc = False
                first = True
                while not done:
                    mask = env.action_masks()
                    action, _ = model.predict(obs, action_masks=mask, deterministic=True)
                    a = int(action)
                    if a < 4:
                        stats["move"] += 1
                    elif a < 222:
                        stats["wall"] += 1
                    else:
                        stats["top"] += 1
                    if first:
                        stats["first_wall"] += 1 if a >= 4 else 0
                        first = False
                    obs, r, term, trunc, _ = env.step(a)
                    done = term or trunc
                stats["games"] += 1
                stats["plies"].append(env.state["plies"])
                if term:
                    if r > 0:
                        stats["W"] += 1
                    elif r < 0:
                        stats["L"] += 1
                    else:
                        stats["D"] += 1
                else:
                    stats["T"] += 1
        finally:
            env.close()
    stats["mean_plies"] = round(float(np.mean(stats["plies"])), 1) if stats["plies"] else 0
    stats.pop("plies", None)
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--games-per-seed", type=int, default=4)
    ap.add_argument("--seeds", default="0,1,2,3,4,5,6,7,8,9")
    ap.add_argument("--opening", type=int, default=2)
    ap.add_argument("--opponents", default="random,path")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    model = MaskablePPO.load(args.model, device="cpu")
    seeds = [int(x) for x in args.seeds.split(",")]
    result = {}
    for opp in args.opponents.split(","):
        result[opp] = {}
        for side in (0, 1):
            s = run_games(model, opp, side, seeds, args.games_per_seed, args.opening)
            result[opp][side] = s
            total = s["W"] + s["D"] + s["L"] + s["T"]
            acts = s["move"] + s["wall"] + s["top"]
            print(f"{opp:6s} seat{side} W{s['W']:2d} D{s['D']:2d} L{s['L']:2d} T{s['T']:2d} "
                  f"score {(s['W']+0.5*s['D'])/max(total,1):.3f} plies {s['mean_plies']:.1f} "
                  f"move {s['move']/max(acts,1):.2f} wall {s['wall']/max(acts,1):.2f} top {s['top']/max(acts,1):.2f}")
    if args.out:
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
