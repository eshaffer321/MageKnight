/**
 * Validation error code constants.
 *
 * These are used for programmatic handling of validation failures (UI, analytics, etc.).
 * Keep them centralized to avoid drift as we add more validators.
 */

export const NOT_YOUR_TURN = "NOT_YOUR_TURN" as const;
export const WRONG_PHASE = "WRONG_PHASE" as const;
export const IN_COMBAT = "IN_COMBAT" as const;
export const PLAYER_NOT_FOUND = "PLAYER_NOT_FOUND" as const;
export const ALREADY_ACTED = "ALREADY_ACTED" as const;

export const NOT_ON_MAP = "NOT_ON_MAP" as const;
// NOTE: named `*_CODE` to avoid confusion with the shared `INVALID_ACTION` GameEvent type.
export const INVALID_ACTION_CODE = "INVALID_ACTION" as const;
export const NOT_ADJACENT = "NOT_ADJACENT" as const;
export const HEX_NOT_FOUND = "HEX_NOT_FOUND" as const;
export const IMPASSABLE = "IMPASSABLE" as const;
export const NOT_ENOUGH_MOVE_POINTS = "NOT_ENOUGH_MOVE_POINTS" as const;

// Explore validation codes
export const NOT_ON_EDGE = "NOT_ON_EDGE" as const;
export const INVALID_DIRECTION = "INVALID_DIRECTION" as const;
export const NO_TILES_AVAILABLE = "NO_TILES_AVAILABLE" as const;

// Card play validation codes
export const CARD_NOT_IN_HAND = "CARD_NOT_IN_HAND" as const;
export const CARD_NOT_FOUND = "CARD_NOT_FOUND" as const;
export const CANNOT_PLAY_WOUND = "CANNOT_PLAY_WOUND" as const;
export const CHOICE_REQUIRED_CODE = "CHOICE_REQUIRED" as const;

// Choice resolution validation codes
export const NO_PENDING_CHOICE = "NO_PENDING_CHOICE" as const;
export const INVALID_CHOICE_INDEX = "INVALID_CHOICE_INDEX" as const;
export const CHOICE_PENDING = "CHOICE_PENDING" as const;

// Sideways play validation codes
export const SIDEWAYS_CHOICE_REQUIRED = "SIDEWAYS_CHOICE_REQUIRED" as const;

// Rest validation codes
export const REST_NO_DISCARD = "REST_NO_DISCARD" as const;
export const REST_NEEDS_NON_WOUND = "REST_NEEDS_NON_WOUND" as const;
export const CANNOT_REST = "CANNOT_REST" as const;
export const STANDARD_REST_ONE_NON_WOUND = "STANDARD_REST_ONE_NON_WOUND" as const;
export const SLOW_RECOVERY_INVALID = "SLOW_RECOVERY_INVALID" as const;
export const SLOW_RECOVERY_ONE_WOUND = "SLOW_RECOVERY_ONE_WOUND" as const;
export const SLOW_RECOVERY_MUST_BE_WOUND = "SLOW_RECOVERY_MUST_BE_WOUND" as const;

// Mana validation codes
export const DIE_ALREADY_USED = "DIE_ALREADY_USED" as const;
export const DIE_NOT_FOUND = "DIE_NOT_FOUND" as const;
export const DIE_DEPLETED = "DIE_DEPLETED" as const;
export const DIE_COLOR_MISMATCH = "DIE_COLOR_MISMATCH" as const;
export const DIE_TAKEN = "DIE_TAKEN" as const;
export const NO_CRYSTAL = "NO_CRYSTAL" as const;
export const NO_MANA_TOKEN = "NO_MANA_TOKEN" as const;
export const INVALID_MANA_SOURCE = "INVALID_MANA_SOURCE" as const;
export const MANA_COLOR_MISMATCH = "MANA_COLOR_MISMATCH" as const;
export const BLACK_MANA_INVALID = "BLACK_MANA_INVALID" as const;
export const BLACK_MANA_DAY = "BLACK_MANA_DAY" as const;
export const GOLD_MANA_NIGHT = "GOLD_MANA_NIGHT" as const;
export const POWERED_WITHOUT_MANA = "POWERED_WITHOUT_MANA" as const;

export type ValidationErrorCode =
  | typeof NOT_YOUR_TURN
  | typeof WRONG_PHASE
  | typeof IN_COMBAT
  | typeof PLAYER_NOT_FOUND
  | typeof ALREADY_ACTED
  | typeof NOT_ON_MAP
  | typeof INVALID_ACTION_CODE
  | typeof NOT_ADJACENT
  | typeof HEX_NOT_FOUND
  | typeof IMPASSABLE
  | typeof NOT_ENOUGH_MOVE_POINTS
  | typeof NOT_ON_EDGE
  | typeof INVALID_DIRECTION
  | typeof NO_TILES_AVAILABLE
  | typeof CARD_NOT_IN_HAND
  | typeof CARD_NOT_FOUND
  | typeof CANNOT_PLAY_WOUND
  | typeof CHOICE_REQUIRED_CODE
  | typeof NO_PENDING_CHOICE
  | typeof INVALID_CHOICE_INDEX
  | typeof CHOICE_PENDING
  | typeof SIDEWAYS_CHOICE_REQUIRED
  // Rest validation
  | typeof REST_NO_DISCARD
  | typeof REST_NEEDS_NON_WOUND
  | typeof CANNOT_REST
  | typeof STANDARD_REST_ONE_NON_WOUND
  | typeof SLOW_RECOVERY_INVALID
  | typeof SLOW_RECOVERY_ONE_WOUND
  | typeof SLOW_RECOVERY_MUST_BE_WOUND
  // Mana validation
  | typeof DIE_ALREADY_USED
  | typeof DIE_NOT_FOUND
  | typeof DIE_DEPLETED
  | typeof DIE_COLOR_MISMATCH
  | typeof DIE_TAKEN
  | typeof NO_CRYSTAL
  | typeof NO_MANA_TOKEN
  | typeof INVALID_MANA_SOURCE
  | typeof MANA_COLOR_MISMATCH
  | typeof BLACK_MANA_INVALID
  | typeof BLACK_MANA_DAY
  | typeof GOLD_MANA_NIGHT
  | typeof POWERED_WITHOUT_MANA;


