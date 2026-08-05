"""Standalone tests for wavefront-batched PUCT search."""

from __future__ import annotations

import unittest
from typing import Any

import numpy as np

from mage_knight_sdk.sim.rl.mcts import (
    BatchedMCTS,
    MCTSConfig,
    MCTSNode,
    puct_score,
)


class _FakeSearchEnv:
    """Small deterministic graph implementing the PyVecEnv search API."""

    def __init__(self) -> None:
        self.graph = {
            "root_a": ["a0", "a1", "a2"],
            "root_b": ["b0", "b1", "b2"],
            "a0": ["a00", "a01"],
            "a1": ["a10", "a11"],
            "a2": ["a20", "a21"],
            "b0": ["b00", "b01"],
            "b1": ["b10", "b11"],
            "b2": ["b20", "b21"],
            "a00": [],
            "a01": [],
            "a10": [],
            "a11": [],
            "a20": [],
            "a21": [],
            "b00": [],
            "b01": [],
            "b10": [],
            "b11": [],
            "b20": [],
            "b21": [],
        }
        self.real_states = ["root_a", "root_b"]
        self.states: dict[int, str] = {}
        self.next_handle = 1
        self.step_batch_sizes: list[int] = []

    def _new_handle(self, state_key: str) -> int:
        handle = self.next_handle
        self.next_handle += 1
        self.states[handle] = state_key
        return handle

    def fork_roots(self, env_indices: list[int]) -> list[int]:
        return [self._new_handle(self.real_states[index]) for index in env_indices]

    def step_search_batch(
        self,
        handles: list[int],
        action_indices: list[int],
        combat_mode: str,
    ) -> list[int]:
        if len(handles) != len(action_indices):
            raise ValueError("length mismatch")
        if not combat_mode.startswith("cheap"):
            raise ValueError("tests expect cheap combat mode")
        self.step_batch_sizes.append(len(handles))
        children = []
        for handle, action_index in zip(handles, action_indices, strict=True):
            child_key = self.graph[self.states[handle]][action_index]
            children.append(self._new_handle(child_key))
        return children

    def encode_search_batch(self, handles: list[int]) -> dict[str, Any]:
        keys = [self.states[handle] for handle in handles]
        return {
            "action_counts": np.asarray(
                [len(self.graph[key]) for key in keys], dtype=np.int32,
            ),
            "state_keys": keys,
        }

    def drop_search_states(self, handles: list[int]) -> int:
        dropped = 0
        for handle in handles:
            if self.states.pop(handle, None) is not None:
                dropped += 1
        return dropped

    def search_state_count(self) -> int:
        return len(self.states)


