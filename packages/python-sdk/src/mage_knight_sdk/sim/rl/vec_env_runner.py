"""VecEnv collection loop — batched rollout collection for vectorized training.

Runs N parallel games via PyVecEnv, using batched network forward passes
for 10-50x throughput compared to serial per-step inference.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

from .policy_gradient import ReinforcePolicy, Transition
from .rewards import RewardConfig
from .features import EncodedStep, StateFeatures, ActionFeatures

logger = logging.getLogger(__name__)

TERMINATION_CAUSE_ONGOING = 0
TERMINATION_CAUSE_NATURAL_END = 1
TERMINATION_CAUSE_EARLY_ZERO_FAME = 2
TERMINATION_CAUSE_HARD_LIMIT = 3
TERMINATION_CAUSE_ENGINE_FAILURE = 4

TERMINATION_NATURAL_END = "natural_end"
TERMINATION_EARLY_ZERO_FAME = "early_zero_fame"
TERMINATION_HARD_LIMIT = "hard_limit"
TERMINATION_ENGINE_FAILURE = "engine_failure"

_TERMINATION_CAUSE_NAMES = {
    TERMINATION_CAUSE_NATURAL_END: TERMINATION_NATURAL_END,
    TERMINATION_CAUSE_EARLY_ZERO_FAME: TERMINATION_EARLY_ZERO_FAME,
    TERMINATION_CAUSE_HARD_LIMIT: TERMINATION_HARD_LIMIT,
    TERMINATION_CAUSE_ENGINE_FAILURE: TERMINATION_ENGINE_FAILURE,
}


def termination_cause_name(code: int) -> str:
    """Map the stable Rust termination code to its logged name."""
    try:
        return _TERMINATION_CAUSE_NAMES[code]
    except KeyError as error:
        raise ValueError(f"unknown termination cause code: {code}") from error


@dataclass(frozen=True)
class VecTransition:
    """Lightweight transition for VecEnv collection.

    Stores numpy slices from the batch rather than full EncodedStep objects.
    """

    # State: numpy arrays (from batch slice)
    state_scalars: np.ndarray          # (STATE_SCALAR_DIM,) float32
    state_ids: np.ndarray              # (3,) int32
    hand_card_ids: np.ndarray          # (H,) int32 (trimmed to actual count)
    deck_card_ids: np.ndarray          # (D,) int32
    discard_card_ids: np.ndarray       # (DC,) int32
    unit_ids: np.ndarray               # (U,) int32
    unit_scalars: np.ndarray           # (U, UNIT_SCALAR_DIM) float32
    combat_enemy_ids: np.ndarray       # (CE,) int32
    combat_enemy_scalars: np.ndarray   # (CE, COMBAT_ENEMY_SCALAR_DIM) float32
    skill_ids: np.ndarray              # (S,) int32
    visible_site_ids: np.ndarray       # (VS,) int32
    visible_site_scalars: np.ndarray   # (VS, SITE_SCALAR_DIM) float32
    map_enemy_ids: np.ndarray          # (ME,) int32
    map_enemy_scalars: np.ndarray      # (ME, MAP_ENEMY_SCALAR_DIM) float32
    revealed_hex_terrain_ids: np.ndarray  # (RH,) int32
    revealed_hex_scalars: np.ndarray      # (RH, HEX_SCALAR_DIM) float32

    # Action: numpy arrays (trimmed to actual count)
    action_ids: np.ndarray             # (A, 6) int32
    action_scalars: np.ndarray         # (A, 34) float32

    # PPO scalars
    action_index: int
    log_prob: float
    value: float
    reward: float
    bootstrap_value: float | None = None


def _extract_vec_transition(
    batch_dict: dict[str, np.ndarray],
    env_idx: int,
    action_index: int,
    log_prob: float,
    value: float,
    reward: float,
) -> VecTransition:
    """Extract a single env's state/action data from the batch dict."""
    i = env_idx
    hc = int(batch_dict["hand_counts"][i])
    dc = int(batch_dict["deck_counts"][i])
    dcc = int(batch_dict["discard_counts"][i])
    uc = int(batch_dict["unit_counts"][i])
    cec = int(batch_dict["combat_enemy_counts"][i])
    sc = int(batch_dict["skill_counts"][i])
    vsc = int(batch_dict["visible_site_counts"][i])
    mec = int(batch_dict["map_enemy_counts"][i])
    rhc = int(batch_dict["revealed_hex_counts"][i])
    ac = int(batch_dict["action_counts"][i])

    n = batch_dict["state_scalars"].shape[0]
    max_u = batch_dict["unit_ids"].shape[1]
    max_ce = batch_dict["combat_enemy_ids"].shape[1]
    max_vs = batch_dict["visible_site_ids"].shape[1]
    max_me = batch_dict["map_enemy_ids"].shape[1]
    max_rh = batch_dict["revealed_hex_terrain_ids"].shape[1]

    # Reshape 3D arrays that come as (N*max, dim) → index by env
    u_scalars_raw = batch_dict["unit_scalars"]
    u_scalars_3d = u_scalars_raw.reshape(n, max_u, -1)

    ce_scalars_raw = batch_dict["combat_enemy_scalars"]
    ce_scalars_3d = ce_scalars_raw.reshape(n, max_ce, -1)

    vs_scalars_raw = batch_dict["visible_site_scalars"]
    vs_scalars_3d = vs_scalars_raw.reshape(n, max_vs, -1)

    me_scalars_raw = batch_dict["map_enemy_scalars"]
    me_scalars_3d = me_scalars_raw.reshape(n, max_me, -1)

    rh_scalars_raw = batch_dict["revealed_hex_scalars"]
    rh_scalars_3d = rh_scalars_raw.reshape(n, max_rh, -1)

    # Action arrays come as (N*max_M, dim)
    max_m = batch_dict["action_ids"].shape[0] // n
    action_ids_3d = batch_dict["action_ids"].reshape(n, max_m, 6)
    action_scalars_3d = batch_dict["action_scalars"].reshape(n, max_m, -1)

    return VecTransition(
        state_scalars=batch_dict["state_scalars"][i].copy(),
        state_ids=batch_dict["state_ids"][i].copy(),
        hand_card_ids=batch_dict["hand_card_ids"][i, :hc].copy(),
        deck_card_ids=batch_dict["deck_card_ids"][i, :dc].copy(),
        discard_card_ids=batch_dict["discard_card_ids"][i, :dcc].copy(),
        unit_ids=batch_dict["unit_ids"][i, :uc].copy(),
        unit_scalars=u_scalars_3d[i, :uc].copy(),
        combat_enemy_ids=batch_dict["combat_enemy_ids"][i, :cec].copy(),
        combat_enemy_scalars=ce_scalars_3d[i, :cec].copy(),
        skill_ids=batch_dict["skill_ids"][i, :sc].copy(),
        visible_site_ids=batch_dict["visible_site_ids"][i, :vsc].copy(),
        visible_site_scalars=vs_scalars_3d[i, :vsc].copy(),
        map_enemy_ids=batch_dict["map_enemy_ids"][i, :mec].copy(),
        map_enemy_scalars=me_scalars_3d[i, :mec].copy(),
        revealed_hex_terrain_ids=batch_dict["revealed_hex_terrain_ids"][i, :rhc].copy(),
        revealed_hex_scalars=rh_scalars_3d[i, :rhc].copy(),
        action_ids=action_ids_3d[i, :ac].copy(),
        action_scalars=action_scalars_3d[i, :ac].copy(),
        action_index=action_index,
        log_prob=log_prob,
        value=value,
        reward=reward,
        bootstrap_value=None,
    )


