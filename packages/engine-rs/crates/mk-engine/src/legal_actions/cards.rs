use mk_data::cards::{get_card, CardCategory, PoweredBy};
use mk_types::effect::CardEffect;
use mk_types::enums::*;
use mk_types::ids::CardId;
use mk_types::legal_action::LegalAction;
use mk_types::modifier::{ModifierEffect, RuleOverride};
use mk_types::state::{GameState, PlayerFlags};

use crate::card_play::{get_effective_sideways_value, is_rule_active};
use crate::combat_resolution;
use crate::effect_queue::is_resolvable;

use super::utils::WOUND_CARD_ID;

/// True if every category for this effect is Combat (i.e., the card has no non-combat utility).
fn is_combat_only(categories: &[CardCategory]) -> bool {
    !categories.is_empty() && categories.iter().all(|c| *c == CardCategory::Combat)
}

/// Check if the player has an active attack conversion modifier
/// (TransformAttacksColdFire or AddSiegeToAttacks) that makes sideways melee
/// attacks useful in RangedSiege phase.
fn has_attack_conversion_modifier(state: &GameState, player_idx: usize) -> bool {
    let player_id = &state.players[player_idx].id;
    state.active_modifiers.iter().any(|m| {
        m.created_by_player_id == *player_id
            && matches!(
                m.effect,
                ModifierEffect::TransformAttacksColdFire | ModifierEffect::AddSiegeToAttacks
            )
    })
}

pub(super) fn enumerate_normal_cards(
    state: &GameState,
    player_idx: usize,
    actions: &mut Vec<LegalAction>,
) {
    let player = &state.players[player_idx];
    let is_resting = player.flags.contains(PlayerFlags::IS_RESTING);
    let has_rested = player.flags.contains(PlayerFlags::HAS_RESTED_THIS_TURN);
    let is_interacting = (player.flags.contains(PlayerFlags::IS_INTERACTING)
        && !is_resting
        && !has_rested)
        || player.flags.contains(PlayerFlags::IS_PEACEFUL_MOMENT_HEALING);

    // Collect basic, powered, sideways separately to emit in category order.
    let mut basic_actions = Vec::new();
    let mut powered_actions = Vec::new();
    let mut sideways_actions = Vec::new();

    for (hand_index, card_id) in player.hand.iter().enumerate() {
        let card_def = match get_card(card_id.as_str()) {
            Some(def) => def,
            None => continue,
        };

        let is_wound = card_id.as_str() == WOUND_CARD_ID;

        // Wounds have no basic/powered effect — skip to sideways.
        if !is_wound {
            // Category 2: PlayCardBasic — allowed during rest (FAQ S3).
            if is_effect_playable_for_enumeration(
                state,
                player_idx,
                hand_index,
                &card_def.basic_effect,
                None,
            ) {
                let dominated = (!is_interacting && is_influence_only(&card_def.basic_effect))
                    || (is_interacting && is_move_only(&card_def.basic_effect))
                    || ((is_resting || has_rested) && is_move_only(&card_def.basic_effect))
                    || (player.flags.contains(PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN)
                        && is_move_only(&card_def.basic_effect))
                    || is_combat_only(card_def.basic_categories);
                if !dominated {
                    basic_actions.push(LegalAction::PlayCardBasic {
                        hand_index,
                        card_id: card_id.clone(),
                    });
                }
            }

            // Category 3: PlayCardPowered — allowed during rest (FAQ S3).
            // Time Bending chain prevention: cannot play Space Bending powered during a time-bent turn.
            let time_bending_blocked = player.flags.contains(PlayerFlags::IS_TIME_BENT_TURN)
                && card_id.as_str() == "space_bending";
            let powered_dominated =
                (!is_interacting && is_influence_only(&card_def.powered_effect))
                    || (is_interacting && is_move_only(&card_def.powered_effect))
                    || ((is_resting || has_rested) && is_move_only(&card_def.powered_effect))
                    || (player.flags.contains(PlayerFlags::HAS_TAKEN_ACTION_THIS_TURN)
                        && is_move_only(&card_def.powered_effect))
                    || is_combat_only(card_def.powered_categories);
            match card_def.powered_by {
            PoweredBy::Single(color) => {
                if !time_bending_blocked
                    && !powered_dominated
                    && is_effect_playable_for_enumeration(
                        state,
                        player_idx,
                        hand_index,
                        &card_def.powered_effect,
                        None,
                    )
                    && can_afford_powered(state, player_idx, color)
                {
                    powered_actions.push(LegalAction::PlayCardPowered {
                        hand_index,
                        card_id: card_id.clone(),
                        mana_color: Some(color),
                    });
                }
            }
            PoweredBy::AnyBasic => {
                if !powered_dominated
                    && is_effect_playable_for_enumeration(
                        state,
                        player_idx,
                        hand_index,
                        &card_def.powered_effect,
                        None,
                    )
                {
                    for &color in &ALL_BASIC_MANA_COLORS {
                        if can_afford_powered(state, player_idx, color) {
                            powered_actions.push(LegalAction::PlayCardPowered {
                                hand_index,
                                card_id: card_id.clone(),
                                mana_color: Some(color),
                            });
                        }
                    }
                }
            }
            PoweredBy::Free => {
                if !time_bending_blocked
                    && !powered_dominated
                    && is_effect_playable_for_enumeration(
                        state,
                        player_idx,
                        hand_index,
                        &card_def.powered_effect,
                        None,
                    )
                {
                    powered_actions.push(LegalAction::PlayCardPowered {
                        hand_index,
                        card_id: card_id.clone(),
                        mana_color: None,
                    });
                }
            }
            PoweredBy::None => {}
            }
        }

        // Category 4: PlayCardSideways.
        // While resting: NO sideways at all.
        // After rest: influence only (no move).
        // After combat: influence only (no move — moving after combat is nearly worthless).
        // Normal: both move and influence.
        // Wounds: only if WoundsPlayableSideways rule active + effective value > 0.
        if !is_resting {
            let eff_value = if is_wound {
                if is_rule_active(state, player_idx, RuleOverride::WoundsPlayableSideways) {
                    get_effective_sideways_value(
                        state,
                        player_idx,
                        true,
                        card_def.card_type,
                        card_def.powered_by.primary_color(),
                    )
                } else {
                    0
                }
            } else {
                get_effective_sideways_value(
                    state,
                    player_idx,
                    false,
                    card_def.card_type,
                    card_def.powered_by.primary_color(),
                )
            };
            if eff_value > 0 {
                if has_rested {
                    // Resting should not preserve site interaction context.
                } else if is_interacting {
                    // Interacting or healing window: influence only (no movement).
                    sideways_actions.push(LegalAction::PlayCardSideways {
                        hand_index,
                        card_id: card_id.clone(),
                        sideways_as: SidewaysAs::Influence,
                    });
                } else if player.flags.contains(PlayerFlags::HAS_COMBATTED_THIS_TURN) {
                    // After combat: skip sideways move (nearly worthless to move 1 after combat).
                } else {
                    // Not interacting: move only (no influence outside site).
                    sideways_actions.push(LegalAction::PlayCardSideways {
                        hand_index,
                        card_id: card_id.clone(),
                        sideways_as: SidewaysAs::Move,
                    });
                }
            }
        }
    }

    actions.extend(basic_actions);
    actions.extend(powered_actions);
    actions.extend(sideways_actions);
}

