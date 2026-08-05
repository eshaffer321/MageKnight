#!/usr/bin/env python3
"""Fast end-to-end smoke test for terminal-reward PPO infrastructure."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import replace
import json
import math
from pathlib import Path
import tempfile

import torch

from mk_python import PyVecEnv
from mage_knight_sdk.cli.train_rl import (
    RunningMeanStd,
    _TBWriter,
    _append_metrics_log,
)
from mage_knight_sdk.sim.rl.curriculum import TrainingScenario
from mage_knight_sdk.sim.rl.native_rl_runner import EpisodeTrainingStats
from mage_knight_sdk.sim.rl.policy_gradient import (
    PolicyGradientConfig,
    ReinforcePolicy,
    Transition,
    compute_gae,
)
from mage_knight_sdk.sim.rl.rewards import RewardConfig
from mage_knight_sdk.sim.rl.vec_env_runner import (
    CollectionResult,
    collect_vecenv_rollout,
    vec_transition_to_transition,
)


def _collect(
    policy: ReinforcePolicy,
    reward_config: RewardConfig,
    *,
    num_envs: int,
    total_steps: int,
    base_seed: int,
    max_steps: int,
    early_term_fame_step: int,
    scenario: str | None = None,
) -> CollectionResult:
    env = PyVecEnv(
        num_envs=num_envs,
        base_seed=base_seed,
        max_steps=max_steps,
        early_term_fame_step=early_term_fame_step,
        scenario=scenario,
        combat_oracle=True,
    )
    return collect_vecenv_rollout(
        env,
        policy,
        reward_config,
        total_steps=total_steps,
    )


def _normalized_episodes(
    result: CollectionResult,
    normalizer: RunningMeanStd,
) -> list[list[Transition]]:
    episodes = [
        [vec_transition_to_transition(transition) for transition in vec_episode]
        for vec_episode in result.episodes
    ]
    raw_rewards = [transition.reward for episode in episodes for transition in episode]
    normalizer.update(raw_rewards)
    return [
        [
            replace(transition, reward=normalized_reward)
            for transition, normalized_reward in zip(
                episode,
                normalizer.normalize([transition.reward for transition in episode]),
            )
        ]
        for episode in episodes
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--num-envs", type=int, default=8)
    parser.add_argument("--episodes", type=int, default=256)
    args = parser.parse_args()

    if args.num_envs < 1 or args.episodes < args.num_envs:
        parser.error("episodes must be at least num-envs, and both must be positive")

    policy = ReinforcePolicy(PolicyGradientConfig(
        gamma=0.999,
        embedding_dim=16,
        hidden_size=128,
        d_model=64,
        device="cpu",
    ))
    combat_scenario = TrainingScenario.combat_drill(
        enemy_tokens=["diggers_1"],
        hand_override=["rage", "determination", "stamina"],
    ).to_rust_json()

    # The default and an explicit zero terminal-fame scale must be identical.
    control_steps = args.num_envs * 4
    torch.manual_seed(7)
    default_control = _collect(
        policy,
        RewardConfig(fame_delta_scale=1.0),
        num_envs=args.num_envs,
        total_steps=control_steps,
        base_seed=7_000,
        max_steps=20,
        early_term_fame_step=0,
        scenario=combat_scenario,
    )
    torch.manual_seed(7)
    explicit_control = _collect(
        policy,
        RewardConfig(fame_delta_scale=1.0, terminal_fame_scale=0.0),
        num_envs=args.num_envs,
        total_steps=control_steps,
        base_seed=7_000,
        max_steps=20,
        early_term_fame_step=0,
        scenario=combat_scenario,
    )
    control_actions_match = [m.action_indices for m in default_control.episode_metas] == [
        m.action_indices for m in explicit_control.episode_metas
    ]
    control_rewards_match = [
        [transition.reward for transition in episode]
        for episode in default_control.episodes
    ] == [
        [transition.reward for transition in episode]
        for episode in explicit_control.episodes
    ]
    if not control_actions_match or not control_rewards_match:
        raise AssertionError("terminal_fame_scale=0 changed the shaped-reward path")

    rounded_steps = math.ceil(args.episodes / args.num_envs) * args.num_envs
    treatment_rewards = RewardConfig(
        fame_delta_scale=1.0,
        wound_penalty=-0.5,
        terminal_fame_scale=0.5,
    )
    treatment = _collect(
        policy,
        treatment_rewards,
        num_envs=args.num_envs,
        total_steps=rounded_steps,
        base_seed=12_000,
        max_steps=20,
        early_term_fame_step=0,
        scenario=combat_scenario,
    )
    if len(treatment.episodes) < args.episodes:
        raise AssertionError("combat smoke did not complete the requested episodes")
    for episode, meta in zip(treatment.episodes, treatment.episode_metas):
        expected = treatment_rewards.terminal_fame_scale * meta.total_fame_delta
        if meta.termination_cause != "natural_end" or meta.truncated:
            raise AssertionError("cutoff-disabled combat drill did not end naturally")
        if not math.isclose(meta.reward_breakdown.terminal_fame, expected):
            raise AssertionError("natural terminal fame contribution is incorrect")
        if not math.isclose(meta.reward_breakdown.terminal_bonus, 0.0):
            raise AssertionError("terminal fame leaked into the separate end-bonus metric")

    normalizer = RunningMeanStd()
    normalized = _normalized_episodes(treatment, normalizer)
    transitions, advantages, returns = compute_gae(
        normalized,
        gamma=0.999,
        gae_lambda=0.995,
        terminated=[True] * len(normalized),
    )
    optimization = policy.optimize_ppo(
        transitions,
        advantages,
        returns,
        ppo_epochs=1,
        mini_batch_size=256,
    )

    # Hard limits receive their penalty and bootstrap from the real post-step state.
    truncated = _collect(
        policy,
        RewardConfig(
            fame_delta_scale=0.0,
            terminal_end_bonus=7.0,
            terminal_fame_scale=5.0,
            terminal_max_steps_penalty=-3.0,
        ),
        num_envs=args.num_envs,
        total_steps=args.num_envs,
        base_seed=20_000,
        max_steps=1,
        early_term_fame_step=0,
    )
    post_step_differences = 0
    for episode, meta in zip(truncated.episodes, truncated.episode_metas):
        last = episode[-1]
        if meta.termination_cause != "hard_limit" or not meta.truncated:
            raise AssertionError("hard limit was not classified correctly")
        if not math.isclose(last.reward, -3.0):
            raise AssertionError("hard-limit reward was contaminated by natural bonuses")
        if last.bootstrap_value is None:
            raise AssertionError("hard-limit transition lacks post-step bootstrap value")
        post_step_differences += int(not math.isclose(last.value, last.bootstrap_value))
        _, _, raw_returns = compute_gae(
            [[vec_transition_to_transition(last)]],
            gamma=0.999,
            gae_lambda=0.995,
            terminated=[False],
        )
        expected_return = last.reward + 0.999 * last.bootstrap_value
        if not math.isclose(raw_returns[0], expected_return, rel_tol=1e-6):
            raise AssertionError("GAE did not use the post-step bootstrap value")

    # Also prove terminal fame is withheld when a truncated game has positive fame.
    torch.manual_seed(1)
    positive_fame_policy = ReinforcePolicy(PolicyGradientConfig(
        embedding_dim=8,
        hidden_size=32,
        d_model=32,
        device="cpu",
    ))
    positive_fame_truncations = _collect(
        positive_fame_policy,
        RewardConfig(
            fame_delta_scale=0.0,
            terminal_end_bonus=7.0,
            terminal_fame_scale=5.0,
            terminal_max_steps_penalty=0.0,
        ),
        num_envs=8,
        total_steps=8 * 30,
        base_seed=40_000,
        max_steps=30,
        early_term_fame_step=0,
    )
    positive_fame_cases = [
        (episode, meta)
        for episode, meta in zip(
            positive_fame_truncations.episodes,
            positive_fame_truncations.episode_metas,
        )
        if meta.total_fame_delta > 0
    ]
    if not positive_fame_cases:
        raise AssertionError("positive-fame truncation fixture did not produce fame")
    for episode, meta in positive_fame_cases:
        if meta.termination_cause != "hard_limit":
            raise AssertionError("positive-fame fixture did not hit its hard limit")
        if not math.isclose(meta.reward_breakdown.terminal_fame, 0.0):
            raise AssertionError("truncation incorrectly received terminal fame")
        if not math.isclose(sum(t.reward for t in episode), 0.0):
            raise AssertionError("truncation incorrectly received a natural terminal bonus")

    early = _collect(
        policy,
        RewardConfig(
            fame_delta_scale=0.0,
            terminal_end_bonus=7.0,
            terminal_fame_scale=5.0,
            terminal_max_steps_penalty=-3.0,
        ),
        num_envs=args.num_envs,
        total_steps=args.num_envs,
        base_seed=30_000,
        max_steps=10,
        early_term_fame_step=1,
    )
    if any(meta.termination_cause != "early_zero_fame" for meta in early.episode_metas):
        raise AssertionError("early cutoff was not classified distinctly")
    if any(not math.isclose(episode[-1].reward, 0.0) for episode in early.episodes):
        raise AssertionError("early cutoff incorrectly received a hard-limit penalty")

    # Exercise the actual NDJSON/TensorBoard writers and compare their fame units.
    first_meta = treatment.episode_metas[0]
    normalized_terminal = normalizer.normalize_component(
        first_meta.reward_breakdown.terminal_fame,
    )
    stats = EpisodeTrainingStats(
        outcome="ended",
        steps=len(treatment.episodes[0]),
        total_reward=sum(t.reward for t in treatment.episodes[0]),
        optimization=optimization,
        scenario_triggered=first_meta.scenario_end_triggered,
    )
    with tempfile.TemporaryDirectory() as directory:
        directory_path = Path(directory)
        ndjson_path = directory_path / "training_log.ndjson"
        _append_metrics_log(
            path=ndjson_path,
            episode=0,
            seed=first_meta.seed,
            stats=stats,
            fame=first_meta.total_fame_delta,
            reward_breakdown=first_meta.reward_breakdown,
            game_score=first_meta.game_score,
            termination_cause=first_meta.termination_cause,
            normalized_terminal_fame=normalized_terminal,
        )
        tb = _TBWriter(directory_path / "tensorboard")
        tb.log_episode(
            1,
            stats,
            fame=first_meta.total_fame_delta,
            game_score=first_meta.game_score,
            reward_breakdown=first_meta.reward_breakdown,
            normalized_terminal_fame=normalized_terminal,
        )
        tb.close()

        from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

        ndjson_record = json.loads(ndjson_path.read_text(encoding="utf-8"))
        events = EventAccumulator(str(directory_path / "tensorboard"))
        events.Reload()
        tb_fame = events.Scalars("reward/fame")[-1].value
        tb_game_score = events.Scalars("episode/game_score")[-1].value
        if tb_fame != ndjson_record["fame"]:
            raise AssertionError("TensorBoard fame does not match NDJSON fame")
        if tb_game_score != ndjson_record["game_score"]:
            raise AssertionError("TensorBoard game score does not match NDJSON")

        checkpoint_path = directory_path / "policy.pt"
        policy.save_checkpoint(
            checkpoint_path,
            metadata={"episode": len(treatment.episodes)},
            reward_normalizer_state=normalizer.state_dict(),
        )
        _, checkpoint_meta = ReinforcePolicy.load_checkpoint(
            checkpoint_path,
            device_override="cpu",
        )
        if checkpoint_meta["reward_normalizer"] != normalizer.state_dict():
            raise AssertionError("reward normalizer did not survive checkpoint round trip")

    summary = {
        "control_episodes": len(default_control.episodes),
        "control_scale_zero_identical": True,
        "treatment_episodes": len(treatment.episodes),
        "treatment_causes": dict(Counter(
            meta.termination_cause for meta in treatment.episode_metas
        )),
        "terminal_fame_raw": first_meta.reward_breakdown.terminal_fame,
        "terminal_fame_normalized": normalized_terminal,
        "hard_limit_episodes": len(truncated.episodes),
        "hard_limit_post_value_differs_from_pre": post_step_differences,
        "positive_fame_hard_limits_without_terminal_fame": len(positive_fame_cases),
        "early_zero_fame_episodes": len(early.episodes),
        "ppo_action_count": optimization.action_count,
        "ppo_loss": optimization.loss,
        "reward_normalizer": normalizer.state_dict(),
        "tensorboard_matches_ndjson": True,
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
