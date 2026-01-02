/**
 * Modifier query and lifecycle functions
 *
 * Every calculation in the game should use these "effective value" functions,
 * not raw table lookups. This ensures modifiers are always applied correctly.
 */

import type { GameState } from "../state/GameState.js";
import type {
  ActiveModifier,
  TerrainCostModifier,
  SidewaysValueModifier,
  RuleOverrideModifier,
  EnemyStatModifier,
} from "../types/modifiers.js";
import type { Terrain } from "@mage-knight/shared";
import { DEFAULT_MOVEMENT_COSTS } from "@mage-knight/shared";
import {
  DURATION_COMBAT,
  DURATION_ROUND,
  DURATION_TURN,
  DURATION_UNTIL_NEXT_TURN,
  EFFECT_ENEMY_STAT,
  EFFECT_RULE_OVERRIDE,
  EFFECT_SIDEWAYS_VALUE,
  EFFECT_TERRAIN_COST,
  ENEMY_STAT_ARMOR,
  ENEMY_STAT_ATTACK,
  EXPIRATION_COMBAT_END,
  EXPIRATION_ROUND_END,
  EXPIRATION_TURN_END,
  EXPIRATION_TURN_START,
  RULE_TERRAIN_DAY_NIGHT_SWAP,
  SCOPE_ALL_ENEMIES,
  SCOPE_ALL_PLAYERS,
  SCOPE_ONE_ENEMY,
  SCOPE_OTHER_PLAYERS,
  SCOPE_SELF,
  SIDEWAYS_CONDITION_NO_MANA_USED,
  SIDEWAYS_CONDITION_WITH_MANA_MATCHING_COLOR,
} from "./modifierConstants.js";

// === Query helpers ===

/**
 * Get all active modifiers of a specific effect type.
 */
export function getModifiersOfType<T extends ActiveModifier["effect"]["type"]>(
  state: GameState,
  effectType: T
): ActiveModifier[] {
  return state.activeModifiers.filter((m) => m.effect.type === effectType);
}

/**
 * Get modifiers that apply to a specific player.
 */
export function getModifiersForPlayer(
  state: GameState,
  playerId: string
): ActiveModifier[] {
  return state.activeModifiers.filter((m) => {
    const scope = m.scope;
    if (scope.type === SCOPE_SELF) {
      return m.createdByPlayerId === playerId;
    }
    if (scope.type === SCOPE_ALL_PLAYERS) {
      return true;
    }
    if (scope.type === SCOPE_OTHER_PLAYERS) {
      return m.createdByPlayerId !== playerId;
    }
    // For enemy/unit scopes, check if this player owns the context
    return m.createdByPlayerId === playerId;
  });
}

/**
 * Get all modifiers targeting a specific enemy.
 */
export function getModifiersForEnemy(
  state: GameState,
  enemyId: string
): ActiveModifier[] {
  return state.activeModifiers.filter((m) => {
    if (m.scope.type === SCOPE_ONE_ENEMY && m.scope.enemyId === enemyId)
      return true;
    if (m.scope.type === SCOPE_ALL_ENEMIES) return true;
    return false;
  });
}

// === Effective value calculations ===

/**
 * Get effective terrain cost for a player entering a hex.
 */
export function getEffectiveTerrainCost(
  state: GameState,
  terrain: Terrain,
  playerId: string
): number {
  // Base cost from time of day
  const baseCosts = DEFAULT_MOVEMENT_COSTS[terrain];
  if (!baseCosts) return Infinity;

  let cost = state.timeOfDay === "day" ? baseCosts.day : baseCosts.night;

  // Check for day/night swap rule
  const swapModifiers = getModifiersForPlayer(state, playerId).filter(
    (m) =>
      m.effect.type === EFFECT_RULE_OVERRIDE &&
      m.effect.rule === RULE_TERRAIN_DAY_NIGHT_SWAP
  );

  if (swapModifiers.length > 0) {
    // Use opposite time of day costs
    cost = state.timeOfDay === "day" ? baseCosts.night : baseCosts.day;
  }

  // Apply terrain cost modifiers
  const terrainModifiers = getModifiersForPlayer(state, playerId)
    .filter((m) => m.effect.type === EFFECT_TERRAIN_COST)
    .map((m) => m.effect as TerrainCostModifier)
    .filter((e) => e.terrain === terrain || e.terrain === "all");

  let minAllowed = 0;
  for (const mod of terrainModifiers) {
    cost += mod.amount;
    minAllowed = Math.max(minAllowed, mod.minimum);
  }

  return Math.max(minAllowed, cost);
}

/**
 * Get effective sideways card value for a player.
 */
