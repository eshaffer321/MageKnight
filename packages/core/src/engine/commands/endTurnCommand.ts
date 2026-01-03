/**
 * End turn command - handles ending a player's turn
 *
 * This command is irreversible and:
 * - Clears the command stack (no more undo)
 * - Expires "turn" duration modifiers
 * - Moves play area cards to discard
 * - Draws cards up to hand limit (no mid-round reshuffle)
 * - Resets turn state (hasMovedThisTurn, hasTakenActionThisTurn, movePoints, etc.)
 * - Advances to next player (or next round if everyone has gone)
 * - At round end: reshuffles all players' cards and draws fresh hands
 */

import type { Command, CommandResult } from "../commands.js";
import type { GameState } from "../../state/GameState.js";
import type { Player } from "../../types/player.js";
import type { CardId, GameEvent } from "@mage-knight/shared";
import { TURN_ENDED, ROUND_ENDED } from "@mage-knight/shared";
import { expireModifiers } from "../modifiers.js";
import { EXPIRATION_TURN_END } from "../modifierConstants.js";
import { END_TURN_COMMAND } from "./commandTypes.js";
import { shuffle } from "../../utils/index.js";

export { END_TURN_COMMAND };

export interface EndTurnCommandParams {
  readonly playerId: string;
}

export function createEndTurnCommand(params: EndTurnCommandParams): Command {
  return {
    type: END_TURN_COMMAND,
    playerId: params.playerId,
    isReversible: false, // Ending turn is irreversible

    execute(state: GameState): CommandResult {
      // Find current player
      const playerIndex = state.players.findIndex(
        (p) => p.id === params.playerId
      );
      if (playerIndex === -1) {
        throw new Error(`Player not found: ${params.playerId}`);
      }

      const currentPlayer = state.players[playerIndex];
      if (!currentPlayer) {
        throw new Error(`Player not found at index: ${playerIndex}`);
      }

      // Step 1: Move play area cards to discard
      const playAreaCards = currentPlayer.playArea;
      const newDiscard = [...currentPlayer.discard, ...playAreaCards];
      const clearedPlayArea: readonly CardId[] = [];

      // Step 2: Draw up to hand limit (no mid-round reshuffle if deck empties)
      const handLimit = currentPlayer.handLimit;
      const currentHandSize = currentPlayer.hand.length;
      const cardsToDraw = Math.max(0, handLimit - currentHandSize);

      const newHand: CardId[] = [...currentPlayer.hand];
      const newDeck: CardId[] = [...currentPlayer.deck];
      let cardsDrawn = 0;

      // Draw cards (stop if deck empties — no mid-round reshuffle)
      for (let i = 0; i < cardsToDraw && newDeck.length > 0; i++) {
        const drawnCard = newDeck.shift();
        if (drawnCard) {
          newHand.push(drawnCard);
          cardsDrawn++;
        }
      }

      // Reset current player's turn state with card flow updates
      const resetPlayer: Player = {
        ...currentPlayer,
        // Existing resets
        movePoints: 0,
        influencePoints: 0,
        hasMovedThisTurn: false,
        hasTakenActionThisTurn: false,
        pureMana: [],
        usedManaFromSource: false,
        // Card flow updates
        playArea: clearedPlayArea,
        hand: newHand,
        deck: newDeck,
        discard: newDiscard,
        // Reset combat accumulator
        combatAccumulator: {
          attack: { normal: 0, ranged: 0, siege: 0 },
          block: 0,
        },
      };

      const updatedPlayers: Player[] = [...state.players];
      updatedPlayers[playerIndex] = resetPlayer;

      // Expire turn-duration modifiers
      let newState = expireModifiers(
        { ...state, players: updatedPlayers },
        { type: EXPIRATION_TURN_END, playerId: params.playerId }
      );

      // Advance to next player
      const nextPlayerIndex =
        (state.currentPlayerIndex + 1) % state.turnOrder.length;
      const isNewRound =
        nextPlayerIndex === 0 && state.currentPlayerIndex !== 0;

      const nextPlayerId = state.turnOrder[nextPlayerIndex] ?? null;

      newState = {
        ...newState,
        currentPlayerIndex: nextPlayerIndex,
      };

      // Handle round end: reshuffle all players' decks
      if (isNewRound) {
        const reshuffledPlayers = newState.players.map((player) => {
          // Gather all cards: hand + discard + deck + play area
          const allCards: CardId[] = [
            ...player.hand,
            ...player.discard,
            ...player.deck,
            ...player.playArea,
          ];
          const shuffledDeck = shuffle(allCards);
          const playerHandLimit = player.handLimit;
          const freshHand = shuffledDeck.slice(0, playerHandLimit);
          const remainingDeck = shuffledDeck.slice(playerHandLimit);

          return {
            ...player,
            hand: freshHand,
            deck: remainingDeck,
            discard: [],
            playArea: [],
          };
        });

        newState = {
          ...newState,
          players: reshuffledPlayers,
          round: state.round + 1,
        };
      }

      // Give next player their starting move points (TEMPORARY - should come from cards)
      if (nextPlayerId) {
        const nextPlayerIdx = newState.players.findIndex(
          (p) => p.id === nextPlayerId
        );
        if (nextPlayerIdx !== -1) {
          const nextPlayer = newState.players[nextPlayerIdx];
          if (nextPlayer) {
            const updatedNextPlayer: Player = {
              ...nextPlayer,
              movePoints: 4, // TEMPORARY
            };
            const players: Player[] = [...newState.players];
            players[nextPlayerIdx] = updatedNextPlayer;
            newState = { ...newState, players };
          }
        }
      }

      const events: GameEvent[] = [
        {
          type: TURN_ENDED,
          playerId: params.playerId,
          nextPlayerId,
          cardsDiscarded: playAreaCards.length,
          cardsDrawn,
        },
      ];

      // Add ROUND_ENDED event if transitioning rounds
      if (isNewRound) {
        events.push({
          type: ROUND_ENDED,
          round: state.round,
        });
      }

      return { state: newState, events };
    },

    undo(_state: GameState): CommandResult {
      throw new Error("Cannot undo END_TURN");
    },
  };
}
