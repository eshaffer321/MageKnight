/**
 * Validator type definitions
 */

import type { GameState } from "../../state/GameState.js";
import type { PlayerAction } from "@mage-knight/shared";
import type { ValidationErrorCode } from "./validationCodes.js";

// Validation error with code for programmatic handling
export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly message: string;
}

// Result of a validation check
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: ValidationError };

// A validator function - checks one concern
export type Validator = (
  state: GameState,
  playerId: string,
  action: PlayerAction
) => ValidationResult;

// Helper to create success result
export function valid(): ValidationResult {
  return { valid: true };
}

// Helper to create failure result
export function invalid(code: ValidationErrorCode, message: string): ValidationResult {
  return { valid: false, error: { code, message } };
}