def vec_transition_to_transition(vt: VecTransition) -> Transition:
    """Convert a VecTransition back to a standard Transition for optimize_ppo."""
    sf = StateFeatures(
        scalars=vt.state_scalars.tolist(),
        mode_id=int(vt.state_ids[0]),
        hand_card_ids=vt.hand_card_ids.tolist(),
        deck_card_ids=vt.deck_card_ids.tolist(),
        discard_card_ids=vt.discard_card_ids.tolist(),
        unit_ids=vt.unit_ids.tolist(),
        unit_scalars=vt.unit_scalars.tolist(),
        current_terrain_id=int(vt.state_ids[1]),
        current_site_type_id=int(vt.state_ids[2]),
        combat_enemy_ids=vt.combat_enemy_ids.tolist(),
        combat_enemy_scalars=vt.combat_enemy_scalars.tolist(),
        skill_ids=vt.skill_ids.tolist(),
        visible_site_ids=vt.visible_site_ids.tolist(),
        visible_site_scalars=vt.visible_site_scalars.tolist(),
        map_enemy_ids=vt.map_enemy_ids.tolist(),
        map_enemy_scalars=vt.map_enemy_scalars.tolist(),
        revealed_hex_terrain_ids=vt.revealed_hex_terrain_ids.tolist(),
        revealed_hex_scalars=vt.revealed_hex_scalars.tolist(),
    )
    n_actions = vt.action_ids.shape[0]
    actions = []
    for j in range(n_actions):
        ids = vt.action_ids[j]
        actions.append(ActionFeatures(
            action_type_id=int(ids[0]),
            source_id=int(ids[1]),
            card_id=int(ids[2]),
            unit_id=int(ids[3]),
            enemy_id=int(ids[4]),
            skill_id=int(ids[5]),
            target_enemy_ids=[],
            scalars=vt.action_scalars[j].tolist(),
        ))
    step = EncodedStep(state=sf, actions=actions)
    return Transition(
        encoded_step=step,
        action_index=vt.action_index,
        log_prob=vt.log_prob,
        value=vt.value,
        reward=vt.reward,
        bootstrap_value=vt.bootstrap_value,
    )


