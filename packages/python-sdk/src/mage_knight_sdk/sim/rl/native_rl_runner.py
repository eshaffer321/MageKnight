"""Native RL runner — drives the Rust engine directly via PyO3.

Eliminates WebSocket round-trips, JSON serialization, and Python-side
feature encoding. The entire game loop runs in-process.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from typing import Any

from .features import ActionFeatures, EncodedStep, StateFeatures
from .policy_gradient import OptimizationStats, ReinforcePolicy, Transition
from .rewards import RewardConfig

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EpisodeTrainingStats:
    outcome: str
    steps: int
    total_reward: float
    optimization: OptimizationStats
    scenario_triggered: bool = False
    achievement_bonus: float = 0.0


# Lazy-import mk_python to avoid import errors when Rust module isn't built.
_GameEngine: type | None = None


def _get_engine_class() -> type:
    global _GameEngine
    if _GameEngine is None:
        from mk_python import GameEngine
        _GameEngine = GameEngine
    return _GameEngine


@dataclass(frozen=True)
class NativeRunResult:
    """Result of a single native RL game."""

    seed: int
    outcome: str  # "ended" | "max_steps" | "engine_error"
    steps: int
    fame: int
    level: int
    round: int
    scenario_end_triggered: bool = False
    reason: str | None = None


def py_encoded_to_encoded_step(py_encoded: Any) -> EncodedStep:
    """Convert PyO3 PyEncodedStep → Python EncodedStep dataclass."""
    state = StateFeatures(
        scalars=py_encoded.state_scalars(),
        mode_id=py_encoded.mode_id(),
        hand_card_ids=py_encoded.hand_card_ids(),
        deck_card_ids=py_encoded.deck_card_ids(),
        discard_card_ids=py_encoded.discard_card_ids(),
        unit_ids=py_encoded.unit_ids(),
        unit_scalars=py_encoded.unit_scalars(),
        current_terrain_id=py_encoded.current_terrain_id(),
        current_site_type_id=py_encoded.current_site_type_id(),
        combat_enemy_ids=py_encoded.combat_enemy_ids(),
        combat_enemy_scalars=py_encoded.combat_enemy_scalars(),
        skill_ids=py_encoded.skill_ids(),
        visible_site_ids=py_encoded.visible_site_ids(),
        visible_site_scalars=py_encoded.visible_site_scalars(),
        map_enemy_ids=py_encoded.map_enemy_ids(),
        map_enemy_scalars=py_encoded.map_enemy_scalars(),
        revealed_hex_terrain_ids=py_encoded.revealed_hex_terrain_ids(),
        revealed_hex_scalars=py_encoded.revealed_hex_scalars(),
    )
    type_ids = py_encoded.action_type_ids()
    source_ids = py_encoded.action_source_ids()
    card_ids = py_encoded.action_card_ids()
    unit_ids = py_encoded.action_unit_ids()
    enemy_ids = py_encoded.action_enemy_ids()
    skill_ids = py_encoded.action_skill_ids()
    all_scalars = py_encoded.action_scalars()
    n = py_encoded.action_count()

    actions = []
    for i in range(n):
        actions.append(ActionFeatures(
            action_type_id=type_ids[i],
            source_id=source_ids[i],
            card_id=card_ids[i],
            unit_id=unit_ids[i],
            enemy_id=enemy_ids[i],
            skill_id=skill_ids[i],
            target_enemy_ids=py_encoded.action_target_enemy_ids(i),
            scalars=all_scalars[i],
        ))
    return EncodedStep(state=state, actions=actions)


def run_native_rl_game(
    seed: int,
    hero: str,
    policy: ReinforcePolicy,
    reward_config: RewardConfig | None = None,
    max_steps: int = 10000,
    rng: random.Random | None = None,
) -> tuple[NativeRunResult, EpisodeTrainingStats | None]:
    """Run a single RL training game using the native Rust engine.

    Returns (result, training_stats). Training stats may be None on error.
    """
    if reward_config is None:
        reward_config = RewardConfig()
    if rng is None:
        rng = random.Random(seed)

    GameEngine = _get_engine_class()
    engine = GameEngine(seed=seed, hero=hero)
    engine.set_rl_mode(True)

    step = 0
    outcome = "max_steps"
    reason = None
    stats: EpisodeTrainingStats | None = None
    episode_total_reward = 0.0
    visited_hexes: set[tuple[int, int]] = set()
    start_pos = engine.player_position()
    if start_pos is not None:
        visited_hexes.add(start_pos)
    prev_wound_potential = 0.0

    try:
        while step < max_steps and not engine.is_game_ended():
            # Encode from Rust (no JSON, no Python dict-crawling)
            py_encoded = engine.encode_step()
            encoded_step = py_encoded_to_encoded_step(py_encoded)

            fame_before = engine.fame()
            wounds_before = engine.wound_count()

            # Policy forward pass (takes EncodedStep directly)
            action_index = policy.choose_action_from_encoded(encoded_step, rng)

            # Apply action in Rust engine
            game_ended = engine.apply_action(action_index)

            fame_after = engine.fame()

            # Compute reward
            fame_delta = float(fame_after - fame_before)
            reward = reward_config.fame_delta_scale * fame_delta + reward_config.step_penalty

            # Exploration bonus for new hexes
            pos = engine.player_position()
            if pos is not None and pos not in visited_hexes and reward_config.new_hex_bonus != 0.0:
                reward += reward_config.new_hex_bonus
                visited_hexes.add(pos)

            # Wound penalty
            wound_delta = engine.wound_count() - wounds_before
            if wound_delta != 0 and reward_config.wound_penalty != 0.0:
                reward += reward_config.wound_penalty * float(wound_delta)

            # Potential-based wound shaping: γ·φ(s') - φ(s)
            if reward_config.wound_shaping_k != 0.0:
                tc = max(engine.full_deck_card_count(), 1)
                ratio = engine.full_deck_wound_count() / tc
                phi_new = -reward_config.wound_shaping_k * (ratio * ratio)
                shaping = policy.config.gamma * phi_new - prev_wound_potential
                reward += shaping
                prev_wound_potential = phi_new

            policy.record_step_reward(reward)
            episode_total_reward += reward

            step += 1

            if game_ended:
                outcome = "ended"
                break

        # Terminal reward
        if outcome == "ended":
            terminal = (
                reward_config.terminal_end_bonus
                + reward_config.terminal_fame_scale * float(engine.fame())
            )
        else:
            terminal = reward_config.terminal_max_steps_penalty
        # Scenario trigger bonus (e.g. city revealed)
        if engine.scenario_end_triggered():
            terminal += reward_config.scenario_trigger_bonus
        policy.add_terminal_reward(terminal)
        episode_total_reward += terminal

        # Optimize episode
        optimization = policy.optimize_episode()
        stats = EpisodeTrainingStats(
            outcome=outcome,
            steps=step,
            total_reward=episode_total_reward,
            optimization=optimization,
            scenario_triggered=engine.scenario_end_triggered(),
        )

    except Exception as e:
        outcome = "engine_error"
        reason = str(e)
        logger.warning("Engine error in seed %d at step %d: %s", seed, step, e)
        policy._reset_episode_buffers()

    result = NativeRunResult(
        seed=seed,
        outcome=outcome,
        steps=step,
        fame=engine.fame(),
        level=engine.level(),
        round=engine.round(),
        scenario_end_triggered=engine.scenario_end_triggered(),
        reason=reason,
    )
    return result, stats


def run_native_rl_game_ppo(
    seed: int,
    hero: str,
    policy: ReinforcePolicy,
    reward_config: RewardConfig | None = None,
    max_steps: int = 10000,
    rng: random.Random | None = None,
) -> tuple[NativeRunResult, list[Transition], bool]:
    """Run a single game, collecting PPO transitions instead of optimizing.

    Returns (result, transitions, terminated). terminated is True if the episode
    ended naturally (game over), False if truncated (hit max_steps) or errored.
    """
    if reward_config is None:
        reward_config = RewardConfig()
    if rng is None:
        rng = random.Random(seed)

    GameEngine = _get_engine_class()
    engine = GameEngine(seed=seed, hero=hero)
    engine.set_rl_mode(True)

    step = 0
    outcome = "max_steps"
    reason = None
    transitions: list[Transition] = []
    visited_hexes: set[tuple[int, int]] = set()
    start_pos = engine.player_position()
    if start_pos is not None:
        visited_hexes.add(start_pos)
    prev_wound_potential = 0.0

    try:
        while step < max_steps and not engine.is_game_ended():
            py_encoded = engine.encode_step()
            encoded_step = py_encoded_to_encoded_step(py_encoded)

            fame_before = engine.fame()
            wounds_before = engine.wound_count()

            action_index = policy.choose_action_from_encoded(encoded_step, rng)
            step_info = policy.last_step_info

            game_ended = engine.apply_action(action_index)

            fame_after = engine.fame()
            fame_delta = float(fame_after - fame_before)
            reward = reward_config.fame_delta_scale * fame_delta + reward_config.step_penalty

            # Exploration bonus for new hexes
            pos = engine.player_position()
            if pos is not None and pos not in visited_hexes and reward_config.new_hex_bonus != 0.0:
                reward += reward_config.new_hex_bonus
                visited_hexes.add(pos)

            # Wound penalty
            wound_delta = engine.wound_count() - wounds_before
            if wound_delta != 0 and reward_config.wound_penalty != 0.0:
                reward += reward_config.wound_penalty * float(wound_delta)

            # Potential-based wound shaping: γ·φ(s') - φ(s)
            if reward_config.wound_shaping_k != 0.0:
                tc = max(engine.full_deck_card_count(), 1)
                ratio = engine.full_deck_wound_count() / tc
                phi_new = -reward_config.wound_shaping_k * (ratio * ratio)
                shaping = policy.config.gamma * phi_new - prev_wound_potential
                reward += shaping
                prev_wound_potential = phi_new

            if step_info is not None:
                transitions.append(Transition(
                    encoded_step=step_info.encoded_step,
                    action_index=step_info.action_index,
                    log_prob=step_info.log_prob,
                    value=step_info.value,
                    reward=reward,
                ))

            step += 1

            if game_ended:
                outcome = "ended"
                break

        # Terminal reward added to last transition
        if outcome == "ended":
            terminal = (
                reward_config.terminal_end_bonus
                + reward_config.terminal_fame_scale * float(engine.fame())
            )
        else:
            terminal = reward_config.terminal_max_steps_penalty
        # Scenario trigger bonus
        if engine.scenario_end_triggered():
            terminal += reward_config.scenario_trigger_bonus
        if transitions:
            last = transitions[-1]
            bootstrap_value = None
            if outcome != "ended":
                final_encoded = py_encoded_to_encoded_step(engine.encode_step())
                bootstrap_value = policy.evaluate_encoded_value(final_encoded)
            transitions[-1] = Transition(
                encoded_step=last.encoded_step,
                action_index=last.action_index,
                log_prob=last.log_prob,
                value=last.value,
                reward=last.reward + terminal,
                bootstrap_value=bootstrap_value,
            )

    except Exception as e:
        outcome = "engine_error"
        reason = str(e)
        logger.warning("Engine error in seed %d at step %d: %s", seed, step, e)
        # Apply failure penalty to last transition
        if transitions:
            last = transitions[-1]
            transitions[-1] = Transition(
                encoded_step=last.encoded_step,
                action_index=last.action_index,
                log_prob=last.log_prob,
                value=last.value,
                reward=last.reward + reward_config.terminal_failure_penalty,
            )

    # Reset policy buffers (PPO doesn't optimize per-episode)
    policy._reset_episode_buffers()

    terminated = outcome == "ended"
    result = NativeRunResult(
        seed=seed,
        outcome=outcome,
        steps=step,
        fame=engine.fame(),
        level=engine.level(),
        round=engine.round(),
        scenario_end_triggered=engine.scenario_end_triggered(),
        reason=reason,
    )
    return result, transitions, terminated