export function getEffectiveSidewaysValue(
  state: GameState,
  playerId: string,
  isWound: boolean,
  manaUsedThisTurn: boolean,
  manaColorMatchesCard?: boolean
): number {
  const baseValue = 1;

  const modifiers = getModifiersForPlayer(state, playerId)
    .filter((m) => m.effect.type === EFFECT_SIDEWAYS_VALUE)
    .map((m) => m.effect as SidewaysValueModifier);

  let bestValue = baseValue;

  for (const mod of modifiers) {
    // Check if this modifier applies
    if (isWound && !mod.forWounds) continue;

    if (mod.condition === SIDEWAYS_CONDITION_NO_MANA_USED && manaUsedThisTurn)
      continue;

    if (
      mod.condition === SIDEWAYS_CONDITION_WITH_MANA_MATCHING_COLOR &&
      !manaColorMatchesCard
    )
      continue;

    bestValue = Math.max(bestValue, mod.newValue);
  }

  return bestValue;
}

/**
 * Check if a rule override is active for a player.
 */
export function isRuleActive(
  state: GameState,
  playerId: string,
  rule: RuleOverrideModifier["rule"]
): boolean {
  return getModifiersForPlayer(state, playerId).some(
    (m) => m.effect.type === EFFECT_RULE_OVERRIDE && m.effect.rule === rule
  );
}

/**
 * Get effective enemy armor after modifiers.
 * @param resistanceCount - number of resistances the enemy has (for Resistance Break)
 */
export function getEffectiveEnemyArmor(
  state: GameState,
  enemyId: string,
  baseArmor: number,
  resistanceCount: number
): number {
  const modifiers = getModifiersForEnemy(state, enemyId)
    .filter(
      (m) => m.effect.type === EFFECT_ENEMY_STAT && m.effect.stat === ENEMY_STAT_ARMOR
    )
    .map((m) => m.effect as EnemyStatModifier);

  let armor = baseArmor;
  let minAllowed = 1;

  for (const mod of modifiers) {
    if (mod.perResistance) {
      // Resistance Break: -1 per resistance
      armor += mod.amount * resistanceCount;
    } else {
      armor += mod.amount;
    }
    minAllowed = Math.max(minAllowed, mod.minimum);
  }

  return Math.max(minAllowed, armor);
}

/**
 * Get effective enemy attack after modifiers.
 */
export function getEffectiveEnemyAttack(
  state: GameState,
  enemyId: string,
  baseAttack: number
): number {
  const modifiers = getModifiersForEnemy(state, enemyId)
    .filter(
      (m) =>
        m.effect.type === EFFECT_ENEMY_STAT && m.effect.stat === ENEMY_STAT_ATTACK
    )
    .map((m) => m.effect as EnemyStatModifier);

  let attack = baseAttack;
  let minAllowed = 1;

  for (const mod of modifiers) {
    attack += mod.amount;
    minAllowed = Math.max(minAllowed, mod.minimum);
  }

  return Math.max(minAllowed, attack);
}

// === Modifier lifecycle ===

/**
 * Add a modifier to game state (returns new state).
 */
export function addModifier(
  state: GameState,
  modifier: Omit<ActiveModifier, "id">
): GameState {
  const id = `mod_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const newModifier: ActiveModifier = { ...modifier, id };

  return {
    ...state,
    activeModifiers: [...state.activeModifiers, newModifier],
  };
}

/**
 * Remove a specific modifier by ID.
 */
export function removeModifier(
  state: GameState,
  modifierId: string
): GameState {
  return {
    ...state,
    activeModifiers: state.activeModifiers.filter((m) => m.id !== modifierId),
  };
}

// === Expiration ===

export type ExpirationTrigger =
  | { readonly type: typeof EXPIRATION_TURN_END; readonly playerId: string }
  | { readonly type: typeof EXPIRATION_COMBAT_END }
  | { readonly type: typeof EXPIRATION_ROUND_END }
  | { readonly type: typeof EXPIRATION_TURN_START; readonly playerId: string }; // for "until_next_turn" modifiers

/**
 * Expire modifiers based on a game event trigger.
 */
export function expireModifiers(
  state: GameState,
  trigger: ExpirationTrigger
): GameState {
  const remaining = state.activeModifiers.filter((m) => {
    switch (trigger.type) {
      case EXPIRATION_TURN_END:
        // Expire "turn" duration modifiers from this player
        if (
          m.duration === DURATION_TURN &&
          m.createdByPlayerId === trigger.playerId
        ) {
          return false;
        }
        return true;

      case EXPIRATION_COMBAT_END:
        return m.duration !== DURATION_COMBAT;

      case EXPIRATION_ROUND_END:
        return m.duration !== DURATION_ROUND;

      case EXPIRATION_TURN_START:
        // Expire "until_next_turn" modifiers when their creator's turn starts
        if (
          m.duration === DURATION_UNTIL_NEXT_TURN &&
          m.createdByPlayerId === trigger.playerId
        ) {
          return false;
        }
        return true;

      default:
        return true;
    }
  });

  return {
    ...state,
    activeModifiers: remaining,
  };
}
