/**
 * Validators for PLAY_CARD action
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction, CardId } from "@mage-knight/shared";
import type { ValidationResult } from "./types.js";
import { valid, invalid } from "./types.js";
import { PLAY_CARD_ACTION } from "@mage-knight/shared";
import { BASIC_ACTION_CARDS, getBasicActionCard } from "../../data/basicActions.js";
import { DEED_CARD_TYPE_WOUND } from "../../types/cards.js";
import type { BasicActionCardId } from "../../types/cardIds.js";
import {
  CARD_NOT_IN_HAND,
  CARD_NOT_FOUND,
  CANNOT_PLAY_WOUND,
  PLAYER_NOT_FOUND,
  INVALID_ACTION_CODE,
} from "./validationCodes.js";

function getCardId(action: PlayerAction): CardId | null {
  if (action.type === PLAY_CARD_ACTION && "cardId" in action) {
    return action.cardId;
  }
  return null;
}

// Card must be in player's hand
export function validateCardInHand(
  state: GameState,
  playerId: string,
  action: PlayerAction
): ValidationResult {
  const cardId = getCardId(action);
  if (!cardId) {
    return invalid(INVALID_ACTION_CODE, "Invalid play card action");
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return invalid(PLAYER_NOT_FOUND, "Player not found");
  }

  if (!player.hand.includes(cardId)) {
    return invalid(CARD_NOT_IN_HAND, "Card is not in your hand");
  }

  return valid();
}

// Card must exist in definitions
export function validateCardExists(
  _state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  const cardId = getCardId(action);
  if (!cardId) {
    return invalid(INVALID_ACTION_CODE, "Invalid play card action");
  }

  // Check if card exists in basic action cards
  const exists = cardId in BASIC_ACTION_CARDS;
  if (!exists) {
    return invalid(CARD_NOT_FOUND, "Card definition not found");
  }

  return valid();
}

// Cannot play wound cards normally (they clog your hand)
export function validateNotWound(
  _state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  const cardId = getCardId(action);
  if (!cardId) {
    return invalid(INVALID_ACTION_CODE, "Invalid play card action");
  }

  // Check if card exists first
  if (!(cardId in BASIC_ACTION_CARDS)) {
    // Card not found - let validateCardExists handle this
    return valid();
  }

  const card = getBasicActionCard(cardId as BasicActionCardId);
  if (card.cardType === DEED_CARD_TYPE_WOUND) {
    return invalid(
      CANNOT_PLAY_WOUND,
      "Wound cards cannot be played for their effect"
    );
  }

  return valid();
}
