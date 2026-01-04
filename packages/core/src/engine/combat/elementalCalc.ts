/**
 * Elemental calculation helpers for combat
 *
 * Handles block efficiency, attack resistances, and elemental interactions.
 */

import type { Element } from "@mage-knight/shared";
import {
  ELEMENT_PHYSICAL,
  ELEMENT_FIRE,
  ELEMENT_ICE,
  ELEMENT_COLD_FIRE,
} from "@mage-knight/shared";

/**
 * Resistances interface for enemies
 */
export interface Resistances {
  readonly physical: boolean;
  readonly fire: boolean;
  readonly ice: boolean;
}

export const NO_RESISTANCES: Resistances = {
  physical: false,
  fire: false,
  ice: false,
};

/**
 * Determine if a block element is efficient against an attack element.
 * Efficient blocks count at full value; inefficient blocks are halved.
 *
 * Rules (rulebook lines 698-702):
 * - Any block is efficient against Physical attacks
 * - Ice or Cold Fire blocks are efficient against Fire attacks
 * - Fire or Cold Fire blocks are efficient against Ice attacks
 * - Only Cold Fire blocks are efficient against Cold Fire attacks
 */
export function isBlockEfficient(
  blockElement: Element,
  attackElement: Element
): boolean {
  switch (attackElement) {
    case ELEMENT_PHYSICAL:
      return true;

    case ELEMENT_FIRE:
      return blockElement === ELEMENT_ICE || blockElement === ELEMENT_COLD_FIRE;

    case ELEMENT_ICE:
      return blockElement === ELEMENT_FIRE || blockElement === ELEMENT_COLD_FIRE;

    case ELEMENT_COLD_FIRE:
      return blockElement === ELEMENT_COLD_FIRE;

    default:
      return false;
  }
}

/**
 * Calculate total block value considering efficiency.
 * Inefficient blocks are halved (rounded down), then added to efficient blocks.
 *
 * Rule (line 704): "total the values of all inefficient Blocks, divide by two
 * (round down) and then add the full values of all efficient Blocks."
 */
export function calculateTotalBlock(
  blocks: readonly { element: Element; value: number }[],
  attackElement: Element
): number {
  let efficientTotal = 0;
  let inefficientTotal = 0;

  for (const block of blocks) {
    if (isBlockEfficient(block.element, attackElement)) {
      efficientTotal += block.value;
    } else {
      inefficientTotal += block.value;
    }
  }

  return efficientTotal + Math.floor(inefficientTotal / 2);
}

/**
 * Determine if an attack element is resisted by enemy resistances.
 * Resisted attacks are halved.
 *
 * Rules (lines 656-657, 1911-1914):
 * - Physical Resistance halves Physical attacks
 * - Fire Resistance halves Fire attacks
 * - Ice Resistance halves Ice attacks
 * - Cold Fire is halved ONLY if enemy has BOTH Fire AND Ice Resistance
 */
export function isAttackResisted(
  attackElement: Element,
  resistances: Resistances
): boolean {
  switch (attackElement) {
    case ELEMENT_PHYSICAL:
      return resistances.physical;

    case ELEMENT_FIRE:
      return resistances.fire;

    case ELEMENT_ICE:
      return resistances.ice;

    case ELEMENT_COLD_FIRE:
      return resistances.fire && resistances.ice;

    default:
      return false;
  }
}

/**
 * Calculate effective attack value against enemies with resistances.
 * Resisted attacks are halved (rounded down).
 */
export function calculateEffectiveAttack(
  attacks: readonly { element: Element; value: number }[],
  targetResistances: Resistances
): number {
  let efficientTotal = 0;
  let inefficientTotal = 0;

  for (const attack of attacks) {
    if (isAttackResisted(attack.element, targetResistances)) {
      inefficientTotal += attack.value;
    } else {
      efficientTotal += attack.value;
    }
  }

  return efficientTotal + Math.floor(inefficientTotal / 2);
}

/**
 * Combine resistances from multiple enemies.
 * If ANY enemy has a resistance, it applies to the whole attack.
 */
export function combineResistances(
  enemies: readonly { resistances: Resistances }[]
): Resistances {
  return {
    physical: enemies.some((e) => e.resistances.physical),
    fire: enemies.some((e) => e.resistances.fire),
    ice: enemies.some((e) => e.resistances.ice),
  };
}
