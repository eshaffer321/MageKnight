"""Offline checkpoint leaderboard and locked-suite regression detection."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .metrics import compare_case_sets
from .runner import load_cases


def _load_result(path: Path) -> dict[str, Any]:
    summary = json.loads((path / "summary.json").read_text(encoding="utf-8"))
    manifest = summary["manifest"]
    return {
        "path": path,
        "summary": summary,
        "manifest": manifest,
        "cases": load_cases(path),
        "policy_id": str(manifest["policy"]["policy_id"]),
    }


def _skill_key(result: dict[str, Any]) -> tuple[float, float, float, float]:
    metrics = result["summary"]["metrics"]
    core = metrics["by_bucket"].get("full_arythea_core", metrics)
    mechanics_cases = [
        case for case in result["cases"]
        if case["category"] in {"combat_mechanics", "exploration_mechanics"}
    ]
    mechanics_success = (
        sum(case["success"] for case in mechanics_cases) / len(mechanics_cases)
        if mechanics_cases else 0.0
    )
    return (
        float(core["success_rate"]),
        float(core["game_score"]["mean"]),
        mechanics_success,
        -float(core["wound_efficiency"]["wounds_per_fame"]),
    )


def build_leaderboard(
    result_dirs: list[str | Path],
    *,
    baseline_policy_id: str = "random",
) -> dict[str, Any]:
    """Rank complete results and compute paired comparisons/regressions."""
    results = [_load_result(Path(path)) for path in result_dirs]
    if not results:
        raise ValueError("At least one evaluation result is required")
    hashes = {result["manifest"]["suite_hash"] for result in results}
    if len(hashes) != 1:
        raise ValueError("Leaderboard results must use exactly the same suite hash")
    if any(not result["manifest"].get("complete_suite") for result in results):
        raise ValueError("Locked leaderboard requires complete-suite results")
    expected_cases = {case["case_id"] for case in results[0]["cases"]}
    if any(
        {case["case_id"] for case in result["cases"]} != expected_cases
        for result in results[1:]
    ):
        raise ValueError("Leaderboard results must contain identical frozen case IDs")

    ranked = sorted(results, key=_skill_key, reverse=True)
    non_random = [
        result for result in ranked
        if result["manifest"]["policy"].get("policy_type") != "uniform_random"
    ]
    champion = non_random[0] if non_random else ranked[0]
    thresholds = results[0]["manifest"].get("regression_thresholds", {})
    baseline = next(
        (result for result in results if result["policy_id"] == baseline_policy_id),
        None,
    )

    rows: list[dict[str, Any]] = []
    for rank, result in enumerate(ranked, start=1):
        metrics = result["summary"]["metrics"]
        core = metrics["by_bucket"].get("full_arythea_core", metrics)
        row: dict[str, Any] = {
            "rank": rank,
            "policy_id": result["policy_id"],
            "policy_type": result["manifest"]["policy"]["policy_type"],
            "core_success_rate": core["success_rate"],
            "core_mean_score": core["game_score"]["mean"],
            "core_mean_fame": core["fame"]["mean"],
            "core_mean_wounds": core["final_wounds"]["mean"],
            "overall_success_rate": metrics["success_rate"],
            "is_champion": result is champion,
            "result_dir": str(result["path"]),
        }
        if baseline is not None and result is not baseline:
            row["vs_baseline"] = compare_case_sets(result["cases"], baseline["cases"])
        if result is not champion:
            comparison = compare_case_sets(result["cases"], champion["cases"])
            champion_metrics = champion["summary"]["metrics"]
            champion_core = champion_metrics["by_bucket"].get(
                "full_arythea_core", champion_metrics,
            )
            core_completion_drop = max(
                0.0,
                float(champion_core["success_rate"]) - float(core["success_rate"]),
            )
            core_score_drop = max(
                0.0,
                float(champion_core["game_score"]["mean"])
                - float(core["game_score"]["mean"]),
            )
            paired_loss_rate = (
                comparison["losses"] / comparison["paired_cases"]
                if comparison["paired_cases"] else 0.0
            )
            failures: list[str] = []
            if core_completion_drop > thresholds.get("max_core_completion_drop", 0.05):
                failures.append("core_completion")
            if core_score_drop > thresholds.get("max_core_mean_score_drop", 2.0):
                failures.append("core_score")
            if paired_loss_rate > thresholds.get("max_overall_paired_loss_rate", 0.55):
                failures.append("paired_losses")
            row["vs_champion"] = comparison
            row["regression_gate"] = {
                "passed": not failures,
                "failed_checks": failures,
                "core_completion_drop": core_completion_drop,
                "core_mean_score_drop": core_score_drop,
                "mean_wound_increase": max(0.0, comparison["mean_wound_delta"]),
                "paired_loss_rate": paired_loss_rate,
            }
        else:
            row["regression_gate"] = {
                "passed": True,
                "failed_checks": [],
                "reference": "champion",
            }
        rows.append(row)
    return {
        "schema_version": 1,
        "suite_id": results[0]["manifest"]["suite_id"],
        "suite_hash": results[0]["manifest"]["suite_hash"],
        "baseline_policy_id": baseline["policy_id"] if baseline else None,
        "champion_policy_id": champion["policy_id"],
        "regression_thresholds": thresholds,
        "rows": rows,
    }


def leaderboard_markdown(leaderboard: dict[str, Any]) -> str:
    lines = [
        f"# {leaderboard['suite_id']} leaderboard",
        "",
        "| Rank | Policy | Core completion | Core score | Core fame | Wounds | Overall success | Gate |",
        "|---:|---|---:|---:|---:|---:|---:|:---:|",
    ]
    for row in leaderboard["rows"]:
        marker = " ★" if row["is_champion"] else ""
        lines.append(
            f"| {row['rank']} | {row['policy_id']}{marker} | "
            f"{row['core_success_rate']:.1%} | {row['core_mean_score']:.2f} | "
            f"{row['core_mean_fame']:.2f} | {row['core_mean_wounds']:.2f} | "
            f"{row['overall_success_rate']:.1%} | "
            f"{'PASS' if row['regression_gate']['passed'] else 'FAIL'} |"
        )
    lines.extend([
        "",
        f"Champion: **{leaderboard['champion_policy_id']}**",
        f"Fixed baseline: **{leaderboard['baseline_policy_id']}**",
        "",
    ])
    return "\n".join(lines)


def write_leaderboard(leaderboard: dict[str, Any], output: str | Path) -> None:
    target = Path(output)
    target.mkdir(parents=True, exist_ok=True)
    (target / "leaderboard.json").write_text(
        json.dumps(leaderboard, indent=2, sort_keys=True), encoding="utf-8",
    )
    (target / "leaderboard.md").write_text(
        leaderboard_markdown(leaderboard), encoding="utf-8",
    )
