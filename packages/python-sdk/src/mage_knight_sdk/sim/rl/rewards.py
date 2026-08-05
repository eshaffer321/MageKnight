"""Reward configuration for RL training.

The native Rust engine path computes rewards directly from fame deltas.
This module provides the scalar reward parameters.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RewardConfig:
    fame_delta_scale: float = 1.0
    step_penalty: float = 0.0
    terminal_end_bonus: float = 0.0
    terminal_fame_scale: float = 0.0
    terminal_max_steps_penalty: float = -0.5
    terminal_failure_penalty: float = -1.0
    scenario_trigger_bonus: float = 0.0
    new_hex_bonus: float = 0.0
    wound_penalty: float = 0.0
    cards_remaining_bonus: float = 0.0
    wasted_move_penalty: float = 0.0
    backtrack_penalty: float = 0.0
    wound_shaping_k: float = 0.0
    achievement_reward_scale: float = 0.0
    tile_explore_bonus: float = 0.0  # Progressive tile bonus: Nth tile = N * this value (0 = disabled)