pub(super) fn enumerate_combat_cards(
    state: &GameState,
    player_idx: usize,
    combat_phase: CombatPhase,
    actions: &mut Vec<LegalAction>,
) {
    let player = &state.players[player_idx];

    let mut basic_actions = Vec::new();
    let mut powered_actions = Vec::new();
    let mut sideways_actions = Vec::new();

    for (hand_index, card_id) in player.hand.iter().enumerate() {
        let card_def = match get_card(card_id.as_str()) {
            Some(def) => def,
            None => continue,
        };

        let is_wound = card_id.as_str() == WOUND_CARD_ID;

        // Wounds have no basic/powered effect — skip to sideways.
        if !is_wound {
            // Healing cards cannot be played face-up in any combat phase (MK rules).
            let basic_healing = contains_healing_effect(&card_def.basic_effect);
            let powered_healing = contains_healing_effect(&card_def.powered_effect);

            // Prune cards dominated in the current combat phase.
            let basic_dominated = basic_healing
                || is_dominated_in_combat_phase(
                    state, player_idx, combat_phase, &card_def.basic_effect,
                );
            let powered_dominated = powered_healing
                || is_dominated_in_combat_phase(
                    state, player_idx, combat_phase, &card_def.powered_effect,
                );

            // Category 2: PlayCardBasic.
            if !basic_dominated
                && is_effect_playable_for_enumeration(
                    state,
                    player_idx,
                    hand_index,
                    &card_def.basic_effect,
                    Some(combat_phase),
                )
            {
                basic_actions.push(LegalAction::PlayCardBasic {
                    hand_index,
                    card_id: card_id.clone(),
                });
            }

            // Category 3: PlayCardPowered.
            // Time Bending chain prevention: cannot play Space Bending powered during a time-bent turn.
            let time_bending_blocked = player.flags.contains(PlayerFlags::IS_TIME_BENT_TURN)
                && card_id.as_str() == "space_bending";
            if !powered_dominated {
                match card_def.powered_by {
                    PoweredBy::Single(color) => {
                        if !time_bending_blocked
                            && is_effect_playable_for_enumeration(
                                state,
                                player_idx,
                                hand_index,
                                &card_def.powered_effect,
                                Some(combat_phase),
                            )
                            && can_afford_powered(state, player_idx, color)
                        {
                            powered_actions.push(LegalAction::PlayCardPowered {
                                hand_index,
                                card_id: card_id.clone(),
                                mana_color: Some(color),
                            });
                        }
                    }
                    PoweredBy::AnyBasic => {
                        if !time_bending_blocked
                            && is_effect_playable_for_enumeration(
                                state,
                                player_idx,
                                hand_index,
                                &card_def.powered_effect,
                                Some(combat_phase),
                            )
                        {
                            for &color in &ALL_BASIC_MANA_COLORS {
                                if can_afford_powered(state, player_idx, color) {
                                    powered_actions.push(LegalAction::PlayCardPowered {
                                        hand_index,
                                        card_id: card_id.clone(),
                                        mana_color: Some(color),
                                    });
                                }
                            }
                        }
                    }
                    PoweredBy::Free => {
                        if !time_bending_blocked
                            && is_effect_playable_for_enumeration(
                                state,
                                player_idx,
                                hand_index,
                                &card_def.powered_effect,
                                Some(combat_phase),
                            )
                        {
                            powered_actions.push(LegalAction::PlayCardPowered {
                                hand_index,
                                card_id: card_id.clone(),
                                mana_color: None,
                            });
                        }
                    }
                    PoweredBy::None => {}
                }
            }
        }

        // Category 4: PlayCardSideways (combat: Attack and Block).
        // Wounds: only if WoundsPlayableSideways rule active + effective value > 0.
        {
            let eff_value = if is_wound {
                if is_rule_active(state, player_idx, RuleOverride::WoundsPlayableSideways) {
                    get_effective_sideways_value(
                        state,
                        player_idx,
                        true,
                        card_def.card_type,
                        card_def.powered_by.primary_color(),
                    )
                } else {
                    0
                }
            } else {
                get_effective_sideways_value(
                    state,
                    player_idx,
                    false,
                    card_def.card_type,
                    card_def.powered_by.primary_color(),
                )
            };
            if eff_value > 0 {
                // Sideways Attack: Attack phase always, RangedSiege only when modifiers
                // convert melee → useful type (ColdFire or Siege).
                if combat_phase == CombatPhase::Attack
                    || (combat_phase == CombatPhase::RangedSiege
                        && has_attack_conversion_modifier(state, player_idx))
                {
                    sideways_actions.push(LegalAction::PlayCardSideways {
                        hand_index,
                        card_id: card_id.clone(),
                        sideways_as: SidewaysAs::Attack,
                    });
                }
                if combat_phase == CombatPhase::Block {
                    sideways_actions.push(LegalAction::PlayCardSideways {
                        hand_index,
                        card_id: card_id.clone(),
                        sideways_as: SidewaysAs::Block,
                    });
                }
            }
        }
    }

    actions.extend(basic_actions);
    actions.extend(powered_actions);
    actions.extend(sideways_actions);
}

