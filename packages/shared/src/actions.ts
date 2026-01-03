/**
 * Player action types - discriminated union for all actions a player can take
 */

import type { HexCoord, HexDirection } from "./hex.js";
import type { CardId, SkillId, BasicManaColor, ManaColor } from "./ids.js";
import type { ManaSourceType } from "./valueConstants.js";
import {
  PLAY_SIDEWAYS_AS_ATTACK,
  PLAY_SIDEWAYS_AS_BLOCK,
  PLAY_SIDEWAYS_AS_INFLUENCE,
  PLAY_SIDEWAYS_AS_MOVE,
} from "./valueConstants.js";

// Movement actions
export const MOVE_ACTION = "MOVE" as const;
export interface MoveAction {
  readonly type: typeof MOVE_ACTION;
  readonly target: HexCoord;
}

export const EXPLORE_ACTION = "EXPLORE" as const;
export interface ExploreAction {
  readonly type: typeof EXPLORE_ACTION;
  readonly direction: HexDirection;
}

// Turn structure actions
export const END_TURN_ACTION = "END_TURN" as const;
export interface EndTurnAction {
  readonly type: typeof END_TURN_ACTION;
}

export const REST_ACTION = "REST" as const;

// Rest type constants
export const REST_TYPE_STANDARD = "standard" as const;
export const REST_TYPE_SLOW_RECOVERY = "slow_recovery" as const;

export type RestType = typeof REST_TYPE_STANDARD | typeof REST_TYPE_SLOW_RECOVERY;

export interface RestAction {
  readonly type: typeof REST_ACTION;
  readonly restType: RestType;
  readonly discardCardIds: readonly CardId[];
  readonly announceEndOfRound?: boolean; // Signal to other players
}

export const INTERACT_ACTION = "INTERACT" as const;
export interface InteractAction {
  readonly type: typeof INTERACT_ACTION;
}

export const ANNOUNCE_END_OF_ROUND_ACTION = "ANNOUNCE_END_OF_ROUND" as const;
export interface AnnounceEndOfRoundAction {
  readonly type: typeof ANNOUNCE_END_OF_ROUND_ACTION;
}

// Card playing actions
export const PLAY_CARD_ACTION = "PLAY_CARD" as const;

// Info about the mana source used to power a card
export interface ManaSourceInfo {
  readonly type: ManaSourceType;
  readonly color: ManaColor;
  readonly dieId?: string; // Required when type is "die"
}

export interface PlayCardAction {
  readonly type: typeof PLAY_CARD_ACTION;
  readonly cardId: CardId;
  readonly powered: boolean;
  readonly manaSource?: ManaSourceInfo; // Required when powered is true
}

export const PLAY_CARD_SIDEWAYS_ACTION = "PLAY_CARD_SIDEWAYS" as const;
export interface PlayCardSidewaysAction {
  readonly type: typeof PLAY_CARD_SIDEWAYS_ACTION;
  readonly cardId: CardId;
  readonly as:
    | typeof PLAY_SIDEWAYS_AS_MOVE
    | typeof PLAY_SIDEWAYS_AS_INFLUENCE
    | typeof PLAY_SIDEWAYS_AS_ATTACK
    | typeof PLAY_SIDEWAYS_AS_BLOCK;
}

// Mana usage actions
export const USE_MANA_DIE_ACTION = "USE_MANA_DIE" as const;
export interface UseManaDeieAction {
  readonly type: typeof USE_MANA_DIE_ACTION;
  readonly dieId: string;
}

export const CONVERT_CRYSTAL_ACTION = "CONVERT_CRYSTAL" as const;
export interface ConvertCrystalAction {
  readonly type: typeof CONVERT_CRYSTAL_ACTION;
  readonly color: BasicManaColor;
}

// Unit activation
export const ACTIVATE_UNIT_ACTION = "ACTIVATE_UNIT" as const;
export interface ActivateUnitAction {
  readonly type: typeof ACTIVATE_UNIT_ACTION;
  readonly unitIndex: number;
  readonly abilityIndex: number;
  readonly manaPaid?: ManaColor;
}

// Skill usage
export const USE_SKILL_ACTION = "USE_SKILL" as const;
export interface UseSkillAction {
  readonly type: typeof USE_SKILL_ACTION;
  readonly skillId: SkillId;
}

// Interaction actions
export const RECRUIT_UNIT_ACTION = "RECRUIT_UNIT" as const;
export interface RecruitUnitAction {
  readonly type: typeof RECRUIT_UNIT_ACTION;
  readonly cardId: CardId;
}

export const BUY_SPELL_ACTION = "BUY_SPELL" as const;
export interface BuySpellAction {
  readonly type: typeof BUY_SPELL_ACTION;
  readonly cardId: CardId;
  readonly manaPaid: ManaColor;
}

export const LEARN_ADVANCED_ACTION_ACTION = "LEARN_ADVANCED_ACTION" as const;
export interface LearnAdvancedActionAction {
  readonly type: typeof LEARN_ADVANCED_ACTION_ACTION;
  readonly cardId: CardId;
  readonly fromMonastery: boolean;
}

export const BUY_HEALING_ACTION = "BUY_HEALING" as const;
export interface BuyHealingAction {
  readonly type: typeof BUY_HEALING_ACTION;
  readonly amount: number;
}

// Undo action
export const UNDO_ACTION = "UNDO" as const;
export interface UndoAction {
  readonly type: typeof UNDO_ACTION;
}

// Choice resolution action
export const RESOLVE_CHOICE_ACTION = "RESOLVE_CHOICE" as const;
export interface ResolveChoiceAction {
  readonly type: typeof RESOLVE_CHOICE_ACTION;
  readonly choiceIndex: number; // Which option to choose (0, 1, etc.)
}

export type PlayerAction =
  // Movement
  | MoveAction
  | ExploreAction
  // Turn structure
  | EndTurnAction
  | RestAction
  | InteractAction
  | AnnounceEndOfRoundAction
  // Card playing
  | PlayCardAction
  | PlayCardSidewaysAction
  // Mana usage
  | UseManaDeieAction
  | ConvertCrystalAction
  // Unit activation
  | ActivateUnitAction
  // Skill usage
  | UseSkillAction
  // Interactions
  | RecruitUnitAction
  | BuySpellAction
  | LearnAdvancedActionAction
  | BuyHealingAction
  // Undo
  | UndoAction
  // Choice resolution
  | ResolveChoiceAction;

export type PlayerActionType = PlayerAction["type"];
