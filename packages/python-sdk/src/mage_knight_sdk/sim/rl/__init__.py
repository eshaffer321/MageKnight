"""Reinforcement-learning utilities for Mage Knight simulation training."""

from .features import ActionFeatures, EncodedStep, StateFeatures
from .mcts import BatchedMCTS, MCTSConfig, MCTSNode, MCTSSearchReport, MCTSTree
from .native_rl_runner import (
    EpisodeTrainingStats,
    NativeRunResult,
    py_encoded_to_encoded_step,
    run_native_rl_game,
    run_native_rl_game_ppo,
)
from .policy_gradient import (
    OptimizationStats,
    PolicyGradientConfig,
    ReinforcePolicy,
    StepInfo,
    Transition,
    compute_gae,
)
from .rewards import RewardConfig
from .vocabularies import (
    ACTION_TYPE_VOCAB,
    CARD_VOCAB,
    ENEMY_VOCAB,
    MODE_VOCAB,
    SITE_VOCAB,
    SKILL_VOCAB,
    SOURCE_VOCAB,
    TERRAIN_VOCAB,
    UNIT_VOCAB,
    Vocabulary,
)

__all__ = [
    "ActionFeatures",
    "ACTION_TYPE_VOCAB",
    "BatchedMCTS",
    "CARD_VOCAB",
    "ENEMY_VOCAB",
    "EncodedStep",
    "EpisodeTrainingStats",
    "MODE_VOCAB",
    "MCTSConfig",
    "MCTSNode",
    "MCTSSearchReport",
    "MCTSTree",
    "NativeRunResult",
    "OptimizationStats",
    "PolicyGradientConfig",
    "ReinforcePolicy",
    "RewardConfig",
    "SITE_VOCAB",
    "SKILL_VOCAB",
    "SOURCE_VOCAB",
    "StateFeatures",
    "TERRAIN_VOCAB",
    "StepInfo",
    "Transition",
    "UNIT_VOCAB",
    "Vocabulary",
    "compute_gae",
    "py_encoded_to_encoded_step",
    "run_native_rl_game",
    "run_native_rl_game_ppo",
]
