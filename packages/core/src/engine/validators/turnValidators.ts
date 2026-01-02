/**
 * Turn and phase validators
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction } from "@mage-knight/shared";
import type { ValidationResult } from "./types.js";
import { valid, invalid } from "./types.js";

// Check it's this player's turn
export function validateIsPlayersTurn(
  state: GameState,
  playerId: string,
  _action: PlayerAction
): ValidationResult {
  const currentPlayerId = state.turnOrder[state.currentPlayerIndex];
  if (currentPlayerId !== playerId) {
    return invalid("NOT_YOUR_TURN", "It is not your turn");
  }
  return valid();
}

// Check game is in round phase (not setup or end)
export function validateRoundPhase(
  state: GameState,
  _playerId: string,
  _action: PlayerAction
): ValidationResult {
  if (state.phase !== "round") {
    return invalid(
      "WRONG_PHASE",
      `Cannot perform actions during ${state.phase} phase`
    );
  }
  return valid();
}

// Check not in combat
export function validateNotInCombat(
  state: GameState,
  _playerId: string,
  _action: PlayerAction
): ValidationResult {
  if (state.combat !== null) {
    return invalid("IN_COMBAT", "Cannot perform this action during combat");
  }
  return valid();
}

// Check player hasn't taken their action yet (for actions that consume the action)
export function validateHasNotActed(
  state: GameState,
  playerId: string,
  _action: PlayerAction
): ValidationResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return invalid("PLAYER_NOT_FOUND", "Player not found");
  }
  if (player.hasTakenActionThisTurn) {
    return invalid("ALREADY_ACTED", "You have already taken an action this turn");
  }
  return valid();
}
