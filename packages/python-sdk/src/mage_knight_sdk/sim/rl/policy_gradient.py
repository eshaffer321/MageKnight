from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import random
from typing import Any

import numpy as np
import torch
from torch import nn
from .features import (
    ACTION_SCALAR_DIM,
    COMBAT_ENEMY_SCALAR_DIM,
    HEX_SCALAR_DIM,
    MAP_ENEMY_SCALAR_DIM,
    SITE_SCALAR_DIM,
    STATE_SCALAR_DIM,
    UNIT_SCALAR_DIM,
    EncodedStep,
    StateFeatures,
)
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
)


@dataclass(frozen=True)
class PolicyGradientConfig:
    gamma: float = 0.99
    learning_rate: float = 3e-4
    entropy_coefficient: float = 0.03
    critic_coefficient: float = 0.5
    hidden_size: int = 128
    normalize_returns: bool = True
    device: str = "auto"
    embedding_dim: int = 16
    num_hidden_layers: int = 1
    d_model: int = 64
    goal_dim: int = 0  # HRL: extra dims for goal conditioning (0 = disabled)


@dataclass(frozen=True)
class OptimizationStats:
    loss: float
    total_reward: float
    mean_reward: float
    entropy: float
    action_count: int
    critic_loss: float = 0.0
    epochs_used: int = 0
    approx_kl: float = 0.0
    effective_entropy_coef: float = 0.0


class ValueNormalizer:
    """Running mean/std normalizer for value targets (Welford's algorithm)."""

    def __init__(self) -> None:
        self._mean = 0.0
        self._var = 1.0
        self._count = 0

    def update(self, values: torch.Tensor) -> None:
        batch_mean = float(values.mean().item())
        batch_var = float(values.var(unbiased=False).item())
        batch_count = values.numel()

        delta = batch_mean - self._mean
        total = self._count + batch_count
        new_mean = self._mean + delta * batch_count / max(total, 1)
        m_a = self._var * self._count
        m_b = batch_var * batch_count
        m2 = m_a + m_b + delta ** 2 * self._count * batch_count / max(total, 1)
        self._mean = new_mean
        self._var = m2 / max(total, 1)
        self._count = total

    def normalize(self, values: torch.Tensor) -> torch.Tensor:
        std = max(self._var ** 0.5, 1e-6)
        return (values - self._mean) / std

    def state_dict(self) -> dict[str, float]:
        return {"mean": self._mean, "var": self._var, "count": float(self._count)}

    def load_state_dict(self, d: dict[str, float]) -> None:
        self._mean = d["mean"]
        self._var = d["var"]
        self._count = int(d["count"])


@dataclass(frozen=True)
class StepInfo:
    """Info from the last choose_action call, used by PPO trainer."""

    encoded_step: EncodedStep
    action_index: int
    log_prob: float
    value: float


@dataclass(frozen=True)
class Transition:
    """Single decision step stored for PPO optimization."""

    encoded_step: EncodedStep
    action_index: int
    log_prob: float
    value: float
    reward: float
    bootstrap_value: float | None = None


@dataclass(frozen=True)
class TensorizedTransition:
    """Transition with numpy arrays for efficient pickling across processes.

    Numpy arrays pickle as contiguous byte buffers — 10-100x more efficient
    than the nested Python lists in EncodedStep.
    """

    # State features
    state_scalars: np.ndarray            # (STATE_SCALAR_DIM,) float32
    state_mode_id: int
    state_hand_card_ids: np.ndarray      # (H,) int32
    state_deck_card_ids: np.ndarray     # (D,) int32
    state_discard_card_ids: np.ndarray  # (DC,) int32
    state_unit_ids: np.ndarray           # (U,) int32
    state_terrain_id: int
    state_site_type_id: int
    state_combat_enemy_ids: np.ndarray   # (CE,) int32
    state_combat_enemy_scalars: np.ndarray  # (CE, COMBAT_ENEMY_SCALAR_DIM) float32
    state_skill_ids: np.ndarray          # (S,) int32
    state_visible_site_ids: np.ndarray   # (VS,) int32
    state_visible_site_scalars: np.ndarray  # (VS, SITE_SCALAR_DIM) float32
    state_map_enemy_ids: np.ndarray      # (ME,) int32
    state_map_enemy_scalars: np.ndarray  # (ME, MAP_ENEMY_SCALAR_DIM) float32
    state_revealed_hex_terrain_ids: np.ndarray  # (RH,) int32
    state_revealed_hex_scalars: np.ndarray      # (RH, HEX_SCALAR_DIM) float32

    # Action features (per-action, packed)
    action_ids: np.ndarray               # (A, 6) int32  [type, source, card, unit, enemy, skill]
    action_scalars: np.ndarray           # (A, ACTION_SCALAR_DIM) float32
    action_target_enemy_ids: list[np.ndarray]  # list of (T,) int32 per action

    # PPO scalars
    action_index: int
    log_prob: float
    value: float
    reward: float
    bootstrap_value: float | None = None


def tensorize_transition(t: Transition) -> TensorizedTransition:
    """Convert a Transition to numpy-backed form for efficient IPC."""
    sf = t.encoded_step.state
    actions = t.encoded_step.actions
    n_actions = len(actions)

    return TensorizedTransition(
        state_scalars=np.array(sf.scalars, dtype=np.float32),
        state_mode_id=sf.mode_id,
        state_hand_card_ids=np.array(sf.hand_card_ids, dtype=np.int32),
        state_deck_card_ids=np.array(sf.deck_card_ids, dtype=np.int32),
        state_discard_card_ids=np.array(sf.discard_card_ids, dtype=np.int32),
        state_unit_ids=np.array(sf.unit_ids, dtype=np.int32),
        state_terrain_id=sf.current_terrain_id,
        state_site_type_id=sf.current_site_type_id,
        state_combat_enemy_ids=np.array(sf.combat_enemy_ids, dtype=np.int32),
        state_combat_enemy_scalars=np.array(sf.combat_enemy_scalars, dtype=np.float32).reshape(-1, COMBAT_ENEMY_SCALAR_DIM) if sf.combat_enemy_scalars else np.empty((0, COMBAT_ENEMY_SCALAR_DIM), dtype=np.float32),
        state_skill_ids=np.array(sf.skill_ids, dtype=np.int32),
        state_visible_site_ids=np.array(sf.visible_site_ids, dtype=np.int32),
        state_visible_site_scalars=np.array(sf.visible_site_scalars, dtype=np.float32).reshape(-1, SITE_SCALAR_DIM) if sf.visible_site_scalars else np.empty((0, SITE_SCALAR_DIM), dtype=np.float32),
        state_map_enemy_ids=np.array(sf.map_enemy_ids, dtype=np.int32),
        state_map_enemy_scalars=np.array(sf.map_enemy_scalars, dtype=np.float32).reshape(-1, MAP_ENEMY_SCALAR_DIM) if sf.map_enemy_scalars else np.empty((0, MAP_ENEMY_SCALAR_DIM), dtype=np.float32),
        state_revealed_hex_terrain_ids=np.array(sf.revealed_hex_terrain_ids, dtype=np.int32),
        state_revealed_hex_scalars=np.array(sf.revealed_hex_scalars, dtype=np.float32).reshape(-1, HEX_SCALAR_DIM) if sf.revealed_hex_scalars else np.empty((0, HEX_SCALAR_DIM), dtype=np.float32),
        action_ids=np.array(
            [[a.action_type_id, a.source_id, a.card_id, a.unit_id, a.enemy_id, a.skill_id] for a in actions],
            dtype=np.int32,
        ) if n_actions > 0 else np.empty((0, 6), dtype=np.int32),
        action_scalars=np.array(
            [a.scalars for a in actions], dtype=np.float32,
        ) if n_actions > 0 else np.empty((0, ACTION_SCALAR_DIM), dtype=np.float32),
        action_target_enemy_ids=[np.array(a.target_enemy_ids, dtype=np.int32) for a in actions],
        action_index=t.action_index,
        log_prob=t.log_prob,
        value=t.value,
        reward=t.reward,
        bootstrap_value=t.bootstrap_value,
    )


def detensorize_transition(tt: TensorizedTransition) -> Transition:
    """Convert a TensorizedTransition back to a normal Transition."""
    from .features import ActionFeatures

    sf = StateFeatures(
        scalars=tt.state_scalars.tolist(),
        mode_id=tt.state_mode_id,
        hand_card_ids=tt.state_hand_card_ids.tolist(),
        deck_card_ids=tt.state_deck_card_ids.tolist(),
        discard_card_ids=tt.state_discard_card_ids.tolist(),
        unit_ids=tt.state_unit_ids.tolist(),
        current_terrain_id=tt.state_terrain_id,
        current_site_type_id=tt.state_site_type_id,
        combat_enemy_ids=tt.state_combat_enemy_ids.tolist(),
        combat_enemy_scalars=tt.state_combat_enemy_scalars.tolist(),
        skill_ids=tt.state_skill_ids.tolist(),
        visible_site_ids=tt.state_visible_site_ids.tolist(),
        visible_site_scalars=tt.state_visible_site_scalars.tolist(),
        map_enemy_ids=tt.state_map_enemy_ids.tolist(),
        map_enemy_scalars=tt.state_map_enemy_scalars.tolist(),
        revealed_hex_terrain_ids=tt.state_revealed_hex_terrain_ids.tolist(),
        revealed_hex_scalars=tt.state_revealed_hex_scalars.tolist(),
    )
    n_actions = tt.action_ids.shape[0]
    actions = []
    for i in range(n_actions):
        ids = tt.action_ids[i]
        actions.append(ActionFeatures(
            action_type_id=int(ids[0]),
            source_id=int(ids[1]),
            card_id=int(ids[2]),
            unit_id=int(ids[3]),
            enemy_id=int(ids[4]),
            skill_id=int(ids[5]),
            target_enemy_ids=tt.action_target_enemy_ids[i].tolist(),
            scalars=tt.action_scalars[i].tolist(),
        ))
    step = EncodedStep(state=sf, actions=actions)
    return Transition(
        encoded_step=step,
        action_index=tt.action_index,
        log_prob=tt.log_prob,
        value=tt.value,
        reward=tt.reward,
        bootstrap_value=tt.bootstrap_value,
    )


