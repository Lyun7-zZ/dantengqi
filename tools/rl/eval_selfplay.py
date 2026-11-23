"""12h 模型对历史快照的直接对弈（固定先后手、多种子开局）。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from env import DantengEnv


def match(model, opp_model, side: int, seeds: list[int], per_seed: int, opening: int):
    st = {"W": 0, "D": 0, "L": 0, "T": 0, "plies": []}
    for seed in seeds:
        env = DantengEnv(seed=seed, opponent="model", opponent_model=opp_model,
                         learner_side=side, opening_plies=opening)
        try:
            for _ in range(per_seed):
                obs, _ = env.reset()
                done = False
                r = 0.0
                term = trunc = False
                while not done:
                    mask = env.action_masks()
                    a, _ = model.predict(obs, action_masks=mask, deterministic=True)
                    obs, r, term, trunc, _ = env.step(int(a))
                    done = term or trunc
                st["plies"].append(env.state["plies"])
                if term:
                    if r > 0:
                        st["W"] += 1
                    elif r < 0:
                        st["L"] += 1
                    else:
                        st["D"] += 1
                else:
                    st["T"] += 1
        finally:
            env.close()
    st["mean_plies"] = round(float(np.mean(st["plies"])), 1) if st["plies"] else 0
    st.pop("plies", None)
    return st


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--opponents", required=True)
    ap.add_argument("--seeds", default="0,1,2,3,4")
    ap.add_argument("--per-seed", type=int, default=4)
    ap.add_argument("--opening", type=int, default=2)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    model = MaskablePPO.load(args.model, device="cpu")
    seeds = [int(x) for x in args.seeds.split(",")]
    result = {}
    for opp_path in args.opponents.split(","):
        name = Path(opp_path).stem
        opp = MaskablePPO.load(opp_path, device="cpu")
        result[name] = {}
        for side in (0, 1):
            s = match(model, opp, side, seeds, args.per_seed, args.opening)
            result[name][side] = s
            total = s["W"] + s["D"] + s["L"] + s["T"]
            print(f"vs {name:12s} seat{side} W{s['W']:2d} D{s['D']:2d} L{s['L']:2d} T{s['T']:2d} "
                  f"score {(s['W']+0.5*s['D'])/max(total,1):.3f} plies {s['mean_plies']:.1f}")
    if args.out:
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