class _FakePolicyValue:
    def __init__(self) -> None:
        self.batch_sizes: list[int] = []
        self.priors = {
            "root_a": [0.34, 0.33, 0.33],
            "root_b": [0.34, 0.33, 0.33],
            "a0": [0.7, 0.3],
            "a1": [0.5, 0.5],
            "a2": [0.5, 0.5],
            "b0": [0.5, 0.5],
            "b1": [0.7, 0.3],
            "b2": [0.5, 0.5],
        }
        self.values = {
            "root_a": 0.0,
            "root_b": 0.0,
            "a0": 0.9,
            "a1": 0.1,
            "a2": -0.5,
            "b0": -0.4,
            "b1": 0.95,
            "b2": 0.0,
            "a00": 1.0,
            "a01": 0.7,
            "a10": 0.2,
            "a11": 0.0,
            "a20": -0.4,
            "a21": -0.6,
            "b00": -0.3,
            "b01": -0.5,
            "b10": 1.0,
            "b11": 0.8,
            "b20": 0.1,
            "b21": -0.1,
        }

    def __call__(self, batch: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
        keys = batch["state_keys"]
        self.batch_sizes.append(len(keys))
        max_actions = max(1, max(int(count) for count in batch["action_counts"]))
        priors = np.zeros((len(keys), max_actions), dtype=np.float32)
        for row, key in enumerate(keys):
            raw_priors = self.priors.get(key, [])
            priors[row, :len(raw_priors)] = raw_priors
        values = np.asarray([self.values[key] for key in keys], dtype=np.float32)
        return priors, values


class MCTSNodeTest(unittest.TestCase):
    def test_puct_formula_uses_q_prior_and_visits(self) -> None:
        parent = MCTSNode(handle=1, visit_count=9)
        child = MCTSNode(handle=2, prior=0.4, visit_count=2, value_sum=1.0)

        score = puct_score(parent, child, c_puct=1.5, virtual_loss=1.0)

        expected = 0.5 + 1.5 * 0.4 * np.sqrt(9) / 3
        self.assertAlmostEqual(score, expected)
        self.assertEqual(child.N, 2)
        self.assertEqual(child.W, 1.0)
        self.assertEqual(child.Q, 0.5)
        self.assertEqual(child.P, 0.4)


class BatchedMCTSTest(unittest.TestCase):
    def setUp(self) -> None:
        self.env = _FakeSearchEnv()
        self.evaluator = _FakePolicyValue()
        self.search = BatchedMCTS(
            self.env,
            self.evaluator,
            MCTSConfig(
                simulations=16,
                c_puct=1.5,
                leaves_per_root_per_wave=3,
                virtual_loss=1.0,
                random_seed=7,
            ),
        )
        self.search.reset_roots([0, 1])

    def tearDown(self) -> None:
        self.search.close()

    def test_wavefront_search_batches_roots_and_leaves(self) -> None:
        report = self.search.search()

        self.assertEqual(report.total_simulations, 32)
        self.assertEqual(report.network_batches, len(self.evaluator.batch_sizes))
        self.assertEqual(self.evaluator.batch_sizes[0], 2)
        self.assertTrue(any(size > 2 for size in self.evaluator.batch_sizes[1:]))
        self.assertTrue(any(size > 1 for size in self.env.step_batch_sizes))

        counts = self.search.root_visit_counts()
        self.assertEqual([int(row.sum()) for row in counts], [16, 16])
        self.assertTrue(all(np.count_nonzero(row) >= 2 for row in counts))
        self.assertEqual(int(np.argmax(counts[0])), 0)
        self.assertEqual(int(np.argmax(counts[1])), 1)

        for tree in self.search.trees:
            self.assertEqual(tree.root.N, 16)
            self.assertEqual(tree.root.virtual_visits, 0)

    def test_visit_weighted_probabilities_are_non_degenerate(self) -> None:
        self.search.search(simulations=12)

        distributions = self.search.action_probabilities(temperature=1.0)

        for distribution in distributions:
            self.assertAlmostEqual(float(distribution.sum()), 1.0)
            self.assertGreater(np.count_nonzero(distribution), 1)
        self.assertNotEqual(
            int(np.argmax(distributions[0])),
            int(np.argmax(distributions[1])),
            "different roots should not collapse to the same preferred action",
        )

    def test_tree_reuse_prunes_siblings_and_close_drops_everything(self) -> None:
        self.search.search(simulations=12)
        chosen_actions = [
            int(np.argmax(counts)) for counts in self.search.root_visit_counts()
        ]
        chosen_handles = [
            tree.root.children[action].handle
            for tree, action in zip(self.search.trees, chosen_actions, strict=True)
        ]
        previous_counts = [
            tree.root.children[action].visit_count
            for tree, action in zip(self.search.trees, chosen_actions, strict=True)
        ]
        before_prune = self.env.search_state_count()

        dropped = self.search.advance_roots(chosen_actions)

        self.assertGreater(dropped, 0)
        self.assertLess(self.env.search_state_count(), before_prune)
        self.assertEqual(
            [tree.root.handle for tree in self.search.trees],
            chosen_handles,
        )
        self.search.search(simulations=4)
        self.assertEqual(
            [tree.root.visit_count for tree in self.search.trees],
            [count + 4 for count in previous_counts],
        )

        retained_count = self.env.search_state_count()
        self.assertEqual(self.search.close(), retained_count)
        self.assertEqual(self.env.search_state_count(), 0)
        self.assertEqual(self.search.close(), 0)

    def test_root_dirichlet_noise_is_optional_and_normalized(self) -> None:
        self.search.close()
        noisy = BatchedMCTS(
            self.env,
            self.evaluator,
            MCTSConfig(
                simulations=1,
                dirichlet_fraction=0.25,
                dirichlet_alpha=0.3,
                random_seed=123,
            ),
        )
        try:
            noisy.reset_roots([0])
            noisy.search()
            priors = np.asarray(
                [child.prior for child in noisy.trees[0].root.children.values()]
            )
            self.assertAlmostEqual(float(priors.sum()), 1.0)
            self.assertFalse(np.allclose(priors, [0.34, 0.33, 0.33]))
        finally:
            noisy.close()


class RealEngineMCTSIntegrationTest(unittest.TestCase):
    @staticmethod
    def _copy_batch(batch: dict[str, Any]) -> dict[str, Any]:
        return {
            key: value.copy() if isinstance(value, np.ndarray) else value
            for key, value in batch.items()
        }

    def test_real_action_and_reused_search_roots_remain_synchronized(self) -> None:
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mk_python import PyVecEnv

        env = PyVecEnv(num_envs=2, base_seed=220, max_steps=100)
        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32,
            embedding_dim=8,
            d_model=32,
            device="cpu",
        ))
        real_before = self._copy_batch(env.encode_batch())
        search = BatchedMCTS(
            env,
            policy.evaluate_search_batch,
            MCTSConfig(
                simulations=4,
                leaves_per_root_per_wave=2,
                random_seed=220,
            ),
        )
        try:
            search.reset_roots([0, 1])
            search.search()

            real_after_search = env.encode_batch()
            for key, before_value in real_before.items():
                after_value = real_after_search[key]
                if isinstance(before_value, np.ndarray):
                    np.testing.assert_array_equal(before_value, after_value, err_msg=key)
                else:
                    self.assertEqual(before_value, after_value, key)

            actions = np.asarray(
                [int(np.argmax(counts)) for counts in search.root_visit_counts()],
                dtype=np.int32,
            )
            env.step_batch(actions)
            search.advance_roots(actions)

            real_after_action = env.encode_batch()
            reused_search = env.encode_search_batch(
                [tree.root.handle for tree in search.trees]
            )
            for key, real_value in real_after_action.items():
                search_value = reused_search[key]
                if isinstance(real_value, np.ndarray):
                    np.testing.assert_array_equal(real_value, search_value, err_msg=key)
                else:
                    self.assertEqual(real_value, search_value, key)
        finally:
            search.close()
        self.assertEqual(env.search_state_count(), 0)


if __name__ == "__main__":
    unittest.main()
