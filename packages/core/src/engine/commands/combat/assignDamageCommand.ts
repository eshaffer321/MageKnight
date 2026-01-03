/**
 * Assign damage command
 */

import type { Command, CommandResult } from "../../commands.js";
import type { GameState } from "../../../state/GameState.js";
import type { CardId, GameEvent } from "@mage-knight/shared";
import { DAMAGE_ASSIGNED, PLAYER_KNOCKED_OUT, CARD_WOUND } from "@mage-knight/shared";

export const ASSIGN_DAMAGE_COMMAND = "ASSIGN_DAMAGE" as const;

export interface AssignDamageCommandParams {
  readonly playerId: string;
  readonly enemyInstanceId: string;
}

export function createAssignDamageCommand(
  params: AssignDamageCommandParams
): Command {
  return {
    type: ASSIGN_DAMAGE_COMMAND,
    playerId: params.playerId,
    isReversible: false,

    execute(state: GameState): CommandResult {
      if (!state.combat) {
        throw new Error("Not in combat");
      }

      const enemy = state.combat.enemies.find(
        (e) => e.instanceId === params.enemyInstanceId
      );
      if (!enemy) {
        throw new Error(`Enemy not found: ${params.enemyInstanceId}`);
      }

      if (enemy.isBlocked || enemy.isDefeated) {
        throw new Error("Enemy is blocked or defeated");
      }

      const playerIndex = state.players.findIndex(
        (p) => p.id === params.playerId
      );
      const player = state.players[playerIndex];
      if (!player) {
        throw new Error(`Player not found: ${params.playerId}`);
      }

      // Calculate damage and wounds
      const damage = enemy.definition.attack;
      const heroArmor = player.armor; // Use player's armor (base is 2)
      const woundsTaken = Math.ceil(damage / heroArmor);

      // Add wound cards to hand
      const newWounds: CardId[] = Array(woundsTaken).fill(CARD_WOUND);
      const newHand: CardId[] = [...player.hand, ...newWounds];

      // Update wounds this combat for knockout tracking
      const totalWoundsThisCombat = state.combat.woundsThisCombat + woundsTaken;

      const events: GameEvent[] = [
        {
          type: DAMAGE_ASSIGNED,
          enemyInstanceId: params.enemyInstanceId,
          damage,
          woundsTaken,
        },
      ];

      // Check for knockout (wounds this combat >= hand limit)
      const isKnockedOut = totalWoundsThisCombat >= player.handLimit;

      let finalHand: readonly CardId[] = newHand;
      if (isKnockedOut) {
        // Discard all non-wound cards from hand
        finalHand = newHand.filter((cardId) => cardId === CARD_WOUND);
        events.push({
          type: PLAYER_KNOCKED_OUT,
          playerId: params.playerId,
          woundsThisCombat: totalWoundsThisCombat,
        });
      }

      const updatedPlayer = {
        ...player,
        hand: finalHand,
        knockedOut: isKnockedOut,
      };

      const updatedPlayers = state.players.map((p, i) =>
        i === playerIndex ? updatedPlayer : p
      );

      // Mark enemy as having damage assigned
      const updatedEnemies = state.combat.enemies.map((e) =>
        e.instanceId === params.enemyInstanceId
          ? { ...e, damageAssigned: true }
          : e
      );

      const updatedCombat = {
        ...state.combat,
        enemies: updatedEnemies,
        woundsThisCombat: totalWoundsThisCombat,
      };

      return {
        state: { ...state, combat: updatedCombat, players: updatedPlayers },
        events,
      };
    },

    undo(_state: GameState): CommandResult {
      throw new Error("Cannot undo ASSIGN_DAMAGE");
    },
  };
}
