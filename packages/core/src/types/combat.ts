/**
 * Combat state types for Mage Knight
 *
 * Phase 1: Single enemy, no abilities, hero only, physical damage
 */

import type { EnemyId, EnemyDefinition } from "@mage-knight/shared";
import { getEnemy } from "@mage-knight/shared";
import type { CombatType } from "@mage-knight/shared";

// Combat phase constants
export const COMBAT_PHASE_RANGED_SIEGE = "ranged_siege" as const;
export const COMBAT_PHASE_BLOCK = "block" as const;
export const COMBAT_PHASE_ASSIGN_DAMAGE = "assign_damage" as const;
export const COMBAT_PHASE_ATTACK = "attack" as const;

export type CombatPhase =
  | typeof COMBAT_PHASE_RANGED_SIEGE
  | typeof COMBAT_PHASE_BLOCK
  | typeof COMBAT_PHASE_ASSIGN_DAMAGE
  | typeof COMBAT_PHASE_ATTACK;

// Combat attack type (method) - reuses shared CombatType
export type CombatAttackType = CombatType;

// Enemy instance in combat (tracks state during fight)
export interface CombatEnemy {
  readonly instanceId: string; // Unique ID for this combat instance
  readonly enemyId: EnemyId;
  readonly definition: EnemyDefinition;
  readonly isBlocked: boolean;
  readonly isDefeated: boolean;
  readonly damageAssigned: boolean; // Track if damage was processed in Assign Damage phase
}

// Combat state
export interface CombatState {
  readonly phase: CombatPhase;
  readonly enemies: readonly CombatEnemy[];
  readonly woundsThisCombat: number; // Track for knockout
  readonly attacksThisPhase: number; // Track attacks made
  readonly fameGained: number; // Accumulated fame from defeated enemies
  readonly isAtFortifiedSite: boolean; // Site fortification (Keeps, Mage Towers, Cities)
}

// Create initial combat state
export function createCombatState(
  enemyIds: readonly EnemyId[],
  isAtFortifiedSite: boolean = false
): CombatState {
  const enemies: CombatEnemy[] = enemyIds.map((enemyId, index) => ({
    instanceId: `enemy_${index}`,
    enemyId,
    definition: getEnemy(enemyId),
    isBlocked: false,
    isDefeated: false,
    damageAssigned: false,
  }));

  return {
    phase: COMBAT_PHASE_RANGED_SIEGE,
    enemies,
    woundsThisCombat: 0,
    attacksThisPhase: 0,
    fameGained: 0,
    isAtFortifiedSite,
  };
}
