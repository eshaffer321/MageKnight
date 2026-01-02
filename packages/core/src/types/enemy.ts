/**
 * Enemy token types for Mage Knight
 */

import {
  ATTACK_TYPE_COLD_FIRE,
  ATTACK_TYPE_FIRE,
  ATTACK_TYPE_ICE,
  ATTACK_TYPE_PHYSICAL,
  ENEMY_ABILITY_BRUTAL,
  ENEMY_ABILITY_FORTIFIED,
  ENEMY_ABILITY_PARALYZE,
  ENEMY_ABILITY_POISON,
  ENEMY_ABILITY_RESISTANCE,
  ENEMY_ABILITY_SUMMON,
  ENEMY_ABILITY_SWIFT,
  ENEMY_COLOR_BROWN,
  ENEMY_COLOR_GRAY,
  ENEMY_COLOR_GREEN,
  ENEMY_COLOR_RED,
  ENEMY_COLOR_VIOLET,
  ENEMY_COLOR_WHITE,
  RESISTANCE_ELEMENT_FIRE,
  RESISTANCE_ELEMENT_ICE,
  RESISTANCE_ELEMENT_PHYSICAL,
} from "./enemyConstants.js";

// Branded ID type for enemy tokens
export type EnemyTokenId = string & { readonly __brand: "EnemyTokenId" };

// Enemy colors (token back colors)
export type EnemyColor =
  | typeof ENEMY_COLOR_GREEN
  | typeof ENEMY_COLOR_RED
  | typeof ENEMY_COLOR_BROWN
  | typeof ENEMY_COLOR_VIOLET
  | typeof ENEMY_COLOR_GRAY
  | typeof ENEMY_COLOR_WHITE;

// Attack types
export type AttackType =
  | typeof ATTACK_TYPE_PHYSICAL
  | typeof ATTACK_TYPE_FIRE
  | typeof ATTACK_TYPE_ICE
  | typeof ATTACK_TYPE_COLD_FIRE;

// Enemy abilities as discriminated union
export type EnemyAbility =
  | { readonly type: typeof ENEMY_ABILITY_FORTIFIED }
  | { readonly type: typeof ENEMY_ABILITY_SWIFT }
  | { readonly type: typeof ENEMY_ABILITY_BRUTAL }
  | { readonly type: typeof ENEMY_ABILITY_POISON }
  | { readonly type: typeof ENEMY_ABILITY_PARALYZE }
  | { readonly type: typeof ENEMY_ABILITY_SUMMON; readonly pool: EnemyColor }
  | {
      readonly type: typeof ENEMY_ABILITY_RESISTANCE;
      readonly element:
        | typeof RESISTANCE_ELEMENT_PHYSICAL
        | typeof RESISTANCE_ELEMENT_FIRE
        | typeof RESISTANCE_ELEMENT_ICE;
    };

// An enemy token definition
export interface EnemyToken {
  readonly id: EnemyTokenId;
  readonly name: string;
  readonly color: EnemyColor;
  readonly armor: number;
  readonly attack: number;
  readonly attackType: AttackType;
  readonly fame: number;
  readonly abilities: readonly EnemyAbility[];
}

// Token piles in game state
export interface EnemyTokenPiles {
  readonly drawPiles: Record<EnemyColor, readonly EnemyTokenId[]>;
  readonly discardPiles: Record<EnemyColor, readonly EnemyTokenId[]>;
}

// Helper to create empty enemy token piles
export function createEmptyEnemyTokenPiles(): EnemyTokenPiles {
  return {
    drawPiles: {
      green: [],
      red: [],
      brown: [],
      violet: [],
      gray: [],
      white: [],
    },
    discardPiles: {
      green: [],
      red: [],
      brown: [],
      violet: [],
      gray: [],
      white: [],
    },
  };
}
