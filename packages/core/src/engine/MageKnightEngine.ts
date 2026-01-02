/**
 * MageKnightEngine - thin orchestrator for game actions
 *
 * Uses validator registry for validation and command factory registry
 * for creating commands. Keeps this class focused on orchestration.
 */

import type { GameState } from "../state/GameState.js";
import type { PlayerAction, GameEvent } from "@mage-knight/shared";
import { validateAction } from "./validators/index.js";
import { createCommandForAction } from "./commands/index.js";
import { pushCommand, popCommand, canUndo } from "./commandStack.js";

// Result of processing an action
export interface ActionResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export class MageKnightEngine {
  // Process any player action
  processAction(
    state: GameState,
    playerId: string,
    action: PlayerAction
  ): ActionResult {
    // UNDO has special handling
    if (action.type === "UNDO") {
      return this.handleUndo(state, playerId);
    }

    // Validate
    const validation = validateAction(state, playerId, action);
    if (!validation.valid) {
      return {
        state,
        events: [
          {
            type: "INVALID_ACTION",
            playerId,
            actionType: action.type,
            reason: validation.error.message,
          },
        ],
      };
    }

    // Create command
    const command = createCommandForAction(state, playerId, action);
    if (!command) {
      return {
        state,
        events: [
          {
            type: "INVALID_ACTION",
            playerId,
            actionType: action.type,
            reason: "Action not implemented",
          },
        ],
      };
    }

    // Execute
    const result = command.execute(state);

    // Update command stack
    const newCommandStack = pushCommand(state.commandStack, command);

    // Build events
    const events: GameEvent[] = [...result.events];
    if (!command.isReversible) {
      events.push({
        type: "UNDO_CHECKPOINT_SET",
        playerId,
        reason: command.type,
      });
    }

    return {
      state: {
        ...result.state,
        commandStack: newCommandStack,
      },
      events,
    };
  }

  // Handle UNDO action
  private handleUndo(state: GameState, playerId: string): ActionResult {
    // Check it's this player's turn
    const currentPlayerId = state.turnOrder[state.currentPlayerIndex];
    if (currentPlayerId !== playerId) {
      return {
        state,
        events: [
          {
            type: "UNDO_FAILED",
            playerId,
            reason: "not_your_turn",
          },
        ],
      };
    }

    // Check undo is possible
    if (!canUndo(state.commandStack)) {
      return {
        state,
        events: [
          {
            type: "UNDO_FAILED",
            playerId,
            reason: state.commandStack.checkpoint
              ? "checkpoint_reached"
              : "nothing_to_undo",
          },
        ],
      };
    }

    // Pop and undo
    const { stack: newStack, command } = popCommand(state.commandStack);
    if (!command) {
      return {
        state,
        events: [
          {
            type: "UNDO_FAILED",
            playerId,
            reason: "nothing_to_undo",
          },
        ],
      };
    }

    const result = command.undo(state);

    return {
      state: {
        ...result.state,
        commandStack: newStack,
      },
      events: result.events,
    };
  }
}

// Factory
export function createEngine(): MageKnightEngine {
  return new MageKnightEngine();
}