fn is_effect_playable_for_enumeration(
    state: &GameState,
    player_idx: usize,
    source_hand_index: usize,
    effect: &CardEffect,
    combat_phase: Option<CombatPhase>,
) -> bool {
    match effect {
        CardEffect::CardBoost { .. } => {
            has_playable_card_boost_target(state, player_idx, source_hand_index, combat_phase)
        }
        _ => is_resolvable(state, player_idx, effect),
    }
}

fn has_playable_card_boost_target(
    state: &GameState,
    player_idx: usize,
    source_hand_index: usize,
    combat_phase: Option<CombatPhase>,
) -> bool {
    let player = &state.players[player_idx];

    player
        .hand
        .iter()
        .enumerate()
        .any(|(target_hand_index, target_card_id)| {
            if target_hand_index == source_hand_index {
                return false;
            }

            let target_def = match get_card(target_card_id.as_str()) {
                Some(def) => def,
                None => return false,
            };

            // CardBoost can target only action cards (not wounds/spells/artifacts).
            if !matches!(
                target_def.card_type,
                DeedCardType::BasicAction | DeedCardType::AdvancedAction
            ) {
                return false;
            }
            if target_def.card_type == DeedCardType::Wound {
                return false;
            }

            // Powered target effect itself must be resolvable in current context.
            if !is_resolvable(state, player_idx, &target_def.powered_effect) {
                return false;
            }

            // In combat, the target's powered effect must not be dominated in the current phase.
            if let Some(phase) = combat_phase {
                if is_dominated_in_combat_phase(
                    state,
                    player_idx,
                    phase,
                    &target_def.powered_effect,
                ) {
                    return false;
                }
            }

            // For discard-cost targets, both source and target leave hand before
            // resolving the boosted powered effect. Ensure costs remain payable.
            let remaining_hand: Vec<CardId> = player
                .hand
                .iter()
                .enumerate()
                .filter_map(|(idx, id)| {
                    (idx != source_hand_index && idx != target_hand_index).then_some(id.clone())
                })
                .collect();

            discard_costs_payable_with_hand(&target_def.powered_effect, &remaining_hand)
        })
}

fn discard_costs_payable_with_hand(effect: &CardEffect, remaining_hand: &[CardId]) -> bool {
    match effect {
        CardEffect::DiscardCost {
            count,
            filter_wounds,
            wounds_only,
            then_effect,
        } => {
            let eligible = remaining_hand
                .iter()
                .filter(|id| {
                    let is_wound = id.as_str() == WOUND_CARD_ID;
                    if *wounds_only {
                        is_wound
                    } else if *filter_wounds {
                        !is_wound
                    } else {
                        true
                    }
                })
                .count() as u32;
            eligible >= *count && discard_costs_payable_with_hand(then_effect, remaining_hand)
        }
        CardEffect::Choice { options } => options
            .iter()
            .any(|option| discard_costs_payable_with_hand(option, remaining_hand)),
        CardEffect::Compound { effects } => effects
            .iter()
            .any(|sub| discard_costs_payable_with_hand(sub, remaining_hand)),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            discard_costs_payable_with_hand(then_effect, remaining_hand)
                || else_effect.as_ref().is_some_and(|else_branch| {
                    discard_costs_payable_with_hand(else_branch, remaining_hand)
                })
        }
        CardEffect::Scaling { base_effect, .. } => {
            discard_costs_payable_with_hand(base_effect, remaining_hand)
        }
        _ => true,
    }
}

