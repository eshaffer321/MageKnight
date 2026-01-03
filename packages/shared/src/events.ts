/**
 * Game event types - discriminated union for all events emitted by the engine
 */

import type { HexCoord } from "./hex.js";
import type { CardId, SkillId, ManaColor } from "./ids.js";
import {
  CARD_GAIN_SOURCE_LEVEL_UP,
  CARD_GAIN_SOURCE_OFFER,
  CARD_GAIN_SOURCE_REWARD,
  OFFER_TYPE_ADVANCED_ACTIONS,
  OFFER_TYPE_SPELLS,
  OFFER_TYPE_UNITS,
  UNDO_FAILED_CHECKPOINT_REACHED,
  UNDO_FAILED_NOTHING_TO_UNDO,
  UNDO_FAILED_NOT_YOUR_TURN,
  UNIT_DESTROY_REASON_DISBANDED,
  UNIT_DESTROY_REASON_PARALYZE,
  WOUND_TARGET_HERO,
} from "./valueConstants.js";

// Game lifecycle events
export const GAME_STARTED = "GAME_STARTED" as const;
export interface GameStartedEvent {
  readonly type: typeof GAME_STARTED;
  readonly playerCount: number;
  readonly scenario: string;
}

export const ROUND_STARTED = "ROUND_STARTED" as const;
export interface RoundStartedEvent {
  readonly type: typeof ROUND_STARTED;
  readonly round: number;
  readonly isDay: boolean;
}

export const TURN_STARTED = "TURN_STARTED" as const;
export interface TurnStartedEvent {
  readonly type: typeof TURN_STARTED;
  readonly playerIndex: number;
}

export const TURN_ENDED = "TURN_ENDED" as const;
export interface TurnEndedEvent {
  readonly type: typeof TURN_ENDED;
  readonly playerId: string;
  readonly nextPlayerId: string | null; // null if round ended
}

export const ROUND_ENDED = "ROUND_ENDED" as const;
export interface RoundEndedEvent {
  readonly type: typeof ROUND_ENDED;
  readonly round: number;
}

export const GAME_ENDED = "GAME_ENDED" as const;
export interface GameEndedEvent {
  readonly type: typeof GAME_ENDED;
  readonly winner: number | null;
}

export const END_OF_ROUND_ANNOUNCED = "END_OF_ROUND_ANNOUNCED" as const;
export interface EndOfRoundAnnouncedEvent {
  readonly type: typeof END_OF_ROUND_ANNOUNCED;
  readonly playerId: string;
}

// Movement events
export const PLAYER_MOVED = "PLAYER_MOVED" as const;
export interface PlayerMovedEvent {
  readonly type: typeof PLAYER_MOVED;
  readonly playerId: string;
  readonly from: HexCoord;
  readonly to: HexCoord;
}

export function createPlayerMovedEvent(
  playerId: string,
  from: HexCoord,
  to: HexCoord
): PlayerMovedEvent {
  return {
    type: PLAYER_MOVED,
    playerId,
    from,
    to,
  };
}

export const TILE_REVEALED = "TILE_REVEALED" as const;
export interface TileRevealedEvent {
  readonly type: typeof TILE_REVEALED;
  readonly playerId: string;
  readonly position: HexCoord;
  readonly tileId: string;
}

export function createTileRevealedEvent(
  playerId: string,
  position: HexCoord,
  tileId: string
): TileRevealedEvent {
  return {
    type: TILE_REVEALED,
    playerId,
    position,
    tileId,
  };
}

export const TILE_EXPLORED = "TILE_EXPLORED" as const;
export interface TileExploredEvent {
  readonly type: typeof TILE_EXPLORED;
  readonly playerId: string;
  readonly tileId: string;
  readonly position: HexCoord;
  readonly rotation: number;
  readonly newHexes: readonly HexCoord[];
}

export function createTileExploredEvent(
  playerId: string,
  tileId: string,
  position: HexCoord,
  rotation: number,
  newHexes: readonly HexCoord[]
): TileExploredEvent {
  return {
    type: TILE_EXPLORED,
    playerId,
    tileId,
    position,
    rotation,
    newHexes,
  };
}

// Combat events
export const COMBAT_STARTED = "COMBAT_STARTED" as const;
export interface CombatStartedEvent {
  readonly type: typeof COMBAT_STARTED;
  readonly playerIndex: number;
  readonly position: HexCoord;
  readonly enemies: readonly string[];
}

export const COMBAT_ENDED = "COMBAT_ENDED" as const;
export interface CombatEndedEvent {
  readonly type: typeof COMBAT_ENDED;
  readonly playerIndex: number;
  readonly victory: boolean;
}

// Card events
export const CARD_PLAYED = "CARD_PLAYED" as const;
export interface CardPlayedEvent {
  readonly type: typeof CARD_PLAYED;
  readonly playerId: string;
  readonly cardId: CardId;
  readonly powered: boolean;
  readonly sideways: boolean;
  readonly effect: string;
}

