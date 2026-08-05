"""Contract tests for the frozen skill benchmark and offline league tools."""

from __future__ import annotations

import json
import random
import tempfile
import unittest
from pathlib import Path


class TestEvaluationSuite(unittest.TestCase):
    def test_builtin_suite_is_locked_unique_and_held_out(self) -> None:
        from mage_knight_sdk.evaluation.suite import load_builtin_suite

        suite = load_builtin_suite("mk-solo-skill-v1")
        cases = suite.expand_cases()

        self.assertEqual(suite.schema_version, 1)
        self.assertTrue(suite.locked)
        self.assertEqual(len(cases), 352)
        self.assertEqual(len({case.case_id for case in cases}), len(cases))
        self.assertEqual(len({case.engine_seed for case in cases}), len(cases))
        self.assertTrue(all(case.engine_seed >= 2**31 for case in cases))
        self.assertEqual(sum(case.adaptive_eligible for case in cases), 128)

    def test_suite_hash_changes_when_definition_changes(self) -> None:
        from mage_knight_sdk.evaluation.suite import EvaluationSuite

        original = EvaluationSuite.from_dict({
            "schema_version": 1,
            "suite_id": "test",
            "locked": True,
            "buckets": [{
                "bucket_id": "easy",
                "category": "combat",
                "hero": "arythea",
                "base_seed": 2**31,
                "count": 2,
                "max_steps": 20,
                "success_metric": "fame_positive",
                "scenario": {
                    "type": "CombatDrill",
                    "enemy_tokens": ["diggers_1"],
                    "is_fortified": False,
                },
            }],
        })
        changed = EvaluationSuite.from_dict({
            **original.to_dict(),
            "buckets": [{**original.to_dict()["buckets"][0], "count": 3}],
        })
        self.assertNotEqual(original.content_hash, changed.content_hash)


class TestEvaluationMetrics(unittest.TestCase):
    def _case(self, case_id: str, *, score: int, fame: int, wounds: int,
              success: bool, steps: int = 100) -> dict:
        return {
            "case_id": case_id,
            "bucket_id": "core",
            "category": "full_game_core",
            "success": success,
            "natural_end": success,
            "game_score": score,
            "fame": fame,
            "final_wounds": wounds,
            "wounds_gained": wounds,
            "steps": steps,
            "final_resources": {
                "non_wound_hand": 3,
                "total_cards": 16,
                "crystals": 2,
                "ready_units": 1,
            },
        }

    def test_summary_reports_skill_and_efficiency_metrics(self) -> None:
        from mage_knight_sdk.evaluation.metrics import summarize_cases

        summary = summarize_cases([
            self._case("a", score=20, fame=16, wounds=2, success=True),
            self._case("b", score=10, fame=8, wounds=0, success=False, steps=200),
        ])
        self.assertEqual(summary["case_count"], 2)
        self.assertEqual(summary["success_rate"], 0.5)
        self.assertEqual(summary["game_score"]["mean"], 15.0)
        self.assertEqual(summary["fame"]["mean"], 12.0)
        self.assertEqual(summary["final_wounds"]["mean"], 1.0)
        self.assertAlmostEqual(summary["wound_efficiency"]["wounds_per_fame"], 1 / 12)
        self.assertEqual(summary["resources"]["crystals"]["mean"], 2.0)

    def test_pairwise_comparison_uses_identical_cases(self) -> None:
        from mage_knight_sdk.evaluation.metrics import compare_case_sets

        candidate = [
            self._case("a", score=20, fame=12, wounds=1, success=True),
            self._case("b", score=8, fame=8, wounds=0, success=True),
        ]
        baseline = [
            self._case("a", score=18, fame=12, wounds=1, success=True),
            self._case("b", score=9, fame=8, wounds=0, success=True),
        ]
        comparison = compare_case_sets(candidate, baseline)
        self.assertEqual(comparison["paired_cases"], 2)
        self.assertEqual(comparison["wins"], 1)
        self.assertEqual(comparison["losses"], 1)
        self.assertEqual(comparison["mean_score_delta"], 0.5)


class TestCheckpointLeaderboard(unittest.TestCase):
    def _write_result(
        self,
        root: Path,
        policy_id: str,
        policy_type: str,
        scores: list[int],
    ) -> Path:
        from mage_knight_sdk.evaluation.metrics import summarize_cases

        target = root / policy_id
        target.mkdir()
        cases = [
            {
                "case_id": f"full_arythea_core:{index:04d}",
                "bucket_id": "full_arythea_core",
                "category": "full_game_core",
                "success": score > 0,
                "natural_end": True,
                "game_score": score,
                "fame": max(0, score),
                "final_wounds": 0,
                "wounds_gained": 0,
                "steps": 10,
                "final_resources": {},
            }
            for index, score in enumerate(scores)
        ]
        manifest = {
            "suite_id": "locked-test",
            "suite_hash": "fixed-hash",
            "complete_suite": True,
            "policy": {"policy_id": policy_id, "policy_type": policy_type},
            "regression_thresholds": {
                "max_core_completion_drop": 0.05,
                "max_core_mean_score_drop": 2.0,
                "max_overall_paired_loss_rate": 0.55,
            },
        }
        (target / "summary.json").write_text(json.dumps({
            "manifest": manifest,
            "metrics": summarize_cases(cases),
        }), encoding="utf-8")
        (target / "cases.ndjson").write_text(
            "".join(json.dumps(case) + "\n" for case in cases),
            encoding="utf-8",
        )
        return target

    def test_leaderboard_anchors_random_and_flags_regressions(self) -> None:
        from mage_knight_sdk.evaluation.leaderboard import build_leaderboard

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            random_result = self._write_result(
                root, "random", "uniform_random", [-5, -5],
            )
            champion_result = self._write_result(
                root, "champion", "checkpoint_greedy", [10, 12],
            )
            leaderboard = build_leaderboard([random_result, champion_result])
        self.assertEqual(leaderboard["champion_policy_id"], "champion")
        self.assertEqual(leaderboard["baseline_policy_id"], "random")
        rows = {row["policy_id"]: row for row in leaderboard["rows"]}
        self.assertTrue(rows["champion"]["regression_gate"]["passed"])
        self.assertFalse(rows["random"]["regression_gate"]["passed"])

    def test_leaderboard_rejects_different_case_sets(self) -> None:
        from mage_knight_sdk.evaluation.leaderboard import build_leaderboard

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = self._write_result(root, "first", "checkpoint_greedy", [1, 2])
            second = self._write_result(root, "second", "checkpoint_greedy", [1])
            with self.assertRaisesRegex(ValueError, "identical frozen case IDs"):
                build_leaderboard([first, second])


