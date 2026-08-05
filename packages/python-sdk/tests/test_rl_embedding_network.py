"""Tests for the embedding-based action scoring network and checkpoint compat."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import torch

from mage_knight_sdk.sim.rl.features import (
    ACTION_SCALAR_DIM,
    COMBAT_ENEMY_SCALAR_DIM,
    HEX_SCALAR_DIM,
    MAP_ENEMY_SCALAR_DIM,
    SITE_SCALAR_DIM,
    STATE_SCALAR_DIM,
    UNIT_SCALAR_DIM,
    ActionFeatures,
    EncodedStep,
    StateFeatures,
)
from mage_knight_sdk.sim.rl.policy_gradient import (
    PolicyGradientConfig,
    ReinforcePolicy,
    Transition,
    _EmbeddingActionScoringNetwork,
)


def _make_state_features() -> StateFeatures:
    return StateFeatures(
        scalars=[0.0] * STATE_SCALAR_DIM,
        mode_id=1,
        hand_card_ids=[1, 2, 3],
        deck_card_ids=[1, 4, 5],
        discard_card_ids=[2, 3],
        unit_ids=[1],
        unit_scalars=[[0.0] * UNIT_SCALAR_DIM],
        current_terrain_id=1,
        current_site_type_id=0,
        combat_enemy_ids=[],
        combat_enemy_scalars=[],
        skill_ids=[1, 2],
        visible_site_ids=[1],
        visible_site_scalars=[[0.0] * SITE_SCALAR_DIM],
        map_enemy_ids=[1],
        map_enemy_scalars=[[0.0] * MAP_ENEMY_SCALAR_DIM],
        revealed_hex_terrain_ids=[1, 2],
        revealed_hex_scalars=[[0.0] * HEX_SCALAR_DIM, [0.0] * HEX_SCALAR_DIM],
    )


def _make_actions() -> list[ActionFeatures]:
    return [
        ActionFeatures(
            action_type_id=1, source_id=1, card_id=1, unit_id=0,
            enemy_id=0, skill_id=0, target_enemy_ids=[], scalars=[0.0] * ACTION_SCALAR_DIM,
        ),
        ActionFeatures(
            action_type_id=1, source_id=1, card_id=2, unit_id=0,
            enemy_id=0, skill_id=0, target_enemy_ids=[], scalars=[0.0] * ACTION_SCALAR_DIM,
        ),
        ActionFeatures(
            action_type_id=2, source_id=2, card_id=0, unit_id=0,
            enemy_id=0, skill_id=0, target_enemy_ids=[], scalars=[0.0] * ACTION_SCALAR_DIM,
        ),
    ]


def _make_step() -> EncodedStep:
    return EncodedStep(state=_make_state_features(), actions=_make_actions())


class EmbeddingNetworkForwardTest(unittest.TestCase):
    def test_forward_returns_correct_shape(self) -> None:
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        step = _make_step()
        device = torch.device("cpu")
        logits, value = net(step, device)
        self.assertEqual(logits.shape, (3,))

    def test_forward_produces_finite_values(self) -> None:
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        step = _make_step()
        device = torch.device("cpu")
        logits, value = net(step, device)
        self.assertTrue(torch.isfinite(logits).all())

    def test_value_head_returns_scalar(self) -> None:
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        step = _make_step()
        device = torch.device("cpu")
        logits, value = net(step, device)
        self.assertEqual(value.shape, ())
        self.assertTrue(torch.isfinite(value))

    def test_different_cards_different_logits(self) -> None:
        """Play march vs play rage should produce different scores."""
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        step = _make_step()
        device = torch.device("cpu")
        logits, _ = net(step, device)
        self.assertFalse(torch.allclose(logits, logits[0].expand_as(logits), atol=1e-6))

    def test_encode_state_returns_triple(self) -> None:
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        step = _make_step()
        device = torch.device("cpu")
        state_repr, entity_seq, entity_mask = net.encode_state(step, device)
        self.assertEqual(state_repr.shape, (64,))
        self.assertEqual(entity_seq.ndim, 3)  # (1, E, d_model)
        self.assertEqual(entity_seq.shape[0], 1)
        self.assertEqual(entity_seq.shape[2], 32)  # d_model
        self.assertEqual(entity_mask.shape, entity_seq.shape[:2])

    def test_state_input_dim(self) -> None:
        """Verify the network's actual state input dimension matches formula."""
        emb_dim = 8
        d_model = 32
        # scalars + 3 fixed embs (mode, terrain, site) + 9 pool summaries
        expected_dim = STATE_SCALAR_DIM + 3 * emb_dim + 9 * d_model
        net = _EmbeddingActionScoringNetwork(
            hidden_size=64, emb_dim=emb_dim, d_model=d_model,
        )
        self.assertEqual(net.state_encoder[0].in_features, expected_dim)

    def test_encode_actions_returns_correct_shape(self) -> None:
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        step = _make_step()
        device = torch.device("cpu")
        action_reprs = net.encode_actions(step, device)
        self.assertEqual(action_reprs.shape, (3, 64))

    def test_empty_hand_doesnt_crash(self) -> None:
        sf = _make_state_features()
        sf = StateFeatures(**{**sf.__dict__, "hand_card_ids": []})
        step = EncodedStep(state=sf, actions=_make_actions())
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        logits, value = net(step, torch.device("cpu"))
        self.assertEqual(logits.shape, (3,))

    def test_empty_units_doesnt_crash(self) -> None:
        sf = _make_state_features()
        sf = StateFeatures(**{**sf.__dict__, "unit_ids": [], "unit_scalars": []})
        step = EncodedStep(state=sf, actions=_make_actions())
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        logits, value = net(step, torch.device("cpu"))
        self.assertEqual(logits.shape, (3,))

    def test_empty_map_doesnt_crash(self) -> None:
        """No sites, no enemies -> zero vector pools should work."""
        sf = _make_state_features()
        sf = StateFeatures(**{
            **sf.__dict__,
            "visible_site_ids": [],
            "visible_site_scalars": [],
            "map_enemy_ids": [],
            "map_enemy_scalars": [],
        })
        step = EncodedStep(state=sf, actions=_make_actions())
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        logits, value = net(step, torch.device("cpu"))
        self.assertEqual(logits.shape, (3,))
        self.assertTrue(torch.isfinite(logits).all())

    def test_combat_state_doesnt_crash(self) -> None:
        """Combat with enemies should encode without errors."""
        sf = _make_state_features()
        sf = StateFeatures(**{
            **sf.__dict__,
            "combat_enemy_ids": [1, 2],
            "combat_enemy_scalars": [
                [0.0] * COMBAT_ENEMY_SCALAR_DIM,
                [0.0] * COMBAT_ENEMY_SCALAR_DIM,
            ],
        })
        step = EncodedStep(state=sf, actions=_make_actions())
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        logits, value = net(step, torch.device("cpu"))
        self.assertEqual(logits.shape, (3,))
        self.assertTrue(torch.isfinite(logits).all())

    def test_empty_skills_doesnt_crash(self) -> None:
        sf = _make_state_features()
        sf = StateFeatures(**{**sf.__dict__, "skill_ids": []})
        step = EncodedStep(state=sf, actions=_make_actions())
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        logits, value = net(step, torch.device("cpu"))
        self.assertEqual(logits.shape, (3,))

    def test_visible_site_pool_affects_state(self) -> None:
        """Adding more sites to the map should change state encoding."""
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        device = torch.device("cpu")

        step1 = _make_step()
        repr1, _, _ = net.encode_state(step1, device)

        sf2 = _make_state_features()
        sf2 = StateFeatures(**{
            **sf2.__dict__,
            "visible_site_ids": [1, 2],
            "visible_site_scalars": [
                [0.0] * SITE_SCALAR_DIM,
                [1.0] * SITE_SCALAR_DIM,
            ],
        })
        step2 = EncodedStep(state=sf2, actions=_make_actions())
        repr2, _, _ = net.encode_state(step2, device)

        self.assertFalse(torch.allclose(repr1, repr2, atol=1e-6))

    def test_map_enemy_pool_affects_state(self) -> None:
        """Adding map enemies should change state encoding."""
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        device = torch.device("cpu")

        sf1 = _make_state_features()
        sf1 = StateFeatures(**{
            **sf1.__dict__,
            "map_enemy_ids": [],
            "map_enemy_scalars": [],
        })
        step1 = EncodedStep(state=sf1, actions=_make_actions())
        repr1, _, _ = net.encode_state(step1, device)

        step2 = _make_step()
        repr2, _, _ = net.encode_state(step2, device)

        self.assertFalse(torch.allclose(repr1, repr2, atol=1e-6))

    def test_encode_state_batch_matches_individual(self) -> None:
        """Batch state encoding must produce same results as individual calls."""
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        net.eval()
        device = torch.device("cpu")

        step1 = _make_step()
        sf2 = _make_state_features()
        sf2 = StateFeatures(**{
            **sf2.__dict__,
            "scalars": [1.0] * STATE_SCALAR_DIM,
            "hand_card_ids": [],
        })
        step2 = EncodedStep(state=sf2, actions=_make_actions())

        with torch.no_grad():
            individual_1, _, _ = net.encode_state(step1, device)
            individual_2, _, _ = net.encode_state(step2, device)
            batched, _, _ = net.encode_state_batch([step1, step2], device)

        self.assertEqual(batched.shape, (2, 64))
        self.assertTrue(torch.allclose(individual_1, batched[0], atol=1e-5))
        self.assertTrue(torch.allclose(individual_2, batched[1], atol=1e-5))

    def test_encode_state_batch_single_item(self) -> None:
        """Batch with a single item should match individual encode."""
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        net.eval()
        device = torch.device("cpu")
        step = _make_step()

        with torch.no_grad():
            individual, _, _ = net.encode_state(step, device)
            batched, _, _ = net.encode_state_batch([step], device)

        self.assertEqual(batched.shape, (1, 64))
        self.assertTrue(torch.allclose(individual, batched[0], atol=1e-5))

    def test_multi_layer_forward(self) -> None:
        """2-layer encoder should produce correct output shapes and finite values."""
        net = _EmbeddingActionScoringNetwork(
            hidden_size=64, emb_dim=8, num_hidden_layers=2, d_model=32,
        )
        step = _make_step()
        device = torch.device("cpu")
        logits, value = net(step, device)
        self.assertEqual(logits.shape, (3,))
        self.assertTrue(torch.isfinite(logits).all())
        self.assertEqual(value.shape, ())
        self.assertTrue(torch.isfinite(value))

    def test_multi_layer_state_input_dim(self) -> None:
        """state_encoder[0].in_features should be unchanged by depth."""
        emb_dim = 8
        hidden = 64
        d_model = 32
        expected_dim = STATE_SCALAR_DIM + 3 * emb_dim + 9 * d_model
        net1 = _EmbeddingActionScoringNetwork(
            hidden_size=hidden, emb_dim=emb_dim, num_hidden_layers=1, d_model=d_model,
        )
        net3 = _EmbeddingActionScoringNetwork(
            hidden_size=hidden, emb_dim=emb_dim, num_hidden_layers=3, d_model=d_model,
        )
        # First layer input dim unchanged
        self.assertEqual(net1.state_encoder[0].in_features, expected_dim)
        self.assertEqual(net3.state_encoder[0].in_features, expected_dim)
        # Intermediate layers are hidden->hidden
        self.assertEqual(net3.state_encoder[2].in_features, hidden)
        self.assertEqual(net3.state_encoder[2].out_features, hidden)
        # Action encoder also scales with depth
        self.assertEqual(net3.action_encoder[2].in_features, hidden)
        self.assertEqual(net3.action_encoder[2].out_features, hidden)

    def test_cross_attention_individual_vs_batch(self) -> None:
        """Individual forward and batched scoring should produce consistent logits."""
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        net.eval()
        device = torch.device("cpu")

        step1 = _make_step()  # 3 actions
        step2 = EncodedStep(state=_make_state_features(), actions=_make_actions()[:2])  # 2 actions

        with torch.no_grad():
            logits1, _ = net(step1, device)
            logits2, _ = net(step2, device)

        self.assertEqual(logits1.shape, (3,))
        self.assertEqual(logits2.shape, (2,))
        self.assertTrue(torch.isfinite(logits1).all())
        self.assertTrue(torch.isfinite(logits2).all())

    def test_entity_sequence_populated(self) -> None:
        """Entity sequence should have entries for non-empty pools."""
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        step = _make_step()
        device = torch.device("cpu")
        _, entity_seq, entity_mask = net.encode_state(step, device)
        # hand=3 + deck=3 + discard=2 + unit=1 + combat=0 + skill=2 + site=1 + map_enemy=1 + hex=2 = 15
        self.assertEqual(int(entity_mask.sum().item()), 15)
        self.assertEqual(entity_seq.shape[1], 15)

    def test_all_pools_empty_doesnt_crash(self) -> None:
        """State with every pool empty should still produce finite outputs."""
        sf = StateFeatures(
            scalars=[0.0] * STATE_SCALAR_DIM,
            mode_id=0,
            hand_card_ids=[],
            deck_card_ids=[],
            discard_card_ids=[],
            unit_ids=[],
            unit_scalars=[],
            current_terrain_id=0,
            current_site_type_id=0,
            combat_enemy_ids=[],
            combat_enemy_scalars=[],
            skill_ids=[],
            visible_site_ids=[],
            visible_site_scalars=[],
            map_enemy_ids=[],
            map_enemy_scalars=[],
            revealed_hex_terrain_ids=[],
            revealed_hex_scalars=[],
        )
        step = EncodedStep(state=sf, actions=_make_actions())
        net = _EmbeddingActionScoringNetwork(hidden_size=64, emb_dim=8, d_model=32)
        logits, value = net(step, torch.device("cpu"))
        self.assertEqual(logits.shape, (3,))
        self.assertTrue(torch.isfinite(logits).all())
        self.assertTrue(torch.isfinite(value))


