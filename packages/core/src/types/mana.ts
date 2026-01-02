/**
 * Mana source types for Mage Knight
 */

export type { SpecialManaColor } from "@mage-knight/shared";
import type { ManaColor } from "@mage-knight/shared";

// Represents a die in the source
export interface SourceDie {
  readonly id: string;
  readonly color: ManaColor;
  readonly isDepleted: boolean; // gold depleted at night, black depleted at day
}

// The mana source (dice pool)
export interface ManaSource {
  readonly dice: readonly SourceDie[];
  // Number of dice = number of actual players + 2
}

// Helper to create an empty mana source
export function createEmptyManaSource(): ManaSource {
  return {
    dice: [],
  };
}
