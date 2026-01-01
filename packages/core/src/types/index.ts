/**
 * Core types for Mage Knight game
 *
 * Note: CardId, SkillId, ManaColor, BasicManaColor are defined in @mage-knight/shared
 * and should be imported from there directly.
 */

// Player types
export type {
  TacticCardId,
  ManaToken,
  SkillCooldowns,
  Crystals,
  PlayerUnit,
  Player,
} from "./player.js";

// Hero types
export type { HeroDefinition } from "./hero.js";
export { Hero, HEROES } from "./hero.js";

// Enemy types (before map, since map imports EnemyTokenId)
export type {
  EnemyTokenId,
  EnemyColor,
  AttackType,
  EnemyAbility,
  EnemyToken,
  EnemyTokenPiles,
} from "./enemy.js";
export { createEmptyEnemyTokenPiles } from "./enemy.js";

// Map types
export type {
  CityColor,
  MineColor,
  Site,
  HexState,
  TilePlacement,
  TileDeck,
  MapState,
} from "./map.js";
export { TileId, SiteType, RampagingEnemyType, createEmptyMapState } from "./map.js";

// Mana source types
export type {
  SpecialManaColor,
  SourceDie,
  ManaSource,
} from "./mana.js";
export { createEmptyManaSource } from "./mana.js";

// Offers types
export type { CardOffer, GameOffers } from "./offers.js";
export { createEmptyOffers } from "./offers.js";

// Card types
export type {
  DeedCardType,
  CardEffect,
  DeedCard,
  RecruitmentSite,
  UnitTier,
  UnitAbility,
  UnitCard,
} from "./cards.js";

// Deck types
export type { GameDecks } from "./decks.js";
export { createEmptyDecks } from "./decks.js";

// City types
export type { CityShield, CityState } from "./city.js";
export { determineCityLeader, createCityState } from "./city.js";
