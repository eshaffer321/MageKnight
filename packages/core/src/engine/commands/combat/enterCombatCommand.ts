/**
 * Enter combat command
 */

import type { Command, CommandResult } from "../../commands.js";
import type { GameState } from "../../../state/GameState.js";
import type { EnemyId } from "@mage-knight/shared";
import { COMBAT_STARTED } from "@mage-knight/shared";
import { createCombatState } from "../../../types/combat.js";

export const ENTER_COMBAT_COMMAND = "ENTER_COMBAT" as const;

export interface EnterCombatCommandParams {
  readonly playerId: string;
  readonly enemyIds: readonly EnemyId[];
}

export function createEnterCombatCommand(
  params: EnterCombatCommandParams
): Command {
  return {
    type: ENTER_COMBAT_COMMAND,
    playerId: params.playerId,
    isReversible: false, // Combat is irreversible once started (enemies revealed)

    execute(state: GameState): CommandResult {
      const combat = createCombatState(params.enemyIds);

      return {
        state: { ...state, combat },
        events: [
          {
            type: COMBAT_STARTED,
            playerId: params.playerId,
            enemies: combat.enemies.map((e) => ({
              instanceId: e.instanceId,
              name: e.definition.name,
              attack: e.definition.attack,
              armor: e.definition.armor,
            })),
          },
        ],
      };
    },

    undo(_state: GameState): CommandResult {
      throw new Error("Cannot undo ENTER_COMBAT — enemies have been revealed");
    },
  };
}
