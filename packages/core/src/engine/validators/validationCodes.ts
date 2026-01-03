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
export const CHOICE_REQUIRED = "CHOICE_REQUIRED" as const;

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
  | typeof CHOICE_REQUIRED;


