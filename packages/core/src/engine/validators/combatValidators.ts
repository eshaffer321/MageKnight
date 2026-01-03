/**
 * Combat validators
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction } from "@mage-knight/shared";
import type { ValidationResult } from "./types.js";
import { valid, invalid } from "./types.js";
import {
  ENTER_COMBAT_ACTION,
  END_COMBAT_PHASE_ACTION,
  DECLARE_BLOCK_ACTION,
  DECLARE_ATTACK_ACTION,
  ASSIGN_DAMAGE_ACTION,
  COMBAT_TYPE_RANGED,
  COMBAT_TYPE_SIEGE,
} from "@mage-knight/shared";
import {
  COMBAT_PHASE_RANGED_SIEGE,
  COMBAT_PHASE_BLOCK,
  COMBAT_PHASE_ASSIGN_DAMAGE,
  COMBAT_PHASE_ATTACK,
} from "../../types/combat.js";
import {
  ALREADY_IN_COMBAT,
  NOT_IN_COMBAT,
  WRONG_COMBAT_PHASE,
  ENEMY_NOT_FOUND,
  ENEMY_ALREADY_BLOCKED,
  ENEMY_ALREADY_DEFEATED,
  INVALID_ATTACK_TYPE,
  DAMAGE_NOT_ASSIGNED,
} from "./validationCodes.js";

// Must not already be in combat
export function validateNotAlreadyInCombat(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== ENTER_COMBAT_ACTION) return valid();

  if (state.combat !== null) {
    return invalid(ALREADY_IN_COMBAT, "Already in combat");
  }

  return valid();
}

// Must be in combat
export function validateIsInCombat(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  const combatActions = [
    END_COMBAT_PHASE_ACTION,
    DECLARE_BLOCK_ACTION,
    DECLARE_ATTACK_ACTION,
    ASSIGN_DAMAGE_ACTION,
  ];

  if (!combatActions.includes(action.type as typeof combatActions[number])) {
    return valid();
  }

  if (state.combat === null) {
    return invalid(NOT_IN_COMBAT, "Not in combat");
  }

  return valid();
}

// Block only allowed in Block phase
export function validateBlockPhase(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== DECLARE_BLOCK_ACTION) return valid();

  if (state.combat?.phase !== COMBAT_PHASE_BLOCK) {
    return invalid(WRONG_COMBAT_PHASE, "Can only block during Block phase");
  }

  return valid();
}

// Attack allowed in Ranged/Siege and Attack phases
export function validateAttackPhase(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== DECLARE_ATTACK_ACTION) return valid();

  const validPhases = [COMBAT_PHASE_RANGED_SIEGE, COMBAT_PHASE_ATTACK];
  if (
    !validPhases.includes(
      state.combat?.phase as typeof COMBAT_PHASE_RANGED_SIEGE
    )
  ) {
    return invalid(
      WRONG_COMBAT_PHASE,
      "Can only attack during Ranged/Siege or Attack phase"
    );
  }

  return valid();
}

// Ranged/Siege attacks only in Ranged/Siege phase (but all types allowed in Attack phase)
// Per rulebook: "You can combine any Attacks: Ranged, Siege or regular."
export function validateAttackType(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== DECLARE_ATTACK_ACTION) return valid();

  const isRangedSiegePhase = state.combat?.phase === COMBAT_PHASE_RANGED_SIEGE;
  const isRangedOrSiege =
    action.attackType === COMBAT_TYPE_RANGED ||
    action.attackType === COMBAT_TYPE_SIEGE;

  // In Ranged/Siege phase, only ranged/siege attacks allowed
  if (isRangedSiegePhase && !isRangedOrSiege) {
    return invalid(
      INVALID_ATTACK_TYPE,
      "Only Ranged or Siege attacks allowed in Ranged/Siege phase"
    );
  }

  // In Attack phase, ALL attack types are allowed (ranged, siege, and normal)

  return valid();
}

// Assign damage only in Assign Damage phase
export function validateAssignDamagePhase(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== ASSIGN_DAMAGE_ACTION) return valid();

  if (state.combat?.phase !== COMBAT_PHASE_ASSIGN_DAMAGE) {
    return invalid(
      WRONG_COMBAT_PHASE,
      "Can only assign damage during Assign Damage phase"
    );
  }

  return valid();
}

// Target enemy must exist and not be defeated (for block)
export function validateBlockTargetEnemy(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== DECLARE_BLOCK_ACTION) return valid();

  const enemy = state.combat?.enemies.find(
    (e) => e.instanceId === action.targetEnemyInstanceId
  );

  if (!enemy) {
    return invalid(ENEMY_NOT_FOUND, "Target enemy not found");
  }

  if (enemy.isDefeated) {
    return invalid(ENEMY_ALREADY_DEFEATED, "Target enemy is already defeated");
  }

  if (enemy.isBlocked) {
    return invalid(ENEMY_ALREADY_BLOCKED, "Target enemy is already blocked");
  }

  return valid();
}

// Target enemy must exist and not be blocked/defeated (for assign damage)
export function validateAssignDamageTargetEnemy(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== ASSIGN_DAMAGE_ACTION) return valid();

  const enemy = state.combat?.enemies.find(
    (e) => e.instanceId === action.enemyInstanceId
  );

  if (!enemy) {
    return invalid(ENEMY_NOT_FOUND, "Target enemy not found");
  }

  if (enemy.isDefeated) {
    return invalid(ENEMY_ALREADY_DEFEATED, "Target enemy is already defeated");
  }

  if (enemy.isBlocked) {
    return invalid(ENEMY_ALREADY_BLOCKED, "Enemy is blocked, no damage to assign");
  }

  return valid();
}

// Attack targets must exist and not be defeated
export function validateAttackTargets(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== DECLARE_ATTACK_ACTION) return valid();

  for (const targetId of action.targetEnemyInstanceIds) {
    const enemy = state.combat?.enemies.find((e) => e.instanceId === targetId);

    if (!enemy) {
      return invalid(ENEMY_NOT_FOUND, `Target enemy not found: ${targetId}`);
    }

    if (enemy.isDefeated) {
      return invalid(
        ENEMY_ALREADY_DEFEATED,
        `Target enemy is already defeated: ${enemy.definition.name}`
      );
    }
  }

  return valid();
}

// Cannot leave Assign Damage phase without assigning damage from all unblocked enemies
export function validateDamageAssignedBeforeLeaving(
  state: GameState,
  _playerId: string,
  action: PlayerAction
): ValidationResult {
  if (action.type !== END_COMBAT_PHASE_ACTION) return valid();

  // Only check when leaving Assign Damage phase
  if (state.combat?.phase !== COMBAT_PHASE_ASSIGN_DAMAGE) return valid();

  // Find enemies that need damage assigned (not blocked, not defeated, not already assigned)
  const unprocessedEnemies = state.combat.enemies.filter(
    (e) => !e.isDefeated && !e.isBlocked && !e.damageAssigned
  );

  if (unprocessedEnemies.length > 0) {
    const names = unprocessedEnemies.map((e) => e.definition.name).join(", ");
    return invalid(
      DAMAGE_NOT_ASSIGNED,
      `Must assign damage from all unblocked enemies before advancing: ${names}`
    );
  }

  return valid();
}
