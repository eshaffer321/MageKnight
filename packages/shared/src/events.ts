/**
 * Game event types - discriminated union for all events emitted by the engine
 */

import type { HexCoord } from "./hex.js";
import type { CardId, SkillId, ManaColor } from "./ids.js";

// Game lifecycle events
export interface GameStartedEvent {
  readonly type: "GAME_STARTED";
  readonly playerCount: number;
  readonly scenario: string;
}

export interface RoundStartedEvent {
  readonly type: "ROUND_STARTED";
  readonly round: number;
  readonly isDay: boolean;
}

export interface TurnStartedEvent {
  readonly type: "TURN_STARTED";
  readonly playerIndex: number;
}

export interface TurnEndedEvent {
  readonly type: "TURN_ENDED";
  readonly playerIndex: number;
}

export interface RoundEndedEvent {
  readonly type: "ROUND_ENDED";
  readonly round: number;
}

export interface GameEndedEvent {
  readonly type: "GAME_ENDED";
  readonly winner: number | null;
}

export interface EndOfRoundAnnouncedEvent {
  readonly type: "END_OF_ROUND_ANNOUNCED";
  readonly playerId: string;
}

// Movement events
export interface PlayerMovedEvent {
  readonly type: "PLAYER_MOVED";
  readonly playerId: string;
  readonly from: HexCoord;
  readonly to: HexCoord;
}

export interface TileRevealedEvent {
  readonly type: "TILE_REVEALED";
  readonly playerId: string;
  readonly position: HexCoord;
  readonly tileId: string;
}

// Combat events
export interface CombatStartedEvent {
  readonly type: "COMBAT_STARTED";
  readonly playerIndex: number;
  readonly position: HexCoord;
  readonly enemies: readonly string[];
}

export interface CombatEndedEvent {
  readonly type: "COMBAT_ENDED";
  readonly playerIndex: number;
  readonly victory: boolean;
}

// Card events
export interface CardPlayedEvent {
  readonly type: "CARD_PLAYED";
  readonly playerId: string;
  readonly cardId: CardId;
  readonly powered: boolean;
  readonly sideways: boolean;
  readonly effect: string;
}

export interface CardDrawnEvent {
  readonly type: "CARD_DRAWN";
  readonly playerId: string;
  readonly count: number;
}

export interface CardDiscardedEvent {
  readonly type: "CARD_DISCARDED";
  readonly playerId: string;
  readonly cardId: CardId;
}

export interface CardGainedEvent {
  readonly type: "CARD_GAINED";
  readonly playerId: string;
  readonly cardId: CardId;
  readonly source: "offer" | "reward" | "level_up";
}

// Mana events
export interface ManaDieTakenEvent {
  readonly type: "MANA_DIE_TAKEN";
  readonly playerId: string;
  readonly dieId: string;
  readonly color: ManaColor;
}

export interface ManaDieReturnedEvent {
  readonly type: "MANA_DIE_RETURNED";
  readonly dieId: string;
  readonly newColor: ManaColor;
}

export interface CrystalConvertedEvent {
  readonly type: "CRYSTAL_CONVERTED";
  readonly playerId: string;
  readonly color: ManaColor;
}

// Health/damage events
export interface WoundReceivedEvent {
  readonly type: "WOUND_RECEIVED";
  readonly playerId: string;
  readonly target: "hero" | { readonly unit: number };
  readonly source: string;
}

export interface WoundHealedEvent {
  readonly type: "WOUND_HEALED";
  readonly playerId: string;
  readonly target: "hero" | { readonly unit: number };
}

// Progression events
export interface FameGainedEvent {
  readonly type: "FAME_GAINED";
  readonly playerId: string;
  readonly amount: number;
  readonly newTotal: number;
  readonly source: string;
}

export interface FameLostEvent {
  readonly type: "FAME_LOST";
  readonly playerId: string;
  readonly amount: number;
  readonly newTotal: number;
  readonly source: string;
}

export interface ReputationChangedEvent {
  readonly type: "REPUTATION_CHANGED";
  readonly playerId: string;
  readonly delta: number;
  readonly newValue: number;
  readonly reason: string;
}

export interface LevelUpEvent {
  readonly type: "LEVEL_UP";
  readonly playerId: string;
  readonly newLevel: number;
  readonly newArmor: number;
  readonly newHandLimit: number;
}

// Unit events
export interface UnitRecruitedEvent {
  readonly type: "UNIT_RECRUITED";
  readonly playerId: string;
  readonly cardId: CardId;
}

export interface UnitActivatedEvent {
  readonly type: "UNIT_ACTIVATED";
  readonly playerId: string;
  readonly unitIndex: number;
  readonly ability: string;
}

export interface UnitWoundedEvent {
  readonly type: "UNIT_WOUNDED";
  readonly playerId: string;
  readonly unitIndex: number;
}

export interface UnitReadiedEvent {
  readonly type: "UNIT_READIED";
  readonly playerId: string;
  readonly unitIndex: number;
}

export interface UnitDestroyedEvent {
  readonly type: "UNIT_DESTROYED";
  readonly playerId: string;
  readonly unitIndex: number;
  readonly reason: "paralyze" | "disbanded";
}

// Skill events
export interface SkillUsedEvent {
  readonly type: "SKILL_USED";
  readonly playerId: string;
  readonly skillId: SkillId;
}

export interface SkillGainedEvent {
  readonly type: "SKILL_GAINED";
  readonly playerId: string;
  readonly skillId: SkillId;
}

// Offer events
export interface OfferRefreshedEvent {
  readonly type: "OFFER_REFRESHED";
  readonly offerType: "units" | "advancedActions" | "spells";
}

export interface OfferCardTakenEvent {
  readonly type: "OFFER_CARD_TAKEN";
  readonly offerType: "units" | "advancedActions" | "spells";
  readonly cardId: CardId;
}

// Undo events
export interface MoveUndoneEvent {
  readonly type: "MOVE_UNDONE";
  readonly playerId: string;
  readonly from: HexCoord;
  readonly to: HexCoord;
}

export interface UndoFailedEvent {
  readonly type: "UNDO_FAILED";
  readonly playerId: string;
  readonly reason: "nothing_to_undo" | "checkpoint_reached" | "not_your_turn";
}

// Validation events
export interface InvalidActionEvent {
  readonly type: "INVALID_ACTION";
  readonly playerId: string;
  readonly actionType: string;
  readonly reason: string;
}

export interface UndoCheckpointSetEvent {
  readonly type: "UNDO_CHECKPOINT_SET";
  readonly playerId: string;
  readonly reason: string;
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
  | MoveUndoneEvent
  | UndoFailedEvent
  | UndoCheckpointSetEvent
  // Validation
  | InvalidActionEvent;

export type GameEventType = GameEvent["type"];
