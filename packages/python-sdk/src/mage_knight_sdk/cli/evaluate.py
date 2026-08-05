"""CLI for frozen evaluation, checkpoint leaderboards, and adaptive plans."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
from pathlib import Path
import sys

from mage_knight_sdk.evaluation.adaptive import AdaptiveCurriculum
from mage_knight_sdk.evaluation.leaderboard import build_leaderboard, write_leaderboard
from mage_knight_sdk.evaluation.runner import (
    CheckpointEvaluationPolicy,
    RandomEvaluationPolicy,
    load_cases,
    run_suite,
)
from mage_knight_sdk.evaluation.suite import EvaluationSuite, load_builtin_suite


def _suite(value: str) -> EvaluationSuite:
    path = Path(value)
    return EvaluationSuite.load(path) if path.exists() else load_builtin_suite(value)


def _run(args: argparse.Namespace) -> int:
    suite = _suite(args.suite)
    if args.random:
        policy = RandomEvaluationPolicy(args.name or "random")
    else:
        if not args.checkpoint:
            raise ValueError("--checkpoint is required unless --random is used")
        policy = CheckpointEvaluationPolicy(
            args.checkpoint, name=args.name, device=args.device,
        )
    run_name = args.name or policy.metadata["policy_id"]
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = Path(args.output_root) / suite.suite_id / f"{run_name}-{stamp}"
    print(f"Suite: {suite.suite_id} ({suite.content_hash[:12]})")
    print(f"Policy: {policy.metadata['policy_id']}")
    print(f"Output: {output}")
    summary = run_suite(
        suite, policy, output,
        bucket_ids=set(args.bucket) if args.bucket else None,
    )
    metrics = summary["metrics"]
    print(
        f"Completed {metrics['case_count']} cases: success={metrics['success_rate']:.1%}, "
        f"score={metrics['game_score']['mean']:.2f}, fame={metrics['fame']['mean']:.2f}"
    )
    print(f"Result directory: {output}")
    return 0


def _leaderboard(args: argparse.Namespace) -> int:
    leaderboard = build_leaderboard(
        args.results, baseline_policy_id=args.baseline,
    )
    write_leaderboard(leaderboard, args.output)
    print(Path(args.output) / "leaderboard.md")
    return 0


def _adaptive(args: argparse.Namespace) -> int:
    suite = _suite(args.suite)
    cases = load_cases(args.result)
    curriculum = AdaptiveCurriculum(
        target_low=args.target_low,
        target_high=args.target_high,
    )
    plan = curriculum.build_plan(
        suite, cases, total_episodes=args.episodes, seed=args.seed,
        block_episodes=args.block_episodes,
        eligible_categories=set(args.category) if args.category else None,
    )
    result_path = Path(args.result).resolve()
    summary_path = (
        result_path / "summary.json" if result_path.is_dir()
        else result_path.parent / "summary.json"
    )
    if summary_path.exists():
        source_manifest = json.loads(summary_path.read_text(encoding="utf-8"))["manifest"]
        plan["source_evaluation"] = {
            "path": str(Path(args.result)),
            "policy": source_manifest["policy"],
            "created_at": source_manifest["created_at"],
        }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
    print(target)
    return 0


def _verify(args: argparse.Namespace) -> int:
    suite = _suite(args.suite)
    cases = suite.expand_cases()
    print(json.dumps({
        "suite_id": suite.suite_id,
        "suite_hash": suite.content_hash,
        "locked": suite.locked,
        "case_count": len(cases),
        "adaptive_case_count": sum(case.adaptive_eligible for case in cases),
        "seed_min": min(case.engine_seed for case in cases),
        "seed_max": max(case.engine_seed for case in cases),
    }, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="Run a frozen evaluation suite")
    run.add_argument("--suite", default="mk-solo-skill-v1")
    policies = run.add_mutually_exclusive_group(required=True)
    policies.add_argument("--random", action="store_true")
    policies.add_argument("--checkpoint")
    run.add_argument("--name")
    run.add_argument("--device", default="cpu")
    run.add_argument("--bucket", action="append", help="Run only one bucket (repeatable; result is not leaderboard-eligible)")
    run.add_argument("--output-root", default="evaluation/results")
    run.set_defaults(func=_run)

    leaderboard = subparsers.add_parser("leaderboard", help="Build a locked-suite leaderboard")
    leaderboard.add_argument("results", nargs="+")
    leaderboard.add_argument("--baseline", default="random")
    leaderboard.add_argument("--output", default="evaluation/leaderboard")
    leaderboard.set_defaults(func=_leaderboard)

    adaptive = subparsers.add_parser("adaptive-plan", help="Generate the next weighted curriculum plan")
    adaptive.add_argument("result", help="Evaluation result directory or cases.ndjson")
    adaptive.add_argument("--suite", default="mk-solo-skill-v1")
    adaptive.add_argument("--episodes", type=int, required=True)
    adaptive.add_argument("--seed", type=int, default=1)
    adaptive.add_argument("--target-low", type=float, default=0.40)
    adaptive.add_argument("--target-high", type=float, default=0.70)
    adaptive.add_argument("--block-episodes", type=int, default=4096)
    adaptive.add_argument(
        "--category",
        action="append",
        help="Restrict training to adaptive buckets in this category (repeatable)",
    )
    adaptive.add_argument("--output", default="evaluation/adaptive_curriculum.json")
    adaptive.set_defaults(func=_adaptive)

    verify = subparsers.add_parser("verify-suite", help="Validate and fingerprint a suite")
    verify.add_argument("--suite", default="mk-solo-skill-v1")
    verify.set_defaults(func=_verify)

    args = parser.parse_args()
    try:
        return int(args.func(args))
    except (ValueError, FileNotFoundError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