export const CARD_DRAWN = "CARD_DRAWN" as const;
export interface CardDrawnEvent {
  readonly type: typeof CARD_DRAWN;
  readonly playerId: string;
  readonly count: number;
}

export const CARD_DISCARDED = "CARD_DISCARDED" as const;
export interface CardDiscardedEvent {
  readonly type: typeof CARD_DISCARDED;
  readonly playerId: string;
  readonly cardId: CardId;
}

export const CARD_GAINED = "CARD_GAINED" as const;
export interface CardGainedEvent {
  readonly type: typeof CARD_GAINED;
  readonly playerId: string;
  readonly cardId: CardId;
  readonly source:
    | typeof CARD_GAIN_SOURCE_OFFER
    | typeof CARD_GAIN_SOURCE_REWARD
    | typeof CARD_GAIN_SOURCE_LEVEL_UP;
}

// Mana events
export const MANA_DIE_TAKEN = "MANA_DIE_TAKEN" as const;
export interface ManaDieTakenEvent {
  readonly type: typeof MANA_DIE_TAKEN;
  readonly playerId: string;
  readonly dieId: string;
  readonly color: ManaColor;
}

export const MANA_DIE_RETURNED = "MANA_DIE_RETURNED" as const;
export interface ManaDieReturnedEvent {
  readonly type: typeof MANA_DIE_RETURNED;
  readonly dieId: string;
  readonly newColor: ManaColor;
}

export const CRYSTAL_CONVERTED = "CRYSTAL_CONVERTED" as const;
export interface CrystalConvertedEvent {
  readonly type: typeof CRYSTAL_CONVERTED;
  readonly playerId: string;
  readonly color: ManaColor;
}

// Health/damage events
export const WOUND_RECEIVED = "WOUND_RECEIVED" as const;
export interface WoundReceivedEvent {
  readonly type: typeof WOUND_RECEIVED;
  readonly playerId: string;
  readonly target: typeof WOUND_TARGET_HERO | { readonly unit: number };
  readonly source: string;
}

export const WOUND_HEALED = "WOUND_HEALED" as const;
export interface WoundHealedEvent {
  readonly type: typeof WOUND_HEALED;
  readonly playerId: string;
  readonly target: typeof WOUND_TARGET_HERO | { readonly unit: number };
}

// Progression events
export const FAME_GAINED = "FAME_GAINED" as const;
export interface FameGainedEvent {
  readonly type: typeof FAME_GAINED;
  readonly playerId: string;
  readonly amount: number;
  readonly newTotal: number;
  readonly source: string;
}

export const FAME_LOST = "FAME_LOST" as const;
export interface FameLostEvent {
  readonly type: typeof FAME_LOST;
  readonly playerId: string;
  readonly amount: number;
  readonly newTotal: number;
  readonly source: string;
}

export const REPUTATION_CHANGED = "REPUTATION_CHANGED" as const;
export interface ReputationChangedEvent {
  readonly type: typeof REPUTATION_CHANGED;
  readonly playerId: string;
  readonly delta: number;
  readonly newValue: number;
  readonly reason: string;
}

export const LEVEL_UP = "LEVEL_UP" as const;
export interface LevelUpEvent {
  readonly type: typeof LEVEL_UP;
  readonly playerId: string;
  readonly newLevel: number;
  readonly newArmor: number;
  readonly newHandLimit: number;
}

// Unit events
export const UNIT_RECRUITED = "UNIT_RECRUITED" as const;
export interface UnitRecruitedEvent {
  readonly type: typeof UNIT_RECRUITED;
  readonly playerId: string;
  readonly cardId: CardId;
}

export const UNIT_ACTIVATED = "UNIT_ACTIVATED" as const;
export interface UnitActivatedEvent {
  readonly type: typeof UNIT_ACTIVATED;
  readonly playerId: string;
  readonly unitIndex: number;
  readonly ability: string;
}

export const UNIT_WOUNDED = "UNIT_WOUNDED" as const;
export interface UnitWoundedEvent {
  readonly type: typeof UNIT_WOUNDED;
  readonly playerId: string;
  readonly unitIndex: number;
}

export const UNIT_READIED = "UNIT_READIED" as const;
export interface UnitReadiedEvent {
  readonly type: typeof UNIT_READIED;
  readonly playerId: string;
  readonly unitIndex: number;
}

export const UNIT_DESTROYED = "UNIT_DESTROYED" as const;
export interface UnitDestroyedEvent {
  readonly type: typeof UNIT_DESTROYED;
  readonly playerId: string;
  readonly unitIndex: number;
  readonly reason:
    | typeof UNIT_DESTROY_REASON_PARALYZE
    | typeof UNIT_DESTROY_REASON_DISBANDED;
}

// Skill events
export const SKILL_USED = "SKILL_USED" as const;
export interface SkillUsedEvent {
  readonly type: typeof SKILL_USED;
  readonly playerId: string;
  readonly skillId: SkillId;
}

