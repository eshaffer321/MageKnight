/**
 * Tile definitions for Mage Knight
 *
 * Each tile is a 7-hex cluster. Coordinates are relative to the tile center (0,0).
 * The 6 surrounding hexes use axial coordinate offsets.
 *
 * Layout reference (flat-top hex orientation, looking at tile with number at bottom):
 *       NW  NE
 *     W  C   E
 *       SW  SE
 *
 * Axial offsets from center:
 *   NE: (1, -1), E: (1, 0), SE: (0, 1)
 *   SW: (-1, 1), W: (-1, 0), NW: (0, -1)
 *
 * Data verified against tile images from the unofficial Mage Knight wiki.
 */

import type { Terrain, HexCoord } from "@mage-knight/shared";
import {
  TERRAIN_DESERT,
  TERRAIN_FOREST,
  TERRAIN_HILLS,
  TERRAIN_LAKE,
  TERRAIN_MOUNTAIN,
  TERRAIN_PLAINS,
  TERRAIN_SWAMP,
  TERRAIN_WASTELAND,
} from "@mage-knight/shared";
import {
  TileId,
  SiteType,
  RampagingEnemyType,
  type HexState,
  type Site,
  type MineColor,
} from "../types/map.js";
import {
  CITY_COLOR_RED,
  CITY_COLOR_BLUE,
  CITY_COLOR_GREEN,
  CITY_COLOR_WHITE,
  MINE_COLOR_BLUE,
  MINE_COLOR_WHITE,
} from "../types/mapConstants.js";
import {
  TILE_TYPE_CORE,
  TILE_TYPE_COUNTRYSIDE,
  TILE_TYPE_STARTING,
} from "./tileConstants.js";

// Hex definition within a tile template (before placement)
export interface LocalHex {
  readonly localQ: number;
  readonly localR: number;
  readonly terrain: Terrain;
  readonly site: SiteType | null;
  readonly mineColor?: MineColor;
  readonly rampaging?: RampagingEnemyType;
}

// Tile type
export type TileType =
  | typeof TILE_TYPE_STARTING
  | typeof TILE_TYPE_COUNTRYSIDE
  | typeof TILE_TYPE_CORE;

// Full tile definition
export interface TileDefinition {
  readonly id: TileId;
  readonly type: TileType;
  readonly hexes: readonly LocalHex[];
  readonly hasCity: boolean;
  readonly cityColor?: typeof CITY_COLOR_RED | typeof CITY_COLOR_BLUE | typeof CITY_COLOR_GREEN | typeof CITY_COLOR_WHITE;
}

// Helper to create a local hex
function hex(
  localQ: number,
  localR: number,
  terrain: Terrain,
  site: SiteType | null = null,
  extra?: { mineColor?: MineColor; rampaging?: RampagingEnemyType }
): LocalHex {
  return { localQ, localR, terrain, site, ...extra };
}

/**
 * Complete tile definitions for Mage Knight
 * Verified against official tile images
 */
