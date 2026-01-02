/**
 * Shared string constants for non-discriminator unions ("sub-unions").
 *
 * We keep these centralized to avoid drift across engine/server/client.
 */

// === Generic "source of a mana token" (where it came from) ===
export const MANA_TOKEN_SOURCE_DIE = "die" as const;
export const MANA_TOKEN_SOURCE_CARD = "card" as const;
export const MANA_TOKEN_SOURCE_SKILL = "skill" as const;
export const MANA_TOKEN_SOURCE_SITE = "site" as const;

export type ManaTokenSource =
  | typeof MANA_TOKEN_SOURCE_DIE
  | typeof MANA_TOKEN_SOURCE_CARD
  | typeof MANA_TOKEN_SOURCE_SKILL
  | typeof MANA_TOKEN_SOURCE_SITE;

// === Action sub-unions ===
export const MANA_SOURCE_DIE = "die" as const;
export const MANA_SOURCE_CRYSTAL = "crystal" as const;
export const MANA_SOURCE_TOKEN = "token" as const;

export const PLAY_SIDEWAYS_AS_MOVE = "move" as const;
export const PLAY_SIDEWAYS_AS_INFLUENCE = "influence" as const;
export const PLAY_SIDEWAYS_AS_ATTACK = "attack" as const;
export const PLAY_SIDEWAYS_AS_BLOCK = "block" as const;

// === Event sub-unions ===
export const CARD_GAIN_SOURCE_OFFER = "offer" as const;
export const CARD_GAIN_SOURCE_REWARD = "reward" as const;
export const CARD_GAIN_SOURCE_LEVEL_UP = "level_up" as const;

export const OFFER_TYPE_UNITS = "units" as const;
export const OFFER_TYPE_ADVANCED_ACTIONS = "advancedActions" as const;
export const OFFER_TYPE_SPELLS = "spells" as const;

export const UNIT_DESTROY_REASON_PARALYZE = "paralyze" as const;
export const UNIT_DESTROY_REASON_DISBANDED = "disbanded" as const;

export const UNDO_FAILED_NOTHING_TO_UNDO = "nothing_to_undo" as const;
export const UNDO_FAILED_CHECKPOINT_REACHED = "checkpoint_reached" as const;
export const UNDO_FAILED_NOT_YOUR_TURN = "not_your_turn" as const;

// === Client state sub-unions ===
// Back-compat aliases (prefer `MANA_TOKEN_SOURCE_*`)
export const CLIENT_MANA_TOKEN_SOURCE_DIE = MANA_TOKEN_SOURCE_DIE;
export const CLIENT_MANA_TOKEN_SOURCE_CARD = MANA_TOKEN_SOURCE_CARD;
export const CLIENT_MANA_TOKEN_SOURCE_SKILL = MANA_TOKEN_SOURCE_SKILL;
export const CLIENT_MANA_TOKEN_SOURCE_SITE = MANA_TOKEN_SOURCE_SITE;

// === Event sub-unions (targets) ===
export const WOUND_TARGET_HERO = "hero" as const;


