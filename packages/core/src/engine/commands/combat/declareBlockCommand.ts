/**
 * Declare block command
 */

import type { Command, CommandResult } from "../../commands.js";
import type { GameState } from "../../../state/GameState.js";
import { ENEMY_BLOCKED, BLOCK_FAILED } from "@mage-knight/shared";

export const DECLARE_BLOCK_COMMAND = "DECLARE_BLOCK" as const;

export interface DeclareBlockCommandParams {
  readonly playerId: string;
  readonly targetEnemyInstanceId: string;
  readonly blockValue: number;
}

export function createDeclareBlockCommand(
  params: DeclareBlockCommandParams
): Command {
  return {
    type: DECLARE_BLOCK_COMMAND,
    playerId: params.playerId,
    isReversible: false, // Can't un-block once committed

    execute(state: GameState): CommandResult {
      if (!state.combat) {
        throw new Error("Not in combat");
      }

      const enemy = state.combat.enemies.find(
        (e) => e.instanceId === params.targetEnemyInstanceId
      );
      if (!enemy) {
        throw new Error(`Enemy not found: ${params.targetEnemyInstanceId}`);
      }

      // Check if block is sufficient (Block >= Attack)
      const isSuccessful = params.blockValue >= enemy.definition.attack;

      if (!isSuccessful) {
        // Block failed — no effect, but still consumed
        return {
          state,
          events: [
            {
              type: BLOCK_FAILED,
              enemyInstanceId: params.targetEnemyInstanceId,
              blockValue: params.blockValue,
              requiredBlock: enemy.definition.attack,
            },
          ],
        };
      }

      // Block succeeded — mark enemy as blocked
      const updatedEnemies = state.combat.enemies.map((e) =>
        e.instanceId === params.targetEnemyInstanceId
          ? { ...e, isBlocked: true }
          : e
      );

      const updatedCombat = {
        ...state.combat,
        enemies: updatedEnemies,
      };

      return {
        state: { ...state, combat: updatedCombat },
        events: [
          {
            type: ENEMY_BLOCKED,
            enemyInstanceId: params.targetEnemyInstanceId,
            blockValue: params.blockValue,
          },
        ],
      };
    },

    undo(_state: GameState): CommandResult {
      throw new Error("Cannot undo DECLARE_BLOCK");
    },
  };
}
