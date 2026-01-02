/**
 * Terrain types and movement costs
 */

export type Terrain =
  | "plains"
  | "hills"
  | "forest"
  | "wasteland"
  | "desert"
  | "swamp"
  | "lake"
  | "mountain"
  | "ocean";

export const TERRAIN_PLAINS = "plains" as const;
export const TERRAIN_HILLS = "hills" as const;
export const TERRAIN_FOREST = "forest" as const;
export const TERRAIN_WASTELAND = "wasteland" as const;
export const TERRAIN_DESERT = "desert" as const;
export const TERRAIN_SWAMP = "swamp" as const;
export const TERRAIN_LAKE = "lake" as const;
export const TERRAIN_MOUNTAIN = "mountain" as const;
export const TERRAIN_OCEAN = "ocean" as const;

export interface MovementCost {
  readonly day: number;
  readonly night: number;
}

export type MovementCosts = Record<Terrain, MovementCost>;

export const DEFAULT_MOVEMENT_COSTS: MovementCosts = {
  plains: { day: 2, night: 3 },
  hills: { day: 3, night: 4 },
  forest: { day: 3, night: 5 },
  wasteland: { day: 4, night: 5 },
  desert: { day: 5, night: 3 },
  swamp: { day: 5, night: 5 },
  lake: { day: Infinity, night: Infinity },
  mountain: { day: Infinity, night: Infinity },
  ocean: { day: Infinity, night: Infinity },
};
