/**
 * Play card command - handles playing a card from hand with undo support
 *
 * Phase 1: Basic effects only (no mana powering)
 */

import type { Command, CommandResult } from "../commands.js";
import type { GameState } from "../../state/GameState.js";
import type { Player } from "../../types/player.js";
import type { CardId } from "@mage-knight/shared";
import {
  CARD_PLAYED,
  createCardPlayUndoneEvent,
} from "@mage-knight/shared";
import { resolveEffect, reverseEffect } from "../effects/resolveEffect.js";
import { getBasicActionCard } from "../../data/basicActions.js";
import { PLAY_CARD_COMMAND } from "./commandTypes.js";
import type { CardEffect } from "../../types/cards.js";
import type { BasicActionCardId } from "../../types/cardIds.js";

export { PLAY_CARD_COMMAND };

export interface PlayCardCommandParams {
  readonly playerId: string;
  readonly cardId: CardId;
  readonly handIndex: number; // For undo — where the card was
}

/**
 * Create a play card command.
 *
 * The handIndex is passed in because it was captured at creation time.
 * This ensures undo restores the card to the exact previous position in hand.
 */
export function createPlayCardCommand(params: PlayCardCommandParams): Command {
  // Store the effect that was applied so we can reverse it on undo
  let appliedEffect: CardEffect | null = null;

  return {
    type: PLAY_CARD_COMMAND,
    playerId: params.playerId,
    isReversible: true, // Can undo playing a card (before irreversible action)

    execute(state: GameState): CommandResult {
      const playerIndex = state.players.findIndex(
        (p) => p.id === params.playerId
      );
      if (playerIndex === -1) {
        throw new Error(`Player not found: ${params.playerId}`);
      }

      const player = state.players[playerIndex];
      if (!player) {
        throw new Error(`Player not found at index: ${playerIndex}`);
      }

      // Get card definition - cast cardId since validators already confirmed it exists
      const card = getBasicActionCard(params.cardId as BasicActionCardId);

      // Store the effect for undo
      appliedEffect = card.basicEffect;

      // Remove card from hand, add to play area
      const newHand = player.hand.filter((_, i) => i !== params.handIndex);
      const newPlayArea = [...player.playArea, params.cardId];

      const updatedPlayer: Player = {
        ...player,
        hand: newHand,
        playArea: newPlayArea,
      };

      const players = [...state.players];
      players[playerIndex] = updatedPlayer;

      const newState: GameState = { ...state, players };

      // Resolve the basic effect (Phase 1: no mana powering)
      const effectResult = resolveEffect(
        newState,
        params.playerId,
        card.basicEffect
      );

      if (effectResult.requiresChoice) {
        // Phase 1: Card moves to play area but effect doesn't fully resolve
        // Future: Return partial state and prompt for choice
        return {
          state: newState,
          events: [
            {
              type: CARD_PLAYED,
              playerId: params.playerId,
              cardId: params.cardId,
              powered: false,
              sideways: false,
              effect: "Choice required — select an option (not yet implemented)",
            },
          ],
        };
      }

      return {
        state: effectResult.state,
        events: [
          {
            type: CARD_PLAYED,
            playerId: params.playerId,
            cardId: params.cardId,
            powered: false,
            sideways: false,
            effect: effectResult.description,
          },
        ],
      };
    },

    undo(state: GameState): CommandResult {
      const playerIndex = state.players.findIndex(
        (p) => p.id === params.playerId
      );
      if (playerIndex === -1) {
        throw new Error(`Player not found: ${params.playerId}`);
      }

      const player = state.players[playerIndex];
      if (!player) {
        throw new Error(`Player not found at index: ${playerIndex}`);
      }

      // Remove card from play area
      const cardIndexInPlayArea = player.playArea.indexOf(params.cardId);
      const newPlayArea = player.playArea.filter(
        (_, i) => i !== cardIndexInPlayArea
      );

      // Add card back to hand at original position
      const newHand = [...player.hand];
      newHand.splice(params.handIndex, 0, params.cardId);

      let updatedPlayer: Player = {
        ...player,
        hand: newHand,
        playArea: newPlayArea,
      };

      // Reverse the effect if we stored one
      if (appliedEffect) {
        updatedPlayer = reverseEffect(updatedPlayer, appliedEffect);
      }

      const players = [...state.players];
      players[playerIndex] = updatedPlayer;

      return {
        state: { ...state, players },
        events: [createCardPlayUndoneEvent(params.playerId, params.cardId)],
      };
    },
  };
}
