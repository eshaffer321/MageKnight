/**
 * @mage-knight/shared
 * Shared types and utilities for client and server
 */

// Branded IDs
export type { CardId, SkillId, BasicManaColor, SpecialManaColor, ManaColor } from "./ids.js";
export {
  // Mana color constants
  MANA_RED,
  MANA_BLUE,
  MANA_GREEN,
  MANA_WHITE,
  MANA_GOLD,
  MANA_BLACK,
  // Mana color arrays
  ALL_MANA_COLORS,
  BASIC_MANA_COLORS,
  // Back-compat aliases
  BASIC_MANA_RED,
  BASIC_MANA_BLUE,
  BASIC_MANA_GREEN,
  BASIC_MANA_WHITE,
} from "./ids.js";

// Card IDs
export * from "./cardIds.js";

// Hex coordinates
export type { HexCoord, HexDirection } from "./hex.js";
export { HEX_DIRECTIONS, hexKey, getNeighbor, getAllNeighbors } from "./hex.js";

// Terrain
export type { Terrain, MovementCost, MovementCosts } from "./terrain.js";
export {
  DEFAULT_MOVEMENT_COSTS,
  TERRAIN_PLAINS,
  TERRAIN_HILLS,
  TERRAIN_FOREST,
  TERRAIN_WASTELAND,
  TERRAIN_DESERT,
  TERRAIN_SWAMP,
  TERRAIN_LAKE,
  TERRAIN_MOUNTAIN,
  TERRAIN_OCEAN,
} from "./terrain.js";

// Shared state constants/types
export * from "./stateConstants.js";

// Events
export * from "./events.js";
export type {
  GameEvent,
  GameEventType,
  // Game lifecycle
  GameStartedEvent,
  RoundStartedEvent,
  TurnStartedEvent,
  TurnEndedEvent,
  RoundEndedEvent,
  GameEndedEvent,
  EndOfRoundAnnouncedEvent,
  PlayerRestedEvent,
  RestUndoneEvent,
  // Movement
  PlayerMovedEvent,
  TileRevealedEvent,
  TileExploredEvent,
  // Combat
  CombatStartedEvent,
  CombatEndedEvent,
  // Cards
  CardPlayedEvent,
  CardDrawnEvent,
  CardDiscardedEvent,
  CardGainedEvent,
  // Mana
  ManaDieTakenEvent,
  ManaDieReturnedEvent,
  CrystalConvertedEvent,
  // Health/damage
  WoundReceivedEvent,
  WoundHealedEvent,
  // Progression
  FameGainedEvent,
  FameLostEvent,
  ReputationChangedEvent,
  LevelUpEvent,
  // Units
  UnitRecruitedEvent,
  UnitActivatedEvent,
  UnitWoundedEvent,
  UnitReadiedEvent,
  UnitDestroyedEvent,
  // Skills
  SkillUsedEvent,
  SkillGainedEvent,
  // Offers
  OfferRefreshedEvent,
  OfferCardTakenEvent,
  // Undo
  MoveUndoneEvent,
  UndoFailedEvent,
  UndoCheckpointSetEvent,
  // Choice
  ChoiceRequiredEvent,
  ChoiceResolvedEvent,
} from "./events.js";

// Actions
export * from "./actions.js";
export type {
  PlayerAction,
  PlayerActionType,
  // Movement
  MoveAction,
  ExploreAction,
  // Turn structure
  EndTurnAction,
  RestAction,
  InteractAction,
  AnnounceEndOfRoundAction,
  // Card playing
  PlayCardAction,
  PlayCardSidewaysAction,
  ManaSourceInfo,
  // Mana usage
  UseManaDeieAction,
  ConvertCrystalAction,
  // Unit activation
  ActivateUnitAction,
  // Skill usage
  UseSkillAction,
  // Interactions
  RecruitUnitAction,
  BuySpellAction,
  LearnAdvancedActionAction,
  BuyHealingAction,
  // Undo
  UndoAction,
  // Choice resolution
  ResolveChoiceAction,
} from "./actions.js";

// Connection
export type {
  GameConnection,
  GameEngine,
  EventCallback,
  ActionResult,
} from "./connection.js";
export { LocalConnection } from "./connection.js";

// Client state types
export type {
  ClientCrystals,
  ClientPlayerUnit,
  ClientManaToken,
  ClientPlayer,
  ClientSourceDie,
  ClientManaSource,
  ClientSite,
  ClientHexState,
  ClientMapState,
  ClientCardOffer,
  ClientGameOffers,
  ClientGameState,
  ClientCombatState,
} from "./types/clientState.js";

// Shared value constants (sub-unions)
export * from "./valueConstants.js";