@dataclass(frozen=True)
class RewardBreakdown:
    """Per-component reward totals for a completed episode."""
    fame: float = 0.0
    wound_penalty: float = 0.0
    cards_remaining_bonus: float = 0.0
    new_hex_bonus: float = 0.0
    step_penalty: float = 0.0
    terminal_bonus: float = 0.0
    terminal_fame: float = 0.0
    scenario_trigger_bonus: float = 0.0
    wasted_move_penalty: float = 0.0
    backtrack_penalty: float = 0.0
    wound_shaping: float = 0.0
    achievement: float = 0.0
    tile_explore: float = 0.0


@dataclass(frozen=True)
class CompletedEpisodeMeta:
    """Metadata for a completed episode: seed and action indices for replay."""
    seed: int
    action_indices: list[int]
    truncated: bool = False  # True for any artificial cutoff (early or hard limit)
    termination_cause: str = TERMINATION_NATURAL_END
    scenario_end_triggered: bool = False  # True if scenario end condition was met (e.g. city revealed)
    total_fame_delta: int = 0  # Cumulative fame gained during the episode
    tiles_explored: int = 0  # Number of new tiles revealed during the episode
    reward_breakdown: RewardBreakdown = field(default_factory=RewardBreakdown)
    total_wounds: int = 0  # Total wounds gained during the episode
    combats_entered: int = 0  # Number of combats entered during the episode
    turns_resting: int = 0  # Number of turns spent resting
    total_achievement_delta: int = 0  # Cumulative achievement score change (excluding wounds)
    game_score: int = 0  # Official Mage Knight game score (fame + all achievements)
    achievement_breakdown: dict[str, int] | None = None  # Per-category base points


