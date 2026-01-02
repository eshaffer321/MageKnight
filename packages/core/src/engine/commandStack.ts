/**
 * Command stack for tracking undoable actions
 *
 * The stack is per-game (not per-player) since only the current player can undo.
 * When a turn ends, the command stack should be cleared.
 */

import type { Command, UndoCheckpoint } from "./commands.js";
import {
  DRAW_CARD_COMMAND,
  DRAW_ENEMY_COMMAND,
  REVEAL_TILE_COMMAND,
  ROLL_DIE_COMMAND,
} from "./commands/commandTypes.js";
import {
  CHECKPOINT_REASON_CARD_DRAWN,
  CHECKPOINT_REASON_DIE_ROLLED,
  CHECKPOINT_REASON_ENEMY_DRAWN,
  CHECKPOINT_REASON_TILE_REVEALED,
} from "./commands.js";

export interface CommandStackState {
  readonly commands: readonly Command[];
  readonly checkpoint: UndoCheckpoint | null; // if set, can't undo past this
}

export function createEmptyCommandStack(): CommandStackState {
  return {
    commands: [],
    checkpoint: null,
  };
}

/**
 * Push a command onto the stack after execution.
 * If command is irreversible, sets checkpoint and clears stack.
 */
export function pushCommand(
  stack: CommandStackState,
  command: Command
): CommandStackState {
  // If command is irreversible, set checkpoint and clear stack
  if (!command.isReversible) {
    return {
      commands: [],
      checkpoint: {
        reason: getCheckpointReason(command.type),
        timestamp: Date.now(),
      },
    };
  }

  return {
    ...stack,
    commands: [...stack.commands, command],
  };
}

/**
 * Pop and return the last command from the stack.
 * Returns null if stack is empty.
 */
export function popCommand(stack: CommandStackState): {
  stack: CommandStackState;
  command: Command | null;
} {
  if (stack.commands.length === 0) {
    return { stack, command: null };
  }

  const newCommands = stack.commands.slice(0, -1);
  // We know command exists because we checked length > 0 above
  const command = stack.commands[stack.commands.length - 1] as Command;

  return {
    stack: { ...stack, commands: newCommands },
    command,
  };
}

/**
 * Check if undo is possible.
 */
export function canUndo(stack: CommandStackState): boolean {
  return stack.commands.length > 0;
}

/**
 * Clear the stack (called at end of turn).
 */
export function clearCommandStack(
  _stack: CommandStackState
): CommandStackState {
  return createEmptyCommandStack();
}

/**
 * Helper to determine checkpoint reason from command type.
 */
function getCheckpointReason(commandType: string): UndoCheckpoint["reason"] {
  switch (commandType) {
    case REVEAL_TILE_COMMAND:
      return CHECKPOINT_REASON_TILE_REVEALED;
    case DRAW_ENEMY_COMMAND:
      return CHECKPOINT_REASON_ENEMY_DRAWN;
    case DRAW_CARD_COMMAND:
      return CHECKPOINT_REASON_CARD_DRAWN;
    case ROLL_DIE_COMMAND:
      return CHECKPOINT_REASON_DIE_ROLLED;
    default:
      return CHECKPOINT_REASON_TILE_REVEALED; // fallback
  }
}
