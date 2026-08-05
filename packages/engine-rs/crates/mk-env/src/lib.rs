//! Vectorized environment for RL training with Rayon parallelism.
//!
//! Runs N independent game environments in parallel, batching their
//! observations for efficient neural network forward passes.

pub mod batch_output;
pub mod training_scenario;

use std::collections::BTreeMap;
use std::fmt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use rayon::prelude::*;

use mk_engine::action_pipeline::{apply_legal_action, ApplyError};
use mk_engine::combat_search::{
    combat_resolution_cache_hash, search_combat, search_combat_greedy,
    CombatSearchConfig, GreedyCombatConfig, GreedyCombatError,
    DEFAULT_GREEDY_COMBAT_NODE_LIMIT, MAX_GREEDY_COMBAT_NODE_LIMIT,
};
use mk_engine::commerce_search::{search_commerce, CommerceSearchConfig};
use mk_engine::legal_actions::enumerate_legal_actions_with_undo;
use mk_engine::scoring::{calculate_category_base_points, calculate_final_scores};
use mk_engine::undo::UndoStack;
use mk_features::EncodedStep;
use mk_types::enums::Hero;
use mk_types::legal_action::{LegalAction, LegalActionSet};
use mk_types::scoring::AchievementCategory;
use mk_types::state::{GameState, PlayerFlags};

pub use training_scenario::TrainingScenario;
use training_scenario::create_training_game;

/// Remove Undo from an action set — RL agents should not use undo.
fn filter_undo(mut action_set: LegalActionSet) -> LegalActionSet {
    action_set.actions.retain(|a| !matches!(a, LegalAction::Undo));
    action_set
}

/// Compute achievement score excluding GreatestBeating (wounds).
///
/// Wounds are already penalized via `wound_penalty` and `wound_shaping_k`,
/// so including wound-based achievement scoring would double-penalize.
fn achievement_score_no_wounds(state: &GameState) -> i32 {
    let player = &state.players[0];
    let mut total = 0;
    for cat in [
        AchievementCategory::GreatestKnowledge,
        AchievementCategory::GreatestLoot,
        AchievementCategory::GreatestLeader,
        AchievementCategory::GreatestConqueror,
        AchievementCategory::GreatestAdventurer,
    ] {
        total += calculate_category_base_points(cat, player, state);
    }
    total
}

use batch_output::BatchOutput;

/// Episode is still active after the step.
pub const TERMINATION_CAUSE_ONGOING: i32 = 0;
/// Episode reached a real game ending.
pub const TERMINATION_CAUSE_NATURAL_END: i32 = 1;
/// Episode was cut because it still had zero fame at the configured early threshold.
pub const TERMINATION_CAUSE_EARLY_ZERO_FAME: i32 = 2;
/// Episode reached the environment's hard maximum step count.
pub const TERMINATION_CAUSE_HARD_LIMIT: i32 = 3;
/// The engine returned an error or panicked while applying the action.
pub const TERMINATION_CAUSE_ENGINE_FAILURE: i32 = 4;

// =============================================================================
// Search states — isolated hypothetical futures for planning clients
// =============================================================================

/// Language-binding name for production-Oracle search stepping.
pub const SEARCH_COMBAT_MODE_FULL_ORACLE: &str = "full_oracle";
/// Language-binding name for greedy cheap-combat search stepping.
pub const SEARCH_COMBAT_MODE_CHEAP: &str = "cheap";
/// Separator used by the tunable `cheap:<node_limit>` language-binding form.
pub const SEARCH_COMBAT_MODE_PARAMETER_SEPARATOR: char = ':';
/// Default node budget used by the plain `cheap` mode.
pub const SEARCH_COMBAT_CHEAP_DEFAULT_NODE_LIMIT: u64 = DEFAULT_GREEDY_COMBAT_NODE_LIMIT;
/// Hard safety ceiling accepted by `cheap:<node_limit>`.
pub const SEARCH_COMBAT_CHEAP_MAX_NODE_LIMIT: u64 = MAX_GREEDY_COMBAT_NODE_LIMIT;

/// Controls how a hypothetical search step handles combat entered by that step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchCombatMode {
    /// Resolve combat with the same bounded DFS configuration as the real environment.
    FullOracle,
    /// Greedy resolver using the default strict node budget.
    Cheap,
    /// Greedy resolver with a caller-selected strict node budget.
    CheapWithNodeLimit(u64),
}

impl SearchCombatMode {
    fn cheap_node_limit(self) -> Option<u64> {
        match self {
            Self::FullOracle => None,
            Self::Cheap => Some(DEFAULT_GREEDY_COMBAT_NODE_LIMIT),
            Self::CheapWithNodeLimit(node_limit) => Some(node_limit),
        }
    }
}

impl std::str::FromStr for SearchCombatMode {
    type Err = SearchStateError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            SEARCH_COMBAT_MODE_FULL_ORACLE => Ok(Self::FullOracle),
            SEARCH_COMBAT_MODE_CHEAP => Ok(Self::Cheap),
            _ => {
                let prefix = format!(
                    "{SEARCH_COMBAT_MODE_CHEAP}{SEARCH_COMBAT_MODE_PARAMETER_SEPARATOR}"
                );
                let Some(raw_limit) = value.strip_prefix(&prefix) else {
                    return Err(SearchStateError::InvalidCombatMode(value.to_owned()));
                };
                let node_limit = raw_limit.parse::<u64>().map_err(|_| {
                    SearchStateError::InvalidCombatMode(value.to_owned())
                })?;
                if node_limit == 0 || node_limit > MAX_GREEDY_COMBAT_NODE_LIMIT {
                    return Err(SearchStateError::InvalidCheapCombatNodeLimit {
                        requested: node_limit,
                        maximum: MAX_GREEDY_COMBAT_NODE_LIMIT,
                    });
                }
                Ok(Self::CheapWithNodeLimit(node_limit))
            }
        }
    }
}

/// Process-unique opaque identifier for a standalone hypothetical state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SearchHandle(u64);

impl SearchHandle {
    /// Convert this opaque handle to its language-binding transport representation.
    pub fn as_u64(self) -> u64 {
        self.0
    }

    /// Reconstruct a handle received through a language binding.
    pub fn from_u64(raw: u64) -> Self {
        Self(raw)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchStateError {
    InvalidEnvironmentIndex { index: usize, num_envs: usize },
    EmptyBatch,
    UnknownHandle(SearchHandle),
    LengthMismatch { handles: usize, actions: usize },
    InvalidActionIndex {
        handle: SearchHandle,
        index: usize,
        action_count: usize,
    },
    ApplyFailed {
        handle: SearchHandle,
        message: String,
    },
    EnginePanicked {
        handle: SearchHandle,
        message: String,
    },
    CombatResolutionFailed {
        handle: SearchHandle,
        message: String,
    },
    InvalidCombatMode(String),
    InvalidCheapCombatNodeLimit { requested: u64, maximum: u64 },
}

impl fmt::Display for SearchStateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEnvironmentIndex { index, num_envs } => write!(
                f, "environment index {index} is out of range for {num_envs} environments"
            ),
            Self::EmptyBatch => write!(f, "search handle batch must not be empty"),
            Self::UnknownHandle(handle) => write!(
                f, "unknown or dropped search handle {}", handle.as_u64()
            ),
            Self::LengthMismatch { handles, actions } => write!(
                f, "handles length {handles} does not match actions length {actions}"
            ),
            Self::InvalidActionIndex { handle, index, action_count } => write!(
                f,
                "action index {index} is out of range for search handle {} with {action_count} actions",
                handle.as_u64(),
            ),
            Self::ApplyFailed { handle, message } => write!(
                f, "search step failed for handle {}: {message}", handle.as_u64()
            ),
            Self::EnginePanicked { handle, message } => write!(
                f, "search step panicked for handle {}: {message}", handle.as_u64()
            ),
            Self::CombatResolutionFailed { handle, message } => write!(
                f,
                "cheap combat resolution failed for handle {}: {message}",
                handle.as_u64()
            ),
            Self::InvalidCombatMode(mode) => write!(
                f,
                "invalid search combat mode {mode:?}; expected {SEARCH_COMBAT_MODE_FULL_ORACLE:?}, {SEARCH_COMBAT_MODE_CHEAP:?}, or {SEARCH_COMBAT_MODE_CHEAP:?}:<node_limit>",
            ),
            Self::InvalidCheapCombatNodeLimit { requested, maximum } => write!(
                f,
                "cheap combat node limit {requested} is invalid; expected 1..={maximum}"
            ),
        }
    }
}

impl std::error::Error for SearchStateError {}

#[derive(Debug)]
struct SearchState {
    state: GameState,
    action_set: LegalActionSet,
}

static NEXT_SEARCH_HANDLE: AtomicU64 = AtomicU64::new(1);

fn next_search_handle() -> SearchHandle {
    SearchHandle(NEXT_SEARCH_HANDLE.fetch_add(1, Ordering::Relaxed))
}

/// Clone a true engine state into an independently owned search state.
///
/// # Hidden-information warning
///
/// This clones the complete `GameState`, including true RNG state, deck order, token
/// piles, and other information hidden from the policy observation. A planner using
/// these roots can therefore exploit hidden future information.
///
/// TODO(search-determinization): add a caller-selected determinization/masking transform
/// here before the clone enters the search registry. Until then, search is omniscient.
fn clone_true_state_for_search(state: &GameState) -> GameState {
    state.clone()
}

/// Dump a game state + action history to `training/crashes/` for reproduction.
///
/// Writes two files:
/// - `crash_{seed}_{step}_state.json` — full game state at the point of failure
/// - `crash_{seed}_{step}_actions.json` — seed, hero, and the exact LegalAction
///   sequence applied (for replaying in a Rust test)
fn dump_crash_replay(
    state: &GameState,
    seed: u32,
    step: u64,
    action_history: &[LegalAction],
) {
    let dir = PathBuf::from("training/crashes");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[VecEnv] failed to create crash dir: {e}");
        return;
    }

    // Dump game state
    let state_path = dir.join(format!("crash_{seed}_{step}_state.json"));
    match serde_json::to_string(state) {
        Ok(json) => match std::fs::write(&state_path, &json) {
            Ok(()) => eprintln!("[VecEnv] state dumped to {}", state_path.display()),
            Err(e) => eprintln!("[VecEnv] failed to write state dump: {e}"),
        },
        Err(e) => eprintln!("[VecEnv] failed to serialize state: {e}"),
    }

    // Dump action replay (seed + action history as JSON)
    let replay_path = dir.join(format!("crash_{seed}_{step}_actions.json"));
    let replay = serde_json::json!({
        "seed": seed,
        "step": step,
        "action_count": action_history.len(),
        "actions": action_history,
    });
    match serde_json::to_string_pretty(&replay) {
        Ok(json) => match std::fs::write(&replay_path, &json) {
            Ok(()) => eprintln!("[VecEnv] action replay dumped to {}", replay_path.display()),
            Err(e) => eprintln!("[VecEnv] failed to write replay dump: {e}"),
        },
        Err(e) => eprintln!("[VecEnv] failed to serialize replay: {e}"),
    }
}

