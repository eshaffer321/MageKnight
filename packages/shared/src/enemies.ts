/**
 * Enemy definitions for Mage Knight
 *
 * Phase 1: Basic enemies with no special abilities
 */

// Enemy color constants (token back colors)
export const ENEMY_COLOR_GREEN = "green" as const;
export const ENEMY_COLOR_GRAY = "gray" as const;
export const ENEMY_COLOR_BROWN = "brown" as const;
export const ENEMY_COLOR_VIOLET = "violet" as const;
export const ENEMY_COLOR_RED = "red" as const;
export const ENEMY_COLOR_WHITE = "white" as const;

export type EnemyColor =
  | typeof ENEMY_COLOR_GREEN
  | typeof ENEMY_COLOR_GRAY
  | typeof ENEMY_COLOR_BROWN
  | typeof ENEMY_COLOR_VIOLET
  | typeof ENEMY_COLOR_RED
  | typeof ENEMY_COLOR_WHITE;

// Attack element constants
export const ATTACK_ELEMENT_PHYSICAL = "physical" as const;
export const ATTACK_ELEMENT_FIRE = "fire" as const;
export const ATTACK_ELEMENT_ICE = "ice" as const;
export const ATTACK_ELEMENT_COLD_FIRE = "cold_fire" as const;

export type AttackElement =
  | typeof ATTACK_ELEMENT_PHYSICAL
  | typeof ATTACK_ELEMENT_FIRE
  | typeof ATTACK_ELEMENT_ICE
  | typeof ATTACK_ELEMENT_COLD_FIRE;

// Enemy ID constants
export const ENEMY_ORC = "orc" as const;
export const ENEMY_WOLF = "wolf" as const;
export const ENEMY_CROSSBOWMEN = "crossbowmen" as const;
export const ENEMY_SWORDSMEN = "swordsmen" as const;

export type EnemyId =
  | typeof ENEMY_ORC
  | typeof ENEMY_WOLF
  | typeof ENEMY_CROSSBOWMEN
  | typeof ENEMY_SWORDSMEN;

// Enemy definition interface
export interface EnemyDefinition {
  readonly id: EnemyId;
  readonly name: string;
  readonly color: EnemyColor;
  readonly attack: number;
  readonly attackElement: AttackElement;
  readonly armor: number;
  readonly fame: number;
  // Phase 2+: abilities, resistances, etc.
}

// Enemy definitions
export const ENEMIES: Record<EnemyId, EnemyDefinition> = {
  [ENEMY_ORC]: {
    id: ENEMY_ORC,
    name: "Orc",
    color: ENEMY_COLOR_GREEN,
    attack: 3,
    attackElement: ATTACK_ELEMENT_PHYSICAL,
    armor: 3,
    fame: 2,
  },
  [ENEMY_WOLF]: {
    id: ENEMY_WOLF,
    name: "Wolf",
    color: ENEMY_COLOR_GREEN,
    attack: 3,
    attackElement: ATTACK_ELEMENT_PHYSICAL,
    armor: 2,
    fame: 2,
  },
  [ENEMY_CROSSBOWMEN]: {
    id: ENEMY_CROSSBOWMEN,
    name: "Crossbowmen",
    color: ENEMY_COLOR_GRAY,
    attack: 4,
    attackElement: ATTACK_ELEMENT_PHYSICAL,
    armor: 3,
    fame: 3,
  },
  [ENEMY_SWORDSMEN]: {
    id: ENEMY_SWORDSMEN,
    name: "Swordsmen",
    color: ENEMY_COLOR_GRAY,
    attack: 6,
    attackElement: ATTACK_ELEMENT_PHYSICAL,
    armor: 4,
    fame: 4,
  },
};

export function getEnemy(id: EnemyId): EnemyDefinition {
  return ENEMIES[id];
}