class ReinforcePolicyTest(unittest.TestCase):
    def test_choose_action_from_encoded(self) -> None:
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)
        step = _make_step()
        result = policy.choose_action_from_encoded(step)
        self.assertIn(result, range(3))

    def test_choose_action_empty_actions(self) -> None:
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)
        step = EncodedStep(state=_make_state_features(), actions=[])
        result = policy.choose_action_from_encoded(step)
        self.assertEqual(result, 0)

    def test_evaluate_search_batch_returns_priors_without_recording_training_state(self) -> None:
        from mk_python import PyVecEnv

        policy = ReinforcePolicy(PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        ))
        batch = PyVecEnv(num_envs=3, base_seed=42).encode_batch()
        policy._network.train()

        priors, values = policy.evaluate_search_batch(batch)

        self.assertEqual(priors.shape[0], 3)
        self.assertEqual(values.shape, (3,))
        self.assertTrue(policy._network.training)
        self.assertEqual(len(policy._episode_log_probs), 0)
        for row, raw_count in enumerate(batch["action_counts"]):
            action_count = int(raw_count)
            self.assertAlmostEqual(
                float(priors[row, :action_count].sum()), 1.0, places=6,
            )
            self.assertEqual(float(priors[row, action_count:].sum()), 0.0)

    def test_evaluate_search_batch_handles_all_terminal_rows(self) -> None:
        from mk_python import PyVecEnv

        policy = ReinforcePolicy(PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        ))
        batch = PyVecEnv(num_envs=2, base_seed=84).encode_batch()
        batch["action_counts"] = batch["action_counts"] * 0

        priors, values = policy.evaluate_search_batch(batch)

        self.assertEqual(priors.shape, (2, int(batch["max_actions"])))
        self.assertEqual(values.shape, (2,))
        self.assertEqual(float(priors.sum()), 0.0)


