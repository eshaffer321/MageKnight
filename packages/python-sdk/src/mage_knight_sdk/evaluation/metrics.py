"""Aggregation and paired-comparison metrics for evaluation cases."""

from __future__ import annotations

from collections import defaultdict
import math
import statistics
from typing import Any, Iterable


def _percentile(sorted_values: list[float], fraction: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = fraction * (len(sorted_values) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight


def numeric_summary(values: Iterable[int | float]) -> dict[str, float]:
    """Return stable descriptive statistics without optional dependencies."""
    numbers = sorted(float(value) for value in values)
    if not numbers:
        return {
            "mean": 0.0, "median": 0.0, "std": 0.0,
            "min": 0.0, "p10": 0.0, "p90": 0.0, "max": 0.0,
        }
    return {
        "mean": statistics.fmean(numbers),
        "median": statistics.median(numbers),
        "std": statistics.pstdev(numbers),
        "min": numbers[0],
        "p10": _percentile(numbers, 0.10),
        "p90": _percentile(numbers, 0.90),
        "max": numbers[-1],
    }


def summarize_cases(cases: list[dict[str, Any]], *, include_groups: bool = True) -> dict[str, Any]:
    """Aggregate skill, consistency, efficiency, and terminal resources."""
    count = len(cases)
    if count == 0:
        return {"case_count": 0, "success_rate": 0.0, "natural_end_rate": 0.0}

    total_fame = sum(float(case.get("fame", 0)) for case in cases)
    total_wounds = sum(float(case.get("final_wounds", 0)) for case in cases)
    resources: dict[str, list[float]] = defaultdict(list)
    for case in cases:
        for key, value in case.get("final_resources", {}).items():
            if isinstance(value, (int, float)):
                resources[key].append(float(value))

    summary: dict[str, Any] = {
        "case_count": count,
        "success_rate": sum(bool(case.get("success")) for case in cases) / count,
        "natural_end_rate": sum(bool(case.get("natural_end")) for case in cases) / count,
        "game_score": numeric_summary(case.get("game_score", 0) for case in cases),
        "fame": numeric_summary(case.get("fame", 0) for case in cases),
        "steps": numeric_summary(case.get("steps", 0) for case in cases),
        "final_wounds": numeric_summary(case.get("final_wounds", 0) for case in cases),
        "wounds_gained": numeric_summary(case.get("wounds_gained", 0) for case in cases),
        "wound_efficiency": {
            "wounds_per_fame": total_wounds / total_fame if total_fame > 0 else 0.0,
            "fame_per_wound": total_fame / total_wounds if total_wounds > 0 else total_fame,
        },
        "resources": {
            key: numeric_summary(values) for key, values in sorted(resources.items())
        },
        "termination_causes": dict(sorted(_counts(case.get("termination_cause", "unknown") for case in cases).items())),
    }
    if include_groups:
        summary["by_bucket"] = _group_summaries(cases, "bucket_id")
        summary["by_category"] = _group_summaries(cases, "category")
        summary["by_hero"] = _group_summaries(cases, "hero")
    return summary


def _counts(values: Iterable[Any]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for value in values:
        counts[str(value)] += 1
    return counts


def _group_summaries(cases: list[dict[str, Any]], key: str) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for case in cases:
        grouped[str(case.get(key, "unknown"))].append(case)
    return {
        name: summarize_cases(group_cases, include_groups=False)
        for name, group_cases in sorted(grouped.items())
    }


def _skill_tuple(case: dict[str, Any]) -> tuple[bool, float, float, float, float]:
    return (
        bool(case.get("success")),
        float(case.get("game_score", 0)),
        float(case.get("fame", 0)),
        -float(case.get("final_wounds", 0)),
        -float(case.get("steps", 0)),
    )


def compare_case_sets(
    candidate_cases: list[dict[str, Any]],
    baseline_cases: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compare two policies only on exactly matching frozen case IDs."""
    candidate = {str(case["case_id"]): case for case in candidate_cases}
    baseline = {str(case["case_id"]): case for case in baseline_cases}
    common = sorted(candidate.keys() & baseline.keys())
    wins = losses = ties = 0
    score_deltas: list[float] = []
    fame_deltas: list[float] = []
    wound_deltas: list[float] = []
    for case_id in common:
        left = candidate[case_id]
        right = baseline[case_id]
        left_skill = _skill_tuple(left)
        right_skill = _skill_tuple(right)
        if left_skill > right_skill:
            wins += 1
        elif left_skill < right_skill:
            losses += 1
        else:
            ties += 1
        score_deltas.append(float(left.get("game_score", 0)) - float(right.get("game_score", 0)))
        fame_deltas.append(float(left.get("fame", 0)) - float(right.get("fame", 0)))
        wound_deltas.append(float(left.get("final_wounds", 0)) - float(right.get("final_wounds", 0)))
    paired = len(common)
    return {
        "paired_cases": paired,
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "win_rate_excluding_ties": wins / (wins + losses) if wins + losses else 0.0,
        "mean_score_delta": statistics.fmean(score_deltas) if score_deltas else 0.0,
        "mean_fame_delta": statistics.fmean(fame_deltas) if fame_deltas else 0.0,
        "mean_wound_delta": statistics.fmean(wound_deltas) if wound_deltas else 0.0,
        "missing_from_candidate": sorted(baseline.keys() - candidate.keys()),
        "missing_from_baseline": sorted(candidate.keys() - baseline.keys()),
    }

