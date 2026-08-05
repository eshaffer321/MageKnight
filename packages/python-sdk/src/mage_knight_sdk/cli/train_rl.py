#!/usr/bin/env python3
"""Train a policy-gradient agent against the native Rust Mage Knight engine."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess

import numpy as np
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
import sys
from typing import Any

from mage_knight_sdk.sim.hero_selection import resolve_hero
from mage_knight_sdk.sim.rl.goal_tracker import DEFAULT_MAX_GOAL_STEPS


class RunningMeanStd:
    """Track running mean/std using Welford's online algorithm."""

    def __init__(self) -> None:
        self.mean: float = 0.0
        self.var: float = 1.0
        self.count: int = 0

    def update(self, batch: list[float]) -> None:
        for x in batch:
            self.count += 1
            delta = x - self.mean
            self.mean += delta / self.count
            delta2 = x - self.mean
            # Use Welford's M2 update; var = M2 / count
            self.var += (delta * delta2 - self.var) / self.count

    def normalize(self, values: list[float]) -> list[float]:
        std = max(self.var ** 0.5, 1e-8)
        return [(v - self.mean) / std for v in values]

    def normalize_component(self, value: float) -> float:
        """Scale one additive reward component without applying the total-reward mean."""
        std = max(self.var ** 0.5, 1e-8)
        return value / std

    def state_dict(self) -> dict[str, float | int]:
        return {"mean": self.mean, "var": self.var, "count": self.count}

    def load_state_dict(self, state: dict[str, Any]) -> None:
        self.mean = float(state["mean"])
        self.var = float(state["var"])
        self.count = int(state["count"])


_METRIC_DESCRIPTIONS: dict[str, str] = {
    "reward/total": "Total shaped reward for the episode. Includes fame, step penalty, end bonus, and victory bonuses.",
    "reward/fame": "Actual fame earned this episode, independent of shaped or terminal reward terms.",
    "reward/fame_max": "Running max fame across all episodes. Tracks the best game so far.",
    "episode/steps": "Number of game steps (actions taken) in the episode. Longer = surviving more turns.",
    "episode/fame_binary": "1.0 if actual fame is positive, else 0.0.",
    "optimization/loss": "PPO clipped surrogate policy loss. Negative = policy improving. Should hover near zero, not diverge.",
    "optimization/entropy": "Action distribution entropy. High = exploring, low = exploiting. Should gradually decline, not collapse to zero.",
    "optimization/critic_loss": "MSE between value head predictions and actual returns. Lower = better state value estimates.",
    "optimization/action_count": "Total actions across all games in the sync batch. More = longer games = more training signal.",
    "episode/scenario_ended": "1.0 if the game ended naturally (scenario complete), 0.0 if hit max steps or error. Tracks completion rate.",
}