class CheckpointRoundTripTest(unittest.TestCase):
    def test_reward_normalizer_checkpoint_round_trip(self) -> None:
        policy = ReinforcePolicy(PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        ))
        reward_state = {"mean": 1.25, "var": 3.5, "count": 99}
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.pt"
            policy.save_checkpoint(
                path,
                metadata={"episode": 5},
                reward_normalizer_state=reward_state,
            )
            _, meta = ReinforcePolicy.load_checkpoint(path, device_override="cpu")

        self.assertEqual(meta["reward_normalizer"], reward_state)

    def test_checkpoint_save_load(self) -> None:
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.pt"
            policy.save_checkpoint(path, metadata={"episode": 5})
            loaded_policy, meta = ReinforcePolicy.load_checkpoint(path, device_override="cpu")
            self.assertEqual(meta["episode"], 5)
            self.assertEqual(loaded_policy.config.embedding_dim, 8)
            self.assertEqual(loaded_policy.config.d_model, 32)

    def test_num_hidden_layers_checkpoint_round_trip(self) -> None:
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu",
            num_hidden_layers=3, d_model=32,
        )
        policy = ReinforcePolicy(config)
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.pt"
            policy.save_checkpoint(path, metadata={"episode": 1})
            loaded_policy, _ = ReinforcePolicy.load_checkpoint(path, device_override="cpu")
            self.assertEqual(loaded_policy.config.num_hidden_layers, 3)
            # Verify the loaded network actually has 3 layers (6 modules: 3 Linear + 3 Tanh)
            self.assertEqual(len(loaded_policy._network.state_encoder), 6)

    def test_old_checkpoint_defaults_num_hidden_layers(self) -> None:
        """Simulate loading a checkpoint saved before num_hidden_layers existed."""
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.pt"
            policy.save_checkpoint(path)
            # Manually remove num_hidden_layers from saved config to simulate old checkpoint
            payload = torch.load(path, map_location="cpu", weights_only=True)
            del payload["config"]["num_hidden_layers"]
            torch.save(payload, path)
            loaded_policy, _ = ReinforcePolicy.load_checkpoint(path, device_override="cpu")
            self.assertEqual(loaded_policy.config.num_hidden_layers, 1)

    def test_loaded_policy_can_choose_action(self) -> None:
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "test.pt"
            policy.save_checkpoint(path)
            loaded_policy, _ = ReinforcePolicy.load_checkpoint(path, device_override="cpu")
            result = loaded_policy.choose_action_from_encoded(_make_step())
            self.assertIn(result, range(3))


