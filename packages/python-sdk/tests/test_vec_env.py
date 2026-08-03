"""Tests for vectorized environment (PyVecEnv) and batched forward pass."""

from __future__ import annotations

import unittest

import numpy as np


class TestPyVecEnv(unittest.TestCase):
    """Tests for the PyVecEnv Rust-backed vectorized environment."""

    def setUp(self) -> None:
        from mk_python import PyVecEnv
        self.PyVecEnv = PyVecEnv

    def test_creation(self) -> None:
        env = self.PyVecEnv(num_envs=4, base_seed=42, hero="arythea", max_steps=100)
        self.assertEqual(env.num_envs(), 4)

    def test_encode_batch_returns_dict(self) -> None:
        env = self.PyVecEnv(num_envs=4, base_seed=42)
        batch = env.encode_batch()
        self.assertIsInstance(batch, dict)

    def test_encode_batch_shapes(self) -> None:
        n = 8
        env = self.PyVecEnv(num_envs=n, base_seed=1)
        batch = env.encode_batch()

        # State scalars: (N, STATE_SCALAR_DIM=99)
        self.assertEqual(batch["state_scalars"].shape, (n, 99))
        self.assertEqual(batch["state_scalars"].dtype, np.float32)

        # State IDs: (N, 3)
        self.assertEqual(batch["state_ids"].shape, (n, 3))
        self.assertEqual(batch["state_ids"].dtype, np.int32)

        # Action counts: (N,)
        self.assertEqual(batch["action_counts"].shape, (n,))
        for c in batch["action_counts"]:
            self.assertGreater(c, 0, "Game start should have legal actions")

        # Hand card IDs: (N, max_H)
        self.assertEqual(batch["hand_card_ids"].shape[0], n)
        self.assertEqual(batch["hand_counts"].shape, (n,))

        # Fames: (N,)
        self.assertEqual(batch["fames"].shape, (n,))

    def test_step_batch_with_zeros(self) -> None:
        """Step all envs with action index 0 (always valid)."""
        n = 4
        env = self.PyVecEnv(num_envs=n, base_seed=42, max_steps=100)
        actions = np.zeros(n, dtype=np.int32)
        result = env.step_batch(actions)

        self.assertIn("fame_deltas", result)
        self.assertIn("dones", result)
        self.assertIn("fames", result)
        self.assertEqual(result["fame_deltas"].shape, (n,))
        self.assertEqual(result["dones"].shape, (n,))
        self.assertEqual(result["fames"].shape, (n,))

    def test_multiple_steps(self) -> None:
        """Run several steps and verify no crashes."""
        n = 4
        env = self.PyVecEnv(num_envs=n, base_seed=42, max_steps=50)

        for _ in range(20):
            env.encode_batch()
            actions = np.zeros(n, dtype=np.int32)
            env.step_batch(actions)
            # After step, encode should still work
            batch2 = env.encode_batch()
            self.assertEqual(batch2["state_scalars"].shape[0], n)

    def test_auto_reset_produces_valid_obs(self) -> None:
        """After an env is done, the auto-reset should produce valid observations."""
        n = 2
        env = self.PyVecEnv(num_envs=n, base_seed=42, max_steps=5)

        found_done = False
        for _ in range(50):
            env.encode_batch()
            actions = np.zeros(n, dtype=np.int32)
            result = env.step_batch(actions)
            if any(result["dones"]):
                found_done = True
                # After done + auto-reset, encode should work
                batch2 = env.encode_batch()
                for i in range(n):
                    self.assertGreater(
                        batch2["action_counts"][i], 0,
                        "Reset env should have legal actions",
                    )
                break

        self.assertTrue(found_done, "Expected at least one done within 50 steps with max_steps=5")

    def test_action_ids_shape(self) -> None:
        """Action IDs should be (N*max_M, 6) from Rust, reshaped on Python side."""
        n = 4
        env = self.PyVecEnv(num_envs=n, base_seed=42)
        batch = env.encode_batch()

        max_m = int(batch["action_counts"].max())
        # action_ids comes as (N*max_M, 6)
        self.assertEqual(batch["action_ids"].shape[0], n * max_m)
        self.assertEqual(batch["action_ids"].shape[1], 6)

        # action_scalars: (N*max_M, 34)
        self.assertEqual(batch["action_scalars"].shape[0], n * max_m)
        self.assertEqual(batch["action_scalars"].shape[1], 34)


