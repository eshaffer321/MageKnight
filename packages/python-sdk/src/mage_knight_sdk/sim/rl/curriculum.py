"""Curriculum learning for RL training.

Two abstractions:
- TrainingScenario: Python mirror of Rust enum, serializes to JSON for PyO3 boundary.
- CurriculumPhase + CurriculumSchedule: building blocks pairing scenario with reward config.

Same neural network throughout — EncodedStep dimensions are identical regardless of scenario.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from .rewards import RewardConfig


# =============================================================================
# TrainingScenario — Python mirror of Rust TrainingScenario enum
# =============================================================================


@dataclass(frozen=True)
class TrainingScenario:
    """Python mirror of the Rust TrainingScenario enum.

    Serializes to JSON for the PyO3 boundary. The Rust side deserializes
    via serde with `#[serde(tag = "type")]`.
    """

    kind: str = "full_game"
    params: dict = field(default_factory=dict)

    @staticmethod
    def full_game() -> TrainingScenario:
        return TrainingScenario(kind="full_game")

    @staticmethod
    def combat_drill(
        enemy_tokens: list[str] | None = None,
        is_fortified: bool = False,
        hand_override: list[str] | None = None,
        extra_cards: list[str] | None = None,
        units: list[str] | None = None,
        skills: list[str] | None = None,
        crystals: dict | None = None,
    ) -> TrainingScenario:
        if enemy_tokens is None:
            enemy_tokens = ["diggers_1"]
        params: dict = {"enemy_tokens": enemy_tokens, "is_fortified": is_fortified}
        for key, value in [
            ("hand_override", hand_override),
            ("extra_cards", extra_cards),
            ("units", units),
            ("skills", skills),
            ("crystals", crystals),
        ]:
            if value is not None:
                params[key] = value
        return TrainingScenario(
            kind="combat_drill",
            params=params,
        )

    @staticmethod
    def exploration_drill(
        countryside_count: int | None = None,
        hand_override: list[str] | None = None,
        extra_cards: list[str] | None = None,
    ) -> TrainingScenario:
        params: dict = {}
        if countryside_count is not None:
            params["countryside_count"] = countryside_count
        if hand_override is not None:
            params["hand_override"] = hand_override
        if extra_cards is not None:
            params["extra_cards"] = extra_cards
        return TrainingScenario(kind="exploration_drill", params=params)

    def to_rust_json(self) -> str | None:
        """Serialize to JSON for PyVecEnv(scenario=...).

        Returns None for full_game (Rust default), JSON string otherwise.
        """
        if self.kind == "full_game":
            return None
        if self.kind == "combat_drill":
            obj: dict = {
                "type": "CombatDrill",
                "enemy_tokens": self.params.get("enemy_tokens", ["diggers_1"]),
                "is_fortified": self.params.get("is_fortified", False),
            }
            for key in ("hand_override", "extra_cards", "units", "skills", "crystals"):
                value = self.params.get(key)
                if value is not None:
                    obj[key] = value
            return json.dumps(obj)
        if self.kind == "exploration_drill":
            obj: dict = {"type": "ExplorationDrill"}
            for key in ("countryside_count", "hand_override", "extra_cards"):
                value = self.params.get(key)
                if value is not None:
                    obj[key] = value
            return json.dumps(obj)
        raise ValueError(f"Unknown scenario kind: {self.kind}")


# =============================================================================
# CurriculumPhase + CurriculumSchedule
# =============================================================================


@dataclass(frozen=True)
class CurriculumPhase:
    """One building block: scenario + reward config + episode count."""

    name: str
    scenario: TrainingScenario
    reward_config: RewardConfig
    episodes: int
    max_steps: int = 2000
    early_term_fame_step: int | None = None

    def resolve_early_term_fame_step(self, global_default: int) -> int:
        """Return the phase cutoff, falling back to the legacy CLI default."""
        if self.early_term_fame_step is None:
            return global_default
        return self.early_term_fame_step


@dataclass(frozen=True)
class CurriculumSchedule:
    """Ordered list of phases. Same network throughout."""

    phases: list[CurriculumPhase]


# =============================================================================
# Built-in schedules
# =============================================================================


def default_combat_curriculum() -> CurriculumSchedule:
    """Default curriculum — straight to full game with combat oracle.

    Combat drill phases are no longer needed because the combat oracle
    auto-resolves combat optimally during FullGame training. The agent
    learns strategic decisions (movement, when to fight, site interactions)
    while combat tactics are handled by the oracle.
    """
    # Combat drill phases commented out — oracle handles combat now.
    # fame_only = RewardConfig(
    #     fame_delta_scale=5.0,
    # )
    # fame_efficient = RewardConfig(
    #     fame_delta_scale=5.0,
    #     wound_penalty=-2.0,
    #     cards_remaining_bonus=0.3,
    # )
    return CurriculumSchedule(phases=[
        # CurriculumPhase(
        #     name="combat_warmup",
        #     scenario=TrainingScenario.combat_drill(
        #         enemy_tokens=["diggers_1"],
        #         hand_override=["rage", "arythea_battle_versatility", "determination", "stamina", "concentration"],
        #     ),
        #     reward_config=fame_only,
        #     episodes=5000,
        #     max_steps=200,
        # ),
        # CurriculumPhase(
        #     name="combat_random",
        #     scenario=TrainingScenario.combat_drill(
        #         enemy_tokens=["diggers_1"],
        #     ),
        #     reward_config=fame_efficient,
        #     episodes=20000,
        #     max_steps=200,
        # ),
        # CurriculumPhase(
        #     name="combat_refined",
        #     scenario=TrainingScenario.combat_drill(
        #         enemy_tokens=["diggers_1"],
        #     ),
        #     reward_config=fame_efficient,
        #     episodes=25000,
        #     max_steps=200,
        # ),
        CurriculumPhase(
            name="full_game",
            scenario=TrainingScenario.full_game(),
            reward_config=RewardConfig(
                fame_delta_scale=1.0,
                new_hex_bonus=0.0,
                wound_penalty=-0.5,
                wound_shaping_k=10.0,
                scenario_trigger_bonus=2.0,
                achievement_reward_scale=1.0,
                wasted_move_penalty=-0.02,
                tile_explore_bonus=0.0,
            ),
            episodes=500000,
            max_steps=2000,
        ),
    ])


def guardsmen_combat_curriculum() -> CurriculumSchedule:
    """Guardsmen-based curriculum forcing basic/powered card play.

    Guardsmen have 7 armor — sideways-only (5 attack max) can't kill them.
    The agent must discover basic plays (Rage basic = 2) and powered plays
    (Rage powered = 4) to reach the 7-attack threshold.
    """
    fame_efficient = RewardConfig(
        fame_delta_scale=5.0,
        wound_penalty=-4.0,
        cards_remaining_bonus=0.3,
    )
    return CurriculumSchedule(phases=[
        CurriculumPhase(
            name="guardsmen_fixed",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["guardsmen_1"],
                hand_override=["rage", "arythea_battle_versatility",
                               "determination", "stamina", "concentration"],
            ),
            reward_config=fame_efficient,
            episodes=20000,
            max_steps=200,
        ),
        CurriculumPhase(
            name="guardsmen_random",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["guardsmen_1"],
            ),
            reward_config=fame_efficient,
            episodes=40000,
            max_steps=200,
        ),
    ])


def progressive_combat_curriculum() -> CurriculumSchedule:
    """6-phase linear curriculum building combat skills incrementally.

    Phase 1: Sideways warmup — fixed hand, diggers, no wound penalty
    Phase 2: Basic plays — random hand, prowlers, cards_remaining_bonus
    Phase 3: Powered plays — wolf riders (4 armor), 3 red crystals
    Phase 4: Unit combat — prowlers + peasants unit
    Phase 5: Harder enemies — swordsmen (5 armor, 6 attack), all tools
    Phase 6: Multi-enemy — 2x prowlers, resource allocation
    """
    fame_only = RewardConfig(
        fame_delta_scale=5.0,
    )
    fame_efficient = RewardConfig(
        fame_delta_scale=5.0,
        cards_remaining_bonus=0.5,
    )
    fame_wound = RewardConfig(
        fame_delta_scale=5.0,
        wound_penalty=-1.0,
        cards_remaining_bonus=0.3,
    )
    fame_wound_heavy = RewardConfig(
        fame_delta_scale=5.0,
        wound_penalty=-2.0,
        cards_remaining_bonus=0.3,
    )
    red_crystals = {"red": 3, "blue": 0, "green": 0, "white": 0}

    return CurriculumSchedule(phases=[
        # Phase 1: sideways warmup — every episode solvable
        CurriculumPhase(
            name="sideways_warmup",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["diggers_1"],
                hand_override=[
                    "rage", "arythea_battle_versatility",
                    "determination", "stamina", "concentration",
                ],
            ),
            reward_config=fame_only,
            episodes=5000,
            max_steps=200,
        ),
        # Phase 2: basic plays — cards_remaining_bonus rewards efficiency
        CurriculumPhase(
            name="basic_plays",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["prowlers_1"],
            ),
            reward_config=fame_efficient,
            episodes=15000,
            max_steps=200,
        ),
        # Phase 3: powered plays — 4 armor needs powered rage/battle_versatility
        CurriculumPhase(
            name="powered_plays",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["wolf_riders_1"],
                crystals=red_crystals,
            ),
            reward_config=fame_wound,
            episodes=20000,
            max_steps=200,
        ),
        # Phase 4: unit combat — peasants provide free attack value
        CurriculumPhase(
            name="unit_combat",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["prowlers_1"],
                units=["peasants"],
            ),
            reward_config=fame_wound,
            episodes=15000,
            max_steps=200,
        ),
        # Phase 5: harder enemies — must combine all skills to survive
        CurriculumPhase(
            name="harder_enemies",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["swordsmen_1"],
                units=["peasants"],
                crystals=red_crystals,
            ),
            reward_config=fame_wound_heavy,
            episodes=20000,
            max_steps=200,
        ),
        # Phase 6: multi-enemy — resource allocation across 2 targets
        CurriculumPhase(
            name="multi_enemy",
            scenario=TrainingScenario.combat_drill(
                enemy_tokens=["prowlers_1", "prowlers_2"],
                units=["peasants"],
                crystals=red_crystals,
            ),
            reward_config=fame_wound_heavy,
            episodes=25000,
            max_steps=300,
        ),
    ])


def combat_to_full_game_curriculum() -> CurriculumSchedule:
    """Full game curriculum with short → long horizon ramp.

    Combat oracle handles combat automatically, so no combat drill phases needed.
    Two phases: short horizon for dense exploration feedback, then scale up.
    """
    # Full game: dense rewards for exploration + fame
    explore_dense = RewardConfig(
        fame_delta_scale=2.0,
        new_hex_bonus=1.0,
        wound_penalty=-0.5,
    )
    # Full game: longer horizon, dial back exploration bonus
    explore_scaled = RewardConfig(
        fame_delta_scale=2.0,
        new_hex_bonus=0.5,
        wound_penalty=-1.0,
    )

    return CurriculumSchedule(phases=[
        # Combat refresh phase commented out — oracle handles combat now.
        # CurriculumPhase(
        #     name="combat_refresh",
        #     scenario=TrainingScenario.combat_drill(
        #         enemy_tokens=["prowlers_1", "prowlers_2"],
        #         units=["peasants"],
        #         crystals={"red": 3, "blue": 0, "green": 0, "white": 0},
        #     ),
        #     reward_config=RewardConfig(
        #         fame_delta_scale=5.0,
        #         cards_remaining_bonus=0.3,
        #     ),
        #     episodes=5000,
        #     max_steps=300,
        # ),
        # Phase 1: full game, short horizon — learn to move and explore
        CurriculumPhase(
            name="explore_short",
            scenario=TrainingScenario.full_game(),
            reward_config=explore_dense,
            episodes=50000,
            max_steps=500,
        ),
        # Phase 2: full game, longer horizon — scale up
        CurriculumPhase(
            name="explore_long",
            scenario=TrainingScenario.full_game(),
            reward_config=explore_scaled,
            episodes=100000,
            max_steps=2000,
        ),
    ])


def exploration_curriculum() -> CurriculumSchedule:
    """Exploration-only diagnostic — no enemies, just map traversal.

    Tests whether the agent can learn pure movement/exploration without
    combat distractions. Two phases: tiny map for fast iteration, then
    default-sized map.
    """
    explore_reward = RewardConfig(
        fame_delta_scale=0.0,
        new_hex_bonus=0.5,
        tile_explore_bonus=5.0,
        scenario_trigger_bonus=20.0,
        wasted_move_penalty=-0.05,
    )
    return CurriculumSchedule(phases=[
        # Phase 1: tiny map (2 countryside + city) — easy to solve
        CurriculumPhase(
            name="explore_tiny",
            scenario=TrainingScenario.exploration_drill(countryside_count=2),
            reward_config=explore_reward,
            episodes=50000,
            max_steps=500,
        ),
        # Phase 2: default map (4 countryside + city) — full exploration
        CurriculumPhase(
            name="explore_default",
            scenario=TrainingScenario.exploration_drill(countryside_count=4),
            reward_config=explore_reward,
            episodes=200000,
            max_steps=2000,
        ),
    ])


CURRICULA: dict[str, callable] = {
    "default": default_combat_curriculum,
    "guardsmen": guardsmen_combat_curriculum,
    "progressive": progressive_combat_curriculum,
    "full_game": combat_to_full_game_curriculum,
    "exploration": exploration_curriculum,
}
