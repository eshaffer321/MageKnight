/**
 * Command pattern for undo support
 *
 * Players can undo actions during their turn until an irreversible event happens
 * (tile revealed, enemy drawn, die rolled). Commands know how to execute and undo.
 */

import type { GameState } from "../state/GameState.js";
import type { GameEvent } from "@mage-knight/shared";

export const CHECKPOINT_REASON_TILE_REVEALED = "tile_revealed" as const;
export const CHECKPOINT_REASON_ENEMY_DRAWN = "enemy_drawn" as const;
export const CHECKPOINT_REASON_CARD_DRAWN = "card_drawn" as const;
export const CHECKPOINT_REASON_DIE_ROLLED = "die_rolled" as const;
export const CHECKPOINT_REASON_PLAYER_REACTED = "player_reacted" as const;

export type CheckpointReason =
  | typeof CHECKPOINT_REASON_TILE_REVEALED
  | typeof CHECKPOINT_REASON_ENEMY_DRAWN
  | typeof CHECKPOINT_REASON_CARD_DRAWN
  | typeof CHECKPOINT_REASON_DIE_ROLLED
  | typeof CHECKPOINT_REASON_PLAYER_REACTED;

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
  readonly reason: CheckpointReason;
  readonly timestamp: number;
}