// =============================================================================
// SingleEnv — one game instance
// =============================================================================

struct SingleEnv {
    state: GameState,
    undo_stack: UndoStack,
    action_set: LegalActionSet,
    step_count: u64,
    seed: u32,
    hero: Hero,
    max_steps: u64,
    scenario: TrainingScenario,
    /// Set of hex coordinates the player has visited (for exploration bonus).
    visited_hexes: std::collections::BTreeSet<(i32, i32)>,
    /// Hex coordinates visited this turn (for backtracking penalty).
    turn_hexes: std::collections::BTreeSet<(i32, i32)>,
    /// When true, auto-resolve combat via exhaustive search oracle.
    combat_oracle: bool,
    /// When true, auto-resolve commerce interactions via search oracle.
    commerce_oracle: bool,
    /// If > 0, terminate early when fame == 0 after this many steps.
    early_term_fame_step: u64,
    /// History of actual LegalActions applied (for crash reproduction).
    action_history: Vec<LegalAction>,
}

impl SingleEnv {
    fn new(
        seed: u32,
        hero: Hero,
        max_steps: u64,
        scenario: TrainingScenario,
        combat_oracle: bool,
        commerce_oracle: bool,
        early_term_fame_step: u64,
    ) -> Self {
        let result = create_training_game(seed, hero, &scenario);
        // Seed visited_hexes and turn_hexes with starting position
        let mut visited_hexes = std::collections::BTreeSet::new();
        let mut turn_hexes = std::collections::BTreeSet::new();
        if let Some(pos) = result.state.players[0].position {
            visited_hexes.insert((pos.q, pos.r));
            turn_hexes.insert((pos.q, pos.r));
        }
        Self {
            state: result.state,
            undo_stack: result.undo_stack,
            action_set: result.action_set,
            step_count: 0,
            seed,
            hero,
            max_steps,
            scenario,
            visited_hexes,
            turn_hexes,
            combat_oracle,
            commerce_oracle,
            early_term_fame_step,
            action_history: Vec::new(),
        }
    }

    fn reset(&mut self, new_seed: u32) {
        self.seed = new_seed;
        let result = create_training_game(new_seed, self.hero, &self.scenario);
        self.state = result.state;
        self.undo_stack = result.undo_stack;
        self.action_set = result.action_set;
        self.step_count = 0;
        self.visited_hexes.clear();
        self.turn_hexes.clear();
        if let Some(pos) = self.state.players[0].position {
            self.visited_hexes.insert((pos.q, pos.r));
            self.turn_hexes.insert((pos.q, pos.r));
        }
        self.action_history.clear();
    }

    fn fame(&self) -> u32 {
        self.state.players[0].fame
    }

    fn wound_count(&self) -> i32 {
        self.state.players[0]
            .hand
            .iter()
            .filter(|c| c.as_str() == "wound")
            .count() as i32
    }

    fn non_wound_hand_size(&self) -> i32 {
        self.state.players[0]
            .hand
            .iter()
            .filter(|c| c.as_str() != "wound")
            .count() as i32
    }

    /// Total wound cards across hand + deck + discard (full deck).
    fn full_deck_wound_count(&self) -> i32 {
        let p = &self.state.players[0];
        (p.hand.iter().filter(|c| c.as_str() == "wound").count()
            + p.deck.iter().filter(|c| c.as_str() == "wound").count()
            + p.discard.iter().filter(|c| c.as_str() == "wound").count()) as i32
    }

    /// Total cards across hand + deck + discard (full deck).
    fn full_deck_card_count(&self) -> i32 {
        let p = &self.state.players[0];
        (p.hand.len() + p.deck.len() + p.discard.len()) as i32
    }

    /// Check if the player is on a hex they haven't visited before.
    /// If so, record it and return true.
    fn check_new_hex(&mut self) -> bool {
        if let Some(pos) = self.state.players[0].position {
            self.visited_hexes.insert((pos.q, pos.r))
        } else {
            false
        }
    }

    /// Check if the player backtracked (moved to a hex already visited this turn).
    /// Updates turn_hexes. On EndTurn, clears for the new turn.
    fn check_backtrack(&mut self, position_before: Option<(i32, i32)>, was_end_turn: bool) -> bool {
        if let Some(pos) = self.state.players[0].position {
            let coords = (pos.q, pos.r);
            if was_end_turn {
                self.turn_hexes.clear();
                self.turn_hexes.insert(coords);
                return false;
            }
            let moved = position_before != Some(coords);
            let backtracked = moved && self.turn_hexes.contains(&coords);
            self.turn_hexes.insert(coords);
            backtracked
        } else {
            false
        }
    }

    fn is_done(&self) -> bool {
        if self.state.game_ended || self.step_count >= self.max_steps {
            return true;
        }
        // Early termination: if fame == 0 after N steps, episode is going nowhere
        if self.early_term_fame_step > 0
            && self.step_count >= self.early_term_fame_step
            && self.state.players[0].fame == 0
        {
            return true;
        }
        false
    }

    fn termination_cause(&self, panicked: bool) -> i32 {
        if panicked {
            TERMINATION_CAUSE_ENGINE_FAILURE
        } else if self.state.game_ended {
            TERMINATION_CAUSE_NATURAL_END
        } else if self.step_count >= self.max_steps {
            TERMINATION_CAUSE_HARD_LIMIT
        } else if self.early_term_fame_step > 0
            && self.step_count >= self.early_term_fame_step
            && self.state.players[0].fame == 0
        {
            TERMINATION_CAUSE_EARLY_ZERO_FAME
        } else {
            TERMINATION_CAUSE_ONGOING
        }
    }

    /// Auto-resolve combat using the exhaustive search oracle.
    /// Replays the optimal action sequence, falling back to action[0] if needed.
    fn resolve_combat_oracle(&mut self) {
        let config = CombatSearchConfig {
            node_limit: 1_000_000,
            seed_rollouts: 500,
            ..CombatSearchConfig::default()
        };
        let result = search_combat(&self.state, &config);

        // Replay optimal actions from the search result
        for action in &result.actions {
            if self.state.combat.is_none() || self.state.game_ended {
                break;
            }
            let epoch = self.state.action_epoch;
            let _ = apply_legal_action(&mut self.state, &mut self.undo_stack, 0, action, epoch);
        }

        // Fallback: if combat didn't fully resolve, pick EndCombatPhase or EndTurn
        // to cleanly exit. Avoid picking card plays after all enemies are defeated.
        while self.state.combat.is_some() && !self.state.game_ended {
            let actions = mk_engine::legal_actions::enumerate_legal_actions_with_undo(
                &self.state,
                0,
                &self.undo_stack,
            );
            if actions.actions.is_empty() {
                break;
            }
            let epoch = actions.epoch;
            let fallback_idx = actions
                .actions
                .iter()
                .position(|a| matches!(a, LegalAction::EndCombatPhase))
                .or_else(|| {
                    actions
                        .actions
                        .iter()
                        .position(|a| matches!(a, LegalAction::EndTurn))
                })
                .unwrap_or(0);
            let action = actions.actions[fallback_idx].clone();
            let _ = apply_legal_action(&mut self.state, &mut self.undo_stack, 0, &action, epoch);
        }

        // Re-enumerate legal actions after combat resolution
        let new_actions =
            enumerate_legal_actions_with_undo(&self.state, 0, &self.undo_stack);
        self.action_set = filter_undo(new_actions);
    }

    /// Auto-resolve commerce interaction using search oracle.
    /// Replays the optimal card play + purchase sequence, falling back to EndTurn if needed.
    fn resolve_commerce_oracle(&mut self) {
        let config = CommerceSearchConfig {
            node_limit: 500_000,
            seed_rollouts: 200,
            ..CommerceSearchConfig::default()
        };
        let result = search_commerce(&self.state, &config);

        // Replay optimal actions from the search result
        for action in &result.actions {
            if !self.state.players[0]
                .flags
                .contains(PlayerFlags::IS_INTERACTING)
                || self.state.game_ended
                || self.state.combat.is_some()
            {
                break;
            }
            let epoch = self.state.action_epoch;
            let _ = apply_legal_action(&mut self.state, &mut self.undo_stack, 0, action, epoch);
        }

        // Fallback: if interaction didn't end, EndTurn to exit
        if self.state.players[0]
            .flags
            .contains(PlayerFlags::IS_INTERACTING)
            && !self.state.game_ended
        {
            let actions =
                enumerate_legal_actions_with_undo(&self.state, 0, &self.undo_stack);
            if let Some(end_turn_idx) = actions
                .actions
                .iter()
                .position(|a| matches!(a, LegalAction::EndTurn))
            {
                let action = actions.actions[end_turn_idx].clone();
                let epoch = actions.epoch;
                let _ = apply_legal_action(
                    &mut self.state,
                    &mut self.undo_stack,
                    0,
                    &action,
                    epoch,
                );
            }
        }

        // Re-enumerate legal actions after commerce resolution
        let new_actions =
            enumerate_legal_actions_with_undo(&self.state, 0, &self.undo_stack);
        self.action_set = filter_undo(new_actions);
    }

    fn action_count(&self) -> usize {
        self.action_set.actions.len()
    }

    fn encode(&self) -> EncodedStep {
        mk_features::encode_step(&self.state, 0, &self.action_set)
    }

