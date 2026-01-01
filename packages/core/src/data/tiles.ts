/**
 * Tile definitions for Mage Knight
 *
 * Each tile is a 7-hex cluster. Coordinates are relative to the tile center (0,0).
 * The 6 surrounding hexes use axial coordinate offsets.
 */

import type { Terrain, HexCoord } from "@mage-knight/shared";
import { TileId, SiteType, type HexState, type Site } from "../types/map.js";

// Hex definition within a tile template (before placement)
export interface LocalHex {
  readonly localQ: number;
  readonly localR: number;
  readonly terrain: Terrain;
  readonly site: SiteType | null;
}

// Tile type
export type TileType = "starting" | "countryside" | "core";

// Full tile definition
export interface TileDefinition {
  readonly id: TileId;
  readonly type: TileType;
  readonly hexes: readonly LocalHex[];
  readonly hasCity: boolean;
}

// Helper to create a local hex
function hex(
  localQ: number,
  localR: number,
  terrain: Terrain,
  site: SiteType | null = null
): LocalHex {
  return { localQ, localR, terrain, site };
}

// The 7 positions in a tile: center + 6 neighbors
// Center is (0, 0), neighbors follow axial coordinate offsets
// Axial offsets: NE(1,-1), E(1,0), SE(0,1), SW(-1,1), W(-1,0), NW(0,-1)

/**
 * Tile definitions
 *
 * Layout reference (flat-top hex orientation):
 *       NW  NE
 *     W  C   E
 *       SW  SE
 *
 * Axial offsets from center:
 *   NE: (1, -1), E: (1, 0), SE: (0, 1)
 *   SW: (-1, 1), W: (-1, 0), NW: (0, -1)
 */
export const TILE_DEFINITIONS: Record<TileId, TileDefinition> = {
  // Starting Tile A - Portal with mostly accessible terrain
  [TileId.StartingTileA]: {
    id: TileId.StartingTileA,
    type: "starting",
    hasCity: false,
    hexes: [
      hex(0, 0, "plains", SiteType.Portal), // Center - portal
      hex(1, -1, "plains"), // NE
      hex(1, 0, "forest"), // E
      hex(0, 1, "plains"), // SE
      hex(-1, 1, "hills"), // SW
      hex(-1, 0, "plains"), // W
      hex(0, -1, "forest"), // NW
    ],
  },

  // Starting Tile B - Alternate starting tile
  [TileId.StartingTileB]: {
    id: TileId.StartingTileB,
    type: "starting",
    hasCity: false,
    hexes: [
      hex(0, 0, "plains", SiteType.Portal), // Center - portal
      hex(1, -1, "forest"), // NE
      hex(1, 0, "plains"), // E
      hex(0, 1, "hills"), // SE
      hex(-1, 1, "plains"), // SW
      hex(-1, 0, "forest"), // W
      hex(0, -1, "plains"), // NW
    ],
  },

  // Countryside 1 - Village tile
  [TileId.Countryside1]: {
    id: TileId.Countryside1,
    type: "countryside",
    hasCity: false,
    hexes: [
      hex(0, 0, "plains", SiteType.Village), // Center - village
      hex(1, -1, "plains"), // NE
      hex(1, 0, "forest"), // E
      hex(0, 1, "hills"), // SE
      hex(-1, 1, "plains"), // SW
      hex(-1, 0, "lake"), // W - lake blocks movement
      hex(0, -1, "forest"), // NW
    ],
  },

  // Countryside 2 - Monastery tile
  [TileId.Countryside2]: {
    id: TileId.Countryside2,
    type: "countryside",
    hasCity: false,
    hexes: [
      hex(0, 0, "hills", SiteType.Monastery), // Center - monastery
      hex(1, -1, "forest"), // NE
      hex(1, 0, "plains"), // E
      hex(0, 1, "plains"), // SE
      hex(-1, 1, "forest"), // SW
      hex(-1, 0, "hills"), // W
      hex(0, -1, "plains"), // NW
    ],
  },

  // Countryside 3 - Keep and magical glade
  [TileId.Countryside3]: {
    id: TileId.Countryside3,
    type: "countryside",
    hasCity: false,
    hexes: [
      hex(0, 0, "forest", SiteType.Keep), // Center - keep
      hex(1, -1, "plains"), // NE
      hex(1, 0, "plains", SiteType.MagicalGlade), // E - glade
      hex(0, 1, "hills"), // SE
      hex(-1, 1, "swamp"), // SW
      hex(-1, 0, "forest"), // W
      hex(0, -1, "plains"), // NW
    ],
  },

  // Core 1 - Dungeon and spawning grounds
  [TileId.Core1]: {
    id: TileId.Core1,
    type: "core",
    hasCity: false,
    hexes: [
      hex(0, 0, "wasteland", SiteType.Dungeon), // Center - dungeon
      hex(1, -1, "hills"), // NE
      hex(1, 0, "wasteland", SiteType.SpawningGrounds), // E - spawning
      hex(0, 1, "mountain"), // SE - impassable
      hex(-1, 1, "desert"), // SW
      hex(-1, 0, "wasteland"), // W
      hex(0, -1, "hills"), // NW
    ],
  },

  // Core 2 - Mage tower and ancient ruins
  [TileId.Core2]: {
    id: TileId.Core2,
    type: "core",
    hasCity: false,
    hexes: [
      hex(0, 0, "hills", SiteType.MageTower), // Center - mage tower
      hex(1, -1, "wasteland"), // NE
      hex(1, 0, "desert", SiteType.AncientRuins), // E - ruins
      hex(0, 1, "hills"), // SE
      hex(-1, 1, "wasteland"), // SW
      hex(-1, 0, "mountain"), // W - impassable
      hex(0, -1, "desert"), // NW
    ],
  },

  // Core City 1 - Red city tile
  [TileId.CoreCity1]: {
    id: TileId.CoreCity1,
    type: "core",
    hasCity: true,
    hexes: [
      hex(0, 0, "plains", SiteType.City), // Center - city
      hex(1, -1, "hills"), // NE
      hex(1, 0, "wasteland"), // E
      hex(0, 1, "plains"), // SE
      hex(-1, 1, "desert"), // SW
      hex(-1, 0, "wasteland"), // W
      hex(0, -1, "hills"), // NW
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
          // City color would be set based on tile data - default to red for now
          ...(localHex.site === SiteType.City && { cityColor: "red" as const }),
        }
      : null;

    return {
      coord: worldCoord,
      terrain: localHex.terrain,
      tileId,
      site,
      rampagingEnemies: [], // spawned separately based on tile/scenario rules
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
