/**
 * Game engine functions
 *
 * This module contains the core game logic including:
 * - Modifier management and effective value calculations
 * - Command pattern for undo support
 * - (Future) Action processing, combat resolution, etc.
 */

// Modifier system
export type { ExpirationTrigger } from "./modifiers.js";
export {
  // Query helpers
  getModifiersOfType,
  getModifiersForPlayer,
  getModifiersForEnemy,
  // Effective value calculations
  getEffectiveTerrainCost,
  getEffectiveSidewaysValue,
  isRuleActive,
  getEffectiveEnemyArmor,
  getEffectiveEnemyAttack,
  // Lifecycle
  addModifier,
  removeModifier,
  expireModifiers,
} from "./modifiers.js";

// Command system
export type { Command, CommandResult, UndoCheckpoint } from "./commands.js";
export type { CommandStackState } from "./commandStack.js";
export {
  createEmptyCommandStack,
  pushCommand,
  popCommand,
  canUndo,
  clearCommandStack,
} from "./commandStack.js";

// Command implementations
export {
  createMoveCommand,
  type MoveCommandParams,
  createRevealTileCommand,
  type RevealTileCommandParams,
} from "./commands/index.js";
