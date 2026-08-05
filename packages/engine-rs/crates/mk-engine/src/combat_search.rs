//! Exhaustive combat tree search with transposition table.
//!
//! Given a `GameState` in combat, finds the optimal sequence of actions
//! by exhaustive DFS with three key optimizations:
//!
//! 1. **Transposition table** — hashes combat-relevant state to skip
//!    permutation-equivalent orderings (e.g., playing card A then B vs B then A).
//! 2. **Upper-bound pruning** — computes max achievable fame given remaining
//!    attack potential, prunes branches that can't beat the current best.
//! 3. **Greedy seeding** — runs fast heuristic rollouts first to establish
//!    a good initial lower bound, making pruning effective from the start.
//!
//! # Usage
//!
//! ```ignore
//! use mk_engine::combat_search::{search_combat, CombatSearchConfig};
//!
//! let result = search_combat(&state, &CombatSearchConfig::default());
//! println!("Optimal score: {}, actions: {}", result.score, result.actions.len());
//! ```

use std::collections::HashSet;
use std::fmt;
use std::hash::{Hash, Hasher};

use mk_data::enemies::{attack_count, get_enemy};
use mk_types::enums::{CombatPhase, CombatType, Element, ResistanceElement, SidewaysAs};
use mk_types::legal_action::{LegalAction, LegalActionSet};
use mk_types::state::{ElementalValues, GameState};

use crate::action_pipeline::{apply_legal_action, ApplyResult};
use crate::legal_actions::enumerate_legal_actions;
use crate::undo::UndoStack;

// =============================================================================
// Public API
// =============================================================================

/// Configuration for the combat search.
pub struct CombatSearchConfig {
    /// Maximum number of nodes to visit before stopping.
    pub node_limit: u64,
    /// Number of greedy rollouts to seed the search with a lower bound.
    pub seed_rollouts: u32,
    /// Eval weights for the combat score function.
    pub eval_weights: CombatEvalWeights,
}

/// Default work cap for the beam-width-one combat resolver.
pub const DEFAULT_GREEDY_COMBAT_NODE_LIMIT: u64 = 1_000;
/// Absolute safety ceiling for cheap combat resolution.
pub const MAX_GREEDY_COMBAT_NODE_LIMIT: u64 = 2_000;
/// Per-action cap for the narrow Block/Assign Damage macro evaluation.
const GREEDY_BLOCK_MACRO_NODE_LIMIT: u64 = 16;
/// Aggregate macro cap per real greedy decision.
const GREEDY_BLOCK_MACRO_DECISION_NODE_LIMIT: u64 = 192;
/// A block macro may combine at most two elective block-producing actions.
const GREEDY_BLOCK_MACRO_MAX_CONTRIBUTIONS: u8 = 2;
/// Defensive depth cap for mandatory choices and damage assignment chains.
const GREEDY_BLOCK_MACRO_MAX_DEPTH: u8 = 16;

/// Configuration for cheap, non-recursive combat resolution.
#[derive(Debug, Clone, Copy)]
pub struct GreedyCombatConfig {
    /// Maximum immediate child states that may be evaluated.
    pub node_limit: u64,
    /// Eval weights shared with the production Oracle.
    pub eval_weights: CombatEvalWeights,
}

impl Default for GreedyCombatConfig {
    fn default() -> Self {
        Self {
            node_limit: DEFAULT_GREEDY_COMBAT_NODE_LIMIT,
            eval_weights: CombatEvalWeights::default(),
        }
    }
}

/// Loud failure modes for cheap combat resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GreedyCombatError {
    NotInCombat,
    InvalidNodeLimit { requested: u64, maximum: u64 },
    NodeBudgetExceeded { limit: u64, actions_applied: usize },
    NoLegalActions { phase: CombatPhase },
    UnknownEnemy { enemy_id: String },
    ActionFailed { action: String, message: String },
    StateHashFailed { message: String },
    RepeatedState { state_hash: u64 },
}

impl fmt::Display for GreedyCombatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotInCombat => write!(f, "greedy combat resolver requires an active combat"),
            Self::InvalidNodeLimit { requested, maximum } => write!(
                f,
                "greedy combat node limit {requested} is invalid; expected 1..={maximum}"
            ),
            Self::NodeBudgetExceeded { limit, actions_applied } => write!(
                f,
                "greedy combat exhausted its {limit}-node budget after applying {actions_applied} actions"
            ),
            Self::NoLegalActions { phase } => write!(
                f,
                "greedy combat reached {phase:?} with no legal actions before combat resolved"
            ),
            Self::UnknownEnemy { enemy_id } => {
                write!(f, "greedy combat cannot score unknown enemy {enemy_id:?}")
            }
            Self::ActionFailed { action, message } => {
                write!(f, "greedy combat failed to apply {action}: {message}")
            }
            Self::StateHashFailed { message } => {
                write!(f, "greedy combat could not hash its state: {message}")
            }
            Self::RepeatedState { state_hash } => write!(
                f,
                "greedy combat selected an action that repeated state hash {state_hash}"
            ),
        }
    }
}

impl std::error::Error for GreedyCombatError {}

/// Tunable weights for the combat evaluation function.
///
/// The oracle maximizes: fame × fame_weight - wounds × wound_weight
///   + cards_remaining × cards_remaining_weight - crystals × crystal_weight
///   - units_wounded × unit_wounded_weight - knocked_out_penalty (if KO'd)
#[derive(Debug, Clone, Copy)]
pub struct CombatEvalWeights {
    pub fame: f64,
    pub wound: f64,
    pub cards_remaining: f64,
    pub crystal_spent: f64,
    pub unit_wounded: f64,
    pub knocked_out_penalty: f64,
}

impl Default for CombatEvalWeights {
    fn default() -> Self {
        Self {
            fame: 100.0,
            wound: 80.0,
            cards_remaining: 15.0,
            crystal_spent: 25.0,
            unit_wounded: 40.0,
            knocked_out_penalty: 500.0,
        }
    }
}

impl Default for CombatSearchConfig {
    fn default() -> Self {
        Self {
            node_limit: 10_000_000,
            seed_rollouts: 1000,
            eval_weights: CombatEvalWeights::default(),
        }
    }
}

/// Result of the combat search.
#[derive(Debug, Clone)]
pub struct CombatSearchResult {
    /// Composite score (higher = better).
    pub score: f64,
    /// Fame gained during combat.
    pub fame_gained: u32,
    /// Wounds taken during combat.
    pub wounds_taken: u32,
    /// Non-wound cards remaining in hand after combat.
    pub cards_remaining: usize,
    /// Crystals spent during combat.
    pub crystals_spent: i32,
    /// Units newly wounded during combat.
    pub units_newly_wounded: i32,
    /// Whether the player would be knocked out.
    pub knocked_out: bool,
    /// Optimal action sequence from the search.
    pub actions: Vec<LegalAction>,
    /// Number of nodes visited during the search.
    pub nodes_visited: u64,
    /// Number of nodes pruned by upper-bound.
    pub nodes_pruned: u64,
    /// Number of transposition hits (permutation duplicates skipped).
    pub transpositions: u64,
    /// Number of unique states explored.
    pub unique_states: usize,
    /// Whether the search exhausted the full tree (vs hitting node limit).
    pub complete: bool,
}

