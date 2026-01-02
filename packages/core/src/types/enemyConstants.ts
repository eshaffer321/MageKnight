/**
 * Enemy-related constants (single source of truth for string literal unions).
 */

// Enemy colors (token back colors)
export const ENEMY_COLOR_GREEN = "green" as const;
export const ENEMY_COLOR_RED = "red" as const;
export const ENEMY_COLOR_BROWN = "brown" as const;
export const ENEMY_COLOR_VIOLET = "violet" as const;
export const ENEMY_COLOR_GRAY = "gray" as const;
export const ENEMY_COLOR_WHITE = "white" as const;

// Attack types
export const ATTACK_TYPE_PHYSICAL = "physical" as const;
export const ATTACK_TYPE_FIRE = "fire" as const;
export const ATTACK_TYPE_ICE = "ice" as const;
export const ATTACK_TYPE_COLD_FIRE = "cold_fire" as const;

// Enemy ability discriminator values
export const ENEMY_ABILITY_FORTIFIED = "fortified" as const;
export const ENEMY_ABILITY_SWIFT = "swift" as const;
export const ENEMY_ABILITY_BRUTAL = "brutal" as const;
export const ENEMY_ABILITY_POISON = "poison" as const;
export const ENEMY_ABILITY_PARALYZE = "paralyze" as const;
export const ENEMY_ABILITY_SUMMON = "summon" as const;
export const ENEMY_ABILITY_RESISTANCE = "resistance" as const;

// Resistance element values (subset of attack types)
export const RESISTANCE_ELEMENT_PHYSICAL = "physical" as const;
export const RESISTANCE_ELEMENT_FIRE = "fire" as const;
export const RESISTANCE_ELEMENT_ICE = "ice" as const;