/// Returns true if the effect tree produces only influence (no move/attack/block/other value)
/// AND contains at least one influence-producing leaf.
///
/// Used to suppress basic/powered card plays for pure-influence cards when not at a site
/// (`!IS_INTERACTING`), since influence is useless outside site interactions.
///
/// Purely neutral effects (e.g. Cure, ConvertManaToCrystal) return false — they should
/// always be available regardless of interaction mode.
pub(super) fn is_influence_only(effect: &CardEffect) -> bool {
    has_influence_leaf(effect) && no_non_influence_value(effect)
}

/// Returns true if the effect tree produces only movement (no influence/attack/block/other value)
/// AND contains at least one move-producing leaf.
///
/// Used to suppress basic/powered card plays for pure-move cards when at a site
/// (`IS_INTERACTING`), since movement is useless during site interaction.
pub(super) fn is_move_only(effect: &CardEffect) -> bool {
    has_move_leaf(effect) && no_non_move_value(effect)
}

/// Returns true if the tree contains at least one influence-producing leaf.
fn has_influence_leaf(effect: &CardEffect) -> bool {
    match effect {
        CardEffect::GainInfluence { .. } => true,
        // PeacefulMomentAction is NOT pure influence — it also heals wounds,
        // so it shouldn't cause the card to be classified as influence-only.
        CardEffect::Compound { effects } => effects.iter().any(has_influence_leaf),
        CardEffect::Choice { options } => options.iter().any(has_influence_leaf),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            has_influence_leaf(then_effect)
                || else_effect.as_ref().is_some_and(|e| has_influence_leaf(e))
        }
        CardEffect::Scaling { base_effect, .. } => has_influence_leaf(base_effect),
        CardEffect::DiscardCost { then_effect, .. } => has_influence_leaf(then_effect),
        _ => false,
    }
}

/// Returns true if the tree contains no non-influence value-producing effects.
fn no_non_influence_value(effect: &CardEffect) -> bool {
    match effect {
        // Influence producers — OK
        CardEffect::GainInfluence { .. } => true,

        // Non-influence value producers → false
        CardEffect::GainMove { .. }
        | CardEffect::GainAttack { .. }
        | CardEffect::GainBlock { .. }
        | CardEffect::GainBlockElement { .. }
        | CardEffect::GainHealing { .. }
        | CardEffect::GainMana { .. }
        | CardEffect::DrawCards { .. }
        | CardEffect::CardBoost { .. }
        | CardEffect::ManaBolt { .. }
        | CardEffect::PureMagic { .. }
        | CardEffect::AttackWithDefeatBonus { .. }
        | CardEffect::GainAttackBowResolved { .. }
        | CardEffect::SelectCombatEnemy { .. }
        | CardEffect::SongOfWindPowered => false,

        // Neutral — doesn't produce move/attack/block value
        CardEffect::ChangeReputation { .. }
        | CardEffect::GainFame { .. }
        | CardEffect::GainCrystal { .. }
        | CardEffect::ConvertManaToCrystal
        | CardEffect::TakeWound
        | CardEffect::Noop
        | CardEffect::ApplyModifier { .. }
        | CardEffect::HandLimitBonus { .. }
        | CardEffect::ReadyUnit { .. }
        | CardEffect::HealUnit { .. }
        | CardEffect::ReadyAllUnits
        | CardEffect::HealAllUnits
        | CardEffect::ActivateBannerProtection
        | CardEffect::FamePerEnemyDefeated { .. }
        | CardEffect::GrantWoundImmunity
        | CardEffect::RushOfAdrenaline { .. }
        | CardEffect::EnergyFlow { .. }
        | CardEffect::ReadyUnitsBudget { .. }
        | CardEffect::SelectUnitForModifier { .. }
        | CardEffect::Cure { .. }
        | CardEffect::Disease => true,

        // Structural — recurse
        CardEffect::Compound { effects } => effects.iter().all(no_non_influence_value),
        CardEffect::Choice { options } => options.iter().all(no_non_influence_value),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            no_non_influence_value(then_effect)
                && else_effect
                    .as_ref()
                    .is_none_or(|e| no_non_influence_value(e))
        }
        CardEffect::Scaling { base_effect, .. } => no_non_influence_value(base_effect),
        CardEffect::DiscardCost { then_effect, .. } => no_non_influence_value(then_effect),

        // Complex / unknown → conservative false (don't gate)
        _ => false,
    }
}

/// Returns true if the tree contains at least one move-producing leaf.
fn has_move_leaf(effect: &CardEffect) -> bool {
    match effect {
        CardEffect::GainMove { .. } | CardEffect::SongOfWindPowered => true,
        CardEffect::Compound { effects } => effects.iter().any(has_move_leaf),
        CardEffect::Choice { options } => options.iter().any(has_move_leaf),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            has_move_leaf(then_effect)
                || else_effect.as_ref().is_some_and(|e| has_move_leaf(e))
        }
        CardEffect::Scaling { base_effect, .. } => has_move_leaf(base_effect),
        CardEffect::DiscardCost { then_effect, .. } => has_move_leaf(then_effect),
        _ => false,
    }
}

