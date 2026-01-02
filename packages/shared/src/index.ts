/**
 * @mage-knight/shared
 * Shared types and utilities for client and server
 */

// Branded IDs
export type { CardId, SkillId, BasicManaColor, ManaColor } from "./ids.js";

// Hex coordinates
export type { HexCoord, HexDirection } from "./hex.js";
export { HEX_DIRECTIONS, hexKey, getNeighbor, getAllNeighbors } from "./hex.js";

// Terrain
export type { Terrain, MovementCost, MovementCosts } from "./terrain.js";
export { DEFAULT_MOVEMENT_COSTS } from "./terrain.js";

// Events
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
  // Movement
  PlayerMovedEvent,
  TileRevealedEvent,
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
} from "./events.js";

// Actions
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