export const TILE_DEFINITIONS: Record<TileId, TileDefinition> = {
  // ============================================================================
  // STARTING TILES (Portal)
  // ============================================================================

  // Portal A - Coastal starting tile
  [TileId.StartingTileA]: {
    id: TileId.StartingTileA,
    type: TILE_TYPE_STARTING,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.Portal), // Center - portal
      hex(1, -1, TERRAIN_FOREST), // NE - forest
      hex(1, 0, TERRAIN_PLAINS), // E - plains
      hex(0, 1, TERRAIN_MOUNTAIN), // SE - mountain/cliff (coastal)
      hex(-1, 1, TERRAIN_LAKE), // SW - ocean (impassable)
      hex(-1, 0, TERRAIN_LAKE), // W - ocean (impassable)
      hex(0, -1, TERRAIN_PLAINS), // NW - plains (coastal edge)
    ],
  },

  // Portal B - Alternate coastal starting tile
  [TileId.StartingTileB]: {
    id: TileId.StartingTileB,
    type: TILE_TYPE_STARTING,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.Portal), // Center - portal
      hex(1, -1, TERRAIN_FOREST), // NE - forest
      hex(1, 0, TERRAIN_PLAINS), // E - plains
      hex(0, 1, TERRAIN_PLAINS), // SE - plains
      hex(-1, 1, TERRAIN_MOUNTAIN), // SW - mountain/cliff (coastal)
      hex(-1, 0, TERRAIN_LAKE), // W - ocean (impassable)
      hex(0, -1, TERRAIN_PLAINS), // NW - plains (coastal edge)
    ],
  },

  // ============================================================================
  // COUNTRYSIDE TILES (Green back) - Base Game
  // ============================================================================

  // Countryside 1 - Magical Glade, Village, Orc Marauders
  [TileId.Countryside1]: {
    id: TileId.Countryside1,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.MagicalGlade), // Center - magical glade
      hex(1, -1, TERRAIN_LAKE), // NE - lake
      hex(1, 0, TERRAIN_PLAINS, SiteType.Village), // E - village
      hex(0, 1, TERRAIN_PLAINS), // SE - plains
      hex(-1, 1, TERRAIN_PLAINS), // SW - plains
      hex(-1, 0, TERRAIN_FOREST), // W - forest
      hex(0, -1, TERRAIN_FOREST, null, { rampaging: RampagingEnemyType.OrcMarauder }), // NW - forest + orcs
    ],
  },

  // Countryside 2 - Hills center, Magical Glade, Village, Monster Den, Orc Marauders
  [TileId.Countryside2]: {
    id: TileId.Countryside2,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_HILLS), // Center - hills
      hex(1, -1, TERRAIN_FOREST, SiteType.MagicalGlade), // NE - forest + glade
      hex(1, 0, TERRAIN_PLAINS, SiteType.Village), // E - village
      hex(0, 1, TERRAIN_PLAINS), // SE - plains
      hex(-1, 1, TERRAIN_HILLS, SiteType.MonsterDen), // SW - monster den
      hex(-1, 0, TERRAIN_PLAINS), // W - plains
      hex(0, -1, TERRAIN_HILLS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // NW - hills + orcs
    ],
  },

  // Countryside 3 - Forest center, Keep, Village, Mine (white)
  [TileId.Countryside3]: {
    id: TileId.Countryside3,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_FOREST), // Center - forest
      hex(1, -1, TERRAIN_HILLS, SiteType.Keep), // NE - keep
      hex(1, 0, TERRAIN_HILLS), // E - hills
      hex(0, 1, TERRAIN_HILLS, SiteType.Mine, { mineColor: MINE_COLOR_WHITE }), // SE - white mine
      hex(-1, 1, TERRAIN_PLAINS, SiteType.Village), // SW - village
      hex(-1, 0, TERRAIN_PLAINS), // W - plains
      hex(0, -1, TERRAIN_PLAINS), // NW - plains
    ],
  },

  // Countryside 4 - Desert, Mage Tower, Village, Mountain, Orc Marauders
  [TileId.Countryside4]: {
    id: TileId.Countryside4,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_DESERT, SiteType.MageTower), // Center - mage tower
      hex(1, -1, TERRAIN_DESERT), // NE - desert
      hex(1, 0, TERRAIN_MOUNTAIN), // E - mountain
      hex(0, 1, TERRAIN_PLAINS, SiteType.Village), // SE - village
      hex(-1, 1, TERRAIN_DESERT), // SW - desert
      hex(-1, 0, TERRAIN_HILLS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // W - hills + orcs
      hex(0, -1, TERRAIN_DESERT), // NW - desert
    ],
  },

  // Countryside 5 - Lake center, Monastery, Mine (blue), Magical Glade, Orc Marauders
  [TileId.Countryside5]: {
    id: TileId.Countryside5,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_LAKE), // Center - lake
      hex(1, -1, TERRAIN_PLAINS, SiteType.Monastery), // NE - monastery
      hex(1, 0, TERRAIN_PLAINS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // E - plains + orcs
      hex(0, 1, TERRAIN_PLAINS, SiteType.Mine, { mineColor: MINE_COLOR_BLUE }), // SE - blue mine
      hex(-1, 1, TERRAIN_FOREST), // SW - forest
      hex(-1, 0, TERRAIN_FOREST, SiteType.MagicalGlade), // W - forest + glade
      hex(0, -1, TERRAIN_FOREST), // NW - forest
    ],
  },

  // Countryside 6 - Hills center with Monster Den, Mountain, Dungeon, Orc Marauders
  [TileId.Countryside6]: {
    id: TileId.Countryside6,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_HILLS, SiteType.MonsterDen), // Center - monster den
      hex(1, -1, TERRAIN_FOREST), // NE - forest
      hex(1, 0, TERRAIN_PLAINS), // E - plains
      hex(0, 1, TERRAIN_FOREST, null, { rampaging: RampagingEnemyType.OrcMarauder }), // SE - forest + orcs
      hex(-1, 1, TERRAIN_HILLS, SiteType.Dungeon), // SW - dungeon
      hex(-1, 0, TERRAIN_HILLS, SiteType.Dungeon), // W - dungeon (second cave)
      hex(0, -1, TERRAIN_MOUNTAIN), // NW - mountain
    ],
  },

  // Countryside 7 - Swamp center, Monastery, Ancient Ruins, Magical Glade, Orc Marauders
  [TileId.Countryside7]: {
    id: TileId.Countryside7,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_SWAMP), // Center - swamp
      hex(1, -1, TERRAIN_FOREST, null, { rampaging: RampagingEnemyType.OrcMarauder }), // NE - forest + orcs
      hex(1, 0, TERRAIN_FOREST, SiteType.MagicalGlade), // E - forest + glade
      hex(0, 1, TERRAIN_PLAINS, SiteType.AncientRuins), // SE - ancient ruins
      hex(-1, 1, TERRAIN_PLAINS), // SW - plains
      hex(-1, 0, TERRAIN_PLAINS, SiteType.Monastery), // W - monastery
      hex(0, -1, TERRAIN_LAKE), // NW - lake
    ],
  },

  // Countryside 8 - Swamp center with Orc Marauders, Ancient Ruins, Village, Magical Glade
  [TileId.Countryside8]: {
    id: TileId.Countryside8,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_SWAMP, null, { rampaging: RampagingEnemyType.OrcMarauder }), // Center - swamp + orcs
      hex(1, -1, TERRAIN_FOREST, SiteType.AncientRuins), // NE - forest + ruins
      hex(1, 0, TERRAIN_PLAINS), // E - plains
      hex(0, 1, TERRAIN_SWAMP, SiteType.Village), // SE - swamp village
      hex(-1, 1, TERRAIN_FOREST), // SW - forest
      hex(-1, 0, TERRAIN_FOREST), // W - forest
      hex(0, -1, TERRAIN_FOREST, SiteType.MagicalGlade), // NW - forest + glade
    ],
  },

  // Countryside 9 - Mountain center, Keep, Mage Tower, Ancient Ruins
  [TileId.Countryside9]: {
    id: TileId.Countryside9,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_MOUNTAIN), // Center - mountain
      hex(1, -1, TERRAIN_MOUNTAIN), // NE - mountain
      hex(1, 0, TERRAIN_HILLS, SiteType.Keep), // E - keep
      hex(0, 1, TERRAIN_PLAINS, SiteType.MageTower), // SE - mage tower
      hex(-1, 1, TERRAIN_PLAINS), // SW - plains
      hex(-1, 0, TERRAIN_PLAINS), // W - plains
      hex(0, -1, TERRAIN_HILLS, SiteType.AncientRuins), // NW - ancient ruins
    ],
  },

  // Countryside 10 - Mountain center, Keep, Ancient Ruins, Dungeon
  [TileId.Countryside10]: {
    id: TileId.Countryside10,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_MOUNTAIN), // Center - mountain
      hex(1, -1, TERRAIN_FOREST), // NE - forest
      hex(1, 0, TERRAIN_PLAINS), // E - plains
      hex(0, 1, TERRAIN_PLAINS, SiteType.AncientRuins), // SE - ancient ruins
      hex(-1, 1, TERRAIN_HILLS, SiteType.Keep), // SW - keep
      hex(-1, 0, TERRAIN_HILLS), // W - hills
      hex(0, -1, TERRAIN_HILLS, SiteType.Dungeon), // NW - dungeon
    ],
  },

  // Countryside 11 - Mage Tower center, Lakes, Ancient Ruins, Orc Marauders
  [TileId.Countryside11]: {
    id: TileId.Countryside11,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.MageTower), // Center - mage tower
      hex(1, -1, TERRAIN_LAKE), // NE - lake
      hex(1, 0, TERRAIN_LAKE), // E - lake
      hex(0, 1, TERRAIN_PLAINS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // SE - plains + orcs
      hex(-1, 1, TERRAIN_LAKE), // SW - lake
      hex(-1, 0, TERRAIN_PLAINS, SiteType.AncientRuins), // W - ancient ruins
      hex(0, -1, TERRAIN_HILLS), // NW - hills
    ],
  },

  // ============================================================================
  // COUNTRYSIDE TILES (Green back) - Lost Legion Expansion
  // ============================================================================

  // Countryside 12 - Orc Marauders with walls, Monastery, Maze, Refugee Camp
  [TileId.Countryside12]: {
    id: TileId.Countryside12,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // Center - plains + orcs (walled)
      hex(1, -1, TERRAIN_WASTELAND), // NE - wasteland
      hex(1, 0, TERRAIN_HILLS, SiteType.Monastery), // E - monastery
      hex(0, 1, TERRAIN_MOUNTAIN), // SE - mountain
      hex(-1, 1, TERRAIN_PLAINS, SiteType.Maze), // SW - maze (6/4/2)
      hex(-1, 0, TERRAIN_HILLS, SiteType.RefugeeCamp), // W - refugee camp
      hex(0, -1, TERRAIN_MOUNTAIN), // NW - mountain
    ],
  },

  // Countryside 13 - Mage Tower with walls, Mine, Magical Glade, Orc Marauders
  [TileId.Countryside13]: {
    id: TileId.Countryside13,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_FOREST, SiteType.MageTower), // Center - mage tower (walled)
      hex(1, -1, TERRAIN_HILLS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // NE - hills + orcs
      hex(1, 0, TERRAIN_LAKE), // E - lake
      hex(0, 1, TERRAIN_FOREST, SiteType.Mine, { mineColor: MINE_COLOR_BLUE }), // SE - blue mine
      hex(-1, 1, TERRAIN_PLAINS), // SW - plains
      hex(-1, 0, TERRAIN_FOREST, SiteType.MagicalGlade), // W - forest + glade
      hex(0, -1, TERRAIN_FOREST), // NW - forest
    ],
  },

  // Countryside 14 - Desert, Keep with walls, Maze, Village, Deep Mine
  [TileId.Countryside14]: {
    id: TileId.Countryside14,
    type: TILE_TYPE_COUNTRYSIDE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_DESERT), // Center - desert
      hex(1, -1, TERRAIN_PLAINS, SiteType.Keep), // NE - keep (walled)
      hex(1, 0, TERRAIN_HILLS, SiteType.Maze), // E - maze (6/4/2)
      hex(0, 1, TERRAIN_SWAMP, SiteType.Village), // SE - swamp village
      hex(-1, 1, TERRAIN_PLAINS), // SW - plains
      hex(-1, 0, TERRAIN_DESERT, SiteType.DeepMine), // W - deep mine (red/white crystals)
      hex(0, -1, TERRAIN_DESERT), // NW - desert
    ],
  },

  // ============================================================================
  // CORE TILES (Brown back) - Non-city - Base Game
  // ============================================================================

  // Core 1 - Monastery, Ancient Ruins, Spawning Grounds
  [TileId.Core1]: {
    id: TileId.Core1,
    type: TILE_TYPE_CORE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_DESERT, SiteType.Monastery), // Center - monastery
      hex(1, -1, TERRAIN_DESERT, SiteType.AncientRuins), // NE - ancient ruins
      hex(1, 0, TERRAIN_DESERT), // E - desert
      hex(0, 1, TERRAIN_DESERT), // SE - desert
      hex(-1, 1, TERRAIN_HILLS, SiteType.SpawningGrounds), // SW - spawning grounds
      hex(-1, 0, TERRAIN_HILLS, SiteType.SpawningGrounds), // W - spawning grounds
      hex(0, -1, TERRAIN_MOUNTAIN), // NW - mountain
    ],
  },

  // Core 2 - Lake center, Mage Tower, Ancient Ruins, Tomb, Draconum
  [TileId.Core2]: {
    id: TileId.Core2,
    type: TILE_TYPE_CORE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_LAKE), // Center - lake
      hex(1, -1, TERRAIN_WASTELAND, SiteType.AncientRuins), // NE - ancient ruins
      hex(1, 0, TERRAIN_HILLS, SiteType.Tomb), // E - tomb
      hex(0, 1, TERRAIN_WASTELAND, null, { rampaging: RampagingEnemyType.Draconum }), // SE - wasteland + draconum
      hex(-1, 1, TERRAIN_FOREST, SiteType.MageTower), // SW - mage tower
      hex(-1, 0, TERRAIN_FOREST), // W - forest
      hex(0, -1, TERRAIN_LAKE), // NW - lake
    ],
  },

  // Core 3 - Wasteland center, Mage Tower, Ancient Ruins, Tombs
  [TileId.Core3]: {
    id: TileId.Core3,
    type: TILE_TYPE_CORE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_WASTELAND), // Center - wasteland
      hex(1, -1, TERRAIN_WASTELAND, SiteType.AncientRuins), // NE - ancient ruins
      hex(1, 0, TERRAIN_SWAMP, SiteType.MageTower), // E - mage tower
      hex(0, 1, TERRAIN_WASTELAND, SiteType.Tomb), // SE - tomb
      hex(-1, 1, TERRAIN_WASTELAND, SiteType.Tomb), // SW - tomb
      hex(-1, 0, TERRAIN_WASTELAND, SiteType.AncientRuins), // W - ancient ruins
      hex(0, -1, TERRAIN_MOUNTAIN), // NW - mountain
    ],
  },

  // Core 4 - Mountain center with Draconum, Keep, Tomb, Ancient Ruins
  [TileId.Core4]: {
    id: TileId.Core4,
    type: TILE_TYPE_CORE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_MOUNTAIN, null, { rampaging: RampagingEnemyType.Draconum }), // Center - mountain + draconum
      hex(1, -1, TERRAIN_HILLS, SiteType.Tomb), // NE - tomb (blue crystal)
      hex(1, 0, TERRAIN_HILLS), // E - hills
      hex(0, 1, TERRAIN_WASTELAND), // SE - wasteland
      hex(-1, 1, TERRAIN_WASTELAND, SiteType.AncientRuins), // SW - ancient ruins
      hex(-1, 0, TERRAIN_WASTELAND), // W - wasteland
      hex(0, -1, TERRAIN_WASTELAND, SiteType.Keep), // NW - keep
    ],
  },

  // ============================================================================
  // CORE TILES (Brown back) - City Tiles - Base Game
  // ============================================================================

  // Core 5 - Green City
  [TileId.Core5GreenCity]: {
    id: TileId.Core5GreenCity,
    type: TILE_TYPE_CORE,
    hasCity: true,
    cityColor: CITY_COLOR_GREEN,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.City), // Center - Green City
      hex(1, -1, TERRAIN_WASTELAND, SiteType.Village), // NE - village
      hex(1, 0, TERRAIN_WASTELAND, null, { rampaging: RampagingEnemyType.Draconum }), // E - wasteland + draconum
      hex(0, 1, TERRAIN_WASTELAND, null, { rampaging: RampagingEnemyType.Draconum }), // SE - wasteland + draconum
      hex(-1, 1, TERRAIN_FOREST), // SW - forest
      hex(-1, 0, TERRAIN_LAKE), // W - lake
      hex(0, -1, TERRAIN_FOREST, SiteType.MagicalGlade), // NW - forest + glade
    ],
  },

  // Core 6 - Blue City
  [TileId.Core6BlueCity]: {
    id: TileId.Core6BlueCity,
    type: TILE_TYPE_CORE,
    hasCity: true,
    cityColor: CITY_COLOR_BLUE,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.City), // Center - Blue City
      hex(1, -1, TERRAIN_PLAINS, SiteType.Monastery), // NE - monastery
      hex(1, 0, TERRAIN_LAKE), // E - lake
      hex(0, 1, TERRAIN_LAKE), // SE - lake
      hex(-1, 1, TERRAIN_HILLS), // SW - hills
      hex(-1, 0, TERRAIN_MOUNTAIN, null, { rampaging: RampagingEnemyType.Draconum }), // W - mountain + draconum
      hex(0, -1, TERRAIN_FOREST), // NW - forest
    ],
  },

  // Core 7 - White City
  [TileId.Core7WhiteCity]: {
    id: TileId.Core7WhiteCity,
    type: TILE_TYPE_CORE,
    hasCity: true,
    cityColor: CITY_COLOR_WHITE,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.City), // Center - White City
      hex(1, -1, TERRAIN_PLAINS), // NE - plains
      hex(1, 0, TERRAIN_FOREST), // E - forest
      hex(0, 1, TERRAIN_LAKE, null, { rampaging: RampagingEnemyType.Draconum }), // SE - lake + draconum
      hex(-1, 1, TERRAIN_LAKE), // SW - lake
      hex(-1, 0, TERRAIN_HILLS, SiteType.Keep), // W - keep
      hex(0, -1, TERRAIN_HILLS, SiteType.SpawningGrounds), // NW - spawning grounds
    ],
  },

  // Core 8 - Red City
  [TileId.Core8RedCity]: {
    id: TileId.Core8RedCity,
    type: TILE_TYPE_CORE,
    hasCity: true,
    cityColor: CITY_COLOR_RED,
    hexes: [
      hex(0, 0, TERRAIN_WASTELAND, SiteType.City), // Center - Red City
      hex(1, -1, TERRAIN_HILLS, SiteType.SpawningGrounds), // NE - spawning grounds
      hex(1, 0, TERRAIN_DESERT), // E - desert
      hex(0, 1, TERRAIN_DESERT, null, { rampaging: RampagingEnemyType.Draconum }), // SE - desert + draconum
      hex(-1, 1, TERRAIN_WASTELAND), // SW - wasteland
      hex(-1, 0, TERRAIN_WASTELAND, null, { rampaging: RampagingEnemyType.Draconum }), // W - wasteland + draconum
      hex(0, -1, TERRAIN_WASTELAND, SiteType.AncientRuins), // NW - ancient ruins
    ],
  },

  // ============================================================================
  // CORE TILES (Brown back) - Lost Legion Expansion
  // ============================================================================

  // Core 9 - Draconum center with walls, Mage Tower, Labyrinth, Refugee Camp
  [TileId.Core9]: {
    id: TileId.Core9,
    type: TILE_TYPE_CORE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, null, { rampaging: RampagingEnemyType.Draconum }), // Center - plains + draconum (walled)
      hex(1, -1, TERRAIN_SWAMP, SiteType.MageTower), // NE - mage tower
      hex(1, 0, TERRAIN_MOUNTAIN), // E - mountain
      hex(0, 1, TERRAIN_DESERT, SiteType.RefugeeCamp), // SE - refugee camp
      hex(-1, 1, TERRAIN_DESERT), // SW - desert
      hex(-1, 0, TERRAIN_WASTELAND), // W - wasteland (walled)
      hex(0, -1, TERRAIN_HILLS, SiteType.Labyrinth), // NW - labyrinth (6/4/2)
    ],
  },

  // Core 10 - Wasteland center, Deep Mine, Labyrinth, Keep with walls, Orc Marauders
  [TileId.Core10]: {
    id: TileId.Core10,
    type: TILE_TYPE_CORE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_WASTELAND), // Center - wasteland
      hex(1, -1, TERRAIN_LAKE), // NE - lake
      hex(1, 0, TERRAIN_FOREST, SiteType.Labyrinth), // E - labyrinth (6/4/2)
      hex(0, 1, TERRAIN_HILLS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // SE - hills + orcs
      hex(-1, 1, TERRAIN_HILLS, null, { rampaging: RampagingEnemyType.OrcMarauder }), // SW - hills + orcs
      hex(-1, 0, TERRAIN_FOREST, SiteType.Keep), // W - keep (walled)
      hex(0, -1, TERRAIN_WASTELAND, SiteType.DeepMine), // NW - deep mine (4 colors)
    ],
  },

  // ============================================================================
  // SPECIAL TILES - Lost Legion Expansion
  // ============================================================================

  // Volkare's Camp
  [TileId.CoreVolkare]: {
    id: TileId.CoreVolkare,
    type: TILE_TYPE_CORE,
    hasCity: false,
    hexes: [
      hex(0, 0, TERRAIN_PLAINS, SiteType.VolkaresCamp), // Center - Volkare's Camp (walled)
      hex(1, -1, TERRAIN_MOUNTAIN), // NE - mountain
      hex(1, 0, TERRAIN_WASTELAND, null, { rampaging: RampagingEnemyType.Draconum }), // E - wasteland + draconum
      hex(0, 1, TERRAIN_DESERT, SiteType.Village), // SE - village (walled)
      hex(-1, 1, TERRAIN_HILLS), // SW - hills
      hex(-1, 0, TERRAIN_LAKE), // W - lake
      hex(0, -1, TERRAIN_FOREST, null, { rampaging: RampagingEnemyType.OrcMarauder }), // NW - forest + orcs
    ],
  },
};

