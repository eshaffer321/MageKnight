/**
 * City state types for Mage Knight
 *
 * Cities have special state beyond the generic Site interface:
 * - Face-down garrison (enemy tokens drawn at reveal)
 * - Shield tokens per player with order (for tie-breaking leadership)
 * - Level (affects garrison composition)
 */

import type { CityColor } from "./map.js";
import type { EnemyTokenId } from "./enemy.js";

export interface CityShield {
  readonly playerId: string;
  readonly order: number; // 1, 2, 3... for tie-breaking
}

export interface CityState {
  readonly color: CityColor;
  readonly level: number; // affects garrison size/composition
  readonly garrison: readonly EnemyTokenId[]; // face-down defenders, revealed during assault
  readonly shields: readonly CityShield[]; // who contributed shields, in order
  readonly isConquered: boolean;
  readonly leaderId: string | null; // player with most shields (first if tied)
}

/**
 * Determine the city leader from shields.
 * Leader is the player with most shields. In case of tie, whoever placed first shield wins.
 */
export function determineCityLeader(
  shields: readonly CityShield[]
): string | null {
  if (shields.length === 0) return null;

  // Count shields per player
  const counts = new Map<string, number>();

  for (const shield of shields) {
    const count = (counts.get(shield.playerId) ?? 0) + 1;
    counts.set(shield.playerId, count);
  }

  // Find max count
  let maxCount = 0;
  let leader: string | null = null;

  for (const [playerId, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      leader = playerId;
    } else if (count === maxCount) {
      // Tie - whoever placed first shield wins
      // Need to check order
      const leaderFirstOrder =
        shields.find((s) => s.playerId === leader)?.order ?? Infinity;
      const thisFirstOrder =
        shields.find((s) => s.playerId === playerId)?.order ?? Infinity;
      if (thisFirstOrder < leaderFirstOrder) {
        leader = playerId;
      }
    }
  }

  return leader;
}

/**
 * Create an empty city state for a newly revealed city.
 */
export function createCityState(
  color: CityColor,
  level: number,
  garrison: readonly EnemyTokenId[]
): CityState {
  return {
    color,
    level,
    garrison,
    shields: [],
    isConquered: false,
    leaderId: null,
  };
}
