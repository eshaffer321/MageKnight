/**
 * @mage-knight/core
 * Pure game logic for Mage Knight
 */

// Types
export type * from "./types/index.js";

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

// Engine (modifier system, calculations)
export type { ExpirationTrigger } from "./engine/index.js";
export {
  getModifiersOfType,
  getModifiersForPlayer,
  getEffectiveTerrainCost,
  getEffectiveSidewaysValue,
  isRuleActive,
  addModifier,
  removeModifier,
  expireModifiers,
} from "./engine/index.js";
