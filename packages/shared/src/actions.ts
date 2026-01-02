/**
 * Player action types - discriminated union for all actions a player can take
 */

import type { HexCoord, HexDirection } from "./hex.js";
import type { CardId, SkillId, BasicManaColor, ManaColor } from "./ids.js";

// Movement actions
export interface MoveAction {
  readonly type: "MOVE";
  readonly target: HexCoord;
}

export interface ExploreAction {
  readonly type: "EXPLORE";
  readonly direction: HexDirection;
}

// Turn structure actions
export interface EndTurnAction {
  readonly type: "END_TURN";
}

export interface RestAction {
  readonly type: "REST";
}

export interface InteractAction {
  readonly type: "INTERACT";
}

export interface AnnounceEndOfRoundAction {
  readonly type: "ANNOUNCE_END_OF_ROUND";
}

// Card playing actions
export interface PlayCardAction {
  readonly type: "PLAY_CARD";
  readonly cardId: CardId;
  readonly powered: boolean;
  readonly manaSource?: "die" | "crystal" | "token";
}

export interface PlayCardSidewaysAction {
  readonly type: "PLAY_CARD_SIDEWAYS";
  readonly cardId: CardId;
  readonly as: "move" | "influence" | "attack" | "block";
}

// Mana usage actions
export interface UseManaDeieAction {
  readonly type: "USE_MANA_DIE";
  readonly dieId: string;
}

export interface ConvertCrystalAction {
  readonly type: "CONVERT_CRYSTAL";
  readonly color: BasicManaColor;
}

// Unit activation
export interface ActivateUnitAction {
  readonly type: "ACTIVATE_UNIT";
  readonly unitIndex: number;
  readonly abilityIndex: number;
  readonly manaPaid?: ManaColor;
}

// Skill usage
export interface UseSkillAction {
  readonly type: "USE_SKILL";
  readonly skillId: SkillId;
}

// Interaction actions
export interface RecruitUnitAction {
  readonly type: "RECRUIT_UNIT";
  readonly cardId: CardId;
}

export interface BuySpellAction {
  readonly type: "BUY_SPELL";
  readonly cardId: CardId;
  readonly manaPaid: ManaColor;
}

export interface LearnAdvancedActionAction {
  readonly type: "LEARN_ADVANCED_ACTION";
  readonly cardId: CardId;
  readonly fromMonastery: boolean;
}

export interface BuyHealingAction {
  readonly type: "BUY_HEALING";
  readonly amount: number;
}

// Undo action
export interface UndoAction {
  readonly type: "UNDO";
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
  | UndoAction;

export type PlayerActionType = PlayerAction["type"];