    /// Apply an action by index. Returns (game_ended, panicked, clamped_index).
    fn step(&mut self, action_index: usize) -> (bool, bool, usize) {
        let idx = action_index.min(self.action_set.actions.len().saturating_sub(1));
        let action = self.action_set.actions[idx].clone();
        self.action_history.push(action.clone());
        let epoch = self.action_set.epoch;

        let result = catch_unwind(AssertUnwindSafe(|| {
            let apply_result =
                apply_legal_action(&mut self.state, &mut self.undo_stack, 0, &action, epoch)?;
            let new_actions =
                enumerate_legal_actions_with_undo(&self.state, 0, &self.undo_stack);
            Ok::<_, ApplyError>((apply_result, new_actions))
        }));

        match result {
            Ok(Ok((apply_result, new_actions))) => {
                self.step_count += 1;
                self.action_set = filter_undo(new_actions);

                // Auto-resolve combat with oracle if enabled
                if self.combat_oracle && self.state.combat.is_some() {
                    self.resolve_combat_oracle();
                }

                // Auto-resolve commerce with oracle if enabled
                if self.commerce_oracle
                    && self.state.players[0]
                        .flags
                        .contains(PlayerFlags::IS_INTERACTING)
                {
                    self.resolve_commerce_oracle();
                }

                // In CombatDrill, end episode when combat resolves
                let combat_drill_done =
                    matches!(self.scenario, TrainingScenario::CombatDrill { .. })
                        && self.state.combat.is_none();
                if combat_drill_done {
                    self.state.game_ended = true;
                }

                // Detect 0 legal actions (engine bug) and dump for reproduction
                if self.action_set.actions.is_empty()
                    && !apply_result.game_ended
                    && !self.state.game_ended
                    && !combat_drill_done
                {
                    dump_crash_replay(&self.state, self.seed, self.step_count, &self.action_history);
                }

                (apply_result.game_ended || self.state.game_ended || combat_drill_done, false, idx)
            }
            Ok(Err(e)) => {
                eprintln!(
                    "[VecEnv] error at seed={} step={} action={:?}: {:?}",
                    self.seed, self.step_count, action, e
                );
                dump_crash_replay(&self.state, self.seed, self.step_count, &self.action_history);
                self.state.game_ended = true;
                self.action_set = LegalActionSet {
                    actions: vec![],
                    epoch: self.action_set.epoch + 1,
                    player_idx: 0,
                };
                (true, true, idx)
            }
            Err(panic_info) => {
                let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };
                eprintln!(
                    "[VecEnv] panic at seed={} step={} action={:?}: {}",
                    self.seed, self.step_count, action, msg
                );
                dump_crash_replay(&self.state, self.seed, self.step_count, &self.action_history);
                self.state.game_ended = true;
                self.action_set = LegalActionSet {
                    actions: vec![],
                    epoch: self.action_set.epoch + 1,
                    player_idx: 0,
                };
                (true, true, idx)
            }
        }
    }
}

/// Resolve hypothetical combat with the real environment's production Oracle budget.
fn resolve_search_combat_full(state: &mut GameState, undo_stack: &mut UndoStack) {
    let config = CombatSearchConfig {
        node_limit: 1_000_000,
        seed_rollouts: 500,
        ..CombatSearchConfig::default()
    };
    let result = search_combat(state, &config);

    for action in &result.actions {
        if state.combat.is_none() || state.game_ended {
            break;
        }
        let epoch = state.action_epoch;
        let _ = apply_legal_action(state, undo_stack, 0, action, epoch);
    }

    while state.combat.is_some() && !state.game_ended {
        let actions = enumerate_legal_actions_with_undo(state, 0, undo_stack);
        if actions.actions.is_empty() {
            break;
        }
        let epoch = actions.epoch;
        let fallback_idx = actions.actions.iter()
            .position(|a| matches!(a, LegalAction::EndCombatPhase))
            .or_else(|| actions.actions.iter().position(|a| matches!(a, LegalAction::EndTurn)))
            .unwrap_or(0);
        let action = actions.actions[fallback_idx].clone();
        let _ = apply_legal_action(state, undo_stack, 0, &action, epoch);
    }
}

type CachedCheapResolution = Result<Vec<LegalAction>, GreedyCombatError>;

/// Per-`step_search_batch` cache. `OnceLock` ensures duplicate combat states
/// racing on Rayon compute one greedy path and all other workers reuse it.
#[derive(Default)]
struct CheapCombatBatchCache {
    entries: Mutex<BTreeMap<u64, Arc<OnceLock<CachedCheapResolution>>>>,
    computations: AtomicU64,
}

impl CheapCombatBatchCache {
    fn resolution_actions(
        &self,
        state: &GameState,
        node_limit: u64,
    ) -> Result<Vec<LegalAction>, GreedyCombatError> {
        let state_hash = combat_resolution_cache_hash(state)?;
        let cell = {
            let mut entries = self.entries.lock().expect("cheap combat cache mutex poisoned");
            entries
                .entry(state_hash)
                .or_insert_with(|| Arc::new(OnceLock::new()))
                .clone()
        };
        cell.get_or_init(|| {
            self.computations.fetch_add(1, Ordering::Relaxed);
            let config = GreedyCombatConfig {
                node_limit,
                ..GreedyCombatConfig::default()
            };
            search_combat_greedy(state, &config).map(|result| result.actions)
        })
        .clone()
    }
}

fn resolve_search_combat_cheap(
    handle: SearchHandle,
    state: &mut GameState,
    undo_stack: &mut UndoStack,
    node_limit: u64,
    cache: &CheapCombatBatchCache,
) -> Result<(), SearchStateError> {
    let actions = cache
        .resolution_actions(state, node_limit)
        .map_err(|error| SearchStateError::CombatResolutionFailed {
            handle,
            message: error.to_string(),
        })?;

    for action in &actions {
        let epoch = state.action_epoch;
        apply_legal_action(state, undo_stack, 0, action, epoch).map_err(|error| {
            SearchStateError::CombatResolutionFailed {
                handle,
                message: format!("cached action {action:?} failed during replay: {error:?}"),
            }
        })?;
    }
    if state.combat.is_some() && !state.game_ended {
        return Err(SearchStateError::CombatResolutionFailed {
            handle,
            message: "greedy action sequence ended before combat resolved".to_owned(),
        });
    }
    Ok(())
}

fn step_search_state(
    handle: SearchHandle,
    parent: &SearchState,
    action_index: usize,
    combat_mode: SearchCombatMode,
    cheap_cache: &CheapCombatBatchCache,
) -> Result<SearchState, SearchStateError> {
    let action_count = parent.action_set.actions.len();
    let action = parent.action_set.actions.get(action_index)
        .ok_or(SearchStateError::InvalidActionIndex {
            handle, index: action_index, action_count,
        })?
        .clone();
    let mut child_state = clone_true_state_for_search(&parent.state);
    let epoch = parent.action_set.epoch;

    let result = catch_unwind(AssertUnwindSafe(|| {
        // Match combat_search.rs branching: clone state, then use a clean undo history.
        let mut undo_stack = UndoStack::new();
        apply_legal_action(&mut child_state, &mut undo_stack, 0, &action, epoch)
            .map_err(|error| SearchStateError::ApplyFailed {
                handle, message: format!("{error:?}"),
            })?;

        if child_state.combat.is_some() {
            match combat_mode {
                SearchCombatMode::FullOracle => {
                    resolve_search_combat_full(&mut child_state, &mut undo_stack);
                }
                SearchCombatMode::Cheap | SearchCombatMode::CheapWithNodeLimit(_) => {
                    resolve_search_combat_cheap(
                        handle,
                        &mut child_state,
                        &mut undo_stack,
                        combat_mode.cheap_node_limit().unwrap(),
                        cheap_cache,
                    )?;
                }
            }
        }

        let action_set = filter_undo(enumerate_legal_actions_with_undo(
            &child_state, 0, &undo_stack,
        ));
        Ok(SearchState { state: child_state, action_set })
    }));

    match result {
        Ok(result) => result,
        Err(panic_info) => {
            let message = if let Some(value) = panic_info.downcast_ref::<&str>() {
                (*value).to_owned()
            } else if let Some(value) = panic_info.downcast_ref::<String>() {
                value.clone()
            } else {
                "unknown engine panic".to_owned()
            };
            Err(SearchStateError::EnginePanicked { handle, message })
        }
    }
}

// =============================================================================
// StepResult — per-env results from step_batch
// =============================================================================

/// Results from a vectorized step.
pub struct StepResult {
    /// (N,) — per-env reward (fame delta + shaping done in Python)
    pub fame_deltas: Vec<i32>,
    /// (N,) — whether each env's episode is done
    pub dones: Vec<bool>,
    /// (N,) — current fame after stepping
    pub fames: Vec<i32>,
    /// (N,) — whether each env panicked (subset of dones)
    pub panicked: Vec<bool>,
    /// (N,) — whether an episode ended through any artificial cutoff.
    pub truncated: Vec<bool>,
    /// (N,) — stable termination-cause code; zero while the episode remains active.
    pub termination_causes: Vec<i32>,
    /// Pre-reset observations for artificially truncated environments only.
    pub bootstrap_batch: Option<BatchOutput>,
    /// Original environment index for each row in `bootstrap_batch`.
    pub bootstrap_indices: Vec<i32>,
    /// (N,) — whether scenario end condition was triggered
    pub scenario_end_triggered: Vec<bool>,
    /// (N,) — number of new hexes visited this step (0 or 1)
    pub new_hexes: Vec<i32>,
    /// (N,) — change in wound count this step (positive = gained wounds)
    pub wound_deltas: Vec<i32>,
    /// (N,) — number of non-wound cards in hand (captured before auto-reset)
    pub non_wound_hand_sizes: Vec<i32>,
    /// (N,) — number of new tiles explored this step (0 or 1)
    pub new_tiles: Vec<i32>,
    /// (N,) — move points wasted on EndTurn (captured before reset zeroes them)
    pub wasted_move_points: Vec<i32>,
    /// (N,) — whether the player backtracked to a hex already visited this turn (0 or 1)
    pub backtrack_moves: Vec<i32>,
    /// (N,) — total wound cards in full deck (hand + deck + discard) after stepping
    pub wound_counts: Vec<i32>,
    /// (N,) — total cards in full deck (hand + deck + discard) after stepping
    pub total_card_counts: Vec<i32>,
    /// (N,) — whether each env is currently in combat after stepping
    pub in_combat: Vec<bool>,
    /// (N,) — whether the player ended a rest turn this step (0 or 1)
    pub rested_turns: Vec<i32>,
    /// (N,) — change in achievement score (excluding wounds) this step
    pub achievement_deltas: Vec<i32>,
    /// (N,) — official Mage Knight game score (fame + achievements); 0 for non-done envs
    pub game_scores: Vec<i32>,
    /// (N, 6) — per-category achievement base_points for done envs; all zeros for non-done.
    /// Order: [knowledge, loot, leader, conqueror, adventurer, beating]
    pub achievement_categories: Vec<[i32; 6]>,
    /// (N,) — actual action indices applied (post-clamping), for faithful replay logging
    pub applied_actions: Vec<i32>,
    // ── HRL goal detection signals ─────────────────────────────────
    /// (N, 2) — player hex position (q, r) after stepping
    pub player_positions: Vec<[i32; 2]>,
    /// (N,) — whether player is currently interacting with a site
    pub is_interacting: Vec<bool>,
    /// (N,) — number of units the player has
    pub unit_counts: Vec<i32>,
    /// (N,) — whether combat just ended (was in combat, now not)
    pub combat_just_ended: Vec<bool>,
    /// (N,) — site type ID at current position (0 = no site)
    pub site_type_ids: Vec<i32>,
}