class TestSearchStateApi(unittest.TestCase):
    """Hypothetical states must remain isolated from the live PyVecEnv batch."""

    def setUp(self) -> None:
        from mk_python import PyVecEnv, SEARCH_COMBAT_MODE_CHEAP
        self.env = PyVecEnv(num_envs=2, base_seed=42, max_steps=500)
        self.cheap_combat_mode = SEARCH_COMBAT_MODE_CHEAP

    @staticmethod
    def _copy_batch(batch: dict) -> dict:
        return {
            key: value.copy() if isinstance(value, np.ndarray) else value
            for key, value in batch.items()
        }

    @staticmethod
    def _assert_batches_equal(left: dict, right: dict) -> None:
        assert left.keys() == right.keys()
        for key in left:
            if isinstance(left[key], np.ndarray):
                np.testing.assert_array_equal(left[key], right[key], err_msg=key)
            else:
                assert left[key] == right[key], key

    def test_fork_step_encode_and_drop_are_isolated(self) -> None:
        real_before = self._copy_batch(self.env.encode_batch())
        roots = self.env.fork_roots([0, 1, 0])
        self.assertEqual(len(roots), 3)
        self.assertEqual(len(set(roots)), 3)
        self.assertEqual(self.env.search_state_count(), 3)
        self._assert_batches_equal(
            real_before,
            self.env.encode_search_batch(roots[:2]),
        )

        root_batch = self.env.encode_search_batch(roots)
        self.assertEqual(root_batch["state_scalars"].shape[0], 3)
        np.testing.assert_array_equal(
            root_batch["state_scalars"][0], root_batch["state_scalars"][2],
        )
        self.assertEqual(root_batch["action_counts"][0], root_batch["action_counts"][2])

        parent_before = self._copy_batch(self.env.encode_search_batch([roots[0]]))
        parent_action_count = int(parent_before["action_counts"][0])
        children = self.env.step_search_batch(
            [roots[0], roots[0]],
            [0, parent_action_count - 1],
            self.cheap_combat_mode,
        )
        self.assertEqual(len(children), 2)
        self.assertEqual(self.env.search_state_count(), 5)
        self._assert_batches_equal(
            parent_before,
            self.env.encode_search_batch([roots[0]]),
        )

        # Neither search branching nor search encoding may alter the real environments.
        self._assert_batches_equal(real_before, self.env.encode_batch())

        self.assertEqual(self.env.drop_search_states(roots + children), 5)
        self.assertEqual(self.env.drop_search_states(roots), 0)
        self.assertEqual(self.env.search_state_count(), 0)

    def test_search_api_rejects_invalid_inputs(self) -> None:
        root = self.env.fork_roots([0])[0]
        with self.assertRaises(ValueError):
            self.env.step_search_batch([root], [], self.cheap_combat_mode)
        with self.assertRaises(ValueError):
            self.env.step_search_batch([root], [0], "unknown")
        with self.assertRaises(ValueError):
            self.env.encode_search_batch([])
        self.env.drop_search_states([root])
        with self.assertRaises(ValueError):
            self.env.encode_search_batch([root])


