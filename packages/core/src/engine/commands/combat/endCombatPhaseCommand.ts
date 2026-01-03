/**
 * End combat phase command
 */

import type { Command, CommandResult } from "../../commands.js";
import type { GameState } from "../../../state/GameState.js";
import { COMBAT_PHASE_CHANGED, COMBAT_ENDED } from "@mage-knight/shared";
import {
  COMBAT_PHASE_RANGED_SIEGE,
  COMBAT_PHASE_BLOCK,
  COMBAT_PHASE_ASSIGN_DAMAGE,
  COMBAT_PHASE_ATTACK,
  type CombatPhase,
} from "../../../types/combat.js";

export const END_COMBAT_PHASE_COMMAND = "END_COMBAT_PHASE" as const;

function getNextPhase(current: CombatPhase): CombatPhase | null {
  switch (current) {
    case COMBAT_PHASE_RANGED_SIEGE:
      return COMBAT_PHASE_BLOCK;
    case COMBAT_PHASE_BLOCK:
      return COMBAT_PHASE_ASSIGN_DAMAGE;
    case COMBAT_PHASE_ASSIGN_DAMAGE:
      return COMBAT_PHASE_ATTACK;
    case COMBAT_PHASE_ATTACK:
      return null; // Combat ends
  }
}

export interface EndCombatPhaseCommandParams {
  readonly playerId: string;
}

export function createEndCombatPhaseCommand(
  params: EndCombatPhaseCommandParams
): Command {
  return {
    type: END_COMBAT_PHASE_COMMAND,
    playerId: params.playerId,
    isReversible: false,

    execute(state: GameState): CommandResult {
      if (!state.combat) {
        throw new Error("Not in combat");
      }

      const currentPhase = state.combat.phase;
      const nextPhase = getNextPhase(currentPhase);

      // Combat ends after Attack phase
      if (nextPhase === null) {
        const enemiesDefeated = state.combat.enemies.filter(
          (e) => e.isDefeated
        ).length;
        const enemiesSurvived = state.combat.enemies.filter(
          (e) => !e.isDefeated
        ).length;

        return {
          state: { ...state, combat: null },
          events: [
            {
              type: COMBAT_ENDED,
              victory: enemiesSurvived === 0,
              totalFameGained: state.combat.fameGained,
              enemiesDefeated,
              enemiesSurvived,
            },
          ],
        };
      }

      // Advance to next phase
      const updatedCombat = {
        ...state.combat,
        phase: nextPhase,
        attacksThisPhase: 0,
      };

      return {
        state: { ...state, combat: updatedCombat },
        events: [
          {
            type: COMBAT_PHASE_CHANGED,
            previousPhase: currentPhase,
            newPhase: nextPhase,
          },
        ],
      };
    },

    undo(_state: GameState): CommandResult {
      throw new Error("Cannot undo END_COMBAT_PHASE");
    },
  };
}
