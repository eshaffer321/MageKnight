/**
 * Command pattern for undo support
 *
 * Players can undo actions during their turn until an irreversible event happens
 * (tile revealed, enemy drawn, die rolled). Commands know how to execute and undo.
 */

import type { GameState } from "../state/GameState.js";
import type { GameEvent } from "@mage-knight/shared";

// Result of executing or undoing a command
export interface CommandResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

// Base command interface
export interface Command {
  readonly type: string;
  readonly playerId: string;
  readonly isReversible: boolean;

  // Execute the command, return new state and events
  execute(state: GameState): CommandResult;

  // Undo the command, return previous state and undo events
  undo(state: GameState): CommandResult;
}

// Marks the point where undo is no longer possible
export interface UndoCheckpoint {
  readonly reason:
    | "tile_revealed"
    | "enemy_drawn"
    | "card_drawn"
    | "die_rolled"
    | "player_reacted";
  readonly timestamp: number;
}