/// Search for the optimal combat play from the current state.
///
/// The state must be in combat (`state.combat.is_some()`).
/// Returns the best action sequence found within the node budget.
pub fn search_combat(state: &GameState, config: &CombatSearchConfig) -> CombatSearchResult {
    let pre = PreCombatSnapshot::from_state(state);
    let action_set = enumerate_legal_actions(state, 0);

    let total_possible_fame: u32 = state
        .combat
        .as_ref()
        .map(|c| {
            c.enemies
                .iter()
                .map(|e| {
                    mk_data::enemies::get_enemy(e.enemy_id.as_str())
                        .map(|d| d.fame)
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0);

    let mut stats = DfsStats::new(total_possible_fame);

    let weights = &config.eval_weights;

    // Seed with greedy rollouts.
    if config.seed_rollouts > 0 {
        if let Some((seed_score, seed_path)) =
            greedy_seed(state, &action_set, &pre, config.seed_rollouts, weights)
        {
            stats.best_score = Some(seed_score);
            stats.best_path = seed_path;
        }
    }

    // Run exhaustive DFS.
    let mut path = Vec::new();
    dfs(
        state,
        &action_set,
        &mut stats,
        config.node_limit,
        &pre,
        &mut path,
        weights,
    );

    let complete = stats.nodes_visited < config.node_limit;

    match stats.best_score {
        Some(score) => CombatSearchResult {
            score: score.total,
            fame_gained: score.fame_gained,
            wounds_taken: score.wounds_taken,
            cards_remaining: score.cards_remaining,
            crystals_spent: score.crystals_spent,
            units_newly_wounded: score.units_newly_wounded,
            knocked_out: score.knocked_out,
            actions: stats.best_path,
            nodes_visited: stats.nodes_visited,
            nodes_pruned: stats.nodes_pruned,
            transpositions: stats.transpositions,
            unique_states: stats.seen.len(),
            complete,
        },
        None => CombatSearchResult {
            score: f64::NEG_INFINITY,
            fame_gained: 0,
            wounds_taken: 0,
            cards_remaining: 0,
            crystals_spent: 0,
            units_newly_wounded: 0,
            knocked_out: false,
            actions: Vec::new(),
            nodes_visited: stats.nodes_visited,
            nodes_pruned: stats.nodes_pruned,
            transpositions: stats.transpositions,
            unique_states: stats.seen.len(),
            complete,
        },
    }
}

/// Resolve combat with a deterministic beam-width-one policy.
///
/// At each decision, every immediate legal child is evaluated once. Block-phase
/// children receive a tiny, fixed-width macro evaluation through damage assignment
/// so two contributions can complete a block. Every speculative child counts
/// against `GreedyCombatConfig::node_limit`; the resolver remains strictly bounded.
/// Terminal values use the exact Oracle objective, while non-terminal values add
/// phase-local projections using the same fame and wound weights.
///
/// # Known systematic bias (MCTS safety requirement)
///
/// This deterministic approximation does **not** have zero-mean error. The broad
/// 40-fixture Oracle diagnostic found a positive mean signed error (Oracle minus
/// greedy), with the resolver specifically undervaluing multi-action and multi-phase
/// synergies such as preserving a card for a later phase and combining several card
/// or unit contributions before a block becomes valuable. Repeating an MCTS rollout
/// cannot average away this deterministic error; uncorrected leaf values will bias
/// tree search against long-horizon combat lines.
///
/// MCTS results that traverse this resolver must not be treated as trustworthy until
/// they include mitigation such as occasional full-Oracle calibration or a validated
/// leaf-value correction. Calibration work is tracked by
/// <https://github.com/mage-knight-digital/MageKnight/issues/1123>.
pub fn search_combat_greedy(
    state: &GameState,
    config: &GreedyCombatConfig,
) -> Result<CombatSearchResult, GreedyCombatError> {
    if state.combat.is_none() {
        return Err(GreedyCombatError::NotInCombat);
    }
    if config.node_limit == 0 || config.node_limit > MAX_GREEDY_COMBAT_NODE_LIMIT {
        return Err(GreedyCombatError::InvalidNodeLimit {
            requested: config.node_limit,
            maximum: MAX_GREEDY_COMBAT_NODE_LIMIT,
        });
    }

    let pre = PreCombatSnapshot::from_state(state);
    let mut current_state = state.clone();
    let mut current_actions = enumerate_legal_actions(&current_state, 0);
    let mut path = Vec::new();
    let mut nodes_visited = 0u64;
    let mut seen = HashSet::new();
    seen.insert(combat_resolution_cache_hash(&current_state)?);

    while current_state.combat.is_some() && !current_state.game_ended {
        if current_actions.actions.is_empty() {
            let phase = current_state.combat.as_ref().unwrap().phase;
            return Err(GreedyCombatError::NoLegalActions { phase });
        }

        let remaining = config.node_limit.saturating_sub(nodes_visited);
        if current_actions.actions.len() as u64 > remaining {
            return Err(GreedyCombatError::NodeBudgetExceeded {
                limit: config.node_limit,
                actions_applied: path.len(),
            });
        }

        let mut best: Option<(f64, u32, LegalAction, GameState, LegalActionSet)> = None;
        let mut block_macro_nodes_this_decision = 0;
        for (action_index, action) in current_actions.actions.iter().enumerate() {
            nodes_visited += 1;
            let (child_state, child_actions) = step_checked(&current_state, action)?;
            let remaining_immediate = current_actions.actions.len() - action_index - 1;
            let macro_slots_remaining = (remaining_immediate + 1) as u64;
            let fair_macro_share = GREEDY_BLOCK_MACRO_DECISION_NODE_LIMIT
                .saturating_sub(block_macro_nodes_this_decision)
                / macro_slots_remaining;
            let available_for_macro = config
                .node_limit
                .saturating_sub(nodes_visited)
                .saturating_sub(remaining_immediate as u64)
                .min(fair_macro_share)
                .min(GREEDY_BLOCK_MACRO_NODE_LIMIT);
            let (block_macro_value, macro_nodes) = if current_state
                .combat
                .as_ref()
                .is_some_and(|combat| combat.phase == CombatPhase::Block)
                && current_state.players[0]
                    .combat_accumulator
                    .block_elements
                    .total()
                    == 0
                && available_for_macro > 0
            {
                evaluate_block_macro(
                    &pre,
                    action,
                    &child_state,
                    &child_actions,
                    &config.eval_weights,
                    available_for_macro,
                )?
            } else {
                (None, 0)
            };
            nodes_visited += macro_nodes;
            block_macro_nodes_this_decision += macro_nodes;

            let value = if selects_infeasible_attack_targets(action, &child_state) {
                f64::NEG_INFINITY
            } else if let Some(value) = block_macro_value {
                value
            } else {
                greedy_state_value(&pre, &child_state, &config.eval_weights)?
                    + pending_card_projection(&pre, action, &child_state, &config.eval_weights)?
            };
            let priority = action_priority(action);
            let replace = best.as_ref().is_none_or(|(best_value, best_priority, ..)| {
                value.total_cmp(best_value).is_gt()
                    || (value.total_cmp(best_value).is_eq() && priority < *best_priority)
            });
            if replace {
                best = Some((value, priority, action.clone(), child_state, child_actions));
            }
        }

        let (_, _, action, next_state, next_actions) = best.expect("non-empty action set");
        let next_hash = combat_resolution_cache_hash(&next_state)?;
        if !seen.insert(next_hash) {
            return Err(GreedyCombatError::RepeatedState {
                state_hash: next_hash,
            });
        }
        path.push(action);
        current_state = next_state;
        current_actions = next_actions;
    }

    let score = CombatScore::evaluate(&pre, &current_state, &config.eval_weights);
    Ok(CombatSearchResult {
        score: score.total,
        fame_gained: score.fame_gained,
        wounds_taken: score.wounds_taken,
        cards_remaining: score.cards_remaining,
        crystals_spent: score.crystals_spent,
        units_newly_wounded: score.units_newly_wounded,
        knocked_out: score.knocked_out,
        actions: path,
        nodes_visited,
        nodes_pruned: 0,
        transpositions: 0,
        unique_states: seen.len(),
        complete: true,
    })
}

// =============================================================================
// Evaluation
// =============================================================================

#[derive(Clone)]
struct PreCombatSnapshot {
    fame: u32,
    crystals_total: u8,
    units_wounded: usize,
}

impl PreCombatSnapshot {
    fn from_state(state: &GameState) -> Self {
        let player = &state.players[0];
        Self {
            fame: player.fame,
            crystals_total: player.crystals.red
                + player.crystals.blue
                + player.crystals.green
                + player.crystals.white,
            units_wounded: player.units.iter().filter(|u| u.wounded).count(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct CombatScore {
    fame_gained: u32,
    wounds_taken: u32,
    cards_remaining: usize,
    crystals_spent: i32,
    units_newly_wounded: i32,
    knocked_out: bool,
    total: f64,
}

impl CombatScore {
    fn evaluate(pre: &PreCombatSnapshot, state: &GameState, w: &CombatEvalWeights) -> Self {
        let player = &state.players[0];
        let fame_gained = player.fame.saturating_sub(pre.fame);
        let wounds_taken =
            player.wounds_received_this_turn.hand + player.wounds_received_this_turn.discard;
        let cards_remaining = player.hand.iter().filter(|c| c.as_str() != "wound").count();
        let crystals_now = player.crystals.red
            + player.crystals.blue
            + player.crystals.green
            + player.crystals.white;
        let crystals_spent = pre.crystals_total as i32 - crystals_now as i32;
        let units_wounded_now = player.units.iter().filter(|u| u.wounded).count();
        let units_newly_wounded = units_wounded_now as i32 - pre.units_wounded as i32;

        let wounds_in_hand = player.hand.iter().filter(|c| c.as_str() == "wound").count() as u32;
        let knocked_out = wounds_in_hand >= player.hand_limit;

        let total = if knocked_out {
            fame_gained as f64 * w.fame
                - wounds_taken as f64 * w.wound
                - w.knocked_out_penalty
                - crystals_spent.max(0) as f64 * w.crystal_spent
                - units_newly_wounded.max(0) as f64 * w.unit_wounded
        } else {
            fame_gained as f64 * w.fame - wounds_taken as f64 * w.wound
                + cards_remaining as f64 * w.cards_remaining
                - crystals_spent.max(0) as f64 * w.crystal_spent
                - units_newly_wounded.max(0) as f64 * w.unit_wounded
        };

        Self {
            fame_gained,
            wounds_taken,
            cards_remaining,
            crystals_spent,
            units_newly_wounded,
            knocked_out,
            total,
        }
    }
}

fn greedy_state_value(
    pre: &PreCombatSnapshot,
    state: &GameState,
    weights: &CombatEvalWeights,
) -> Result<f64, GreedyCombatError> {
    let base = CombatScore::evaluate(pre, state, weights).total;
    let Some(combat) = state.combat.as_ref() else {
        return Ok(base);
    };

    let projection = match combat.phase {
        CombatPhase::RangedSiege => {
            (projected_attack_fame(state)? + projected_future_attack_fame(state)?) * weights.fame
        }
        CombatPhase::Attack => projected_attack_fame(state)? * weights.fame,
        CombatPhase::Block => {
            projected_future_attack_fame(state)? * weights.fame
                - (projected_incoming_wounds(state)? - projected_avoided_wounds(state)?)
                    * weights.wound
        }
        CombatPhase::AssignDamage => projected_future_attack_fame(state)? * weights.fame,
    };
    Ok(base + projection)
}

#[derive(Clone)]
struct BlockMacroNode {
    state: GameState,
    actions: LegalActionSet,
    contributions: u8,
    declared_block: bool,
    depth: u8,
}

/// Evaluate one Block-phase child with a deliberately tiny local search.
///
/// This is the only lookahead in the cheap resolver. It may combine at most two
/// elective block-producing actions, then follows declarations and damage
/// assignment until Attack begins. All applied children are returned to the
/// caller and charged to the resolver's global node budget.
fn evaluate_block_macro(
    pre: &PreCombatSnapshot,
    initial_action: &LegalAction,
    initial_state: &GameState,
    initial_actions: &LegalActionSet,
    weights: &CombatEvalWeights,
    node_limit: u64,
) -> Result<(Option<f64>, u64), GreedyCombatError> {
    let mut stack = vec![BlockMacroNode {
        state: initial_state.clone(),
        actions: initial_actions.clone(),
        contributions: u8::from(is_block_contribution(initial_action)),
        declared_block: matches!(initial_action, LegalAction::DeclareBlock { .. }),
        depth: 0,
    }];
    let mut seen = HashSet::new();
    seen.insert(combat_resolution_cache_hash(initial_state)?);
    let mut nodes_visited = 0;
    let mut best_value: Option<f64> = None;

    while let Some(node) = stack.pop() {
        let phase = node.state.combat.as_ref().map(|combat| combat.phase);
        if node.state.game_ended
            || phase.is_none()
            || phase.is_some_and(|phase| phase == CombatPhase::Attack)
        {
            let value = block_macro_endpoint_value(pre, &node.state, weights)?;
            if best_value.is_none_or(|best| value.total_cmp(&best).is_gt()) {
                best_value = Some(value);
            }
            continue;
        }
        if node.depth >= GREEDY_BLOCK_MACRO_MAX_DEPTH || nodes_visited >= node_limit {
            continue;
        }

        let has_active_pending = node.state.players[0].pending.has_active();
        let mut candidates: Vec<&LegalAction> = node
            .actions
            .actions
            .iter()
            .filter(|action| {
                is_block_macro_action(
                    action,
                    phase.expect("active combat has a phase"),
                    has_active_pending,
                    node.contributions,
                )
            })
            .collect();
        candidates.sort_by_key(|action| block_macro_priority(action, node.declared_block));

        for action in candidates.into_iter().rev() {
            if nodes_visited >= node_limit {
                break;
            }
            let (child_state, child_actions) = step_checked(&node.state, action)?;
            nodes_visited += 1;
            let contributions = node
                .contributions
                .saturating_add(u8::from(is_block_contribution(action)));
            let state_hash = combat_resolution_cache_hash(&child_state)?;
            if !seen.insert(state_hash) {
                continue;
            }
            stack.push(BlockMacroNode {
                state: child_state,
                actions: child_actions,
                contributions,
                declared_block: node.declared_block
                    || matches!(action, LegalAction::DeclareBlock { .. }),
                depth: node.depth + 1,
            });
        }
    }

    Ok((best_value, nodes_visited))
}

fn block_macro_endpoint_value(
    pre: &PreCombatSnapshot,
    state: &GameState,
    weights: &CombatEvalWeights,
) -> Result<f64, GreedyCombatError> {
    let base = CombatScore::evaluate(pre, state, weights).total;
    if state
        .combat
        .as_ref()
        .is_some_and(|combat| combat.phase == CombatPhase::Attack)
    {
        Ok(base + projected_future_attack_fame(state)? * weights.fame)
    } else {
        Ok(base)
    }
}

fn is_block_macro_action(
    action: &LegalAction,
    phase: CombatPhase,
    has_active_pending: bool,
    contributions: u8,
) -> bool {
    if matches!(action, LegalAction::Undo) {
        return false;
    }
    if has_active_pending || phase == CombatPhase::AssignDamage {
        return true;
    }
    phase == CombatPhase::Block
        && (matches!(
            action,
            LegalAction::DeclareBlock { .. } | LegalAction::EndCombatPhase
        ) || (contributions < GREEDY_BLOCK_MACRO_MAX_CONTRIBUTIONS
            && is_block_contribution(action)))
}

fn is_block_contribution(action: &LegalAction) -> bool {
    matches!(
        action,
        LegalAction::PlayCardBasic { .. }
            | LegalAction::PlayCardPowered { .. }
            | LegalAction::PlayCardSideways {
                sideways_as: SidewaysAs::Block,
                ..
            }
            | LegalAction::ActivateUnit { .. }
            | LegalAction::UseSkill { .. }
            | LegalAction::UseBannerFear { .. }
            | LegalAction::ConvertInfluenceToBlock { .. }
            | LegalAction::ApplyBlockBoost { .. }
    )
}

fn block_macro_priority(action: &LegalAction, declared_block: bool) -> u32 {
    match action {
        LegalAction::DeclareBlock { .. } => 0,
        LegalAction::EndCombatPhase if declared_block => 1,
        action if is_block_contribution(action) => 2,
        LegalAction::AssignDamageToUnit { .. } => 3,
        LegalAction::AssignDamageToHero { .. } => 4,
        LegalAction::EndCombatPhase => 5,
        _ => action_priority(action) + 5,
    }
}

/// Reject a target selection that cannot be defeated even if every remaining
/// hand card contributes its optimistic maximum attack for the current phase.
///
/// The final feasibility decision deliberately goes through the production
/// attack checker so enemy resistances, fortification, armor modifiers, and
/// ranged-versus-siege pool rules stay identical to normal combat resolution.
fn selects_infeasible_attack_targets(action: &LegalAction, state: &GameState) -> bool {
    if !matches!(
        action,
        LegalAction::SubsetSelect { .. } | LegalAction::SubsetConfirm
    ) {
        return false;
    }

    let Some(combat) = state.combat.as_ref() else {
        return false;
    };
    if !matches!(combat.phase, CombatPhase::RangedSiege | CombatPhase::Attack) {
        return false;
    }

    let selection = selected_attack_targets(state);
    let Some((target_ids, attack_type)) = selection else {
        return false;
    };
    if target_ids.is_empty() {
        return false;
    }

    let mut optimistic = state.clone();
    let future_from_hand = max_future_attack_elements(state);
    let attack = &mut optimistic.players[0].combat_accumulator.attack;
    match combat.phase {
        CombatPhase::RangedSiege => {
            attack.ranged_elements = crate::combat_resolution::add_elements(
                &attack.ranged_elements,
                &future_from_hand.ranged,
            );
            attack.siege_elements = crate::combat_resolution::add_elements(
                &attack.siege_elements,
                &future_from_hand.siege,
            );
        }
        CombatPhase::Attack => {
            attack.normal_elements = crate::combat_resolution::add_elements(
                &attack.normal_elements,
                &future_from_hand.melee,
            );
        }
        _ => return false,
    }

    !crate::legal_actions::combat::is_declared_attack_sufficient(
        &optimistic,
        0,
        &target_ids,
        attack_type,
    )
}

fn selected_attack_targets(
    state: &GameState,
) -> Option<(Vec<mk_types::ids::CombatInstanceId>, CombatType)> {
    let combat = state.combat.as_ref()?;
    if let (Some(target_ids), Some(attack_type)) =
        (&combat.declared_attack_targets, combat.declared_attack_type)
    {
        return Some((target_ids.clone(), attack_type));
    }

    let mk_types::pending::ActivePending::SubsetSelection(selection) =
        state.players[0].pending.active.as_ref()?
    else {
        return None;
    };
    let mk_types::pending::SubsetSelectionKind::AttackTargets {
        attack_type,
        eligible_instance_ids,
    } = &selection.kind
    else {
        return None;
    };
    let target_ids = selection
        .selected
        .iter()
        .map(|&index| eligible_instance_ids[index].clone())
        .collect();
    Some((target_ids, *attack_type))
}

/// Estimate the best Attack-phase fame still enabled by cards in hand.
///
/// This opportunity-cost term prevents a myopic block decision from consuming
/// every attack-capable card merely to avoid one wound.
fn projected_future_attack_fame(state: &GameState) -> Result<f64, GreedyCombatError> {
    let combat = state.combat.as_ref().unwrap();
    let mut remaining_attack = f64::from(max_future_melee_attack(state));
    let mut candidates = Vec::new();
    for enemy in combat.enemies.iter().filter(|enemy| !enemy.is_defeated) {
        let definition =
            get_enemy(enemy.enemy_id.as_str()).ok_or_else(|| GreedyCombatError::UnknownEnemy {
                enemy_id: enemy.enemy_id.as_str().to_owned(),
            })?;
        let target_ids = vec![enemy.instance_id.clone()];
        let defend = crate::combat_resolution::auto_assign_defend(
            &combat.enemies,
            &target_ids,
            &combat.used_defend,
            &combat.defend_bonuses,
        );
        let armor = crate::legal_actions::combat::compute_total_target_armor(
            combat,
            &target_ids,
            &state.active_modifiers,
            Some(&defend),
        );
        let physical_cost = if definition
            .resistances
            .contains(&ResistanceElement::Physical)
        {
            armor.saturating_mul(2)
        } else {
            armor
        };
        candidates.push((f64::from(physical_cost.max(1)), f64::from(definition.fame)));
    }
    candidates.sort_by(|(left_cost, left_fame), (right_cost, right_fame)| {
        (right_fame / right_cost).total_cmp(&(left_fame / left_cost))
    });

    let mut projected_fame = 0.0;
    for (cost, fame) in candidates {
        if remaining_attack >= cost {
            projected_fame += fame;
            remaining_attack -= cost;
        }
    }
    Ok(projected_fame)
}

/// Estimate fame already supported by the currently accumulated attack.
///
/// This is only an intermediate-state projection. Once an attack resolves, the
/// real fame delta in `CombatScore::evaluate` replaces it exactly.
fn projected_attack_fame(state: &GameState) -> Result<f64, GreedyCombatError> {
    let combat = state.combat.as_ref().unwrap();
    let player = &state.players[0];
    let attack_type = match combat.phase {
        CombatPhase::RangedSiege => CombatType::Siege,
        CombatPhase::Attack => CombatType::Melee,
        _ => return Ok(0.0),
    };

    let candidate_ids = combat.declared_attack_targets.clone().unwrap_or_else(|| {
        crate::legal_actions::combat::eligible_attack_targets(
            combat,
            attack_type,
            &state.active_modifiers,
            Some(player.id.as_str()),
        )
    });
    if candidate_ids.is_empty() {
        return Ok(0.0);
    }

    if combat.declared_attack_targets.is_some()
        && crate::legal_actions::combat::is_declared_attack_sufficient(
            state,
            0,
            &candidate_ids,
            attack_type,
        )
    {
        return candidate_ids.iter().try_fold(0.0, |total, instance_id| {
            let enemy = combat
                .enemies
                .iter()
                .find(|enemy| enemy.instance_id == *instance_id)
                .expect("declared attack target must exist");
            let definition = get_enemy(enemy.enemy_id.as_str()).ok_or_else(|| {
                GreedyCombatError::UnknownEnemy {
                    enemy_id: enemy.enemy_id.as_str().to_owned(),
                }
            })?;
            Ok(total + f64::from(definition.fame))
        });
    }

    let accumulator = &player.combat_accumulator;
    let mut best = 0.0f64;
    for instance_id in candidate_ids {
        let enemy = combat
            .enemies
            .iter()
            .find(|enemy| enemy.instance_id == instance_id)
            .expect("eligible attack target must exist");
        let definition =
            get_enemy(enemy.enemy_id.as_str()).ok_or_else(|| GreedyCombatError::UnknownEnemy {
                enemy_id: enemy.enemy_id.as_str().to_owned(),
            })?;
        let fortified = crate::combat_resolution::is_effectively_fortified(
            definition,
            enemy.instance_id.as_str(),
            combat.is_at_fortified_site,
            &state.active_modifiers,
        );
        let available = match combat.phase {
            CombatPhase::RangedSiege => {
                let siege = crate::combat_resolution::subtract_elements(
                    &accumulator.attack.siege_elements,
                    &accumulator.assigned_attack.siege_elements,
                );
                if fortified {
                    siege
                } else {
                    let ranged = crate::combat_resolution::subtract_elements(
                        &accumulator.attack.ranged_elements,
                        &accumulator.assigned_attack.ranged_elements,
                    );
                    crate::combat_resolution::add_elements(&siege, &ranged)
                }
            }
            CombatPhase::Attack => crate::combat_resolution::subtract_elements(
                &accumulator.attack.normal_elements,
                &accumulator.assigned_attack.normal_elements,
            ),
            _ => unreachable!(),
        };
        let effective_attack = crate::combat_resolution::calculate_effective_attack(
            &available,
            definition.resistances,
        );
        let armor = crate::legal_actions::combat::compute_total_target_armor(
            combat,
            std::slice::from_ref(&enemy.instance_id),
            &state.active_modifiers,
            None,
        );
        let progress = if armor == 0 {
            1.0
        } else {
            (f64::from(effective_attack) / f64::from(armor)).min(1.0)
        };
        best = best.max(progress * f64::from(definition.fame));
    }
    Ok(best)
}

/// Estimate wounds avoided by block already accumulated or committed.
fn projected_avoided_wounds(state: &GameState) -> Result<f64, GreedyCombatError> {
    let combat = state.combat.as_ref().unwrap();
    let player = &state.players[0];
    let mut best_avoided = 0.0f64;

    for enemy in combat.enemies.iter().filter(|enemy| !enemy.is_defeated) {
        let definition =
            get_enemy(enemy.enemy_id.as_str()).ok_or_else(|| GreedyCombatError::UnknownEnemy {
                enemy_id: enemy.enemy_id.as_str().to_owned(),
            })?;
        let city_color = crate::combat_resolution::effective_city_color_for_enemy(combat, enemy);
        for attack_index in 0..attack_count(definition) {
            if enemy
                .attacks_cancelled
                .get(attack_index)
                .copied()
                .unwrap_or(false)
            {
                continue;
            }
            let (damage, element, is_swift) =
                crate::combat_resolution::get_enemy_attack_info_with_city(
                    definition,
                    attack_index,
                    city_color,
                );
            if damage == 0 {
                continue;
            }
            let (wounds, is_poison) =
                crate::combat_resolution::calculate_hero_wounds_with_damage_and_city(
                    definition,
                    attack_index,
                    player.armor,
                    damage,
                    city_color,
                );
            let wounds_if_unblocked = wounds + u32::from(is_poison);
            let already_blocked = enemy
                .attacks_blocked
                .get(attack_index)
                .copied()
                .unwrap_or(false);
            if already_blocked {
                continue;
            }
            let required = if is_swift {
                damage.saturating_mul(2)
            } else {
                damage
            };
            let effective = crate::combat_resolution::calculate_effective_block(
                &player.combat_accumulator.block_elements,
                element,
            );
            let progress = if effective >= required { 1.0 } else { 0.0 };
            best_avoided = best_avoided.max(progress * f64::from(wounds_if_unblocked));
        }
    }
    Ok(best_avoided)
}

fn projected_incoming_wounds(state: &GameState) -> Result<f64, GreedyCombatError> {
    let combat = state.combat.as_ref().unwrap();
    let player = &state.players[0];
    let mut incoming = 0u32;
    for enemy in combat.enemies.iter().filter(|enemy| !enemy.is_defeated) {
        let definition =
            get_enemy(enemy.enemy_id.as_str()).ok_or_else(|| GreedyCombatError::UnknownEnemy {
                enemy_id: enemy.enemy_id.as_str().to_owned(),
            })?;
        let city_color = crate::combat_resolution::effective_city_color_for_enemy(combat, enemy);
        for attack_index in 0..attack_count(definition) {
            let prevented = enemy
                .attacks_blocked
                .get(attack_index)
                .copied()
                .unwrap_or(false)
                || enemy
                    .attacks_cancelled
                    .get(attack_index)
                    .copied()
                    .unwrap_or(false);
            if prevented {
                continue;
            }
            let (damage, _, _) = crate::combat_resolution::get_enemy_attack_info_with_city(
                definition,
                attack_index,
                city_color,
            );
            let (wounds, is_poison) =
                crate::combat_resolution::calculate_hero_wounds_with_damage_and_city(
                    definition,
                    attack_index,
                    player.armor,
                    damage,
                    city_color,
                );
            incoming += wounds + u32::from(is_poison);
        }
    }
    Ok(f64::from(incoming))
}

/// Estimate the best branch of a just-created card choice. Card play and its
/// mandatory `ResolveChoice` are one semantic decision, but two engine actions;
/// without this bridge, immediate sideways effects always beat stronger basics.
fn pending_card_projection(
    pre: &PreCombatSnapshot,
    action: &LegalAction,
    child: &GameState,
    weights: &CombatEvalWeights,
) -> Result<f64, GreedyCombatError> {
    if !child.players[0].pending.has_active() {
        return Ok(0.0);
    }
    let (card_id, powered) = match action {
        LegalAction::PlayCardBasic { card_id, .. } => (card_id.as_str(), false),
        LegalAction::PlayCardPowered { card_id, .. } => (card_id.as_str(), true),
        _ => return Ok(0.0),
    };
    let Some(definition) = mk_data::cards::get_card(card_id) else {
        return Ok(0.0);
    };
    let effect = if powered {
        &definition.powered_effect
    } else {
        &definition.basic_effect
    };
    let current_value = greedy_state_value(pre, child, weights)?;
    let mut best_value = current_value;

    if let Some(attack) = extract_max_attack(effect) {
        let mut projected = child.clone();
        projected.players[0]
            .combat_accumulator
            .attack
            .normal_elements
            .physical += attack;
        best_value = best_value.max(greedy_state_value(pre, &projected, weights)?);
    }
    if let Some(block) = extract_max_block(effect) {
        let mut projected = child.clone();
        projected.players[0]
            .combat_accumulator
            .block_elements
            .physical += block;
        best_value = best_value.max(greedy_state_value(pre, &projected, weights)?);
    }

    Ok(best_value - current_value)
}

// =============================================================================
// State helpers
// =============================================================================

fn is_combat_terminal(state: &GameState, num_actions: usize) -> bool {
    if num_actions == 0 || state.game_ended || state.combat.is_none() {
        return true;
    }
    state
        .combat
        .as_ref()
        .map(|c| c.enemies.iter().all(|e| e.is_defeated))
        .unwrap_or(false)
}

fn step(state: &GameState, action: &LegalAction) -> Option<(GameState, LegalActionSet)> {
    let mut child = state.clone();
    let mut undo = UndoStack::new();
    let epoch = child.action_epoch;
    match apply_legal_action(&mut child, &mut undo, 0, action, epoch) {
        Ok(ApplyResult { .. }) => {
            let actions = enumerate_legal_actions(&child, 0);
            Some((child, actions))
        }
        Err(_) => None,
    }
}

fn step_checked(
    state: &GameState,
    action: &LegalAction,
) -> Result<(GameState, LegalActionSet), GreedyCombatError> {
    let mut child = state.clone();
    let mut undo = UndoStack::new();
    let epoch = child.action_epoch;
    apply_legal_action(&mut child, &mut undo, 0, action, epoch).map_err(|error| {
        GreedyCombatError::ActionFailed {
            action: format!("{action:?}"),
            message: format!("{error:?}"),
        }
    })?;
    let actions = enumerate_legal_actions(&child, 0);
    Ok((child, actions))
}

/// Exact deterministic hash used for replay-safe resolution caching.
///
/// The DFS transposition hash below intentionally canonicalizes some fields. A
/// cached action sequence cannot do that safely because actions contain indices,
/// so batch resolution caches hash the complete serialized state instead.
pub fn combat_resolution_cache_hash(state: &GameState) -> Result<u64, GreedyCombatError> {
    let encoded =
        serde_json::to_vec(state).map_err(|error| GreedyCombatError::StateHashFailed {
            message: error.to_string(),
        })?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    encoded.hash(&mut hasher);
    Ok(hasher.finish())
}

// =============================================================================
// Transposition table
// =============================================================================

fn combat_state_hash(state: &GameState) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    let p = &state.players[0];

    // Hand (sorted — order doesn't matter)
    let mut hand: Vec<&str> = p.hand.iter().map(|c| c.as_str()).collect();
    hand.sort_unstable();
    for card in &hand {
        card.hash(&mut h);
    }

    // Combat accumulator
    let atk = &p.combat_accumulator.attack;
    atk.normal.hash(&mut h);
    atk.ranged.hash(&mut h);
    atk.siege.hash(&mut h);
    atk.normal_elements.fire.hash(&mut h);
    atk.normal_elements.ice.hash(&mut h);
    atk.normal_elements.cold_fire.hash(&mut h);
    atk.ranged_elements.fire.hash(&mut h);
    atk.ranged_elements.ice.hash(&mut h);
    atk.siege_elements.fire.hash(&mut h);
    atk.siege_elements.ice.hash(&mut h);
    p.combat_accumulator.block.hash(&mut h);
    p.combat_accumulator.block_elements.fire.hash(&mut h);
    p.combat_accumulator.block_elements.ice.hash(&mut h);
    p.combat_accumulator.assigned_block.hash(&mut h);

    // Wounds
    p.wounds_received_this_turn.hand.hash(&mut h);
    p.wounds_received_this_turn.discard.hash(&mut h);

    // Crystals
    p.crystals.red.hash(&mut h);
    p.crystals.blue.hash(&mut h);
    p.crystals.green.hash(&mut h);
    p.crystals.white.hash(&mut h);

    // Mana tokens (sorted for order independence)
    let mut tokens: Vec<(u8, u8)> = p
        .pure_mana
        .iter()
        .map(|t| (t.color as u8, t.source as u8))
        .collect();
    tokens.sort_unstable();
    tokens.hash(&mut h);

    // Source dice state
    for die in &state.source.dice {
        die.is_depleted.hash(&mut h);
        die.taken_by_player_id.is_some().hash(&mut h);
    }

    // Combat state
    if let Some(ref c) = state.combat {
        std::mem::discriminant(&c.phase).hash(&mut h);
        c.attacks_this_phase.hash(&mut h);
        for enemy in &c.enemies {
            enemy.is_blocked.hash(&mut h);
            enemy.is_defeated.hash(&mut h);
            enemy.damage_assigned.hash(&mut h);
            enemy.attacks_blocked.hash(&mut h);
            enemy.attacks_damage_assigned.hash(&mut h);
        }
        c.pending_block.len().hash(&mut h);
        c.pending_damage.len().hash(&mut h);
        if let Some(ref targets) = c.declared_attack_targets {
            targets.len().hash(&mut h);
        }
    }

    // Units
    for unit in &p.units {
        unit.wounded.hash(&mut h);
        unit.used_resistance_this_combat.hash(&mut h);
        unit.used_ability_indices.hash(&mut h);
    }

    // Pending choice
    p.pending.has_active().hash(&mut h);

    // Active modifiers count
    state.active_modifiers.len().hash(&mut h);

    h.finish()
}

// =============================================================================
// Upper bound pruning
// =============================================================================

/// Extract the maximum attack value from a CardEffect (recursively).
fn extract_max_attack(effect: &mk_types::effect::CardEffect) -> Option<u32> {
    use mk_types::effect::CardEffect;
    match effect {
        CardEffect::GainAttack { amount, .. } => Some(*amount),
        CardEffect::Choice { options } => options.iter().filter_map(extract_max_attack).max(),
        CardEffect::Compound { effects } => {
            let total: u32 = effects.iter().filter_map(extract_max_attack).sum();
            if total > 0 {
                Some(total)
            } else {
                None
            }
        }
        CardEffect::DiscardCost { then_effect, .. } => extract_max_attack(then_effect),
        CardEffect::Conditional { then_effect, .. } => extract_max_attack(then_effect),
        CardEffect::Scaling { base_effect, .. } => extract_max_attack(base_effect),
        _ => None,
    }
}

fn extract_max_melee_attack(effect: &mk_types::effect::CardEffect) -> Option<u32> {
    use mk_types::effect::CardEffect;
    match effect {
        CardEffect::GainAttack {
            amount,
            combat_type: CombatType::Melee,
            ..
        } => Some(*amount),
        CardEffect::Choice { options } => options.iter().filter_map(extract_max_melee_attack).max(),
        CardEffect::Compound { effects } => {
            let total: u32 = effects.iter().filter_map(extract_max_melee_attack).sum();
            (total > 0).then_some(total)
        }
        CardEffect::DiscardCost { then_effect, .. } => extract_max_melee_attack(then_effect),
        CardEffect::Conditional { then_effect, .. } => extract_max_melee_attack(then_effect),
        CardEffect::Scaling { base_effect, .. } => extract_max_melee_attack(base_effect),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct AttackElementsByType {
    melee: ElementalValues,
    ranged: ElementalValues,
    siege: ElementalValues,
}

impl AttackElementsByType {
    fn add(self, other: Self) -> Self {
        Self {
            melee: crate::combat_resolution::add_elements(&self.melee, &other.melee),
            ranged: crate::combat_resolution::add_elements(&self.ranged, &other.ranged),
            siege: crate::combat_resolution::add_elements(&self.siege, &other.siege),
        }
    }

    fn component_max(self, other: Self) -> Self {
        Self {
            melee: component_max_elements(self.melee, other.melee),
            ranged: component_max_elements(self.ranged, other.ranged),
            siege: component_max_elements(self.siege, other.siege),
        }
    }
}

fn component_max_elements(left: ElementalValues, right: ElementalValues) -> ElementalValues {
    ElementalValues {
        physical: left.physical.max(right.physical),
        fire: left.fire.max(right.fire),
        ice: left.ice.max(right.ice),
        cold_fire: left.cold_fire.max(right.cold_fire),
    }
}

fn attack_elements(amount: u32, combat_type: CombatType, element: Element) -> AttackElementsByType {
    let mut values = ElementalValues::default();
    match element {
        Element::Physical => values.physical = amount,
        Element::Fire => values.fire = amount,
        Element::Ice => values.ice = amount,
        Element::ColdFire => values.cold_fire = amount,
    }

    match combat_type {
        CombatType::Melee => AttackElementsByType {
            melee: values,
            ..AttackElementsByType::default()
        },
        CombatType::Ranged => AttackElementsByType {
            ranged: values,
            ..AttackElementsByType::default()
        },
        CombatType::Siege => AttackElementsByType {
            siege: values,
            ..AttackElementsByType::default()
        },
    }
}

/// Extract an optimistic per-element attack contribution from a card effect.
///
/// Component-wise maxima intentionally overestimate mutually exclusive choices.
/// This guard must never reject a target set merely because it chose the wrong
/// branch while estimating what the remaining hand could still contribute.
fn extract_max_attack_elements(effect: &mk_types::effect::CardEffect) -> AttackElementsByType {
    use mk_types::effect::CardEffect;
    match effect {
        CardEffect::GainAttack {
            amount,
            combat_type,
            element,
        } => attack_elements(*amount, *combat_type, *element),
        CardEffect::Choice { options } => options
            .iter()
            .fold(AttackElementsByType::default(), |maximum, option| {
                maximum.component_max(extract_max_attack_elements(option))
            }),
        CardEffect::Compound { effects } => effects
            .iter()
            .fold(AttackElementsByType::default(), |total, effect| {
                total.add(extract_max_attack_elements(effect))
            }),
        CardEffect::DiscardCost { then_effect, .. }
        | CardEffect::Conditional { then_effect, .. } => extract_max_attack_elements(then_effect),
        CardEffect::Scaling { base_effect, .. } => extract_max_attack_elements(base_effect),
        _ => AttackElementsByType::default(),
    }
}

fn can_afford_card_powered(state: &GameState, powered_by: mk_data::cards::PoweredBy) -> bool {
    match powered_by {
        mk_data::cards::PoweredBy::None => false,
        mk_data::cards::PoweredBy::Single(color) => {
            crate::legal_actions::cards::can_afford_powered(state, 0, color)
        }
        mk_data::cards::PoweredBy::AnyBasic => mk_types::enums::ALL_BASIC_MANA_COLORS
            .iter()
            .any(|&color| crate::legal_actions::cards::can_afford_powered(state, 0, color)),
        mk_data::cards::PoweredBy::Free => true,
    }
}

fn max_future_attack_elements(state: &GameState) -> AttackElementsByType {
    state.players[0]
        .hand
        .iter()
        .filter(|card_id| card_id.as_str() != crate::effect_queue::WOUND_CARD_ID)
        .filter_map(|card_id| mk_data::cards::get_card(card_id.as_str()))
        .fold(AttackElementsByType::default(), |total, definition| {
            let mut card_max = extract_max_attack_elements(&definition.basic_effect);
            if can_afford_card_powered(state, definition.powered_by) {
                card_max =
                    card_max.component_max(extract_max_attack_elements(&definition.powered_effect));
            }
            card_max.melee.physical = card_max.melee.physical.max(definition.sideways_value);
            total.add(card_max)
        })
}

fn extract_max_block(effect: &mk_types::effect::CardEffect) -> Option<u32> {
    use mk_types::effect::CardEffect;
    match effect {
        CardEffect::GainBlock { amount, .. } | CardEffect::GainBlockElement { amount, .. } => {
            Some(*amount)
        }
        CardEffect::Choice { options } => options.iter().filter_map(extract_max_block).max(),
        CardEffect::Compound { effects } => {
            let total: u32 = effects.iter().filter_map(extract_max_block).sum();
            (total > 0).then_some(total)
        }
        CardEffect::DiscardCost { then_effect, .. } => extract_max_block(then_effect),
        CardEffect::Conditional { then_effect, .. } => extract_max_block(then_effect),
        CardEffect::Scaling { base_effect, .. } => extract_max_block(base_effect),
        _ => None,
    }
}

fn max_future_melee_attack(state: &GameState) -> u32 {
    let player = &state.players[0];
    let accumulator = &player.combat_accumulator;
    let current = crate::combat_resolution::subtract_elements(
        &accumulator.attack.normal_elements,
        &accumulator.assigned_attack.normal_elements,
    )
    .total();
    let from_hand = player
        .hand
        .iter()
        .filter(|card_id| card_id.as_str() != crate::effect_queue::WOUND_CARD_ID)
        .filter_map(|card_id| mk_data::cards::get_card(card_id.as_str()))
        .map(|definition| {
            let powered_attack = match definition.powered_by {
                mk_data::cards::PoweredBy::None => 0,
                mk_data::cards::PoweredBy::Single(color) => {
                    if crate::legal_actions::cards::can_afford_powered(state, 0, color) {
                        extract_max_melee_attack(&definition.powered_effect).unwrap_or(0)
                    } else {
                        0
                    }
                }
                mk_data::cards::PoweredBy::AnyBasic => {
                    if mk_types::enums::ALL_BASIC_MANA_COLORS.iter().any(|&color| {
                        crate::legal_actions::cards::can_afford_powered(state, 0, color)
                    }) {
                        extract_max_melee_attack(&definition.powered_effect).unwrap_or(0)
                    } else {
                        0
                    }
                }
                mk_data::cards::PoweredBy::Free => {
                    extract_max_melee_attack(&definition.powered_effect).unwrap_or(0)
                }
            };
            extract_max_melee_attack(&definition.basic_effect)
                .unwrap_or(0)
                .max(powered_attack)
                .max(definition.sideways_value)
        })
        .sum::<u32>();
    current + from_hand
}

fn max_remaining_attack(state: &GameState) -> u32 {
    let player = &state.players[0];
    let acc = &player.combat_accumulator.attack;
    let current_attack = acc.normal
        + acc.ranged
        + acc.siege
        + acc.normal_elements.total()
        + acc.ranged_elements.total()
        + acc.siege_elements.total();

    let mut max_from_hand = 0u32;
    for card_id in &player.hand {
        let card_str = card_id.as_str();
        if card_str == "wound" {
            continue;
        }
        if let Some(def) = mk_data::cards::get_card(card_str) {
            let basic_atk = extract_max_attack(&def.basic_effect).unwrap_or(0);
            let powered_atk = extract_max_attack(&def.powered_effect).unwrap_or(0);
            let sideways = def.sideways_value;
            max_from_hand += basic_atk.max(powered_atk).max(sideways);
        }
    }

    // Include per-enemy attack bonuses (optimistic: assume all can be used)
    let per_enemy_total = state
        .combat
        .as_ref()
        .map(|c| {
            c.per_enemy_attack
                .values()
                .map(|a| {
                    a.normal_elements.total() + a.ranged_elements.total() + a.siege_elements.total()
                })
                .sum::<u32>()
        })
        .unwrap_or(0);

    current_attack + max_from_hand + per_enemy_total
}

fn upper_bound(
    state: &GameState,
    pre: &PreCombatSnapshot,
    _total_possible_fame: u32,
    w: &CombatEvalWeights,
) -> f64 {
    let player = &state.players[0];
    let wounds_so_far =
        player.wounds_received_this_turn.hand + player.wounds_received_this_turn.discard;
    let cards_remaining = player.hand.len();
    let crystals_now =
        player.crystals.red + player.crystals.blue + player.crystals.green + player.crystals.white;
    let crystals_spent = (pre.crystals_total as i32 - crystals_now as i32).max(0);
    let units_wounded_now = player.units.iter().filter(|u| u.wounded).count();
    let units_newly_wounded = (units_wounded_now as i32 - pre.units_wounded as i32).max(0);

    let max_attack = max_remaining_attack(state);

    let max_fame = if let Some(ref combat) = state.combat {
        let remaining: Vec<(u32, u32)> = combat
            .enemies
            .iter()
            .filter(|e| !e.is_defeated)
            .map(|e| {
                let def = mk_data::enemies::get_enemy(e.enemy_id.as_str()).unwrap();
                (def.armor, def.fame)
            })
            .collect();

        let fame_gained_so_far = player.fame.saturating_sub(pre.fame);

        // Try all subsets of remaining enemies (max 2^N, N ≤ ~8)
        let n = remaining.len();
        let mut best_remaining_fame = 0u32;
        for mask in 0..(1u32 << n) {
            let mut total_armor = 0u32;
            let mut total_fame = 0u32;
            for (i, &(armor, fame)) in remaining.iter().enumerate() {
                if mask & (1 << i) != 0 {
                    total_armor += armor;
                    total_fame += fame;
                }
            }
            if max_attack >= total_armor && total_fame > best_remaining_fame {
                best_remaining_fame = total_fame;
            }
        }

        fame_gained_so_far + best_remaining_fame
    } else {
        0
    };

    max_fame as f64 * w.fame - wounds_so_far as f64 * w.wound
        + cards_remaining as f64 * w.cards_remaining
        - crystals_spent as f64 * w.crystal_spent
        - units_newly_wounded as f64 * w.unit_wounded
}

// =============================================================================
// Action ordering
// =============================================================================

fn action_priority(action: &LegalAction) -> u32 {
    match action {
        LegalAction::PlayCardPowered { .. } => 0,
        LegalAction::PlayCardBasic { .. } => 1,
        LegalAction::PlayCardSideways { .. } => 2,
        LegalAction::ActivateUnit { .. } => 3,
        LegalAction::DeclareBlock { .. } => 4,
        LegalAction::ResolveAttack => 5,
        LegalAction::ResolveChoice { .. } => 6,
        LegalAction::SubsetSelect { .. } => 7,
        LegalAction::SubsetConfirm => 8,
        LegalAction::AssignDamageToUnit { .. } => 9,
        LegalAction::AssignDamageToHero { .. } => 10,
        LegalAction::EndCombatPhase => 20,
        LegalAction::Undo => 30,
        _ => 15,
    }
}

// =============================================================================
// Greedy seeding (heuristic rollouts)
// =============================================================================

fn action_weight(action: &LegalAction) -> u32 {
    match action {
        LegalAction::PlayCardBasic { .. } => 10,
        LegalAction::PlayCardPowered { .. } => 12,
        LegalAction::PlayCardSideways { .. } => 8,
        LegalAction::DeclareBlock { .. } => 15,
        LegalAction::ResolveAttack => 15,
        LegalAction::SubsetSelect { .. } => 10,
        LegalAction::SubsetConfirm => 10,
        LegalAction::ResolveChoice { .. } => 10,
        LegalAction::ActivateUnit { .. } => 8,
        LegalAction::AssignDamageToHero { .. } => 3,
        LegalAction::AssignDamageToUnit { .. } => 5,
        LegalAction::EndCombatPhase => 2,
        LegalAction::EndTurn => 1,
        _ => 5,
    }
}

fn heuristic_pick<'a>(actions: &'a LegalActionSet, rng: &mut u32) -> &'a LegalAction {
    let weights: Vec<u32> = actions.actions.iter().map(action_weight).collect();
    let total: u32 = weights.iter().sum();

    *rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
    let roll = (*rng >> 8) % total;

    let mut cumulative = 0;
    for (i, &w) in weights.iter().enumerate() {
        cumulative += w;
        if roll < cumulative {
            return &actions.actions[i];
        }
    }

    actions.actions.last().unwrap()
}

fn rollout(
    state: &GameState,
    actions: &LegalActionSet,
    pre: &PreCombatSnapshot,
    rng: &mut u32,
    weights: &CombatEvalWeights,
) -> (CombatScore, Vec<LegalAction>) {
    let mut current_state = state.clone();
    let mut current_actions = actions.clone();
    let mut path = Vec::new();

    loop {
        if is_combat_terminal(&current_state, current_actions.actions.len()) {
            break;
        }
        let action = heuristic_pick(&current_actions, rng);
        path.push(action.clone());
        if let Some((next_state, next_actions)) = step(&current_state, action) {
            current_state = next_state;
            current_actions = next_actions;
        } else {
            break;
        }
    }

    (CombatScore::evaluate(pre, &current_state, weights), path)
}

fn greedy_seed(
    state: &GameState,
    actions: &LegalActionSet,
    pre: &PreCombatSnapshot,
    num_rollouts: u32,
    weights: &CombatEvalWeights,
) -> Option<(CombatScore, Vec<LegalAction>)> {
    let mut best: Option<(CombatScore, Vec<LegalAction>)> = None;
    let mut rng = 12345u32;

    for _ in 0..num_rollouts {
        let (score, path) = rollout(state, actions, pre, &mut rng, weights);
        if best.as_ref().is_none_or(|(b, _)| score.total > b.total) {
            best = Some((score, path));
        }
    }
    best
}

// =============================================================================
// DFS
// =============================================================================

struct DfsStats {
    nodes_visited: u64,
    nodes_pruned: u64,
    transpositions: u64,
    best_score: Option<CombatScore>,
    best_path: Vec<LegalAction>,
    total_possible_fame: u32,
    seen: HashSet<u64>,
}

impl DfsStats {
    fn new(total_possible_fame: u32) -> Self {
        Self {
            nodes_visited: 0,
            nodes_pruned: 0,
            transpositions: 0,
            best_score: None,
            best_path: Vec::new(),
            total_possible_fame,
            seen: HashSet::new(),
        }
    }
}

fn dfs(
    state: &GameState,
    action_set: &LegalActionSet,
    stats: &mut DfsStats,
    node_limit: u64,
    pre: &PreCombatSnapshot,
    path: &mut Vec<LegalAction>,
    weights: &CombatEvalWeights,
) {
    if stats.nodes_visited >= node_limit {
        return;
    }
    stats.nodes_visited += 1;

    let num_actions = action_set.actions.len();

    if is_combat_terminal(state, num_actions) {
        let score = CombatScore::evaluate(pre, state, weights);
        let is_best = stats
            .best_score
            .map(|b| score.total > b.total)
            .unwrap_or(true);
        if is_best {
            stats.best_score = Some(score);
            stats.best_path = path.clone();
        }
        return;
    }

    // Upper-bound pruning.
    if let Some(ref best) = stats.best_score {
        let ub = upper_bound(state, pre, stats.total_possible_fame, weights);
        if ub <= best.total {
            stats.nodes_pruned += 1;
            return;
        }
    }

    // Transposition check.
    let state_hash = combat_state_hash(state);
    if !stats.seen.insert(state_hash) {
        stats.transpositions += 1;
        return;
    }

    // Sort actions: card plays first, EndCombatPhase last.
    let mut sorted_actions: Vec<&LegalAction> = action_set.actions.iter().collect();
    sorted_actions.sort_by_key(|a| action_priority(a));

    for action in sorted_actions {
        if stats.nodes_visited >= node_limit {
            return;
        }
        if let Some((child_state, child_actions)) = step(state, action) {
            path.push(action.clone());
            dfs(
                &child_state,
                &child_actions,
                stats,
                node_limit,
                pre,
                path,
                weights,
            );
            path.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup::create_solo_game;
    use mk_types::enums::{Hero, RoundPhase};
    use mk_types::ids::{CardId, EnemyId, EnemyTokenId};
    use std::time::Instant;

    const TEST_DIGGERS: &str = "diggers_1";
    const TEST_FIRE_ELEMENTAL: &str = "fire_elemental_1";
    const TEST_PROWLERS: &str = "prowlers_1";
    const TEST_DETERMINATION: &str = "determination";
    const TEST_ICE_BOLT: &str = "ice_bolt";
    const TEST_MARCH: &str = "march";
    const TEST_RAGE: &str = "rage";
    const TEST_STAMINA: &str = "stamina";
    const TEST_SWIFTNESS: &str = "swiftness";

    fn setup_combat_state(enemy_ids: &[&str], hand: Vec<&str>) -> GameState {
        let mut state = create_solo_game(42, Hero::Arythea);
        state.round_phase = RoundPhase::PlayerTurns;
        state.players[0].hand = hand.into_iter().map(CardId::from).collect();
        // Ensure deterministic mana dice (red + blue available) so tests
        // don't depend on RNG sequence from tile deck creation.
        state.source.dice = vec![
            mk_types::state::SourceDie {
                id: mk_types::ids::SourceDieId::from("die_0"),
                color: mk_types::enums::ManaColor::Red,
                is_depleted: false,
                taken_by_player_id: None,
            },
            mk_types::state::SourceDie {
                id: mk_types::ids::SourceDieId::from("die_1"),
                color: mk_types::enums::ManaColor::Blue,
                is_depleted: false,
                taken_by_player_id: None,
            },
            mk_types::state::SourceDie {
                id: mk_types::ids::SourceDieId::from("die_2"),
                color: mk_types::enums::ManaColor::Green,
                is_depleted: false,
                taken_by_player_id: None,
            },
        ];
        let tokens: Vec<EnemyTokenId> =
            enemy_ids.iter().map(|id| EnemyTokenId::from(*id)).collect();
        crate::combat::execute_enter_combat(
            &mut state,
            0,
            &tokens,
            false,
            None,
            Default::default(),
        )
        .unwrap();
        state
    }

    fn replay_combat(state: &GameState, actions: &[LegalAction]) -> GameState {
        let mut replay = state.clone();
        let mut undo = UndoStack::new();
        for action in actions {
            let epoch = replay.action_epoch;
            apply_legal_action(&mut replay, &mut undo, 0, action, epoch).unwrap();
        }
        replay
    }

    fn advance_to_block(mut state: GameState) -> GameState {
        let action = enumerate_legal_actions(&state, 0)
            .actions
            .into_iter()
            .find(|action| matches!(action, LegalAction::EndCombatPhase))
            .unwrap();
        let epoch = state.action_epoch;
        apply_legal_action(&mut state, &mut UndoStack::new(), 0, &action, epoch).unwrap();
        assert_eq!(state.combat.as_ref().unwrap().phase, CombatPhase::Block);
        state
    }

    #[test]
    fn search_finds_optimal_for_simple_combat() {
        let state = setup_combat_state(&["diggers_1"], vec!["rage", "determination", "stamina"]);

        let result = search_combat(&state, &CombatSearchConfig::default());

        assert!(result.complete, "search should complete for simple combat");
        assert_eq!(result.fame_gained, 2, "should kill diggers (fame=2)");
        assert_eq!(result.wounds_taken, 0, "should block all damage");
        assert!(result.score > 0.0);
    }

    #[test]
    fn search_handles_no_combat() {
        let mut state =
            setup_combat_state(&["diggers_1"], vec!["rage", "determination", "stamina"]);
        state.combat = None;

        let result = search_combat(&state, &CombatSearchConfig::default());

        assert!(result.complete);
        assert_eq!(result.nodes_visited, 1);
    }

    #[test]
    fn search_completes_multi_enemy() {
        let state = setup_combat_state(
            &["diggers_1", "diggers_2"],
            vec!["rage", "determination", "stamina", "march", "swiftness"],
        );

        let config = CombatSearchConfig {
            node_limit: 100_000,
            seed_rollouts: 500,
            ..CombatSearchConfig::default()
        };
        let result = search_combat(&state, &config);

        assert!(result.complete, "2x diggers with 5 cards should complete");
        assert!(
            result.fame_gained > 0,
            "should be able to kill at least one"
        );
    }

    #[test]
    fn greedy_search_resolves_combat_within_budget() {
        let state = setup_combat_state(&["diggers_1"], vec!["rage", "determination", "stamina"]);
        let config = GreedyCombatConfig {
            node_limit: 500,
            ..GreedyCombatConfig::default()
        };

        let result = search_combat_greedy(&state, &config).unwrap();
        let replay = replay_combat(&state, &result.actions);

        assert!(result.nodes_visited <= config.node_limit);
        assert!(replay.combat.is_none(), "greedy path must finish combat");
        assert!(
            result.fame_gained > 0,
            "greedy path should not trivially concede: score={}, actions={:?}",
            result.score,
            result.actions,
        );
    }

    #[test]
    fn greedy_search_rejects_unsafe_or_exhausted_budgets() {
        let state = setup_combat_state(&["diggers_1"], vec!["rage", "determination", "stamina"]);
        let unsafe_limit = GreedyCombatConfig {
            node_limit: MAX_GREEDY_COMBAT_NODE_LIMIT + 1,
            ..GreedyCombatConfig::default()
        };
        assert_eq!(
            search_combat_greedy(&state, &unsafe_limit).unwrap_err(),
            GreedyCombatError::InvalidNodeLimit {
                requested: MAX_GREEDY_COMBAT_NODE_LIMIT + 1,
                maximum: MAX_GREEDY_COMBAT_NODE_LIMIT,
            }
        );

        let exhausted = GreedyCombatConfig {
            node_limit: 1,
            ..GreedyCombatConfig::default()
        };
        assert!(matches!(
            search_combat_greedy(&state, &exhausted),
            Err(GreedyCombatError::NodeBudgetExceeded { limit: 1, .. })
        ));
    }

    #[test]
    fn greedy_search_fails_loudly_for_unknown_enemy() {
        let mut state =
            setup_combat_state(&["diggers_1"], vec!["rage", "determination", "stamina"]);
        state.combat.as_mut().unwrap().enemies[0].enemy_id = EnemyId::from("unknown_enemy");

        assert!(matches!(
            search_combat_greedy(&state, &GreedyCombatConfig::default()),
            Err(GreedyCombatError::UnknownEnemy { .. })
        ));
    }

    #[test]
    fn greedy_combines_two_actions_for_a_complete_block() {
        let state = advance_to_block(setup_combat_state(
            &["wolf_riders_1"],
            vec![
                "rage",
                "determination",
                "stamina",
                "march",
                "swiftness",
                "improvisation",
            ],
        ));

        let result = search_combat_greedy(&state, &GreedyCombatConfig::default()).unwrap();

        assert!(
            result
                .actions
                .iter()
                .any(|action| matches!(action, LegalAction::DeclareBlock { .. })),
            "greedy should combine powered Determination with a sideways block contribution: {:?}",
            result.actions,
        );
        assert_eq!(result.wounds_taken, 0);
    }

    #[test]
    fn greedy_avoids_infeasible_multi_enemy_attack_set() {
        let state = advance_to_block(setup_combat_state(
            &["diggers_1", "wolf_riders_1", "orc_skirmishers_1"],
            vec![
                "rage",
                "determination",
                "stamina",
                "march",
                "swiftness",
                "improvisation",
            ],
        ));

        let result = search_combat_greedy(&state, &GreedyCombatConfig::default()).unwrap();

        assert!(
            result.fame_gained > 0,
            "greedy should defeat a feasible subset instead of selecting every target: {:?}",
            result.actions,
        );
    }

    #[test]
    fn greedy_avoids_infeasible_ranged_target_set() {
        let mut state = setup_combat_state(
            &[TEST_DIGGERS, TEST_PROWLERS],
            vec![
                TEST_SWIFTNESS,
                TEST_RAGE,
                TEST_DETERMINATION,
                TEST_STAMINA,
                TEST_MARCH,
            ],
        );
        state.source.dice[2].color = mk_types::enums::ManaColor::White;

        let result = search_combat_greedy(&state, &GreedyCombatConfig::default()).unwrap();
        let first_resolution = result
            .actions
            .iter()
            .position(|action| matches!(action, LegalAction::ResolveAttack));
        let first_phase_end = result
            .actions
            .iter()
            .position(|action| matches!(action, LegalAction::EndCombatPhase));

        assert!(
            first_resolution.zip(first_phase_end).is_some_and(
                |(resolution_index, phase_end_index)| resolution_index < phase_end_index
            ),
            "greedy should resolve a feasible ranged subset before ending the phase: {:?}",
            result.actions,
        );
        assert_eq!(result.wounds_taken, 0);
    }

    #[test]
    fn ranged_target_guard_respects_elemental_resistance() {
        let mut state = setup_combat_state(&[TEST_FIRE_ELEMENTAL], vec![TEST_ICE_BOLT]);
        state.players[0]
            .combat_accumulator
            .attack
            .ranged_elements
            .fire = 5;
        let action = LegalAction::SubsetSelect { index: 0 };
        let (selected_state, _) = step(&state, &action).unwrap();

        assert!(
            selects_infeasible_attack_targets(&action, &selected_state),
            "Fire 5 plus a possible Ice 3 has raw attack 8, but only 5 effective attack against the Fire-resistant armor-6 target"
        );
    }

    #[test]
    fn ranged_target_guard_requires_siege_against_fortified_targets() {
        let mut state = setup_combat_state(&[TEST_DIGGERS], vec![TEST_SWIFTNESS]);
        state.players[0]
            .combat_accumulator
            .attack
            .ranged_elements
            .physical = 3;
        let action = LegalAction::SubsetSelect { index: 0 };
        let (selected_state, _) = step(&state, &action).unwrap();

        assert!(
            selects_infeasible_attack_targets(&action, &selected_state),
            "ranged attack cannot defeat a fortified target even when its raw value meets armor"
        );
    }

    /// Manual, intentionally ignored accuracy/speed smoke comparison.
    #[test]
    #[ignore = "manual greedy-vs-Oracle comparison"]
    fn greedy_vs_oracle_accuracy_speed_report() {
        let cases = [
            advance_to_block(setup_combat_state(
                &["diggers_1"],
                vec!["rage", "determination", "stamina"],
            )),
            advance_to_block(setup_combat_state(
                &["prowlers_1"],
                vec!["swiftness", "rage", "determination", "stamina"],
            )),
            advance_to_block(setup_combat_state(
                &["crystal_sprites_1"],
                vec!["swiftness", "rage", "determination", "stamina"],
            )),
            advance_to_block(setup_combat_state(
                &["diggers_1", "diggers_2"],
                vec!["rage", "determination", "stamina", "march", "swiftness"],
            )),
        ];
        let oracle_config = CombatSearchConfig {
            node_limit: 1_000_000,
            seed_rollouts: 500,
            ..CombatSearchConfig::default()
        };
        let greedy_config = GreedyCombatConfig::default();

        let oracle_start = Instant::now();
        let oracle_results: Vec<_> = cases
            .iter()
            .map(|state| search_combat(state, &oracle_config))
            .collect();
        let oracle_elapsed = oracle_start.elapsed();

        let greedy_start = Instant::now();
        let greedy_results: Vec<_> = cases
            .iter()
            .map(|state| search_combat_greedy(state, &greedy_config).unwrap())
            .collect();
        let greedy_elapsed = greedy_start.elapsed();

        let action_matches = oracle_results
            .iter()
            .zip(&greedy_results)
            .filter(|(oracle, greedy)| oracle.actions.first() == greedy.actions.first())
            .count();
        let mean_absolute_score_error = oracle_results
            .iter()
            .zip(&greedy_results)
            .map(|(oracle, greedy)| (oracle.score - greedy.score).abs())
            .sum::<f64>()
            / cases.len() as f64;
        let speed_ratio = oracle_elapsed.as_secs_f64() / greedy_elapsed.as_secs_f64();

        for (index, (oracle, greedy)) in oracle_results.iter().zip(&greedy_results).enumerate() {
            eprintln!(
                "case={index}: oracle_first={:?}, greedy_first={:?}, oracle_score={:.0}, greedy_score={:.0}, greedy_nodes={}",
                oracle.actions.first(),
                greedy.actions.first(),
                oracle.score,
                greedy.score,
                greedy.nodes_visited,
            );
        }

        eprintln!(
            "greedy-vs-oracle: action_matches={action_matches}/{}, mean_absolute_terminal_score_error={mean_absolute_score_error:.2}, oracle_elapsed={oracle_elapsed:?}, greedy_elapsed={greedy_elapsed:?}, speed_ratio={speed_ratio:.1}x",
            cases.len(),
        );
    }
}
