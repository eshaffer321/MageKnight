"""Offline adaptive curriculum plans derived from locked evaluation results."""

from __future__ import annotations

from collections import defaultdict
import math
import random
from typing import Any

from .suite import EvaluationSuite


def weighted_bucket_sequence(
    weights: dict[str, float], count: int, rng: random.Random,
) -> list[str]:
    """Draw a deterministic weighted bucket sequence using an injected RNG."""
    names = sorted(weights)
    return rng.choices(names, weights=[weights[name] for name in names], k=count)


class AdaptiveCurriculum:
    """Prioritize mechanics whose success rate lies in a learnable weak band.

    Buckets in the 40-70% range receive full priority. Very hard buckets are
    sampled less until prerequisites improve; mastered buckets retain a floor
    probability so regressions remain visible.
    """

    def __init__(
        self,
        target_low: float = 0.40,
        target_high: float = 0.70,
        minimum_priority: float = 0.10,
    ) -> None:
        if not 0.0 < target_low < target_high < 1.0:
            raise ValueError("Adaptive target band must lie strictly inside (0, 1)")
        if not 0.0 < minimum_priority <= 1.0:
            raise ValueError("minimum_priority must lie in (0, 1]")
        self.target_low = target_low
        self.target_high = target_high
        self.minimum_priority = minimum_priority

    def weights_from_success_rates(self, rates: dict[str, float]) -> dict[str, float]:
        priorities: dict[str, float] = {}
        for bucket_id, raw_rate in rates.items():
            rate = min(1.0, max(0.0, float(raw_rate)))
            if self.target_low <= rate <= self.target_high:
                priority = 1.0
            elif rate < self.target_low:
                priority = max(self.minimum_priority, rate / self.target_low)
            else:
                priority = max(
                    self.minimum_priority,
                    (1.0 - rate) / (1.0 - self.target_high),
                )
            priorities[bucket_id] = priority
        total = sum(priorities.values())
        if total <= 0.0:
            return {name: 1.0 / len(priorities) for name in priorities}
        return {name: value / total for name, value in priorities.items()}

    def success_rates(self, cases: list[dict[str, Any]]) -> dict[str, float]:
        outcomes: dict[str, list[bool]] = defaultdict(list)
        for case in cases:
            outcomes[str(case["bucket_id"])].append(bool(case.get("success")))
        return {
            bucket_id: sum(values) / len(values)
            for bucket_id, values in outcomes.items()
            if values
        }

    def build_plan(
        self,
        suite: EvaluationSuite,
        cases: list[dict[str, Any]],
        *,
        total_episodes: int,
        seed: int,
        block_episodes: int = 4096,
    ) -> dict[str, Any]:
        """Allocate and interleave the next run across weak mechanics buckets."""
        if total_episodes < 1:
            raise ValueError("total_episodes must be positive")
        if block_episodes < 1:
            raise ValueError("block_episodes must be positive")
        eligible = {
            bucket.bucket_id: bucket
            for bucket in suite.buckets
            if bucket.adaptive_eligible
        }
        if not eligible:
            raise ValueError("Suite has no adaptive-eligible buckets")
        measured = self.success_rates(cases)
        rates = {bucket_id: measured.get(bucket_id, 0.50) for bucket_id in eligible}
        weights = self.weights_from_success_rates(rates)

        raw = {name: total_episodes * weight for name, weight in weights.items()}
        allocations = {name: int(value) for name, value in raw.items()}
        remaining = total_episodes - sum(allocations.values())
        order = sorted(
            allocations,
            key=lambda name: (raw[name] - allocations[name], name),
            reverse=True,
        )
        for name in order[:remaining]:
            allocations[name] += 1

        phases: list[dict[str, Any]] = []
        # Interleave bounded blocks rather than training one giant bucket at a
        # time. The remaining allocation constrains draws so the final plan still
        # exactly matches the measured weights and requested episode count.
        rng = random.Random(seed)
        chunks_by_bucket: dict[str, list[int]] = {}
        for bucket_id, allocation in allocations.items():
            if allocation <= 0:
                continue
            chunk_count = math.ceil(allocation / block_episodes)
            quotient, remainder = divmod(allocation, chunk_count)
            chunks_by_bucket[bucket_id] = [
                quotient + (1 if index < remainder else 0)
                for index in range(chunk_count)
            ]
        while chunks_by_bucket:
            available = sorted(
                name for name, chunks in chunks_by_bucket.items() if chunks
            )
            bucket_id = rng.choices(
                available,
                weights=[weights[name] for name in available],
                k=1,
            )[0]
            bucket = eligible[bucket_id]
            episodes = chunks_by_bucket[bucket_id].pop()
            if not chunks_by_bucket[bucket_id]:
                del chunks_by_bucket[bucket_id]
            phases.append({
                "name": f"adaptive_{len(phases) + 1:03d}_{bucket_id}",
                "bucket_id": bucket_id,
                "episodes": episodes,
                "max_steps": bucket.max_steps,
                "hero": bucket.hero,
                "scenario": bucket.scenario,
                "reward_config": bucket.training_reward,
                "measured_success_rate": rates[bucket_id],
                "sampling_weight": weights[bucket_id],
            })
        return {
            "schema_version": 1,
            "plan_type": "adaptive_curriculum",
            "source_suite_id": suite.suite_id,
            "source_suite_hash": suite.content_hash,
            "target_success_band": [self.target_low, self.target_high],
            "requirements": {
                "combat_oracle": False,
                "commerce_oracle": False,
            },
            "seed": seed,
            "total_episodes": total_episodes,
            "block_episodes": block_episodes,
            "bucket_allocations": allocations,
            "phases": phases,
        }