@dataclass
class EpisodeBuffers:
    """Persistent per-env episode buffers that survive across batch boundaries."""
    buffers: list[list[VecTransition]] = field(default_factory=list)
    seeds: list[int] = field(default_factory=list)
    action_indices: list[list[int]] = field(default_factory=list)
    scenario_end_triggered: list[bool] = field(default_factory=list)
    fame_deltas: list[int] = field(default_factory=list)
    # Per-component reward accumulators
    reward_fame: list[float] = field(default_factory=list)
    reward_wound_penalty: list[float] = field(default_factory=list)
    reward_cards_remaining: list[float] = field(default_factory=list)
    reward_new_hex: list[float] = field(default_factory=list)
    reward_step_penalty: list[float] = field(default_factory=list)
    reward_terminal: list[float] = field(default_factory=list)
    reward_terminal_fame: list[float] = field(default_factory=list)
    reward_scenario_trigger: list[float] = field(default_factory=list)
    reward_wasted_move: list[float] = field(default_factory=list)
    reward_backtrack: list[float] = field(default_factory=list)
    reward_wound_shaping: list[float] = field(default_factory=list)
    reward_achievement: list[float] = field(default_factory=list)
    reward_tile_explore: list[float] = field(default_factory=list)
    total_achievement_delta: list[int] = field(default_factory=list)
    tiles_explored: list[int] = field(default_factory=list)
    prev_wound_potential: list[float] = field(default_factory=list)
    total_wounds: list[int] = field(default_factory=list)
    combats_entered: list[int] = field(default_factory=list)
    prev_in_combat: list[bool] = field(default_factory=list)
    turns_resting: list[int] = field(default_factory=list)

    def ensure_size(self, num_envs: int) -> None:
        while len(self.buffers) < num_envs:
            self.buffers.append([])
        while len(self.seeds) < num_envs:
            self.seeds.append(0)
        while len(self.action_indices) < num_envs:
            self.action_indices.append([])
        while len(self.scenario_end_triggered) < num_envs:
            self.scenario_end_triggered.append(False)
        while len(self.fame_deltas) < num_envs:
            self.fame_deltas.append(0)
        for lst in (self.reward_fame, self.reward_wound_penalty,
                    self.reward_cards_remaining, self.reward_new_hex,
                    self.reward_step_penalty, self.reward_terminal,
                    self.reward_terminal_fame,
                    self.reward_scenario_trigger, self.reward_wasted_move,
                    self.reward_backtrack, self.reward_wound_shaping,
                    self.reward_achievement, self.reward_tile_explore):
            while len(lst) < num_envs:
                lst.append(0.0)
        while len(self.total_achievement_delta) < num_envs:
            self.total_achievement_delta.append(0)
        while len(self.tiles_explored) < num_envs:
            self.tiles_explored.append(0)
        while len(self.prev_wound_potential) < num_envs:
            self.prev_wound_potential.append(0.0)
        while len(self.total_wounds) < num_envs:
            self.total_wounds.append(0)
        while len(self.combats_entered) < num_envs:
            self.combats_entered.append(0)
        while len(self.prev_in_combat) < num_envs:
            self.prev_in_combat.append(False)
        while len(self.turns_resting) < num_envs:
            self.turns_resting.append(0)


@dataclass
class CollectionResult:
    """Result from collect_vecenv_rollout."""
    episodes: list[list[VecTransition]]
    total_steps: int
    total_episodes: int
    panicked_episodes: int
    episode_metas: list[CompletedEpisodeMeta] = field(default_factory=list)
    failed_episode_metas: list[CompletedEpisodeMeta] = field(default_factory=list)


