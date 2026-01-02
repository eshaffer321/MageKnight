/**
 * Modifier system constants (single source of truth for string literal unions).
 *
 * These constants back discriminated unions in `types/modifiers.ts` via `typeof`,
 * and are also used by engine logic to avoid magic strings.
 */

// === ExpirationTrigger["type"] (engine-owned trigger, but used as string union) ===
export const EXPIRATION_TURN_END = "turn_end" as const;
export const EXPIRATION_COMBAT_END = "combat_end" as const;
export const EXPIRATION_ROUND_END = "round_end" as const;
export const EXPIRATION_TURN_START = "turn_start" as const;

// === ModifierDuration ===
export const DURATION_TURN = "turn" as const;
export const DURATION_COMBAT = "combat" as const;
export const DURATION_ROUND = "round" as const;
export const DURATION_UNTIL_NEXT_TURN = "until_next_turn" as const;
export const DURATION_PERMANENT = "permanent" as const;

// === ModifierScope["type"] ===
export const SCOPE_SELF = "self" as const;
export const SCOPE_ONE_ENEMY = "one_enemy" as const;
export const SCOPE_ALL_ENEMIES = "all_enemies" as const;
export const SCOPE_ONE_UNIT = "one_unit" as const;
export const SCOPE_ALL_UNITS = "all_units" as const;
export const SCOPE_OTHER_PLAYERS = "other_players" as const;
export const SCOPE_ALL_PLAYERS = "all_players" as const;

// === ModifierSource["type"] ===
export const SOURCE_SKILL = "skill" as const;
export const SOURCE_CARD = "card" as const;
export const SOURCE_UNIT = "unit" as const;
export const SOURCE_SITE = "site" as const;
export const SOURCE_TACTIC = "tactic" as const;

// === Shared convenience markers ===
export const TERRAIN_ALL = "all" as const;

// === ModifierEffect["type"] ===
export const EFFECT_TERRAIN_COST = "terrain_cost" as const;
export const EFFECT_SIDEWAYS_VALUE = "sideways_value" as const;
export const EFFECT_COMBAT_VALUE = "combat_value" as const;
export const EFFECT_ENEMY_STAT = "enemy_stat" as const;
export const EFFECT_RULE_OVERRIDE = "rule_override" as const;
export const EFFECT_ABILITY_NULLIFIER = "ability_nullifier" as const;

// === SidewaysValueModifier["condition"] ===
export const SIDEWAYS_CONDITION_NO_MANA_USED = "no_mana_used" as const;
export const SIDEWAYS_CONDITION_WITH_MANA_MATCHING_COLOR =
  "with_mana_matching_color" as const;

// === CombatValueModifier["valueType"] ===
export const COMBAT_VALUE_ATTACK = "attack" as const;
export const COMBAT_VALUE_BLOCK = "block" as const;
export const COMBAT_VALUE_RANGED = "ranged" as const;
export const COMBAT_VALUE_SIEGE = "siege" as const;

// === CombatValueModifier["element"] ===
export const ELEMENT_FIRE = "fire" as const;
export const ELEMENT_ICE = "ice" as const;
export const ELEMENT_COLD_FIRE = "cold_fire" as const;
export const ELEMENT_PHYSICAL = "physical" as const;

// === EnemyStatModifier["stat"] ===
export const ENEMY_STAT_ARMOR = "armor" as const;
export const ENEMY_STAT_ATTACK = "attack" as const;

// === RuleOverrideModifier["rule"] ===
export const RULE_IGNORE_FORTIFICATION = "ignore_fortification" as const;
export const RULE_IGNORE_RAMPAGING_PROVOKE = "ignore_rampaging_provoke" as const;
export const RULE_WOUNDS_PLAYABLE_SIDEWAYS = "wounds_playable_sideways" as const;
export const RULE_GOLD_AS_BLACK = "gold_as_black" as const;
export const RULE_BLACK_AS_GOLD = "black_as_gold" as const;
export const RULE_TERRAIN_DAY_NIGHT_SWAP = "terrain_day_night_swap" as const;
export const RULE_SOURCE_BLOCKED = "source_blocked" as const;

// === AbilityNullifierModifier ===
export const ABILITY_ANY = "any" as const;


