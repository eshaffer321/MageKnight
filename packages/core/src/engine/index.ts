/**
 * Game engine functions
 *
 * This module contains the core game logic including:
 * - Modifier management and effective value calculations
 * - (Future) Action processing, combat resolution, etc.
 */

// Modifier system
export type { ExpirationTrigger } from "./modifiers.js";
export {
  getModifiersOfType,
  getModifiersForPlayer,
  getEffectiveTerrainCost,
  getEffectiveSidewaysValue,
  isRuleActive,
  addModifier,
  removeModifier,
  expireModifiers,
} from "./modifiers.js";
