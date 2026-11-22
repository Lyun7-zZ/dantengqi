"""RL2 准入联合验证：自然终局与奖励信号可获得性。"""

import numpy as np

from env import DantengEnv


def play(games: int, opponent: str, start_mode: str, learner_policy: str, seed: int = 0):
    env = DantengEnv(seed=seed, opponent=opponent, start_mode=start_mode)
    rng = np.random.default_rng(seed)
    stats = {"W": 0, "D": 0, "L": 0, "T": 0, "steps": [], "nonzero": 0}
    try:
        for _ in range(games):
            env.reset()
            done = False
            n = 0
            r = 0.0
            term = trunc = False
            while not done:
                mask = env.action_masks()
                legal = np.flatnonzero(mask)
                if learner_policy == "move" and bool(mask[:4].any()):
                    a = int(rng.choice(np.flatnonzero(mask[:4])))
                else:
                    a = int(rng.choice(legal))
                _, r, term, trunc, _ = env.step(a)
                n += 1
                done = term or trunc
            stats["steps"].append(n)
            if term:
                if r > 0:
                    stats["W"] += 1
                elif r < 0:
                    stats["L"] += 1
                else:
                    stats["D"] += 1
            else:
                stats["T"] += 1
            if term and r != 0:
                stats["nonzero"] += 1
    finally:
        env.close()
    stats["games"] = games
    stats["mean_steps"] = round(float(np.mean(stats["steps"])), 1)
    return stats


def main():
    configs = [
        ("随机对手 / 正常起点 / 随机学习方", "random", "normal", "random"),
        ("随机对手 / 正常起点 / 只走子", "random", "normal", "move"),
        ("走子偏置对手 / 正常起点 / 随机学习方", "move_bias", "normal", "random"),
        ("走子偏置对手 / 正常起点 / 只走子", "move_bias", "normal", "move"),
        ("走子偏置对手 / 短残局 / 随机学习方", "move_bias", "short", "random"),
        ("走子偏置对手 / 短残局 / 只走子", "move_bias", "short", "move"),
    ]
    print(f"{'配置':<40} {'W':>3} {'D':>3} {'L':>3} {'T':>3} {'均步':>6} {'非零奖励':>6}")
    for name, opp, mode, pol in configs:
        s = play(30, opp, mode, pol)
        print(f"{name:<40} {s['W']:>3} {s['D']:>3} {s['L']:>3} {s['T']:>3} "
              f"{s['mean_steps']:>6} {s['nonzero']:>6}")


if __name__ == "__main__":
    main()
