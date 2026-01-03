/**
 * Validator registry and runner
 */

import type { Validator, ValidationResult } from "./types.js";
import type { GameState } from "../../state/GameState.js";
import type { PlayerAction } from "@mage-knight/shared";
import {
  END_TURN_ACTION,
  EXPLORE_ACTION,
  MOVE_ACTION,
  PLAY_CARD_ACTION,
  PLAY_CARD_SIDEWAYS_ACTION,
  UNDO_ACTION,
  RESOLVE_CHOICE_ACTION,
  REST_ACTION,
} from "@mage-knight/shared";
import { valid } from "./types.js";

// Turn validators
import {
  validateIsPlayersTurn,
  validateRoundPhase,
  validateNotInCombat,
  validateHasNotActed,
} from "./turnValidators.js";

// Movement validators
import {
  validatePlayerOnMap,
  validateTargetAdjacent,
  validateTargetHexExists,
  validateTerrainPassable,
  validateEnoughMovePoints,
} from "./movementValidators.js";

// Explore validators
import {
  validatePlayerOnMapForExplore,
  validateOnEdgeHex,
  validateExploreDirection,
  validateExploreMoveCost,
  validateTilesAvailable,
} from "./exploreValidators.js";

// Play card validators
import {
  validateCardInHand,
  validateCardExists,
  validateNotWound,
} from "./playCardValidators.js";

// Mana validators
import {
  validateManaAvailable,
  validateManaColorMatch,
  validateManaTimeOfDay,
} from "./manaValidators.js";

// Sideways play validators
import {
  validateSidewaysCardInHand,
  validateSidewaysNotWound,
  validateSidewaysChoice,
} from "./sidewaysValidators.js";

// Choice validators
import {
  validateHasPendingChoice,
  validateChoiceIndex,
  validateNoChoicePending,
} from "./choiceValidators.js";

// Rest validators
import {
  validateRestHasDiscard,
  validateRestCardsInHand,
  validateStandardRest,
  validateSlowRecovery,
} from "./restValidators.js";

// TODO: RULES LIMITATION - Immediate Choice Resolution
// =====================================================
// Current behavior: Players must resolve card choices (e.g., "Attack 2 OR Block 2")
// immediately before playing more cards or taking other actions.
//
// Actual Mage Knight rules: Players can stack multiple cards with unresolved choices,
// then decide when applying effects to combat. Example:
//   1. Play Rage (Attack OR Block - don't choose yet)
//   2. Play March (Move 2)
//   3. Play another card
//   4. Enter combat
//   5. NOW decide what Rage provides based on combat situation
//
// To fix this properly:
//   1. Change pendingChoice to pendingChoices: PendingChoice[] (array)
//   2. Remove validateNoChoicePending from PLAY_CARD_ACTION
//   3. Keep it on END_TURN, EXPLORE (must resolve before irreversible actions)
//   4. Add combat phase resolution that prompts for all pending choices
//   5. Update UI to show multiple pending choices
//
// For now, we force immediate resolution as a simplification.
// =====================================================

// Re-export types
export * from "./types.js";

// Validator registry - which validators run for which action
const validatorRegistry: Record<string, Validator[]> = {
  [MOVE_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNotInCombat,
    validateNoChoicePending, // Must resolve pending choice first
    validateHasNotActed, // Must move BEFORE taking action
    validatePlayerOnMap,
    validateTargetAdjacent,
    validateTargetHexExists,
    validateTerrainPassable,
    validateEnoughMovePoints,
  ],
  [UNDO_ACTION]: [
    validateIsPlayersTurn,
    // Undo has special handling, minimal validation
  ],
  [END_TURN_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNotInCombat,
    validateNoChoicePending, // Must resolve pending choice first
  ],
  [EXPLORE_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNotInCombat,
    validateNoChoicePending, // Must resolve pending choice first
    validateHasNotActed,
    validatePlayerOnMapForExplore,
    validateOnEdgeHex,
    validateExploreDirection,
    validateExploreMoveCost,
    validateTilesAvailable,
  ],
  [PLAY_CARD_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNoChoicePending, // Must resolve pending choice first
    // Note: Playing cards is allowed during combat and doesn't count as the "action"
    validateCardInHand,
    validateCardExists,
    validateNotWound,
    // Mana validators (for powered play) - time check first, then availability, then color match
    validateManaTimeOfDay,
    validateManaAvailable,
    validateManaColorMatch,
  ],
  [PLAY_CARD_SIDEWAYS_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNoChoicePending, // Must resolve pending choice first
    validateSidewaysCardInHand,
    validateSidewaysNotWound, // Any non-wound card is valid for sideways play
    validateSidewaysChoice,
  ],
  [RESOLVE_CHOICE_ACTION]: [
    validateIsPlayersTurn,
    validateHasPendingChoice,
    validateChoiceIndex,
  ],
  [REST_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNoChoicePending,
    validateHasNotActed, // Can only rest if you haven't taken an action
    validateRestHasDiscard,
    validateRestCardsInHand,
    validateStandardRest, // Checks standard rest rules (exactly one non-wound)
    validateSlowRecovery, // Checks slow recovery rules (all wounds in hand)
  ],
  // Add more action types as implemented
};

// Run all validators for an action type
export function validateAction(
  state: GameState,
  playerId: string,
  action: PlayerAction
): ValidationResult {
  const validators = validatorRegistry[action.type];

  if (!validators) {
    // Unknown action type - could be not implemented yet
    return valid(); // Or return invalid if you want strict checking
  }

  for (const validator of validators) {
    const result = validator(state, playerId, action);
    if (!result.valid) {
      return result;
    }
  }

  return valid();
}

// Get validators for testing/introspection
export function getValidatorsForAction(actionType: string): Validator[] {
  return validatorRegistry[actionType] ?? [];
}