class BatchedActionEncodingTest(unittest.TestCase):
    """Test that batched action encoding in optimize_ppo matches individual calls."""

    def test_optimize_ppo_batched(self) -> None:
        """optimize_ppo with batched encoding runs without error."""
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)

        # Collect transitions via choose_action_from_encoded
        transitions = []
        for step_i in range(5):
            step = _make_step()
            policy.choose_action_from_encoded(step)
            policy.record_step_reward(0.1 * step_i)
            info = policy.last_step_info
            if info is not None:
                transitions.append(Transition(
                    encoded_step=info.encoded_step,
                    action_index=info.action_index,
                    log_prob=info.log_prob,
                    value=info.value,
                    reward=0.1 * step_i,
                ))

        advantages = [0.5] * len(transitions)
        returns = [1.0] * len(transitions)

        stats = policy.optimize_ppo(
            transitions, advantages, returns,
            ppo_epochs=2, mini_batch_size=3,
        )
        self.assertEqual(stats.action_count, len(transitions))
        self.assertIsInstance(stats.loss, float)
        self.assertTrue(abs(stats.loss) < 1000)  # sanity
        self.assertGreater(stats.entropy, 0.0)
        self.assertGreater(stats.critic_loss, 0.0)

    def test_ppo_gradients_flow_through_attention(self) -> None:
        """Verify EntityPoolEncoder parameters receive gradients during PPO."""
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)

        transitions = []
        for step_i in range(5):
            step = _make_step()
            policy.choose_action_from_encoded(step)
            policy.record_step_reward(0.1 * step_i)
            info = policy.last_step_info
            if info is not None:
                transitions.append(Transition(
                    encoded_step=info.encoded_step,
                    action_index=info.action_index,
                    log_prob=info.log_prob,
                    value=info.value,
                    reward=0.1 * step_i,
                ))

        # Snapshot attention weights before PPO
        hand_proj_before = policy._network.hand_pool_enc.input_proj.weight.data.clone()
        cross_proj_before = policy._network.cross_attn_scorer.action_proj.weight.data.clone()

        policy.optimize_ppo(
            transitions, [0.5] * len(transitions), [1.0] * len(transitions),
            ppo_epochs=2, mini_batch_size=3,
        )

        # Weights should have changed
        hand_proj_after = policy._network.hand_pool_enc.input_proj.weight.data
        cross_proj_after = policy._network.cross_attn_scorer.action_proj.weight.data
        self.assertFalse(torch.allclose(hand_proj_before, hand_proj_after))
        self.assertFalse(torch.allclose(cross_proj_before, cross_proj_after))


