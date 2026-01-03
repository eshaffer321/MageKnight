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
  UNDO_ACTION,
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

// Re-export types
export * from "./types.js";

// Validator registry - which validators run for which action
const validatorRegistry: Record<string, Validator[]> = {
  [MOVE_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNotInCombat,
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
  [END_TURN_ACTION]: [validateIsPlayersTurn, validateRoundPhase, validateNotInCombat],
  [EXPLORE_ACTION]: [
    validateIsPlayersTurn,
    validateRoundPhase,
    validateNotInCombat,
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
    // Note: Playing cards is allowed during combat and doesn't count as the "action"
    validateCardInHand,
    validateCardExists,
    validateNotWound,
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