/**
 * Place a tile on the map at the given world coordinates.
 * Converts local hex coordinates to world coordinates.
 */
export function placeTile(tileId: TileId, centerCoord: HexCoord): HexState[] {
  const definition = TILE_DEFINITIONS[tileId];
  if (!definition) {
    throw new Error(`Unknown tile: ${tileId}`);
  }

  return definition.hexes.map((localHex) => {
    // Convert local coords to world coords by adding to center
    const worldCoord: HexCoord = {
      q: centerCoord.q + localHex.localQ,
      r: centerCoord.r + localHex.localR,
    };

    // Create site if one exists on this hex
    const site: Site | null = localHex.site
      ? {
          type: localHex.site,
          owner: null,
          isConquered: false,
          isBurned: false,
          // City color from tile definition
          ...(localHex.site === SiteType.City &&
            definition.cityColor && { cityColor: definition.cityColor }),
          // Mine color from hex definition
          ...(localHex.site === SiteType.Mine &&
            localHex.mineColor && { mineColor: localHex.mineColor }),
        }
      : null;

    // Rampaging enemies from hex definition
    const rampagingEnemies: RampagingEnemyType[] = localHex.rampaging
      ? [localHex.rampaging]
      : [];

    return {
      coord: worldCoord,
      terrain: localHex.terrain,
      tileId,
      site,
      rampagingEnemies,
      enemies: [],
      shieldTokens: [],
    };
  });
}

/**
 * Get all tile IDs of a specific type
 */
export function getTilesByType(type: TileType): TileId[] {
  return Object.values(TILE_DEFINITIONS)
    .filter((def) => def.type === type)
    .map((def) => def.id);
}

/**
 * Get all base game tiles (excludes expansion content)
 */
export function getBaseGameTiles(): TileId[] {
  const expansionTiles = [
    TileId.Countryside12,
    TileId.Countryside13,
    TileId.Countryside14,
    TileId.Core9,
    TileId.Core10,
    TileId.CoreVolkare,
  ];
  return Object.keys(TILE_DEFINITIONS).filter(
    (id) => !expansionTiles.includes(id as TileId)
  ) as TileId[];
}

/**
 * Get all Lost Legion expansion tiles
 */
export function getExpansionTiles(): TileId[] {
  return [
    TileId.Countryside12,
    TileId.Countryside13,
    TileId.Countryside14,
    TileId.Core9,
    TileId.Core10,
    TileId.CoreVolkare,
  ];
}