def collect_vecenv_rollout(
    vec_env: object,
    policy: ReinforcePolicy,
    reward_config: RewardConfig,
    total_steps: int,
    episode_buffers: EpisodeBuffers | None = None,
) -> CollectionResult:
    """Collect transitions using vectorized environments.

    Runs vec_env in a loop, collecting transitions until total_steps are reached.
    Episodes complete when the engine signals done or max_steps is hit.

    Args:
        vec_env: PyVecEnv instance from mk_python
        policy: ReinforcePolicy with choose_actions_batch
        reward_config: reward shaping config
        total_steps: target number of total steps to collect
        episode_buffers: persistent per-env buffers from previous batch.
            Pass the same EpisodeBuffers object across calls so episodes that
            straddle batch boundaries are collected correctly.

    Returns:
        CollectionResult with completed episodes and step count
    """
    num_envs = vec_env.num_envs()

    if episode_buffers is None:
        episode_buffers = EpisodeBuffers()
    episode_buffers.ensure_size(num_envs)
    bufs = episode_buffers.buffers

    completed_episodes: list[list[VecTransition]] = []
    completed_metas: list[CompletedEpisodeMeta] = []
    failed_metas: list[CompletedEpisodeMeta] = []
    panicked_count = 0
    steps_collected = 0

    # Snapshot seeds for any env whose episode buffer is empty (new episode)
    current_seeds = vec_env.seeds()
    for i in range(num_envs):
        if not bufs[i]:
            episode_buffers.seeds[i] = int(current_seeds[i])
            episode_buffers.action_indices[i] = []
            episode_buffers.scenario_end_triggered[i] = False
            episode_buffers.fame_deltas[i] = 0

    while steps_collected < total_steps:
        # 1. Encode all envs → batched numpy dict
        batch_dict = vec_env.encode_batch()

        # Check for envs with 0 legal actions (engine bug).
        # The Rust side already dumped crash files to training/crashes/ with the
        # game state and full LegalAction history for reproduction.
        if "action_counts" in batch_dict:
            for i in range(num_envs):
                if batch_dict["action_counts"][i] == 0:
                    seed = episode_buffers.seeds[i]
                    step = len(episode_buffers.action_indices[i])
                    raise RuntimeError(
                        f"Engine bug: env {i} has 0 legal actions at step {step}. "
                        f"seed={seed}. Check training/crashes/crash_{seed}_*_actions.json "
                        f"for the full LegalAction replay sequence."
                    )

        # 2. Batched forward pass
        actions, log_probs, values = policy.choose_actions_batch(batch_dict)

        # 3. Step all envs
        step_result = vec_env.step_batch(actions)
        bootstrap_values_by_env: dict[int, float] = {}
        bootstrap_batch = step_result["bootstrap_batch"]
        if bootstrap_batch is not None:
            bootstrap_values = policy.evaluate_values_batch(bootstrap_batch)
            bootstrap_values_by_env = {
                int(env_index): float(value)
                for env_index, value in zip(
                    step_result["bootstrap_indices"], bootstrap_values,
                )
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

        # 4. Process each env
        for i in range(num_envs):
            fame_delta = float(fame_deltas[i])
            fame_reward = reward_config.fame_delta_scale * fame_delta
            reward = fame_reward + reward_config.step_penalty

            episode_buffers.reward_fame[i] += fame_reward
            episode_buffers.reward_step_penalty[i] += reward_config.step_penalty

            # Exploration bonus for visiting new hexes
            if new_hexes[i] > 0 and reward_config.new_hex_bonus != 0.0:
                hex_bonus = reward_config.new_hex_bonus * float(new_hexes[i])
                reward += hex_bonus
                episode_buffers.reward_new_hex[i] += hex_bonus

            # Wound penalty/reward for gaining/healing wounds
            if wound_deltas[i] != 0 and reward_config.wound_penalty != 0.0:
                wound_pen = reward_config.wound_penalty * float(wound_deltas[i])
                reward += wound_pen
                episode_buffers.reward_wound_penalty[i] += wound_pen

            # Quadratic penalty for wasted move points at end of turn
            wasted = int(wasted_move_pts[i])
            if wasted > 0 and reward_config.wasted_move_penalty != 0.0:
                wasted_pen = reward_config.wasted_move_penalty * float(wasted * wasted)
                reward += wasted_pen
                episode_buffers.reward_wasted_move[i] += wasted_pen

            # Backtracking penalty for revisiting hexes within same turn
            if backtrack[i] > 0 and reward_config.backtrack_penalty != 0.0:
                bt_pen = reward_config.backtrack_penalty
                reward += bt_pen
                episode_buffers.reward_backtrack[i] += bt_pen

            # Potential-based wound shaping: γ·φ(s') - φ(s)
            if reward_config.wound_shaping_k != 0.0:
                tc = max(int(total_card_counts[i]), 1)
                ratio = int(wound_counts[i]) / tc
                phi_new = -reward_config.wound_shaping_k * (ratio * ratio)
                phi_old = episode_buffers.prev_wound_potential[i]
                shaping = policy.config.gamma * phi_new - phi_old
                reward += shaping
                episode_buffers.reward_wound_shaping[i] += shaping
                episode_buffers.prev_wound_potential[i] = phi_new

            # Achievement-based reward (spell/AA/artifact/crystal/unit/site acquisition)
            ach_delta = int(achievement_deltas[i])
            if ach_delta != 0:
                episode_buffers.total_achievement_delta[i] += ach_delta
                if reward_config.achievement_reward_scale != 0.0:
                    ach_reward = reward_config.achievement_reward_scale * float(ach_delta)
                    reward += ach_reward
                    episode_buffers.reward_achievement[i] += ach_reward

            # Track tiles explored + progressive tile exploration bonus
            if new_tiles[i] > 0:
                tiles_before = episode_buffers.tiles_explored[i]
                episode_buffers.tiles_explored[i] += int(new_tiles[i])
                if reward_config.tile_explore_bonus != 0.0:
                    # Nth tile explored gives N * tile_explore_bonus
                    tile_num = tiles_before + 1
                    tile_reward = reward_config.tile_explore_bonus * float(tile_num)
                    reward += tile_reward
                    episode_buffers.reward_tile_explore[i] += tile_reward

            # Track wound changes (gains and healing)
            if wound_deltas[i] != 0:
                episode_buffers.total_wounds[i] += int(wound_deltas[i])

            # Track combat entries (transition from not-in-combat to in-combat)
            currently_in_combat = bool(in_combat_flags[i])
            if currently_in_combat and not episode_buffers.prev_in_combat[i]:
                episode_buffers.combats_entered[i] += 1
            episode_buffers.prev_in_combat[i] = currently_in_combat

            # Track rest turns
            if rested_turns_step[i] > 0:
                episode_buffers.turns_resting[i] += int(rested_turns_step[i])

            episode_buffers.fame_deltas[i] += int(fame_deltas[i])

            # Record the actual clamped action index (what the engine applied),
            # not the raw policy output, so replays are faithful.
            applied_idx = int(applied_actions[i])
            episode_buffers.action_indices[i].append(applied_idx)

            # One-time scenario trigger bonus (on first detection)
            if scenario_flags[i] and not episode_buffers.scenario_end_triggered[i]:
                reward += reward_config.scenario_trigger_bonus
                episode_buffers.reward_scenario_trigger[i] += reward_config.scenario_trigger_bonus
                episode_buffers.scenario_end_triggered[i] = True

            # Use raw policy action for gradient computation (matches log_prob)
            action_idx = int(actions[i])
            vt = _extract_vec_transition(
                batch_dict, i,
                action_index=action_idx,
                log_prob=float(log_probs[i]),
                value=float(values[i]),
                reward=reward,
            )
            bufs[i].append(vt)
            steps_collected += 1

            if dones[i]:
                termination_cause = termination_cause_name(int(termination_causes[i]))
                if panicked[i]:
                    # Engine crashed — discard this episode entirely
                    panicked_count += 1
                    failed_metas.append(CompletedEpisodeMeta(
                        seed=episode_buffers.seeds[i],
                        action_indices=list(episode_buffers.action_indices[i]),
                        truncated=False,
                        termination_cause=termination_cause,
                    ))
                    bufs[i] = []
                    episode_buffers.buffers[i] = bufs[i]
                    episode_buffers.action_indices[i] = []
                    episode_buffers.scenario_end_triggered[i] = False
                    episode_buffers.fame_deltas[i] = 0
                    episode_buffers.tiles_explored[i] = 0
                    episode_buffers.reward_fame[i] = 0.0
                    episode_buffers.reward_wound_penalty[i] = 0.0
                    episode_buffers.reward_cards_remaining[i] = 0.0
                    episode_buffers.reward_new_hex[i] = 0.0
                    episode_buffers.reward_step_penalty[i] = 0.0
                    episode_buffers.reward_terminal[i] = 0.0
                    episode_buffers.reward_terminal_fame[i] = 0.0
                    episode_buffers.reward_scenario_trigger[i] = 0.0
                    episode_buffers.reward_wasted_move[i] = 0.0
                    episode_buffers.reward_backtrack[i] = 0.0
                    episode_buffers.reward_wound_shaping[i] = 0.0
                    episode_buffers.reward_achievement[i] = 0.0
                    episode_buffers.reward_tile_explore[i] = 0.0
                    episode_buffers.total_achievement_delta[i] = 0
                    episode_buffers.prev_wound_potential[i] = 0.0
                    episode_buffers.total_wounds[i] = 0
                    episode_buffers.combats_entered[i] = 0
                    episode_buffers.prev_in_combat[i] = False
                    episode_buffers.turns_resting[i] = 0
                    # Snapshot seed for the new (reset) episode
                    new_seeds = vec_env.seeds()
                    episode_buffers.seeds[i] = int(new_seeds[i])
                    continue

                # Normal completion — add terminal reward
                episode = bufs[i]
                is_truncated = bool(truncated_flags[i])
                is_hard_limit = int(termination_causes[i]) == TERMINATION_CAUSE_HARD_LIMIT
                if is_hard_limit:
                    terminal_base = reward_config.terminal_max_steps_penalty
                elif is_truncated:
                    terminal_base = 0.0
                else:
                    terminal_base = reward_config.terminal_end_bonus
                terminal_fame = 0.0
                if not is_truncated:
                    terminal_fame = reward_config.terminal_fame_scale * float(final_fames[i])
                cards_bonus = 0.0
                if reward_config.cards_remaining_bonus != 0.0:
                    cards_bonus = reward_config.cards_remaining_bonus * float(non_wound_hand_sizes[i])
                terminal = terminal_base + terminal_fame + cards_bonus
                episode_buffers.reward_terminal[i] += terminal_base
                episode_buffers.reward_terminal_fame[i] += terminal_fame
                episode_buffers.reward_cards_remaining[i] += cards_bonus
                last = episode[-1]
                episode[-1] = VecTransition(
                    state_scalars=last.state_scalars,
                    state_ids=last.state_ids,
                    hand_card_ids=last.hand_card_ids,
                    deck_card_ids=last.deck_card_ids,
                    discard_card_ids=last.discard_card_ids,
                    unit_ids=last.unit_ids,
                    unit_scalars=last.unit_scalars,
                    combat_enemy_ids=last.combat_enemy_ids,
                    combat_enemy_scalars=last.combat_enemy_scalars,
                    skill_ids=last.skill_ids,
                    visible_site_ids=last.visible_site_ids,
                    visible_site_scalars=last.visible_site_scalars,
                    map_enemy_ids=last.map_enemy_ids,
                    map_enemy_scalars=last.map_enemy_scalars,
                    revealed_hex_terrain_ids=last.revealed_hex_terrain_ids,
                    revealed_hex_scalars=last.revealed_hex_scalars,
                    action_ids=last.action_ids,
                    action_scalars=last.action_scalars,
                    action_index=last.action_index,
                    log_prob=last.log_prob,
                    value=last.value,
                    reward=last.reward + terminal,
                    bootstrap_value=(
                        bootstrap_values_by_env.get(i) if is_truncated else None
                    ),
                )
                breakdown = RewardBreakdown(
                    fame=episode_buffers.reward_fame[i],
                    wound_penalty=episode_buffers.reward_wound_penalty[i],
                    cards_remaining_bonus=episode_buffers.reward_cards_remaining[i],
                    new_hex_bonus=episode_buffers.reward_new_hex[i],
                    step_penalty=episode_buffers.reward_step_penalty[i],
                    terminal_bonus=episode_buffers.reward_terminal[i],
                    terminal_fame=episode_buffers.reward_terminal_fame[i],
                    scenario_trigger_bonus=episode_buffers.reward_scenario_trigger[i],
                    wasted_move_penalty=episode_buffers.reward_wasted_move[i],
                    backtrack_penalty=episode_buffers.reward_backtrack[i],
                    wound_shaping=episode_buffers.reward_wound_shaping[i],
                    achievement=episode_buffers.reward_achievement[i],
                    tile_explore=episode_buffers.reward_tile_explore[i],
                )
                completed_episodes.append(episode)
                completed_metas.append(CompletedEpisodeMeta(
                    seed=episode_buffers.seeds[i],
                    action_indices=list(episode_buffers.action_indices[i]),
                    truncated=bool(truncated_flags[i]),
                    termination_cause=termination_cause,
                    scenario_end_triggered=episode_buffers.scenario_end_triggered[i],
                    total_fame_delta=episode_buffers.fame_deltas[i],
                    tiles_explored=episode_buffers.tiles_explored[i],
                    reward_breakdown=breakdown,
                    total_wounds=episode_buffers.total_wounds[i],
                    combats_entered=episode_buffers.combats_entered[i],
                    turns_resting=episode_buffers.turns_resting[i],
                    total_achievement_delta=episode_buffers.total_achievement_delta[i],
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
                bufs[i] = []
                episode_buffers.buffers[i] = bufs[i]
                episode_buffers.action_indices[i] = []
                episode_buffers.scenario_end_triggered[i] = False
                episode_buffers.fame_deltas[i] = 0
                episode_buffers.tiles_explored[i] = 0
                episode_buffers.reward_fame[i] = 0.0
                episode_buffers.reward_wound_penalty[i] = 0.0
                episode_buffers.reward_cards_remaining[i] = 0.0
                episode_buffers.reward_new_hex[i] = 0.0
                episode_buffers.reward_step_penalty[i] = 0.0
                episode_buffers.reward_terminal[i] = 0.0
                episode_buffers.reward_terminal_fame[i] = 0.0
                episode_buffers.reward_scenario_trigger[i] = 0.0
                episode_buffers.reward_wasted_move[i] = 0.0
                episode_buffers.reward_backtrack[i] = 0.0
                episode_buffers.reward_wound_shaping[i] = 0.0
                episode_buffers.reward_achievement[i] = 0.0
                episode_buffers.reward_tile_explore[i] = 0.0
                episode_buffers.total_achievement_delta[i] = 0
                episode_buffers.prev_wound_potential[i] = 0.0
                episode_buffers.total_wounds[i] = 0
                episode_buffers.combats_entered[i] = 0
                episode_buffers.prev_in_combat[i] = False
                episode_buffers.turns_resting[i] = 0
                # Snapshot seed for the new (reset) episode
                new_seeds = vec_env.seeds()
                episode_buffers.seeds[i] = int(new_seeds[i])

    return CollectionResult(
        episodes=completed_episodes,
        total_steps=steps_collected,
        total_episodes=len(completed_episodes),
        panicked_episodes=panicked_count,
        episode_metas=completed_metas,
        failed_episode_metas=failed_metas,
    )