/// Returns true if the tree contains no non-move value-producing effects.
fn no_non_move_value(effect: &CardEffect) -> bool {
    match effect {
        // Move producers — OK
        CardEffect::GainMove { .. } | CardEffect::SongOfWindPowered => true,

        // Non-move value producers → false
        CardEffect::GainInfluence { .. }
        | CardEffect::GainAttack { .. }
        | CardEffect::GainBlock { .. }
        | CardEffect::GainBlockElement { .. }
        | CardEffect::GainHealing { .. }
        | CardEffect::GainMana { .. }
        | CardEffect::DrawCards { .. }
        | CardEffect::CardBoost { .. }
        | CardEffect::ManaBolt { .. }
        | CardEffect::PureMagic { .. }
        | CardEffect::AttackWithDefeatBonus { .. }
        | CardEffect::GainAttackBowResolved { .. }
        | CardEffect::SelectCombatEnemy { .. }
        | CardEffect::PeacefulMomentAction { .. } => false,

        // Neutral — doesn't produce influence/attack/block value
        CardEffect::ChangeReputation { .. }
        | CardEffect::GainFame { .. }
        | CardEffect::GainCrystal { .. }
        | CardEffect::ConvertManaToCrystal
        | CardEffect::TakeWound
        | CardEffect::Noop
        | CardEffect::ApplyModifier { .. }
        | CardEffect::HandLimitBonus { .. }
        | CardEffect::ReadyUnit { .. }
        | CardEffect::HealUnit { .. }
        | CardEffect::ReadyAllUnits
        | CardEffect::HealAllUnits
        | CardEffect::ActivateBannerProtection
        | CardEffect::FamePerEnemyDefeated { .. }
        | CardEffect::GrantWoundImmunity
        | CardEffect::RushOfAdrenaline { .. }
        | CardEffect::EnergyFlow { .. }
        | CardEffect::ReadyUnitsBudget { .. }
        | CardEffect::SelectUnitForModifier { .. }
        | CardEffect::Cure { .. }
        | CardEffect::Disease => true,

        // Structural — recurse
        CardEffect::Compound { effects } => effects.iter().all(no_non_move_value),
        CardEffect::Choice { options } => options.iter().all(no_non_move_value),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            no_non_move_value(then_effect)
                && else_effect
                    .as_ref()
                    .is_none_or(|e| no_non_move_value(e))
        }
        CardEffect::Scaling { base_effect, .. } => no_non_move_value(base_effect),
        CardEffect::DiscardCost { then_effect, .. } => no_non_move_value(then_effect),

        // Complex / unknown → conservative false (don't gate)
        _ => false,
    }
}

/// Returns true if the effect tree contains `GainHealing` as a primary component.
/// Cards with healing effects cannot be played face-up in combat (MK rules: healing icon).
/// Checks top-level effects and direct Choice/Compound children only — does not flag cards
/// where healing is deeply nested in a Conditional/Scaling subtree.
fn contains_healing_effect(effect: &CardEffect) -> bool {
    match effect {
        CardEffect::GainHealing { .. } => true,
        CardEffect::Choice { options } => options.iter().any(|o| matches!(o, CardEffect::GainHealing { .. })),
        CardEffect::Compound { effects } => effects.iter().any(|e| matches!(e, CardEffect::GainHealing { .. })),
        _ => false,
    }
}

/// Dispatch domination check to the appropriate phase-specific function.
fn is_dominated_in_combat_phase(
    state: &GameState,
    player_idx: usize,
    phase: CombatPhase,
    effect: &CardEffect,
) -> bool {
    match phase {
        CombatPhase::RangedSiege => is_dominated_in_ranged_siege(state, player_idx, effect),
        CombatPhase::Block => is_dominated_in_block(state, player_idx, effect),
        CombatPhase::Attack => is_dominated_in_attack(state, player_idx, effect),
        _ => false,
    }
}

/// Returns true if the effect tree is "dominated" in the RangedSiege phase — i.e., it contains
/// no leaf that provides tactical value during RangedSiege. Useful leaves include ranged/siege
/// attack, mana gain, crystal operations, card draw, and resource modifiers. Move, influence,
/// block, healing, and melee (without conversion modifiers) are all useless in RangedSiege.
///
/// This is an *enumeration-level* filter — once a card is played, the effect queue resolves
/// normally (no filtering at drain time).
pub(super) fn is_dominated_in_ranged_siege(
    state: &GameState,
    player_idx: usize,
    effect: &CardEffect,
) -> bool {
    !has_ranged_siege_useful_leaf(state, player_idx, effect)
}

