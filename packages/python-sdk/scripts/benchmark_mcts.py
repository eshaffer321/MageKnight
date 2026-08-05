#!/usr/bin/env python3
"""Run standalone batched MCTS against real Rust search states.

This benchmark never calls the PPO rollout collector. It intentionally uses the
current policy/value network only as an inference function for isolated search roots.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from mage_knight_sdk.sim.rl.mcts import BatchedMCTS, MCTSConfig
from mage_knight_sdk.sim.rl.policy_gradient import (
    PolicyGradientConfig,
    ReinforcePolicy,
)
from mk_python import PyVecEnv


def _policy(args: argparse.Namespace) -> ReinforcePolicy:
    if args.checkpoint is not None:
        policy, _ = ReinforcePolicy.load_checkpoint(
            Path(args.checkpoint), device_override=args.device,
        )
        return policy
    torch.manual_seed(args.seed)
    return ReinforcePolicy(PolicyGradientConfig(
        hidden_size=args.hidden_size,
        embedding_dim=args.embedding_dim,
        d_model=args.d_model,
        device=args.device,
    ))


def _varied_real_states(num_envs: int, seed: int) -> PyVecEnv:
    env = PyVecEnv(
        num_envs=num_envs,
        base_seed=seed,
        hero="arythea",
        max_steps=500,
    )
    initial = env.encode_batch()
    actions = np.asarray(
        [index % int(count) for index, count in enumerate(initial["action_counts"])],
        dtype=np.int32,
    )
    env.step_batch(actions)
    return env


def run(args: argparse.Namespace) -> list[dict[str, object]]:
    env = _varied_real_states(args.num_envs, args.seed)
    policy = _policy(args)
    rows: list[dict[str, object]] = []
    search = BatchedMCTS(
        env,
        policy.evaluate_search_batch,
        MCTSConfig(
            simulations=max(args.budgets),
            c_puct=args.c_puct,
            leaves_per_root_per_wave=args.leaves_per_root_per_wave,
            combat_mode=args.combat_mode,
            random_seed=args.seed,
        ),
    )
    try:
        for budget in args.budgets:
            search.reset_roots(range(args.num_envs))
            report = search.search(simulations=budget)
            visit_counts = search.root_visit_counts()
            distributions = search.action_probabilities(temperature=1.0)
            preferred_actions = [int(np.argmax(counts)) for counts in visit_counts]
            sampled_actions = search.select_actions(temperature=1.0).tolist()
            roots_with_multiple_visited_actions = sum(
                int(np.count_nonzero(counts) > 1) for counts in visit_counts
            )
            row: dict[str, object] = {
                "budget": budget,
                "roots": args.num_envs,
                "total_simulations": report.total_simulations,
                "simulations_per_second": round(report.simulations_per_second, 2),
                "batch_wall_ms": round(report.wall_time_seconds * 1_000.0, 2),
                "decision_latency_ms": round(
                    report.decision_latency_seconds * 1_000.0, 2,
                ),
                "amortized_ms_per_decision": round(
                    report.amortized_seconds_per_decision * 1_000.0, 2,
                ),
                "network_batches": report.network_batches,
                "evaluated_nodes": report.evaluated_nodes,
                "expansion_batches": report.expansion_batches,
                "preferred_actions": preferred_actions,
                "sampled_actions": sampled_actions,
                "distinct_preferred_actions": len(set(preferred_actions)),
                "roots_with_multiple_visited_actions": (
                    roots_with_multiple_visited_actions
                ),
                "non_degenerate": (
                    roots_with_multiple_visited_actions == args.num_envs
                    and len(set(preferred_actions)) > 1
                ),
                "visit_counts": [counts.tolist() for counts in visit_counts],
                "visit_probabilities": [
                    np.round(distribution, 4).tolist()
                    for distribution in distributions
                ],
            }
            rows.append(row)
            print(json.dumps(row, sort_keys=True))
            search.close()
    finally:
        search.close()
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--num-envs", type=int, default=4)
    parser.add_argument("--budgets", type=int, nargs="+", default=[16, 32, 64])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--c-puct", type=float, default=1.5)
    parser.add_argument("--leaves-per-root-per-wave", type=int, default=4)
    parser.add_argument("--combat-mode", default="cheap")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--hidden-size", type=int, default=64)
    parser.add_argument("--embedding-dim", type=int, default=8)
    parser.add_argument("--d-model", type=int, default=32)
    parser.add_argument("--checkpoint")
    args = parser.parse_args()
    if args.num_envs <= 0:
        parser.error("--num-envs must be positive")
    if any(budget <= 0 for budget in args.budgets):
        parser.error("all --budgets must be positive")
    return args


if __name__ == "__main__":
    run(parse_args())