export const SKILL_GAINED = "SKILL_GAINED" as const;
export interface SkillGainedEvent {
  readonly type: typeof SKILL_GAINED;
  readonly playerId: string;
  readonly skillId: SkillId;
}

// Offer events
export const OFFER_REFRESHED = "OFFER_REFRESHED" as const;
export interface OfferRefreshedEvent {
  readonly type: typeof OFFER_REFRESHED;
  readonly offerType:
    | typeof OFFER_TYPE_UNITS
    | typeof OFFER_TYPE_ADVANCED_ACTIONS
    | typeof OFFER_TYPE_SPELLS;
}

export const OFFER_CARD_TAKEN = "OFFER_CARD_TAKEN" as const;
export interface OfferCardTakenEvent {
  readonly type: typeof OFFER_CARD_TAKEN;
  readonly offerType:
    | typeof OFFER_TYPE_UNITS
    | typeof OFFER_TYPE_ADVANCED_ACTIONS
    | typeof OFFER_TYPE_SPELLS;
  readonly cardId: CardId;
}

// Card undo events
export const CARD_PLAY_UNDONE = "CARD_PLAY_UNDONE" as const;
export interface CardPlayUndoneEvent {
  readonly type: typeof CARD_PLAY_UNDONE;
  readonly playerId: string;
  readonly cardId: CardId;
}

export function createCardPlayUndoneEvent(
  playerId: string,
  cardId: CardId
): CardPlayUndoneEvent {
  return {
    type: CARD_PLAY_UNDONE,
    playerId,
    cardId,
  };
}

// Undo events
export const MOVE_UNDONE = "MOVE_UNDONE" as const;
export interface MoveUndoneEvent {
  readonly type: typeof MOVE_UNDONE;
  readonly playerId: string;
  readonly from: HexCoord;
  readonly to: HexCoord;
}

export function createMoveUndoneEvent(
  playerId: string,
  from: HexCoord,
  to: HexCoord
): MoveUndoneEvent {
  return {
    type: MOVE_UNDONE,
    playerId,
    from,
    to,
  };
}

export const UNDO_FAILED = "UNDO_FAILED" as const;
export interface UndoFailedEvent {
  readonly type: typeof UNDO_FAILED;
  readonly playerId: string;
  readonly reason:
    | typeof UNDO_FAILED_NOTHING_TO_UNDO
    | typeof UNDO_FAILED_CHECKPOINT_REACHED
    | typeof UNDO_FAILED_NOT_YOUR_TURN;
}

export function createUndoFailedEvent(
  playerId: string,
  reason: UndoFailedEvent["reason"]
): UndoFailedEvent {
  return {
    type: UNDO_FAILED,
    playerId,
    reason,
  };
}

// Validation events
export const INVALID_ACTION = "INVALID_ACTION" as const;
export interface InvalidActionEvent {
  readonly type: typeof INVALID_ACTION;
  readonly playerId: string;
  readonly actionType: string;
  readonly reason: string;
}

export function createInvalidActionEvent(
  playerId: string,
  actionType: string,
  reason: string
): InvalidActionEvent {
  return {
    type: INVALID_ACTION,
    playerId,
    actionType,
    reason,
  };
}

export const UNDO_CHECKPOINT_SET = "UNDO_CHECKPOINT_SET" as const;
export interface UndoCheckpointSetEvent {
  readonly type: typeof UNDO_CHECKPOINT_SET;
  readonly playerId: string;
  readonly reason: string;
}

export function createUndoCheckpointSetEvent(
  playerId: string,
  reason: string
): UndoCheckpointSetEvent {
  return {
    type: UNDO_CHECKPOINT_SET,
    playerId,
    reason,
  };
}

export type GameEvent =
  // Game lifecycle
  | GameStartedEvent
  | RoundStartedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | RoundEndedEvent
  | GameEndedEvent
  | EndOfRoundAnnouncedEvent
  // Movement
  | PlayerMovedEvent
  | TileRevealedEvent
  | TileExploredEvent
  // Combat
  | CombatStartedEvent
  | CombatEndedEvent
  // Cards
  | CardPlayedEvent
  | CardDrawnEvent
  | CardDiscardedEvent
  | CardGainedEvent
  // Mana
  | ManaDieTakenEvent
  | ManaDieReturnedEvent
  | CrystalConvertedEvent
  // Health/damage
  | WoundReceivedEvent
  | WoundHealedEvent
  // Progression
  | FameGainedEvent
  | FameLostEvent
  | ReputationChangedEvent
  | LevelUpEvent
  // Units
  | UnitRecruitedEvent
  | UnitActivatedEvent
  | UnitWoundedEvent
  | UnitReadiedEvent
  | UnitDestroyedEvent
  // Skills
  | SkillUsedEvent
  | SkillGainedEvent
  // Offers
  | OfferRefreshedEvent
  | OfferCardTakenEvent
  // Undo
  | CardPlayUndoneEvent
  | MoveUndoneEvent
  | UndoFailedEvent
  | UndoCheckpointSetEvent
  // Validation
  | InvalidActionEvent;

export type GameEventType = GameEvent["type"];
