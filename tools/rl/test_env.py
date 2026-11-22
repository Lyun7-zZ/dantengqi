"""R0-5 单元测试：视角、终局/截断、掩码、序列化回归。"""

import unittest
import numpy as np

from env import DantengEnv, _encode_move


class TestDantengEnv(unittest.TestCase):
    def make(self, **kw):
        env = DantengEnv(**kw)
        self.addCleanup(env.close)
        return env

    def test_reset_perspective(self):
        for seed in range(20):
            env = self.make(seed=seed)
            obs, _ = env.reset(seed=seed)
            self.assertIn(env.learner, (0, 1))
            if env.state["winner"] is None:
                self.assertEqual(env.state["turn"], env.learner)
            self.assertEqual(obs["board"].shape, (10, 12, 10))
            self.assertEqual(obs["scalars"].shape, (4,))

    def test_terminal_stops_immediately(self):
        env = self.make()
        env.reset(seed=1)
        # 构造学习方在顶行、可直接向上越线的局面
        env.state["players"][env.learner] = {"c": 5, "r": 0}
        env.state["turn"] = env.learner
        env.state["topWall"][5] = 0
        before = env.state["plies"]
        obs, r, term, trunc, info = env.step(_encode_move("up"))
        self.assertTrue(term)
        self.assertFalse(trunc)
        self.assertEqual(env.state["winner"], env.learner)
        self.assertEqual(r, 1.0)
        self.assertEqual(env.state["plies"], before + 1)  # 没有对手应手

    def test_truncation_bootstrap(self):
        env = self.make(max_plies=6)
        env.reset(seed=2)
        done = False
        steps = 0
        while not done:
            mask = env.action_masks()
            # 避免越线：优先放墙，其次向下/左/右走
            choice = None
            for i in range(4, 232):
                if mask[i]:
                    choice = i
                    break
            if choice is None:
                for i in [1, 2, 3, 0]:
                    if mask[i]:
                        choice = i
                        break
            obs, r, term, trunc, info = env.step(int(choice))
            steps += 1
            done = term or trunc
            if steps > 20:
                self.fail("未在预期步数内截断")
        self.assertFalse(term)
        self.assertTrue(trunc)
        self.assertTrue(info.get("TimeLimit.truncated"))
        self.assertIn("terminal_observation", info)
        np.testing.assert_allclose(info["terminal_observation"]["board"], env._obs()["board"])

    def test_illegal_action_rejected(self):
        env = self.make()
        env.reset(seed=3)
        mask = env.action_masks()
        bad = int(np.flatnonzero(~mask)[0])
        with self.assertRaises(ValueError):
            env.step(bad)

    def test_mask_shape(self):
        env = self.make()
        env.reset(seed=4)
        mask = env.action_masks()
        self.assertEqual(mask.shape, (232,))
        self.assertGreater(int(mask.sum()), 0)

    def test_serialization_wall_limit_and_winner(self):
        env = self.make()
        env.reset(seed=5)
        # 墙数用尽：只应有走子
        env.state["wallLimit"] = [0, 0]
        env.state["wallsUsed"] = [0, 0]
        mask = env.action_masks()
        self.assertGreater(int(mask.sum()), 0)
        self.assertTrue(bool(mask[:4].any()))
        self.assertFalse(bool(mask[4:].any()))
        # 终局：全部非法
        env.state["winner"] = 0
        self.assertEqual(int(env.action_masks().sum()), 0)

    def test_opponent_never_after_terminal(self):
        env = self.make()
        env.reset(seed=6)
        env.state["players"][env.learner] = {"c": 5, "r": 0}
        env.state["turn"] = env.learner
        env.state["topWall"][5] = 0
        before = env.state["plies"]
        env.step(_encode_move("up"))
        self.assertEqual(env.state["plies"], before + 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
