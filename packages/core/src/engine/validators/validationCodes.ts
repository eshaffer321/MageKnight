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
export const INVALID_ACTION = "INVALID_ACTION" as const;
export const NOT_ADJACENT = "NOT_ADJACENT" as const;
export const HEX_NOT_FOUND = "HEX_NOT_FOUND" as const;
export const IMPASSABLE = "IMPASSABLE" as const;
export const NOT_ENOUGH_MOVE_POINTS = "NOT_ENOUGH_MOVE_POINTS" as const;

export type ValidationErrorCode =
  | typeof NOT_YOUR_TURN
  | typeof WRONG_PHASE
  | typeof IN_COMBAT
  | typeof PLAYER_NOT_FOUND
  | typeof ALREADY_ACTED
  | typeof NOT_ON_MAP
  | typeof INVALID_ACTION
  | typeof NOT_ADJACENT
  | typeof HEX_NOT_FOUND
  | typeof IMPASSABLE
  | typeof NOT_ENOUGH_MOVE_POINTS;


