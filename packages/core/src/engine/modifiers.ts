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
} from "../types/modifiers.js";
import type { Terrain } from "@mage-knight/shared";
import { DEFAULT_MOVEMENT_COSTS } from "@mage-knight/shared";

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
    if (scope.type === "self") {
      return m.createdByPlayerId === playerId;
    }
    if (scope.type === "all_players") {
      return true;
    }
    if (scope.type === "other_players") {
      return m.createdByPlayerId !== playerId;
    }
    // For enemy/unit scopes, check if this player owns the context
    return m.createdByPlayerId === playerId;
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
      m.effect.type === "rule_override" &&
      m.effect.rule === "terrain_day_night_swap"
  );

  if (swapModifiers.length > 0) {
    // Use opposite time of day costs
    cost = state.timeOfDay === "day" ? baseCosts.night : baseCosts.day;
  }

  // Apply terrain cost modifiers
  const terrainModifiers = getModifiersForPlayer(state, playerId)
    .filter((m) => m.effect.type === "terrain_cost")
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
    .filter((m) => m.effect.type === "sideways_value")
    .map((m) => m.effect as SidewaysValueModifier);

  let bestValue = baseValue;

  for (const mod of modifiers) {
    // Check if this modifier applies
    if (isWound && !mod.forWounds) continue;

    if (mod.condition === "no_mana_used" && manaUsedThisTurn) continue;

    if (mod.condition === "with_mana_matching_color" && !manaColorMatchesCard)
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
    (m) => m.effect.type === "rule_override" && m.effect.rule === rule
  );
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
  | { readonly type: "turn_end"; readonly playerId: string }
  | { readonly type: "combat_end" }
  | { readonly type: "round_end" }
  | { readonly type: "turn_start"; readonly playerId: string }; // for "until_next_turn" modifiers

/**
 * Expire modifiers based on a game event trigger.
 */
export function expireModifiers(
  state: GameState,
  trigger: ExpirationTrigger
): GameState {
  const remaining = state.activeModifiers.filter((m) => {
    switch (trigger.type) {
      case "turn_end":
        // Expire "turn" duration modifiers from this player
        if (
          m.duration === "turn" &&
          m.createdByPlayerId === trigger.playerId
        ) {
          return false;
        }
        return true;

      case "combat_end":
        return m.duration !== "combat";

      case "round_end":
        return m.duration !== "round";

      case "turn_start":
        // Expire "until_next_turn" modifiers when their creator's turn starts
        if (
          m.duration === "until_next_turn" &&
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
