/**
 * REST command - handles resting to discard cards
 *
 * REST is an alternative to taking a regular turn. Instead of playing cards for effects,
 * the player discards cards to cycle their hand. ALL discarded cards (including wounds)
 * go to the discard pile - this is NOT healing.
 *
 * Two types of rest:
 * - Standard Rest: Discard exactly one non-wound card (plus any wounds)
 * - Slow Recovery: When hand is ALL wounds, discard exactly one wound
 */

import type { Command, CommandResult } from "../commands.js";
import type { GameState } from "../../state/GameState.js";
import type { Player } from "../../types/player.js";
import type { CardId, BasicActionCardId, GameEvent, RestType } from "@mage-knight/shared";
import {
  PLAYER_RESTED,
  END_OF_ROUND_ANNOUNCED,
  REST_UNDONE,
} from "@mage-knight/shared";
import { getBasicActionCard } from "../../data/basicActions.js";
import { DEED_CARD_TYPE_WOUND } from "../../types/cards.js";
import { REST_COMMAND } from "./commandTypes.js";

export { REST_COMMAND };

export interface RestCommandParams {
  readonly playerId: string;
  readonly restType: RestType;
  readonly discardCardIds: readonly CardId[];
  readonly announceEndOfRound: boolean;
  readonly previousHand: readonly CardId[]; // For undo
  readonly previousDiscard: readonly CardId[]; // For undo
}

export function createRestCommand(params: RestCommandParams): Command {
  return {
    type: REST_COMMAND,
    playerId: params.playerId,
    isReversible: true, // Can undo rest before end of turn

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

      // Count wounds for event reporting
      let woundCount = 0;
      for (const cardId of params.discardCardIds) {
        try {
          const card = getBasicActionCard(cardId as BasicActionCardId);
          if (card.cardType === DEED_CARD_TYPE_WOUND) {
            woundCount++;
          }
        } catch {
          // If card not found in basic actions, treat as non-wound
        }
      }

      // Remove cards from hand
      const newHand = [...player.hand];
      for (const cardId of params.discardCardIds) {
        const index = newHand.indexOf(cardId);
        if (index !== -1) {
          newHand.splice(index, 1);
        }
      }

      // ALL discarded cards go to discard pile (wounds too - this is NOT healing)
      const newDiscard = [...player.discard, ...params.discardCardIds];

      // Mark that player has taken their action
      const updatedPlayer: Player = {
        ...player,
        hand: newHand,
        discard: newDiscard,
        hasTakenActionThisTurn: true,
      };

      const players = [...state.players];
      players[playerIndex] = updatedPlayer;

      const events: GameEvent[] = [
        {
          type: PLAYER_RESTED,
          playerId: params.playerId,
          restType: params.restType,
          cardsDiscarded: params.discardCardIds.length,
          woundsDiscarded: woundCount,
          announcedEndOfRound: params.announceEndOfRound,
        },
      ];

      if (params.announceEndOfRound) {
        events.push({
          type: END_OF_ROUND_ANNOUNCED,
          playerId: params.playerId,
        });
      }

      return {
        state: { ...state, players },
        events,
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

      // Restore original hand and discard
      const updatedPlayer: Player = {
        ...player,
        hand: [...params.previousHand],
        discard: [...params.previousDiscard],
        hasTakenActionThisTurn: false,
      };

      const players = [...state.players];
      players[playerIndex] = updatedPlayer;

      return {
        state: { ...state, players },
        events: [
          {
            type: REST_UNDONE,
            playerId: params.playerId,
          },
        ],
      };
    },
  };
}
