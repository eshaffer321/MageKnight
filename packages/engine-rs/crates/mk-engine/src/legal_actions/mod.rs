//! Unified legal action enumeration.
//!
//! `enumerate_legal_actions()` produces a deterministic `LegalActionSet` — every
//! action in the set is guaranteed executable by `apply_legal_action()`.
//!
//! The enumeration order is deterministic (stable across calls for identical state):
//! 1. SelectTactic (by tactic_id lexicographic)
//! 2. PlayCardBasic (by hand_index)
//! 3. PlayCardPowered (by hand_index)
//! 4. PlayCardSideways (by hand_index, then sideways_as discriminant)
//! 5. Move (by (target.q, target.r) lexicographic)
//! 6. Explore (by HexDirection discriminant — NE, E, SE, SW, W, NW)
//! 7. ResolveChoice (by choice_index)
//! 8. EndCombatPhase
//! 9. EndTurn
//! 10. DeclareRest
//! 11. CompleteRest
//! 12. Undo

pub(crate) mod cards;
pub mod combat;
mod cooperative;
mod explore;
mod movement;
mod pending;
mod returnable_skills;
pub(crate) mod sites;
mod skills;
mod tactics;
mod turn_options;
mod units;
mod utils;

#[cfg(test)]
mod tests;

use mk_types::enums::*;
use mk_types::legal_action::{LegalAction, LegalActionSet};
use mk_types::state::*;

use crate::undo::UndoStack;

use self::cards::{enumerate_combat_cards, enumerate_normal_cards};
use self::combat::{
    all_damage_assigned, enumerate_attack_declarations, enumerate_banner_fear,
    enumerate_block_boost, enumerate_block_declarations, enumerate_conversion_actions,
    enumerate_cumbersome_actions, enumerate_damage_assignments,
    enumerate_heroes_assault_payment, enumerate_resolve_attack,
    enumerate_thugs_damage_payment,
};
use self::explore::enumerate_explores;
use self::movement::{enumerate_challenges, enumerate_moves};
use self::pending::enumerate_pending;
use self::sites::enumerate_site_actions;
use self::tactics::enumerate_tactics;
use self::turn_options::enumerate_turn_options;
use self::returnable_skills::enumerate_returnable_skills;
use self::skills::enumerate_skill_activations;
use self::units::{enumerate_unit_actions, enumerate_unit_activations};

/// Enumerate all legal actions for the given player.
///
/// Returns a `LegalActionSet` with deterministic ordering. Every action in the
/// set is guaranteed to succeed when passed to `apply_legal_action()`.
pub fn enumerate_legal_actions(state: &GameState, player_idx: usize) -> LegalActionSet {
    enumerate_legal_actions_with_undo(state, player_idx, &UndoStack::new())
}

