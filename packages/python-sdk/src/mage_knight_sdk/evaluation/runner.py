"""Batched, inference-only execution of frozen evaluation suites."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import random
import subprocess
import time
from typing import Any, Protocol

import numpy as np

from .metrics import summarize_cases
from .suite import EvaluationBucket, EvaluationCase, EvaluationSuite


TERMINATION_CAUSES = {
    0: "ongoing",
    1: "natural_end",
    2: "early_zero_fame",
    3: "hard_limit",
    4: "engine_failure",
}


class EvaluationPolicy(Protocol):
    """Minimal action-selection interface used by the evaluator."""

    @property
    def metadata(self) -> dict[str, Any]: ...

    def start_bucket(self, cases: list[EvaluationCase]) -> None: ...

    def choose_actions(
        self,
        batch: dict[str, Any],
        active: list[bool],
    ) -> np.ndarray: ...


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class RandomEvaluationPolicy:
    """Reproducible uniform-random legal-action baseline."""

    def __init__(self, name: str = "random") -> None:
        self.name = name
        self._rngs: list[random.Random] = []

    @property
    def metadata(self) -> dict[str, Any]:
        return {"policy_id": self.name, "policy_type": "uniform_random"}

    def start_bucket(self, cases: list[EvaluationCase]) -> None:
        self._rngs = [
            random.Random((case.engine_seed << 32) ^ case.policy_seed)
            for case in cases
        ]

    def choose_actions(
        self,
        batch: dict[str, Any],
        active: list[bool],
    ) -> np.ndarray:
        counts = batch["action_counts"]
        return np.asarray([
            self._rngs[index].randrange(int(counts[index])) if is_active else 0
            for index, is_active in enumerate(active)
        ], dtype=np.int32)


class CheckpointEvaluationPolicy:
    """Greedy, inference-only policy loaded from a PPO checkpoint."""

    def __init__(
        self,
        checkpoint: str | Path,
        *,
        name: str | None = None,
        device: str = "cpu",
    ) -> None:
        from mage_knight_sdk.sim.rl.policy_gradient import ReinforcePolicy

        self.checkpoint = Path(checkpoint).resolve()
        self.policy, checkpoint_metadata = ReinforcePolicy.load_checkpoint(
            self.checkpoint, device_override=device,
        )
        self.policy._network.eval()
        self.name = name or self.checkpoint.stem
        self.checkpoint_metadata = checkpoint_metadata
        self.checkpoint_hash = sha256_file(self.checkpoint)

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "policy_id": self.name,
            "policy_type": "checkpoint_greedy",
            "checkpoint": str(self.checkpoint),
            "checkpoint_sha256": self.checkpoint_hash,
            "checkpoint_metadata": {
                key: value
                for key, value in self.checkpoint_metadata.items()
                if key != "reward_normalizer"
            },
            "policy_config": asdict(self.policy.config),
        }

    def start_bucket(self, cases: list[EvaluationCase]) -> None:
        del cases

    def choose_actions(
        self,
        batch: dict[str, Any],
        active: list[bool],
    ) -> np.ndarray:
        import torch

        with torch.inference_mode():
            logits, _ = self.policy._network.forward_batch(batch, self.policy._device)
            selected = logits.argmax(dim=-1).detach().cpu().numpy().astype(np.int32)
        selected[np.logical_not(np.asarray(active, dtype=np.bool_))] = 0
        return selected


def _git_revision() -> dict[str, Any]:
    try:
        return {
            "commit": subprocess.check_output(
                ["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL,
            ).strip(),
            "dirty": bool(subprocess.check_output(
                ["git", "status", "--porcelain"], text=True, stderr=subprocess.DEVNULL,
            ).strip()),
        }
    except (FileNotFoundError, subprocess.CalledProcessError):
        return {"commit": "unknown", "dirty": False}


def _scenario_json(bucket: EvaluationBucket) -> str | None:
    if bucket.scenario is None:
        return None
    return json.dumps(bucket.scenario, sort_keys=True, separators=(",", ":"))


def _case_success(case: EvaluationCase, result: dict[str, Any], index: int) -> bool:
    if case.success_metric == "scenario_triggered":
        return bool(result["scenario_end_triggered"][index])
    if case.success_metric == "fame_positive":
        return int(result["fames"][index]) > 0
    if case.success_metric == "natural_end":
        return int(result["termination_causes"][index]) == 1
    raise ValueError(f"Unsupported success metric: {case.success_metric}")


def _evaluate_bucket(
    bucket: EvaluationBucket,
    policy: EvaluationPolicy,
) -> tuple[list[dict[str, Any]], int]:
    from mk_python import PyVecEnv

    cases = bucket.expand_cases()
    env = PyVecEnv(
        num_envs=len(cases),
        base_seed=bucket.base_seed,
        hero=bucket.hero,
        max_steps=bucket.max_steps,
        scenario=_scenario_json(bucket),
        combat_oracle=False,
        commerce_oracle=False,
        early_term_fame_step=0,
    )
    policy.start_bucket(cases)
    active = [True] * len(cases)
    steps = [0] * len(cases)
    wounds_gained = [0] * len(cases)
    wounds_healed = [0] * len(cases)
    rests = [0] * len(cases)
    tiles = [0] * len(cases)
    combats = [0] * len(cases)
    previously_in_combat = [False] * len(cases)
    records: list[dict[str, Any] | None] = [None] * len(cases)
    active_transitions = 0

    while any(active):
        batch = env.encode_batch()
        actions = policy.choose_actions(batch, active)
        result = env.step_batch(actions)
        for index, is_active in enumerate(active):
            if not is_active:
                continue
            active_transitions += 1
            steps[index] += 1
            delta = int(result["wound_deltas"][index])
            wounds_gained[index] += max(0, delta)
            wounds_healed[index] += max(0, -delta)
            rests[index] += int(result["rested_turns"][index])
            tiles[index] += int(result["new_tiles"][index])
            in_combat = bool(result["in_combat"][index])
            if in_combat and not previously_in_combat[index]:
                combats[index] += 1
            previously_in_combat[index] = in_combat

            if not bool(result["dones"][index]):
                continue
            case = cases[index]
            cause_code = int(result["termination_causes"][index])
            crystals = [int(value) for value in result["crystal_counts"][index]]
            achievements = [int(value) for value in result["achievement_categories"][index]]
            records[index] = {
                "case_id": case.case_id,
                "bucket_id": case.bucket_id,
                "category": case.category,
                "difficulty": case.difficulty,
                "hero": case.hero,
                "engine_seed": case.engine_seed,
                "policy_seed": case.policy_seed,
                "success_metric": case.success_metric,
                "success": _case_success(case, result, index),
                "natural_end": cause_code == 1,
                "termination_cause": TERMINATION_CAUSES.get(cause_code, f"unknown_{cause_code}"),
                "steps": steps[index],
                "fame": int(result["fames"][index]),
                "game_score": int(result["game_scores"][index]),
                "scenario_triggered": bool(result["scenario_end_triggered"][index]),
                "final_wounds": int(result["wound_counts"][index]),
                "wounds_gained": wounds_gained[index],
                "wounds_healed": wounds_healed[index],
                "turns_resting": rests[index],
                "tiles_explored": tiles[index],
                "combats_entered": combats[index],
                "achievement_breakdown": {
                    name: achievements[position]
                    for position, name in enumerate([
                        "knowledge", "loot", "leader", "conqueror",
                        "adventurer", "beating",
                    ])
                },
                "final_resources": {
                    "level": int(result["player_levels"][index]),
                    "reputation": int(result["reputations"][index]),
                    "round": int(result["rounds"][index]),
                    "hand": int(result["hand_sizes"][index]),
                    "non_wound_hand": int(result["non_wound_hand_sizes"][index]),
                    "deck": int(result["deck_sizes"][index]),
                    "discard": int(result["discard_sizes"][index]),
                    "total_cards": int(result["total_card_counts"][index]),
                    "crystals": sum(crystals),
                    "red_crystals": crystals[0],
                    "blue_crystals": crystals[1],
                    "green_crystals": crystals[2],
                    "white_crystals": crystals[3],
                    "units": int(result["unit_counts"][index]),
                    "ready_units": int(result["ready_unit_counts"][index]),
                    "wounded_units": int(result["wounded_unit_counts"][index]),
                    "skills": int(result["skill_counts"][index]),
                },
            }
            active[index] = False

    return [record for record in records if record is not None], active_transitions


def run_suite(
    suite: EvaluationSuite,
    policy: EvaluationPolicy,
    output_dir: str | Path,
    *,
    bucket_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Run a suite and persist manifest, per-case data, and aggregates."""
    selected = [
        bucket for bucket in suite.buckets
        if bucket_ids is None or bucket.bucket_id in bucket_ids
    ]
    unknown = (bucket_ids or set()) - {bucket.bucket_id for bucket in suite.buckets}
    if unknown:
        raise ValueError(f"Unknown evaluation buckets: {', '.join(sorted(unknown))}")
    if not selected:
        raise ValueError("No evaluation buckets selected")

    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    all_cases: list[dict[str, Any]] = []
    transitions = 0
    for bucket in selected:
        bucket_cases, bucket_transitions = _evaluate_bucket(bucket, policy)
        all_cases.extend(bucket_cases)
        transitions += bucket_transitions
        print(
            f"  {bucket.bucket_id}: {len(bucket_cases)} cases, "
            f"success={sum(case['success'] for case in bucket_cases) / len(bucket_cases):.1%}"
        )
    elapsed = time.perf_counter() - started

    manifest = {
        "schema_version": 1,
        "created_at": datetime.now(UTC).isoformat(),
        "suite_id": suite.suite_id,
        "suite_hash": suite.content_hash,
        "suite_locked": suite.locked,
        "score_version": suite.score_version,
        "regression_thresholds": suite.regression_thresholds,
        "complete_suite": len(selected) == len(suite.buckets),
        "selected_buckets": [bucket.bucket_id for bucket in selected],
        "policy": policy.metadata,
        "git": _git_revision(),
        "runtime": {
            "wall_seconds": elapsed,
            "active_transitions": transitions,
            "transitions_per_second": transitions / elapsed if elapsed > 0 else 0.0,
        },
    }
    summary = {
        "manifest": manifest,
        "metrics": summarize_cases(all_cases),
    }
    (target / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8",
    )
    with (target / "cases.ndjson").open("w", encoding="utf-8") as stream:
        for case in all_cases:
            stream.write(json.dumps(case, sort_keys=True) + "\n")
    (target / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8",
    )
    return summary


def load_cases(path: str | Path) -> list[dict[str, Any]]:
    """Load the per-case artifact from a result directory or NDJSON path."""
    source = Path(path)
    if source.is_dir():
        source = source / "cases.ndjson"
    with source.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]
