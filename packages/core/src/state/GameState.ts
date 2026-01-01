/**
 * Game state types and management
 */

import type { Player } from "../types/player.js";
import {
  type MapState,
  type CityColor,
  createEmptyMapState,
} from "../types/map.js";
import { type ManaSource, createEmptyManaSource } from "../types/mana.js";
import { type GameOffers, createEmptyOffers } from "../types/offers.js";
import {
  type EnemyTokenPiles,
  createEmptyEnemyTokenPiles,
} from "../types/enemy.js";
import { type GameDecks, createEmptyDecks } from "../types/decks.js";
import type { CityState } from "../types/city.js";

export type GamePhase =
  | "setup"
  | "round"
  | "end";

// Combat state - will be fleshed out when we build combat
export interface CombatState {
  readonly _placeholder?: undefined; // TODO: enemies, phases, damage assignment, etc.
}

export type TimeOfDay = "day" | "night";

// Re-export types for convenience
export type { MapState } from "../types/map.js";
export type { ManaSource } from "../types/mana.js";
export type { GameOffers } from "../types/offers.js";
export type { EnemyTokenPiles } from "../types/enemy.js";
export type { GameDecks } from "../types/decks.js";
export type { CityState } from "../types/city.js";

export interface GameState {
  readonly phase: GamePhase;
  readonly timeOfDay: TimeOfDay;
  readonly round: number;
  readonly turnOrder: readonly string[]; // player IDs in current round order
  readonly currentPlayerIndex: number; // index into turnOrder
  readonly endOfRoundAnnouncedBy: string | null; // player ID who announced
  readonly players: readonly Player[];
  readonly map: MapState;
  readonly combat: CombatState | null; // null when not in combat

  // Mana source (dice pool)
  readonly source: ManaSource;

  // All offers
  readonly offers: GameOffers;

  // Enemy tokens
  readonly enemyTokens: EnemyTokenPiles;

  // All draw decks (spells, advanced actions, artifacts, units)
  readonly decks: GameDecks;

  // City states (only revealed cities have entries)
  readonly cities: Partial<Record<CityColor, CityState>>;

  // Wound pile (effectively unlimited)
  readonly woundPileCount: number;

  // Scenario tracking
  readonly scenarioEndTriggered: boolean; // distinct from endOfRoundAnnouncedBy
}

export function createInitialGameState(): GameState {
  return {
    phase: "setup",
    timeOfDay: "day",
    round: 1,
    turnOrder: [],
    currentPlayerIndex: 0,
    endOfRoundAnnouncedBy: null,
    players: [],
    map: createEmptyMapState(),
    combat: null,
    source: createEmptyManaSource(),
    offers: createEmptyOffers(),
    enemyTokens: createEmptyEnemyTokenPiles(),
    decks: createEmptyDecks(),
    cities: {},
    woundPileCount: 10, // start with some wounds available
    scenarioEndTriggered: false,
  };
}