class TestBatchedForward(unittest.TestCase):
    """Tests for the batched forward pass on _EmbeddingActionScoringNetwork."""

    def setUp(self) -> None:
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        self.config = PolicyGradientConfig(
            hidden_size=64,
            embedding_dim=8,
            device="cpu",
        )
        self.policy = ReinforcePolicy(self.config)

    def test_forward_batch_shapes(self) -> None:
        """forward_batch should produce (N, max_M) logits and (N,) values."""
        from mk_python import PyVecEnv

        n = 4
        env = PyVecEnv(num_envs=n, base_seed=42)
        batch = env.encode_batch()

        import torch
        net = self.policy._network
        with torch.no_grad():
            logits, values = net.forward_batch(batch, torch.device("cpu"))

        self.assertEqual(values.shape, (n,))
        max_m = int(batch["action_counts"].max())
        self.assertEqual(logits.shape, (n, max_m))

        # Invalid positions should be -inf
        for i in range(n):
            ac = int(batch["action_counts"][i])
            if ac < max_m:
                self.assertTrue(
                    logits[i, ac:].eq(float("-inf")).all(),
                    f"Env {i}: positions after action_count should be -inf",
                )

    def test_choose_actions_batch(self) -> None:
        """choose_actions_batch should return valid action indices."""
        from mk_python import PyVecEnv

        n = 8
        env = PyVecEnv(num_envs=n, base_seed=1)
        batch = env.encode_batch()

        actions, log_probs, values = self.policy.choose_actions_batch(batch)

        self.assertEqual(actions.shape, (n,))
        self.assertEqual(log_probs.shape, (n,))
        self.assertEqual(values.shape, (n,))
        self.assertEqual(actions.dtype, np.int32)
        self.assertEqual(log_probs.dtype, np.float32)

        # All actions should be within valid range
        for i in range(n):
            ac = int(batch["action_counts"][i])
            self.assertGreaterEqual(actions[i], 0)
            self.assertLess(actions[i], ac, f"Env {i}: action {actions[i]} >= count {ac}")

    def test_choose_actions_batch_log_probs_finite(self) -> None:
        """Log probs should be finite (no NaN or -inf for selected actions)."""
        from mk_python import PyVecEnv

        n = 16
        env = PyVecEnv(num_envs=n, base_seed=100)
        batch = env.encode_batch()

        actions, log_probs, values = self.policy.choose_actions_batch(batch)

        self.assertTrue(
            np.all(np.isfinite(log_probs)),
            f"Non-finite log_probs: {log_probs}",
        )
        self.assertTrue(
            np.all(np.isfinite(values)),
            f"Non-finite values: {values}",
        )


