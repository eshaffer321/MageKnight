/**
 * Command type constants.
 *
 * These are NOT GameEvent types (those live in @mage-knight/shared).
 * They identify engine commands for the command stack / undo checkpoints.
 */

export const MOVE_COMMAND = "MOVE" as const;
export const REVEAL_TILE_COMMAND = "REVEAL_TILE" as const;
export const END_TURN_COMMAND = "END_TURN" as const;
export const EXPLORE_COMMAND = "EXPLORE" as const;
export const PLAY_CARD_COMMAND = "PLAY_CARD" as const;

// Reserved / upcoming command types used by undo checkpointing.
export const DRAW_ENEMY_COMMAND = "DRAW_ENEMY" as const;
export const DRAW_CARD_COMMAND = "DRAW_CARD" as const;
export const ROLL_DIE_COMMAND = "ROLL_DIE" as const;


