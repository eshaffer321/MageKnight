"""Tests for RL reward config and EpisodeTrainingStats."""
from __future__ import annotations

import argparse
import unittest
import json
import tempfile
from pathlib import Path

from mage_knight_sdk.cli.train_rl import (
    _TBWriter,
    _append_metrics_log,
    _limit_curriculum_batch,
    _write_run_manifest,
)
from mage_knight_sdk.sim.rl.rewards import RewardConfig
from mage_knight_sdk.sim.rl.native_rl_runner import EpisodeTrainingStats
from mage_knight_sdk.sim.rl.curriculum import (
    CurriculumPhase,
    CurriculumSchedule,
    TrainingScenario,
)
from mage_knight_sdk.sim.rl.policy_gradient import (
    OptimizationStats,
    PolicyGradientConfig,
    ReinforcePolicy,
    Transition,
    compute_gae,
)
from mage_knight_sdk.sim.rl.vec_env_runner import (
    RewardBreakdown,
    TERMINATION_CAUSE_ENGINE_FAILURE,
    termination_cause_name,
)


class RewardConfigTest(unittest.TestCase):
    def test_default_values(self) -> None:
        config = RewardConfig()
        self.assertAlmostEqual(config.fame_delta_scale, 1.0)
        self.assertAlmostEqual(config.step_penalty, 0.0)
        self.assertAlmostEqual(config.terminal_end_bonus, 0.0)
        self.assertAlmostEqual(config.terminal_fame_scale, 0.0)
        self.assertAlmostEqual(config.terminal_max_steps_penalty, -0.5)
        self.assertAlmostEqual(config.terminal_failure_penalty, -1.0)

    def test_custom_values(self) -> None:
        config = RewardConfig(
            fame_delta_scale=2.0,
            step_penalty=-0.01,
            terminal_end_bonus=5.0,
            terminal_fame_scale=0.5,
        )
        self.assertAlmostEqual(config.fame_delta_scale, 2.0)
        self.assertAlmostEqual(config.step_penalty, -0.01)
        self.assertAlmostEqual(config.terminal_end_bonus, 5.0)
        self.assertAlmostEqual(config.terminal_fame_scale, 0.5)


class EpisodeTrainingStatsDefaultsTest(unittest.TestCase):
    def test_defaults(self) -> None:
        stats = EpisodeTrainingStats(
            outcome="ended",
            steps=100,
            total_reward=5.0,
            optimization=OptimizationStats(
                loss=0.1, total_reward=5.0, mean_reward=0.05,
                entropy=0.5, action_count=100,
            ),
        )
        self.assertFalse(stats.scenario_triggered)
        self.assertAlmostEqual(stats.achievement_bonus, 0.0)


class GaeBootstrapTest(unittest.TestCase):
    def test_truncation_uses_post_step_bootstrap_value(self) -> None:
        transition = Transition(
            encoded_step=None,  # type: ignore[arg-type]
            action_index=0,
            log_prob=0.0,
            value=2.0,
            reward=1.0,
            bootstrap_value=7.0,
        )

        _, advantages, returns = compute_gae(
            [[transition]],
            gamma=0.9,
            gae_lambda=1.0,
            terminated=[False],
        )

        self.assertAlmostEqual(advantages[0], 1.0 + 0.9 * 7.0 - 2.0)
        self.assertAlmostEqual(returns[0], 1.0 + 0.9 * 7.0)


