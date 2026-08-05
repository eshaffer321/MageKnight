"""Frozen evaluation-suite schema and manifest expansion."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import hashlib
import json
from importlib.resources import files
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class EvaluationCase:
    """One deterministic engine/scenario case in a frozen suite."""

    case_id: str
    bucket_id: str
    category: str
    engine_seed: int
    policy_seed: int
    hero: str
    max_steps: int
    success_metric: str
    scenario: dict[str, Any] | None = None
    difficulty: str = "unspecified"
    adaptive_eligible: bool = False


@dataclass(frozen=True)
class EvaluationBucket:
    """Compact definition of a contiguous, immutable case block."""

    bucket_id: str
    category: str
    hero: str
    base_seed: int
    count: int
    max_steps: int
    success_metric: str
    scenario: dict[str, Any] | None = None
    policy_seed_base: int = 0
    difficulty: str = "unspecified"
    adaptive_eligible: bool = False
    training_reward: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvaluationBucket:
        return cls(
            bucket_id=str(data["bucket_id"]),
            category=str(data["category"]),
            hero=str(data["hero"]),
            base_seed=int(data["base_seed"]),
            count=int(data["count"]),
            max_steps=int(data["max_steps"]),
            success_metric=str(data["success_metric"]),
            scenario=data.get("scenario"),
            policy_seed_base=int(data.get("policy_seed_base", 0)),
            difficulty=str(data.get("difficulty", "unspecified")),
            adaptive_eligible=bool(data.get("adaptive_eligible", False)),
            training_reward={
                str(key): float(value)
                for key, value in data.get("training_reward", {}).items()
            },
        )

    def expand_cases(self) -> list[EvaluationCase]:
        return [
            EvaluationCase(
                case_id=f"{self.bucket_id}:{index:04d}",
                bucket_id=self.bucket_id,
                category=self.category,
                engine_seed=self.base_seed + index,
                policy_seed=self.policy_seed_base + index,
                hero=self.hero,
                max_steps=self.max_steps,
                success_metric=self.success_metric,
                scenario=self.scenario,
                difficulty=self.difficulty,
                adaptive_eligible=self.adaptive_eligible,
            )
            for index in range(self.count)
        ]


@dataclass(frozen=True)
class EvaluationSuite:
    """A versioned immutable collection of evaluation buckets."""

    schema_version: int
    suite_id: str
    locked: bool
    buckets: tuple[EvaluationBucket, ...]
    description: str = ""
    score_version: str = "engine_score_v1"
    action_mode: str = "greedy"
    regression_thresholds: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvaluationSuite:
        schema_version = int(data["schema_version"])
        if schema_version != 1:
            raise ValueError(f"Unsupported evaluation suite schema: {schema_version}")
        suite = cls(
            schema_version=schema_version,
            suite_id=str(data["suite_id"]),
            locked=bool(data.get("locked", False)),
            buckets=tuple(EvaluationBucket.from_dict(item) for item in data["buckets"]),
            description=str(data.get("description", "")),
            score_version=str(data.get("score_version", "engine_score_v1")),
            action_mode=str(data.get("action_mode", "greedy")),
            regression_thresholds={
                str(key): float(value)
                for key, value in data.get("regression_thresholds", {}).items()
            },
        )
        suite.validate()
        return suite

    @classmethod
    def load(cls, path: str | Path) -> EvaluationSuite:
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "suite_id": self.suite_id,
            "description": self.description,
            "locked": self.locked,
            "score_version": self.score_version,
            "action_mode": self.action_mode,
            "regression_thresholds": self.regression_thresholds,
            "buckets": [asdict(bucket) for bucket in self.buckets],
        }

    @property
    def content_hash(self) -> str:
        encoded = json.dumps(
            self.to_dict(), sort_keys=True, separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def expand_cases(self) -> list[EvaluationCase]:
        return [case for bucket in self.buckets for case in bucket.expand_cases()]

    def validate(self) -> None:
        if not self.suite_id:
            raise ValueError("suite_id must not be empty")
        if self.action_mode not in {"greedy", "sampled"}:
            raise ValueError(f"Unsupported action mode: {self.action_mode}")
        if not self.buckets:
            raise ValueError("Evaluation suite must contain at least one bucket")
        cases = self.expand_cases()
        case_ids = [case.case_id for case in cases]
        seeds = [case.engine_seed for case in cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("Evaluation case IDs must be unique")
        if len(seeds) != len(set(seeds)):
            raise ValueError("Evaluation engine seeds must be unique")
        if self.locked and any(seed < 2**31 for seed in seeds):
            raise ValueError("Locked evaluation seeds must use the held-out high-bit namespace")
        for bucket in self.buckets:
            if bucket.count < 1 or bucket.max_steps < 1:
                raise ValueError(f"Invalid bucket size or max_steps: {bucket.bucket_id}")
            if bucket.success_metric not in {
                "scenario_triggered", "fame_positive", "natural_end",
            }:
                raise ValueError(
                    f"Unsupported success metric for {bucket.bucket_id}: "
                    f"{bucket.success_metric}"
                )


def load_builtin_suite(suite_id: str = "mk-solo-skill-v1") -> EvaluationSuite:
    """Load a suite bundled with the SDK by stable suite ID."""
    resource = files("mage_knight_sdk.evaluation").joinpath("suites", f"{suite_id}.json")
    return EvaluationSuite.from_dict(json.loads(resource.read_text(encoding="utf-8")))
