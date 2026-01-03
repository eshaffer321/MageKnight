/**
 * Declare attack command
 */

import type { Command, CommandResult } from "../../commands.js";
import type { GameState } from "../../../state/GameState.js";
import type { CombatType, GameEvent } from "@mage-knight/shared";
import { ENEMY_DEFEATED, ATTACK_FAILED } from "@mage-knight/shared";

export const DECLARE_ATTACK_COMMAND = "DECLARE_ATTACK" as const;

export interface DeclareAttackCommandParams {
  readonly playerId: string;
  readonly targetEnemyInstanceIds: readonly string[];
  readonly attackValue: number;
  readonly attackType: CombatType;
}

export function createDeclareAttackCommand(
  params: DeclareAttackCommandParams
): Command {
  return {
    type: DECLARE_ATTACK_COMMAND,
    playerId: params.playerId,
    isReversible: false,

    execute(state: GameState): CommandResult {
      if (!state.combat) {
        throw new Error("Not in combat");
      }

      // Calculate total armor of targets
      const targets = state.combat.enemies.filter(
        (e) =>
          params.targetEnemyInstanceIds.includes(e.instanceId) && !e.isDefeated
      );

      const totalArmor = targets.reduce(
        (sum, e) => sum + e.definition.armor,
        0
      );

      // Check if attack defeats all targets
      if (params.attackValue < totalArmor) {
        // Attack failed — not enough damage
        return {
          state,
          events: [
            {
              type: ATTACK_FAILED,
              targetEnemyInstanceIds: params.targetEnemyInstanceIds,
              attackValue: params.attackValue,
              requiredAttack: totalArmor,
            },
          ],
        };
      }

      // Attack succeeded — defeat all targets
      const events: GameEvent[] = [];
      let fameGained = 0;

      const updatedEnemies = state.combat.enemies.map((e) => {
        if (
          params.targetEnemyInstanceIds.includes(e.instanceId) &&
          !e.isDefeated
        ) {
          fameGained += e.definition.fame;
          events.push({
            type: ENEMY_DEFEATED,
            enemyInstanceId: e.instanceId,
            enemyName: e.definition.name,
            fameGained: e.definition.fame,
          });
          return { ...e, isDefeated: true };
        }
        return e;
      });

      // Update player fame
      const playerIndex = state.players.findIndex(
        (p) => p.id === params.playerId
      );
      const player = state.players[playerIndex];
      if (!player) {
        throw new Error(`Player not found: ${params.playerId}`);
      }

      const updatedPlayers = state.players.map((p, i) =>
        i === playerIndex ? { ...p, fame: p.fame + fameGained } : p
      );

      const updatedCombat = {
        ...state.combat,
        enemies: updatedEnemies,
        fameGained: state.combat.fameGained + fameGained,
      };

      return {
        state: { ...state, combat: updatedCombat, players: updatedPlayers },
        events,
      };
    },

    undo(_state: GameState): CommandResult {
      throw new Error("Cannot undo DECLARE_ATTACK");
    },
  };
}
