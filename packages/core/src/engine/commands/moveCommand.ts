/**
 * Move command - handles player movement with undo support
 */

import type { Command, CommandResult } from "../commands.js";
import type { GameState } from "../../state/GameState.js";
import type { HexCoord } from "@mage-knight/shared";
import type { Player } from "../../types/player.js";

export interface MoveCommandParams {
  readonly playerId: string;
  readonly from: HexCoord;
  readonly to: HexCoord;
  readonly terrainCost: number;
  readonly hadMovedThisTurn: boolean; // capture state before this move for proper undo
}

/**
 * Create a move command.
 *
 * The terrainCost and hadMovedThisTurn are passed in because they were captured
 * at creation time. This ensures undo restores the exact previous state.
 */
export function createMoveCommand(params: MoveCommandParams): Command {
  return {
    type: "MOVE",
    playerId: params.playerId,
    isReversible: true, // movement is reversible unless it triggers a reveal

    execute(state: GameState): CommandResult {
      // Find player and update position
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
      const updatedPlayer: Player = {
        ...player,
        position: params.to,
        movePoints: player.movePoints - params.terrainCost,
        hasMovedThisTurn: true,
      };

      const updatedPlayers: Player[] = [...state.players];
      updatedPlayers[playerIndex] = updatedPlayer;

      return {
        state: { ...state, players: updatedPlayers },
        events: [
          {
            type: "PLAYER_MOVED" as const,
            playerId: params.playerId,
            from: params.from,
            to: params.to,
          },
        ],
      };
    },

    undo(state: GameState): CommandResult {
      // Find player and restore position
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
      const updatedPlayer: Player = {
        ...player,
        position: params.from,
        movePoints: player.movePoints + params.terrainCost,
        hasMovedThisTurn: params.hadMovedThisTurn,
      };

      const updatedPlayers: Player[] = [...state.players];
      updatedPlayers[playerIndex] = updatedPlayer;

      return {
        state: { ...state, players: updatedPlayers },
        events: [
          {
            type: "MOVE_UNDONE" as const,
            playerId: params.playerId,
            from: params.to, // reversed
            to: params.from,
          },
        ],
      };
    },
  };
}