class OptimizeEpisodeTest(unittest.TestCase):
    def test_optimize_with_actor_critic(self) -> None:
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu", d_model=32,
        )
        policy = ReinforcePolicy(config)

        for _ in range(3):
            policy.choose_action_from_encoded(_make_step())
            policy.record_step_reward(0.5)
        policy.add_terminal_reward(1.0)

        stats = policy.optimize_episode()
        self.assertEqual(stats.action_count, 3)
        self.assertIsInstance(stats.loss, float)
        self.assertIsInstance(stats.entropy, float)

    def test_actor_critic_produces_critic_loss(self) -> None:
        """Optimizer should report non-zero critic loss."""
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu",
            critic_coefficient=0.5, d_model=32,
        )
        policy = ReinforcePolicy(config)

        for _ in range(5):
            policy.choose_action_from_encoded(_make_step())
            policy.record_step_reward(0.1)
        policy.add_terminal_reward(1.0)

        stats = policy.optimize_episode()
        self.assertGreater(stats.critic_loss, 0.0)
        self.assertEqual(stats.action_count, 5)

    def test_value_head_gradients_flow(self) -> None:
        """Value head parameters should receive gradients during Actor-Critic training."""
        config = PolicyGradientConfig(
            embedding_dim=8, hidden_size=64, device="cpu",
            critic_coefficient=0.5, d_model=32,
        )
        policy = ReinforcePolicy(config)

        for _ in range(3):
            policy.choose_action_from_encoded(_make_step())
            policy.record_step_reward(0.5)
        policy.add_terminal_reward(1.0)

        vh_weight_before = policy._network.value_head.weight.data.clone()
        policy.optimize_episode()
        vh_weight_after = policy._network.value_head.weight.data

        self.assertFalse(torch.allclose(vh_weight_before, vh_weight_after))


if __name__ == "__main__":
    unittest.main()
