/**
 * Modifier system types for Mage Knight
 *
 * Skills, cards, and units can modify game rules and values for various durations.
 * This system tracks active modifiers and allows calculations to query effective values.
 */

import type { SkillId, CardId, Terrain } from "@mage-knight/shared";
import type { EnemyAbility } from "./enemy.js";

// === Duration and Scope ===

export type ModifierDuration =
  | "turn" // expires at end of current player's turn
  | "combat" // expires when combat ends
  | "round" // expires at end of round
  | "until_next_turn" // expires at START of the source player's next turn (interactive skills)
  | "permanent"; // never expires automatically

export type ModifierScope =
  | { readonly type: "self" }
  | { readonly type: "one_enemy"; readonly enemyId: string }
  | { readonly type: "all_enemies" }
  | { readonly type: "one_unit"; readonly unitIndex: number }
  | { readonly type: "all_units" }
  | { readonly type: "other_players" }
  | { readonly type: "all_players" };

// === Modifier Source ===

export type ModifierSource =
  | { readonly type: "skill"; readonly skillId: SkillId; readonly playerId: string }
  | { readonly type: "card"; readonly cardId: CardId; readonly playerId: string }
  | { readonly type: "unit"; readonly unitIndex: number; readonly playerId: string }
  | { readonly type: "site"; readonly siteType: string }
  | { readonly type: "tactic"; readonly tacticId: string; readonly playerId: string };

// === Modifier Effects ===

// Terrain cost modifier (e.g., "forest costs 1 less")
export interface TerrainCostModifier {
  readonly type: "terrain_cost";
  readonly terrain: Terrain | "all";
  readonly amount: number; // negative = reduction
  readonly minimum: number; // usually 0 or 2
}

// Sideways card value modifier (e.g., "+2 instead of +1")
export interface SidewaysValueModifier {
  readonly type: "sideways_value";
  readonly newValue: number; // typically 2, 3, or 4
  readonly forWounds: boolean; // Power of Pain allows wounds
  readonly condition?: "no_mana_used" | "with_mana_matching_color";
}

// Combat value modifier (e.g., "+2 Attack")
export interface CombatValueModifier {
  readonly type: "combat_value";
  readonly valueType: "attack" | "block" | "ranged" | "siege";
  readonly element?: "fire" | "ice" | "cold_fire" | "physical";
  readonly amount: number;
}

// Enemy stat modifier (e.g., "enemy gets -1 Armor")
export interface EnemyStatModifier {
  readonly type: "enemy_stat";
  readonly stat: "armor" | "attack";
  readonly amount: number;
  readonly minimum: number; // usually 1
  readonly perResistance?: boolean; // Resistance Break: -1 per resistance
}

// Rule override modifier (e.g., "ignore fortification")
export interface RuleOverrideModifier {
  readonly type: "rule_override";
  readonly rule:
    | "ignore_fortification"
    | "ignore_rampaging_provoke"
    | "wounds_playable_sideways"
    | "gold_as_black"
    | "black_as_gold"
    | "terrain_day_night_swap"
    | "source_blocked";
}

// Ability nullifier (e.g., "ignore Swift on one enemy")
export interface AbilityNullifierModifier {
  readonly type: "ability_nullifier";
  readonly ability: EnemyAbility["type"] | "any";
}

// Union of all modifier effects
export type ModifierEffect =
  | TerrainCostModifier
  | SidewaysValueModifier
  | CombatValueModifier
  | EnemyStatModifier
  | RuleOverrideModifier
  | AbilityNullifierModifier;

// === Active Modifier (live in game state) ===

export interface ActiveModifier {
  readonly id: string; // unique identifier
  readonly source: ModifierSource;
  readonly duration: ModifierDuration;
  readonly scope: ModifierScope;
  readonly effect: ModifierEffect;
  readonly createdAtRound: number;
  readonly createdByPlayerId: string;
}
