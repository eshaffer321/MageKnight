/**
 * Map types for Mage Knight
 */

import type { HexCoord, Terrain } from "@mage-knight/shared";
import type { BasicManaColor } from "@mage-knight/shared";
import {
  BASIC_MANA_BLUE,
  BASIC_MANA_GREEN,
  BASIC_MANA_RED,
  BASIC_MANA_WHITE,
} from "@mage-knight/shared";
import type { EnemyTokenId } from "./enemy.js";
import {
  CITY_COLOR_BLUE,
  CITY_COLOR_GREEN,
  CITY_COLOR_RED,
  CITY_COLOR_WHITE,
  MINE_COLOR_BLUE,
  MINE_COLOR_GREEN,
  MINE_COLOR_RED,
  MINE_COLOR_WHITE,
} from "./mapConstants.js";

// Game tiles
export enum TileId {
  // Starting tiles (Portal)
  StartingTileA = "starting_a",
  StartingTileB = "starting_b",

  // Countryside tiles (green back) - Base game
  Countryside1 = "countryside_1",
  Countryside2 = "countryside_2",
  Countryside3 = "countryside_3",
  Countryside4 = "countryside_4",
  Countryside5 = "countryside_5",
  Countryside6 = "countryside_6",
  Countryside7 = "countryside_7",
  Countryside8 = "countryside_8",
  Countryside9 = "countryside_9",
  Countryside10 = "countryside_10",
  Countryside11 = "countryside_11",

  // Countryside tiles (green back) - Lost Legion expansion
  Countryside12 = "countryside_12",
  Countryside13 = "countryside_13",
  Countryside14 = "countryside_14",

  // Core tiles (brown back) - Non-city - Base game
  Core1 = "core_1",
  Core2 = "core_2",
  Core3 = "core_3",
  Core4 = "core_4",

  // Core tiles (brown back) - City tiles - Base game
  Core5GreenCity = "core_5_green_city",
  Core6BlueCity = "core_6_blue_city",
  Core7WhiteCity = "core_7_white_city",
  Core8RedCity = "core_8_red_city",

  // Core tiles (brown back) - Lost Legion expansion
  Core9 = "core_9",
  Core10 = "core_10",

  // Special tiles - Lost Legion expansion
  CoreVolkare = "core_volkare",
}

// City colors for city sites
export type CityColor =
  | typeof CITY_COLOR_RED
  | typeof CITY_COLOR_BLUE
  | typeof CITY_COLOR_GREEN
  | typeof CITY_COLOR_WHITE;

// Mine colors (mana types that can be mined - basic crystals only)
export type MineColor =
  | typeof MINE_COLOR_RED
  | typeof MINE_COLOR_BLUE
  | typeof MINE_COLOR_GREEN
  | typeof MINE_COLOR_WHITE;

/**
 * Explicit relationship: mines yield basic mana crystals.
 * Keep `MineColor` distinct from mana color domains, but allow conversion.
 */
export function mineColorToBasicManaColor(color: MineColor): BasicManaColor {
  switch (color) {
    case MINE_COLOR_RED:
      return BASIC_MANA_RED;
    case MINE_COLOR_BLUE:
      return BASIC_MANA_BLUE;
    case MINE_COLOR_GREEN:
      return BASIC_MANA_GREEN;
    case MINE_COLOR_WHITE:
      return BASIC_MANA_WHITE;
  }
}

// Site types that can exist on hexes
export enum SiteType {
  // Safe sites
  Village = "village",
  Monastery = "monastery",
  MagicalGlade = "magical_glade",

  // Fortified sites (require combat, Siege attacks)
  Keep = "keep",
  MageTower = "mage_tower",

  // Adventure sites (require combat)
  AncientRuins = "ancient_ruins",
  Dungeon = "dungeon",
  Tomb = "tomb",
  MonsterDen = "monster_den",
  SpawningGrounds = "spawning_grounds",

  // Resource sites
  Mine = "mine",
  DeepMine = "deep_mine", // Lost Legion - provides multiple crystal colors
  Portal = "portal",

  // Cities (fortified)
  City = "city",

  // Lost Legion expansion sites
  Maze = "maze", // Numbered adventure site (6/4/2)
  Labyrinth = "labyrinth", // Core version of Maze (6/4/2)
  RefugeeCamp = "refugee_camp", // Safe site similar to village
  VolkaresCamp = "volkares_camp", // Special site for Volkare scenario
}

// Rampaging enemy types that spawn on tile reveal
export enum RampagingEnemyType {
  OrcMarauder = "orc_marauder",
  Draconum = "draconum",
}

// Site on a hex
export interface Site {
  readonly type: SiteType;
  readonly owner: string | null; // player ID who conquered it
  readonly isConquered: boolean;
  readonly isBurned: boolean; // only relevant for monasteries
  // Subtypes for specific sites
  readonly cityColor?: CityColor;
  readonly mineColor?: MineColor;
}

// State of a single hex on the map
export interface HexState {
  readonly coord: HexCoord;
  readonly terrain: Terrain;
  readonly tileId: TileId;
  readonly site: Site | null;
  readonly rampagingEnemies: readonly RampagingEnemyType[]; // spawned on tile reveal
  readonly enemies: readonly EnemyTokenId[]; // enemy tokens from sites/events
  readonly shieldTokens: readonly string[]; // player IDs with shields here
}

// Where a tile was placed on the map
export interface TilePlacement {
  readonly tileId: TileId;
  readonly centerCoord: HexCoord;
  readonly revealed: boolean;
}

// The draw piles for tiles (tiles are permanent once placed, no discard)
export interface TileDeck {
  readonly countryside: readonly TileId[];
  readonly core: readonly TileId[];
}

// Full map state
export interface MapState {
  readonly hexes: Record<string, HexState>; // key is hexKey(coord)
  readonly tiles: readonly TilePlacement[];
  readonly tileDeck: TileDeck;
}

// Helper to create an empty map state
export function createEmptyMapState(): MapState {
  return {
    hexes: {},
    tiles: [],
    tileDeck: {
      countryside: [],
      core: [],
    },
  };
}