// =============================================================================
// VecEnv — N parallel game environments
// =============================================================================

/// Configuration for creating a VecEnv.
#[derive(Clone)]
pub struct VecEnvConfig {
    pub num_envs: usize,
    pub base_seed: u32,
    pub hero: Hero,
    pub max_steps: u64,
    pub scenario: TrainingScenario,
    pub combat_oracle: bool,
    pub commerce_oracle: bool,
    pub early_term_fame_step: u64,
}

/// Vectorized environment running N games in parallel via Rayon.
pub struct VecEnv {
    envs: Vec<SingleEnv>,
    next_seed: u32,
    /// Standalone hypothetical states. These never alias or mutate `envs`.
    search_states: BTreeMap<SearchHandle, SearchState>,
}

impl VecEnv {
    /// Create N parallel environments with incrementing seeds.
    pub fn new(config: VecEnvConfig) -> Self {
        let envs: Vec<SingleEnv> = (0..config.num_envs)
            .into_par_iter()
            .map(|i| {
                SingleEnv::new(
                    config.base_seed + i as u32,
                    config.hero,
                    config.max_steps,
                    config.scenario.clone(),
                    config.combat_oracle,
                    config.commerce_oracle,
                    config.early_term_fame_step,
                )
            })
            .collect();

        Self {
            envs,
            next_seed: config.base_seed + config.num_envs as u32,
            search_states: BTreeMap::new(),
        }
    }

    pub fn num_envs(&self) -> usize {
        self.envs.len()
    }

    /// Get the current seed for each environment.
    pub fn seeds(&self) -> Vec<u32> {
        self.envs.iter().map(|e| e.seed).collect()
    }

    /// Fork independently owned hypothetical roots from current real environments.
    ///
    /// Repeated indices produce distinct roots. Cloning is parallelized with Rayon.
    ///
    /// # Hidden-information warning
    ///
    /// Roots clone the true `GameState`, including real RNG and deck/token order. Search
    /// is omniscient until the TODO hook in `clone_true_state_for_search` is implemented.
    pub fn fork_roots(
        &mut self,
        env_indices: &[usize],
    ) -> Result<Vec<SearchHandle>, SearchStateError> {
        let num_envs = self.envs.len();
        let roots: Vec<Result<SearchState, SearchStateError>> = env_indices.par_iter()
            .map(|&index| {
                let env = self.envs.get(index).ok_or(
                    SearchStateError::InvalidEnvironmentIndex { index, num_envs },
                )?;
                Ok(SearchState {
                    state: clone_true_state_for_search(&env.state),
                    action_set: env.action_set.clone(),
                })
            })
            .collect();
        let roots: Vec<SearchState> = roots.into_iter().collect::<Result<_, _>>()?;

        let mut handles = Vec::with_capacity(roots.len());
        for root in roots {
            let handle = next_search_handle();
            self.search_states.insert(handle, root);
            handles.push(handle);
        }
        Ok(handles)
    }

    /// Step hypothetical parents in parallel and register independently owned children.
    ///
    /// Parents remain valid and unchanged, so repeated handles can create sibling branches.
    /// Every child gets a cloned `GameState` and a fresh `UndoStack`.
    pub fn step_search_batch(
        &mut self,
        handles: &[SearchHandle],
        action_indices: &[usize],
        combat_mode: SearchCombatMode,
    ) -> Result<Vec<SearchHandle>, SearchStateError> {
        if handles.len() != action_indices.len() {
            return Err(SearchStateError::LengthMismatch {
                handles: handles.len(), actions: action_indices.len(),
            });
        }

        let search_states = &self.search_states;
        let cheap_cache = CheapCombatBatchCache::default();
        let children: Vec<Result<SearchState, SearchStateError>> = handles.par_iter()
            .zip(action_indices.par_iter())
            .map(|(&handle, &action_index)| {
                let parent = search_states.get(&handle)
                    .ok_or(SearchStateError::UnknownHandle(handle))?;
                step_search_state(
                    handle,
                    parent,
                    action_index,
                    combat_mode,
                    &cheap_cache,
                )
            })
            .collect();
        let children: Vec<SearchState> = children.into_iter().collect::<Result<_, _>>()?;

        let mut child_handles = Vec::with_capacity(children.len());
        for child in children {
            let handle = next_search_handle();
            self.search_states.insert(handle, child);
            child_handles.push(handle);
        }
        Ok(child_handles)
    }

    /// Encode hypothetical states in handle order with normal feature/padding semantics.
    pub fn encode_search_batch(
        &self,
        handles: &[SearchHandle],
    ) -> Result<BatchOutput, SearchStateError> {
        if handles.is_empty() {
            return Err(SearchStateError::EmptyBatch);
        }
        let encoded: Vec<Result<(EncodedStep, i32), SearchStateError>> = handles.par_iter()
            .map(|&handle| {
                let search_state = self.search_states.get(&handle)
                    .ok_or(SearchStateError::UnknownHandle(handle))?;
                let step = mk_features::encode_step(
                    &search_state.state, 0, &search_state.action_set,
                );
                Ok((step, search_state.state.players[0].fame as i32))
            })
            .collect();
        let encoded: Vec<(EncodedStep, i32)> = encoded.into_iter().collect::<Result<_, _>>()?;
        let steps: Vec<EncodedStep> = encoded.iter().map(|(step, _)| step.clone()).collect();
        let fames: Vec<i32> = encoded.iter().map(|(_, fame)| *fame).collect();
        Ok(BatchOutput::pack(&steps, &fames))
    }

    /// Release hypothetical states. Unknown/already-dropped handles are ignored.
    pub fn drop_search_states(&mut self, handles: &[SearchHandle]) -> usize {
        handles.iter()
            .filter(|handle| self.search_states.remove(handle).is_some())
            .count()
    }

    /// Number of hypothetical states currently retained by this environment.
    pub fn search_state_count(&self) -> usize {
        self.search_states.len()
    }

    /// Encode all environments in parallel, returning padded batch output.
    pub fn encode_batch(&self) -> BatchOutput {
        let encoded: Vec<(EncodedStep, i32)> = self
            .envs
            .par_iter()
            .map(|env| (env.encode(), env.fame() as i32))
            .collect();

        let steps: Vec<EncodedStep> = encoded.iter().map(|(s, _)| s.clone()).collect();
        let fames: Vec<i32> = encoded.iter().map(|(_, f)| *f).collect();

        BatchOutput::pack(&steps, &fames)
    }