/// Returns true if the effect tree contains at least one leaf that provides value during
/// the RangedSiege combat phase. Follows the same recursive structure as `has_influence_leaf`
/// / `has_move_leaf`.
fn has_ranged_siege_useful_leaf(
    state: &GameState,
    player_idx: usize,
    effect: &CardEffect,
) -> bool {
    match effect {
        // Ranged/Siege attack — always useful
        CardEffect::GainAttack { combat_type, .. }
        | CardEffect::AttackWithDefeatBonus { combat_type, .. }
        | CardEffect::GainAttackBowResolved { combat_type, .. } => match combat_type {
            CombatType::Ranged | CombatType::Siege => true,
            CombatType::Melee => has_attack_conversion_modifier(state, player_idx),
        },

        // Resource management — always useful (can set up for later)
        CardEffect::GainMana { .. }
        | CardEffect::GainCrystal { .. }
        | CardEffect::ConvertManaToCrystal
        | CardEffect::DrawCards { .. }
        | CardEffect::CardBoost { .. } => true,

        // Ranged-producing spells/effects — always useful
        CardEffect::ManaBolt { .. } | CardEffect::PureMagic { .. } => true,

        // Combat targeting — defeat is Attack-phase only (whirlwind powered)
        CardEffect::SelectCombatEnemy { template } => !template.defeat,

        // Discard for attack — check if any color option produces useful attack
        CardEffect::DiscardForAttack { attacks_by_color } => attacks_by_color
            .iter()
            .any(|(_, effect)| has_ranged_siege_useful_leaf(state, player_idx, effect)),

        // Modifiers can set up conversions, durations, etc. — always useful
        CardEffect::ApplyModifier { .. } => true,

        // Move — useful only with MoveCardsInCombat rule override
        CardEffect::GainMove { .. } | CardEffect::SongOfWindPowered => {
            is_rule_active(state, player_idx, RuleOverride::MoveCardsInCombat)
        }

        // Influence — useful only with InfluenceCardsInCombat rule override
        CardEffect::GainInfluence { .. } | CardEffect::PeacefulMomentAction { .. } => {
            is_rule_active(state, player_idx, RuleOverride::InfluenceCardsInCombat)
        }

        // Block — useless in RangedSiege (block phase hasn't started)
        CardEffect::GainBlock { .. } | CardEffect::GainBlockElement { .. } => false,

        // Healing — useless in combat
        CardEffect::GainHealing { .. } => false,

        // Cure/Disease — not useful in RangedSiege
        CardEffect::Cure { .. } | CardEffect::Disease => false,

        // Neutral effects — don't count as useful, don't block
        CardEffect::TakeWound
        | CardEffect::Noop
        | CardEffect::ChangeReputation { .. }
        | CardEffect::GainFame { .. }
        | CardEffect::GrantWoundImmunity
        | CardEffect::RushOfAdrenaline { .. }
        | CardEffect::EnergyFlow { .. }
        | CardEffect::FamePerEnemyDefeated { .. }
        | CardEffect::HandLimitBonus { .. }
        | CardEffect::ReadyUnit { .. }
        | CardEffect::HealUnit { .. }
        | CardEffect::ReadyAllUnits
        | CardEffect::HealAllUnits
        | CardEffect::ActivateBannerProtection
        | CardEffect::ReadyUnitsBudget { .. }
        | CardEffect::SelectUnitForModifier { .. } => false,

        // Structural — recurse into children
        CardEffect::Choice { options } => options
            .iter()
            .any(|o| has_ranged_siege_useful_leaf(state, player_idx, o)),
        CardEffect::Compound { effects } => effects
            .iter()
            .any(|e| has_ranged_siege_useful_leaf(state, player_idx, e)),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            has_ranged_siege_useful_leaf(state, player_idx, then_effect)
                || else_effect
                    .as_ref()
                    .is_some_and(|e| has_ranged_siege_useful_leaf(state, player_idx, e))
        }
        CardEffect::Scaling { base_effect, .. } => {
            has_ranged_siege_useful_leaf(state, player_idx, base_effect)
        }
        CardEffect::DiscardCost { then_effect, .. } => {
            has_ranged_siege_useful_leaf(state, player_idx, then_effect)
        }
        CardEffect::DiscardForBonus {
            choice_options, ..
        } => choice_options
            .iter()
            .any(|o| has_ranged_siege_useful_leaf(state, player_idx, o)),

        // Conservative catch-all — don't prune unknown effects
        _ => true,
    }
}

/// Check if the combat has any undefeated cumbersome enemy (native or modifier-granted).
fn has_cumbersome_enemy(state: &GameState) -> bool {
    let combat = match &state.combat {
        Some(c) => c,
        None => return false,
    };
    combat.enemies.iter().any(|enemy| {
        if enemy.is_defeated {
            return false;
        }
        let def = match mk_data::enemies::get_enemy(enemy.enemy_id.as_str()) {
            Some(d) => d,
            None => return false,
        };
        if combat_resolution::has_ability(def, EnemyAbilityType::Cumbersome) {
            return true;
        }
        // Check for granted cumbersome via modifier
        state.active_modifiers.iter().any(|m| {
            matches!(&m.effect, ModifierEffect::GrantEnemyAbility { ability }
                if *ability == EnemyAbilityType::Cumbersome)
                && matches!(&m.scope, mk_types::modifier::ModifierScope::OneEnemy { enemy_id }
                    if enemy_id == enemy.instance_id.as_str())
        })
    })
}