class TestAdaptiveCurriculum(unittest.TestCase):
    def test_sampler_focuses_on_learnable_weakness_band(self) -> None:
        from mage_knight_sdk.evaluation.adaptive import AdaptiveCurriculum

        curriculum = AdaptiveCurriculum(target_low=0.40, target_high=0.70)
        weights = curriculum.weights_from_success_rates({
            "too_hard": 0.05,
            "learnable": 0.55,
            "mastered": 0.95,
        })
        self.assertGreater(weights["learnable"], weights["too_hard"])
        self.assertGreater(weights["learnable"], weights["mastered"])
        self.assertAlmostEqual(sum(weights.values()), 1.0)

    def test_plan_is_reproducible_and_round_trips(self) -> None:
        from mage_knight_sdk.evaluation.adaptive import AdaptiveCurriculum
        from mage_knight_sdk.evaluation.suite import EvaluationSuite

        suite = EvaluationSuite.from_dict({
            "schema_version": 1,
            "suite_id": "adaptive-test",
            "locked": True,
            "buckets": [
                {
                    "bucket_id": name,
                    "category": "combat",
                    "hero": "arythea",
                    "base_seed": 2**31 + index * 100,
                    "count": 2,
                    "max_steps": 50,
                    "success_metric": "fame_positive",
                    "adaptive_eligible": True,
                    "scenario": {
                        "type": "CombatDrill",
                        "enemy_tokens": [enemy],
                        "is_fortified": False,
                    },
                }
                for index, (name, enemy) in enumerate([
                    ("easy", "diggers_1"),
                    ("medium", "prowlers_1"),
                ])
            ],
        })
        cases = [
            {"bucket_id": "easy", "success": True},
            {"bucket_id": "easy", "success": True},
            {"bucket_id": "medium", "success": True},
            {"bucket_id": "medium", "success": False},
        ]
        curriculum = AdaptiveCurriculum()
        first = curriculum.build_plan(suite, cases, total_episodes=1000, seed=7)
        second = curriculum.build_plan(suite, cases, total_episodes=1000, seed=7)
        self.assertEqual(first, second)
        self.assertEqual(sum(phase["episodes"] for phase in first["phases"]), 1000)
        self.assertGreater(
            sum(p["episodes"] for p in first["phases"] if p["bucket_id"] == "medium"),
            sum(p["episodes"] for p in first["phases"] if p["bucket_id"] == "easy"),
        )

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "plan.json"
            target.write_text(json.dumps(first), encoding="utf-8")
            loaded = json.loads(target.read_text(encoding="utf-8"))
            from mage_knight_sdk.sim.rl.curriculum import load_adaptive_curriculum_plan

            schedule = load_adaptive_curriculum_plan(target)
        self.assertEqual(first, loaded)
        self.assertEqual(sum(phase.episodes for phase in schedule.phases), 1000)
        self.assertEqual(schedule.hero, "arythea")
        self.assertEqual(schedule.phases[0].early_term_fame_step, 0)
        self.assertEqual(schedule.source["requirements"], {
            "combat_oracle": False,
            "commerce_oracle": False,
        })

    def test_plan_can_be_restricted_to_combat_category(self) -> None:
        from mage_knight_sdk.evaluation.adaptive import AdaptiveCurriculum
        from mage_knight_sdk.evaluation.suite import load_builtin_suite

        suite = load_builtin_suite("mk-solo-skill-v1")
        cases = [
            {"bucket_id": case.bucket_id, "success": False}
            for case in suite.expand_cases()
            if case.adaptive_eligible
        ]

        plan = AdaptiveCurriculum().build_plan(
            suite,
            cases,
            total_episodes=600,
            seed=11,
            eligible_categories={"combat_mechanics"},
        )

        self.assertEqual(plan["eligible_categories"], ["combat_mechanics"])
        self.assertEqual(sum(plan["bucket_allocations"].values()), 600)
        self.assertEqual(len(plan["bucket_allocations"]), 6)
        self.assertTrue(
            all(name.startswith("combat_") for name in plan["bucket_allocations"]),
        )

    def test_weighted_sampling_is_deterministic_for_seed(self) -> None:
        from mage_knight_sdk.evaluation.adaptive import weighted_bucket_sequence

        weights = {"a": 0.25, "b": 0.75}
        self.assertEqual(
            weighted_bucket_sequence(weights, 20, random.Random(42)),
            weighted_bucket_sequence(weights, 20, random.Random(42)),
        )
