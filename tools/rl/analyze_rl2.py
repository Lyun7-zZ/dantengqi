"""RL2 训练日志汇总 + 起点分布/动作构成抽样。"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from env import DantengEnv

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "_extract" / "rl2"


def summary(path: Path):
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not rows:
        return None
    last = rows[-1]
    steps = last["steps"]
    games = last["games"]
    term = last.get("terminal", 0)
    trunc = last.get("truncated", 0)
    w = last.get("wins", 0)
    d = last.get("draws", 0)
    l = last.get("losses", 0)
    return {
        "duration_min": round(last["t"] / 60, 1),
        "steps": steps,
        "games": games,
        "steps_per_game": round(steps / max(games, 1), 2),
        "terminal": term,
        "truncated": trunc,
        "W": w, "D": d, "L": l,
        "terminal_rate": round(term / max(games, 1), 4),
        "trunc_rate": round(trunc / max(games, 1), 4),
        "nonzero_rate": round(last.get("nonzero_reward", 0) / max(games, 1), 4),
    }


def sample_config(model, start_mode, opponent, episodes=40, seed=7):
    env = DantengEnv(seed=seed, opponent=opponent, start_mode=start_mode)
    lengths = []
    acts = Counter()
    w = d = l = t = 0
    try:
        for _ in range(episodes):
            obs, _ = env.reset()
            done = False
            r = 0.0
            term = trunc = False
            while not done:
                mask = env.action_masks()
                if model is None:
                    a = int(np.random.choice(np.flatnonzero(mask)))
                else:
                    a, _ = model.predict(obs, action_masks=mask, deterministic=True)
                    a = int(a)
                if a < 4:
                    acts["move"] += 1
                elif a < 222:
                    acts["wall"] += 1
                else:
                    acts["top"] += 1
                obs, r, term, trunc, _ = env.step(a)
                done = term or trunc
            lengths.append(env.state["plies"])
            if term:
                if r > 0:
                    w += 1
                elif r < 0:
                    l += 1
                else:
                    d += 1
            else:
                t += 1
    finally:
        env.close()
    total_acts = sum(acts.values())
    return {
        "start_mode": start_mode, "opponent": opponent, "episodes": episodes,
        "mean_plies": round(float(np.mean(lengths)), 1),
        "W": w, "D": d, "L": l, "T": t,
        "move_ratio": round(acts["move"] / max(total_acts, 1), 3),
        "wall_ratio": round(acts["wall"] / max(total_acts, 1), 3),
        "top_ratio": round(acts["top"] / max(total_acts, 1), 3),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="")
    args = ap.parse_args()
    for tag, path in (("A", OUT / "rl2.jsonl"), ("B", OUT / "rl2b.jsonl")):
        s = summary(path)
        print(f"course {tag}: {json.dumps(s, ensure_ascii=False)}")
    model = MaskablePPO.load(args.model, device="cpu") if args.model else None
    print("--- 抽样（每配置 40 局）---")
    configs = [("short", "move_bias"), ("normal", "random"),
               ("normal", "path"), ("normal", "move_bias"), ("short_varied", "move_bias")]
    out = []
    for mode, opp in configs:
        r = sample_config(model, mode, opp)
        out.append(r)
        print(json.dumps(r, ensure_ascii=False))
    (OUT / "start-distribution.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