class CurriculumPhaseTerminationTest(unittest.TestCase):
    def test_curriculum_batch_is_capped_to_remaining_phase_episodes(self) -> None:
        episodes = [[index] for index in range(10)]
        metas = [f"meta-{index}" for index in range(10)]

        limited_episodes, limited_metas = _limit_curriculum_batch(
            episodes,
            metas,
            remaining=3,
        )

        self.assertEqual(limited_episodes, [[0], [1], [2]])
        self.assertEqual(limited_metas, ["meta-0", "meta-1", "meta-2"])

    def test_phase_can_override_global_early_termination(self) -> None:
        phase = CurriculumPhase(
            name="terminal_phase",
            scenario=TrainingScenario.full_game(),
            reward_config=RewardConfig(),
            episodes=10,
            early_term_fame_step=0,
        )

        self.assertEqual(phase.resolve_early_term_fame_step(global_default=60), 0)

    def test_phase_without_override_uses_global_default(self) -> None:
        phase = CurriculumPhase(
            name="warmup",
            scenario=TrainingScenario.full_game(),
            reward_config=RewardConfig(),
            episodes=10,
        )

        self.assertEqual(phase.resolve_early_term_fame_step(global_default=60), 60)

    def test_manifest_records_resolved_phase_reward_and_cutoff(self) -> None:
        phase = CurriculumPhase(
            name="terminal_phase",
            scenario=TrainingScenario.full_game(),
            reward_config=RewardConfig(terminal_fame_scale=0.5),
            episodes=10,
            early_term_fame_step=0,
        )
        schedule = CurriculumSchedule(phases=[phase])
        policy = ReinforcePolicy(PolicyGradientConfig(
            hidden_size=32,
            embedding_dim=8,
            d_model=32,
            device="cpu",
        ))
        args = argparse.Namespace(early_term_fame_step=60)

        with tempfile.TemporaryDirectory() as directory:
            _write_run_manifest(
                Path(directory),
                args,
                policy,
                RewardConfig(),
                curriculum_name="test",
                curriculum_schedule=schedule,
            )
            record = json.loads(
                (Path(directory) / "run_config.json").read_text(encoding="utf-8"),
            )

        recorded_phase = record["curriculum"]["phases"][0]
        self.assertEqual(recorded_phase["early_term_fame_step"], 0)
        self.assertEqual(
            recorded_phase["reward_config"]["terminal_fame_scale"], 0.5,
        )


class TerminationLoggingTest(unittest.TestCase):
    def test_engine_failure_code_has_stable_name(self) -> None:
        self.assertEqual(
            termination_cause_name(TERMINATION_CAUSE_ENGINE_FAILURE),
            "engine_failure",
        )

    def test_ndjson_records_explicit_termination_cause(self) -> None:
        stats = EpisodeTrainingStats(
            outcome="max_steps",
            steps=3,
            total_reward=-0.5,
            optimization=OptimizationStats(
                loss=0.0,
                total_reward=-0.5,
                mean_reward=-1.0 / 6.0,
                entropy=0.0,
                action_count=3,
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "training_log.ndjson"
            _append_metrics_log(
                path=path,
                episode=0,
                seed=42,
                stats=stats,
                termination_cause="early_zero_fame",
            )
            record = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(record["termination_cause"], "early_zero_fame")

    def test_ndjson_records_raw_and_normalized_terminal_fame(self) -> None:
        stats = EpisodeTrainingStats(
            outcome="ended",
            steps=3,
            total_reward=4.0,
            optimization=OptimizationStats(
                loss=0.0,
                total_reward=4.0,
                mean_reward=4.0 / 3.0,
                entropy=0.0,
                action_count=3,
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "training_log.ndjson"
            _append_metrics_log(
                path=path,
                episode=0,
                seed=42,
                stats=stats,
                reward_breakdown=RewardBreakdown(terminal_fame=4.0),
                normalized_terminal_fame=2.0,
            )
            record = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(record["reward_breakdown"]["terminal_fame"], 4.0)
        self.assertEqual(
            record["reward_breakdown"]["terminal_fame_normalized"], 2.0,
        )


class TensorBoardFameMetricTest(unittest.TestCase):
    def test_fame_metrics_use_explicit_fame_not_shaped_reward(self) -> None:
        class CaptureWriter:
            def __init__(self) -> None:
                self.scalars: dict[str, float] = {}

            def add_scalar(self, tag: str, value: float, _step: int) -> None:
                self.scalars[tag] = value

        capture = CaptureWriter()
        writer = _TBWriter.__new__(_TBWriter)
        writer._writer = capture
        writer._max_fame = 0.0
        writer._wrote_guide = True
        stats = EpisodeTrainingStats(
            outcome="ended",
            steps=10,
            total_reward=100.0,
            optimization=OptimizationStats(
                loss=0.0,
                total_reward=100.0,
                mean_reward=10.0,
                entropy=0.0,
                action_count=10,
            ),
        )

        writer.log_episode(1, stats, fame=0, game_score=12)

        self.assertEqual(capture.scalars["reward/fame"], 0)
        self.assertEqual(capture.scalars["episode/fame_binary"], 0.0)
        self.assertEqual(capture.scalars["episode/game_score"], 12)