/// Enumerate legal actions, taking undo availability into account.
pub fn enumerate_legal_actions_with_undo(
    state: &GameState,
    player_idx: usize,
    undo: &UndoStack,
) -> LegalActionSet {
    let epoch = state.action_epoch;
    let mut actions = Vec::new();

    // Guard: player exists.
    if player_idx >= state.players.len() {
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    // Guard: game phase.
    if state.phase != GamePhase::Round || state.game_ended {
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    // Cooperative assault response — out-of-turn bypass.
    // Invited players can respond to a proposal even when it's not their turn.
    if let Some(response_actions) = cooperative::enumerate_cooperative_response(state, player_idx) {
        return LegalActionSet {
            epoch,
            player_idx,
            actions: response_actions,
        };
    }

    // Out-of-turn interactive skill returns: non-active players can return skills.
    if !is_active_player(state, player_idx) {
        if state.round_phase == RoundPhase::PlayerTurns {
            returnable_skills::enumerate_returnable_skills(state, player_idx, &mut actions);
            if !actions.is_empty() {
                return LegalActionSet {
                    epoch,
                    player_idx,
                    actions,
                };
            }
        }
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    // Tactics selection phase.
    if state.round_phase == RoundPhase::TacticsSelection {
        enumerate_tactics(state, &mut actions);
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    let player = &state.players[player_idx];

    // Pending choice blocks everything else.
    if let Some(ref active) = player.pending.active {
        enumerate_pending(active, state, player_idx, undo, &mut actions);
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    // Combat blocks normal turn.
    if let Some(ref combat) = state.combat {
        if combat.phase == CombatPhase::AssignDamage {
            // AssignDamage phase: enumerate per-attack assignment options
            enumerate_damage_assignments(state, player_idx, &mut actions);
            enumerate_thugs_damage_payment(state, player_idx, &mut actions);
            if all_damage_assigned(combat, state.players[player_idx].id.as_str(), &state.active_modifiers) {
                actions.push(LegalAction::EndCombatPhase);
            }
            if undo.can_undo() {
                actions.push(LegalAction::Undo);
            }
        } else {
            enumerate_combat_cards(state, player_idx, combat.phase, &mut actions);
            enumerate_unit_activations(state, player_idx, &mut actions);
            enumerate_skill_activations(state, player_idx, &mut actions);
            enumerate_returnable_skills(state, player_idx, &mut actions);
            // Block/Attack declarations (categories 5-6).
            enumerate_block_declarations(state, player_idx, &mut actions);
            enumerate_block_boost(state, player_idx, &mut actions);
            enumerate_banner_fear(state, player_idx, &mut actions);
            enumerate_cumbersome_actions(state, player_idx, &mut actions);
            enumerate_conversion_actions(state, player_idx, &mut actions);
            enumerate_attack_declarations(state, player_idx, &mut actions);
            enumerate_resolve_attack(state, player_idx, &mut actions);
            enumerate_heroes_assault_payment(state, player_idx, &mut actions);
            // ActivateTactic (The Right Moment can be used during combat).
            if can_activate_tactic_in_combat(state, player_idx) {
                actions.push(LegalAction::ActivateTactic);
            }
            // EndCombatPhase: always available (abandons any pending attack declaration).
            actions.push(LegalAction::EndCombatPhase);
            // Undo (category 12).
            if undo.can_undo() {
                actions.push(LegalAction::Undo);
            }
        }
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    // Must-forfeit / must-announce: hand AND deck both empty, not resting, not in combat.
    // Rulebook rules 3b/3d:
    //   - Solo: forfeit immediately (advance_turn → check_round_end auto-announces → round ends)
    //   - Multiplayer, no announcement yet: must announce end of round
    //   - Multiplayer, announced by someone else: must forfeit turn
    if player.hand.is_empty()
        && player.deck.is_empty()
        && !player.flags.contains(PlayerFlags::IS_RESTING)
        && state.combat.is_none()
    {
        if state.players.len() == 1 {
            // Solo: forfeit turn (which triggers round end via check_round_end)
            actions.push(LegalAction::ForfeitTurn);
        } else if state.end_of_round_announced_by.is_none() {
            // Multiplayer: must announce end of round
            actions.push(LegalAction::AnnounceEndOfRound);
        } else if state.end_of_round_announced_by.as_ref().is_some_and(|id| *id != player.id) {
            // Multiplayer: end already announced by someone else, must forfeit
            actions.push(LegalAction::ForfeitTurn);
        }
        if undo.can_undo() {
            actions.push(LegalAction::Undo);
        }
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    // Hand is all wounds and minimum turn requirement not yet met: the player
    // cannot play any card, so restrict to DeclareRest (slow/normal recovery)
    // and card-drawing skills that could provide a playable card.
    if utils::hand_is_all_wounds(player)
        && !player.flags.contains(PlayerFlags::IS_RESTING)
        && !player
            .flags
            .contains(PlayerFlags::PLAYED_CARD_FROM_HAND_THIS_TURN)
        && !player.flags.contains(PlayerFlags::HAS_RESTED_THIS_TURN)
        && !player.flags.contains(PlayerFlags::HAS_COMBATTED_THIS_TURN)
        && !player
            .flags
            .contains(PlayerFlags::DISCARDED_CARD_THIS_TURN)
        && state.combat.is_none()
    {
        skills::enumerate_card_drawing_skills(state, player_idx, &mut actions);
        enumerate_turn_options(state, player_idx, undo, &mut actions);
        return LegalActionSet {
            epoch,
            player_idx,
            actions,
        };
    }

    // Normal turn.
    enumerate_normal_cards(state, player_idx, &mut actions);
    enumerate_unit_activations(state, player_idx, &mut actions);
    enumerate_skill_activations(state, player_idx, &mut actions);
    enumerate_returnable_skills(state, player_idx, &mut actions);
    enumerate_moves(state, player_idx, &mut actions);
    enumerate_explores(state, player_idx, &mut actions);
    enumerate_challenges(state, player_idx, &mut actions);
    enumerate_site_actions(state, player_idx, &mut actions);
    enumerate_unit_actions(state, player_idx, &mut actions);
    cooperative::enumerate_cooperative_actions(state, player_idx, &mut actions);
    enumerate_turn_options(state, player_idx, undo, &mut actions);

    LegalActionSet {
        epoch,
        player_idx,
        actions,
    }
}

/// Check if ActivateTactic is available during combat (The Right Moment only).
fn can_activate_tactic_in_combat(state: &GameState, player_idx: usize) -> bool {
    let player = &state.players[player_idx];
    if player.flags.contains(PlayerFlags::TACTIC_FLIPPED) {
        return false;
    }
    // Only The Right Moment can be activated during combat
    player.selected_tactic.as_ref().map(|t| t.as_str()) == Some("the_right_moment")
        && state.end_of_round_announced_by.is_none()
}

fn is_active_player(state: &GameState, player_idx: usize) -> bool {
    match state.round_phase {
        RoundPhase::TacticsSelection => state
            .current_tactic_selector
            .as_ref()
            .is_some_and(|selector| *selector == state.players[player_idx].id),
        RoundPhase::PlayerTurns => {
            let current_idx = state.current_player_index as usize;
            current_idx < state.turn_order.len()
                && state.turn_order[current_idx] == state.players[player_idx].id
        }
    }
}