class TestVecEnvRunner(unittest.TestCase):
    """Tests for the VecEnv collection loop."""

    def test_terminal_end_bonus_is_not_applied_to_hard_limit(self) -> None:
        """A time-limit truncation must not be rewarded as a natural ending."""
        from mk_python import PyVecEnv
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
        from mage_knight_sdk.sim.rl.vec_env_runner import collect_vecenv_rollout

        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32, embedding_dim=8, device="cpu",
        ))
        env = PyVecEnv(num_envs=2, base_seed=42, max_steps=1)
        rewards = RewardConfig(
            fame_delta_scale=0.0,
            terminal_end_bonus=7.0,
            terminal_fame_scale=5.0,
            terminal_max_steps_penalty=0.0,
        )

        result = collect_vecenv_rollout(env, policy, rewards, total_steps=2)

        self.assertEqual(result.total_episodes, 2)
        self.assertTrue(all(meta.truncated for meta in result.episode_metas))
        self.assertTrue(
            all(meta.termination_cause == "hard_limit" for meta in result.episode_metas)
        )
        for episode in result.episodes:
            self.assertAlmostEqual(sum(t.reward for t in episode), 0.0)

    def test_terminal_fame_reward_is_applied_to_natural_end(self) -> None:
        """Natural endings receive final fame through the dedicated scale."""
        from mk_python import PyVecEnv
        from mage_knight_sdk.sim.rl.curriculum import TrainingScenario
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
        from mage_knight_sdk.sim.rl.vec_env_runner import collect_vecenv_rollout

        scenario = TrainingScenario.combat_drill(
            enemy_tokens=["diggers_1"],
            hand_override=["rage", "determination", "stamina"],
        ).to_rust_json()
        env = PyVecEnv(
            num_envs=2,
            base_seed=42,
            max_steps=20,
            scenario=scenario,
            combat_oracle=True,
        )
        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32, embedding_dim=8, device="cpu",
        ))
        rewards = RewardConfig(
            fame_delta_scale=0.0,
            terminal_fame_scale=0.5,
            terminal_max_steps_penalty=-3.0,
        )

        result = collect_vecenv_rollout(env, policy, rewards, total_steps=2)

        self.assertEqual(result.total_episodes, 2)
        for episode, meta in zip(result.episodes, result.episode_metas):
            self.assertFalse(meta.truncated)
            self.assertEqual(meta.termination_cause, "natural_end")
            expected = 0.5 * meta.total_fame_delta
            self.assertAlmostEqual(sum(t.reward for t in episode), expected)
            self.assertAlmostEqual(meta.reward_breakdown.terminal_fame, expected)
            self.assertAlmostEqual(meta.reward_breakdown.terminal_bonus, 0.0)

    def test_zero_fame_cutoff_has_distinct_termination_cause(self) -> None:
        from mk_python import PyVecEnv
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
        from mage_knight_sdk.sim.rl.vec_env_runner import collect_vecenv_rollout

        env = PyVecEnv(
            num_envs=2,
            base_seed=42,
            max_steps=10,
            early_term_fame_step=1,
        )
        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32, embedding_dim=8, device="cpu",
        ))

        result = collect_vecenv_rollout(
            env,
            policy,
            RewardConfig(fame_delta_scale=0.0),
            total_steps=2,
        )

        self.assertEqual(result.total_episodes, 2)
        self.assertTrue(
            all(
                meta.termination_cause == "early_zero_fame"
                for meta in result.episode_metas
            )
        )

    def test_terminal_max_steps_penalty_is_applied_to_hard_limit(self) -> None:
        """A hard environment time limit receives its configured penalty."""
        from mk_python import PyVecEnv
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
        from mage_knight_sdk.sim.rl.vec_env_runner import collect_vecenv_rollout

        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32, embedding_dim=8, device="cpu",
        ))
        env = PyVecEnv(num_envs=2, base_seed=42, max_steps=1)
        rewards = RewardConfig(
            fame_delta_scale=0.0,
            terminal_end_bonus=0.0,
            terminal_max_steps_penalty=-3.0,
        )

        result = collect_vecenv_rollout(env, policy, rewards, total_steps=2)

        self.assertEqual(result.total_episodes, 2)
        for episode in result.episodes:
            self.assertAlmostEqual(sum(t.reward for t in episode), -3.0)

    def test_hard_limit_captures_post_step_bootstrap_value(self) -> None:
        """The runner evaluates the pre-reset resulting state at truncation."""
        from mk_python import PyVecEnv
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
        from mage_knight_sdk.sim.rl.vec_env_runner import collect_vecenv_rollout

        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32, embedding_dim=8, device="cpu",
        ))
        evaluated_batches: list[dict] = []

        def fixed_post_step_values(batch: dict) -> np.ndarray:
            evaluated_batches.append(batch)
            return np.full(len(batch["action_counts"]), 7.0, dtype=np.float32)

        policy.evaluate_values_batch = fixed_post_step_values  # type: ignore[method-assign]
        env = PyVecEnv(num_envs=2, base_seed=42, max_steps=1)

        result = collect_vecenv_rollout(
            env,
            policy,
            RewardConfig(fame_delta_scale=0.0, terminal_max_steps_penalty=0.0),
            total_steps=2,
        )

        self.assertEqual(len(evaluated_batches), 1)
        self.assertEqual(len(evaluated_batches[0]["action_counts"]), 2)
        for episode in result.episodes:
            self.assertAlmostEqual(episode[-1].bootstrap_value or 0.0, 7.0)

    def test_collect_rollout(self) -> None:
        """Collect a small rollout and verify structure."""
        from mk_python import PyVecEnv
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
        from mage_knight_sdk.sim.rl.vec_env_runner import collect_vecenv_rollout

        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32, embedding_dim=8, device="cpu",
        ))
        reward_config = RewardConfig()
        env = PyVecEnv(num_envs=4, base_seed=42, max_steps=50)

        result = collect_vecenv_rollout(env, policy, reward_config, total_steps=200)

        self.assertGreater(result.total_steps, 0)
        self.assertGreaterEqual(result.total_steps, 200)
        # With max_steps=50 and 200 total steps, we should have some episodes
        self.assertGreater(result.total_episodes, 0)

        # Check first episode structure
        ep = result.episodes[0]
        self.assertGreater(len(ep), 0)

        vt = ep[0]
        self.assertEqual(vt.state_scalars.shape, (99,))
        self.assertEqual(vt.state_ids.shape, (3,))
        self.assertGreater(vt.action_ids.shape[0], 0)

    def test_vec_transition_to_transition(self) -> None:
        """VecTransition should convert to Transition for optimize_ppo."""
        from mk_python import PyVecEnv
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
        from mage_knight_sdk.sim.rl.vec_env_runner import (
            collect_vecenv_rollout,
            vec_transition_to_transition,
        )

        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32, embedding_dim=8, device="cpu",
        ))
        env = PyVecEnv(num_envs=2, base_seed=42, max_steps=20)

        result = collect_vecenv_rollout(env, policy, RewardConfig(), total_steps=100)
        self.assertGreater(len(result.episodes), 0)

        vt = result.episodes[0][0]
        t = vec_transition_to_transition(vt)

        self.assertEqual(len(t.encoded_step.state.scalars), 99)
        self.assertGreater(len(t.encoded_step.actions), 0)
        self.assertIsInstance(t.reward, float)


if __name__ == "__main__":
    unittest.main()
