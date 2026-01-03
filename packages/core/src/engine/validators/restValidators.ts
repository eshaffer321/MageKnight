/**
 * REST action validators
 *
 * REST allows a player to discard cards from their hand to cycle their deck.
 * Two types:
 * - Standard Rest: Discard exactly one non-wound card (plus any wounds)
 * - Slow Recovery: When hand is ALL wounds, discard exactly one wound
 *
 * All discarded cards go to the discard pile (wounds are NOT healed).
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction } from "@mage-knight/shared";
import type { ValidationResult } from "./types.js";
import { valid, invalid } from "./types.js";
import {
  REST_ACTION,
  REST_TYPE_STANDARD,
  REST_TYPE_SLOW_RECOVERY,
} from "@mage-knight/shared";
import { getBasicActionCard } from "../../data/basicActions.js";
import { DEED_CARD_TYPE_WOUND } from "../../types/cards.js";
import type { BasicActionCardId } from "@mage-knight/shared";
import {
  REST_NO_DISCARD,
  CARD_NOT_IN_HAND,
  PLAYER_NOT_FOUND,
  STANDARD_REST_ONE_NON_WOUND,
  SLOW_RECOVERY_INVALID,
  SLOW_RECOVERY_ONE_WOUND,
  SLOW_RECOVERY_MUST_BE_WOUND,
} from "./validationCodes.js";

/**
 * Helper to check if a card is a wound
 */
function isWoundCard(cardId: string): boolean {
  try {
    const card = getBasicActionCard(cardId as BasicActionCardId);
    return card.cardType === DEED_CARD_TYPE_WOUND;
  } catch {
    // If card not found in basic actions, assume it's not a wound
    return false;
  }
}

/**
 * Must discard at least one card to rest
 */
export function validateRestHasDiscard(
  _state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== REST_ACTION) return valid();

  if (!action.discardCardIds || action.discardCardIds.length === 0) {
    return invalid(REST_NO_DISCARD, "Must discard at least one card to rest");
  }

  return valid();
}

/**
 * All discarded cards must be in hand
 */
export function validateRestCardsInHand(
  state: GameState,
  playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== REST_ACTION) return valid();

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return invalid(PLAYER_NOT_FOUND, "Player not found");

  for (const cardId of action.discardCardIds) {
    if (!player.hand.includes(cardId)) {
      return invalid(CARD_NOT_IN_HAND, `Card ${cardId} is not in your hand`);
    }
  }

  return valid();
}

/**
 * Validate Standard Rest: exactly one non-wound, any number of wounds
 */
export function validateStandardRest(
  _state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== REST_ACTION) return valid();
  if (action.restType !== REST_TYPE_STANDARD) return valid();

  let nonWoundCount = 0;

  for (const cardId of action.discardCardIds) {
    if (!isWoundCard(cardId)) {
      nonWoundCount++;
    }
  }

  if (nonWoundCount !== 1) {
    return invalid(
      STANDARD_REST_ONE_NON_WOUND,
      "Standard Rest requires exactly one non-wound card (plus any number of wounds)"
    );
  }

  return valid();
}

/**
 * Validate Slow Recovery: exactly one wound, no non-wounds, hand must be all wounds
 */
export function validateSlowRecovery(
  state: GameState,
  playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== REST_ACTION) return valid();
  if (action.restType !== REST_TYPE_SLOW_RECOVERY) return valid();

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return invalid(PLAYER_NOT_FOUND, "Player not found");

  // Hand must contain ONLY wounds
  const hasNonWoundInHand = player.hand.some((cardId) => !isWoundCard(cardId));

  if (hasNonWoundInHand) {
    return invalid(
      SLOW_RECOVERY_INVALID,
      "Slow Recovery is only allowed when your hand contains only wound cards"
    );
  }

  // Must discard exactly one wound
  if (action.discardCardIds.length !== 1) {
    return invalid(
      SLOW_RECOVERY_ONE_WOUND,
      "Slow Recovery requires discarding exactly one wound card"
    );
  }

  const discardedCard = action.discardCardIds[0];
  if (!discardedCard || !isWoundCard(discardedCard)) {
    return invalid(
      SLOW_RECOVERY_MUST_BE_WOUND,
      "Slow Recovery must discard a wound card"
    );
  }

  return valid();
}