class _TBWriter:
    """Thin wrapper around TensorBoard SummaryWriter. No-op if tensorboard is unavailable."""

    def __init__(self, log_dir: Path | None, initial_max_fame: float = 0.0) -> None:
        self._writer = None
        self._max_fame: float = initial_max_fame
        self._wrote_guide = False
        if log_dir is None:
            return
        try:
            from torch.utils.tensorboard import SummaryWriter
            self._writer = SummaryWriter(log_dir=str(log_dir))
        except ImportError:
            print("tensorboard not installed — skipping TensorBoard logging", file=sys.stderr)

    def _write_metric_guide(self) -> None:
        """Write a markdown guide to the TEXT tab (once per run)."""
        if self._wrote_guide or self._writer is None:
            return
        self._wrote_guide = True
        rows = "\n".join(
            f"| `{tag}` | {desc} |" for tag, desc in _METRIC_DESCRIPTIONS.items()
        )
        md = f"| Metric | Description |\n|--------|-------------|\n{rows}"
        self._writer.add_text("metric_guide", md, 0)

    def log_episode(
        self,
        episode: int,
        stats: Any,
        fame: float,
        game_score: int | None = None,
        reward_breakdown: Any = None,
        normalized_terminal_fame: float = 0.0,
    ) -> None:
        if self._writer is None:
            return
        self._write_metric_guide()
        self._max_fame = max(self._max_fame, fame)
        self._writer.add_scalar("reward/total", stats.total_reward, episode)
        self._writer.add_scalar("reward/fame", fame, episode)
        self._writer.add_scalar("reward/fame_max", self._max_fame, episode)
        self._writer.add_scalar("episode/steps", stats.steps, episode)
        self._writer.add_scalar("episode/fame_binary", 1.0 if fame > 0 else 0.0, episode)
        if game_score is not None:
            self._writer.add_scalar("episode/game_score", game_score, episode)
        self._writer.add_scalar("episode/scenario_ended", 1.0 if getattr(stats, "scenario_triggered", False) else 0.0, episode)
        self._writer.add_scalar("optimization/loss", stats.optimization.loss, episode)
        self._writer.add_scalar("optimization/entropy", stats.optimization.entropy, episode)
        self._writer.add_scalar("optimization/critic_loss", stats.optimization.critic_loss, episode)
        self._writer.add_scalar("optimization/action_count", stats.optimization.action_count, episode)
        if hasattr(stats.optimization, "effective_entropy_coef") and stats.optimization.effective_entropy_coef > 0:
            self._writer.add_scalar("optimization/effective_entropy_coef", stats.optimization.effective_entropy_coef, episode)
        if reward_breakdown is not None:
            self._writer.add_scalar("reward_breakdown/fame", reward_breakdown.fame, episode)
            self._writer.add_scalar("reward_breakdown/wound_penalty", reward_breakdown.wound_penalty, episode)
            self._writer.add_scalar("reward_breakdown/cards_remaining", reward_breakdown.cards_remaining_bonus, episode)
            self._writer.add_scalar("reward_breakdown/new_hex", reward_breakdown.new_hex_bonus, episode)
            self._writer.add_scalar("reward_breakdown/step_penalty", reward_breakdown.step_penalty, episode)
            self._writer.add_scalar("reward_breakdown/terminal", reward_breakdown.terminal_bonus, episode)
            self._writer.add_scalar("reward_breakdown/terminal_fame_raw", reward_breakdown.terminal_fame, episode)
            self._writer.add_scalar("reward_breakdown/terminal_fame_normalized", normalized_terminal_fame, episode)
            self._writer.add_scalar("reward_breakdown/scenario_trigger", reward_breakdown.scenario_trigger_bonus, episode)
            self._writer.add_scalar("reward_breakdown/wasted_move", reward_breakdown.wasted_move_penalty, episode)
            self._writer.add_scalar("reward_breakdown/backtrack", reward_breakdown.backtrack_penalty, episode)
            self._writer.add_scalar("reward_breakdown/wound_shaping", reward_breakdown.wound_shaping, episode)
            self._writer.add_scalar("reward_breakdown/achievement", reward_breakdown.achievement, episode)
            self._writer.add_scalar("reward_breakdown/tile_explore", reward_breakdown.tile_explore, episode)

    def log_explained_variance(self, episode: int, returns: list[float], values: list[float]) -> None:
        if self._writer is None or not returns:
            return
        import numpy as np
        ret = np.array(returns)
        val = np.array(values)
        var_ret = np.var(ret)
        if var_ret < 1e-8:
            ev = 0.0
        else:
            ev = 1.0 - np.var(ret - val) / var_ret
        self._writer.add_scalar("optimization/explained_variance", float(ev), episode)

    def log_achievement_score(self, episode: int, total_achievement_delta: int) -> None:
        if self._writer is None:
            return
        self._writer.add_scalar("episode/achievement_score", total_achievement_delta, episode)

    def log_game_score(self, episode: int, game_score: int) -> None:
        if self._writer is None:
            return
        self._writer.add_scalar("episode/game_score", game_score, episode)

    def log_achievement_breakdown(self, episode: int, breakdown: dict[str, int]) -> None:
        if self._writer is None:
            return
        for category, points in breakdown.items():
            self._writer.add_scalar(f"achievements/{category}", points, episode)

    def log_wound_metrics(self, episode: int, total_wounds: float, turns_resting: float, wounds_per_combat: float) -> None:
        if self._writer is None:
            return
        self._writer.add_scalar("wounds/total_per_episode", total_wounds, episode)
        self._writer.add_scalar("wounds/turns_resting_per_episode", turns_resting, episode)
        self._writer.add_scalar("wounds/per_combat", wounds_per_combat, episode)

    def close(self) -> None:
        if self._writer is not None:
            self._writer.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a policy-gradient agent using the native Rust engine")
    parser.add_argument("--episodes", type=int, default=100, help="Number of episodes to train")
    parser.add_argument("--seed", type=int, default=1, help="Base seed for game creation")
    parser.add_argument("--fixed-seed", action="store_true", help="Use the same seed every episode (for memorization tests)")
    parser.add_argument("--max-steps", type=int, default=10000, help="Max steps per episode")
    parser.add_argument("--hero", default="random", help="Hero to play, or 'random' for seeded rotation (default: random)")

    parser.add_argument("--learning-rate", type=float, default=3e-4, help="Adam learning rate")
    parser.add_argument("--gamma", type=float, default=0.99, help="Discount factor")
    parser.add_argument("--entropy-coef", type=float, default=0.03, help="Entropy regularization coefficient")
    parser.add_argument("--critic-coef", type=float, default=0.5, help="Critic (value) loss coefficient")
    parser.add_argument("--hidden-size", type=int, default=128, help="Hidden size for action scoring network")
    parser.add_argument("--device", default="auto", help="Torch device (auto, cpu, cuda, mps)")
    parser.add_argument("--embedding-dim", type=int, default=16, help="Embedding dimension for entity IDs (default: 16)")
    parser.add_argument("--num-hidden-layers", type=int, default=1, help="Number of hidden layers in state/action encoders (default: 1)")
    parser.add_argument("--d-model", type=int, default=64, help="Attention dimension for entity pool encoders (default: 64)")

    parser.add_argument("--fame-delta-scale", type=float, default=1.0, help="Reward multiplier for fame deltas (1.0 = match game scoring)")
    parser.add_argument("--step-penalty", type=float, default=0.0, help="Per-step reward penalty")
    parser.add_argument("--terminal-end-bonus", type=float, default=0.0, help="Bonus when game ends normally")
    parser.add_argument("--terminal-fame-scale", type=float, default=0.0, help="Final-fame multiplier applied only when a game ends naturally")
    parser.add_argument("--terminal-max-steps-penalty", type=float, default=-0.5, help="Penalty when episode hits max steps")
    parser.add_argument("--terminal-failure-penalty", type=float, default=-1.0, help="Penalty for engine failures")
    parser.add_argument("--new-hex-bonus", type=float, default=0.0, help="One-time bonus for each new hex visited")
    parser.add_argument("--wound-penalty", type=float, default=0.0, help="Penalty per wound gained (negative = penalty, e.g. -0.5)")
    parser.add_argument("--cards-remaining-bonus", type=float, default=0.0, help="Terminal bonus per non-wound card remaining in hand")
    parser.add_argument("--wasted-move-penalty", type=float, default=0.0, help="Quadratic penalty per wasted move point at end of turn (e.g. -0.02)")
    parser.add_argument("--backtrack-penalty", type=float, default=0.0, help="Penalty for moving to a hex already visited this turn (e.g. -0.3)")
    parser.add_argument("--wound-shaping-k", type=float, default=0.0, help="Potential-based wound shaping coefficient (e.g. 10.0). Applies continuous penalty proportional to (wounds/deck_size)^2")
    parser.add_argument("--achievement-reward-scale", type=float, default=0.0, help="Reward scale for achievement deltas (spell/AA/artifact/crystal/unit/site). 0 = disabled, 0.5 = recommended.")
    parser.add_argument("--tile-explore-bonus", type=float, default=0.0, help="Progressive tile exploration bonus: Nth tile gives N * this value. 0.0 = disabled (explore fame already in fame_delta).")

    parser.add_argument("--checkpoint-dir", default=None, help="Run directory for checkpoints + logs (default: auto-generated under training/runs/)")
    parser.add_argument("--checkpoint-every", type=int, default=25, help="Save checkpoint every N episodes")
    parser.add_argument("--no-final-checkpoint", action="store_true", help="Do not save a final checkpoint at the end")
    checkpoint_source = parser.add_mutually_exclusive_group()
    checkpoint_source.add_argument("--resume", metavar="PATH", help="Resume from checkpoint (load policy, optimizer, and normalizers); run --episodes more from here")
    checkpoint_source.add_argument("--warm-start", metavar="PATH", help="Start a new run from checkpoint weights with fresh optimizer and normalizers")

    # PPO flags
    parser.add_argument("--ppo", action="store_true", help="Use PPO instead of REINFORCE")
    parser.add_argument("--batch-episodes", type=int, default=64, help="Episodes per PPO update batch (default: 64)")
    parser.add_argument("--ppo-epochs", type=int, default=4, help="PPO optimization epochs per batch (default: 4)")
    parser.add_argument("--clip-epsilon", type=float, default=0.2, help="PPO clip ratio (default: 0.2)")
    parser.add_argument("--gae-lambda", type=float, default=0.95, help="GAE lambda (default: 0.95)")
    parser.add_argument("--max-grad-norm", type=float, default=0.5, help="Gradient clipping max norm (default: 0.5)")
    parser.add_argument("--mini-batch-size", type=int, default=256, help="PPO mini-batch size (default: 256)")
    parser.add_argument("--target-kl", type=float, default=None, help="KL divergence target for PPO early stopping (default: None = disabled, recommended: 0.02)")
    parser.add_argument("--lr-decay", action="store_true", help="Linearly decay learning rate to 0 over training")
    parser.add_argument("--entropy-floor", type=float, default=0.0, help="Minimum entropy threshold; entropy_coef is boosted when entropy drops below this (default: 0 = disabled, recommended: 0.6)")
    parser.add_argument("--max-critic-loss", type=float, default=0.0, help="Cap per-sample critic loss to prevent gradient spikes (default: 0 = disabled, recommended: 2.0)")

    # Curriculum learning
    curriculum_source = parser.add_mutually_exclusive_group()
    curriculum_source.add_argument("--curriculum", default=None, help="Built-in curriculum schedule name (e.g. 'default'). Overrides --episodes, reward args, and --max-steps with per-phase values.")
    curriculum_source.add_argument("--curriculum-plan", default=None, help="Evaluation-derived adaptive curriculum JSON plan")

    # Combat oracle
    parser.add_argument("--combat-oracle", action="store_true", default=True, help="Auto-resolve combat via exhaustive search oracle (agent skips combat actions)")
    parser.add_argument("--no-combat-oracle", dest="combat_oracle", action="store_false", help="Disable combat oracle — agent handles combat actions")

    # Commerce oracle
    parser.add_argument("--commerce-oracle", action="store_true", default=True, help="Auto-resolve commerce interactions via search oracle (agent skips influence/purchase actions)")
    parser.add_argument("--no-commerce-oracle", dest="commerce_oracle", action="store_false", help="Disable commerce oracle")

    # Early termination
    parser.add_argument("--early-term-fame-step", type=int, default=60, help="Fallback zero-fame cutoff for curriculum phases without their own setting (0 to disable)")

    # Hierarchical RL
    parser.add_argument("--hrl", action="store_true", help="Enable Hierarchical RL (CEO + Worker dual-policy training)")
    parser.add_argument("--max-goal-steps", type=int, default=DEFAULT_MAX_GOAL_STEPS, help=f"Max steps before a goal times out (default: {DEFAULT_MAX_GOAL_STEPS})")

    args = parser.parse_args()
    if args.episodes < 1:
        print("--episodes must be >= 1", file=sys.stderr)
        return 2

    components = _load_rl_components()
    if components is None:
        return 2

    PolicyGradientConfig = components["PolicyGradientConfig"]
    ReinforcePolicy = components["ReinforcePolicy"]
    RewardConfig = components["RewardConfig"]

    resume_episode_offset = 0
    resume_reward_normalizer_state: dict[str, Any] | None = None
    if args.resume:
        policy, resume_meta = ReinforcePolicy.load_checkpoint(
            args.resume,
            device_override=args.device,
        )
        resume_episode_offset = resume_meta.get("episode", 0)
        saved_reward_normalizer = resume_meta.get("reward_normalizer")
        if isinstance(saved_reward_normalizer, dict):
            resume_reward_normalizer_state = saved_reward_normalizer
        print(f"Resumed from {args.resume} (episode {resume_episode_offset})")
    elif args.warm_start:
        policy, warm_start_meta = ReinforcePolicy.load_checkpoint(
            args.warm_start,
            device_override=args.device,
            restore_optimizer=False,
            restore_value_normalizer=False,
            config_overrides={
                "gamma": args.gamma,
                "learning_rate": args.learning_rate,
                "entropy_coefficient": args.entropy_coef,
                "critic_coefficient": args.critic_coef,
            },
        )
        source_episode = warm_start_meta.get("episode", "unknown")
        print(
            f"Warm-started weights from {args.warm_start} "
            f"(source episode {source_episode}; fresh optimizer and normalizers)",
        )
    else:
        policy_config = PolicyGradientConfig(
            gamma=args.gamma,
            learning_rate=args.learning_rate,
            entropy_coefficient=args.entropy_coef,
            critic_coefficient=args.critic_coef,
            hidden_size=args.hidden_size,
            device=args.device,
            embedding_dim=args.embedding_dim,
            num_hidden_layers=args.num_hidden_layers,
            d_model=args.d_model,
        )
        policy = ReinforcePolicy(policy_config)

    reward_config = RewardConfig(
        fame_delta_scale=args.fame_delta_scale,
        step_penalty=args.step_penalty,
        terminal_end_bonus=args.terminal_end_bonus,
        terminal_fame_scale=args.terminal_fame_scale,
        terminal_max_steps_penalty=args.terminal_max_steps_penalty,
        terminal_failure_penalty=args.terminal_failure_penalty,
        new_hex_bonus=args.new_hex_bonus,
        wound_penalty=args.wound_penalty,
        cards_remaining_bonus=args.cards_remaining_bonus,
        wasted_move_penalty=args.wasted_move_penalty,
        backtrack_penalty=args.backtrack_penalty,
        wound_shaping_k=args.wound_shaping_k,
        achievement_reward_scale=args.achievement_reward_scale,
        tile_explore_bonus=args.tile_explore_bonus,
    )

    run_dir = _resolve_run_dir(args.checkpoint_dir, args.resume)
    run_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_dir = run_dir / "checkpoints"
    checkpoint_dir.mkdir(exist_ok=True)
    metrics_path = run_dir / "training_log.ndjson"

    algo = "PPO" if args.ppo else "REINFORCE"
    hero_display = args.hero if args.hero.lower() != "random" else "random (seeded rotation)"
    seed_display = f"{args.seed} (FIXED)" if args.fixed_seed else str(args.seed)
    print(f"Training episodes={args.episodes} seed={seed_display} max_steps={args.max_steps} algorithm={algo} hero={hero_display}")
    print(
        "Rewards: "
        f"fame_delta_scale={args.fame_delta_scale} "
        f"step_penalty={args.step_penalty} "
        f"end_bonus={args.terminal_end_bonus} "
        f"terminal_fame_scale={args.terminal_fame_scale} "
        f"max_steps_penalty={args.terminal_max_steps_penalty} "
        f"failure_penalty={args.terminal_failure_penalty}"
    )

    if args.ppo:
        print(f"PPO: batch_episodes={args.batch_episodes} ppo_epochs={args.ppo_epochs} clip={args.clip_epsilon} gae_lambda={args.gae_lambda}")

    resolved_schedule: Any | None = None
    curriculum_label: str | None = None
    if args.curriculum or args.curriculum_plan:
        from dataclasses import replace

        from mage_knight_sdk.sim.rl.curriculum import (
            CURRICULA,
            load_adaptive_curriculum_plan,
        )
        if args.curriculum_plan:
            try:
                schedule = load_adaptive_curriculum_plan(args.curriculum_plan)
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                print(f"Invalid curriculum plan: {error}", file=sys.stderr)
                return 2
            if args.hero.lower() != "random" and args.hero.lower() != schedule.hero:
                print(
                    f"--hero {args.hero!r} conflicts with adaptive plan hero "
                    f"{schedule.hero!r}",
                    file=sys.stderr,
                )
                return 2
            requirements = schedule.source.get("requirements", {})
            if "combat_oracle" in requirements:
                args.combat_oracle = bool(requirements["combat_oracle"])
            if "commerce_oracle" in requirements:
                args.commerce_oracle = bool(requirements["commerce_oracle"])
            print(
                "  Adaptive plan engine requirements: "
                f"combat_oracle={args.combat_oracle} "
                f"commerce_oracle={args.commerce_oracle}"
            )
            curriculum_label = f"adaptive:{Path(args.curriculum_plan).resolve()}"
        else:
            schedule_factory = CURRICULA.get(args.curriculum)
            if schedule_factory is None:
                print(f"Unknown curriculum: {args.curriculum!r}. Available: {', '.join(CURRICULA)}", file=sys.stderr)
                return 2
            schedule = schedule_factory()
            curriculum_label = args.curriculum

        # CLI reward args override curriculum phase defaults.
        # Map CLI arg names to RewardConfig field names.
        _CLI_REWARD_OVERRIDES = {
            "fame_delta_scale": "fame_delta_scale",
            "step_penalty": "step_penalty",
            "terminal_end_bonus": "terminal_end_bonus",
            "terminal_fame_scale": "terminal_fame_scale",
            "terminal_max_steps_penalty": "terminal_max_steps_penalty",
            "terminal_failure_penalty": "terminal_failure_penalty",
            "new_hex_bonus": "new_hex_bonus",
            "wound_penalty": "wound_penalty",
            "cards_remaining_bonus": "cards_remaining_bonus",
            "wasted_move_penalty": "wasted_move_penalty",
            "backtrack_penalty": "backtrack_penalty",
            "wound_shaping_k": "wound_shaping_k",
            "achievement_reward_scale": "achievement_reward_scale",
            "tile_explore_bonus": "tile_explore_bonus",
        }
        # Detect which CLI args were explicitly set by comparing to parser defaults
        explicit_overrides = {}
        for cli_name, field_name in _CLI_REWARD_OVERRIDES.items():
            default_val = parser.get_default(cli_name)
            actual_val = getattr(args, cli_name)
            if actual_val != default_val:
                explicit_overrides[field_name] = actual_val
        if explicit_overrides:
            print(f"  CLI reward overrides: {explicit_overrides}")
            schedule = replace(schedule, phases=[
                replace(phase, reward_config=replace(phase.reward_config, **explicit_overrides))
                for phase in schedule.phases
            ])

        total_episodes = sum(p.episodes for p in schedule.phases)
        phase_names = [p.name for p in schedule.phases]
        print(f"Curriculum: {curriculum_label} ({len(schedule.phases)} phases, {total_episodes} total episodes)")
        print(f"  Phases: {' → '.join(phase_names)}")
        resolved_schedule = schedule

    if not args.resume:
        _write_run_manifest(
            run_dir,
            args,
            policy,
            reward_config,
            curriculum_name=curriculum_label,
            curriculum_schedule=resolved_schedule,
        )

    # Recover running max fame from existing NDJSON so fame_max doesn't reset on resume.
    initial_max_fame = 0.0
    if args.resume and metrics_path.exists():
        try:
            with open(metrics_path, encoding="utf-8") as mf:
                for line in mf:
                    rec = json.loads(line)
                    initial_max_fame = max(initial_max_fame, rec.get("fame", 0.0))
            initial_max_fame = max(0.0, initial_max_fame)
        except Exception:
            pass  # best-effort

    tb = _TBWriter(run_dir / "tensorboard", initial_max_fame=initial_max_fame)
    print(f"TensorBoard: tensorboard --logdir {run_dir / 'tensorboard'}")

    print("-" * 88)

    try:
        if args.hrl:
            return _train_hrl(
                args, policy, checkpoint_dir, metrics_path, tb,
                resume_episode_offset, resume_reward_normalizer_state,
                resolved_schedule,
            )
        if args.curriculum or args.curriculum_plan:
            return _train_curriculum(
                args, policy, checkpoint_dir, metrics_path, tb,
                resume_episode_offset, resume_reward_normalizer_state,
                resolved_schedule,
            )
        if args.ppo:
            return _train_ppo_native(
                args, policy, reward_config, checkpoint_dir, metrics_path, tb,
                resume_episode_offset, resume_reward_normalizer_state,
            )
        return _train_native_sequential(args, policy, reward_config, checkpoint_dir, metrics_path, tb, resume_episode_offset)
    finally:
        tb.close()