    /// Step all environments in parallel with the given action indices.
    ///
    /// Auto-resets finished environments with incrementing seeds.
    pub fn step_batch(&mut self, actions: &[i32]) -> StepResult {
        let n = self.envs.len();
        assert_eq!(actions.len(), n, "actions length must match num_envs");

        // Capture fames, wounds, hex counts, positions, move points, combat, and achievements before stepping
        let in_combat_before: Vec<bool> = self.envs.iter().map(|e| e.state.combat.is_some()).collect();
        let fames_before: Vec<i32> = self.envs.iter().map(|e| e.fame() as i32).collect();
        let wounds_before: Vec<i32> = self.envs.iter().map(|e| e.wound_count()).collect();
        let achievements_before: Vec<i32> = self.envs.iter().map(|e| achievement_score_no_wounds(&e.state)).collect();
        let hexes_before: Vec<usize> = self.envs.iter().map(|e| e.state.map.hexes.len()).collect();
        let move_points_before: Vec<i32> = self.envs.iter().map(|e| e.state.players[0].move_points as i32).collect();
        let positions_before: Vec<Option<(i32, i32)>> = self.envs.iter()
            .map(|e| e.state.players[0].position.map(|p| (p.q, p.r)))
            .collect();
        let is_end_turn: Vec<bool> = self.envs.iter().zip(actions.iter()).map(|(env, &action)| {
            if env.is_done() { return false; }
            let idx = (action as usize).min(env.action_set.actions.len().saturating_sub(1));
            matches!(env.action_set.actions.get(idx), Some(LegalAction::EndTurn))
        }).collect();
        // Capture IS_RESTING flag before step (EndTurn clears it)
        let was_resting: Vec<bool> = self.envs.iter().map(|e| {
            e.state.players[0].flags.contains(mk_types::state::PlayerFlags::IS_RESTING)
                || e.state.players[0].flags.contains(mk_types::state::PlayerFlags::HAS_RESTED_THIS_TURN)
        }).collect();

        // Step all envs in parallel
        let results: Vec<(bool, bool, usize)> = self
            .envs
            .par_iter_mut()
            .zip(actions.par_iter())
            .map(|(env, &action)| {
                if env.is_done() {
                    // Already done — don't step, will be reset below
                    (true, false, action as usize)
                } else {
                    env.step(action as usize)
                }
            })
            .collect();

        // Check for new hex visits (must be done before reset, requires &mut)
        let new_hex_flags: Vec<bool> = self
            .envs
            .iter_mut()
            .map(|env| env.check_new_hex())
            .collect();

        // Check for backtracking (moved to a hex already visited this turn)
        let backtrack_flags: Vec<bool> = self
            .envs
            .iter_mut()
            .enumerate()
            .map(|(i, env)| env.check_backtrack(positions_before[i], is_end_turn[i]))
            .collect();

        // Compute deltas and dones
        let mut fame_deltas = Vec::with_capacity(n);
        let mut dones = Vec::with_capacity(n);
        let mut fames_after = Vec::with_capacity(n);
        let mut panicked = Vec::with_capacity(n);
        let mut truncated = Vec::with_capacity(n);
        let mut termination_causes = Vec::with_capacity(n);
        let mut scenario_end_triggered = Vec::with_capacity(n);
        let mut new_hexes = Vec::with_capacity(n);
        let mut wound_deltas = Vec::with_capacity(n);
        let mut non_wound_hand_sizes = Vec::with_capacity(n);
        let mut new_tiles = Vec::with_capacity(n);
        let mut wasted_move_points = Vec::with_capacity(n);
        let mut backtrack_moves = Vec::with_capacity(n);
        let mut wound_counts = Vec::with_capacity(n);
        let mut total_card_counts = Vec::with_capacity(n);
        let mut in_combat = Vec::with_capacity(n);
        let mut rested_turns = Vec::with_capacity(n);
        let mut achievement_deltas = Vec::with_capacity(n);
        let mut applied_actions = Vec::with_capacity(n);
        let mut player_positions = Vec::with_capacity(n);
        let mut is_interacting_vec = Vec::with_capacity(n);
        let mut unit_counts = Vec::with_capacity(n);
        let mut combat_just_ended = Vec::with_capacity(n);
        let mut site_type_ids = Vec::with_capacity(n);

        for (i, (game_ended, did_panic, clamped_idx)) in results.iter().enumerate() {
            applied_actions.push(*clamped_idx as i32);
            let env = &self.envs[i];
            let done = *game_ended || env.is_done();
            let fame_now = env.fame() as i32;
            fame_deltas.push(fame_now - fames_before[i]);
            dones.push(done);
            fames_after.push(fame_now);
            panicked.push(*did_panic);
            // Truncated means any artificial cutoff (early-zero-fame or hard limit).
            truncated.push(done && !env.state.game_ended);
            termination_causes.push(if done {
                env.termination_cause(*did_panic)
            } else {
                TERMINATION_CAUSE_ONGOING
            });
            scenario_end_triggered.push(env.state.scenario_end_triggered);
            new_hexes.push(if new_hex_flags[i] { 1 } else { 0 });
            wound_deltas.push(env.wound_count() - wounds_before[i]);
            non_wound_hand_sizes.push(env.non_wound_hand_size());
            let hexes_now = env.state.map.hexes.len();
            new_tiles.push(if hexes_now > hexes_before[i] { 1 } else { 0 });
            wasted_move_points.push(if is_end_turn[i] { move_points_before[i] } else { 0 });
            backtrack_moves.push(if backtrack_flags[i] { 1 } else { 0 });
            wound_counts.push(env.full_deck_wound_count());
            total_card_counts.push(env.full_deck_card_count());
            in_combat.push(env.state.combat.is_some());
            // A rest turn is detected when EndTurn fires while IS_RESTING or HAS_RESTED_THIS_TURN was set
            rested_turns.push(if is_end_turn[i] && was_resting[i] { 1 } else { 0 });
            achievement_deltas.push(achievement_score_no_wounds(&env.state) - achievements_before[i]);

            // HRL goal detection signals
            let pos = env.state.players[0].position;
            player_positions.push(pos.map(|p| [p.q, p.r]).unwrap_or([0, 0]));
            is_interacting_vec.push(
                env.state.players[0]
                    .flags
                    .contains(PlayerFlags::IS_INTERACTING),
            );
            unit_counts.push(env.state.players[0].units.len() as i32);
            let now_in_combat = env.state.combat.is_some();
            combat_just_ended.push(in_combat_before[i] && !now_in_combat);
            let site_id = pos
                .and_then(|p| env.state.map.hexes.get(&p.key()))
                .and_then(|h| h.site.as_ref())
                .map(|s| s.site_type as i32 + 1) // +1 so 0 = no site
                .unwrap_or(0);
            site_type_ids.push(site_id);
        }

        // Compute official game scores and per-category achievements for done envs (before reset wipes state)
        let mut game_scores = vec![0i32; n];
        let mut achievement_categories = vec![[0i32; 6]; n];
        for (i, &done) in dones.iter().enumerate() {
            if done && !panicked[i] {
                let result = calculate_final_scores(&self.envs[i].state);
                if let Some(pr) = result.player_results.first() {
                    game_scores[i] = pr.total_score;
                    if let Some(ref ach) = pr.achievements {
                        for cs in &ach.category_scores {
                            let idx = match cs.category {
                                AchievementCategory::GreatestKnowledge => 0,
                                AchievementCategory::GreatestLoot => 1,
                                AchievementCategory::GreatestLeader => 2,
                                AchievementCategory::GreatestConqueror => 3,
                                AchievementCategory::GreatestAdventurer => 4,
                                AchievementCategory::GreatestBeating => 5,
                            };
                            achievement_categories[i][idx] = cs.base_points;
                        }
                    }
                }
            }
        }

        // Preserve the real post-step state for time-limit value bootstrapping before reset.
        let bootstrap_indices: Vec<usize> = termination_causes
            .iter()
            .enumerate()
            .filter_map(|(index, cause)| {
                matches!(
                    *cause,
                    TERMINATION_CAUSE_EARLY_ZERO_FAME | TERMINATION_CAUSE_HARD_LIMIT
                )
                .then_some(index)
            })
            .collect();
        let bootstrap_batch = if bootstrap_indices.is_empty() {
            None
        } else {
            let encoded: Vec<(EncodedStep, i32)> = bootstrap_indices
                .par_iter()
                .map(|&index| {
                    let env = &self.envs[index];
                    (env.encode(), env.fame() as i32)
                })
                .collect();
            let steps: Vec<EncodedStep> = encoded.iter().map(|(step, _)| step.clone()).collect();
            let fames: Vec<i32> = encoded.iter().map(|(_, fame)| *fame).collect();
            Some(BatchOutput::pack(&steps, &fames))
        };
        let bootstrap_indices = bootstrap_indices
            .into_iter()
            .map(|index| index as i32)
            .collect();

        // Auto-reset finished environments
        for (i, &done) in dones.iter().enumerate() {
            if done {
                let new_seed = self.next_seed;
                self.next_seed = self.next_seed.wrapping_add(1);
                self.envs[i].reset(new_seed);
            }
        }

        StepResult {
            fame_deltas,
            dones,
            fames: fames_after,
            panicked,
            truncated,
            termination_causes,
            bootstrap_batch,
            bootstrap_indices,
            scenario_end_triggered,
            new_hexes,
            wound_deltas,
            non_wound_hand_sizes,
            new_tiles,
            wasted_move_points,
            backtrack_moves,
            wound_counts,
            total_card_counts,
            in_combat,
            rested_turns,
            achievement_deltas,
            game_scores,
            achievement_categories,
            applied_actions,
            player_positions,
            is_interacting: is_interacting_vec,
            unit_counts,
            combat_just_ended,
            site_type_ids,
        }
    }

