/**
 * Card definitions for Mage Knight
 */

import type { CardId, ManaColor } from "@mage-knight/shared";

// Card types in the game
export const DEED_CARD_TYPE_BASIC_ACTION = "basic_action" as const;
export const DEED_CARD_TYPE_ADVANCED_ACTION = "advanced_action" as const;
export const DEED_CARD_TYPE_SPELL = "spell" as const;
export const DEED_CARD_TYPE_ARTIFACT = "artifact" as const;
export const DEED_CARD_TYPE_WOUND = "wound" as const;

export type DeedCardType =
  | typeof DEED_CARD_TYPE_BASIC_ACTION
  | typeof DEED_CARD_TYPE_ADVANCED_ACTION
  | typeof DEED_CARD_TYPE_SPELL
  | typeof DEED_CARD_TYPE_ARTIFACT
  | typeof DEED_CARD_TYPE_WOUND;

// Effect placeholder - we'll expand this later
// For now just describe what the effect does
export interface CardEffect {
  readonly description: string;
  // Future: structured effect types (move, influence, attack, block, heal, special)
}

// A deed card definition
export interface DeedCard {
  readonly id: CardId;
  readonly name: string;
  readonly type: DeedCardType;
  readonly color: ManaColor | null; // color needed to power it (null for wounds, some artifacts)
  readonly basicEffect: CardEffect;
  readonly strongEffect: CardEffect; // for artifacts: this is the "throw away" effect
}

// Recruitment site types - where a unit can be recruited (icons on unit cards)
export const RECRUITMENT_SITE_VILLAGE = "village" as const;
export const RECRUITMENT_SITE_KEEP = "keep" as const;
export const RECRUITMENT_SITE_MAGE_TOWER = "mage_tower" as const;
export const RECRUITMENT_SITE_MONASTERY = "monastery" as const;
export const RECRUITMENT_SITE_CITY = "city" as const;

export type RecruitmentSite =
  | typeof RECRUITMENT_SITE_VILLAGE
  | typeof RECRUITMENT_SITE_KEEP
  | typeof RECRUITMENT_SITE_MAGE_TOWER
  | typeof RECRUITMENT_SITE_MONASTERY
  | typeof RECRUITMENT_SITE_CITY;

// Unit tier - determines when units appear in the offer
// Silver units are available from the start, gold units after core tiles are revealed
export const UNIT_TIER_SILVER = "silver" as const;
export const UNIT_TIER_GOLD = "gold" as const;

export type UnitTier = typeof UNIT_TIER_SILVER | typeof UNIT_TIER_GOLD;

// Unit ability placeholder - expand later
export interface UnitAbility {
  readonly name: string;
  readonly manaCost: ManaColor | null; // null = no mana needed
  readonly effect: CardEffect;
}

// Unit card (separate from deed cards - units don't go in your deck)
export interface UnitCard {
  readonly id: CardId;
  readonly name: string;
  readonly level: number; // 1-4, also determines healing cost
  readonly armor: number;
  readonly recruitCost: number; // influence needed
  readonly abilities: readonly UnitAbility[];
  readonly recruitmentSites: readonly RecruitmentSite[]; // where this unit can be recruited
  readonly tier: UnitTier; // silver = early game, gold = after core tiles
}
