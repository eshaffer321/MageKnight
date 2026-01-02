/**
 * @mage-knight/core
 * Pure game logic for Mage Knight
 */

// Types
export type * from "./types/index.js";
export { Hero, HEROES } from "./types/index.js";

// State
export type {
  GameState,
  GamePhase,
  TimeOfDay,
  MapState,
} from "./state/GameState.js";
export { createInitialGameState } from "./state/GameState.js";

// Hex (re-exported from shared for convenience)
export type { HexCoord, HexDirection } from "./hex/HexCoord.js";
export {
  HEX_DIRECTIONS,
  hexKey,
  getNeighbor,
  getAllNeighbors,
} from "./hex/HexCoord.js";

// Tile data
export type { LocalHex, TileType, TileDefinition } from "./data/tiles.js";
export { TILE_DEFINITIONS, placeTile, getTilesByType } from "./data/tiles.js";

// Site properties
export type { SiteProperties } from "./data/siteProperties.js";
export {
  SITE_PROPERTIES,
  isFortified,
  isInhabited,
  isAdventureSite,
  allowsMultipleHeroes,
} from "./data/siteProperties.js";

// Engine
export { MageKnightEngine, createEngine } from "./engine/index.js";
export type { ActionResult } from "./engine/index.js";

// Modifiers
export type { ExpirationTrigger } from "./engine/index.js";
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
} from "./engine/index.js";

// Command system (undo support)
export type {
  Command,
  CommandResult,
  UndoCheckpoint,
  CommandStackState,
  MoveCommandParams,
  RevealTileCommandParams,
} from "./engine/index.js";
export {
  createEmptyCommandStack,
  pushCommand,
  popCommand,
  canUndo,
  clearCommandStack,
  createMoveCommand,
  createRevealTileCommand,
} from "./engine/index.js";