# ---------------------------------------------------------------------------
# REINFORCE native training loop
# ---------------------------------------------------------------------------


def _train_native_sequential(
    args: argparse.Namespace,
    policy: Any,
    reward_config: Any,
    checkpoint_dir: Path,
    metrics_path: Path,
    tb: _TBWriter | None = None,
    resume_episode_offset: int = 0,
) -> int:
    """Native Rust engine training loop — no WebSocket server needed."""
    from mage_knight_sdk.sim.rl.native_rl_runner import run_native_rl_game

    for episode in range(args.episodes):
        global_ep = resume_episode_offset + episode + 1
        seed = args.seed if args.fixed_seed else args.seed + resume_episode_offset + episode
        hero = resolve_hero(args.hero, seed)

        result, stats = run_native_rl_game(
            seed=seed,
            hero=hero,
            policy=policy,
            reward_config=reward_config,
            max_steps=args.max_steps,
        )

        if stats is None:
            print(f"ep={global_ep:04d} seed={seed} hero={hero} ERROR: {result.reason}", file=sys.stderr)
            continue

        _append_metrics_log(
            path=metrics_path,
            episode=global_ep - 1,
            seed=seed,
            stats=stats,
            fame=result.fame,
        )

        print(
            f"ep={global_ep:04d} steps={result.steps:<4} "
            f"R={stats.total_reward:>7.1f}  fame={result.fame:<3} "
            f"ent={stats.optimization.entropy:.2f}"
        )

        if tb is not None:
            tb.log_episode(global_ep, stats, fame=result.fame)

        if args.checkpoint_every > 0 and global_ep % args.checkpoint_every == 0:
            checkpoint_path = checkpoint_dir / f"policy_ep_{global_ep:06d}.pt"
            policy.save_checkpoint(
                checkpoint_path,
                metadata={
                    "episode": global_ep,
                    "seed": seed,
                    "timestamp": datetime.now(UTC).isoformat(),
                },
            )

    if not args.no_final_checkpoint:
        final_ep = resume_episode_offset + args.episodes
        final_path = checkpoint_dir / "policy_final.pt"
        policy.save_checkpoint(
            final_path,
            metadata={
                "episode": final_ep,
                "seed": args.seed + resume_episode_offset + args.episodes - 1,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )
        print(f"Final checkpoint: {final_path}")

    print(f"Metrics log: {metrics_path}")
    return 0


# ---------------------------------------------------------------------------
# PPO native training loop
# ---------------------------------------------------------------------------


def _train_ppo_native(
    args: argparse.Namespace,
    policy: Any,
    reward_config: Any,
    checkpoint_dir: Path,
    metrics_path: Path,
    tb: _TBWriter | None = None,
    resume_episode_offset: int = 0,
    resume_reward_normalizer_state: dict[str, Any] | None = None,
) -> int:
    """Native PPO training: collect batch of episodes, compute GAE, optimize, repeat."""
    from mage_knight_sdk.sim.rl.native_rl_runner import EpisodeTrainingStats, run_native_rl_game_ppo
    from mage_knight_sdk.sim.rl.policy_gradient import OptimizationStats, Transition, compute_gae

    episode_num = 0
    reward_normalizer = RunningMeanStd()
    if resume_reward_normalizer_state is not None:
        reward_normalizer.load_state_dict(resume_reward_normalizer_state)

    while episode_num < args.episodes:
        batch_size = min(args.batch_episodes, args.episodes - episode_num)

        # Collect batch_size episodes
        episodes_data: list[list[Any]] = []
        batch_terminated: list[bool] = []
        batch_stats: list[EpisodeTrainingStats] = []
        batch_fames: list[int] = []

        for i in range(batch_size):
            seed = args.seed if args.fixed_seed else args.seed + resume_episode_offset + episode_num + i
            hero = resolve_hero(args.hero, seed)

            result, transitions, terminated = run_native_rl_game_ppo(
                seed=seed,
                hero=hero,
                policy=policy,
                reward_config=reward_config,
                max_steps=args.max_steps,
            )

            if result.outcome == "engine_error" or not transitions:
                print(f"  seed={seed} hero={hero} ERROR: {result.reason}", file=sys.stderr)
                # Still count toward episode_num to avoid infinite loop
                batch_stats.append(EpisodeTrainingStats(
                    outcome=result.outcome,
                    steps=result.steps,
                    total_reward=0.0,
                    optimization=OptimizationStats(
                        loss=0.0, total_reward=0.0, mean_reward=0.0,
                        entropy=0.0, action_count=0,
                    ),
                    scenario_triggered=result.scenario_end_triggered,
                ))
                batch_fames.append(result.fame)
                continue

            episode_total_reward = sum(t.reward for t in transitions)
            episodes_data.append(transitions)
            batch_terminated.append(terminated)
            batch_stats.append(EpisodeTrainingStats(
                outcome=result.outcome,
                steps=result.steps,
                total_reward=episode_total_reward,
                optimization=OptimizationStats(
                    loss=0.0, total_reward=episode_total_reward,
                    mean_reward=episode_total_reward / max(len(transitions), 1),
                    entropy=0.0, action_count=len(transitions),
                ),
                scenario_triggered=result.scenario_end_triggered,
            ))
            batch_fames.append(result.fame)

        # PPO optimization
        if episodes_data:
            # Normalize rewards for GAE computation (keep raw rewards for logging)
            all_raw_rewards = [t.reward for ep in episodes_data for t in ep]
            reward_normalizer.update(all_raw_rewards)
            normalized_episodes: list[list[Any]] = []
            for ep in episodes_data:
                raw_rewards = [t.reward for t in ep]
                norm_rewards = reward_normalizer.normalize(raw_rewards)
                normalized_episodes.append([
                    Transition(
                        encoded_step=t.encoded_step,
                        action_index=t.action_index,
                        log_prob=t.log_prob,
                        value=t.value,
                        reward=nr,
                        bootstrap_value=t.bootstrap_value,
                    )
                    for t, nr in zip(ep, norm_rewards)
                ])

            transitions_flat, advantages, returns = compute_gae(
                normalized_episodes, args.gamma, args.gae_lambda,
                terminated=batch_terminated,
            )

            # Linear LR decay
            if getattr(args, "lr_decay", False):
                progress_remaining = 1.0 - (resume_episode_offset + episode_num) / (resume_episode_offset + args.episodes)
                policy.update_learning_rate(progress_remaining)

            opt_stats = policy.optimize_ppo(
                transitions_flat, advantages, returns,
                clip_epsilon=args.clip_epsilon,
                ppo_epochs=args.ppo_epochs,
                max_grad_norm=args.max_grad_norm,
                mini_batch_size=args.mini_batch_size,
                target_kl=getattr(args, "target_kl", None),
                entropy_floor=getattr(args, "entropy_floor", 0.0),
                max_critic_loss=getattr(args, "max_critic_loss", 0.0),
            )
        else:
            opt_stats = OptimizationStats(
                loss=0.0, total_reward=0.0, mean_reward=0.0,
                entropy=0.0, action_count=0,
            )

        # Log each episode in the batch
        for i, stats in enumerate(batch_stats):
            global_ep = resume_episode_offset + episode_num + i + 1
            seed = args.seed if args.fixed_seed else args.seed + resume_episode_offset + episode_num + i

            logged_stats = _with_opt(stats, opt_stats)
            _append_metrics_log(
                path=metrics_path, episode=global_ep - 1, seed=seed,
                stats=logged_stats, fame=batch_fames[i],
            )

            print(
                f"ep={global_ep:04d} steps={stats.steps:<4} "
                f"R={stats.total_reward:>7.1f}  fame={batch_fames[i]:<3} "
                f"ent={opt_stats.entropy:.2f}"
            )

            if tb is not None:
                tb.log_episode(global_ep, logged_stats, fame=batch_fames[i])

        # Log explained variance for the batch
        if tb is not None and episodes_data:
            batch_values = [t.value for t in transitions_flat]
            tb.log_explained_variance(
                resume_episode_offset + episode_num + len(batch_stats),
                returns, batch_values,
            )

        episode_num += len(batch_stats)

        # Checkpoint
        global_ep_end = resume_episode_offset + episode_num
        if args.checkpoint_every > 0 and global_ep_end % args.checkpoint_every < len(batch_stats):
            checkpoint_path = checkpoint_dir / f"policy_ep_{global_ep_end:06d}.pt"
            policy.save_checkpoint(
                checkpoint_path,
                metadata={
                    "episode": global_ep_end,
                    "seed": args.seed + resume_episode_offset + episode_num - 1,
                    "timestamp": datetime.now(UTC).isoformat(),
                },
                reward_normalizer_state=reward_normalizer.state_dict(),
            )

    if not args.no_final_checkpoint:
        final_ep = resume_episode_offset + args.episodes
        final_path = checkpoint_dir / "policy_final.pt"
        policy.save_checkpoint(
            final_path,
            metadata={
                "episode": final_ep,
                "seed": args.seed + resume_episode_offset + args.episodes - 1,
                "timestamp": datetime.now(UTC).isoformat(),
            },
            reward_normalizer_state=reward_normalizer.state_dict(),
        )
        print(f"Final checkpoint: {final_path}")

    print(f"Metrics log: {metrics_path}")
    return 0


# ---------------------------------------------------------------------------
# Hierarchical RL training loop
# ---------------------------------------------------------------------------


def _train_hrl(
    args: argparse.Namespace,
    worker_policy: Any,
    checkpoint_dir: Path,
    metrics_path: Path,
    tb: _TBWriter | None = None,
    resume_episode_offset: int = 0,
    resume_reward_normalizer_state: dict[str, Any] | None = None,
    resolved_schedule: Any | None = None,
) -> int:
    """Train with Hierarchical RL: CEO picks goals, Worker executes."""
    from mk_python import PyVecEnv

    from mage_knight_sdk.sim.rl.curriculum import CURRICULA
    from mage_knight_sdk.sim.rl.goal_tracker import GOAL_ENCODING_DIM, GoalType, RandomTargetSelector
    from mage_knight_sdk.sim.rl.hrl_policy import CEOPolicy, CEOConfig
    from mage_knight_sdk.sim.rl.hrl_runner import HRLEpisodeBuffers, collect_hrl_rollout
    from mage_knight_sdk.sim.rl.policy_gradient import (
        OptimizationStats, PolicyGradientConfig, ReinforcePolicy, Transition, compute_gae,
    )
    from mage_knight_sdk.sim.rl.vec_env_runner import vec_transition_to_transition

    # Reconfigure Worker with goal conditioning if not already
    if worker_policy.config.goal_dim == 0:
        print(f"Re-creating Worker policy with goal_dim={GOAL_ENCODING_DIM}")
        worker_config = PolicyGradientConfig(
            hidden_size=args.hidden_size,
            embedding_dim=args.embedding_dim,
            num_hidden_layers=args.num_hidden_layers,
            d_model=args.d_model,
            learning_rate=args.learning_rate,
            device=args.device,
            goal_dim=GOAL_ENCODING_DIM,
        )
        worker_policy = ReinforcePolicy(worker_config)

    # Create CEO policy
    ceo_config = CEOConfig(
        hidden_size=128,
        embedding_dim=16,
        learning_rate=args.learning_rate,
        device=args.device,
    )
    ceo_policy = CEOPolicy(ceo_config)

    # Use curriculum if specified, else default
    if resolved_schedule is not None:
        schedule = resolved_schedule
    elif args.curriculum:
        schedule = CURRICULA[args.curriculum]()
    else:
        from mage_knight_sdk.sim.rl.curriculum import CURRICULA
        schedule = CURRICULA["default"]()

    global_ep = resume_episode_offset
    reward_normalizer = RunningMeanStd()
    if resume_reward_normalizer_state is not None:
        reward_normalizer.load_state_dict(resume_reward_normalizer_state)
    hero = (
        schedule.hero
        or (args.hero if args.hero.lower() != "random" else "arythea")
    )
    target_selector = RandomTargetSelector()
    rng = np.random.default_rng(args.seed)

    for phase_idx, phase in enumerate(schedule.phases):
        print(f"\n{'=' * 88}")
        print(f"[HRL] Phase {phase_idx + 1}/{len(schedule.phases)}: {phase.name}")
        print(f"  Scenario: {phase.scenario.kind} | Episodes: {phase.episodes} | Max steps: {phase.max_steps}")
        print(f"{'=' * 88}")

        scenario_json = phase.scenario.to_rust_json()
        num_envs = args.batch_episodes
        vec_env = PyVecEnv(
            num_envs=num_envs,
            base_seed=args.seed + global_ep,
            hero=hero,
            max_steps=phase.max_steps,
            scenario=scenario_json,
            combat_oracle=args.combat_oracle,
            commerce_oracle=args.commerce_oracle,
            early_term_fame_step=phase.resolve_early_term_fame_step(
                args.early_term_fame_step,
            ),
        )

        hrl_buffers = HRLEpisodeBuffers()
        phase_episodes_done = 0
        steps_per_collect = num_envs * phase.max_steps

        while phase_episodes_done < phase.episodes:
            # Collect HRL rollout
            result = collect_hrl_rollout(
                vec_env, worker_policy, ceo_policy,
                phase.reward_config,
                total_steps=steps_per_collect,
                hrl_buffers=hrl_buffers,
                target_selector=target_selector,
                max_goal_steps=args.max_goal_steps,
                rng=rng,
            )

            if not result.worker_episodes:
                continue

            # ── Worker PPO ──
            episodes_data = []
            terminated_flags = []
            for ep_transitions, meta in zip(result.worker_episodes, result.worker_metas):
                standard = [vec_transition_to_transition(vt) for vt in ep_transitions]
                episodes_data.append(standard)
                terminated_flags.append(not meta.truncated)

            if episodes_data:
                all_raw_rewards = [t.reward for ep in episodes_data for t in ep]
                reward_normalizer.update(all_raw_rewards)
                normalized_episodes: list[list[Any]] = []
                for ep in episodes_data:
                    raw_rewards = [t.reward for t in ep]
                    norm_rewards = reward_normalizer.normalize(raw_rewards)
                    normalized_episodes.append([
                        Transition(
                            encoded_step=t.encoded_step,
                            action_index=t.action_index,
                            log_prob=t.log_prob,
                            value=t.value,
                            reward=nr,
                            bootstrap_value=t.bootstrap_value,
                        )
                        for t, nr in zip(ep, norm_rewards)
                    ])

                transitions_flat, advantages, returns = compute_gae(
                    normalized_episodes, args.gamma, args.gae_lambda,
                    terminated=terminated_flags,
                )

                if getattr(args, "lr_decay", False):
                    total_episodes = sum(p.episodes for p in schedule.phases)
                    progress_remaining = 1.0 - global_ep / (resume_episode_offset + total_episodes)
                    worker_policy.update_learning_rate(progress_remaining)

                worker_stats = worker_policy.optimize_ppo(
                    transitions_flat, advantages, returns,
                    clip_epsilon=args.clip_epsilon,
                    ppo_epochs=args.ppo_epochs,
                    max_grad_norm=args.max_grad_norm,
                    mini_batch_size=args.mini_batch_size,
                    target_kl=getattr(args, "target_kl", None),
                    entropy_floor=getattr(args, "entropy_floor", 0.0),
                    max_critic_loss=getattr(args, "max_critic_loss", 0.0),
                )
            else:
                worker_stats = OptimizationStats(
                    loss=0.0, total_reward=0.0, mean_reward=0.0,
                    entropy=0.0, action_count=0,
                )

            # ── CEO PPO ──
            ceo_transitions = result.ceo_transitions
            if ceo_transitions:
                ceo_rewards = np.array([t.reward for t in ceo_transitions], dtype=np.float32)
                ceo_values = np.array([t.value for t in ceo_transitions], dtype=np.float32)

                # Simple advantages for CEO (reward - value baseline)
                ceo_advantages = ceo_rewards - ceo_values
                ceo_returns = ceo_rewards  # no bootstrapping — each goal is a complete trajectory segment

                ceo_stats = ceo_policy.optimize_ppo(
                    ceo_transitions, ceo_advantages, ceo_returns,
                    clip_epsilon=args.clip_epsilon,
                    ppo_epochs=args.ppo_epochs,
                    max_grad_norm=args.max_grad_norm,
                    mini_batch_size=32,
                    entropy_coef=args.entropy_coef,
                    critic_coef=args.critic_coef,
                )
            else:
                ceo_stats = {"loss": 0.0, "entropy": 0.0}

            # Log each completed episode
            for ep_transitions, meta in zip(result.worker_episodes, result.worker_metas):
                global_ep += 1
                phase_episodes_done += 1
                total_reward = sum(vt.reward for vt in ep_transitions)
                fame = meta.total_fame_delta
                steps = len(ep_transitions)
                normalized_terminal_fame = reward_normalizer.normalize_component(
                    meta.reward_breakdown.terminal_fame,
                )

                log_entry = {
                    "episode": global_ep,
                    "seed": meta.seed,
                    "fame": fame,
                    "game_score": meta.game_score,
                    "steps": steps,
                    "total_reward": round(total_reward, 2),
                    "termination_cause": meta.termination_cause,
                    "reward_breakdown": {
                        "terminal": meta.reward_breakdown.terminal_bonus,
                        "terminal_fame": meta.reward_breakdown.terminal_fame,
                        "terminal_fame_normalized": normalized_terminal_fame,
                    },
                    "worker_loss": round(worker_stats.loss, 4),
                    "worker_entropy": round(worker_stats.entropy, 4),
                    "ceo_loss": round(ceo_stats["loss"], 4),
                    "ceo_entropy": round(ceo_stats["entropy"], 4),
                    "ceo_goals": len(result.ceo_transitions),
                }

                # Goal distribution
                for gt in GoalType:
                    log_entry[f"goal_{gt.name.lower()}"] = result.goal_counts.get(gt.name, 0)
                    log_entry[f"goal_{gt.name.lower()}_success"] = result.goal_successes.get(gt.name, 0)

                with open(metrics_path, "a") as f:
                    f.write(json.dumps(log_entry) + "\n")

                if tb and tb._writer:
                    tb._writer.add_scalar("reward/total", total_reward, global_ep)
                    tb._writer.add_scalar("reward/fame", fame, global_ep)
                    tb._writer.add_scalar(
                        "episode/fame_binary", 1.0 if fame > 0 else 0.0, global_ep,
                    )
                    tb._writer.add_scalar("episode/game_score", meta.game_score, global_ep)
                    tb._writer.add_scalar("episode/steps", steps, global_ep)
                    tb._writer.add_scalar(
                        "reward_breakdown/terminal_fame_raw",
                        meta.reward_breakdown.terminal_fame,
                        global_ep,
                    )
                    tb._writer.add_scalar(
                        "reward_breakdown/terminal_fame_normalized",
                        normalized_terminal_fame,
                        global_ep,
                    )
                    tb._writer.add_scalar("hrl/worker_loss", worker_stats.loss, global_ep)
                    tb._writer.add_scalar("hrl/ceo_loss", ceo_stats["loss"], global_ep)
                    tb._writer.add_scalar("hrl/ceo_entropy", ceo_stats["entropy"], global_ep)
                    tb._writer.add_scalar("hrl/ceo_goals_per_episode", len(result.ceo_transitions) / max(1, result.total_episodes), global_ep)

                if global_ep % 10 == 0:
                    print(f"  ep={global_ep} score={meta.game_score} fame={fame} steps={steps} reward={total_reward:.1f} ceo_goals={len(result.ceo_transitions)}")

            # Checkpointing
            if global_ep % args.checkpoint_every == 0:
                ckpt_dir = checkpoint_dir / "checkpoints"
                ckpt_dir.mkdir(exist_ok=True)
                worker_path = ckpt_dir / f"worker_ep_{global_ep:06d}.pt"
                worker_policy.save_checkpoint(
                    worker_path,
                    {"episode": global_ep},
                    reward_normalizer_state=reward_normalizer.state_dict(),
                )
                # TODO: save CEO checkpoint too

        del vec_env

    if not args.no_final_checkpoint:
        ckpt_dir = checkpoint_dir / "checkpoints"
        ckpt_dir.mkdir(exist_ok=True)
        final_path = ckpt_dir / "worker_final.pt"
        worker_policy.save_checkpoint(
            final_path,
            {"episode": global_ep},
            reward_normalizer_state=reward_normalizer.state_dict(),
        )
        print(f"Final Worker checkpoint: {final_path}")

    print(f"Metrics log: {metrics_path}")
    return 0


# ---------------------------------------------------------------------------
# Curriculum training loop (VecEnv-based PPO)
# ---------------------------------------------------------------------------


def _limit_curriculum_batch(
    episodes: list[Any],
    metas: list[Any],
    remaining: int,
) -> tuple[list[Any], list[Any]]:
    """Keep a rollout from overshooting the current phase's episode budget."""
    if remaining < 0:
        raise ValueError("remaining curriculum episodes cannot be negative")
    count = min(len(episodes), len(metas), remaining)
    return episodes[:count], metas[:count]


def _train_curriculum(
    args: argparse.Namespace,
    policy: Any,
    checkpoint_dir: Path,
    metrics_path: Path,
    tb: _TBWriter | None = None,
    resume_episode_offset: int = 0,
    resume_reward_normalizer_state: dict[str, Any] | None = None,
    resolved_schedule: Any | None = None,
) -> int:
    """Train with curriculum learning: iterate phases, each with its own scenario + rewards."""
    from mk_python import PyVecEnv

    from mage_knight_sdk.sim.rl.curriculum import CURRICULA
    from mage_knight_sdk.sim.rl.native_rl_runner import EpisodeTrainingStats
    from mage_knight_sdk.sim.rl.policy_gradient import OptimizationStats, Transition, compute_gae
    from mage_knight_sdk.sim.rl.vec_env_runner import (
        EpisodeBuffers,
        collect_vecenv_rollout,
        vec_transition_to_transition,
    )

    schedule = (
        resolved_schedule
        if resolved_schedule is not None
        else CURRICULA[args.curriculum]()
    )
    global_ep = resume_episode_offset
    reward_normalizer = RunningMeanStd()
    if resume_reward_normalizer_state is not None:
        reward_normalizer.load_state_dict(resume_reward_normalizer_state)
    hero = (
        schedule.hero
        or (args.hero if args.hero.lower() != "random" else "arythea")
    )

    for phase_idx, phase in enumerate(schedule.phases):
        print(f"\n{'=' * 88}")
        print(f"Phase {phase_idx + 1}/{len(schedule.phases)}: {phase.name}")
        print(f"  Scenario: {phase.scenario.kind} | Episodes: {phase.episodes} | Max steps: {phase.max_steps}")
        print(
            "  Rewards: "
            f"fame_scale={phase.reward_config.fame_delta_scale} "
            f"step_penalty={phase.reward_config.step_penalty} "
            f"end_bonus={phase.reward_config.terminal_end_bonus} "
            f"terminal_fame_scale={phase.reward_config.terminal_fame_scale}"
        )
        print(
            "  Early zero-fame cutoff: "
            f"{phase.resolve_early_term_fame_step(args.early_term_fame_step)}"
        )
        print(f"{'=' * 88}")

        scenario_json = phase.scenario.to_rust_json()
        num_envs = args.batch_episodes
        vec_env = PyVecEnv(
            num_envs=num_envs,
            base_seed=args.seed + global_ep,
            hero=hero,
            max_steps=phase.max_steps,
            scenario=scenario_json,
            combat_oracle=args.combat_oracle,
            commerce_oracle=args.commerce_oracle,
            early_term_fame_step=phase.resolve_early_term_fame_step(
                args.early_term_fame_step,
            ),
        )

        episode_buffers = EpisodeBuffers()
        phase_episodes_done = 0
        # Target steps per collection ≈ batch_episodes * max_steps (collect ~1 batch worth)
        steps_per_collect = num_envs * phase.max_steps

        while phase_episodes_done < phase.episodes:
            # Collect rollout
            result = collect_vecenv_rollout(
                vec_env, policy, phase.reward_config,
                total_steps=steps_per_collect,
                episode_buffers=episode_buffers,
            )

            remaining = phase.episodes - phase_episodes_done
            failed_metas = result.failed_episode_metas[:remaining]
            for failed_meta in failed_metas:
                global_ep += 1
                phase_episodes_done += 1
                failure_stats = EpisodeTrainingStats(
                    outcome="engine_error",
                    steps=len(failed_meta.action_indices),
                    total_reward=0.0,
                    optimization=OptimizationStats(
                        loss=0.0,
                        total_reward=0.0,
                        mean_reward=0.0,
                        entropy=0.0,
                        action_count=0,
                    ),
                )
                _append_metrics_log(
                    path=metrics_path,
                    episode=global_ep - 1,
                    seed=failed_meta.seed,
                    stats=failure_stats,
                    phase_name=phase.name,
                    phase_index=phase_idx,
                    termination_cause=failed_meta.termination_cause,
                )

            remaining = phase.episodes - phase_episodes_done
            completed_episodes, completed_metas = _limit_curriculum_batch(
                result.episodes,
                result.episode_metas,
                remaining,
            )
            if not completed_episodes:
                continue

            # Convert VecTransitions → standard Transitions for PPO
            episodes_data = []
            terminated_flags = []
            for ep_transitions, meta in zip(completed_episodes, completed_metas):
                standard = [vec_transition_to_transition(vt) for vt in ep_transitions]
                episodes_data.append(standard)
                terminated_flags.append(not meta.truncated)

            # PPO optimization
            if episodes_data:
                # Normalize rewards for GAE computation (keep raw rewards for logging)
                all_raw_rewards = [t.reward for ep in episodes_data for t in ep]
                reward_normalizer.update(all_raw_rewards)
                normalized_episodes: list[list[Any]] = []
                for ep in episodes_data:
                    raw_rewards = [t.reward for t in ep]
                    norm_rewards = reward_normalizer.normalize(raw_rewards)
                    normalized_episodes.append([
                        Transition(
                            encoded_step=t.encoded_step,
                            action_index=t.action_index,
                            log_prob=t.log_prob,
                            value=t.value,
                            reward=nr,
                            bootstrap_value=t.bootstrap_value,
                        )
                        for t, nr in zip(ep, norm_rewards)
                    ])

                transitions_flat, advantages, returns = compute_gae(
                    normalized_episodes, args.gamma, args.gae_lambda,
                    terminated=terminated_flags,
                )

                # Linear LR decay (based on total progress across all phases)
                if getattr(args, "lr_decay", False):
                    total_episodes = sum(p.episodes for p in schedule.phases)
                    progress_remaining = 1.0 - global_ep / (resume_episode_offset + total_episodes)
                    policy.update_learning_rate(progress_remaining)

                opt_stats = policy.optimize_ppo(
                    transitions_flat, advantages, returns,
                    clip_epsilon=args.clip_epsilon,
                    ppo_epochs=args.ppo_epochs,
                    max_grad_norm=args.max_grad_norm,
                    mini_batch_size=args.mini_batch_size,
                    target_kl=getattr(args, "target_kl", None),
                    entropy_floor=getattr(args, "entropy_floor", 0.0),
                    max_critic_loss=getattr(args, "max_critic_loss", 0.0),
                )
            else:
                opt_stats = OptimizationStats(
                    loss=0.0, total_reward=0.0, mean_reward=0.0,
                    entropy=0.0, action_count=0,
                )

            # Log each completed episode
            for ep_transitions, meta in zip(completed_episodes, completed_metas):
                global_ep += 1
                phase_episodes_done += 1
                total_reward = sum(vt.reward for vt in ep_transitions)
                steps = len(ep_transitions)

                stats = EpisodeTrainingStats(
                    outcome="ended" if not meta.truncated else "max_steps",
                    steps=steps,
                    total_reward=total_reward,
                    optimization=opt_stats,
                    scenario_triggered=meta.scenario_end_triggered,
                )

                _append_metrics_log(
                    path=metrics_path, episode=global_ep - 1,
                    seed=meta.seed, stats=stats, fame=meta.total_fame_delta,
                    tiles_explored=meta.tiles_explored,
                    phase_name=phase.name, phase_index=phase_idx,
                    reward_breakdown=meta.reward_breakdown,
                    game_score=meta.game_score,
                    achievement_breakdown=meta.achievement_breakdown,
                    termination_cause=meta.termination_cause,
                    normalized_terminal_fame=reward_normalizer.normalize_component(
                        meta.reward_breakdown.terminal_fame,
                    ),
                )

                if tb is not None:
                    tb.log_episode(
                        global_ep,
                        stats,
                        fame=meta.total_fame_delta,
                        game_score=meta.game_score,
                        reward_breakdown=meta.reward_breakdown,
                        normalized_terminal_fame=reward_normalizer.normalize_component(
                            meta.reward_breakdown.terminal_fame,
                        ),
                    )
                    wounds_per_combat = (
                        meta.total_wounds / meta.combats_entered
                        if meta.combats_entered > 0 else 0.0
                    )
                    tb.log_wound_metrics(
                        global_ep,
                        total_wounds=float(meta.total_wounds),
                        turns_resting=float(meta.turns_resting),
                        wounds_per_combat=wounds_per_combat,
                    )
                    tb.log_achievement_score(global_ep, meta.total_achievement_delta)
                    tb.log_game_score(global_ep, meta.game_score)
                    if meta.achievement_breakdown is not None:
                        tb.log_achievement_breakdown(global_ep, meta.achievement_breakdown)

                bd = meta.reward_breakdown
                tiles = meta.tiles_explored
                explore_fame = tiles * 1  # 1 fame per tile explored
                combat_fame = max(0, meta.total_fame_delta - explore_fame)
                print(
                    f"ep={global_ep:04d} [{phase.name}] steps={steps:<4} "
                    f"R={total_reward:>7.1f}  "
                    f"fame={meta.total_fame_delta:>3}(t{tiles}/c{combat_fame})  "
                    f"score={meta.game_score:>3}  "
                    f"wounds={bd.wound_penalty:>5.1f}  "
                    f"ent={opt_stats.entropy:.2f}"
                )

            # Log explained variance for the batch
            if tb is not None and episodes_data:
                batch_values = [t.value for t in transitions_flat]
                tb.log_explained_variance(global_ep, returns, batch_values)

            # Checkpoint at interval
            if (
                args.checkpoint_every > 0
                and global_ep % args.checkpoint_every < len(completed_episodes)
            ):
                cp_path = checkpoint_dir / f"policy_ep_{global_ep:06d}.pt"
                policy.save_checkpoint(
                    cp_path,
                    metadata={
                        "episode": global_ep,
                        "phase": phase.name,
                        "phase_index": phase_idx,
                        "timestamp": datetime.now(UTC).isoformat(),
                    },
                    reward_normalizer_state=reward_normalizer.state_dict(),
                )

        # Phase boundary checkpoint
        cp_path = checkpoint_dir / f"policy_phase_{phase_idx}_{phase.name}.pt"
        policy.save_checkpoint(
            cp_path,
            metadata={
                "episode": global_ep,
                "phase": phase.name,
                "phase_index": phase_idx,
                "timestamp": datetime.now(UTC).isoformat(),
            },
            reward_normalizer_state=reward_normalizer.state_dict(),
        )
        print(f"Phase checkpoint: {cp_path}")

    if not args.no_final_checkpoint:
        final_path = checkpoint_dir / "policy_final.pt"
        policy.save_checkpoint(
            final_path,
            metadata={
                "episode": global_ep,
                "timestamp": datetime.now(UTC).isoformat(),
            },
            reward_normalizer_state=reward_normalizer.state_dict(),
        )
        print(f"Final checkpoint: {final_path}")

    print(f"Metrics log: {metrics_path}")
    return 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _with_opt(stats: Any, opt: Any) -> Any:
    """Return EpisodeTrainingStats with updated optimization info."""
    from mage_knight_sdk.sim.rl.native_rl_runner import EpisodeTrainingStats
    return EpisodeTrainingStats(
        outcome=stats.outcome,
        steps=stats.steps,
        total_reward=stats.total_reward,
        optimization=opt,
        scenario_triggered=getattr(stats, "scenario_triggered", False),
        achievement_bonus=getattr(stats, "achievement_bonus", 0.0),
    )


def _resolve_run_dir(explicit_dir: str | None, resume_path: str | None) -> Path:
    """Determine the run directory.

    Priority:
    1. Explicit --checkpoint-dir: use as-is.
    2. --resume: derive from the .pt file (if parent is ``checkpoints/``, go one more level up).
    3. Neither: auto-generate ``training/runs/run-YYYYMMDDTHHMMSS``.
    """
    if explicit_dir is not None:
        return Path(explicit_dir)
    if resume_path is not None:
        pt = Path(resume_path).resolve()
        parent = pt.parent
        if parent.name == "checkpoints":
            return parent.parent
        return parent
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
    return Path(f"./training/runs/run-{stamp}")


def _get_git_info() -> dict[str, Any]:
    """Capture git commit, dirty status, and uncommitted file list for reproducibility."""
    info: dict[str, Any] = {}
    try:
        info["commit"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL,
        ).strip()
        info["branch"] = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        dirty = subprocess.check_output(
            ["git", "status", "--porcelain"], text=True, stderr=subprocess.DEVNULL,
        ).strip()
        info["dirty"] = bool(dirty)
        if dirty:
            info["dirty_files"] = dirty.splitlines()
    except (subprocess.CalledProcessError, FileNotFoundError):
        info["commit"] = "unknown"
        info["dirty"] = False
    return info


def _write_run_manifest(
    checkpoint_dir: Path,
    args: argparse.Namespace,
    policy: Any,
    reward_config: Any,
    curriculum_name: str | None = None,
    curriculum_schedule: Any | None = None,
) -> None:
    """Write run_config.json with policy/reward config and CLI args for reproducibility."""
    manifest: dict[str, Any] = {
        "started_at": datetime.now(UTC).isoformat(),
        "git": _get_git_info(),
        "policy_config": asdict(policy.config),
        "reward": {
            "fame_delta_scale": reward_config.fame_delta_scale,
            "step_penalty": reward_config.step_penalty,
            "terminal_end_bonus": reward_config.terminal_end_bonus,
            "terminal_fame_scale": reward_config.terminal_fame_scale,
            "terminal_max_steps_penalty": reward_config.terminal_max_steps_penalty,
            "terminal_failure_penalty": reward_config.terminal_failure_penalty,
            "new_hex_bonus": reward_config.new_hex_bonus,
            "wound_penalty": reward_config.wound_penalty,
            "cards_remaining_bonus": reward_config.cards_remaining_bonus,
            "wasted_move_penalty": reward_config.wasted_move_penalty,
            "backtrack_penalty": reward_config.backtrack_penalty,
            "wound_shaping_k": reward_config.wound_shaping_k,
            "achievement_reward_scale": reward_config.achievement_reward_scale,
            "tile_explore_bonus": reward_config.tile_explore_bonus,
        },
        "cli": vars(args),
    }
    warm_start = getattr(args, "warm_start", None)
    if warm_start:
        source = Path(warm_start).resolve()
        digest = hashlib.sha256()
        with source.open("rb") as checkpoint_file:
            for chunk in iter(lambda: checkpoint_file.read(1024 * 1024), b""):
                digest.update(chunk)
        manifest["initialization"] = {
            "mode": "weights_only_warm_start",
            "checkpoint": str(source),
            "checkpoint_sha256": digest.hexdigest(),
            "optimizer": "fresh",
            "reward_normalizer": "fresh",
            "value_normalizer": "fresh",
        }
    if curriculum_name:
        from mage_knight_sdk.sim.rl.curriculum import CURRICULA
        schedule = curriculum_schedule
        if schedule is None:
            schedule_fn = CURRICULA.get(curriculum_name)
            schedule = schedule_fn() if schedule_fn is not None else None
        if schedule is not None:
            manifest["curriculum"] = {
                "name": curriculum_name,
                "hero": schedule.hero,
                "source": schedule.source,
                "phases": [
                    {
                        "name": p.name,
                        "scenario": {"kind": p.scenario.kind, **p.scenario.params},
                        "episodes": p.episodes,
                        "max_steps": p.max_steps,
                        "early_term_fame_step": p.resolve_early_term_fame_step(
                            args.early_term_fame_step,
                        ),
                        "reward_config": asdict(p.reward_config),
                    }
                    for p in schedule.phases
                ],
            }
    path = checkpoint_dir / "run_config.json"
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")


def _load_rl_components() -> dict[str, Any] | None:
    try:
        from mage_knight_sdk.sim.rl.policy_gradient import (
            PolicyGradientConfig,
            ReinforcePolicy,
        )
        from mage_knight_sdk.sim.rl.rewards import RewardConfig
    except ModuleNotFoundError as error:
        if error.name == "torch":
            print(
                "PyTorch is not installed. Install RL extras first:\n"
                "  python3 -m pip install -e '.[rl]'",
                file=sys.stderr,
            )
            return None
        raise

    return {
        "PolicyGradientConfig": PolicyGradientConfig,
        "ReinforcePolicy": ReinforcePolicy,
        "RewardConfig": RewardConfig,
    }


def _append_metrics_log(
    path: Path,
    episode: int,
    seed: int,
    stats: Any,
    fame: int = 0,
    tiles_explored: int = 0,
    phase_name: str | None = None,
    phase_index: int | None = None,
    reward_breakdown: Any = None,
    game_score: int | None = None,
    achievement_breakdown: dict[str, int] | None = None,
    termination_cause: str | None = None,
    normalized_terminal_fame: float = 0.0,
) -> None:
    """Write metrics from EpisodeTrainingStats."""
    explore_fame = tiles_explored * 1
    combat_fame = max(0, fame - explore_fame)
    record: dict[str, Any] = {
        "episode": episode + 1,
        "seed": seed,
        "fame": fame,
        "tiles_explored": tiles_explored,
        "combat_fame": combat_fame,
        "outcome": stats.outcome,
        "termination_cause": termination_cause or (
            "natural_end" if stats.outcome == "ended" else
            "engine_failure" if stats.outcome == "engine_error" else
            "hard_limit"
        ),
        "steps": stats.steps,
        "reason": None,
        "scenario_triggered": getattr(stats, "scenario_triggered", False),
        "timestamp": datetime.now(UTC).isoformat(),
        "total_reward": stats.total_reward,
        "optimization": {
            "loss": stats.optimization.loss,
            "total_reward": stats.optimization.total_reward,
            "mean_reward": stats.optimization.mean_reward,
            "entropy": stats.optimization.entropy,
            "action_count": stats.optimization.action_count,
            "critic_loss": stats.optimization.critic_loss,
            "epochs_used": getattr(stats.optimization, "epochs_used", 0),
            "approx_kl": getattr(stats.optimization, "approx_kl", 0.0),
            "effective_entropy_coef": getattr(stats.optimization, "effective_entropy_coef", 0.0),
        },
    }
    if game_score is not None:
        record["game_score"] = game_score
    if achievement_breakdown is not None:
        record["achievement_breakdown"] = achievement_breakdown
    if phase_name is not None:
        record["phase"] = phase_name
        record["phase_index"] = phase_index
    if reward_breakdown is not None:
        record["reward_breakdown"] = {
            "fame": reward_breakdown.fame,
            "wound_penalty": reward_breakdown.wound_penalty,
            "cards_remaining": reward_breakdown.cards_remaining_bonus,
            "new_hex": reward_breakdown.new_hex_bonus,
            "step_penalty": reward_breakdown.step_penalty,
            "terminal": reward_breakdown.terminal_bonus,
            "terminal_fame": reward_breakdown.terminal_fame,
            "terminal_fame_normalized": normalized_terminal_fame,
            "scenario_trigger": reward_breakdown.scenario_trigger_bonus,
            "wasted_move": reward_breakdown.wasted_move_penalty,
            "backtrack": reward_breakdown.backtrack_penalty,
            "wound_shaping": reward_breakdown.wound_shaping,
            "achievement": reward_breakdown.achievement,
            "tile_explore": reward_breakdown.tile_explore,
        }
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