def tensorize_episodes(
    episodes: list[list[Transition]],
) -> list[list[TensorizedTransition]]:
    """Convert all transitions in episode lists to tensorized form."""
    return [
        [tensorize_transition(t) for t in episode]
        for episode in episodes
    ]


def detensorize_episodes(
    episodes: list[list[TensorizedTransition]],
) -> list[list[Transition]]:
    """Convert all tensorized transitions back to normal transitions."""
    return [
        [detensorize_transition(tt) for tt in episode]
        for episode in episodes
    ]


def _build_encoder(input_dim: int, hidden_size: int, num_layers: int) -> nn.Sequential:
    if num_layers < 1:
        raise ValueError(f"num_layers must be >= 1, got {num_layers}")
    layers: list[nn.Module] = [nn.Linear(input_dim, hidden_size), nn.Tanh()]
    for _ in range(num_layers - 1):
        layers.extend([nn.Linear(hidden_size, hidden_size), nn.Tanh()])
    return nn.Sequential(*layers)


class EntityPoolEncoder(nn.Module):
    """Self-attention over variable-length entity pools with PMA summary.

    Each pool (hand cards, units, enemies, etc.) gets its own instance.
    Replaces mean-pooling with learned attention-based aggregation.
    """

    def __init__(self, input_dim: int, d_model: int, n_heads: int = 2) -> None:
        super().__init__()
        self.d_model = d_model
        self.input_proj = nn.Linear(input_dim, d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 2,
            activation="gelu", dropout=0.0, batch_first=True,
        )
        self.self_attn = nn.TransformerEncoder(encoder_layer, num_layers=1)
        # Pooling by Multi-head Attention (PMA): learned query → summary
        self.pma_query = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)
        self.pma_attn = nn.MultiheadAttention(d_model, n_heads, batch_first=True)
        self.pma_norm = nn.LayerNorm(d_model)

    def forward(
        self, x: torch.Tensor, mask: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Process entity pool with self-attention and PMA.

        Args:
            x: (B, L, input_dim) entity features (padded)
            mask: (B, L) bool, True = valid entity

        Returns:
            summary: (B, d_model) pool summary vector
            per_entity: (B, L, d_model) per-entity embeddings
        """
        B, L, _ = x.shape
        if L == 0:
            z = torch.zeros(B, self.d_model, device=x.device)
            return z, x.new_zeros(B, 0, self.d_model)

        h = self.input_proj(x)  # (B, L, d_model)
        any_valid = mask.any(dim=1)  # (B,)

        # Ensure at least one position is always "valid" for attention.
        # This prevents NaN attention weights (softmax of all -inf) which
        # cause NaN gradients during backward even with nan_to_num.
        # For empty-pool samples, position 0 (padding embed) is attended
        # but the summary is zeroed by any_valid masking.
        safe_pad_mask = (~mask).clone()
        safe_pad_mask[:, 0] = False  # position 0 always valid for attention

        h = self.self_attn(h, src_key_padding_mask=safe_pad_mask)

        # PMA: single learned query attends to all entities
        query = self.pma_query.expand(B, -1, -1)  # (B, 1, d_model)
        summary, _ = self.pma_attn(query, h, h, key_padding_mask=safe_pad_mask)
        summary = self.pma_norm(summary.squeeze(1))  # (B, d_model)
        # Zero out summaries for samples with no real entities
        summary = summary * any_valid.unsqueeze(-1).float()

        # Zero out padded positions in per-entity embeddings
        h = h * mask.unsqueeze(-1).float()
        return summary, h


class CrossAttentionScorer(nn.Module):
    """Score candidate actions by cross-attending to state entities.

    Each action query attends to individual state entities (cards, units,
    enemies, etc.) — no information bottleneck from mean-pooling.
    """

    def __init__(self, hidden_size: int, d_model: int, n_heads: int = 2) -> None:
        super().__init__()
        self.d_model = d_model
        self.action_proj = nn.Linear(hidden_size, d_model)
        self.cross_attn = nn.MultiheadAttention(d_model, n_heads, batch_first=True)
        self.cross_norm = nn.LayerNorm(d_model)
        self.scoring_mlp = nn.Sequential(
            nn.Linear(hidden_size + d_model, hidden_size),
            nn.Tanh(),
            nn.Linear(hidden_size, 1),
        )

    def forward(
        self,
        state_repr: torch.Tensor,
        action_reprs: torch.Tensor,
        entity_seq: torch.Tensor,
        entity_mask: torch.Tensor,
    ) -> torch.Tensor:
        """Score candidate actions via cross-attention to entities.

        Args:
            state_repr: (B, hidden) state representation
            action_reprs: (B, A, hidden) action representations
            entity_seq: (B, E, d_model) unified entity sequence
            entity_mask: (B, E) bool, True = valid entity

        Returns:
            logits: (B, A) raw scores
        """
        B, A, _ = action_reprs.shape
        queries = self.action_proj(action_reprs)  # (B, A, d_model)

        E = entity_seq.shape[1]
        if E == 0:
            enriched = torch.zeros(B, A, self.d_model, device=state_repr.device)
        else:
            # Ensure at least one key position is valid to prevent NaN
            # attention weights (and NaN gradients during backward).
            safe_pad_mask = (~entity_mask).clone()
            safe_pad_mask[:, 0] = False
            enriched, _ = self.cross_attn(
                queries, entity_seq, entity_seq, key_padding_mask=safe_pad_mask,
            )
        enriched = self.cross_norm(enriched)  # (B, A, d_model)

        state_expanded = state_repr.unsqueeze(1).expand(-1, A, -1)  # (B, A, hidden)
        combined = torch.cat([state_expanded, enriched], dim=-1)  # (B, A, hidden+d_model)
        logits = self.scoring_mlp(combined).squeeze(-1)  # (B, A)
        return logits


class _EmbeddingActionScoringNetwork(nn.Module):
    """Network with attention-based entity pools and cross-attention scoring."""

    def __init__(
        self, hidden_size: int, emb_dim: int,
        num_hidden_layers: int = 1, d_model: int = 64,
        goal_dim: int = 0,
    ) -> None:
        super().__init__()
        self.emb_dim = emb_dim
        self.d_model = d_model
        self.goal_dim = goal_dim

        # Embedding tables (unchanged)
        self.card_emb = nn.Embedding(CARD_VOCAB.size, emb_dim)
        self.unit_emb = nn.Embedding(UNIT_VOCAB.size, emb_dim)
        self.enemy_emb = nn.Embedding(ENEMY_VOCAB.size, emb_dim)
        self.action_type_emb = nn.Embedding(ACTION_TYPE_VOCAB.size, emb_dim)
        self.source_emb = nn.Embedding(SOURCE_VOCAB.size, emb_dim)
        self.mode_emb = nn.Embedding(MODE_VOCAB.size, emb_dim)
        self.terrain_emb = nn.Embedding(TERRAIN_VOCAB.size, emb_dim)
        self.site_emb = nn.Embedding(SITE_VOCAB.size, emb_dim)
        self.skill_emb = nn.Embedding(SKILL_VOCAB.size, emb_dim)
        self.map_site_emb = nn.Embedding(SITE_VOCAB.size, emb_dim)  # separate weights for map sites
        self.hex_terrain_emb = nn.Embedding(TERRAIN_VOCAB.size, emb_dim)  # separate weights for hex terrain pool

        # Entity pool encoders (self-attention + PMA, replaces mean-pooling)
        self.hand_pool_enc = EntityPoolEncoder(emb_dim, d_model)
        self.unit_pool_enc = EntityPoolEncoder(emb_dim + UNIT_SCALAR_DIM, d_model)
        self.combat_enemy_pool_enc = EntityPoolEncoder(emb_dim + COMBAT_ENEMY_SCALAR_DIM, d_model)
        self.skill_pool_enc = EntityPoolEncoder(emb_dim, d_model)
        self.visible_site_pool_enc = EntityPoolEncoder(emb_dim + SITE_SCALAR_DIM, d_model)
        self.map_enemy_pool_enc = EntityPoolEncoder(emb_dim + MAP_ENEMY_SCALAR_DIM, d_model)
        self.deck_pool_enc = EntityPoolEncoder(emb_dim, d_model)
        self.discard_pool_enc = EntityPoolEncoder(emb_dim, d_model)
        self.hex_pool_enc = EntityPoolEncoder(emb_dim + HEX_SCALAR_DIM, d_model)

        # Entity type embeddings (added to per-entity vectors for cross-attention)
        self.entity_type_emb = nn.Embedding(9, d_model)

        # State encoder: scalars + goal conditioning + 3 fixed embs (mode, terrain, site) + 9 pool summaries
        state_input_dim = STATE_SCALAR_DIM + goal_dim + 3 * emb_dim + 9 * d_model
        self.state_encoder = _build_encoder(state_input_dim, hidden_size, num_hidden_layers)

        # Action encoder (unchanged)
        action_input_dim = 7 * emb_dim + ACTION_SCALAR_DIM
        self.action_encoder = _build_encoder(action_input_dim, hidden_size, num_hidden_layers)

        # Cross-attention scorer (replaces MLP scoring_head)
        self.cross_attn_scorer = CrossAttentionScorer(hidden_size, d_model)

        # Value head: state_repr → scalar V(s)
        self.value_head = nn.Linear(hidden_size, 1)

    def _encode_state_input(
        self, sf: StateFeatures, device: torch.device,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Build state input vector and entity sequence for a single state.

        Returns:
            state_input: (state_input_dim,) raw vector for state_encoder
            entity_seq: (1, E, d_model) unified entity sequence for cross-attention
            entity_mask: (1, E) bool mask (True = valid)
        """
        scalars = torch.tensor(sf.scalars, dtype=torch.float32, device=device)
        mode_vec = self.mode_emb(torch.tensor(sf.mode_id, device=device))
        terrain_vec = self.terrain_emb(torch.tensor(sf.current_terrain_id, device=device))
        site_vec = self.site_emb(torch.tensor(sf.current_site_type_id, device=device))

        summaries: list[torch.Tensor] = []
        entity_parts: list[torch.Tensor] = []
        mask_parts: list[torch.Tensor] = []

        def _run_pool(
            pool_enc: EntityPoolEncoder, x: torch.Tensor,
            m: torch.Tensor, type_idx: int,
        ) -> None:
            s, ent = pool_enc(x, m)
            summaries.append(s.squeeze(0))
            entity_parts.append(ent.squeeze(0) + self.entity_type_emb.weight[type_idx])
            mask_parts.append(m.squeeze(0))

        emb = self.emb_dim

        # Pool 0: hand cards
        if sf.hand_card_ids:
            h_ids = torch.tensor(sf.hand_card_ids, dtype=torch.long, device=device)
            h_x = self.card_emb(h_ids).unsqueeze(0)
            h_m = torch.ones(1, len(sf.hand_card_ids), dtype=torch.bool, device=device)
        else:
            h_x = torch.zeros(1, 0, emb, device=device)
            h_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.hand_pool_enc, h_x, h_m, 0)

        # Pool 6: deck cards (embedding only)
        # NOTE: order must match forward_batch / _encode_state_inputs_batched
        if sf.deck_card_ids:
            dk_ids = torch.tensor(sf.deck_card_ids, dtype=torch.long, device=device)
            dk_x = self.card_emb(dk_ids).unsqueeze(0)
            dk_m = torch.ones(1, len(sf.deck_card_ids), dtype=torch.bool, device=device)
        else:
            dk_x = torch.zeros(1, 0, emb, device=device)
            dk_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.deck_pool_enc, dk_x, dk_m, 6)

        # Pool 7: discard cards (embedding only)
        if sf.discard_card_ids:
            di_ids = torch.tensor(sf.discard_card_ids, dtype=torch.long, device=device)
            di_x = self.card_emb(di_ids).unsqueeze(0)
            di_m = torch.ones(1, len(sf.discard_card_ids), dtype=torch.bool, device=device)
        else:
            di_x = torch.zeros(1, 0, emb, device=device)
            di_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.discard_pool_enc, di_x, di_m, 7)

        # Pool 1: units (embedding + scalars)
        if sf.unit_ids:
            u_ids = torch.tensor(sf.unit_ids, dtype=torch.long, device=device)
            u_embs = self.unit_emb(u_ids)
            u_sc = torch.tensor(sf.unit_scalars, dtype=torch.float32, device=device)
            u_x = torch.cat([u_embs, u_sc], dim=-1).unsqueeze(0)
            u_m = torch.ones(1, len(sf.unit_ids), dtype=torch.bool, device=device)
        else:
            u_x = torch.zeros(1, 0, emb + UNIT_SCALAR_DIM, device=device)
            u_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.unit_pool_enc, u_x, u_m, 1)

        # Pool 2: combat enemies (embedding + scalars)
        if sf.combat_enemy_ids:
            ce_ids = torch.tensor(sf.combat_enemy_ids, dtype=torch.long, device=device)
            ce_embs = self.enemy_emb(ce_ids)
            ce_sc = torch.tensor(sf.combat_enemy_scalars, dtype=torch.float32, device=device)
            ce_x = torch.cat([ce_embs, ce_sc], dim=-1).unsqueeze(0)
            ce_m = torch.ones(1, len(sf.combat_enemy_ids), dtype=torch.bool, device=device)
        else:
            ce_x = torch.zeros(1, 0, emb + COMBAT_ENEMY_SCALAR_DIM, device=device)
            ce_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.combat_enemy_pool_enc, ce_x, ce_m, 2)

        # Pool 3: skills (embedding only)
        if sf.skill_ids:
            s_ids = torch.tensor(sf.skill_ids, dtype=torch.long, device=device)
            s_x = self.skill_emb(s_ids).unsqueeze(0)
            s_m = torch.ones(1, len(sf.skill_ids), dtype=torch.bool, device=device)
        else:
            s_x = torch.zeros(1, 0, emb, device=device)
            s_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.skill_pool_enc, s_x, s_m, 3)

        # Pool 4: visible sites (embedding + scalars)
        if sf.visible_site_ids:
            vs_ids = torch.tensor(sf.visible_site_ids, dtype=torch.long, device=device)
            vs_embs = self.map_site_emb(vs_ids)
            vs_sc = torch.tensor(sf.visible_site_scalars, dtype=torch.float32, device=device)
            vs_x = torch.cat([vs_embs, vs_sc], dim=-1).unsqueeze(0)
            vs_m = torch.ones(1, len(sf.visible_site_ids), dtype=torch.bool, device=device)
        else:
            vs_x = torch.zeros(1, 0, emb + SITE_SCALAR_DIM, device=device)
            vs_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.visible_site_pool_enc, vs_x, vs_m, 4)

        # Pool 5: map enemies (embedding + scalars)
        if sf.map_enemy_ids:
            me_ids = torch.tensor(sf.map_enemy_ids, dtype=torch.long, device=device)
            me_embs = self.enemy_emb(me_ids)
            me_sc = torch.tensor(sf.map_enemy_scalars, dtype=torch.float32, device=device)
            me_x = torch.cat([me_embs, me_sc], dim=-1).unsqueeze(0)
            me_m = torch.ones(1, len(sf.map_enemy_ids), dtype=torch.bool, device=device)
        else:
            me_x = torch.zeros(1, 0, emb + MAP_ENEMY_SCALAR_DIM, device=device)
            me_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.map_enemy_pool_enc, me_x, me_m, 5)

        # Pool 8: revealed hexes (terrain embedding + scalars)
        if sf.revealed_hex_terrain_ids:
            rh_ids = torch.tensor(sf.revealed_hex_terrain_ids, dtype=torch.long, device=device)
            rh_embs = self.hex_terrain_emb(rh_ids)
            rh_sc = torch.tensor(sf.revealed_hex_scalars, dtype=torch.float32, device=device)
            rh_x = torch.cat([rh_embs, rh_sc], dim=-1).unsqueeze(0)
            rh_m = torch.ones(1, len(sf.revealed_hex_terrain_ids), dtype=torch.bool, device=device)
        else:
            rh_x = torch.zeros(1, 0, emb + HEX_SCALAR_DIM, device=device)
            rh_m = torch.zeros(1, 0, dtype=torch.bool, device=device)
        _run_pool(self.hex_pool_enc, rh_x, rh_m, 8)

        # Build state input: scalars + 3 fixed embs + 9 pool summaries
        state_input = torch.cat([scalars, mode_vec, terrain_vec, site_vec, *summaries])

        # Build unified entity sequence for cross-attention
        all_ent = torch.cat(entity_parts, dim=0)  # (E, d_model)
        all_mask = torch.cat(mask_parts, dim=0)    # (E,)
        entity_seq = all_ent.unsqueeze(0)   # (1, E, d_model)
        entity_mask = all_mask.unsqueeze(0)  # (1, E)

        return state_input, entity_seq, entity_mask

    def _precompute_state_raw_tensors(
        self, transitions: list[Transition], device: torch.device,
    ) -> dict[str, Any]:
        """Convert transition state features into raw tensors (no embedding lookups).

        This is called once before the PPO epoch loop. The expensive
        Python→tensor conversion happens here; embedding lookups are deferred
        to ``_encode_state_inputs_batched`` so gradients flow through them.
        """
        scalars = torch.tensor(
            [t.encoded_step.state.scalars for t in transitions],
            dtype=torch.float32, device=device,
        )  # (N, STATE_SCALAR_DIM)
        mode_ids = torch.tensor(
            [t.encoded_step.state.mode_id for t in transitions],
            dtype=torch.long, device=device,
        )  # (N,)
        terrain_ids = torch.tensor(
            [t.encoded_step.state.current_terrain_id for t in transitions],
            dtype=torch.long, device=device,
        )  # (N,)
        site_type_ids = torch.tensor(
            [t.encoded_step.state.current_site_type_id for t in transitions],
            dtype=torch.long, device=device,
        )  # (N,)

        # Variable-length pools — store as lists of per-transition tensors
        hand_card_ids: list[torch.Tensor] = []
        deck_card_ids: list[torch.Tensor] = []
        discard_card_ids: list[torch.Tensor] = []
        unit_ids: list[torch.Tensor] = []
        unit_scalars: list[torch.Tensor] = []
        combat_enemy_ids: list[torch.Tensor] = []
        combat_enemy_scalars: list[torch.Tensor] = []
        skill_ids: list[torch.Tensor] = []
        visible_site_ids: list[torch.Tensor] = []
        visible_site_scalars: list[torch.Tensor] = []
        map_enemy_ids: list[torch.Tensor] = []
        map_enemy_scalars: list[torch.Tensor] = []
        revealed_hex_terrain_ids: list[torch.Tensor] = []
        revealed_hex_scalars: list[torch.Tensor] = []

        for t in transitions:
            sf = t.encoded_step.state
            hand_card_ids.append(
                torch.tensor(sf.hand_card_ids, dtype=torch.long, device=device)
                if sf.hand_card_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            deck_card_ids.append(
                torch.tensor(sf.deck_card_ids, dtype=torch.long, device=device)
                if sf.deck_card_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            discard_card_ids.append(
                torch.tensor(sf.discard_card_ids, dtype=torch.long, device=device)
                if sf.discard_card_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            unit_ids.append(
                torch.tensor(sf.unit_ids, dtype=torch.long, device=device)
                if sf.unit_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            unit_scalars.append(
                torch.tensor(sf.unit_scalars, dtype=torch.float32, device=device)
                if sf.unit_scalars else torch.empty(0, UNIT_SCALAR_DIM, dtype=torch.float32, device=device)
            )
            combat_enemy_ids.append(
                torch.tensor(sf.combat_enemy_ids, dtype=torch.long, device=device)
                if sf.combat_enemy_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            combat_enemy_scalars.append(
                torch.tensor(sf.combat_enemy_scalars, dtype=torch.float32, device=device)
                if sf.combat_enemy_scalars else torch.empty(0, COMBAT_ENEMY_SCALAR_DIM, dtype=torch.float32, device=device)
            )
            skill_ids.append(
                torch.tensor(sf.skill_ids, dtype=torch.long, device=device)
                if sf.skill_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            visible_site_ids.append(
                torch.tensor(sf.visible_site_ids, dtype=torch.long, device=device)
                if sf.visible_site_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            visible_site_scalars.append(
                torch.tensor(sf.visible_site_scalars, dtype=torch.float32, device=device)
                if sf.visible_site_scalars else torch.empty(0, SITE_SCALAR_DIM, dtype=torch.float32, device=device)
            )
            map_enemy_ids.append(
                torch.tensor(sf.map_enemy_ids, dtype=torch.long, device=device)
                if sf.map_enemy_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            map_enemy_scalars.append(
                torch.tensor(sf.map_enemy_scalars, dtype=torch.float32, device=device)
                if sf.map_enemy_scalars else torch.empty(0, MAP_ENEMY_SCALAR_DIM, dtype=torch.float32, device=device)
            )
            revealed_hex_terrain_ids.append(
                torch.tensor(sf.revealed_hex_terrain_ids, dtype=torch.long, device=device)
                if sf.revealed_hex_terrain_ids else torch.empty(0, dtype=torch.long, device=device)
            )
            revealed_hex_scalars.append(
                torch.tensor(sf.revealed_hex_scalars, dtype=torch.float32, device=device)
                if sf.revealed_hex_scalars else torch.empty(0, HEX_SCALAR_DIM, dtype=torch.float32, device=device)
            )

        return {
            "scalars": scalars,
            "mode_ids": mode_ids,
            "terrain_ids": terrain_ids,
            "site_type_ids": site_type_ids,
            "hand_card_ids": hand_card_ids,
            "deck_card_ids": deck_card_ids,
            "discard_card_ids": discard_card_ids,
            "unit_ids": unit_ids,
            "unit_scalars": unit_scalars,
            "combat_enemy_ids": combat_enemy_ids,
            "combat_enemy_scalars": combat_enemy_scalars,
            "skill_ids": skill_ids,
            "visible_site_ids": visible_site_ids,
            "visible_site_scalars": visible_site_scalars,
            "map_enemy_ids": map_enemy_ids,
            "map_enemy_scalars": map_enemy_scalars,
            "revealed_hex_terrain_ids": revealed_hex_terrain_ids,
            "revealed_hex_scalars": revealed_hex_scalars,
        }

    def _encode_state_inputs_batched(
        self, raw: dict[str, Any], batch_indices: list[int],
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Build state input vectors and entity sequences for a mini-batch.

        Takes precomputed raw tensors and a list of transition indices.
        Runs embedding lookups (with gradients) and EntityPoolEncoder attention.

        Returns:
            state_inputs: (bs, state_input_dim)
            entity_seq: (bs, max_E, d_model)
            entity_mask: (bs, max_E) bool
        """
        bs = len(batch_indices)
        device = raw["scalars"].device
        d = self.d_model

        # Fixed-size lookups (batched)
        scalars = raw["scalars"][batch_indices]
        mode_vec = self.mode_emb(raw["mode_ids"][batch_indices])
        terrain_vec = self.terrain_emb(raw["terrain_ids"][batch_indices])
        site_vec = self.site_emb(raw["site_type_ids"][batch_indices])

        summaries: list[torch.Tensor] = []
        entity_parts: list[torch.Tensor] = []
        mask_parts: list[torch.Tensor] = []

        def _pad_and_run_emb_pool(
            pool_enc: EntityPoolEncoder, ids_key: str,
            emb_table: nn.Embedding, type_idx: int,
        ) -> None:
            """Pad ID-only pool, embed, run through encoder."""
            max_l = max(
                (raw[ids_key][idx].numel() for idx in batch_indices), default=0,
            )
            if max_l > 0:
                padded = torch.zeros(bs, max_l, dtype=torch.long, device=device)
                mask = torch.zeros(bs, max_l, dtype=torch.bool, device=device)
                for i, idx in enumerate(batch_indices):
                    t = raw[ids_key][idx]
                    ln = t.numel()
                    if ln > 0:
                        padded[i, :ln] = t
                        mask[i, :ln] = True
                x = emb_table(padded)
                s, ent = pool_enc(x, mask)
            else:
                s = torch.zeros(bs, d, device=device)
                ent = torch.zeros(bs, 0, d, device=device)
                mask = torch.zeros(bs, 0, dtype=torch.bool, device=device)
            summaries.append(s)
            entity_parts.append(ent + self.entity_type_emb.weight[type_idx])
            mask_parts.append(mask)

        def _pad_and_run_emb_scalar_pool(
            pool_enc: EntityPoolEncoder, ids_key: str, scalars_key: str,
            emb_table: nn.Embedding, scalar_dim: int, type_idx: int,
        ) -> None:
            """Pad ID+scalar pool, embed, concatenate scalars, run encoder."""
            max_l = max(
                (raw[ids_key][idx].numel() for idx in batch_indices), default=0,
            )
            if max_l > 0:
                padded_ids = torch.zeros(bs, max_l, dtype=torch.long, device=device)
                padded_sc = torch.zeros(
                    bs, max_l, scalar_dim, dtype=torch.float32, device=device,
                )
                mask = torch.zeros(bs, max_l, dtype=torch.bool, device=device)
                for i, idx in enumerate(batch_indices):
                    t = raw[ids_key][idx]
                    ln = t.numel()
                    if ln > 0:
                        padded_ids[i, :ln] = t
                        padded_sc[i, :ln] = raw[scalars_key][idx]
                        mask[i, :ln] = True
                x = torch.cat([emb_table(padded_ids), padded_sc], dim=-1)
                s, ent = pool_enc(x, mask)
            else:
                s = torch.zeros(bs, d, device=device)
                ent = torch.zeros(bs, 0, d, device=device)
                mask = torch.zeros(bs, 0, dtype=torch.bool, device=device)
            summaries.append(s)
            entity_parts.append(ent + self.entity_type_emb.weight[type_idx])
            mask_parts.append(mask)

        # Pool 0: hand cards (emb only)
        _pad_and_run_emb_pool(self.hand_pool_enc, "hand_card_ids", self.card_emb, 0)
        # Pool 6: deck cards (emb only)
        _pad_and_run_emb_pool(self.deck_pool_enc, "deck_card_ids", self.card_emb, 6)
        # Pool 7: discard cards (emb only)
        _pad_and_run_emb_pool(self.discard_pool_enc, "discard_card_ids", self.card_emb, 7)
        # Pool 1: units (emb + scalars)
        _pad_and_run_emb_scalar_pool(
            self.unit_pool_enc, "unit_ids", "unit_scalars",
            self.unit_emb, UNIT_SCALAR_DIM, 1,
        )
        # Pool 2: combat enemies (emb + scalars)
        _pad_and_run_emb_scalar_pool(
            self.combat_enemy_pool_enc, "combat_enemy_ids", "combat_enemy_scalars",
            self.enemy_emb, COMBAT_ENEMY_SCALAR_DIM, 2,
        )
        # Pool 3: skills (emb only)
        _pad_and_run_emb_pool(self.skill_pool_enc, "skill_ids", self.skill_emb, 3)
        # Pool 4: visible sites (emb + scalars)
        _pad_and_run_emb_scalar_pool(
            self.visible_site_pool_enc, "visible_site_ids", "visible_site_scalars",
            self.map_site_emb, SITE_SCALAR_DIM, 4,
        )
        # Pool 5: map enemies (emb + scalars)
        _pad_and_run_emb_scalar_pool(
            self.map_enemy_pool_enc, "map_enemy_ids", "map_enemy_scalars",
            self.enemy_emb, MAP_ENEMY_SCALAR_DIM, 5,
        )
        # Pool 8: revealed hexes (emb + scalars)
        _pad_and_run_emb_scalar_pool(
            self.hex_pool_enc, "revealed_hex_terrain_ids", "revealed_hex_scalars",
            self.hex_terrain_emb, HEX_SCALAR_DIM, 8,
        )

        state_inputs = torch.cat(
            [scalars, mode_vec, terrain_vec, site_vec, *summaries], dim=-1,
        )
        entity_seq = torch.cat(entity_parts, dim=1)
        entity_mask_all = torch.cat(mask_parts, dim=1)

        return state_inputs, entity_seq, entity_mask_all

    def encode_state(
        self, step: EncodedStep, device: torch.device,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Encode state features into repr + entity sequence.

        Returns (state_repr, entity_seq, entity_mask).
        """
        state_input, entity_seq, entity_mask = self._encode_state_input(step.state, device)
        state_repr = self.state_encoder(state_input)
        return state_repr, entity_seq, entity_mask

    def encode_state_batch(
        self, steps: list[EncodedStep], device: torch.device,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Batch-encode multiple states.

        Returns (state_reprs (B, hidden), entity_seq (B, E, d_model),
                 entity_mask (B, E)).
        """
        state_inputs = []
        entity_seqs: list[torch.Tensor] = []
        entity_masks: list[torch.Tensor] = []
        for step in steps:
            si, es, em = self._encode_state_input(step.state, device)
            state_inputs.append(si)
            entity_seqs.append(es.squeeze(0))   # (E_i, d_model)
            entity_masks.append(em.squeeze(0))  # (E_i,)
        state_reprs = self.state_encoder(torch.stack(state_inputs))  # (B, hidden)
        # Pad entity sequences to uniform length
        max_e = max((es.shape[0] for es in entity_seqs), default=0)
        B = len(steps)
        d = self.d_model
        entity_seq = torch.zeros(B, max_e, d, device=device)
        entity_mask = torch.zeros(B, max_e, dtype=torch.bool, device=device)
        for i, (es, em) in enumerate(zip(entity_seqs, entity_masks)):
            e = es.shape[0]
            if e > 0:
                entity_seq[i, :e] = es
                entity_mask[i, :e] = em
        return state_reprs, entity_seq, entity_mask

    def encode_actions(self, step: EncodedStep, device: torch.device) -> torch.Tensor:
        """Encode all candidate actions into (N, hidden) tensor."""
        # Pack all integer IDs into a single (N, 6) tensor — one torch.tensor call
        ids = torch.tensor(
            [
                [a.action_type_id, a.source_id, a.card_id, a.unit_id, a.enemy_id, a.skill_id]
                for a in step.actions
            ],
            dtype=torch.long,
            device=device,
        )
        action_scalars = torch.tensor(
            [a.scalars for a in step.actions], dtype=torch.float32, device=device
        )

        # Mean-pool target enemy embeddings per action (for DECLARE_ATTACK_TARGETS)
        n = len(step.actions)
        target_pools = torch.zeros(n, self.emb_dim, device=device)
        for i, a in enumerate(step.actions):
            if a.target_enemy_ids:
                t_ids = torch.tensor(a.target_enemy_ids, dtype=torch.long, device=device)
                target_pools[i] = self.enemy_emb(t_ids).mean(dim=0)

        action_input = torch.cat([
            self.action_type_emb(ids[:, 0]),
            self.source_emb(ids[:, 1]),
            self.card_emb(ids[:, 2]),
            self.unit_emb(ids[:, 3]),
            self.enemy_emb(ids[:, 4]),
            self.skill_emb(ids[:, 5]),
            target_pools,
            action_scalars,
        ], dim=-1)  # (N, 7*emb_dim + ACTION_SCALAR_DIM)

        return self.action_encoder(action_input)  # (N, hidden)

    def forward(
        self, step: EncodedStep, device: torch.device,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Score all candidates and estimate state value.

        Returns (logits: (N,), value: scalar).
        """
        state_repr, entity_seq, entity_mask = self.encode_state(step, device)
        action_reprs = self.encode_actions(step, device)  # (N, hidden)

        # Cross-attention scoring (add batch dim, then squeeze)
        logits = self.cross_attn_scorer(
            state_repr.unsqueeze(0),       # (1, hidden)
            action_reprs.unsqueeze(0),     # (1, N, hidden)
            entity_seq,                     # (1, E, d_model)
            entity_mask,                    # (1, E)
        ).squeeze(0)  # (N,)

        value = self.value_head(state_repr).squeeze(-1)  # scalar
        return logits, value

    def forward_batch(
        self, batch_dict: dict, device: torch.device,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Batched forward pass over a VecEnv batch dict.

        Args:
            batch_dict: dict of numpy arrays from PyVecEnv.encode_batch()
            device: torch device

        Returns:
            (logits, values) where logits is (N, max_M) with -inf masking
            and values is (N,).
        """
        n = int(batch_dict["action_counts"].shape[0])
        action_counts = batch_dict["action_counts"]  # (N,)
        max_m = int(batch_dict.get("max_actions", action_counts.max()))

        # ── State encoding with attention pools ──────────────────────
        scalars_t = torch.tensor(batch_dict["state_scalars"], dtype=torch.float32, device=device)
        state_ids_t = torch.tensor(batch_dict["state_ids"], dtype=torch.long, device=device)

        mode_vec = self.mode_emb(state_ids_t[:, 0])
        terrain_vec = self.terrain_emb(state_ids_t[:, 1])
        site_vec = self.site_emb(state_ids_t[:, 2])

        emb = self.emb_dim
        d = self.d_model
        pool_summaries: list[torch.Tensor] = []
        entity_parts: list[torch.Tensor] = []
        mask_parts: list[torch.Tensor] = []

        def _run_emb_pool(
            pool_enc: EntityPoolEncoder, ids_np: Any, counts_np: Any,
            emb_table: nn.Embedding, type_idx: int,
        ) -> None:
            ids_t = torch.tensor(ids_np, dtype=torch.long, device=device)
            counts_t = torch.tensor(counts_np, dtype=torch.long, device=device)
            max_l = ids_t.shape[1]
            if max_l > 0:
                x = emb_table(ids_t)
                mask = torch.arange(max_l, device=device).unsqueeze(0) < counts_t.unsqueeze(1)
                s, ent = pool_enc(x, mask)
            else:
                s = torch.zeros(n, d, device=device)
                ent = torch.zeros(n, 0, d, device=device)
                mask = torch.zeros(n, 0, dtype=torch.bool, device=device)
            pool_summaries.append(s)
            entity_parts.append(ent + self.entity_type_emb.weight[type_idx])
            mask_parts.append(mask)

        def _run_emb_scalar_pool(
            pool_enc: EntityPoolEncoder, ids_np: Any, counts_np: Any,
            scalars_np: Any, emb_table: nn.Embedding,
            scalar_dim: int, type_idx: int,
        ) -> None:
            ids_t = torch.tensor(ids_np, dtype=torch.long, device=device)
            counts_t = torch.tensor(counts_np, dtype=torch.long, device=device)
            max_l = ids_t.shape[1]
            if max_l > 0:
                embs = emb_table(ids_t)
                sc_flat = torch.tensor(scalars_np, dtype=torch.float32, device=device)
                sc = sc_flat.view(n, max_l, scalar_dim)
                x = torch.cat([embs, sc], dim=-1)
                mask = torch.arange(max_l, device=device).unsqueeze(0) < counts_t.unsqueeze(1)
                s, ent = pool_enc(x, mask)
            else:
                s = torch.zeros(n, d, device=device)
                ent = torch.zeros(n, 0, d, device=device)
                mask = torch.zeros(n, 0, dtype=torch.bool, device=device)
            pool_summaries.append(s)
            entity_parts.append(ent + self.entity_type_emb.weight[type_idx])
            mask_parts.append(mask)

        # Pool 0: hand cards
        _run_emb_pool(
            self.hand_pool_enc, batch_dict["hand_card_ids"],
            batch_dict["hand_counts"], self.card_emb, 0,
        )
        # Pool 6: deck cards
        _run_emb_pool(
            self.deck_pool_enc, batch_dict["deck_card_ids"],
            batch_dict["deck_counts"], self.card_emb, 6,
        )
        # Pool 7: discard cards
        _run_emb_pool(
            self.discard_pool_enc, batch_dict["discard_card_ids"],
            batch_dict["discard_counts"], self.card_emb, 7,
        )
        # Pool 1: units
        _run_emb_scalar_pool(
            self.unit_pool_enc, batch_dict["unit_ids"],
            batch_dict["unit_counts"], batch_dict["unit_scalars"],
            self.unit_emb, UNIT_SCALAR_DIM, 1,
        )
        # Pool 2: combat enemies
        _run_emb_scalar_pool(
            self.combat_enemy_pool_enc, batch_dict["combat_enemy_ids"],
            batch_dict["combat_enemy_counts"], batch_dict["combat_enemy_scalars"],
            self.enemy_emb, COMBAT_ENEMY_SCALAR_DIM, 2,
        )
        # Pool 3: skills
        _run_emb_pool(
            self.skill_pool_enc, batch_dict["skill_ids"],
            batch_dict["skill_counts"], self.skill_emb, 3,
        )
        # Pool 4: visible sites
        _run_emb_scalar_pool(
            self.visible_site_pool_enc, batch_dict["visible_site_ids"],
            batch_dict["visible_site_counts"], batch_dict["visible_site_scalars"],
            self.map_site_emb, SITE_SCALAR_DIM, 4,
        )
        # Pool 5: map enemies
        _run_emb_scalar_pool(
            self.map_enemy_pool_enc, batch_dict["map_enemy_ids"],
            batch_dict["map_enemy_counts"], batch_dict["map_enemy_scalars"],
            self.enemy_emb, MAP_ENEMY_SCALAR_DIM, 5,
        )
        # Pool 8: revealed hexes
        _run_emb_scalar_pool(
            self.hex_pool_enc, batch_dict["revealed_hex_terrain_ids"],
            batch_dict["revealed_hex_counts"], batch_dict["revealed_hex_scalars"],
            self.hex_terrain_emb, HEX_SCALAR_DIM, 8,
        )

        # Build state input and entity sequence
        state_input = torch.cat(
            [scalars_t, mode_vec, terrain_vec, site_vec, *pool_summaries], dim=-1,
        )
        state_reprs = self.state_encoder(state_input)
        values = self.value_head(state_reprs).squeeze(-1)

        entity_seq = torch.cat(entity_parts, dim=1)     # (N, E, d_model)
        entity_mask_all = torch.cat(mask_parts, dim=1)   # (N, E)

        # ── Action encoding (unchanged) ──────────────────────────────
        action_ids_flat = torch.tensor(batch_dict["action_ids"], dtype=torch.long, device=device)
        action_ids_3d = action_ids_flat.view(n, max_m, 6)
        action_scalars_flat = torch.tensor(batch_dict["action_scalars"], dtype=torch.float32, device=device)
        action_scalars_3d = action_scalars_flat.view(n, max_m, -1)

        target_offsets = batch_dict["action_target_offsets"]
        target_ids_np = batch_dict["action_target_ids"]
        target_pools = torch.zeros(n, max_m, emb, device=device)
        if len(target_ids_np) > 0:
            all_target_ids = torch.tensor(target_ids_np, dtype=torch.long, device=device)
            all_target_embs = self.enemy_emb(all_target_ids)
            for env_i in range(n):
                ac_i = int(action_counts[env_i])
                base = env_i * (max_m + 1)
                for j in range(ac_i):
                    start = int(target_offsets[base + j])
                    end = int(target_offsets[base + j + 1])
                    if end > start:
                        target_pools[env_i, j] = all_target_embs[start:end].mean(dim=0)

        flat_ids = action_ids_3d.view(n * max_m, 6)
        flat_scalars = action_scalars_3d.view(n * max_m, -1)
        flat_targets = target_pools.view(n * max_m, emb)

        flat_action_input = torch.cat([
            self.action_type_emb(flat_ids[:, 0]),
            self.source_emb(flat_ids[:, 1]),
            self.card_emb(flat_ids[:, 2]),
            self.unit_emb(flat_ids[:, 3]),
            self.enemy_emb(flat_ids[:, 4]),
            self.skill_emb(flat_ids[:, 5]),
            flat_targets,
            flat_scalars,
        ], dim=-1)

        flat_action_reprs = self.action_encoder(flat_action_input)
        action_reprs = flat_action_reprs.view(n, max_m, -1)

        # Cross-attention scoring
        logits = self.cross_attn_scorer(
            state_reprs, action_reprs, entity_seq, entity_mask_all,
        )

        # Mask invalid positions
        ac_t = torch.tensor(action_counts, dtype=torch.long, device=device)
        action_mask = torch.arange(max_m, device=device).unsqueeze(0) < ac_t.unsqueeze(1)
        logits = logits.masked_fill(~action_mask, float("-inf"))

        return logits, values


class ReinforcePolicy:
    """Candidate-ranking policy optimized with episodic REINFORCE or PPO."""

    def __init__(self, config: PolicyGradientConfig | None = None) -> None:
        self.config = config or PolicyGradientConfig()
        self._device = _resolve_device(self.config.device)

        self._network = _EmbeddingActionScoringNetwork(
            self.config.hidden_size, self.config.embedding_dim,
            self.config.num_hidden_layers, self.config.d_model,
            goal_dim=self.config.goal_dim,
        ).to(self._device)
        self._optimizer = torch.optim.Adam(self._network.parameters(), lr=self.config.learning_rate)

        self._episode_log_probs: list[torch.Tensor] = []
        self._episode_entropies: list[torch.Tensor] = []
        self._episode_rewards: list[float] = []
        self._episode_values: list[torch.Tensor] = []
        self._next_reward_index = 0
        self.last_step_info: StepInfo | None = None
        self._value_normalizer = ValueNormalizer()

    def choose_action_from_encoded(
        self,
        encoded_step: EncodedStep,
        rng: random.Random | None = None,
    ) -> int:
        """Choose an action from a pre-encoded step (native Rust path).

        Returns the action index directly instead of a CandidateAction.
        Used by the native RL runner where encoding happens in Rust.
        """
        del rng
        if not encoded_step.actions:
            return 0

        self._network.train()
        logits, value = self._network(encoded_step, self._device)

        # Clamp finite logits to prevent NaN from exploding gradients
        logits = logits.clamp(min=-50.0, max=50.0)
        log_probs = torch.log_softmax(logits, dim=0)
        selected_index = int(torch.multinomial(log_probs.exp(), 1).item())

        self._episode_log_probs.append(log_probs[selected_index])
        probs = log_probs.exp()
        self._episode_entropies.append(-(probs * log_probs).sum())
        self._episode_rewards.append(0.0)
        if value is not None:
            self._episode_values.append(value)

        self.last_step_info = StepInfo(
            encoded_step=encoded_step,
            action_index=selected_index,
            log_prob=float(log_probs[selected_index].detach().cpu().item()),
            value=float(value.detach().cpu().item()) if value is not None else 0.0,
        )

        return selected_index

    @torch.inference_mode()
    def choose_actions_batch(
        self, batch_dict: dict,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Choose actions for all envs in a VecEnv batch.

        Args:
            batch_dict: dict of numpy arrays from PyVecEnv.encode_batch()

        Returns:
            (actions, log_probs, values) as numpy arrays, all shape (N,).
            actions: int32, log_probs: float32, values: float32.
        """
        self._network.train()
        logits, values = self._network.forward_batch(batch_dict, self._device)
        # logits: (N, max_M) with -inf at invalid positions
        # Clamp finite logits to prevent NaN from exploding gradients
        finite_mask = logits != float("-inf")
        logits = logits.clamp(min=-50.0, max=50.0).masked_fill(~finite_mask, float("-inf"))
        log_probs_all = torch.log_softmax(logits, dim=-1)  # (N, max_M)
        probs = log_probs_all.exp()
        if torch.isnan(probs).any() or torch.isinf(probs).any() or (probs < 0).any():
            bad_rows = (torch.isnan(probs) | torch.isinf(probs) | (probs < 0)).any(dim=-1)
            for idx in bad_rows.nonzero(as_tuple=True)[0][:3]:
                i = idx.item()
                print(f"[NaN DEBUG] env={i}")
                print(f"  raw logits:  {logits[i][finite_mask[i]]}")
                print(f"  probs:       {probs[i][finite_mask[i]]}")
                print(f"  values:      {values[i]}")
                n_actions = batch_dict["num_actions"][i] if "num_actions" in batch_dict else "?"
                print(f"  num_actions: {n_actions}")
                if "action_scalars" in batch_dict:
                    scalars = batch_dict["action_scalars"][i]
                    if hasattr(scalars, 'shape') and len(scalars.shape) == 2:
                        for j in range(min(int(n_actions) if isinstance(n_actions, (int, float)) else 5, scalars.shape[0])):
                            print(f"  action[{j}] scalars: {scalars[j]}")
        selected = torch.multinomial(probs, 1).squeeze(-1)  # (N,)

        n = logits.shape[0]
        arange_n = torch.arange(n, device=self._device)
        selected_log_probs = log_probs_all[arange_n, selected]  # (N,)

        self.last_step_info = None  # batch mode doesn't use per-step info

        return (
            selected.detach().cpu().numpy().astype(np.int32),
            selected_log_probs.detach().cpu().numpy().astype(np.float32),
            values.detach().cpu().numpy().astype(np.float32),
        )

    def evaluate_search_batch(
        self, batch_dict: dict[str, Any],
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return policy priors and values without recording PPO transitions.

        This is the standalone MCTS inference boundary. It performs exactly one
        batched network forward pass, restores the network training mode afterward,
        and safely handles an all-terminal batch whose action counts are all zero.
        """

        action_counts = np.asarray(batch_dict["action_counts"], dtype=np.int64)
        if action_counts.ndim != 1 or action_counts.size == 0:
            raise ValueError("search batch must contain at least one action count")

        was_training = self._network.training
        self._network.eval()
        try:
            with torch.inference_mode():
                logits, values = self._network.forward_batch(batch_dict, self._device)
                logits = logits.clamp(min=-50.0, max=50.0)
                priors = torch.zeros_like(logits)
                for row, raw_count in enumerate(action_counts):
                    action_count = int(raw_count)
                    if action_count > 0:
                        priors[row, :action_count] = torch.softmax(
                            logits[row, :action_count], dim=0,
                        )
        finally:
            self._network.train(was_training)

        return (
            priors.cpu().numpy().astype(np.float32),
            values.cpu().numpy().astype(np.float32),
        )

    def evaluate_values_batch(self, batch_dict: dict[str, Any]) -> np.ndarray:
        """Evaluate state values without sampling actions or recording PPO data."""
        was_training = self._network.training
        self._network.eval()
        try:
            with torch.inference_mode():
                _, values = self._network.forward_batch(batch_dict, self._device)
        finally:
            self._network.train(was_training)
        return values.cpu().numpy().astype(np.float32)

    def evaluate_encoded_value(self, encoded_step: EncodedStep) -> float:
        """Evaluate one post-step state for time-limit bootstrapping."""
        was_training = self._network.training
        self._network.eval()
        try:
            with torch.inference_mode():
                _, value = self._network(encoded_step, self._device)
        finally:
            self._network.train(was_training)
        return float(value.detach().cpu().item())

    def record_step_reward(self, reward: float) -> None:
        if self._next_reward_index >= len(self._episode_rewards):
            return
        self._episode_rewards[self._next_reward_index] += reward
        self._next_reward_index += 1

    def add_terminal_reward(self, reward: float) -> None:
        if not self._episode_rewards:
            return
        self._episode_rewards[-1] += reward

    def optimize_episode(self, compute_gradients_only: bool = False) -> OptimizationStats:
        if not self._episode_log_probs:
            self._reset_episode_buffers()
            return OptimizationStats(
                loss=0.0,
                total_reward=0.0,
                mean_reward=0.0,
                entropy=0.0,
                action_count=0,
            )

        returns = _discounted_returns(self._episode_rewards, gamma=self.config.gamma)
        returns_tensor = torch.tensor(returns, dtype=torch.float32, device=self._device)

        log_probs = torch.stack(self._episode_log_probs)
        entropies = torch.stack(self._episode_entropies)

        # Actor-Critic: use advantages instead of raw returns when value estimates exist
        critic_loss_val = 0.0
        has_values = len(self._episode_values) == len(self._episode_log_probs)
        if has_values:
            values = torch.stack(self._episode_values)
            # Critic loss: MSE between value predictions and actual returns
            critic_loss = nn.functional.mse_loss(values, returns_tensor.detach())
            critic_loss_val = float(critic_loss.detach().cpu().item())
            # Advantages: how much better the actual return was vs predicted
            advantages = (returns_tensor - values.detach())
            if self.config.normalize_returns and advantages.numel() > 1:
                adv_std = advantages.std(unbiased=False)
                if float(adv_std.item()) > 1e-8:
                    advantages = (advantages - advantages.mean()) / adv_std
            policy_loss = -(log_probs * advantages).mean()
        else:
            # Legacy REINFORCE: no value head, use normalized returns directly
            critic_loss = torch.tensor(0.0, device=self._device)
            if self.config.normalize_returns and returns_tensor.numel() > 1:
                returns_mean = returns_tensor.mean()
                returns_std = returns_tensor.std(unbiased=False)
                if float(returns_std.item()) > 1e-8:
                    returns_tensor = (returns_tensor - returns_mean) / returns_std
            policy_loss = -(log_probs * returns_tensor).mean()

        entropy_bonus = entropies.mean()
        loss = (
            policy_loss
            + self.config.critic_coefficient * critic_loss
            - self.config.entropy_coefficient * entropy_bonus
        )

        self._optimizer.zero_grad(set_to_none=True)
        loss.backward()
        if not compute_gradients_only:
            self._optimizer.step()

        stats = OptimizationStats(
            loss=float(loss.detach().cpu().item()),
            total_reward=float(sum(self._episode_rewards)),
            mean_reward=float(sum(self._episode_rewards) / len(self._episode_rewards)),
            entropy=float(entropies.detach().cpu().mean().item()),
            action_count=len(self._episode_rewards),
            critic_loss=critic_loss_val,
        )
        self._reset_episode_buffers()
        return stats

    def optimize_ppo(
        self,
        transitions: list[Transition],
        advantages: list[float],
        returns: list[float],
        clip_epsilon: float = 0.2,
        ppo_epochs: int = 4,
        max_grad_norm: float = 0.5,
        mini_batch_size: int = 256,
        target_kl: float | None = None,
        entropy_floor: float = 0.0,
        max_critic_loss: float = 0.0,
    ) -> OptimizationStats:
        """Run PPO clipped surrogate update over collected transitions."""
        n = len(transitions)
        if n == 0:
            return OptimizationStats(
                loss=0.0, total_reward=0.0, mean_reward=0.0,
                entropy=0.0, action_count=0,
            )

        adv_t = torch.tensor(advantages, dtype=torch.float32, device=self._device)
        ret_t = torch.tensor(returns, dtype=torch.float32, device=self._device)

        # Value target normalization: update running stats, normalize targets
        self._value_normalizer.update(ret_t)
        norm_ret_t = self._value_normalizer.normalize(ret_t)

        old_lp = torch.tensor(
            [t.log_prob for t in transitions], dtype=torch.float32, device=self._device,
        )

        # Normalize advantages globally
        if adv_t.numel() > 1:
            std = adv_t.std(unbiased=False)
            if float(std.item()) > 1e-8:
                adv_t = (adv_t - adv_t.mean()) / std

        total_loss = 0.0
        total_critic = 0.0
        total_entropy = 0.0
        num_batches = 0

        indices = list(range(n))
        net = self._network

        # ---- Precompute: Python list → tensor conversions (once) ----
        precomp_action_ids: list[torch.Tensor] = []    # (A_i, 6) long
        precomp_action_scalars: list[torch.Tensor] = []  # (A_i, ACTION_SCALAR_DIM)
        precomp_target_ids: list[list[torch.Tensor | None]] = []
        action_counts: list[int] = []
        action_indices_all = torch.tensor(
            [t.action_index for t in transitions],
            dtype=torch.long, device=self._device,
        )

        for t in transitions:
            actions = t.encoded_step.actions
            n_a = len(actions)
            action_counts.append(n_a)
            precomp_action_ids.append(torch.tensor(
                [[a.action_type_id, a.source_id, a.card_id,
                  a.unit_id, a.enemy_id, a.skill_id] for a in actions],
                dtype=torch.long, device=self._device,
            ))
            precomp_action_scalars.append(torch.tensor(
                [a.scalars for a in actions],
                dtype=torch.float32, device=self._device,
            ))
            precomp_target_ids.append([
                torch.tensor(a.target_enemy_ids, dtype=torch.long, device=self._device)
                if a.target_enemy_ids else None
                for a in actions
            ])

        # ---- Precompute raw tensors ONCE (Python→tensor, no embeddings) ----
        raw_state = net._precompute_state_raw_tensors(transitions, self._device)

        epochs_used = 0
        epoch_kl = 0.0

        for _epoch in range(ppo_epochs):
            random.shuffle(indices)
            epoch_kl_sum = 0.0
            epoch_kl_count = 0

            for start in range(0, n, mini_batch_size):
                batch = indices[start : start + mini_batch_size]
                bs = len(batch)
                batch_t = torch.tensor(batch, dtype=torch.long, device=self._device)

                self._optimizer.zero_grad(set_to_none=True)

                # Embedding lookups + attention with live gradients
                state_inputs, entity_seq, entity_mask = (
                    net._encode_state_inputs_batched(raw_state, batch)
                )
                state_reprs = net.state_encoder(state_inputs)  # (bs, hidden)
                values = net.value_head(state_reprs).squeeze(-1)  # (bs,)

                # ---- Batched action encoding ----
                max_A = max(action_counts[idx] for idx in batch)
                flat_size = bs * max_A
                emb_dim = net.emb_dim

                # Pad precomputed action tensors into flat (bs*max_A, ...) arrays
                padded_ids = torch.zeros(
                    flat_size, 6, dtype=torch.long, device=self._device,
                )
                padded_scalars = torch.zeros(
                    flat_size, ACTION_SCALAR_DIM,
                    dtype=torch.float32, device=self._device,
                )
                padded_targets = torch.zeros(
                    flat_size, emb_dim, device=self._device,
                )
                mask = torch.zeros(
                    bs, max_A, dtype=torch.bool, device=self._device,
                )

                for i, idx in enumerate(batch):
                    n_a = action_counts[idx]
                    offset = i * max_A
                    padded_ids[offset : offset + n_a] = precomp_action_ids[idx]
                    padded_scalars[offset : offset + n_a] = precomp_action_scalars[idx]
                    for j, tid in enumerate(precomp_target_ids[idx]):
                        if tid is not None:
                            padded_targets[offset + j] = net.enemy_emb(tid).mean(dim=0)
                    mask[i, :n_a] = True

                # Single batched embedding lookup + action encoder MLP
                flat_action_input = torch.cat([
                    net.action_type_emb(padded_ids[:, 0]),
                    net.source_emb(padded_ids[:, 1]),
                    net.card_emb(padded_ids[:, 2]),
                    net.unit_emb(padded_ids[:, 3]),
                    net.enemy_emb(padded_ids[:, 4]),
                    net.skill_emb(padded_ids[:, 5]),
                    padded_targets,
                    padded_scalars,
                ], dim=-1)  # (flat_size, 7*emb_dim + ACTION_SCALAR_DIM)

                flat_action_reprs = net.action_encoder(
                    flat_action_input,
                )  # (flat_size, hidden)
                action_reprs = flat_action_reprs.view(
                    bs, max_A, -1,
                )  # (bs, max_A, hidden)

                # Cross-attention scoring
                logits = net.cross_attn_scorer(
                    state_reprs, action_reprs, entity_seq, entity_mask,
                )  # (bs, max_A)

                # Masked log_softmax
                logits = logits.masked_fill(~mask, float("-inf"))
                log_probs = torch.log_softmax(logits, dim=-1)  # (bs, max_A)

                # Gather selected action log probs
                batch_action_idx = action_indices_all[batch_t]  # (bs,)
                arange_bs = torch.arange(bs, device=self._device)
                new_lps = log_probs[arange_bs, batch_action_idx]  # (bs,)

                # Vectorized PPO loss
                ratios = torch.exp(new_lps - old_lp[batch_t])
                surr1 = ratios * adv_t[batch_t]
                surr2 = torch.clamp(
                    ratios, 1.0 - clip_epsilon, 1.0 + clip_epsilon,
                ) * adv_t[batch_t]
                b_policy = -torch.min(surr1, surr2).sum()

                # Entropy: compute per-sample then sum, matching policy/critic reduction.
                # mask: (bs, max_A), log_probs: (bs, max_A) with -inf where masked.
                # Zero out masked positions to avoid 0*(-inf)=NaN.
                safe_lp = log_probs.masked_fill(~mask, 0.0)
                safe_p = log_probs.exp().masked_fill(~mask, 0.0)
                per_sample_entropy = -(safe_p * safe_lp).sum(dim=-1)  # (bs,)
                b_entropy = per_sample_entropy.sum()

                b_critic = nn.functional.mse_loss(
                    values, norm_ret_t[batch_t], reduction="sum",
                )

                # Cap critic loss to prevent gradient spikes through shared backbone
                if max_critic_loss > 0:
                    b_critic = torch.clamp(b_critic / bs, max=max_critic_loss) * bs

                # Adaptive entropy coefficient: boost when entropy drops below floor
                ent_coef = self.config.entropy_coefficient
                if entropy_floor > 0:
                    avg_entropy = float(b_entropy.detach().item()) / bs
                    if avg_entropy < entropy_floor:
                        ent_coef = ent_coef * (entropy_floor / max(avg_entropy, 1e-6))

                loss = (
                    b_policy / bs
                    + self.config.critic_coefficient * b_critic / bs
                    - ent_coef * b_entropy / bs
                )
                loss.backward()
                nn.utils.clip_grad_norm_(self._network.parameters(), max_norm=max_grad_norm)
                self._optimizer.step()

                total_loss += float(loss.detach().cpu().item())
                total_critic += float(b_critic.detach().cpu().item()) / bs
                total_entropy += float(b_entropy.detach().cpu().item()) / bs
                num_batches += 1

                # Track KL divergence for early stopping
                with torch.no_grad():
                    log_ratio = new_lps - old_lp[batch_t]
                    approx_kl_batch = float(((torch.exp(log_ratio) - 1) - log_ratio).mean().item())
                    epoch_kl_sum += approx_kl_batch * bs
                    epoch_kl_count += bs

            epochs_used = _epoch + 1
            if epoch_kl_count > 0:
                epoch_kl = epoch_kl_sum / epoch_kl_count
            if target_kl is not None and epoch_kl > target_kl:
                break

        d = max(num_batches, 1)
        total_reward = sum(t.reward for t in transitions)
        # Compute effective entropy coef for logging (last batch value)
        final_entropy = total_entropy / d if d > 0 else 0.0
        effective_ent_coef = self.config.entropy_coefficient
        if entropy_floor > 0 and final_entropy < entropy_floor:
            effective_ent_coef = self.config.entropy_coefficient * (entropy_floor / max(final_entropy, 1e-6))
        return OptimizationStats(
            loss=total_loss / d,
            total_reward=total_reward,
            mean_reward=total_reward / n,
            entropy=total_entropy / d,
            action_count=n,
            critic_loss=total_critic / d,
            epochs_used=epochs_used,
            approx_kl=epoch_kl,
            effective_entropy_coef=effective_ent_coef,
        )

    def extract_gradients(self) -> dict[str, torch.Tensor]:
        """Return a dict of parameter gradients (after backward). Used by workers."""
        return {
            name: p.grad.clone()
            for name, p in self._network.named_parameters()
            if p.grad is not None
        }

    def apply_averaged_gradients(self, gradient_dicts: list[dict[str, torch.Tensor]]) -> None:
        """Average gradients from N workers and apply a single optimizer step."""
        n = len(gradient_dicts)
        self._optimizer.zero_grad(set_to_none=True)
        for name, param in self._network.named_parameters():
            grads_for_param = [gd[name] for gd in gradient_dicts if name in gd]
            if not grads_for_param:
                continue
            avg_grad = sum(grads_for_param) / n
            param.grad = avg_grad
        self._optimizer.step()

    def get_weights(self) -> dict[str, torch.Tensor]:
        """Return network state_dict (for broadcasting to workers)."""
        return {k: v.cpu() for k, v in self._network.state_dict().items()}

    def set_weights(self, state_dict: dict[str, torch.Tensor]) -> None:
        """Load weights (from main process broadcast)."""
        self._network.load_state_dict(state_dict)

    def update_learning_rate(self, progress_remaining: float) -> None:
        """Linearly decay learning rate. progress_remaining goes from 1.0 → 0.0."""
        new_lr = self.config.learning_rate * max(progress_remaining, 0.0)
        for pg in self._optimizer.param_groups:
            pg["lr"] = new_lr

    def save_checkpoint(
        self,
        path: str | Path,
        metadata: dict[str, Any] | None = None,
        reward_normalizer_state: dict[str, float | int] | None = None,
    ) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "config": asdict(self.config),
            "model_state_dict": self._network.state_dict(),
            "optimizer_state_dict": self._optimizer.state_dict(),
            "value_normalizer": self._value_normalizer.state_dict(),
        }
        if metadata is not None:
            payload["metadata"] = metadata
        if reward_normalizer_state is not None:
            payload["reward_normalizer"] = reward_normalizer_state
        torch.save(payload, target)

    @classmethod
    def load_checkpoint(
        cls,
        path: str | Path,
        device_override: str | None = None,
    ) -> tuple[ReinforcePolicy, dict[str, Any]]:
        """Load policy and optimizer from checkpoint. Returns (policy, metadata dict)."""
        payload = torch.load(Path(path), map_location="cpu", weights_only=True)
        config_dict = payload.get("config")
        if not isinstance(config_dict, dict):
            raise ValueError("Checkpoint missing or invalid 'config'")
        config = PolicyGradientConfig(**{k: v for k, v in config_dict.items() if k in PolicyGradientConfig.__dataclass_fields__})
        device = device_override if device_override is not None else config.device
        policy = cls(config=PolicyGradientConfig(**{**asdict(config), "device": device}))
        # strict=False allows loading pre-Actor-Critic checkpoints that lack value_head weights
        policy._network.load_state_dict(payload["model_state_dict"], strict=False)
        if "optimizer_state_dict" in payload:
            policy._optimizer.load_state_dict(payload["optimizer_state_dict"])
        if "value_normalizer" in payload:
            policy._value_normalizer.load_state_dict(payload["value_normalizer"])
        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        reward_normalizer = payload.get("reward_normalizer")
        if isinstance(reward_normalizer, dict):
            metadata["reward_normalizer"] = reward_normalizer
        return policy, metadata

    def _reset_episode_buffers(self) -> None:
        self._episode_log_probs.clear()
        self._episode_entropies.clear()
        self._episode_rewards.clear()
        self._episode_values.clear()
        self._next_reward_index = 0


def _discounted_returns(rewards: list[float], gamma: float) -> list[float]:
    running = 0.0
    out_reversed: list[float] = []
    for reward in reversed(rewards):
        running = reward + gamma * running
        out_reversed.append(running)
    return list(reversed(out_reversed))


def compute_gae(
    episodes: list[list[Transition]],
    gamma: float,
    gae_lambda: float,
    terminated: list[bool] | None = None,
) -> tuple[list[Transition], list[float], list[float]]:
    """Compute GAE advantages and target returns for collected episodes.

    Args:
        episodes: list of episode transition lists.
        gamma: discount factor.
        gae_lambda: GAE lambda parameter.
        terminated: per-episode flag, True if episode ended naturally,
                    False if truncated (hit max_steps). If None, all episodes
                    are assumed to be terminated (backwards compatible).

    Returns (flat_transitions, advantages, returns) — all aligned lists.
    """
    all_transitions: list[Transition] = []
    all_advantages: list[float] = []
    all_returns: list[float] = []

    for ep_idx, episode in enumerate(episodes):
        if not episode:
            continue
        values = [t.value for t in episode]
        rewards = [t.reward for t in episode]
        n = len(episode)

        # For truncated episodes, bootstrap from critic's last value estimate
        # instead of assuming 0.0 (which systematically undervalues long episodes)
        ep_terminated = True if terminated is None else terminated[ep_idx]

        advantages = [0.0] * n
        gae = 0.0
        for t in reversed(range(n)):
            if t == n - 1:
                if ep_terminated:
                    next_value = 0.0
                else:
                    bootstrap_value = episode[-1].bootstrap_value
                    if bootstrap_value is None:
                        raise ValueError(
                            "truncated episode is missing its post-step bootstrap value"
                        )
                    next_value = bootstrap_value
            else:
                next_value = values[t + 1]
            delta = rewards[t] + gamma * next_value - values[t]
            gae = delta + gamma * gae_lambda * gae
            advantages[t] = gae

        returns = [adv + val for adv, val in zip(advantages, values)]
        all_transitions.extend(episode)
        all_advantages.extend(advantages)
        all_returns.extend(returns)

    return all_transitions, all_advantages, all_returns


def _resolve_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    # MPS (Apple GPU) is deliberately excluded from auto-detection:
    # the CPU↔GPU sync overhead per step far exceeds compute savings
    # for our small network (~60K params) and tiny batch sizes (5-25).
    # CPU is ~6x faster end-to-end. Use --device mps to force it.
    return torch.device("cpu")
