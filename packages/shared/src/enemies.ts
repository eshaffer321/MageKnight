/**
 * Enemy definitions for Mage Knight
 *
 * Data extracted from Mage Knight Plus TTS mod
 * https://steamcommunity.com/sharedfiles/filedetails/?id=2127352568
 */

import {
  ELEMENT_PHYSICAL,
  ELEMENT_FIRE,
  ELEMENT_ICE,
  ELEMENT_COLD_FIRE,
  type Element,
} from "./elements.js";

// Enemy color constants (token back colors)
export const ENEMY_COLOR_GREEN = "green" as const; // Marauding Orcs
export const ENEMY_COLOR_GRAY = "gray" as const; // Keep garrison
export const ENEMY_COLOR_BROWN = "brown" as const; // Dungeon monsters (tan in TTS)
export const ENEMY_COLOR_VIOLET = "violet" as const; // Mage Tower
export const ENEMY_COLOR_RED = "red" as const; // Draconum
export const ENEMY_COLOR_WHITE = "white" as const; // City garrison

export type EnemyColor =
  | typeof ENEMY_COLOR_GREEN
  | typeof ENEMY_COLOR_GRAY
  | typeof ENEMY_COLOR_BROWN
  | typeof ENEMY_COLOR_VIOLET
  | typeof ENEMY_COLOR_RED
  | typeof ENEMY_COLOR_WHITE;

// Re-export canonical element constants/types for convenience
export {
  ELEMENT_PHYSICAL,
  ELEMENT_FIRE,
  ELEMENT_ICE,
  ELEMENT_COLD_FIRE,
} from "./elements.js";
export type { Element } from "./elements.js";

// Enemy resistances interface
export interface EnemyResistances {
  readonly physical: boolean;
  readonly fire: boolean;
  readonly ice: boolean;
}

export const NO_RESISTANCES: EnemyResistances = {
  physical: false,
  fire: false,
  ice: false,
};

// =============================================================================
// GREEN ENEMIES (Marauding Orcs)
// =============================================================================
export const ENEMY_DIGGERS = "diggers" as const;
export const ENEMY_PROWLERS = "prowlers" as const;
export const ENEMY_CURSED_HAGS = "cursed_hags" as const;
export const ENEMY_WOLF_RIDERS = "wolf_riders" as const;
export const ENEMY_IRONCLADS = "ironclads" as const;
export const ENEMY_ORC_SUMMONERS = "orc_summoners" as const;

// =============================================================================
// GRAY ENEMIES (Keep garrison)
// =============================================================================
export const ENEMY_CROSSBOWMEN = "crossbowmen" as const;
export const ENEMY_GUARDSMEN = "guardsmen" as const;
export const ENEMY_SWORDSMEN = "swordsmen" as const;
export const ENEMY_GOLEMS = "golems" as const;

// =============================================================================
// BROWN ENEMIES (Dungeon monsters)
// =============================================================================
export const ENEMY_MINOTAUR = "minotaur" as const;
export const ENEMY_GARGOYLE = "gargoyle" as const;
export const ENEMY_MEDUSA = "medusa" as const;
export const ENEMY_CRYPT_WORM = "crypt_worm" as const;
export const ENEMY_WEREWOLF = "werewolf" as const;
export const ENEMY_SHADOW = "shadow" as const;

// =============================================================================
// VIOLET ENEMIES (Mage Tower)
// =============================================================================
export const ENEMY_MONKS = "monks" as const;
export const ENEMY_ILLUSIONISTS = "illusionists" as const;
export const ENEMY_ICE_MAGES = "ice_mages" as const;
export const ENEMY_FIRE_MAGES = "fire_mages" as const;
export const ENEMY_SORCERERS = "sorcerers" as const;

// =============================================================================
// WHITE ENEMIES (City garrison)
// =============================================================================
export const ENEMY_THUGS = "thugs" as const;
export const ENEMY_SHOCKTROOPS = "shocktroops" as const;
export const ENEMY_ICE_GOLEMS = "ice_golems" as const;
export const ENEMY_FIRE_GOLEMS = "fire_golems" as const;
export const ENEMY_FREEZERS = "freezers" as const;
export const ENEMY_ALTEM_GUARDSMEN = "altem_guardsmen" as const;
export const ENEMY_ALTEM_MAGES = "altem_mages" as const;

