/**
 * Reveal tile command - irreversible action that sets an undo checkpoint
 */

import type { Command, CommandResult } from "../commands.js";
import type { GameState } from "../../state/GameState.js";
import type { HexCoord } from "@mage-knight/shared";
import type { TileId } from "../../types/map.js";

export interface RevealTileCommandParams {
  readonly playerId: string;
  readonly tileId: TileId;
  readonly position: HexCoord;
}

/**
 * Create a reveal tile command.
 *
 * This is an irreversible command - you can't unsee a tile!
 * When executed, it clears the command stack and sets a checkpoint.
 */
export function createRevealTileCommand(
  params: RevealTileCommandParams
): Command {
  return {
    type: "REVEAL_TILE",
    playerId: params.playerId,
    isReversible: false, // Can't unsee a tile!

    execute(state: GameState): CommandResult {
      // TODO: Actually place tile, update map state, spawn enemies, etc.
      // For now, just the structure

      return {
        state, // would be modified
        events: [
          {
            type: "TILE_REVEALED" as const,
            playerId: params.playerId,
            tileId: params.tileId,
            position: params.position,
          },
        ],
      };
    },

    undo(_state: GameState): CommandResult {
      // This should never be called - irreversible commands clear the stack
      throw new Error("Cannot undo tile reveal");
    },
  };
}
