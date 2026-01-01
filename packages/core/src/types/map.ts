/**
 * Map types for Mage Knight
 */

import type { HexCoord, Terrain } from "@mage-knight/shared";
import type { EnemyTokenId } from "./enemy.js";

// Game tiles
export enum TileId {
  // Starting tiles
  StartingTileA = "starting_a",
  StartingTileB = "starting_b",

  // Countryside tiles (green back)
  Countryside1 = "countryside_1",
  Countryside2 = "countryside_2",
  Countryside3 = "countryside_3",

  // Core tiles (brown back)
  Core1 = "core_1",
  Core2 = "core_2",
  CoreCity1 = "core_city_1",
}

// City colors for city sites
export type CityColor = "red" | "blue" | "green" | "white";

// Mine colors (mana types that can be mined - basic crystals only)
export type MineColor = "red" | "blue" | "green" | "white";

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
  Portal = "portal",

  // Cities (fortified)
  City = "city",
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