// =============================================================================
// RED ENEMIES (Draconum)
// =============================================================================
export const ENEMY_SWAMP_DRAGON = "swamp_dragon" as const;
export const ENEMY_FIRE_DRAGON = "fire_dragon" as const;
export const ENEMY_ICE_DRAGON = "ice_dragon" as const;
export const ENEMY_HIGH_DRAGON = "high_dragon" as const;

export type EnemyId =
  // Green
  | typeof ENEMY_DIGGERS
  | typeof ENEMY_PROWLERS
  | typeof ENEMY_CURSED_HAGS
  | typeof ENEMY_WOLF_RIDERS
  | typeof ENEMY_IRONCLADS
  | typeof ENEMY_ORC_SUMMONERS
  // Gray
  | typeof ENEMY_CROSSBOWMEN
  | typeof ENEMY_GUARDSMEN
  | typeof ENEMY_SWORDSMEN
  | typeof ENEMY_GOLEMS
  // Brown
  | typeof ENEMY_MINOTAUR
  | typeof ENEMY_GARGOYLE
  | typeof ENEMY_MEDUSA
  | typeof ENEMY_CRYPT_WORM
  | typeof ENEMY_WEREWOLF
  | typeof ENEMY_SHADOW
  // Violet
  | typeof ENEMY_MONKS
  | typeof ENEMY_ILLUSIONISTS
  | typeof ENEMY_ICE_MAGES
  | typeof ENEMY_FIRE_MAGES
  | typeof ENEMY_SORCERERS
  // White
  | typeof ENEMY_THUGS
  | typeof ENEMY_SHOCKTROOPS
  | typeof ENEMY_ICE_GOLEMS
  | typeof ENEMY_FIRE_GOLEMS
  | typeof ENEMY_FREEZERS
  | typeof ENEMY_ALTEM_GUARDSMEN
  | typeof ENEMY_ALTEM_MAGES
  // Red
  | typeof ENEMY_SWAMP_DRAGON
  | typeof ENEMY_FIRE_DRAGON
  | typeof ENEMY_ICE_DRAGON
  | typeof ENEMY_HIGH_DRAGON;

// Enemy ability types
export const ABILITY_FORTIFIED = "fortified" as const;
export const ABILITY_UNFORTIFIED = "unfortified" as const; // Loses site fortification (e.g., Summoned enemies)
export const ABILITY_SWIFT = "swift" as const;
export const ABILITY_BRUTAL = "brutal" as const;
export const ABILITY_POISON = "poison" as const;
export const ABILITY_PARALYZE = "paralyze" as const;
export const ABILITY_SUMMON = "summon" as const;
export const ABILITY_CUMBERSOME = "cumbersome" as const;

export type EnemyAbilityType =
  | typeof ABILITY_FORTIFIED
  | typeof ABILITY_UNFORTIFIED
  | typeof ABILITY_SWIFT
  | typeof ABILITY_BRUTAL
  | typeof ABILITY_POISON
  | typeof ABILITY_PARALYZE
  | typeof ABILITY_SUMMON
  | typeof ABILITY_CUMBERSOME;

// Enemy definition interface
export interface EnemyDefinition {
  readonly id: EnemyId;
  readonly name: string;
  readonly color: EnemyColor;
  readonly attack: number;
  readonly attackElement: Element;
  readonly armor: number;
  readonly fame: number;
  readonly resistances: EnemyResistances;
  readonly abilities: readonly EnemyAbilityType[];
}