/// Returns true if the effect tree is "dominated" in the Block phase — i.e., it contains
/// no leaf that provides tactical value during Block. Useful leaves include block, move
/// (cumbersome spending), mana/crystal/draw/boost, and modifiers. Attack (all types),
/// ManaBolt, PureMagic, DiscardForAttack, healing, and cure/disease are all useless.
/// Influence is only useful with InfluenceCardsInCombat rule override (Diplomacy).
pub(super) fn is_dominated_in_block(
    state: &GameState,
    player_idx: usize,
    effect: &CardEffect,
) -> bool {
    !has_block_useful_leaf(state, player_idx, effect)
}

/// Returns true if the effect tree contains at least one leaf that provides value during
/// the Block combat phase.
fn has_block_useful_leaf(state: &GameState, player_idx: usize, effect: &CardEffect) -> bool {
    match effect {
        // Block — always useful in Block phase
        CardEffect::GainBlock { .. } | CardEffect::GainBlockElement { .. } => true,

        // Resource management — always useful
        CardEffect::GainMana { .. }
        | CardEffect::GainCrystal { .. }
        | CardEffect::ConvertManaToCrystal
        | CardEffect::DrawCards { .. }
        | CardEffect::CardBoost { .. } => true,

        // Move — useful in Block phase only if cumbersome enemies present or MoveCardsInCombat
        CardEffect::GainMove { .. } | CardEffect::SongOfWindPowered => {
            has_cumbersome_enemy(state)
                || is_rule_active(state, player_idx, RuleOverride::MoveCardsInCombat)
        }

        // Modifiers — always useful (could set up block bonuses, etc.)
        CardEffect::ApplyModifier { .. } => true,

        // Combat targeting — defeat is Attack-phase only (whirlwind powered)
        CardEffect::SelectCombatEnemy { template } => !template.defeat,

        // Attack — NOT useful in Block phase
        CardEffect::GainAttack { .. }
        | CardEffect::AttackWithDefeatBonus { .. }
        | CardEffect::GainAttackBowResolved { .. }
        | CardEffect::ManaBolt { .. }
        | CardEffect::PureMagic { .. } => false,

        // Discard for attack — recurse into inner effects (all attack → false)
        CardEffect::DiscardForAttack { attacks_by_color } => attacks_by_color
            .iter()
            .any(|(_, effect)| has_block_useful_leaf(state, player_idx, effect)),

        // Influence — useful only with InfluenceCardsInCombat rule (Diplomacy)
        CardEffect::GainInfluence { .. } | CardEffect::PeacefulMomentAction { .. } => {
            is_rule_active(state, player_idx, RuleOverride::InfluenceCardsInCombat)
        }

        // Healing — useless in combat
        CardEffect::GainHealing { .. } => false,

        // Disease — useful in Block (sets blocked enemies' armor to 1)
        CardEffect::Disease => true,

        // Cure — not useful in Block (healing-adjacent, no tactical value)
        CardEffect::Cure { .. } => false,

        // Neutral effects — don't count as useful, don't block
        CardEffect::TakeWound
        | CardEffect::Noop
        | CardEffect::ChangeReputation { .. }
        | CardEffect::GainFame { .. }
        | CardEffect::GrantWoundImmunity
        | CardEffect::RushOfAdrenaline { .. }
        | CardEffect::EnergyFlow { .. }
        | CardEffect::FamePerEnemyDefeated { .. }
        | CardEffect::HandLimitBonus { .. }
        | CardEffect::ReadyUnit { .. }
        | CardEffect::HealUnit { .. }
        | CardEffect::ReadyAllUnits
        | CardEffect::HealAllUnits
        | CardEffect::ActivateBannerProtection
        | CardEffect::ReadyUnitsBudget { .. }
        | CardEffect::SelectUnitForModifier { .. } => false,

        // Structural — recurse into children
        CardEffect::Choice { options } => options
            .iter()
            .any(|o| has_block_useful_leaf(state, player_idx, o)),
        CardEffect::Compound { effects } => effects
            .iter()
            .any(|e| has_block_useful_leaf(state, player_idx, e)),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            has_block_useful_leaf(state, player_idx, then_effect)
                || else_effect
                    .as_ref()
                    .is_some_and(|e| has_block_useful_leaf(state, player_idx, e))
        }
        CardEffect::Scaling { base_effect, .. } => {
            has_block_useful_leaf(state, player_idx, base_effect)
        }
        CardEffect::DiscardCost { then_effect, .. } => {
            has_block_useful_leaf(state, player_idx, then_effect)
        }
        CardEffect::DiscardForBonus {
            choice_options, ..
        } => choice_options
            .iter()
            .any(|o| has_block_useful_leaf(state, player_idx, o)),

        // Conservative catch-all — don't prune unknown effects
        _ => true,
    }
}

/// Returns true if the effect tree is "dominated" in the Attack phase — i.e., it contains
/// no leaf that provides tactical value during Attack. Useful leaves include all attack types,
/// ManaBolt, PureMagic, DiscardForAttack, mana/crystal/draw/boost, modifiers, targeting,
/// and Disease. Block, move, influence, healing, and cure are all useless.
pub(super) fn is_dominated_in_attack(
    _state: &GameState,
    _player_idx: usize,
    effect: &CardEffect,
) -> bool {
    !has_attack_useful_leaf(effect)
}

