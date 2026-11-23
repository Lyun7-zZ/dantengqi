"""策略统计：封墙概率质量、熵、危险局面下的封墙倾向。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO

from env import DantengEnv

ROOT = Path(__file__).resolve().parents[2]


def stats(model, states):
    wall, ent, acts = [], [], []
    for obs, mask in states:
        obs_t, _ = model.policy.obs_to_tensor(obs)
        mask_t = torch.as_tensor(mask, dtype=torch.bool).unsqueeze(0)
        dist = model.policy.get_distribution(obs_t, action_masks=mask_t)
        p = dist.distribution.probs.detach().cpu().numpy()[0]
        wall.append(float(p[4:].sum()))
        ent.append(float(-(p * np.log(np.clip(p, 1e-12, 1))).sum()))
        acts.append(int(np.argmax(p)))
    return {
        "n": len(states),
        "wall_mass": round(float(np.mean(wall)), 4),
        "entropy": round(float(np.mean(ent)), 3),
        "move_ratio": round(float(np.mean([a < 4 for a in acts])), 3),
        "top_ratio": round(float(np.mean([a >= 222 for a in acts])), 3),
    }


def sample(env, n_random=200, n_danger=50, seed=0):
    rng = np.random.default_rng(seed)
    random_states, danger_states = [], []
    for _ in range(n_random):
        obs, _ = env.reset()
        random_states.append((obs, env.action_masks()))
    for _ in range(n_danger):
        env.reset()
        st = env.state
        opp = 1 - env.learner
        st["players"][opp] = {"c": int(rng.integers(0, 10)), "r": 1}
        st["players"][env.learner] = {"c": int(rng.integers(0, 10)), "r": int(rng.integers(6, 10))}
        st["turn"] = env.learner
        st["winner"] = None
        st["plies"] = 20
        danger_states.append((env._obs(), env.action_masks()))
    return random_states, danger_states


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    model = MaskablePPO.load(args.model, device="cpu")
    env = DantengEnv(seed=0, opponent="random")
    try:
        rs, ds = sample(env)
    finally:
        env.close()
    res = {"model": args.model, "random": stats(model, rs), "danger": stats(model, ds)}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if args.out:
        Path(args.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