// Enemy definitions - data from TTS mod
export const ENEMIES: Record<EnemyId, EnemyDefinition> = {
  // ==========================================================================
  // GREEN ENEMIES (Marauding Orcs) - fame 2-4
  // ==========================================================================
  [ENEMY_DIGGERS]: {
    id: ENEMY_DIGGERS,
    name: "Diggers",
    color: ENEMY_COLOR_GREEN,
    attack: 3,
    attackElement: ELEMENT_PHYSICAL,
    armor: 3,
    fame: 2,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_FORTIFIED],
  },
  [ENEMY_PROWLERS]: {
    id: ENEMY_PROWLERS,
    name: "Prowlers",
    color: ENEMY_COLOR_GREEN,
    attack: 4,
    attackElement: ELEMENT_PHYSICAL,
    armor: 3,
    fame: 2,
    resistances: NO_RESISTANCES,
    abilities: [],
  },
  [ENEMY_CURSED_HAGS]: {
    id: ENEMY_CURSED_HAGS,
    name: "Cursed Hags",
    color: ENEMY_COLOR_GREEN,
    attack: 3,
    attackElement: ELEMENT_PHYSICAL,
    armor: 5,
    fame: 3,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_POISON],
  },
  [ENEMY_WOLF_RIDERS]: {
    id: ENEMY_WOLF_RIDERS,
    name: "Wolf Riders",
    color: ENEMY_COLOR_GREEN,
    attack: 3,
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 3,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_SWIFT],
  },
  [ENEMY_IRONCLADS]: {
    id: ENEMY_IRONCLADS,
    name: "Ironclads",
    color: ENEMY_COLOR_GREEN,
    attack: 4,
    attackElement: ELEMENT_PHYSICAL,
    armor: 3,
    fame: 4,
    resistances: { physical: true, fire: false, ice: false },
    abilities: [ABILITY_BRUTAL],
  },
  [ENEMY_ORC_SUMMONERS]: {
    id: ENEMY_ORC_SUMMONERS,
    name: "Orc Summoners",
    color: ENEMY_COLOR_GREEN,
    attack: 0, // Summoners don't attack directly
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 4,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_SUMMON], // Summons brown enemy
  },

  // ==========================================================================
  // GRAY ENEMIES (Keep garrison) - fame 3-5
  // ==========================================================================
  [ENEMY_CROSSBOWMEN]: {
    id: ENEMY_CROSSBOWMEN,
    name: "Crossbowmen",
    color: ENEMY_COLOR_GRAY,
    attack: 4,
    attackElement: ELEMENT_PHYSICAL,
    armor: 3,
    fame: 3,
    resistances: NO_RESISTANCES,
    abilities: [],
  },
  [ENEMY_GUARDSMEN]: {
    id: ENEMY_GUARDSMEN,
    name: "Guardsmen",
    color: ENEMY_COLOR_GRAY,
    attack: 3,
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 3,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_SWIFT],
  },
  [ENEMY_SWORDSMEN]: {
    id: ENEMY_SWORDSMEN,
    name: "Swordsmen",
    color: ENEMY_COLOR_GRAY,
    attack: 6,
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 4,
    resistances: NO_RESISTANCES,
    abilities: [],
  },
  [ENEMY_GOLEMS]: {
    id: ENEMY_GOLEMS,
    name: "Golems",
    color: ENEMY_COLOR_GRAY,
    attack: 2,
    attackElement: ELEMENT_PHYSICAL,
    armor: 5,
    fame: 4,
    resistances: { physical: true, fire: false, ice: false },
    abilities: [],
  },

  // ==========================================================================
  // BROWN ENEMIES (Dungeon monsters) - fame 4-5
  // ==========================================================================
  [ENEMY_MINOTAUR]: {
    id: ENEMY_MINOTAUR,
    name: "Minotaur",
    color: ENEMY_COLOR_BROWN,
    attack: 5,
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 4,
    resistances: { physical: true, fire: false, ice: false },
    abilities: [],
  },
  [ENEMY_GARGOYLE]: {
    id: ENEMY_GARGOYLE,
    name: "Gargoyle",
    color: ENEMY_COLOR_BROWN,
    attack: 5,
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 4,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_BRUTAL],
  },
  [ENEMY_MEDUSA]: {
    id: ENEMY_MEDUSA,
    name: "Medusa",
    color: ENEMY_COLOR_BROWN,
    attack: 6,
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 5,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_PARALYZE],
  },
  [ENEMY_CRYPT_WORM]: {
    id: ENEMY_CRYPT_WORM,
    name: "Crypt Worm",
    color: ENEMY_COLOR_BROWN,
    attack: 6,
    attackElement: ELEMENT_PHYSICAL,
    armor: 6,
    fame: 5,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_FORTIFIED],
  },
  [ENEMY_WEREWOLF]: {
    id: ENEMY_WEREWOLF,
    name: "Werewolf",
    color: ENEMY_COLOR_BROWN,
    attack: 7,
    attackElement: ELEMENT_PHYSICAL,
    armor: 5,
    fame: 5,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_SWIFT],
  },
  [ENEMY_SHADOW]: {
    id: ENEMY_SHADOW,
    name: "Shadow",
    color: ENEMY_COLOR_BROWN,
    attack: 4,
    attackElement: ELEMENT_COLD_FIRE,
    armor: 4,
    fame: 4,
    resistances: NO_RESISTANCES,
    abilities: [], // Elusive, arcane immunity not modeled yet
  },

  // ==========================================================================
  // VIOLET ENEMIES (Mage Tower) - fame 5-6
  // ==========================================================================
  [ENEMY_MONKS]: {
    id: ENEMY_MONKS,
    name: "Monks",
    color: ENEMY_COLOR_VIOLET,
    attack: 5,
    attackElement: ELEMENT_PHYSICAL,
    armor: 4,
    fame: 5,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_POISON],
  },
  [ENEMY_ILLUSIONISTS]: {
    id: ENEMY_ILLUSIONISTS,
    name: "Illusionists",
    color: ENEMY_COLOR_VIOLET,
    attack: 3,
    attackElement: ELEMENT_PHYSICAL,
    armor: 3,
    fame: 5,
    resistances: { physical: true, fire: false, ice: false },
    abilities: [], // Special: physical resistance
  },
  [ENEMY_ICE_MAGES]: {
    id: ENEMY_ICE_MAGES,
    name: "Ice Mages",
    color: ENEMY_COLOR_VIOLET,
    attack: 5,
    attackElement: ELEMENT_ICE,
    armor: 6,
    fame: 5,
    resistances: { physical: false, fire: false, ice: true },
    abilities: [],
  },
  [ENEMY_FIRE_MAGES]: {
    id: ENEMY_FIRE_MAGES,
    name: "Fire Mages",
    color: ENEMY_COLOR_VIOLET,
    attack: 6,
    attackElement: ELEMENT_FIRE,
    armor: 5,
    fame: 5,
    resistances: { physical: false, fire: true, ice: false },
    abilities: [],
  },
  [ENEMY_SORCERERS]: {
    id: ENEMY_SORCERERS,
    name: "Sorcerers",
    color: ENEMY_COLOR_VIOLET,
    attack: 5,
    attackElement: ELEMENT_COLD_FIRE,
    armor: 5,
    fame: 6,
    resistances: { physical: false, fire: true, ice: true },
    abilities: [],
  },

  // ==========================================================================
  // WHITE ENEMIES (City garrison) - fame 5-8
  // ==========================================================================
  [ENEMY_THUGS]: {
    id: ENEMY_THUGS,
    name: "Thugs",
    color: ENEMY_COLOR_WHITE,
    attack: 6,
    attackElement: ELEMENT_PHYSICAL,
    armor: 5,
    fame: 5,
    resistances: NO_RESISTANCES,
    abilities: [],
  },
  [ENEMY_SHOCKTROOPS]: {
    id: ENEMY_SHOCKTROOPS,
    name: "Shocktroops",
    color: ENEMY_COLOR_WHITE,
    attack: 5,
    attackElement: ELEMENT_PHYSICAL,
    armor: 5,
    fame: 5,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_SWIFT, ABILITY_BRUTAL],
  },
  [ENEMY_ICE_GOLEMS]: {
    id: ENEMY_ICE_GOLEMS,
    name: "Ice Golems",
    color: ENEMY_COLOR_WHITE,
    attack: 4,
    attackElement: ELEMENT_ICE,
    armor: 5,
    fame: 5,
    resistances: { physical: true, fire: false, ice: false },
    abilities: [ABILITY_PARALYZE],
  },
  [ENEMY_FIRE_GOLEMS]: {
    id: ENEMY_FIRE_GOLEMS,
    name: "Fire Golems",
    color: ENEMY_COLOR_WHITE,
    attack: 4,
    attackElement: ELEMENT_FIRE,
    armor: 5,
    fame: 5,
    resistances: { physical: true, fire: false, ice: false },
    abilities: [],
  },
  [ENEMY_FREEZERS]: {
    id: ENEMY_FREEZERS,
    name: "Freezers",
    color: ENEMY_COLOR_WHITE,
    attack: 3,
    attackElement: ELEMENT_COLD_FIRE,
    armor: 4,
    fame: 4,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_PARALYZE],
  },
  [ENEMY_ALTEM_GUARDSMEN]: {
    id: ENEMY_ALTEM_GUARDSMEN,
    name: "Altem Guardsmen",
    color: ENEMY_COLOR_WHITE,
    attack: 6,
    attackElement: ELEMENT_PHYSICAL,
    armor: 6,
    fame: 6,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_FORTIFIED],
  },
  [ENEMY_ALTEM_MAGES]: {
    id: ENEMY_ALTEM_MAGES,
    name: "Altem Mages",
    color: ENEMY_COLOR_WHITE,
    attack: 6,
    attackElement: ELEMENT_COLD_FIRE,
    armor: 6,
    fame: 8,
    resistances: { physical: false, fire: true, ice: true },
    abilities: [ABILITY_BRUTAL],
  },

  // ==========================================================================
  // RED ENEMIES (Draconum) - fame 7-9
  // ==========================================================================
  [ENEMY_SWAMP_DRAGON]: {
    id: ENEMY_SWAMP_DRAGON,
    name: "Swamp Dragon",
    color: ENEMY_COLOR_RED,
    attack: 5,
    attackElement: ELEMENT_PHYSICAL,
    armor: 9,
    fame: 7,
    resistances: NO_RESISTANCES,
    abilities: [ABILITY_SWIFT, ABILITY_POISON],
  },
  [ENEMY_FIRE_DRAGON]: {
    id: ENEMY_FIRE_DRAGON,
    name: "Fire Dragon",
    color: ENEMY_COLOR_RED,
    attack: 9,
    attackElement: ELEMENT_FIRE,
    armor: 7,
    fame: 8,
    resistances: { physical: true, fire: true, ice: false },
    abilities: [],
  },
  [ENEMY_ICE_DRAGON]: {
    id: ENEMY_ICE_DRAGON,
    name: "Ice Dragon",
    color: ENEMY_COLOR_RED,
    attack: 6,
    attackElement: ELEMENT_ICE,
    armor: 7,
    fame: 8,
    resistances: { physical: true, fire: false, ice: true },
    abilities: [ABILITY_PARALYZE],
  },
  [ENEMY_HIGH_DRAGON]: {
    id: ENEMY_HIGH_DRAGON,
    name: "High Dragon",
    color: ENEMY_COLOR_RED,
    attack: 6,
    attackElement: ELEMENT_COLD_FIRE,
    armor: 9,
    fame: 9,
    resistances: { physical: false, fire: true, ice: true },
    abilities: [ABILITY_BRUTAL],
  },
};

export function getEnemy(id: EnemyId): EnemyDefinition {
  return ENEMIES[id];
}

/**
 * Get all enemies of a specific color
 */
export function getEnemiesByColor(color: EnemyColor): EnemyDefinition[] {
  return Object.values(ENEMIES).filter((e) => e.color === color);
}

// =============================================================================
// TEST ENEMY ALIASES (backward-compatible for tests)
// These map test enemy names to real game enemies with matching stats
// =============================================================================
export const ENEMY_ORC = ENEMY_DIGGERS; // attack 3, armor 3, fame 2, physical
export const ENEMY_WOLF = ENEMY_GUARDSMEN; // attack 3, armor 4, fame 3, physical, swift
export const ENEMY_FIRE_MAGE = ENEMY_FIRE_MAGES; // attack 6, armor 5, fire attack, fire resistance
export const ENEMY_ICE_GOLEM = ENEMY_ICE_GOLEMS; // attack 4, armor 5, ice attack, physical resistance