/// Returns true if the effect tree contains at least one leaf that provides value during
/// the Attack combat phase.
fn has_attack_useful_leaf(effect: &CardEffect) -> bool {
    match effect {
        // Attack — always useful in Attack phase
        CardEffect::GainAttack { .. }
        | CardEffect::AttackWithDefeatBonus { .. }
        | CardEffect::GainAttackBowResolved { .. }
        | CardEffect::ManaBolt { .. }
        | CardEffect::PureMagic { .. } => true,

        // Resource management — always useful
        CardEffect::GainMana { .. }
        | CardEffect::GainCrystal { .. }
        | CardEffect::ConvertManaToCrystal
        | CardEffect::DrawCards { .. }
        | CardEffect::CardBoost { .. } => true,

        // Modifiers — always useful (attack bonuses, etc.)
        CardEffect::ApplyModifier { .. } => true,

        // Combat targeting — useful for attack target selection
        CardEffect::SelectCombatEnemy { .. } => true,

        // Discard for attack — recurse into inner effects
        CardEffect::DiscardForAttack { attacks_by_color } => attacks_by_color
            .iter()
            .any(|(_, effect)| has_attack_useful_leaf(effect)),

        // Disease — useful (weakens enemies before attacking)
        CardEffect::Disease => true,

        // Block — NOT useful in Attack phase (wrong phase)
        CardEffect::GainBlock { .. } | CardEffect::GainBlockElement { .. } => false,

        // Move — NOT useful in Attack phase (no cumbersome spending, no purpose)
        CardEffect::GainMove { .. } | CardEffect::SongOfWindPowered => false,

        // Influence — NOT useful in Attack phase (Diplomacy = influence as block, Block phase only)
        CardEffect::GainInfluence { .. } | CardEffect::PeacefulMomentAction { .. } => false,

        // Healing — useless in combat
        CardEffect::GainHealing { .. } => false,

        // Cure — not useful in Attack
        CardEffect::Cure { .. } => false,

        // Neutral effects — don't count as useful
        CardEffect::TakeWound
        | CardEffect::Noop
        | CardEffect::ChangeReputation { .. }
        | CardEffect::GainFame { .. }
        | CardEffect::GrantWoundImmunity
        | CardEffect::RushOfAdrenaline { .. }
        | CardEffect::EnergyFlow { .. }
        | CardEffect::FamePerEnemyDefeated { .. }
        | CardEffect::HandLimitBonus { .. }
        | CardEffect::ReadyUnit { .. }
        | CardEffect::HealUnit { .. }
        | CardEffect::ReadyAllUnits
        | CardEffect::HealAllUnits
        | CardEffect::ActivateBannerProtection
        | CardEffect::ReadyUnitsBudget { .. }
        | CardEffect::SelectUnitForModifier { .. } => false,

        // Structural — recurse into children
        CardEffect::Choice { options } => options
            .iter()
            .any(has_attack_useful_leaf),
        CardEffect::Compound { effects } => effects
            .iter()
            .any(has_attack_useful_leaf),
        CardEffect::Conditional {
            then_effect,
            else_effect,
            ..
        } => {
            has_attack_useful_leaf(then_effect)
                || else_effect
                    .as_ref()
                    .is_some_and(|e| has_attack_useful_leaf(e))
        }
        CardEffect::Scaling { base_effect, .. } => {
            has_attack_useful_leaf(base_effect)
        }
        CardEffect::DiscardCost { then_effect, .. } => {
            has_attack_useful_leaf(then_effect)
        }
        CardEffect::DiscardForBonus {
            choice_options, ..
        } => choice_options
            .iter()
            .any(has_attack_useful_leaf),

        // Conservative catch-all — don't prune unknown effects
        _ => true,
    }
}

/// Check if player can afford to power a card requiring the given color.
///
/// Mirrors `collect_mana_sources` logic but doesn't mutate state.
pub(crate) fn can_afford_powered(
    state: &GameState,
    player_idx: usize,
    color: BasicManaColor,
) -> bool {
    let player = &state.players[player_idx];
    let target = ManaColor::from(color);

    // 1. Matching-color mana token.
    if player.pure_mana.iter().any(|t| t.color == target) {
        return true;
    }

    // 2. Gold mana token (wild).
    if player.pure_mana.iter().any(|t| t.color == ManaColor::Gold) {
        return true;
    }

    // 3. Matching-color crystal.
    let crystal_count = match color {
        BasicManaColor::Red => player.crystals.red,
        BasicManaColor::Blue => player.crystals.blue,
        BasicManaColor::Green => player.crystals.green,
        BasicManaColor::White => player.crystals.white,
    };
    if crystal_count > 0 {
        return true;
    }

    // 4. Available mana source die (1 per turn limit).
    if !player
        .flags
        .contains(PlayerFlags::USED_MANA_FROM_SOURCE)
    {
        let player_id = &player.id;
        let stolen_die_id = player
            .tactic_state
            .stored_mana_die
            .as_ref()
            .map(|s| &s.die_id);

        let has_matching_die = state.source.dice.iter().any(|die| {
            crate::card_play::is_die_available_with_overrides(die, state, player_idx)
                && (die.taken_by_player_id.is_none()
                    || (die.taken_by_player_id.as_ref() == Some(player_id)
                        && stolen_die_id == Some(&die.id)))
                && (die.color == target || die.color == ManaColor::Gold)
        });
        if has_matching_die {
            return true;
        }
    }

    false
}
