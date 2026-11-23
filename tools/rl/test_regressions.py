"""回归测试：评估开局对称性、同模型自对弈、快照行为一致性。"""

import unittest
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from env import DantengEnv

ROOT = Path(__file__).resolve().parents[2]
SNAP = {
    "1h": ROOT / "_extract/rl2/rl2-1h.zip",
    "3h": ROOT / "_extract/rl2/rl2b-2h.zip",
    "6h": ROOT / "_extract/rl2/rl2b-5h.zip",
    "12h": ROOT / "_extract/rl2/rl2b-11h.zip",
}


class BombModel:
    """一旦在开局阶段被调用就失败。"""

    def predict(self, *args, **kwargs):
        raise AssertionError("opponent model must not be used during opening")


class TestRegressions(unittest.TestCase):
    def test_opening_independent_of_opponent(self):
        a = DantengEnv(seed=11, opponent="path", learner_side=0, opening_plies=4)
        b = DantengEnv(seed=11, opponent="random", learner_side=0, opening_plies=4)
        self.addCleanup(a.close)
        self.addCleanup(b.close)
        a.reset()
        b.reset()
        self.assertEqual(a.state["players"], b.state["players"])
        self.assertEqual(a.state["turn"], b.state["turn"])
        self.assertEqual(a.state["plies"], 4)

    def test_opening_does_not_call_opponent_model(self):
        env = DantengEnv(seed=12, opponent="model", opponent_model=BombModel(),
                         learner_side=0, opening_plies=4)
        self.addCleanup(env.close)
        env.reset()  # 开局 4 手后轮到学习方，不得调用对手模型

    def test_selfplay_same_model_not_lopsided(self):
        if not SNAP["12h"].exists():
            self.skipTest("snapshot missing")
        model = MaskablePPO.load(str(SNAP["12h"]), device="cpu")
        score = 0.0
        games = 0
        for seed in (0, 1, 2):
            env = DantengEnv(seed=seed, opponent="model", opponent_model=model,
                             learner_side=0, opening_plies=2)
            try:
                for _ in range(2):
                    obs, _ = env.reset()
                    done = False
                    r = 0.0
                    term = trunc = False
                    while not done:
                        mask = env.action_masks()
                        a, _ = model.predict(obs, action_masks=mask, deterministic=True)
                        obs, r, term, trunc, _ = env.step(int(a))
                        done = term or trunc
                    games += 1
                    if term and r > 0:
                        score += 1
                    elif not term or r == 0:
                        score += 0.5
            finally:
                env.close()
        self.assertGreaterEqual(score / games, 0.30, f"同模型自对弈一边倒：{score}/{games}")

    def test_snapshots_distinct_but_same_greedy_action(self):
        paths = [p for p in SNAP.values() if p.exists()]
        if len(paths) < 2:
            self.skipTest("snapshots missing")
        models = [MaskablePPO.load(str(p), device="cpu") for p in paths]
        hashes = {p.name for p in paths}
        self.assertEqual(len(hashes), len(paths))

        env = DantengEnv(seed=3, opponent="random")
        self.addCleanup(env.close)
        obs, _ = env.reset()
        mask = env.action_masks()
        acts = []
        for m in models:
            a, _ = m.predict(obs, action_masks=mask, deterministic=True)
            acts.append(int(a))
        self.assertEqual(len(set(acts)), 1, f"快照贪心动作不一致：{acts}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
