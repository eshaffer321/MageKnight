"""HRL collection loop — dual-level rollout collection for hierarchical RL.

Runs the CEO (goal selection) and Worker (action execution) policies
together over a VecEnv, collecting separate transition buffers for each.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace

import numpy as np

from .goal_tracker import (
    GoalTracker, GoalType, GoalStatus, RandomTargetSelector,
    TargetSelector, NUM_GOAL_TYPES, GOAL_ENCODING_DIM,
)
from .hrl_policy import CEOPolicy, CEOTransition
from .policy_gradient import ReinforcePolicy
from .rewards import RewardConfig
from .vec_env_runner import (
    EpisodeBuffers,
    CompletedEpisodeMeta,
    RewardBreakdown,
    TERMINATION_CAUSE_HARD_LIMIT,
    VecTransition,
    _extract_vec_transition,
    termination_cause_name,
)

logger = logging.getLogger(__name__)


@dataclass
class HRLEpisodeBuffers:
    """Per-env buffers for HRL collection (worker + CEO)."""
    # Worker buffers (reuse existing EpisodeBuffers for reward tracking)
    worker_buffers: EpisodeBuffers = field(default_factory=EpisodeBuffers)
    # CEO transitions per env (sparse — one per goal)
    ceo_buffers: list[list[CEOTransition]] = field(default_factory=list)
    # Goal trackers per env
    goal_trackers: list[GoalTracker] = field(default_factory=list)
    # Step counter per env (for goal timeout)
    step_counts: list[int] = field(default_factory=list)

    def ensure_size(self, n: int, max_goal_steps: int = 30) -> None:
        self.worker_buffers.ensure_size(n)
        while len(self.ceo_buffers) < n:
            self.ceo_buffers.append([])
        while len(self.goal_trackers) < n:
            self.goal_trackers.append(GoalTracker(max_goal_steps=max_goal_steps))
        while len(self.step_counts) < n:
            self.step_counts.append(0)


@dataclass(frozen=True)
class HRLCollectionResult:
    """Result from collect_hrl_rollout."""
    # Worker episodes (same format as flat PPO)
    worker_episodes: list[list[VecTransition]]
    worker_metas: list[CompletedEpisodeMeta]
    # CEO transitions (flat list from all completed episodes)
    ceo_transitions: list[CEOTransition]
    total_steps: int
    total_episodes: int
    panicked_episodes: int
    # Goal stats for logging
    goal_counts: dict[str, int]  # per-type goal selection counts
    goal_successes: dict[str, int]  # per-type success counts


# Goal completion bonus/penalty for the Worker
GOAL_COMPLETION_BONUS = 1.0
GOAL_FAILURE_PENALTY = -0.3


def collect_hrl_rollout(
    vec_env: object,
    worker_policy: ReinforcePolicy,
    ceo_policy: CEOPolicy,
    reward_config: RewardConfig,
    total_steps: int,
    hrl_buffers: HRLEpisodeBuffers | None = None,
    target_selector: TargetSelector | None = None,
    max_goal_steps: int = 30,
    rng: np.random.Generator | None = None,
) -> HRLCollectionResult:
    """Collect transitions with hierarchical goal-conditioned policies.

    The CEO picks goals at natural breakpoints (start of episode, goal completion).
    The Worker picks PlayerActions conditioned on the current goal.

    Args:
        vec_env: PyVecEnv instance
        worker_policy: Worker policy (existing ReinforcePolicy with goal_dim > 0)
        ceo_policy: CEO policy for goal selection
        reward_config: reward shaping config (applied to Worker)
        total_steps: target number of steps to collect
        hrl_buffers: persistent buffers from previous batch
        target_selector: strategy for picking target hexes (default: random)
        max_goal_steps: timeout for goal completion
        rng: random number generator for target selection

    Returns:
        HRLCollectionResult with completed episodes and CEO transitions
    """
    if rng is None:
        rng = np.random.default_rng()
    if target_selector is None:
        target_selector = RandomTargetSelector()

    num_envs = vec_env.num_envs()

    if hrl_buffers is None:
        hrl_buffers = HRLEpisodeBuffers()
    hrl_buffers.ensure_size(num_envs, max_goal_steps=max_goal_steps)

    worker_bufs = hrl_buffers.worker_buffers
    worker_bufs.ensure_size(num_envs)
    bufs = worker_bufs.buffers
    ceo_bufs = hrl_buffers.ceo_buffers
    trackers = hrl_buffers.goal_trackers

    completed_worker_episodes: list[list[VecTransition]] = []
    completed_metas: list[CompletedEpisodeMeta] = []
    completed_ceo_transitions: list[CEOTransition] = []
    panicked_count = 0
    steps_collected = 0

    # Goal stats
    goal_counts: dict[str, int] = {gt.name: 0 for gt in GoalType}
    goal_successes: dict[str, int] = {gt.name: 0 for gt in GoalType}

    # Snapshot seeds for new episodes
    current_seeds = vec_env.seeds()
    for i in range(num_envs):
        if not bufs[i]:
            worker_bufs.seeds[i] = int(current_seeds[i])
            worker_bufs.action_indices[i] = []
            worker_bufs.scenario_end_triggered[i] = False
            worker_bufs.fame_deltas[i] = 0

    while steps_collected < total_steps:
        # 1. Encode all envs
        batch_dict = vec_env.encode_batch()

        # 2. CEO goal selection for envs that need goals
        needs_goal_mask = np.array([trackers[i].needs_goal for i in range(num_envs)])
        if needs_goal_mask.any():
            # Compute legal goal masks for all envs
            goal_masks = np.zeros((num_envs, NUM_GOAL_TYPES), dtype=bool)
            for i in range(num_envs):
                if needs_goal_mask[i]:
                    goal_masks[i] = GoalTracker.enumerate_legal_goals(batch_dict, i)

            # CEO picks goals for all envs (masked for those that don't need)
            # For envs that don't need goals, mask all to Rest (doesn't matter, won't be used)
            for i in range(num_envs):
                if not needs_goal_mask[i]:
                    goal_masks[i] = np.zeros(NUM_GOAL_TYPES, dtype=bool)
                    goal_masks[i][GoalType.REST] = True  # dummy

            goals, goal_log_probs, goal_values = ceo_policy.choose_goals_batch(
                batch_dict, goal_masks,
            )

            # Set goals for envs that need them
            for i in range(num_envs):
                if needs_goal_mask[i]:
                    goal_type = GoalType(int(goals[i]))
                    goal_counts[goal_type.name] += 1

                    # Select target hex
                    candidates = GoalTracker.get_target_candidates(
                        goal_type, batch_dict, i,
                    )
                    target_hex = target_selector.select(
                        goal_type, candidates, (0, 0), rng,
                    )

                    trackers[i].set_goal(goal_type, target_hex, hrl_buffers.step_counts[i])

                    # Record CEO transition start
                    # Store state snapshot for later PPO optimization
                    ceo_bufs[i].append(CEOTransition(
                        state_scalars=batch_dict["state_scalars"][i].copy(),
                        state_ids=batch_dict["state_ids"][i].copy(),
                        goal_index=int(goals[i]),
                        log_prob=float(goal_log_probs[i]),
                        value=float(goal_values[i]),
                        reward=0.0,  # will be updated on goal completion
                    ))

        # 3. Augment batch_dict with goal encodings for Worker
        goal_encodings = np.zeros((num_envs, GOAL_ENCODING_DIM), dtype=np.float32)
        for i in range(num_envs):
            # Use fames as a proxy for player position since we don't have it in encode_batch
            # The actual relative coords in the goal encoding use the target from the tracker
            goal_encodings[i] = trackers[i].get_goal_encoding((0, 0))

        # Prepend goal encoding to state_scalars
        augmented_scalars = np.concatenate(
            [goal_encodings, batch_dict["state_scalars"]], axis=1,
        )
        augmented_batch = dict(batch_dict)
        augmented_batch["state_scalars"] = augmented_scalars

        # 4. Worker picks actions
        actions, log_probs, values = worker_policy.choose_actions_batch(augmented_batch)

        # 5. Step all envs
        step_result = vec_env.step_batch(actions)
        bootstrap_values_by_env: dict[int, float] = {}
        bootstrap_batch = step_result["bootstrap_batch"]
        if bootstrap_batch is not None:
            bootstrap_indices = np.asarray(
                step_result["bootstrap_indices"], dtype=np.int64,
            )
            augmented_bootstrap_batch = dict(bootstrap_batch)
            augmented_bootstrap_batch["state_scalars"] = np.concatenate(
                [
                    goal_encodings[bootstrap_indices],
                    bootstrap_batch["state_scalars"],
                ],
                axis=1,
            )
            bootstrap_values = worker_policy.evaluate_values_batch(
                augmented_bootstrap_batch,
            )
            bootstrap_values_by_env = {
                int(env_index): float(value)
                for env_index, value in zip(bootstrap_indices, bootstrap_values)
            }
        fame_deltas = step_result["fame_deltas"]
        final_fames = step_result["fames"]
        dones = step_result["dones"]
        panicked = step_result["panicked"]
        truncated_flags = step_result["truncated"]
        termination_causes = step_result["termination_causes"]
        scenario_flags = step_result["scenario_end_triggered"]
        new_hexes = step_result["new_hexes"]
        wound_deltas = step_result["wound_deltas"]
        non_wound_hand_sizes = step_result["non_wound_hand_sizes"]
        new_tiles = step_result["new_tiles"]
        wasted_move_pts = step_result["wasted_move_points"]
        backtrack = step_result["backtrack_moves"]
        wound_counts = step_result["wound_counts"]
        total_card_counts = step_result["total_card_counts"]
        in_combat_flags = step_result["in_combat"]
        rested_turns_step = step_result["rested_turns"]
        achievement_deltas = step_result["achievement_deltas"]
        game_scores = step_result["game_scores"]
        achievement_categories = step_result["achievement_categories"]
        applied_actions = step_result["applied_actions"]

        # 6. Process each env
        for i in range(num_envs):
            hrl_buffers.step_counts[i] += 1

            # ── Compute Worker reward (same as flat PPO + goal bonus) ──
            fame_delta = float(fame_deltas[i])
            fame_reward = reward_config.fame_delta_scale * fame_delta
            reward = fame_reward + reward_config.step_penalty

            worker_bufs.reward_fame[i] += fame_reward
            worker_bufs.reward_step_penalty[i] += reward_config.step_penalty

            if new_hexes[i] > 0 and reward_config.new_hex_bonus != 0.0:
                hex_bonus = reward_config.new_hex_bonus * float(new_hexes[i])
                reward += hex_bonus
                worker_bufs.reward_new_hex[i] += hex_bonus

            if wound_deltas[i] != 0 and reward_config.wound_penalty != 0.0:
                wound_pen = reward_config.wound_penalty * float(wound_deltas[i])
                reward += wound_pen
                worker_bufs.reward_wound_penalty[i] += wound_pen

            wasted = int(wasted_move_pts[i])
            if wasted > 0 and reward_config.wasted_move_penalty != 0.0:
                wasted_pen = reward_config.wasted_move_penalty * float(wasted * wasted)
                reward += wasted_pen
                worker_bufs.reward_wasted_move[i] += wasted_pen

            if backtrack[i] > 0 and reward_config.backtrack_penalty != 0.0:
                bt_pen = reward_config.backtrack_penalty
                reward += bt_pen
                worker_bufs.reward_backtrack[i] += bt_pen

            if reward_config.wound_shaping_k != 0.0:
                tc = max(int(total_card_counts[i]), 1)
                ratio = int(wound_counts[i]) / tc
                phi_new = -reward_config.wound_shaping_k * (ratio * ratio)
                phi_old = worker_bufs.prev_wound_potential[i]
                shaping = worker_policy.config.gamma * phi_new - phi_old
                reward += shaping
                worker_bufs.reward_wound_shaping[i] += shaping
                worker_bufs.prev_wound_potential[i] = phi_new

            ach_delta = int(achievement_deltas[i])
            if ach_delta != 0:
                worker_bufs.total_achievement_delta[i] += ach_delta
                if reward_config.achievement_reward_scale != 0.0:
                    ach_reward = reward_config.achievement_reward_scale * float(ach_delta)
                    reward += ach_reward
                    worker_bufs.reward_achievement[i] += ach_reward

            if new_tiles[i] > 0:
                tiles_before = worker_bufs.tiles_explored[i]
                worker_bufs.tiles_explored[i] += int(new_tiles[i])
                if reward_config.tile_explore_bonus != 0.0:
                    tile_num = tiles_before + 1
                    tile_reward = reward_config.tile_explore_bonus * float(tile_num)
                    reward += tile_reward
                    worker_bufs.reward_tile_explore[i] += tile_reward

            if wound_deltas[i] != 0:
                worker_bufs.total_wounds[i] += int(wound_deltas[i])

            currently_in_combat = bool(in_combat_flags[i])
            if currently_in_combat and not worker_bufs.prev_in_combat[i]:
                worker_bufs.combats_entered[i] += 1
            worker_bufs.prev_in_combat[i] = currently_in_combat

            if rested_turns_step[i] > 0:
                worker_bufs.turns_resting[i] += int(rested_turns_step[i])

            worker_bufs.fame_deltas[i] += int(fame_deltas[i])

            applied_idx = int(applied_actions[i])
            worker_bufs.action_indices[i].append(applied_idx)

            if scenario_flags[i] and not worker_bufs.scenario_end_triggered[i]:
                reward += reward_config.scenario_trigger_bonus
                worker_bufs.reward_scenario_trigger[i] += reward_config.scenario_trigger_bonus
                worker_bufs.scenario_end_triggered[i] = True

            # ── Check goal completion ──
            game_reward = fame_reward  # game-level reward for CEO
            goal_status = trackers[i].check_completion(step_result, i, hrl_buffers.step_counts[i])

            if goal_status == GoalStatus.COMPLETED:
                reward += GOAL_COMPLETION_BONUS
                if ceo_bufs[i]:
                    gt_name = GoalType(ceo_bufs[i][-1].goal_index).name
                    goal_successes[gt_name] = goal_successes.get(gt_name, 0) + 1
            elif goal_status in (GoalStatus.FAILED, GoalStatus.TIMEOUT):
                reward += GOAL_FAILURE_PENALTY

            # Accumulate game reward for CEO
            if ceo_bufs[i]:
                # Update the last CEO transition's reward
                last_ceo = ceo_bufs[i][-1]
                ceo_bufs[i][-1] = CEOTransition(
                    state_scalars=last_ceo.state_scalars,
                    state_ids=last_ceo.state_ids,
                    goal_index=last_ceo.goal_index,
                    log_prob=last_ceo.log_prob,
                    value=last_ceo.value,
                    reward=last_ceo.reward + game_reward,
                )

            # ── Store Worker transition ──
            # Use augmented batch (with goal encoding) so state_scalars match the
            # Worker network's expected input dimension during PPO optimization.
            action_idx = int(actions[i])
            vt = _extract_vec_transition(
                augmented_batch, i,
                action_index=action_idx,
                log_prob=float(log_probs[i]),
                value=float(values[i]),
                reward=reward,
            )
            bufs[i].append(vt)
            steps_collected += 1

            # ── Handle episode completion ──
            if dones[i]:
                if panicked[i]:
                    panicked_count += 1
                    bufs[i] = []
                    worker_bufs.buffers[i] = bufs[i]
                    ceo_bufs[i] = []
                    trackers[i].reset()
                    hrl_buffers.step_counts[i] = 0
                    _reset_worker_buffers(worker_bufs, i)
                    new_seeds = vec_env.seeds()
                    worker_bufs.seeds[i] = int(new_seeds[i])
                    continue

                # Normal completion — finalize Worker episode
                episode = bufs[i]
                is_truncated = bool(truncated_flags[i])
                is_hard_limit = (
                    int(termination_causes[i]) == TERMINATION_CAUSE_HARD_LIMIT
                )
                if is_hard_limit:
                    terminal_base = reward_config.terminal_max_steps_penalty
                elif is_truncated:
                    terminal_base = 0.0
                else:
                    terminal_base = reward_config.terminal_end_bonus
                terminal_fame = 0.0
                if not is_truncated:
                    terminal_fame = (
                        reward_config.terminal_fame_scale * float(final_fames[i])
                    )
                cards_bonus = 0.0
                if reward_config.cards_remaining_bonus != 0.0:
                    cards_bonus = reward_config.cards_remaining_bonus * float(non_wound_hand_sizes[i])
                terminal = terminal_base + terminal_fame + cards_bonus
                worker_bufs.reward_terminal[i] += terminal_base
                worker_bufs.reward_terminal_fame[i] += terminal_fame
                worker_bufs.reward_cards_remaining[i] += cards_bonus

                if episode:
                    last = episode[-1]
                    episode[-1] = replace(
                        last,
                        reward=last.reward + terminal,
                        bootstrap_value=(
                            bootstrap_values_by_env.get(i)
                            if is_truncated else None
                        ),
                    )

                breakdown = RewardBreakdown(
                    fame=worker_bufs.reward_fame[i],
                    wound_penalty=worker_bufs.reward_wound_penalty[i],
                    cards_remaining_bonus=worker_bufs.reward_cards_remaining[i],
                    new_hex_bonus=worker_bufs.reward_new_hex[i],
                    step_penalty=worker_bufs.reward_step_penalty[i],
                    terminal_bonus=worker_bufs.reward_terminal[i],
                    terminal_fame=worker_bufs.reward_terminal_fame[i],
                    scenario_trigger_bonus=worker_bufs.reward_scenario_trigger[i],
                    wasted_move_penalty=worker_bufs.reward_wasted_move[i],
                    backtrack_penalty=worker_bufs.reward_backtrack[i],
                    wound_shaping=worker_bufs.reward_wound_shaping[i],
                    achievement=worker_bufs.reward_achievement[i],
                    tile_explore=worker_bufs.reward_tile_explore[i],
                )
                completed_worker_episodes.append(episode)
                completed_metas.append(CompletedEpisodeMeta(
                    seed=worker_bufs.seeds[i],
                    action_indices=list(worker_bufs.action_indices[i]),
                    truncated=is_truncated,
                    termination_cause=termination_cause_name(
                        int(termination_causes[i]),
                    ),
                    scenario_end_triggered=worker_bufs.scenario_end_triggered[i],
                    total_fame_delta=worker_bufs.fame_deltas[i],
                    tiles_explored=worker_bufs.tiles_explored[i],
                    reward_breakdown=breakdown,
                    total_wounds=worker_bufs.total_wounds[i],
                    combats_entered=worker_bufs.combats_entered[i],
                    turns_resting=worker_bufs.turns_resting[i],
                    total_achievement_delta=worker_bufs.total_achievement_delta[i],
                    game_score=int(game_scores[i]),
                    achievement_breakdown={
                        "knowledge": int(achievement_categories[i][0]),
                        "loot": int(achievement_categories[i][1]),
                        "leader": int(achievement_categories[i][2]),
                        "conqueror": int(achievement_categories[i][3]),
                        "adventurer": int(achievement_categories[i][4]),
                        "beating": int(achievement_categories[i][5]),
                    },
                ))

                # Finalize CEO transitions for this episode
                completed_ceo_transitions.extend(ceo_bufs[i])

                # Reset
                bufs[i] = []
                worker_bufs.buffers[i] = bufs[i]
                ceo_bufs[i] = []
                trackers[i].reset()
                hrl_buffers.step_counts[i] = 0
                _reset_worker_buffers(worker_bufs, i)
                new_seeds = vec_env.seeds()
                worker_bufs.seeds[i] = int(new_seeds[i])

    return HRLCollectionResult(
        worker_episodes=completed_worker_episodes,
        worker_metas=completed_metas,
        ceo_transitions=completed_ceo_transitions,
        total_steps=steps_collected,
        total_episodes=len(completed_worker_episodes),
        panicked_episodes=panicked_count,
        goal_counts=goal_counts,
        goal_successes=goal_successes,
    )


def _reset_worker_buffers(bufs: EpisodeBuffers, i: int) -> None:
    """Reset all per-env accumulators in EpisodeBuffers."""
    bufs.action_indices[i] = []
    bufs.scenario_end_triggered[i] = False
    bufs.fame_deltas[i] = 0
    bufs.tiles_explored[i] = 0
    bufs.reward_fame[i] = 0.0
    bufs.reward_wound_penalty[i] = 0.0
    bufs.reward_cards_remaining[i] = 0.0
    bufs.reward_new_hex[i] = 0.0
    bufs.reward_step_penalty[i] = 0.0
    bufs.reward_terminal[i] = 0.0
    bufs.reward_terminal_fame[i] = 0.0
    bufs.reward_scenario_trigger[i] = 0.0
    bufs.reward_wasted_move[i] = 0.0
    bufs.reward_backtrack[i] = 0.0
    bufs.reward_wound_shaping[i] = 0.0
    bufs.reward_achievement[i] = 0.0
    bufs.reward_tile_explore[i] = 0.0
    bufs.total_achievement_delta[i] = 0
    bufs.prev_wound_potential[i] = 0.0
    bufs.total_wounds[i] = 0
    bufs.combats_entered[i] = 0
    bufs.prev_in_combat[i] = False
    bufs.turns_resting[i] = 0
