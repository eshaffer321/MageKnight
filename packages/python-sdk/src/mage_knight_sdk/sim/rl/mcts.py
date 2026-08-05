"""Standalone batched PUCT search over Rust-owned hypothetical game states.

This module deliberately does not integrate with PPO rollout collection. It consumes
the isolated ``fork_roots`` / ``step_search_batch`` / ``encode_search_batch`` API and
a read-only batched policy/value evaluator.

The cheap combat mode used by default has a known deterministic pessimistic bias for
multi-action combat synergies. See ``combat_search.rs`` and GitHub issue #1123. MCTS
callers must calibrate or correct those leaf values before treating results as trusted.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import sqrt
from time import perf_counter
from typing import Any, Protocol, Sequence

import numpy as np


class SearchEnvironment(Protocol):
    """Subset of ``PyVecEnv`` required by standalone tree search."""

    def fork_roots(self, env_indices: list[int]) -> list[int]: ...

    def step_search_batch(
        self,
        handles: list[int],
        action_indices: list[int],
        combat_mode: str,
    ) -> list[int]: ...

    def encode_search_batch(self, handles: list[int]) -> dict[str, Any]: ...

    def drop_search_states(self, handles: list[int]) -> int: ...


class PolicyValueBatchEvaluator(Protocol):
    """Return padded legal-action priors and one scalar value per encoded state."""

    def __call__(self, batch_dict: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]: ...


@dataclass(frozen=True)
class MCTSConfig:
    """Tunable standalone MCTS parameters."""

    simulations: int = 64
    c_puct: float = 1.5
    dirichlet_alpha: float = 0.3
    dirichlet_fraction: float = 0.0
    leaves_per_root_per_wave: int = 4
    virtual_loss: float = 1.0
    combat_mode: str = "cheap"
    random_seed: int | None = None

    def __post_init__(self) -> None:
        if self.simulations <= 0:
            raise ValueError("simulations must be positive")
        if self.c_puct < 0.0:
            raise ValueError("c_puct must be non-negative")
        if self.dirichlet_alpha <= 0.0:
            raise ValueError("dirichlet_alpha must be positive")
        if not 0.0 <= self.dirichlet_fraction <= 1.0:
            raise ValueError("dirichlet_fraction must be within [0, 1]")
        if self.leaves_per_root_per_wave <= 0:
            raise ValueError("leaves_per_root_per_wave must be positive")
        if self.virtual_loss < 0.0:
            raise ValueError("virtual_loss must be non-negative")
        if not self.combat_mode:
            raise ValueError("combat_mode must not be empty")


@dataclass
class MCTSNode:
    """One tree node backed by an independently owned Rust search handle.

    Statistics live on the node/incoming edge: ``N`` is visit count, ``W`` is
    total backed-up value, ``Q`` is mean value, and ``P`` is the policy prior.
    Children are keyed by the legal action index encoded for this state.
    """

    handle: int
    prior: float = 1.0
    visit_count: int = 0
    value_sum: float = 0.0
    children: dict[int, MCTSNode] = field(default_factory=dict)
    expanded: bool = False
    terminal: bool = False
    value_estimate: float | None = None
    virtual_visits: int = 0

    @property
    def N(self) -> int:
        return self.visit_count

    @property
    def W(self) -> float:
        return self.value_sum

    @property
    def Q(self) -> float:
        return self.value_sum / self.visit_count if self.visit_count else 0.0

    @property
    def P(self) -> float:
        return self.prior


@dataclass
class MCTSTree:
    """A reusable tree associated with one real environment index."""

    env_index: int
    root: MCTSNode
    noise_applied_at_handle: int | None = None


@dataclass(frozen=True)
class MCTSSearchReport:
    """Observed work and latency for one batched search call."""

    num_roots: int
    simulations_per_root: int
    total_simulations: int
    network_batches: int
    evaluated_nodes: int
    expansion_batches: int
    wall_time_seconds: float

    @property
    def simulations_per_second(self) -> float:
        return self.total_simulations / max(self.wall_time_seconds, 1e-12)

    @property
    def decision_latency_seconds(self) -> float:
        """Wall latency experienced by every decision in the parallel batch."""

        return self.wall_time_seconds

    @property
    def amortized_seconds_per_decision(self) -> float:
        return self.wall_time_seconds / max(self.num_roots, 1)


@dataclass
class _Reservation:
    path: list[MCTSNode]

    @property
    def leaf(self) -> MCTSNode:
        return self.path[-1]


def puct_score(
    parent: MCTSNode,
    child: MCTSNode,
    *,
    c_puct: float,
    virtual_loss: float,
) -> float:
    """Compute ``Q + c_puct * P * sqrt(N_parent) / (1 + N_child)``."""

    parent_n = parent.visit_count + parent.virtual_visits
    child_n = child.visit_count + child.virtual_visits
    if child_n:
        child_q = (
            child.value_sum - virtual_loss * child.virtual_visits
        ) / child_n
    else:
        child_q = 0.0
    exploration = c_puct * child.prior * sqrt(parent_n) / (1 + child_n)
    return child_q + exploration


class BatchedMCTS:
    """Wavefront-batched PUCT across independent ``PyVecEnv`` roots.

    ``search`` never mutates a real environment. Every created search handle is
    registered in ``_owned_handles`` and is released by pruning, ``reset_roots``,
    or ``close``. Use the object as a context manager when practical.
    """

    def __init__(
        self,
        search_env: SearchEnvironment,
        policy_value_fn: PolicyValueBatchEvaluator,
        config: MCTSConfig | None = None,
    ) -> None:
        self.search_env = search_env
        self.policy_value_fn = policy_value_fn
        self.config = config or MCTSConfig()
        self.trees: list[MCTSTree] = []
        self._owned_handles: set[int] = set()
        self._rng = np.random.default_rng(self.config.random_seed)

    def __enter__(self) -> BatchedMCTS:
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()

    def reset_roots(self, env_indices: Sequence[int]) -> list[MCTSTree]:
        """Drop any old forest and fork fresh roots from real environments."""

        if not env_indices:
            raise ValueError("env_indices must not be empty")
        self.close()
        indices = [int(index) for index in env_indices]
        handles = [int(handle) for handle in self.search_env.fork_roots(indices)]
        if len(handles) != len(indices):
            self.search_env.drop_search_states(handles)
            raise RuntimeError("fork_roots returned an unexpected handle count")
        self._owned_handles.update(handles)
        self.trees = [
            MCTSTree(env_index=index, root=MCTSNode(handle=handle))
            for index, handle in zip(indices, handles, strict=True)
        ]
        return self.trees

    def search(self, simulations: int | None = None) -> MCTSSearchReport:
        """Run the configured number of simulations for every current root."""

        if not self.trees:
            raise RuntimeError("reset_roots must be called before search")
        simulation_count = self.config.simulations if simulations is None else simulations
        if simulation_count <= 0:
            raise ValueError("simulations must be positive")

        started = perf_counter()
        network_batches = 0
        evaluated_nodes = 0
        expansion_batches = 0

        roots_to_expand = [tree.root for tree in self.trees if not tree.root.expanded]
        if roots_to_expand:
            evaluated, expanded = self._evaluate_and_expand(roots_to_expand)
            network_batches += 1
            evaluated_nodes += evaluated
            expansion_batches += expanded
        for tree in self.trees:
            self._apply_root_noise(tree)

        remaining = [simulation_count] * len(self.trees)
        while any(count > 0 for count in remaining):
            reservations: list[_Reservation] = []
            for tree_index, tree in enumerate(self.trees):
                wave_count = min(
                    remaining[tree_index],
                    self.config.leaves_per_root_per_wave,
                )
                for _ in range(wave_count):
                    reservations.append(self._reserve_leaf(tree))
                remaining[tree_index] -= wave_count

            leaves_to_evaluate = self._unique_unexpanded_leaves(reservations)
            try:
                if leaves_to_evaluate:
                    evaluated, expanded = self._evaluate_and_expand(leaves_to_evaluate)
                    network_batches += 1
                    evaluated_nodes += evaluated
                    expansion_batches += expanded
                for reservation in reservations:
                    value = reservation.leaf.value_estimate
                    if value is None:
                        raise RuntimeError("selected leaf has no value estimate")
                    self._release_virtual_loss(reservation)
                    self._backpropagate(reservation.path, value)
            except Exception:
                for reservation in reservations:
                    self._release_virtual_loss(reservation)
                raise

        elapsed = perf_counter() - started
        return MCTSSearchReport(
            num_roots=len(self.trees),
            simulations_per_root=simulation_count,
            total_simulations=simulation_count * len(self.trees),
            network_batches=network_batches,
            evaluated_nodes=evaluated_nodes,
            expansion_batches=expansion_batches,
            wall_time_seconds=elapsed,
        )

    def root_visit_counts(self) -> list[np.ndarray]:
        """Return child visit counts in legal-action-index order for each root."""

        return [
            np.asarray(
                [tree.root.children[index].visit_count for index in sorted(tree.root.children)],
                dtype=np.int64,
            )
            for tree in self.trees
        ]

    def action_probabilities(self, temperature: float = 1.0) -> list[np.ndarray]:
        """Convert root visit counts into action distributions."""

        if temperature < 0.0:
            raise ValueError("temperature must be non-negative")
        distributions: list[np.ndarray] = []
        for tree, counts in zip(self.trees, self.root_visit_counts(), strict=True):
            if counts.size == 0:
                distributions.append(np.empty(0, dtype=np.float64))
                continue
            if temperature == 0.0:
                probs = np.zeros(counts.size, dtype=np.float64)
                probs[int(np.argmax(counts))] = 1.0
                distributions.append(probs)
                continue
            weights = counts.astype(np.float64) ** (1.0 / temperature)
            if weights.sum() <= 0.0:
                weights = np.asarray(
                    [tree.root.children[index].prior for index in sorted(tree.root.children)],
                    dtype=np.float64,
                )
            total = float(weights.sum())
            distributions.append(
                weights / total if total > 0.0 else np.full(counts.size, 1.0 / counts.size)
            )
        return distributions

    def select_actions(self, temperature: float = 1.0) -> np.ndarray:
        """Sample action indices from visit-count-derived root distributions."""

        distributions = self.action_probabilities(temperature)
        selected: list[int] = []
        for probs in distributions:
            if probs.size == 0:
                raise RuntimeError("cannot choose an action from a terminal root")
            selected.append(int(self._rng.choice(probs.size, p=probs)))
        return np.asarray(selected, dtype=np.int32)

    def advance_roots(self, action_indices: Sequence[int]) -> int:
        """Reuse selected child subtrees and drop old roots plus all siblings.

        Call this after applying the same actions to the real environments. The
        retained child handles represent the deterministic hypothetical result of
        those actions and become tree-reuse-friendly roots for the next decision.
        """

        if len(action_indices) != len(self.trees):
            raise ValueError("one action index is required per tree")

        chosen_nodes: list[MCTSNode] = []
        for tree, raw_action_index in zip(self.trees, action_indices, strict=True):
            action_index = int(raw_action_index)
            chosen = tree.root.children.get(action_index)
            if chosen is None:
                raise ValueError(
                    f"action {action_index} is not an expanded child of root {tree.root.handle}"
                )
            chosen_nodes.append(chosen)

        discarded: set[int] = set()
        for tree, chosen in zip(self.trees, chosen_nodes, strict=True):
            retained = self._subtree_handles(chosen)
            discarded.update(self._subtree_handles(tree.root) - retained)
            chosen.prior = 1.0
            tree.root = chosen
            tree.noise_applied_at_handle = None

        return self._drop_owned_handles(discarded)

    def close(self) -> int:
        """Release every search handle owned by this forest; idempotent."""

        dropped = self._drop_owned_handles(set(self._owned_handles))
        self.trees = []
        return dropped

    def _reserve_leaf(self, tree: MCTSTree) -> _Reservation:
        node = tree.root
        path = [node]
        while node.expanded and node.children:
            _, node = self._select_child(node)
            path.append(node)
        for path_node in path:
            path_node.virtual_visits += 1
        return _Reservation(path=path)

    def _select_child(self, parent: MCTSNode) -> tuple[int, MCTSNode]:
        if not parent.children:
            raise RuntimeError("cannot select a child from an unexpanded or terminal node")
        return max(
            parent.children.items(),
            key=lambda item: (
                puct_score(
                    parent,
                    item[1],
                    c_puct=self.config.c_puct,
                    virtual_loss=self.config.virtual_loss,
                ),
                -item[0],
            ),
        )

    @staticmethod
    def _unique_unexpanded_leaves(reservations: Sequence[_Reservation]) -> list[MCTSNode]:
        unique: dict[int, MCTSNode] = {}
        for reservation in reservations:
            leaf = reservation.leaf
            if not leaf.expanded:
                unique.setdefault(leaf.handle, leaf)
        return list(unique.values())

    def _evaluate_and_expand(self, nodes: Sequence[MCTSNode]) -> tuple[int, int]:
        unique_nodes = list({node.handle: node for node in nodes if not node.expanded}.values())
        if not unique_nodes:
            return 0, 0

        batch = self.search_env.encode_search_batch([node.handle for node in unique_nodes])
        action_counts = np.asarray(batch["action_counts"], dtype=np.int64)
        if action_counts.shape != (len(unique_nodes),):
            raise RuntimeError("encoded action_counts shape does not match leaf batch")

        priors, values = self.policy_value_fn(batch)
        priors_array = np.asarray(priors, dtype=np.float64)
        values_array = np.asarray(values, dtype=np.float64)
        if values_array.shape != (len(unique_nodes),):
            raise RuntimeError("policy values shape does not match leaf batch")
        if priors_array.ndim != 2 or priors_array.shape[0] != len(unique_nodes):
            raise RuntimeError("policy priors must have shape (batch, padded_actions)")
        if not np.all(np.isfinite(values_array)):
            raise RuntimeError("policy returned a non-finite leaf value")

        normalized_priors: list[np.ndarray] = []
        parent_handles: list[int] = []
        action_indices: list[int] = []
        expandable_nodes = 0
        for row, (node, raw_count) in enumerate(
            zip(unique_nodes, action_counts, strict=True)
        ):
            action_count = int(raw_count)
            if action_count < 0 or action_count > priors_array.shape[1]:
                raise RuntimeError("policy priors do not cover every legal action")
            node.value_estimate = float(values_array[row])
            node.terminal = action_count == 0
            if action_count == 0:
                node.expanded = True
                normalized_priors.append(np.empty(0, dtype=np.float64))
                continue

            legal_priors = priors_array[row, :action_count].copy()
            if (
                not np.all(np.isfinite(legal_priors))
                or np.any(legal_priors < 0.0)
                or legal_priors.sum() <= 0.0
            ):
                legal_priors.fill(1.0 / action_count)
            else:
                legal_priors /= legal_priors.sum()
            normalized_priors.append(legal_priors)
            parent_handles.extend([node.handle] * action_count)
            action_indices.extend(range(action_count))
            expandable_nodes += 1

        if parent_handles:
            child_handles = [
                int(handle)
                for handle in self.search_env.step_search_batch(
                    parent_handles,
                    action_indices,
                    self.config.combat_mode,
                )
            ]
            if len(child_handles) != len(parent_handles):
                self.search_env.drop_search_states(child_handles)
                raise RuntimeError("step_search_batch returned an unexpected handle count")
            self._owned_handles.update(child_handles)

            offset = 0
            for node, legal_priors in zip(unique_nodes, normalized_priors, strict=True):
                for action_index, prior in enumerate(legal_priors):
                    node.children[action_index] = MCTSNode(
                        handle=child_handles[offset],
                        prior=float(prior),
                    )
                    offset += 1
                if legal_priors.size:
                    node.expanded = True

        return len(unique_nodes), int(expandable_nodes > 0)

    def _apply_root_noise(self, tree: MCTSTree) -> None:
        root = tree.root
        if tree.noise_applied_at_handle == root.handle or not root.expanded:
            return
        fraction = self.config.dirichlet_fraction
        if fraction > 0.0 and root.children:
            ordered_children = [root.children[index] for index in sorted(root.children)]
            noise = self._rng.dirichlet(
                np.full(len(ordered_children), self.config.dirichlet_alpha)
            )
            for child, sample in zip(ordered_children, noise, strict=True):
                child.prior = (1.0 - fraction) * child.prior + fraction * float(sample)
        tree.noise_applied_at_handle = root.handle

    @staticmethod
    def _release_virtual_loss(reservation: _Reservation) -> None:
        for node in reservation.path:
            if node.virtual_visits > 0:
                node.virtual_visits -= 1

    @staticmethod
    def _backpropagate(path: Sequence[MCTSNode], value: float) -> None:
        # Mage Knight RL is single-agent, so values keep the same sign at every depth.
        for node in path:
            node.visit_count += 1
            node.value_sum += value

    @staticmethod
    def _subtree_handles(root: MCTSNode) -> set[int]:
        handles: set[int] = set()
        stack = [root]
        while stack:
            node = stack.pop()
            if node.handle in handles:
                continue
            handles.add(node.handle)
            stack.extend(node.children.values())
        return handles

    def _drop_owned_handles(self, handles: set[int]) -> int:
        owned = handles & self._owned_handles
        if not owned:
            return 0
        ordered = sorted(owned)
        dropped = int(self.search_env.drop_search_states(ordered))
        self._owned_handles.difference_update(owned)
        return dropped