    /// Get current action counts for all environments.
    pub fn action_counts(&self) -> Vec<i32> {
        self.envs.iter().map(|e| e.action_count() as i32).collect()
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn test_config(num_envs: usize, base_seed: u32, max_steps: u64) -> VecEnvConfig {
        VecEnvConfig {
            num_envs,
            base_seed,
            hero: Hero::Arythea,
            max_steps,
            scenario: TrainingScenario::default(),
            combat_oracle: false,
            commerce_oracle: false,
            early_term_fame_step: 0,
        }
    }

    fn assert_encoded_batches_equal(left: &BatchOutput, right: &BatchOutput) {
        assert_eq!(left.num_envs, right.num_envs);
        assert_eq!(left.state_scalars, right.state_scalars);
        assert_eq!(left.state_ids, right.state_ids);
        assert_eq!(left.hand_card_ids, right.hand_card_ids);
        assert_eq!(left.hand_counts, right.hand_counts);
        assert_eq!(left.deck_card_ids, right.deck_card_ids);
        assert_eq!(left.deck_counts, right.deck_counts);
        assert_eq!(left.discard_card_ids, right.discard_card_ids);
        assert_eq!(left.discard_counts, right.discard_counts);
        assert_eq!(left.unit_ids, right.unit_ids);
        assert_eq!(left.unit_counts, right.unit_counts);
        assert_eq!(left.unit_scalars, right.unit_scalars);
        assert_eq!(left.combat_enemy_ids, right.combat_enemy_ids);
        assert_eq!(left.combat_enemy_counts, right.combat_enemy_counts);
        assert_eq!(left.combat_enemy_scalars, right.combat_enemy_scalars);
        assert_eq!(left.skill_ids, right.skill_ids);
        assert_eq!(left.skill_counts, right.skill_counts);
        assert_eq!(left.visible_site_ids, right.visible_site_ids);
        assert_eq!(left.visible_site_counts, right.visible_site_counts);
        assert_eq!(left.visible_site_scalars, right.visible_site_scalars);
        assert_eq!(left.map_enemy_ids, right.map_enemy_ids);
        assert_eq!(left.map_enemy_counts, right.map_enemy_counts);
        assert_eq!(left.map_enemy_scalars, right.map_enemy_scalars);
        assert_eq!(left.revealed_hex_terrain_ids, right.revealed_hex_terrain_ids);
        assert_eq!(left.revealed_hex_counts, right.revealed_hex_counts);
        assert_eq!(left.revealed_hex_scalars, right.revealed_hex_scalars);
        assert_eq!(left.action_ids, right.action_ids);
        assert_eq!(left.action_scalars, right.action_scalars);
        assert_eq!(left.action_counts, right.action_counts);
        assert_eq!(left.action_target_offsets, right.action_target_offsets);
        assert_eq!(left.action_target_ids, right.action_target_ids);
        assert_eq!(left.fames, right.fames);
    }

    #[test]
    fn search_steps_are_isolated_from_real_environment() {
        let config = test_config(1, 9_001, 500);
        let mut env = VecEnv::new(config.clone());
        let mut control = VecEnv::new(config);
        let state_before = serde_json::to_vec(&env.envs[0].state).unwrap();
        let encoding_before = env.encode_batch();
        let mut handles = env.fork_roots(&[0]).unwrap();
        assert_encoded_batches_equal(
            &encoding_before,
            &env.encode_search_batch(&handles).unwrap(),
        );

        for step in 0..8usize {
            let batch = env.encode_search_batch(&handles).unwrap();
            let count = batch.action_counts[0] as usize;
            assert!(count > 0, "search state has no actions at step {step}");
            let children = env.step_search_batch(
                &handles, &[(step * 3 + 1) % count], SearchCombatMode::Cheap,
            ).unwrap();
            assert_eq!(env.drop_search_states(&handles), 1);
            handles = children;
        }

        assert_eq!(state_before, serde_json::to_vec(&env.envs[0].state).unwrap());
        let encoding_after = env.encode_batch();
        assert_encoded_batches_equal(&encoding_before, &encoding_after);

        // Normal stepping must still match an untouched control after search branching.
        let real_action = encoding_after.action_counts[0] - 1;
        let stepped = env.step_batch(&[real_action]);
        let control_stepped = control.step_batch(&[real_action]);
        assert_eq!(stepped.dones, control_stepped.dones);
        assert_eq!(stepped.fames, control_stepped.fames);
        assert_eq!(stepped.applied_actions, control_stepped.applied_actions);
        assert_encoded_batches_equal(&env.encode_batch(), &control.encode_batch());

        assert_eq!(env.drop_search_states(&handles), 1);
        assert_eq!(env.search_state_count(), 0);
    }

    #[test]
    fn search_parent_is_immutable_and_can_create_siblings() {
        let mut env = VecEnv::new(test_config(1, 42, 500));
        let parent = env.fork_roots(&[0]).unwrap()[0];
        let parent_before = env.encode_search_batch(&[parent]).unwrap();
        let count = parent_before.action_counts[0] as usize;
        assert!(count >= 2);

        let children = env.step_search_batch(
            &[parent, parent], &[0, count - 1], SearchCombatMode::Cheap,
        ).unwrap();
        assert_ne!(children[0], children[1]);
        assert_eq!(env.search_state_count(), 3);
        assert_encoded_batches_equal(
            &parent_before, &env.encode_search_batch(&[parent]).unwrap(),
        );

        assert_eq!(env.drop_search_states(&[parent, children[0], children[1]]), 3);
        assert_eq!(env.drop_search_states(&[parent]), 0);
    }

    #[test]
    fn search_combat_modes_both_resolve_real_outcomes() {
        let scenario = TrainingScenario::CombatDrill {
            enemy_tokens: vec!["diggers_1".to_string()],
            is_fortified: false,
            hand_override: Some(vec![
                "rage".to_string(),
                "determination".to_string(),
                "stamina".to_string(),
            ]),
            extra_cards: None,
            units: None,
            skills: None,
            crystals: Some(mk_types::state::Crystals {
                red: 3,
                blue: 3,
                ..Default::default()
            }),
        };
        let mut env = VecEnv::new(VecEnvConfig {
            scenario,
            ..test_config(1, 42, 500)
        });
        let parent = env.fork_roots(&[0]).unwrap()[0];
        let action_index = env.search_states.get(&parent).unwrap().action_set.actions.iter()
            .position(|action| !matches!(action, LegalAction::EndCombatPhase))
            .unwrap();

        let cheap = env.step_search_batch(
            &[parent], &[action_index], SearchCombatMode::CheapWithNodeLimit(500),
        ).unwrap()[0];
        let cheap_state = &env.search_states.get(&cheap).unwrap().state;
        assert!(cheap_state.combat.is_none());
        assert!(cheap_state.players[0].fame > 0);

        let full = env.step_search_batch(
            &[parent], &[action_index], SearchCombatMode::FullOracle,
        ).unwrap()[0];
        assert!(env.search_states.get(&full).unwrap().state.combat.is_none());
    }

    #[test]
    fn cheap_combat_batch_cache_computes_identical_state_once() {
        let scenario = TrainingScenario::CombatDrill {
            enemy_tokens: vec!["diggers_1".to_string()],
            is_fortified: false,
            hand_override: Some(vec![
                "rage".to_string(),
                "determination".to_string(),
                "stamina".to_string(),
            ]),
            extra_cards: None,
            units: None,
            skills: None,
            crystals: None,
        };
        let mut env = VecEnv::new(VecEnvConfig {
            scenario,
            ..test_config(1, 42, 500)
        });
        let parent = env.fork_roots(&[0]).unwrap()[0];
        let state = &env.search_states.get(&parent).unwrap().state;
        let cache = CheapCombatBatchCache::default();

        let paths: Vec<Vec<LegalAction>> = (0..32)
            .into_par_iter()
            .map(|_| cache.resolution_actions(state, 500).unwrap())
            .collect();

        assert!(paths.windows(2).all(|pair| pair[0] == pair[1]));
        assert_eq!(cache.computations.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn cheap_combat_mode_parses_tunable_budget() {
        let mode: SearchCombatMode = "cheap:500".parse().unwrap();
        assert_eq!(mode, SearchCombatMode::CheapWithNodeLimit(500));
        assert!(matches!(
            "cheap:0".parse::<SearchCombatMode>(),
            Err(SearchStateError::InvalidCheapCombatNodeLimit { .. })
        ));
        assert!(matches!(
            "cheap:2001".parse::<SearchCombatMode>(),
            Err(SearchStateError::InvalidCheapCombatNodeLimit { .. })
        ));
    }

    /// Run manually with:
    /// `cargo test -p mk-env search_state_clone_step_perf_sanity -- --ignored --nocapture`
    #[test]
    #[ignore = "manual performance sanity check"]
    fn search_state_clone_step_perf_sanity() {
        const ROOTS: usize = 64;
        const STEPS: usize = 50;
        let mut env = VecEnv::new(test_config(ROOTS, 70_000, 500));
        let started = Instant::now();
        let mut handles = env.fork_roots(&(0..ROOTS).collect::<Vec<_>>()).unwrap();
        let mut all_handles = handles.clone();

        for step in 0..STEPS {
            let batch = env.encode_search_batch(&handles).unwrap();
            let actions: Vec<usize> = batch.action_counts.iter().enumerate()
                .map(|(index, &count)| {
                    assert!(count > 0, "root {index} has no actions at search step {step}");
                    (step + index) % count as usize
                })
                .collect();
            let children = env.step_search_batch(
                &handles, &actions, SearchCombatMode::Cheap,
            ).unwrap();
            all_handles.extend_from_slice(&children);
            handles = children;
        }
        let step_elapsed = started.elapsed();

        // Serialized size is a stable rough proxy, not allocator/RSS measurement.
        let serialized_bytes: usize = all_handles.iter().map(|handle| {
            let node = env.search_states.get(handle).unwrap();
            serde_json::to_vec(&node.state).unwrap().len()
                + serde_json::to_vec(&node.action_set).unwrap().len()
        }).sum();
        eprintln!(
            "search-state baseline: roots={ROOTS}, steps_per_root={STEPS}, total_steps={}, retained_states={}, step_elapsed={step_elapsed:?}, serialized_memory_proxy={} bytes ({:.2} MiB)",
            ROOTS * STEPS, all_handles.len(), serialized_bytes,
            serialized_bytes as f64 / (1024.0 * 1024.0),
        );
        assert!(serialized_bytes > 0);
        assert_eq!(env.search_state_count(), ROOTS * (STEPS + 1));
        assert_eq!(env.drop_search_states(&all_handles), ROOTS * (STEPS + 1));
        assert_eq!(env.search_state_count(), 0);
    }

    /// Reproduce: seed=15604 with 156 action indices yields 0 legal actions.
    #[test]
    fn replay_seed_15604_zero_actions() {
        let actions: Vec<usize> = vec![
            5, 7, 4, 3, 3, 4, 2, 2, 0, 0, 4, 2, 6, 7, 4, 5, 6, 7, 4, 6, 1, 4, 1, 7, 7, 4,
            0, 0, 4, 2, 2, 0, 1, 0, 0, 3, 3, 8, 7, 7, 5, 4, 6, 2, 7, 5, 0, 3, 3, 1, 2, 0,
            6, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 4, 4, 5, 2, 2, 2, 2, 0, 2, 1, 0, 0, 0, 0, 0,
            0, 2, 2, 3, 2, 1, 5, 4, 3, 3, 4, 0, 3, 3, 1, 2, 6, 4, 1, 3, 0, 1, 10, 1, 1, 3,
            0, 2, 4, 1, 3, 2, 10, 3, 1, 0, 4, 1, 1, 4, 1, 3, 0, 10, 11, 2, 3, 5, 3, 9, 7,
            4, 4, 0, 3, 3, 5, 0, 2, 4, 3, 3, 1, 2, 0, 4, 4, 1, 3, 3, 5, 2, 1, 0, 2, 1, 0, 0,
        ];

        let mut env = SingleEnv::new(15604, Hero::Arythea, 500, TrainingScenario::default(), false, false, 0);
        for (i, &action_idx) in actions.iter().enumerate() {
            assert!(
                !env.action_set.actions.is_empty(),
                "0 legal actions at step {i} (before applying action index {action_idx})"
            );
            let action = &env.action_set.actions[action_idx.min(env.action_set.actions.len() - 1)];
            let p = &env.state.players[0];
            eprintln!(
                "step {i:>3}: idx={action_idx:<3} action={action:?}  hand={} flags={:?}",
                p.hand.len(), p.flags
            );
            let (game_ended, panicked, _) = env.step(action_idx);
            assert!(!panicked, "Engine panicked at step {i}");
            if game_ended {
                return; // Game ended normally, no bug
            }
        }
        // After all actions, should still have legal actions
        if env.action_set.actions.is_empty() {
            let s = &env.state;
            let p = &s.players[0];
            eprintln!("=== 0 legal actions after step {} ===", actions.len());
            eprintln!("phase: {:?}, round_phase: {:?}", s.phase, s.round_phase);
            eprintln!("combat: {:?}", s.combat.as_ref().map(|c| &c.phase));
            eprintln!("pending active: {:?}", p.pending.active);
            eprintln!("pending deferred: {:?}", p.pending.deferred);
            eprintln!("flags: {:?}", p.flags);
            eprintln!("position: {:?}", p.position);
            eprintln!("hand: {} cards, deck: {}, discard: {}", p.hand.len(), p.deck.len(), p.discard.len());
            eprintln!("game_ended: {}, scenario_end_triggered: {}", s.game_ended, s.scenario_end_triggered);
            panic!("0 legal actions after replaying all {} actions", actions.len());
        }
    }

    /// Reproduce: seed=9424 with 120 action indices yields 0 legal actions.
    #[test]
    fn replay_seed_9424_zero_actions() {
        let actions: Vec<usize> = vec![
            2, 0, 4, 0, 3, 1, 3, 2, 6, 1, 11, 2, 1, 5, 1, 4, 0, 15, 8, 11, 1, 4, 1, 0, 0, 2,
            2, 1, 7, 4, 0, 6, 5, 1, 3, 0, 0, 5, 6, 1, 6, 2, 0, 2, 7, 0, 7, 0, 0, 9, 5, 0, 5,
            0, 10, 4, 4, 4, 2, 1, 1, 0, 4, 7, 2, 4, 2, 1, 2, 1, 2, 2, 2, 0, 0, 0, 7, 5, 1, 1,
            3, 1, 1, 4, 2, 10, 4, 5, 4, 2, 2, 1, 1, 0, 2, 7, 0, 4, 0, 0, 2, 0, 0, 1, 1, 0, 0,
            1, 2, 2, 5, 1, 5, 3, 0, 0, 0, 3, 0, 2,
        ];

        let mut env = SingleEnv::new(9424, Hero::Arythea, 500, TrainingScenario::default(), false, false, 0);
        for (i, &action_idx) in actions.iter().enumerate() {
            assert!(
                !env.action_set.actions.is_empty(),
                "0 legal actions at step {i} (before applying action index {action_idx})"
            );
            let action = &env.action_set.actions[action_idx.min(env.action_set.actions.len() - 1)];
            let p = &env.state.players[0];
            eprintln!(
                "step {i:>3}: idx={action_idx:<3} action={action:?}  hand={} flags={:?}",
                p.hand.len(), p.flags
            );
            let (game_ended, panicked, _) = env.step(action_idx);
            assert!(!panicked, "Engine panicked at step {i}");
            if game_ended {
                return;
            }
        }
        if env.action_set.actions.is_empty() {
            let s = &env.state;
            let p = &s.players[0];
            eprintln!("=== 0 legal actions after step {} ===", actions.len());
            eprintln!("phase: {:?}, round_phase: {:?}", s.phase, s.round_phase);
            eprintln!("combat: {:?}", s.combat.as_ref().map(|c| &c.phase));
            eprintln!("pending active: {:?}", p.pending.active);
            eprintln!("pending deferred: {:?}", p.pending.deferred);
            eprintln!("flags: {:?}", p.flags);
            eprintln!("position: {:?}", p.position);
            eprintln!("hand: {:?}", p.hand);
            eprintln!("play_area: {:?}", p.play_area);
            eprintln!("influence: {}, healing: {}", p.influence_points, p.healing_points);
            eprintln!("game_ended: {}, scenario_end_triggered: {}", s.game_ended, s.scenario_end_triggered);
            panic!("0 legal actions after replaying all {} actions", actions.len());
        }
    }

    /// Reproduce: seed=5473 with 135 action indices yields 0 legal actions.
    #[test]
    fn replay_seed_5473_zero_actions() {
        let actions: Vec<usize> = vec![
            2, 0, 10, 5, 2, 6, 2, 7, 1, 4, 1, 1, 4, 1, 0, 3, 0, 9, 8, 2, 1, 1, 1, 1, 0, 0,
            0, 0, 0, 2, 4, 1, 0, 9, 1, 2, 6, 0, 1, 2, 0, 2, 1, 0, 0, 1, 0, 0, 2, 1, 6, 0, 0,
            1, 2, 1, 0, 1, 0, 7, 1, 0, 0, 0, 0, 0, 2, 1, 11, 10, 9, 10, 4, 2, 3, 0, 3, 2, 0,
            0, 1, 1, 7, 3, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 2, 1, 3, 1, 1, 0, 1, 2, 1, 1, 2, 4, 0, 1, 1, 1, 1, 2, 1, 0, 0, 2, 3, 0, 1, 0,
            0, 0,
        ];

        let mut env = SingleEnv::new(5473, Hero::Arythea, 500, TrainingScenario::default(), false, false, 0);
        for (i, &action_idx) in actions.iter().enumerate() {
            assert!(
                !env.action_set.actions.is_empty(),
                "0 legal actions at step {i} (before applying action index {action_idx})"
            );
            let action = &env.action_set.actions[action_idx.min(env.action_set.actions.len() - 1)];
            let p = &env.state.players[0];
            eprintln!(
                "step {i:>3}: idx={action_idx:<3} action={action:?}  hand={} flags={:?}",
                p.hand.len(), p.flags
            );
            let (game_ended, panicked, _) = env.step(action_idx);
            assert!(!panicked, "Engine panicked at step {i}");
            if game_ended {
                return;
            }
        }
        if env.action_set.actions.is_empty() {
            let s = &env.state;
            let p = &s.players[0];
            eprintln!("=== 0 legal actions after step {} ===", actions.len());
            eprintln!("phase: {:?}, round_phase: {:?}", s.phase, s.round_phase);
            eprintln!("combat: {:?}", s.combat.as_ref().map(|c| &c.phase));
            eprintln!("pending active: {:?}", p.pending.active);
            eprintln!("pending deferred: {:?}", p.pending.deferred);
            eprintln!("flags: {:?}", p.flags);
            eprintln!("position: {:?}", p.position);
            eprintln!("hand: {:?}", p.hand);
            eprintln!("deck: {}, discard: {}", p.deck.len(), p.discard.len());
            eprintln!("play_area: {:?}", p.play_area);
            eprintln!("influence: {}, healing: {}", p.influence_points, p.healing_points);
            eprintln!("skills: {:?}", p.skills);
            eprintln!("game_ended: {}, scenario_end_triggered: {}", s.game_ended, s.scenario_end_triggered);
            panic!("0 legal actions after replaying all {} actions", actions.len());
        }
    }

    /// Regression: seed=11669 with 38 action indices previously yielded 0 legal actions
    /// (FullGame scenario, no combat oracle).
    #[test]
    fn replay_seed_11669_zero_actions() {
        let actions: Vec<usize> = vec![
            3, 5, 7, 7, 10, 3, 12, 14, 0, 1, 2, 4, 0, 0, 1, 3, 7, 0, 0, 0, 1, 2, 3, 4, 2, 3, 4,
            3, 4, 3, 4, 4, 1, 0, 0, 0, 0, 0,
        ];

        let mut env = SingleEnv::new(11669, Hero::Arythea, 500, TrainingScenario::default(), false, false, 0);
        for (i, &action_idx) in actions.iter().enumerate() {
            assert!(
                !env.action_set.actions.is_empty(),
                "0 legal actions at step {i} (before applying action index {action_idx})"
            );
            let action = &env.action_set.actions[action_idx.min(env.action_set.actions.len() - 1)];
            let p = &env.state.players[0];
            eprintln!(
                "step {i:>3}: idx={action_idx:<3} action={action:?}  hand={} flags={:?}",
                p.hand.len(), p.flags
            );
            let (game_ended, panicked, _) = env.step(action_idx);
            assert!(!panicked, "Engine panicked at step {i}");
            if game_ended {
                return;
            }
        }
        if env.action_set.actions.is_empty() {
            let s = &env.state;
            let p = &s.players[0];
            eprintln!("=== 0 legal actions after step {} ===", actions.len());
            eprintln!("phase: {:?}, round_phase: {:?}", s.phase, s.round_phase);
            eprintln!("combat: {:?}", s.combat.as_ref().map(|c| &c.phase));
            eprintln!("pending active: {:?}", p.pending.active);
            eprintln!("pending deferred: {:?}", p.pending.deferred);
            eprintln!("flags: {:?}", p.flags);
            eprintln!("position: {:?}", p.position);
            eprintln!("hand: {:?}", p.hand);
            eprintln!("deck: {}, discard: {}", p.deck.len(), p.discard.len());
            eprintln!("play_area: {:?}", p.play_area);
            eprintln!("influence: {}, healing: {}", p.influence_points, p.healing_points);
            eprintln!("skills: {:?}", p.skills);
            eprintln!("game_ended: {}, scenario_end_triggered: {}", s.game_ended, s.scenario_end_triggered);
            panic!("0 legal actions after replaying all {} actions", actions.len());
        }
    }

    /// Reproduce: seed=5305 with 114 action indices yields 0 legal actions.
    #[test]
    fn replay_seed_5305_zero_actions() {
        let actions: Vec<usize> = vec![
            0, 4, 1, 10, 3, 3, 3, 1, 6, 1, 6, 0, 5, 2, 3, 2, 0, 8, 5, 8, 2, 1, 5, 8, 6, 0,
            5, 1, 2, 2, 0, 3, 0, 0, 1, 4, 1, 7, 3, 4, 7, 3, 2, 1, 1, 3, 4, 3, 0, 0, 0, 0,
            1, 5, 4, 6, 0, 0, 4, 2, 8, 6, 6, 4, 6, 3, 2, 4, 4, 1, 3, 1, 1, 5, 3, 0, 0, 0,
            3, 4, 1, 2, 3, 0, 0, 1, 1, 3, 3, 0, 0, 3, 7, 2, 0, 6, 0, 4, 0, 2, 1, 4, 4, 5,
            1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];

        let mut env = SingleEnv::new(5305, Hero::Arythea, 500, TrainingScenario::default(), false, false, 0);
        for (i, &action_idx) in actions.iter().enumerate() {
            assert!(
                !env.action_set.actions.is_empty(),
                "0 legal actions at step {i} (before applying action index {action_idx})"
            );
            let action = &env.action_set.actions[action_idx.min(env.action_set.actions.len() - 1)];
            let p = &env.state.players[0];
            eprintln!(
                "step {i:>3}: idx={action_idx:<3} action={action:?}  hand={} flags={:?}",
                p.hand.len(), p.flags
            );
            let (game_ended, panicked, _) = env.step(action_idx);
            assert!(!panicked, "Engine panicked at step {i}");
            if game_ended {
                return;
            }
        }
        if env.action_set.actions.is_empty() {
            let s = &env.state;
            let p = &s.players[0];
            eprintln!("=== 0 legal actions after step {} ===", actions.len());
            eprintln!("phase: {:?}, round_phase: {:?}", s.phase, s.round_phase);
            eprintln!("combat: {:?}", s.combat.as_ref().map(|c| &c.phase));
            eprintln!("pending active: {:?}", p.pending.active);
            eprintln!("pending deferred: {:?}", p.pending.deferred);
            eprintln!("flags: {:?}", p.flags);
            eprintln!("position: {:?}", p.position);
            eprintln!("hand: {:?}", p.hand);
            eprintln!("deck: {}, discard: {}", p.deck.len(), p.discard.len());
            eprintln!("play_area: {:?}", p.play_area);
            eprintln!("influence: {}, healing: {}", p.influence_points, p.healing_points);
            eprintln!("skills: {:?}", p.skills);
            eprintln!("game_ended: {}, scenario_end_triggered: {}", s.game_ended, s.scenario_end_triggered);
            panic!("0 legal actions after replaying all {} actions", actions.len());
        }
    }

    #[test]
    fn vec_env_creation() {
        let env = VecEnv::new(test_config(4, 42, 100));
        assert_eq!(env.num_envs(), 4);
    }

    #[test]
    fn encode_batch_shapes() {
        let env = VecEnv::new(test_config(4, 42, 100));
        let batch = env.encode_batch();
        assert_eq!(batch.num_envs, 4);
        assert_eq!(batch.state_scalars.len(), 4 * mk_features::STATE_SCALAR_DIM);
        assert_eq!(batch.state_ids.len(), 4 * 3);
        assert_eq!(batch.action_counts.len(), 4);
        assert_eq!(batch.hand_counts.len(), 4);
        assert_eq!(batch.fames.len(), 4);

        // All action counts should be > 0 at start
        for &c in &batch.action_counts {
            assert!(c > 0, "Expected legal actions at game start");
        }
    }

    #[test]
    fn step_batch_random_actions() {
        let mut env = VecEnv::new(test_config(4, 42, 100));

        for _ in 0..10 {
            let batch = env.encode_batch();
            let actions: Vec<i32> = batch
                .action_counts
                .iter()
                .map(|_| 0)
                .collect();
            let result = env.step_batch(&actions);
            assert_eq!(result.dones.len(), 4);
            assert_eq!(result.fame_deltas.len(), 4);
            assert_eq!(result.fames.len(), 4);
        }
    }

    #[test]
    fn auto_reset_on_max_steps() {
        let mut env = VecEnv::new(test_config(1, 42, 5));

        // Step until the env is done
        let mut found_done = false;
        for _ in 0..20 {
            let _batch = env.encode_batch();
            let actions = vec![0i32; 1];
            let result = env.step_batch(&actions);
            if result.dones[0] {
                found_done = true;
                // After done, the env should auto-reset, next encode should work
                let batch2 = env.encode_batch();
                assert!(batch2.action_counts[0] > 0, "Reset env should have actions");
                break;
            }
        }
        assert!(found_done, "Expected env to reach done within 20 steps with max_steps=5");
    }

    #[test]
    fn padding_consistency() {
        let env = VecEnv::new(test_config(8, 1, 100));
        let batch = env.encode_batch();

        // action_ids should be (N * max_actions * 6)
        assert_eq!(
            batch.action_ids.len(),
            8 * batch.max_actions * 6,
            "action_ids flat size mismatch"
        );
        // action_scalars should be (N * max_actions * ACTION_SCALAR_DIM)
        assert_eq!(
            batch.action_scalars.len(),
            8 * batch.max_actions * 34,
            "action_scalars flat size mismatch"
        );
    }

    #[test]
    fn combat_drill_vec_env_runs() {
        let scenario = TrainingScenario::CombatDrill {
            enemy_tokens: vec!["diggers_1".to_string()],
            is_fortified: false,
            hand_override: None,
            extra_cards: None,
            units: None,
            skills: None,
            crystals: None,
        };
        let mut env = VecEnv::new(VecEnvConfig { scenario, ..test_config(4, 42, 50) });
        let batch = env.encode_batch();
        assert_eq!(batch.num_envs, 4);

        // All envs should start in combat with legal actions
        for &c in &batch.action_counts {
            assert!(c > 0, "Combat drill should have legal actions");
        }

        // Step a few times — should not panic
        for _ in 0..20 {
            let batch = env.encode_batch();
            let actions: Vec<i32> = batch.action_counts.iter().map(|_| 0).collect();
            let _result = env.step_batch(&actions);
        }
    }

    #[test]
    fn combat_drill_auto_resets() {
        let scenario = TrainingScenario::CombatDrill {
            enemy_tokens: vec!["diggers_1".to_string()],
            is_fortified: false,
            hand_override: None,
            extra_cards: None,
            units: None,
            skills: None,
            crystals: None,
        };
        let mut env = VecEnv::new(VecEnvConfig { scenario, ..test_config(1, 42, 10) });

        let mut found_done = false;
        for _ in 0..50 {
            let _batch = env.encode_batch();
            let actions = vec![0i32; 1];
            let result = env.step_batch(&actions);
            if result.dones[0] {
                found_done = true;
                // Should auto-reset and still work
                let batch2 = env.encode_batch();
                assert!(batch2.action_counts[0] > 0, "Reset combat drill should have actions");
                break;
            }
        }
        assert!(found_done, "Combat drill should finish within 50 steps with max_steps=10");
    }

    #[test]
    fn combat_drill_ends_when_combat_resolves() {
        // Use a high max_steps so truncation isn't the cause of ending
        let scenario = TrainingScenario::CombatDrill {
            enemy_tokens: vec!["diggers_1".to_string()],
            is_fortified: false,
            hand_override: None,
            extra_cards: None,
            units: None,
            skills: None,
            crystals: None,
        };
        let mut env = VecEnv::new(VecEnvConfig { scenario, ..test_config(1, 42, 500) });

        let mut done_step = None;
        for step in 0..200 {
            let _batch = env.encode_batch();
            let actions = vec![0i32; 1];
            let result = env.step_batch(&actions);
            if result.dones[0] {
                done_step = Some(step);
                // Should NOT be truncated — combat ended naturally
                assert!(
                    !result.truncated[0],
                    "Combat drill end should not be truncated (should be natural game end)"
                );
                break;
            }
        }
        let step = done_step.expect("Combat drill should end within 200 steps");
        // With action-0 policy, combat typically ends in 15-40 steps.
        // It should NOT run to 500 (max_steps).
        assert!(
            step < 100,
            "Combat drill ended at step {step} — expected < 100 (combat should resolve, not hit max_steps)"
        );
    }

    #[test]
    fn combat_oracle_auto_resolves() {
        // Use CombatDrill with oracle=true — combat should resolve in a single step
        let scenario = TrainingScenario::CombatDrill {
            enemy_tokens: vec!["diggers_1".to_string()],
            is_fortified: false,
            hand_override: None,
            extra_cards: None,
            units: None,
            skills: None,
            crystals: None,
        };
        let mut env = SingleEnv::new(42, Hero::Arythea, 500, scenario, true, false, 0);

        // The env starts in combat; the first step should trigger oracle resolution
        assert!(
            env.state.combat.is_some(),
            "CombatDrill should start in combat"
        );

        // Step once — oracle should auto-resolve the entire combat
        let (game_ended, panicked, _) = env.step(0);
        assert!(!panicked, "Oracle step should not panic");

        // After oracle resolution, combat should be gone
        // (game_ended is true because CombatDrill ends when combat resolves)
        assert!(game_ended, "CombatDrill + oracle should end after one step");
        assert!(
            env.state.combat.is_none(),
            "Combat should be fully resolved by oracle"
        );
    }

    #[test]
    fn early_termination_no_fame() {
        // With early_term_fame_step=10, if the agent has 0 fame after 10 steps, episode ends
        let mut env = SingleEnv::new(42, Hero::Arythea, 500, TrainingScenario::default(), false, false, 10);

        // Step 10 times (action 0 = first legal action, likely movement/end turn)
        for _ in 0..10 {
            if env.is_done() {
                break;
            }
            env.step(0);
        }

        // After 10 steps with action 0, fame should be 0 (no combat = no fame)
        // and is_done() should return true due to early termination
        assert_eq!(env.state.players[0].fame, 0, "Expected 0 fame after 10 random steps");
        assert!(env.is_done(), "Expected early termination when fame == 0 after 10 steps");
        assert!(!env.state.game_ended, "Game should not have ended naturally");
    }

    /// Reproduce: seed=42048 replay must keep legal actions available through the
    /// plunder and rampaging challenge prefix.
    /// After village plunder, the site is not burned (rulebook), so a later turn can
    /// offer `PlunderDecision` again — the golden trace includes `DeclinePlunder` for that.
    #[test]
    fn replay_seed_42048_zero_actions() {
        let actions_json = r#"[
            {"SelectTactic":{"tactic_id":"great_start"}},
            {"PlayCardPowered":{"card_id":"march","hand_index":5,"mana_color":"green"}},
            {"Move":{"cost":3,"target":{"q":1,"r":-1}}},
            {"PlayCardSideways":{"card_id":"arythea_mana_pull","hand_index":4,"sideways_as":"move"}},
            {"Move":{"cost":2,"target":{"q":1,"r":-2}}},
            {"PlayCardSideways":{"card_id":"tranquility","hand_index":3,"sideways_as":"move"}},
            {"PlayCardBasic":{"card_id":"stamina","hand_index":0}},
            {"Move":{"cost":3,"target":{"q":1,"r":-3}}},
            {"PlayCardBasic":{"card_id":"swiftness","hand_index":1}},
            {"Move":{"cost":2,"target":{"q":2,"r":-3}}},
            "EndTurn",
            "PlunderSite",
            {"ChallengeRampaging":{"hex":{"q":3,"r":-3}}},
            "EndTurn",
            "DeclinePlunder",
            {"PlayCardPowered":{"card_id":"march","hand_index":2,"mana_color":"green"}},
            {"Explore":{"target_center":{"q":4,"r":-5}}},
            {"PlayCardSideways":{"card_id":"improvisation","hand_index":0,"sideways_as":"move"}},
            {"Move":{"cost":3,"target":{"q":1,"r":-3}}},
            "EndTurn",
            {"ChooseLevelUpSkill":{"from_common_pool":false,"skill_index":0}},
            {"ChooseLevelUpAdvancedAction":{"advanced_action_id":"ambush"}},
            {"ChallengeRampaging":{"hex":{"q":1,"r":-4}}},
            {"UseSkill":{"skill_id":"arythea_dark_fire_magic"}},
            {"ResolveChoice":{"choice_index":0}},
            {"PlayCardBasic":{"card_id":"crystallize","hand_index":1}},
            {"ResolveChoice":{"choice_index":0}},
            "EndTurn",
            {"PlayCardPowered":{"card_id":"stamina","hand_index":4,"mana_color":"blue"}},
            {"ResolveChoice":{"choice_index":2}},
            {"ChallengeRampaging":{"hex":{"q":1,"r":-4}}},
            "EndTurn"
        ]"#;

        let actions: Vec<LegalAction> = serde_json::from_str(actions_json).unwrap();

        let mut env = SingleEnv::new(42048, Hero::Arythea, 500, TrainingScenario::default(), true, false, 0);
        for (i, action) in actions.iter().enumerate() {
            assert!(
                !env.action_set.actions.is_empty(),
                "0 legal actions at step {i} (before applying {action:?})"
            );
            // Find this action in the legal action set.
            let idx = env.action_set.actions.iter().position(|a| a == action)
                .unwrap_or_else(|| panic!(
                    "Action {action:?} not found in legal actions at step {i}. \
                     Available: {:?}", env.action_set.actions
                ));
            let (game_ended, panicked, _) = env.step(idx);
            assert!(!panicked, "Engine panicked at step {i}");
            if game_ended {
                return;
            }
        }
        // After all actions, should still have legal actions
        assert!(
            !env.action_set.actions.is_empty(),
            "0 legal actions after replaying all {} actions. \
             pending={:?}, flags={:?}, hand={}, position={:?}",
            actions.len(),
            env.state.players[0].pending.active,
            env.state.players[0].flags,
            env.state.players[0].hand.len(),
            env.state.players[0].position,
        );
    }

    #[test]
    fn early_termination_disabled_by_default() {
        // With early_term_fame_step=0, no early termination
        let mut env = SingleEnv::new(42, Hero::Arythea, 500, TrainingScenario::default(), false, false, 0);

        for _ in 0..15 {
            if env.is_done() {
                break;
            }
            env.step(0);
        }

        // Even with 0 fame, is_done should be false (disabled)
        if env.state.players[0].fame == 0 && !env.state.game_ended {
            assert!(!env.is_done(), "Early termination should be disabled when early_term_fame_step=0");
        }
    }

}
